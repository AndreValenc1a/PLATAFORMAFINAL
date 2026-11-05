"use strict";
const plcModel = require("../models/plcModel");
function responder(res, codigo, datos) {
    res.writeHead(codigo, {"Content-Type": "application/json; charset=utf-8", "Cache-Control":"no-store"});
    res.end(JSON.stringify(datos));
}
async function obtenerTodos(req, res) {
    try {
        const plc = await plcModel.obtenerTodos();
        responder(res, 200, {total: plc.length, plc});
    } catch (error) {
        console.error("[PLC] Consulta SQL:", error.message);
        responder(res, 503, {error:"No se pudo consultar el inventario MySQL"});
    }
}
async function obtenerPorId(req, res, id) {
    try {
        const plc = await plcModel.obtenerPorId(id);
        responder(res, plc ? 200 : 404, plc || {error:"PLC no encontrado", id:Number(id)});
    } catch (error) {
        console.error("[PLC] Consulta SQL:", error.message);
        responder(res, 503, {error:"No se pudo consultar el inventario MySQL"});
    }
}
module.exports = { obtenerTodos, obtenerPorId };
