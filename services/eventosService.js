"use strict";

const fs = require("node:fs");
const path = require("node:path");
const RUTA = path.resolve(__dirname, "../data/eventos.json");
const LIMITE = 10000;

let db = { version: 1, siguienteId: 1, eventos: [] };
let previo = new Map();
let timer = null;
let estabaActivo = false;
let supervisando = null;
let obtenerEstado = null;

function cargar() {
  if (!fs.existsSync(RUTA)) return;
  const d = JSON.parse(fs.readFileSync(RUTA, "utf8"));
  if (!d || !Array.isArray(d.eventos)) throw new Error("data/eventos.json no es válido");
  db = { version: 1, siguienteId: Number(d.siguienteId) || 1, eventos: d.eventos };
  db.siguienteId = Math.max(db.siguienteId, ...db.eventos.map(e => (Number(e.id) || 0) + 1), 1);
}

function guardar() {
  fs.mkdirSync(path.dirname(RUTA), { recursive: true });
  const tmp = RUTA + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  try {
    fs.renameSync(tmp, RUTA);
  } catch (e) {
    // En Windows el reemplazo de un archivo existente puede fallar.
    const respaldo = RUTA + ".bak";
    if (fs.existsSync(RUTA)) fs.copyFileSync(RUTA, respaldo);
    fs.copyFileSync(tmp, RUTA);
    fs.unlinkSync(tmp);
  }
}

function segundosEntre(inicio, fin) {
  if (!inicio || !fin) return null;
  return Math.max(0, Math.round((Date.parse(fin) - Date.parse(inicio)) / 1000));
}

function agregar(d, tipo, detalle, inicio = null, fin = null, fecha = new Date().toISOString()) {
  const evento = {
    id: db.siguienteId++, fecha, plcId: d.id, modelo: d.modelo, ip: d.ip,
    tipo, detalle, inicio, fin, duracionSegundos: segundosEntre(inicio, fin)
  };
  db.eventos.push(evento);
  if (db.eventos.length > LIMITE) db.eventos.splice(0, db.eventos.length - LIMITE);
  guardar();
  return evento;
}

function cerrarIncidente(id, tipo, inicio, fin) {
  if (!inicio) return;
  const evento = [...db.eventos].reverse().find(e =>
    Number(e.plcId) === Number(id) && e.tipo === tipo && e.inicio === inicio && !e.fin
  );
  if (!evento) return;
  evento.fin = fin;
  evento.duracionSegundos = segundosEntre(inicio, fin);
  guardar();
}

// Un reinicio interrumpe la observación; NO equivale a una recuperación.
// Se registra el límite de evidencia sin asignar una fecha de cierre ficticia.
function marcarSeguimientoInterrumpido(fecha, soloSesion = false) {
  let cambios = 0;
  const pendientes = soloSesion
    ? [...previo.entries()].flatMap(([id, p]) => [
        { id, tipo: "DESCONEXION", inicio: p.desdeDesconexion },
        { id, tipo: "FALLA", inicio: p.desdeFalla }
      ]).filter(x => x.inicio)
    : null;
  for (const ev of db.eventos) {
    if ((ev.tipo !== "DESCONEXION" && ev.tipo !== "FALLA") || ev.fin || !ev.inicio || ev.seguimientoInterrumpido) continue;
    if (soloSesion && !pendientes.some(x => Number(x.id) === Number(ev.plcId) && x.tipo === ev.tipo && x.inicio === ev.inicio)) continue;
    ev.seguimientoInterrumpido = fecha;
    cambios++;
  }
  if (cambios) guardar();
  return cambios;
}

function esDiagnostico(d) {
  return d.tipoSupervision === "PCCC" || d.tipoSupervision === "CIP_MICRO850" ||
    d.tipoSupervision === "UMAS_M580" ||
    ["ML1100", "ML1400", "Micro850"].includes(d.modelo);
}
function fallaValida(d) {
  return esDiagnostico(d) && d.comunicacion === "CONECTADO" &&
    d.calidad === "OK" && (d.estadoFalla === true || d.estadoFalla === false);
}
function modoValido(d) {
  // Siemens S7-1200: solo modo RUN/STOP. No inferir fallas a partir de STOP.
  const siemens = d.tipoSupervision === "S7_SIEMENS";
  if (!siemens && !esDiagnostico(d)) return null;
  if (d.comunicacion !== "CONECTADO" || d.calidad !== "OK") return null;
  const permitidos = siemens ? ["RUN", "STOP"] : ["RUN", "PROGRAM", "STOP", "ERROR"];
  return permitidos.includes(d.modoOperacion) ? d.modoOperacion : null;
}
function macNormalizada(mac) {
  const valor = String(mac || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  return /^[A-F0-9]{12}$/.test(valor) ? valor : null;
}
function identidad(d, porMac) {
  const detectada = macNormalizada(d.macDetectada);
  const esperada = macNormalizada(d.macEsperada);
  if (!detectada || !esperada) return null; // No confundir ausencia de ARP con otra identidad.
  if (detectada === esperada) return { clave: "CORRECTA", detalle: "Identidad IP/MAC confirmada" };
  const otro = porMac.get(detectada);
  if (otro && Number(otro.id) !== Number(d.id)) {
    return { clave: "CAMBIO:" + detectada,
      detalle: `Posible intercambio de IP: en ${d.ip} se detectó la MAC del PLC-${otro.id} (${otro.modelo}), registrado en ${otro.ip}. MAC detectada: ${d.macDetectada}; esperada: ${d.macEsperada}. Verificar en el laboratorio.` };
  }
  return { clave: "INCORRECTA:" + detectada,
    detalle: `MAC diferente en ${d.ip}. Esperada: ${d.macEsperada}; detectada: ${d.macDetectada}. Verificar configuración y caché ARP.` };
}
function estadoInicial(d) {
  return {
    conectado: d.comunicacion === "CONECTADO",
    falla: fallaValida(d) ? d.estadoFalla : null,
    modo: modoValido(d),
    desdeDesconexion: null,
    desdeFalla: null,
    identidadConfirmada: null,
    identidadCandidata: null,
    identidadRepeticiones: 0
  };
}
function observar() {
  const activo = supervisando();
  if (!activo) {
    marcarSeguimientoInterrumpido(new Date().toISOString(), true);
    previo.clear();
    estabaActivo = false;
    return;
  }
  const estados = obtenerEstado();
  if (!estabaActivo) {
    previo.clear();
    for (const d of estados) previo.set(d.id, estadoInicial(d));
    estabaActivo = true;
    return;
  }
  const porMac = new Map();
  for (const d of estados) {
    const mac = macNormalizada(d.macEsperada);
    if (mac) porMac.set(mac, d);
  }
  for (const d of estados) {
    const conectado = d.comunicacion === "CONECTADO";
    const p = previo.get(d.id);
    if (!p) { previo.set(d.id, estadoInicial(d)); continue; }
    const fecha = new Date().toISOString();

    if (p.conectado && !conectado) {
      p.desdeDesconexion = fecha;
      agregar(d, "DESCONEXION", `Pérdida de comunicación. ${d.error || ""}`.trim(), fecha, null, fecha);
    } else if (!p.conectado && conectado) {
      cerrarIncidente(d.id, "DESCONEXION", p.desdeDesconexion, fecha);
      agregar(d, "CONEXION", "Comunicación establecida o restablecida", p.desdeDesconexion,
        p.desdeDesconexion ? fecha : null, fecha);
      p.desdeDesconexion = null;
    }

    // Nunca concluir recuperación de falla o cambio de modo a partir de una lectura inválida.
    if (fallaValida(d)) {
      if (d.estadoFalla === true && p.falla !== true) {
        p.desdeFalla = fecha;
        const detalleFalla = d.tipoSupervision === "UMAS_M580"
          ? "Diagnóstico UMAS del M580 indica estado ERROR"
          : d.tipoSupervision === "CIP_MICRO850"
            ? "Diagnóstico CIP del Micro850 indica falla"
            : "Bit S:1/13 indica falla";
        agregar(d, "FALLA", detalleFalla, fecha, null, fecha);
      } else if (d.estadoFalla === false && p.falla === true) {
        cerrarIncidente(d.id, "FALLA", p.desdeFalla, fecha);
        agregar(d, "RECUPERACION_FALLA", "Diagnóstico de falla restablecido",
          p.desdeFalla, p.desdeFalla ? fecha : null, fecha);
        p.desdeFalla = null;
      }
      p.falla = d.estadoFalla;
    }
    const modo = modoValido(d);
    if (modo) {
      if (p.modo && p.modo !== modo) {
        agregar(d, modo, `Cambio de modo de operación: ${p.modo} → ${modo}`, null, null, fecha);
      } else if (!p.modo) {
        // Primera lectura válida después de perder comunicación: estado observado, no transición inferida.
        agregar(d, modo, `Modo de operación confirmado: ${modo}`, null, null, fecha);
      }
      p.modo = modo;
    } else if (!conectado) {
      p.modo = null;
    }

    // Exigir dos observaciones consecutivas con MAC válida; no registrar ausencia de ARP.
    const actual = identidad(d, porMac);
    if (actual) {
      if (p.identidadCandidata === actual.clave) p.identidadRepeticiones++;
      else { p.identidadCandidata = actual.clave; p.identidadRepeticiones = 1; }
      if (p.identidadRepeticiones >= 2 && p.identidadConfirmada !== actual.clave) {
        if (actual.clave === "CORRECTA") {
          if (p.identidadConfirmada && p.identidadConfirmada !== "CORRECTA")
            agregar(d, "IDENTIDAD_RESTABLECIDA", actual.detalle, null, null, fecha);
        } else {
          agregar(d, actual.clave.startsWith("CAMBIO:") ? "POSIBLE_CAMBIO_IP" : "IDENTIDAD_INCORRECTA",
            actual.detalle, null, null, fecha);
        }
        p.identidadConfirmada = actual.clave;
      }
    } else {
      p.identidadCandidata = null;
      p.identidadRepeticiones = 0;
    }
    p.conectado = conectado;
  }
}

function iniciar({ estaSupervisando, leerEstados }) {
  if (timer) return;
  supervisando = estaSupervisando;
  obtenerEstado = leerEstados;
  // Pendientes de ejecuciones anteriores: no deducir cierre por un reinicio.
  marcarSeguimientoInterrumpido(new Date().toISOString());
  observar();
  timer = setInterval(() => {
    try { observar(); }
    catch (e) { console.error("[EVENTOS]", e); }
  }, 1000);
}

function detener() {
  if (timer) clearInterval(timer);
  timer = null;
  marcarSeguimientoInterrumpido(new Date().toISOString(), true);
  previo.clear();
  estabaActivo = false;
}

function consultar({ plcId, tipo, limite = 200 } = {}) {
  let lista = db.eventos;
  if (plcId !== undefined && plcId !== "") lista = lista.filter(e => Number(e.plcId) === Number(plcId));
  if (tipo) lista = lista.filter(e => e.tipo === tipo);
  return {
    total: lista.length,
    eventos: lista.slice(-Math.min(1000, Math.max(1, Number(limite) || 200))).reverse()
  };
}

cargar();
module.exports = { iniciar, detener, consultar };
