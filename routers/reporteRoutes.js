"use strict";
const fs=require("node:fs");
const path=require("node:path");
const controller=require("../controllers/reporteController");
async function manejar(req,res) {
  const url=new URL(req.url,"http://127.0.0.1:3000");
  if(req.method!=="GET") return false;
  if(url.pathname==="/reportes") {
    const archivo=path.resolve(__dirname,"../views/reportes.html");
    fs.readFile(archivo,(err,data)=>{
      if(err) {res.writeHead(500,{"Content-Type":"text/plain; charset=utf-8"});res.end("No se pudo cargar la interfaz");return;}
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","X-Content-Type-Options":"nosniff"});res.end(data);
    });
    return true;
  }
  if(url.pathname==="/api/reportes/resumen") {await controller.resumenJson(req,res,url);return true;}
  if(url.pathname==="/api/reportes/pdf") {await controller.descargar(req,res,url);return true;}
  return false;
}
module.exports={manejar};
