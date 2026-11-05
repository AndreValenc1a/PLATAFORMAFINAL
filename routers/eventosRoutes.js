"use strict";
const fs = require("node:fs");
const path = require("node:path");
const eventosService = require("../services/eventosService");
function json(res, codigo, datos) {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(datos));
}
function manejar(req, res) {
  const u = new URL(req.url, "http://127.0.0.1:3000");
  if (u.pathname !== "/eventos" && u.pathname !== "/api/eventos") return false;
  if (req.method !== "GET") { json(res, 405, { error: "Método no permitido" }); return true; }
  if (u.pathname === "/eventos") {
    fs.readFile(path.join(__dirname, "../views/eventos.html"), (err, contenido) => {
      if (err) return json(res, 500, { error: "No se pudo abrir eventos.html" });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" }); res.end(contenido);
    });
    return true;
  }
  const plcId = u.searchParams.get("plcId") || "";
  const tipo = u.searchParams.get("tipo") || "";
  const limite = u.searchParams.get("limite") || "200";
  if (plcId && (!/^\d+$/.test(plcId) || Number(plcId) < 1)) { json(res, 400, { error: "plcId inválido" }); return true; }
  if (tipo && !["CONEXION", "DESCONEXION", "FALLA", "RECUPERACION_FALLA", "RUN", "STOP", "PROGRAM", "ERROR", "IDENTIDAD_RESTABLECIDA", "POSIBLE_CAMBIO_IP", "IDENTIDAD_INCORRECTA"].includes(tipo)) { json(res, 400, { error: "tipo inválido" }); return true; }
  json(res, 200, eventosService.consultar({ plcId, tipo, limite }));
  return true;
}
module.exports = { manejar };
