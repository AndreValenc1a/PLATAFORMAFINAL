"use strict";
const fs = require("fs");
const path = require("path");
const RUTA = path.resolve(__dirname, "../data/horometro.json");
const ZONA = "America/Guayaquil";
const {obtenerTareas} = require("../config/mantenimientoConfig");
let db = { version: 1, dias: {}, mantenimientos: {} };
let anterior = null;
let timer = null;
let dirty = false;
let ultimoGuardado = 0;
const partes = new Intl.DateTimeFormat("en-CA", {timeZone:ZONA, year:"numeric", month:"2-digit", day:"2-digit"}); 
function fechaLocal(ms) {
  const p = Object.fromEntries(partes.formatToParts(new Date(ms)).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function semanaDe(dia) {
  const f = new Date(`${dia}T12:00:00Z`);
  const n = f.getUTCDay();
  f.setUTCDate(f.getUTCDate()-(n===0?6:n-1));
  return f.toISOString().slice(0,10);
}
function siguienteMedianoche(ms) {
  // Ecuador continental (America/Guayaquil) es UTC-5 y no aplica horario de verano.
  const fecha = fechaLocal(ms);
  return Date.parse(`${fecha}T05:00:00Z`) + 86400000;
}
function cargar() {
  if (!fs.existsSync(RUTA)) return;
  const dato = JSON.parse(fs.readFileSync(RUTA,"utf8"));
  if (!dato || typeof dato !== "object" || !dato.dias || !dato.mantenimientos) throw Error("Formato de horómetro inválido");
  db = dato;
}
function guardar() {
  if (!dirty) return;
  fs.mkdirSync(path.dirname(RUTA),{recursive:true});
  const tmp=RUTA+".tmp";
  fs.writeFileSync(tmp,JSON.stringify(db,null,2),"utf8");
  // En Windows, reemplazar destino mediante rename puede fallar si está abierto.
  try { fs.renameSync(tmp,RUTA); }
  catch (e) {
    if (fs.existsSync(RUTA)) fs.rmSync(RUTA);
    fs.renameSync(tmp,RUTA);
  }
  dirty=false; ultimoGuardado=Date.now();
}
function sumar(id, desde, hasta) {
  while (desde< hasta) {
    const dia=fechaLocal(desde);
    const fin=Math.min(hasta,siguienteMedianoche(desde));
    const key=String(id);
    db.dias[dia] ??= {};
    db.dias[dia][key]=(db.dias[dia][key]||0)+(fin-desde);
    desde=fin; dirty=true;
  }
}
function registrar(estados, ahora=Date.now()) {
  const conectados=new Set(estados.filter(e=>e.comunicacion==="CONECTADO").map(e=>String(e.id)));
  if (anterior && ahora>anterior.ts) {
    const lapso=ahora-anterior.ts;
    // Nunca imputar tiempo durante suspensión del sistema o bloqueo prolongado.
    if(lapso<=2500) for(const id of anterior.conectados) {
      if(conectados.has(id)) sumar(id,anterior.ts,ahora);
    }
  }
  anterior={ts:ahora,conectados};
  if(dirty && ahora-ultimoGuardado>=15000) guardar();
}
function iniciar(obtenerEstados) {
  if(timer) return;
  anterior=null;
  registrar(obtenerEstados());
  timer=setInterval(()=>{
    try {registrar(obtenerEstados());}
    catch(e) {console.error("[HOROMETRO]",e.message);}
  },1000);
}
function detener() {
  if(timer) clearInterval(timer);
  timer=null; anterior=null; guardar();
}
function resumen(semana, inventario) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(semana) || semanaDe(semana)!==semana) throw Error("Semana inválida (usar fecha de lunes YYYY-MM-DD)");
  const inicio=Date.parse(`${semana}T12:00:00Z`);
  const dias=Array.from({length:7},(_,i)=>new Date(inicio+i*86400000).toISOString().slice(0,10));
  const registros=inventario.map(e=>{
    const diario=dias.map(d=>Math.round((db.dias[d]?.[String(e.id)]||0)/1000));
    return {id:e.id,modelo:e.modelo,ip:e.ip,segundos:diario.reduce((a,b)=>a+b,0),diario};
  });
  const mantenimientos=db.mantenimientos[semana]||{};
  const hoy=fechaLocal(Date.now());
  const viernes=dias[4];
  const planes=registros.map(e=>({
    id:e.id,
    modelo:e.modelo,
    tareasSugeridas:obtenerTareas(e.modelo),
    fechaProgramada:viernes,
    estado:mantenimientos[String(e.id)] ? "REALIZADO" : hoy<viernes ? "PROGRAMADO" : "PENDIENTE",
    registro:mantenimientos[String(e.id)]||null,
    requiereRevisionSinComunicacion:e.diario.slice(0,5).every(s=>s===0)
  }));
  return {semana,dias,equipos:registros,mantenimientos,planes};
}
function registrarMantenimiento(semana,id,tareas,responsable,observaciones) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(semana) || semanaDe(semana)!==semana) throw Error("Semana inválida");
  if(!Array.isArray(tareas)||!tareas.length||tareas.length>20||tareas.some(t=>typeof t!=="string"||t.length>200)) throw Error("Tareas inválidas");
  if(typeof responsable!=="string"||!responsable.trim()||responsable.length>100) throw Error("Responsable inválido");
  if(tareas.some(t=>!t.trim())) throw Error("No se permiten tareas vacías");
  if(typeof observaciones!=="string"||observaciones.length>1000) throw Error("Observaciones inválidas");
  db.mantenimientos[semana] ??= {};
  db.mantenimientos[semana][String(id)]={fecha:new Date().toISOString(),tareas,responsable:responsable.trim(),observaciones};
  dirty=true; guardar();
  return db.mantenimientos[semana][String(id)];
}
cargar();
module.exports={iniciar,detener,resumen,registrarMantenimiento,semanaDe,fechaLocal};
