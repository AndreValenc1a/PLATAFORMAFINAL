"use strict";
// Servicio de SOLO LECTURA. Protocolo S7 clásico, SZL 0x0424.
// Reutiliza el procedimiento validado en monitor-siemens.js.
const net = require("node:net");
const COTP = Buffer.from("0300001611E00000000100C0010AC1020100C2020100", "hex");
const SETUP = Buffer.from("0300001902F08032010000000100080000F0000001000101E0", "hex");
const SZL = Buffer.from("0300002102F080320700000002000800080001120411440100FF09000404240000", "hex");
function consultarSiemens(ip, { timeout = 3000, signal } = {}) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        let etapa = 0, buffer = Buffer.alloc(0), terminado = false;
        function terminar(error, resultado) {
            if (terminado) return;
            terminado = true;
            signal?.removeEventListener("abort", abortar);
            socket.destroy();
            error ? reject(error) : resolve(resultado);
        }
        function abortar() { terminar(new Error("Consulta Siemens cancelada")); }
        if (signal?.aborted) return abortar();
        signal?.addEventListener("abort", abortar, { once: true });
        socket.setTimeout(timeout);
        socket.connect(102, ip, () => socket.write(COTP));
        socket.on("data", datos => {
            buffer = Buffer.concat([buffer, datos]);
            while (!terminado && buffer.length >= 4) {
                if (buffer[0] !== 3 || buffer[1] !== 0) return terminar(new Error("TPKT invalido"));
                const longitud = buffer.readUInt16BE(2);
                if (longitud < 7 || longitud > 4096) return terminar(new Error("Longitud TPKT invalida"));
                if (buffer.length < longitud) break;
                const trama = buffer.subarray(0, longitud);
                buffer = buffer.subarray(longitud);
                if (etapa === 0) {
                    if (trama[5] !== 0xD0) return terminar(new Error("COTP rechazado"));
                    etapa = 1; socket.write(SETUP);
                } else if (etapa === 1) {
                    if (trama.length < 25 || trama[7] !== 0x32 || trama[8] !== 3 || trama[17] !== 0 || trama[18] !== 0)
                        return terminar(new Error("Negociacion S7 rechazada"));
                    etapa = 2; socket.write(SZL);
                } else {
                    if (trama.length < 61 || trama[7] !== 0x32 || trama[8] !== 7 ||
                        !trama.includes(Buffer.from("04240000", "hex")))
                        return terminar(new Error("Respuesta SZL 0x0424 invalida"));
                    const codigo = trama[44];
                    const estado = codigo === 8 ? "RUN" : codigo === 3 ? "STOP" : "NO DETERMINADO";
                    return terminar(null, { estado, codigoModo: "0x" + codigo.toString(16).toUpperCase().padStart(2,"0") });
                }
            }
        });
        socket.on("timeout", () => terminar(new Error("Timeout Siemens")));
        socket.on("error", error => terminar(error));
        socket.on("close", () => { if (!terminado) terminar(new Error("Conexion Siemens cerrada")); });
    });
}
module.exports = { consultarSiemens };
