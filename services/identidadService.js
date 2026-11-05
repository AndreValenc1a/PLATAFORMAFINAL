"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const supervisorConfig = require("../config/supervisorConfig");

const execFileAsync = promisify(execFile);
const MAXIMO_PARALELO = Math.max(1,
    Number(supervisorConfig.limites?.verificacionesMACConcurrentes) || 8);

// Un semaforo global; no crear 111 procesos ping/arp al mismo tiempo.
let verificacionesEnCurso = 0;
const cola = [];

function liberarTurno() {
    verificacionesEnCurso--;
    while (cola.length > 0 && verificacionesEnCurso < MAXIMO_PARALELO) {
        const siguiente = cola.shift();
        verificacionesEnCurso++;
        siguiente();
    }
}

async function obtenerTurno() {
    if (verificacionesEnCurso < MAXIMO_PARALELO) {
        verificacionesEnCurso++;
        return;
    }
    await new Promise(resolve => cola.push(resolve));
}

function normalizarMAC(mac) {
    return String(mac || "").replace(/[:-]/g, "").toUpperCase();
}

async function verificarMAC(d, { estaVigente = () => true } = {}) {
    await obtenerTurno();
    try {
        if (!estaVigente()) return false;

        // El ping intenta renovar la tabla ARP, pero su respuesta NO es
        // obligatoria: algunos PLC pueden tener ICMP deshabilitado.
        await execFileAsync("ping", ["-n", "1", "-w", "1000", d.ip], {
            timeout: 2500, windowsHide: true
        }).catch(() => null);

        if (!estaVigente()) return false;
        const { stdout } = await execFileAsync("arp", ["-a", d.ip], {
            timeout: 2500, windowsHide: true
        });

        // Buscar la IP completa, nunca una subcadena de otra IP.
        const linea = stdout.split(/\r?\n/).find(texto => {
            const columnas = texto.trim().split(/\s+/);
            return columnas[0] === d.ip;
        });
        const coincidencia = linea?.match(
            /([0-9a-f]{2}(?:[:-][0-9a-f]{2}){5})/i
        );
        if (!coincidencia) {
            d.macDetectada = "No encontrada";
            d.estadoVerificacionMAC = "SIN_RESPUESTA";
            d.identidadCoincide = false;
        } else {
            d.macDetectada = coincidencia[1].replace(/:/g, "-").toUpperCase();
            d.identidadCoincide = normalizarMAC(d.macDetectada) === normalizarMAC(d.mac);
            d.estadoVerificacionMAC = d.identidadCoincide ? "CONFIRMADA" : "DIFERENTE";
        }
    } catch (error) {
        d.macDetectada = "No disponible";
        d.estadoVerificacionMAC = "SIN_RESPUESTA";
        d.identidadCoincide = false;
    } finally {
        liberarTurno();
    }

    d.ultimaVerificacionMAC = Date.now();
    return d.identidadCoincide;
}

module.exports = { normalizarMAC, verificarMAC };
