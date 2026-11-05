"use strict";
const net = require("node:net");

// Consulta UMAS de solo lectura. Patrones verificados experimentalmente
// en el M580 del laboratorio; otros estados/firmwares no se presuponen.
const SOLICITUD = Buffer.from("000100000004015A0004", "hex");
const TIMEOUT_MS = 3000;

function interpretar(trama) {
    if (trama.length < 76 || trama.readUInt16BE(0) !== 1 ||
        trama.readUInt16BE(2) !== 0 || trama.readUInt16BE(4) !== trama.length - 6 ||
        trama[6] !== 1 || trama[7] !== 0x5A || trama[8] !== 0 || trama[9] !== 0xFE) {
        throw new Error("Respuesta UMAS invalida");
    }
    const a = trama[10], b = trama[12], c = trama[70];
    const estado = a === 3 && b === 12 && c === 2 ? "RUN" :
        a === 2 && b === 0x8C && c === 1 ? "STOP" :
        a === 4 && b === 12 && c === 1 ? "ERROR" : "NO DETERMINADO";
    return { estado, codigoModo: a, estadoFalla: estado === "ERROR" ? true :
        estado === "RUN" || estado === "STOP" ? false : null,
        camposUMAS: { offset10: a, offset12: b, offset70: c } };
}

function consultarM580(ip, { timeout = TIMEOUT_MS, signal } = {}) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        let terminado = false;
        let buffer = Buffer.alloc(0);
        let temporizador;
        const limpiar = () => {
            clearTimeout(temporizador);
            signal?.removeEventListener("abort", abortar);
            socket.destroy();
        };
        const finalizar = (error, valor) => {
            if (terminado) return;
            terminado = true;
            limpiar();
            if (error) reject(error); else resolve(valor);
        };
        const abortar = () => finalizar(new Error("Consulta UMAS cancelada"));
        if (signal?.aborted) return abortar();
        signal?.addEventListener("abort", abortar, { once: true });
        temporizador = setTimeout(() => finalizar(new Error("M580 sin respuesta (timeout)")), timeout);
        socket.on("error", error => finalizar(error));
        socket.on("close", () => finalizar(new Error("Conexion UMAS cerrada sin respuesta")));
        socket.on("data", datos => {
            if (terminado) return;
            buffer = Buffer.concat([buffer, datos]);
            if (buffer.length < 6) return;
            const longitud = buffer.readUInt16BE(4);
            if (longitud < 4 || longitud > 4096) return finalizar(new Error("Longitud UMAS invalida"));
            if (buffer.length >= 6 + longitud) {
                try { finalizar(null, interpretar(buffer.subarray(0, 6 + longitud))); }
                catch (error) { finalizar(error); }
            }
        });
        try { socket.connect(502, ip, () => socket.write(SOLICITUD)); }
        catch (error) { finalizar(error); }
    });
}
module.exports = { consultarM580 };
