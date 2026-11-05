"use strict";

// Vigilancia de la interfaz IPv4 local que alcanza la subred de los PLC.
// No hace ping masivo ni interpreta un PLC apagado como caida de la PC.
// Si los PLC estan en redes enrutadas y no se encuentra una interfaz de
// la misma subred, el estado permanece INDETERMINADA (modo conservador).
const os = require("node:os");

function ipNumero(ip) {
    const partes = String(ip || "").split(".");
    if (partes.length !== 4 || partes.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
    return partes.reduce((n, parte) => ((n << 8) | Number(parte)) >>> 0, 0);
}

function interfazPara(ipPLC, interfaces) {
    const destino = ipNumero(ipPLC);
    if (destino === null) return null;
    for (const [nombre, direcciones] of Object.entries(interfaces || {})) {
        for (const red of direcciones || []) {
            if (red.internal || (red.family !== "IPv4" && red.family !== 4)) continue;
            const local = ipNumero(red.address);
            const mascara = ipNumero(red.netmask);
            if (local === null || mascara === null) continue;
            if ((local & mascara) === (destino & mascara)) {
                return { nombre, ipLocal: red.address };
            }
        }
    }
    return null;
}

function crearMonitorRed({
    obtenerIPs,
    alCambiar = () => {},
    obtenerInterfaces = () => os.networkInterfaces(),
    intervaloMs = 1000,
    confirmarCaida = 2,
    confirmarRegreso = 2
}) {
    let estado = "INDETERMINADA";
    let habiaInterfaz = false;
    let consecutivas = 0;
    let candidato = null;
    let temporizador = null;
    let ultimaTransicion = null;
    let interfaz = null;

    function sondear() {
        let ips, interfaces;
        try {
            ips = (obtenerIPs() || []).filter(Boolean);
            interfaces = obtenerInterfaces();
        } catch (error) {
            // El sondeo nunca debe tumbar el proceso de supervision.
            return obtenerEstado();
        }
        const encontrada = ips.map(ip => interfazPara(ip, interfaces)).find(Boolean);
        const observado = encontrada ? "DISPONIBLE" : habiaInterfaz ? "SIN_INTERFAZ" : "INDETERMINADA";
        if (encontrada) { habiaInterfaz = true; interfaz = encontrada; }
        if (observado === "INDETERMINADA") return obtenerEstado();
        if (observado === estado) { candidato = null; consecutivas = 0; return obtenerEstado(); }
        if (candidato !== observado) { candidato = observado; consecutivas = 0; }
        consecutivas++;
        const umbral = observado === "SIN_INTERFAZ" ? confirmarCaida : confirmarRegreso;
        if (consecutivas >= Math.max(1, umbral)) {
            const anterior = estado;
            estado = observado;
            ultimaTransicion = Date.now();
            candidato = null;
            consecutivas = 0;
            alCambiar(estado, anterior);
        }
        return obtenerEstado();
    }

    function obtenerEstado() {
        return { estado, ultimaTransicion, interfaz: interfaz?.nombre ?? null, ipLocal: interfaz?.ipLocal ?? null };
    }
    function iniciar() {
        if (temporizador !== null) return;
        sondear();
        temporizador = setInterval(sondear, Math.max(250, intervaloMs));
    }
    function detener() {
        if (temporizador !== null) clearInterval(temporizador);
        temporizador = null;
        estado = "INDETERMINADA";
        habiaInterfaz = false;
        consecutivas = 0;
        candidato = null;
        interfaz = null;
    }
    return { iniciar, detener, sondear, obtenerEstado };
}

module.exports = { crearMonitorRed, interfazPara };
