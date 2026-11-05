"use strict";
const horometro = require("./horometroService");
const plcModel = require("../models/plcModel");

const DIA_MS = 86400000;
async function inventario() {
  if (typeof plcModel.obtenerTodos !== "function") throw new Error("plcModel.obtenerTodos no está disponible");
  return await plcModel.obtenerTodos();
}
function limitesSemana(lunes) {
  // America/Guayaquil: UTC-05:00 durante todo el año.
  const inicio = Date.parse(`${lunes}T00:00:00-05:00`);
  return { inicio, fin: inicio + 7 * DIA_MS };
}
function obtenerEventosTodos() {
  // consultar() limita la respuesta a 1000, pero el servicio conserva hasta 10000.
  // Para no perder incidentes antiguos al preparar reportes, se lee el archivo persistido.
  const fs = require("node:fs");
  const path = require("node:path");
  const ruta = path.resolve(__dirname, "../data/eventos.json");
  if (!fs.existsSync(ruta)) return [];
  const data = JSON.parse(fs.readFileSync(ruta, "utf8"));
  if (!data || !Array.isArray(data.eventos)) throw new Error("Historial de eventos inválido");
  return data.eventos;
}
function tiempoInterseccion(inicio, fin, limiteInicio, limiteFin) {
  return Math.max(0, Math.min(fin, limiteFin) - Math.max(inicio, limiteInicio));
}
// Une intervalos confirmados para evitar doble conteo por solapamientos.
function duracionUnion(intervalos) {
  if (!intervalos.length) return 0;
  intervalos.sort((a, b) => a[0] - b[0]);
  let [desde, hasta] = intervalos[0];
  let total = 0;
  for (const [a, b] of intervalos.slice(1)) {
    if (a <= hasta) hasta = Math.max(hasta, b);
    else { total += hasta - desde; desde = a; hasta = b; }
  }
  return total + hasta - desde;
}
function resumirEventos(lunes, equipos) {
  const { inicio, fin } = limitesSemana(lunes);
  const limiteActual = Math.min(fin, Date.now());
  const eventos = obtenerEventosTodos();
  const porEquipo = new Map(equipos.map(e => [Number(e.id), {
    plcId: Number(e.id), modelo: e.modelo, ip: e.ip,
    desconexiones: 0, segundosDesconexion: 0, desconexionesSinCierre: 0,
    fallas: 0, segundosFalla: 0, fallasSinCierre: 0
  }]));
  const intervalos = new Map();
  const incidentes = [];
  const tipos = { DESCONEXION: "COMUNICACION", FALLA: "FALLA" };
  for (const ev of eventos) {
    const categoria = tipos[ev.tipo];
    if (!categoria) continue;
    const equipo = porEquipo.get(Number(ev.plcId));
    if (!equipo) continue;
    if (categoria === "FALLA" && !/^ML(?:1100|1400)$/i.test(String(equipo.modelo))) continue;
    const tsInicio = Date.parse(ev.inicio || ev.fecha);
    if (!Number.isFinite(tsInicio) || tsInicio >= limiteActual) continue;
    const tsFin = ev.fin ? Date.parse(ev.fin) : NaN;
    const finValido = Number.isFinite(tsFin) && tsFin >= tsInicio;
    if (finValido && tsFin <= inicio) continue;
    // Incidentes abiertos que comenzaron antes de la semana también se muestran,
    // pero sin atribuirles tiempo no confirmado.
    const inicioEnSemana = tsInicio >= inicio && tsInicio < limiteActual;
    const msSemana = finValido ? tiempoInterseccion(tsInicio, tsFin, inicio, limiteActual) : null;
    if (!inicioEnSemana && msSemana === 0) continue;
    const falla = categoria === "FALLA";
    if (falla) { equipo.fallas++; if (!finValido) equipo.fallasSinCierre++; }
    else { equipo.desconexiones++; if (!finValido) equipo.desconexionesSinCierre++; }
    if (finValido && msSemana > 0) {
      const clave = `${equipo.plcId}:${categoria}`;
      if (!intervalos.has(clave)) intervalos.set(clave, []);
      intervalos.get(clave).push([Math.max(tsInicio, inicio), Math.min(tsFin, limiteActual)]);
    }
    incidentes.push({
      id: ev.id, plcId: equipo.plcId, modelo: equipo.modelo, ip: equipo.ip,
      categoria, tipo: ev.tipo, detalle: ev.detalle || "",
      inicio: new Date(tsInicio).toISOString(),
      fin: finValido ? new Date(tsFin).toISOString() : null,
      estado: finValido ? "RECUPERADO" : "SIN CIERRE REGISTRADO",
      segundosEnSemana: finValido ? Math.round(msSemana / 1000) : null,
      duracionSegundos: finValido ? Math.round((tsFin - tsInicio) / 1000) : null
    });
  }
  for (const equipo of porEquipo.values()) {
    equipo.segundosDesconexion = Math.round(duracionUnion(intervalos.get(`${equipo.plcId}:COMUNICACION`) || []) / 1000);
    equipo.segundosFalla = Math.round(duracionUnion(intervalos.get(`${equipo.plcId}:FALLA`) || []) / 1000);
  }
  incidentes.sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));
  const resumenEquipos = [...porEquipo.values()];
  return {
    zonaHoraria: "America/Guayaquil",
    criterio: "Solo se suman duraciones de incidentes con cierre registrado, recortadas a la semana y sin duplicar solapamientos por PLC. Los incidentes sin cierre se informan, pero su duración es indeterminada y no se suma.",
    equipos: resumenEquipos,
    incidentes,
    totales: {
      desconexiones: resumenEquipos.reduce((s, e) => s + e.desconexiones, 0),
      segundosDesconexion: resumenEquipos.reduce((s, e) => s + e.segundosDesconexion, 0),
      desconexionesSinCierre: resumenEquipos.reduce((s, e) => s + e.desconexionesSinCierre, 0),
      fallas: resumenEquipos.reduce((s, e) => s + e.fallas, 0),
      segundosFalla: resumenEquipos.reduce((s, e) => s + e.segundosFalla, 0),
      fallasSinCierre: resumenEquipos.reduce((s, e) => s + e.fallasSinCierre, 0)
    }
  };
}
async function obtenerResumen(semana) {
  const lunes = semana || horometro.semanaDe(horometro.fechaLocal(Date.now()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lunes) || horometro.semanaDe(lunes) !== lunes) {
    const e = new Error("Semana inválida: usar un lunes en formato YYYY-MM-DD");
    e.statusCode = 400;
    throw e;
  }
  const resumen = horometro.resumen(lunes, await inventario());
  return { ...resumen, eventos: resumirEventos(lunes, resumen.equipos) };
}
module.exports = { obtenerResumen };
