"use strict";
const fs=require("fs");
const path=require("path");
const horometro=require("../services/horometroService");
const plcModel=require("../models/plcModel");
function json(res,status,obj) {
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  res.end(JSON.stringify(obj));
}
async function manejar(req,res) {
  const url=new URL(req.url,"http://localhost");
  if(req.method==="GET" && url.pathname==="/horometro") {
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    res.end(fs.readFileSync(path.resolve(__dirname,"../views/horometro.html")));
    return true;
  }
  if(!url.pathname.startsWith("/api/horometro")) return false;
  if(req.method==="GET" && url.pathname==="/api/horometro") {
    const semana=url.searchParams.get("semana")||horometro.semanaDe(horometro.fechaLocal(Date.now()));
    try {json(res,200,horometro.resumen(semana,await plcModel.obtenerTodos()));}
    catch(e){json(res,400,{error:e.message});}
    return true;
  }
  if(req.method==="POST" && url.pathname==="/api/horometro/mantenimiento") {
    try {
      let body="";
      for await(const chunk of req) {
        body+=chunk.toString();
        if(body.length>10000) {json(res,413,{error:"Solicitud demasiado grande"});return true;}
      }
      const dato=JSON.parse(body);
      const equipo=await plcModel.obtenerPorId(dato.id);
      if(!equipo) {json(res,404,{error:"PLC no registrado"});return true;}
      const semana=dato.semana||horometro.semanaDe(horometro.fechaLocal(Date.now()));
      const registro=horometro.registrarMantenimiento(semana,equipo.id,dato.tareas,dato.responsable,dato.observaciones||"");
      json(res,201,{ok:true,registro});
    } catch(e){json(res,400,{error:e.message});}
    return true;
  }
  json(res,404,{error:"Ruta de horómetro no encontrada"});
  return true;
}
module.exports={manejar};
