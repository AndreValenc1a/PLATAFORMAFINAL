"use strict";
const pool = require("../config/database");
const { tiposSupervision: TIPOS } = require("../config/supervisorConfig");

function adaptar(fila) {
    const modelo = String(fila.modelo || "").trim();
    const es1100 = /\bML\s*1100\b/i.test(modelo);
    const es1400 = /\bML\s*1400\b/i.test(modelo);
    const esMicro850 = /(?:micro\s*850|2080[-\s]?(?:lc50|l50e))/i.test(modelo) ||
        ["192.168.10.33", "192.168.10.55"].includes(String(fila.ip || "").trim());
    const esM580 = /(?:\bM580\b|\bBMEP58\d+\b)/i.test(modelo) || /(?:schneider|modicon)/i.test(String(fila.marca || "")) && /\b58\d{2,}\b/.test(modelo);
    const esSiemens = /(?:\bS7[-\s]?1200\b|\bCPU\s*12(?:11|14)C\b|\b6ES7\s*21(?:1|4)\b)/i.test(modelo) || /siemens/i.test(String(fila.marca || ""));
    const familia = es1100 ? "ML1100" : es1400 ? "ML1400" : esMicro850 ? "Micro850" : esM580 ? "M580" : esSiemens ? modelo : modelo;
    return {
        id: Number(fila.id),
        modelo: familia,
        marca: String(fila.marca || "").trim(),
        modeloInventario: modelo,
        tipo: "PLC",
        ip: String(fila.ip || "").trim(),
        mac: fila.mac ? String(fila.mac).trim().toUpperCase() : null,
        tipoSupervision: es1100 || es1400 ? TIPOS.PCCC : esMicro850 ? "CIP_MICRO850" : esM580 ? TIPOS.UMAS_M580 : esSiemens ? TIPOS.S7_SIEMENS : TIPOS.IDENTIDAD
    };
}

function validar(equipos) {
    const ids = new Set(), ips = new Set();
    for (const e of equipos) {
        if (!Number.isSafeInteger(e.id) || e.id <= 0) throw Error(`ID inválido: ${e.id}`);
        if (ids.has(e.id)) throw Error(`ID duplicado: ${e.id}`);
        ids.add(e.id);
        if (!e.ip) continue; // El equipo se muestra sin intentar conectarse.
        if (ips.has(e.ip)) throw Error(`IP duplicada: ${e.ip}`);
        ips.add(e.ip);
    }
    return equipos;
}

async function obtenerTodos() {
    const [filas] = await pool.query(`
        SELECT id, marca, modelo, tipo, ip, mac FROM inventario
        WHERE UPPER(TRIM(tipo)) = 'PLC'
        ORDER BY id
    `);
    return validar(filas.map(adaptar));
}

async function obtenerPorId(id) {
    if (!/^\d+$/.test(String(id))) return null;
    const [filas] = await pool.execute(`
        SELECT id, marca, modelo, tipo, ip, mac FROM inventario
        WHERE UPPER(TRIM(tipo)) = 'PLC' AND id = ? LIMIT 1
    `, [Number(id)]);
    return filas.length ? adaptar(filas[0]) : null;
}
module.exports = { obtenerTodos, obtenerPorId };
