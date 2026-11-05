"use strict";

const plcModel = require("../models/plcModel");
const supervisorConfig = require("../config/supervisorConfig");
const identidadService = require("./identidadService");
const { crearMonitorRed } = require("./estadoRedService");
const { crearServicioPCCC } = require("./pcccService");
const { consultarMicro850 } = require("./cipMicro850Service");
const { consultarM580 } = require("./m580Service");
const { consultarSiemens } = require("./siemensService");
const horometroService = require("./horometroService");

const INTERVALO_MS = supervisorConfig.intervalos.lectura;
// Intervalos por protocolo, con respaldo al intervalo general.
const INTERVALOS_PROTOCOLO = supervisorConfig.intervalos.lecturaPorProtocolo || {};
function intervaloLectura(d) {
    const valor = INTERVALOS_PROTOCOLO[d.tipoSupervision];
    const base = Number.isFinite(valor) && valor >= 250 ? valor : INTERVALO_MS;
    // Los fallos de un PLC no deben generar una tormenta de sockets.
    // El primer intento sigue siendo rapido; la demora maxima es 4 s.
    if (!d.fallosConsecutivos || d.conectado) return base;
    const multiplicador = Math.min(4, 2 ** Math.min(d.fallosConsecutivos - 1, 2));
    return Math.min(Math.max(base, Number(supervisorConfig.limites?.maximoReintentoIndividual) || 4000),
        base * multiplicador);
}

// Diagnostico ligero: reporta latencia cada 30 consultas por PLC.
const metricasLectura = new Map();
function registrarLatencia(d, inicio, correcto) {
    const clave = d.id;
    const actual = metricasLectura.get(clave) || { n: 0, suma: 0, max: 0, fallos: 0 };
    const ms = Date.now() - inicio;
    actual.n++;
    actual.suma += ms;
    actual.max = Math.max(actual.max, ms);
    if (!correcto) actual.fallos++;
    if (actual.n >= 30) {
        console.info(`[LECTURA PLC] ID=${d.id} ${d.tipoSupervision} promedio=${(actual.suma / actual.n).toFixed(1)}ms max=${actual.max}ms fallos=${actual.fallos}/${actual.n}`);
        metricasLectura.delete(clave);
    } else {
        metricasLectura.set(clave, actual);
    }
}
const INTERVALO_MAC_MS = supervisorConfig.intervalos.verificacionMAC;
// Verificaciones mas frecuentes durante la recuperacion, sin cambiar
// la cadencia de los PLC con lecturas industriales recientes.
const INTERVALO_MAC_RECUPERACION_MS = Math.min(INTERVALO_MAC_MS, Math.max(250,
    Number(supervisorConfig.intervalos.verificacionMACRecuperacion) || 4000));
const INTERVALO_INTERFAZ_MS = Math.max(250,
    Number(supervisorConfig.intervalos.vigilanciaInterfazRed) || 1000);
const GRACIA_ARP_MS = Math.max(0,
    Number(supervisorConfig.intervalos.graciaARPTipoSinRespuesta) || 12000);
const INTERVALO_VIGILANTE_MS = Math.max(1000,
    Number(supervisorConfig.intervalos.vigilanciaRecuperacion) || 2500);
const MARGEN_TEMPORIZADOR_MS = 2000;
const TIEMPO_RECONEXION_MS = supervisorConfig.intervalos.reconexion;
const TIEMPO_SIN_RESPUESTA_MS = supervisorConfig.tiempos.sinRespuesta;
const TIEMPO_MAX_INICIO_MS = supervisorConfig.tiempos.maximoInicio;
const TIPOS = supervisorConfig.tiposSupervision;

// El inventario se carga desde MySQL al arrancar y se sincroniza periÃ³dicamente.
const dispositivos = [];
let temporizadorInventario = null;
let temporizadorVigilante = null;
let sincronizacionPendiente = null;
const INTERVALO_INVENTARIO_MS = 10000;

function crearDispositivo(equipo) {
    return {
        ...equipo,
    client: null,
    pcccEnCola: false,
    abortarUMAS: null,
    abortarSiemens: null,
    abortarCIP: null,
    conectado: false,
    conectando: false,
    ocupado: false,
    identidadCoincide: false,
    macDetectada: "No verificada",
    estadoVerificacionMAC: "SIN_VERIFICAR",
    ultimaMACConfirmada: null,
    macAusenteDesde: null,
    fallosConsecutivos: 0,
    numeroConexionesValidas: 0,
    numeroRecuperaciones: 0,
    ultimaRecuperacion: null,
    ultimaVerificacionMAC: 0,
    temporizadorMAC: null,
    proximaVerificacionMAC: null,
    verificacionMACPendiente: null,
    revisionIdentidad: 0,
    ultimaRespuesta: null,
    conectadoDesde: null,
    inicioConexion: null,
    inicioFalla: null,
    inicioLectura: null,
    estadoFalla: null,
    modoOperacion: "DESCONOCIDO",
    codigoModo: null,
    palabraS1: null,
    cipStatus: null,
    cipState: null,
    calidad: "NO DISPONIBLE",
    error: "SupervisiÃ³n no iniciada",
    temporizadorLectura: null,
    siguienteLecturaEn: null,
    reactivacionesAutomaticas: 0,
    ultimaReactivacion: null,
    temporizadorReconexion: null,
    temporizadorInicio: null,
    intentosConexion: 0
    };
}

function cancelarDispositivo(d) {
    pcccService.cancelarPendiente(d);
    detenerVerificacionPeriodica(d);
    d.revisionIdentidad++;
    if (d.temporizadorLectura !== null) clearTimeout(d.temporizadorLectura);
    if (d.temporizadorReconexion !== null) clearTimeout(d.temporizadorReconexion);
    cancelarTemporizadorInicio(d);
    d.temporizadorLectura = null;
    d.siguienteLecturaEn = null;
    d.temporizadorReconexion = null;
    if (d.abortarUMAS) { d.abortarUMAS.abort(); d.abortarUMAS = null; }
    if (d.abortarSiemens) { d.abortarSiemens.abort(); d.abortarSiemens = null; }
    if (d.abortarCIP) { d.abortarCIP.abort(); d.abortarCIP = null; }
    const cliente = d.client;
    d.client = null;
    pcccService.cerrarCliente(cliente);
    d.conectado = false;
    d.conectando = false;
    d.ocupado = false;
    d.inicioLectura = null;
    d.modoOperacion = "DESCONOCIDO";
}

async function activarDispositivo(d) {
    if (!estaSupervisando() || !d.ip || !d.mac) {
        d.error = !d.ip ? "IP no configurada" : !d.mac ? "MAC pendiente de configurar" : "SupervisiÃ³n detenida";
        return;
    }
    const sesion = generacion;
    await verificarMAC(d);
    programarVerificacionPeriodica(d);
    if (!estaSupervisando() || sesion !== generacion || !dispositivos.includes(d)) return;
    if (esSupervisionIdentidad(d)) {
        d.calidad = d.identidadCoincide ? "IDENTIDAD CONFIRMADA" : "NO DISPONIBLE";
        d.error = d.identidadCoincide ? "Solo verificaciÃ³n IP/MAC" : "Identidad MAC no verificada";
    } else if (esMicro850(d)) {
        d.error = d.identidadCoincide ? "Esperando primera lectura CIP" : "Identidad MAC no verificada";
    } else if (esSiemens(d)) {
        d.error = d.identidadCoincide ? "Esperando primera lectura S7" : "Identidad MAC no verificada";
    } else if (esM580(d)) {
        d.error = d.identidadCoincide ? "Esperando primera lectura UMAS" : "Identidad MAC no verificada";
    } else if (d.identidadCoincide) {
        if (!d.client && !d.conectando) pcccService.conectarPLC(d);
    } else {
        d.error = "Identidad MAC no verificada";
    }
    programarLectura(d, 0);
}

async function sincronizarInventario() {
    if (sincronizacionPendiente) return sincronizacionPendiente;
    const tarea = (async () => {
        const equipos = await plcModel.obtenerTodos();
        const ids = new Set(equipos.map(e => e.id));
        for (let i = dispositivos.length - 1; i >= 0; i--) {
            if (!ids.has(dispositivos[i].id)) {
                cancelarDispositivo(dispositivos[i]);
                dispositivos.splice(i, 1);
            }
        }
        for (const equipo of equipos) {
            const indice = dispositivos.findIndex(d => d.id === equipo.id);
            if (indice < 0) {
                const nuevo = crearDispositivo(equipo);
                dispositivos.push(nuevo);
                if (estaSupervisando()) await activarDispositivo(nuevo);
            } else {
                const anterior = dispositivos[indice];
                const cambio = anterior.ip !== equipo.ip || anterior.mac !== equipo.mac ||
                    anterior.tipoSupervision !== equipo.tipoSupervision;
                if (cambio) {
                    cancelarDispositivo(anterior);
                    const nuevo = crearDispositivo(equipo);
                    dispositivos[indice] = nuevo;
                    if (estaSupervisando()) await activarDispositivo(nuevo);
                } else {
                    anterior.modelo = equipo.modelo;
                    anterior.marca = equipo.marca;
                    anterior.modeloInventario = equipo.modeloInventario;
                }
            }
        }
        dispositivos.sort((a,b) => a.id - b.id);
        return dispositivos.length;
    })();
    sincronizacionPendiente = tarea;
    try { return await tarea; }
    finally { if (sincronizacionPendiente === tarea) sincronizacionPendiente = null; }
}

function iniciarSincronizacionInventario() {
    if (temporizadorInventario) return;
    temporizadorInventario = setInterval(() => {
        sincronizarInventario().catch(e => console.error("[INVENTARIO] SincronizaciÃ³n fallida:", e.message));
    }, INTERVALO_INVENTARIO_MS);
}

function detenerSincronizacionInventario() {
    if (temporizadorInventario) clearInterval(temporizadorInventario);
    temporizadorInventario = null;
}

let supervisando = false;
let cerrando = false;
let inicioPendiente = null;
let generacion = 0;

function estaSupervisando() {
    return supervisando && !cerrando;
}

function esSiemens(d) {
    return d.tipoSupervision === TIPOS.S7_SIEMENS;
}

function esM580(d) {
    return d.tipoSupervision === TIPOS.UMAS_M580;
}

function esMicro850(d) {
    return d.tipoSupervision === "CIP_MICRO850";
}

function esSupervisionIdentidad(d) {
    return d.tipoSupervision === TIPOS.IDENTIDAD;
}

function duracion(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const horas = Math.floor(total / 3600);
    const minutos = Math.floor((total % 3600) / 60);
    const segundos = total % 60;
    return (
        String(horas).padStart(2, "0") + " h " +
        String(minutos).padStart(2, "0") + " min " +
        String(segundos).padStart(2, "0") + " s"
    );
}

function reiniciarCronometros(d) {
    d.inicioConexion = null;
    d.inicioFalla = null;
    d.estadoFalla = null;
    d.modoOperacion = "DESCONOCIDO";
    d.codigoModo = null;
    d.palabraS1 = null;
    d.cipStatus = null;
    d.cipState = null;
}

// Medicion de la verificacion IP/MAC: permite evaluar el bloqueo real
// antes de modificar la politica de identidad industrial.
const metricasMAC = new Map();
function registrarMedicionMAC(d, inicio, resultado) {
    const clave = d.id;
    const m = metricasMAC.get(clave) || { n: 0, suma: 0, max: 0, fallos: 0 };
    const ms = Date.now() - inicio;
    m.n++;
    m.suma += ms;
    m.max = Math.max(m.max, ms);
    if (!resultado) m.fallos++;
    if (m.n >= 10) {
        console.info(`[VERIFICACION MAC] ID=${d.id} promedio=${(m.suma / m.n).toFixed(1)}ms max=${m.max}ms sinCoincidencia=${m.fallos}/${m.n}`);
        metricasMAC.delete(clave);
    } else {
        metricasMAC.set(clave, m);
    }
}

// Una unica verificacion en vuelo por PLC. Las verificaciones periodicas
// se programan fuera del ciclo industrial.
function detenerVerificacionPeriodica(d) {
    if (d.temporizadorMAC !== null) clearTimeout(d.temporizadorMAC);
    d.temporizadorMAC = null;
    d.proximaVerificacionMAC = null;
}
function invalidarIdentidad(d, motivo = "Identidad MAC no verificada") {
    pcccService.cancelarPendiente(d);
    d.revisionIdentidad++;
    d.identidadCoincide = false;
    d.conectado = false;
    d.conectando = false;
    d.calidad = "NO DISPONIBLE";
    d.error = motivo;
    d.macAusenteDesde = null;
    d.ultimaRespuesta = null;
    d.ocupado = false;
    d.inicioLectura = null;
    if (d.abortarUMAS) { d.abortarUMAS.abort(); d.abortarUMAS = null; }
    if (d.abortarSiemens) { d.abortarSiemens.abort(); d.abortarSiemens = null; }
    if (d.abortarCIP) { d.abortarCIP.abort(); d.abortarCIP = null; }
    const anterior = d.client;
    d.client = null;
    cancelarTemporizadorInicio(d);
    if (d.temporizadorReconexion !== null) clearTimeout(d.temporizadorReconexion);
    d.temporizadorReconexion = null;
    pcccService.cerrarCliente(anterior);
    reiniciarCronometros(d);

    // Las lecturas abortadas no reprograman su propio temporizador.
    // Si la interfaz fisica sigue ausente, esperar al evento de retorno.
    if (estaSupervisando() && dispositivos.includes(d) && hayInterfazPLC()) {
        programarLectura(d);
    }
}
function intervaloVerificacionMAC(d) {
    if (d.macAusenteDesde !== null) return INTERVALO_MAC_RECUPERACION_MS;
    if (esSupervisionIdentidad(d) && d.identidadCoincide) return INTERVALO_MAC_MS;
    const reciente = d.conectado && d.identidadCoincide &&
        d.ultimaRespuesta !== null &&
        Date.now() - d.ultimaRespuesta < TIEMPO_SIN_RESPUESTA_MS;
    return reciente ? INTERVALO_MAC_MS : INTERVALO_MAC_RECUPERACION_MS;
}
function programarVerificacionPeriodica(d, esperaForzada = null) {
    if (!estaSupervisando() || !dispositivos.includes(d) || !d.ip || !d.mac || !hayInterfazPLC()) return;
    const espera = esperaForzada === null ? intervaloVerificacionMAC(d) :
        Math.max(0, Number(esperaForzada) || 0);
    const proxima = Date.now() + espera;
    // Nunca posponer una comprobacion ya programada. En particular, las
    // lecturas fallidas pueden suceder mas rapido que el intervalo MAC.
    if (d.temporizadorMAC !== null && d.proximaVerificacionMAC !== null &&
        d.proximaVerificacionMAC <= proxima) return;
    detenerVerificacionPeriodica(d);
    const sesion = generacion;
    d.proximaVerificacionMAC = proxima;
    d.temporizadorMAC = setTimeout(async () => {
        d.temporizadorMAC = null;
        d.proximaVerificacionMAC = null;
        if (sesion !== generacion || !estaSupervisando() || !dispositivos.includes(d) || !hayInterfazPLC()) return;
        try {
            await verificarMAC(d);
        } catch (error) {
            console.error(`[MAC] ID=${d.id}:`, error.message);
            invalidarIdentidad(d);
        } finally {
            if (sesion === generacion && estaSupervisando() && dispositivos.includes(d)) {
                programarVerificacionPeriodica(d);
            }
        }
    }, espera);
}

async function verificarMAC(d) {
    if (!hayInterfazPLC()) return false;
    if (d.verificacionMACPendiente) return d.verificacionMACPendiente;
    const sesion = generacion;
    const revision = d.revisionIdentidad;
    const tarea = (async () => {
        if (!d.ip || !d.mac) {
            if (sesion === generacion && dispositivos.includes(d)) invalidarIdentidad(d);
            return false;
        }
        const resultado = {
            ip: d.ip, mac: d.mac, macDetectada: d.macDetectada,
            estadoVerificacionMAC: "SIN_VERIFICAR",
            identidadCoincide: false,
            ultimaVerificacionMAC: d.ultimaVerificacionMAC
        };
        const inicio = Date.now();
        await identidadService.verificarMAC(resultado, {
            estaVigente: () => sesion === generacion && estaSupervisando() &&
                dispositivos.includes(d) && revision === d.revisionIdentidad
        });
        registrarMedicionMAC(d, inicio, resultado.identidadCoincide);
        if (sesion !== generacion || !estaSupervisando() ||
            !dispositivos.includes(d) || revision !== d.revisionIdentidad) return false;
        d.macDetectada = resultado.macDetectada;
        d.ultimaVerificacionMAC = resultado.ultimaVerificacionMAC || Date.now();
        // Los mocks y versiones anteriores del servicio aun pueden devolver
        // solo el booleano; clasificar mediante los datos recibidos.
        const estadoMAC = resultado.estadoVerificacionMAC &&
            resultado.estadoVerificacionMAC !== "SIN_VERIFICAR"
                ? resultado.estadoVerificacionMAC
                : resultado.identidadCoincide ? "CONFIRMADA"
                    : /^([0-9A-F]{2}[-:]){5}[0-9A-F]{2}$/i.test(resultado.macDetectada || "")
                        ? "DIFERENTE" : "SIN_RESPUESTA";
        d.estadoVerificacionMAC = estadoMAC;

        if (resultado.identidadCoincide) {
            const recuperado = !d.identidadCoincide;
            d.identidadCoincide = true;
            d.ultimaMACConfirmada = Date.now();
            d.macAusenteDesde = null;
            if (esSupervisionIdentidad(d) && d.inicioConexion === null) {
                d.inicioConexion = Date.now();
            }
            if (recuperado && !esSupervisionIdentidad(d)) {
                d.fallosConsecutivos = 0;
                if (esSiemens(d) || esMicro850(d) || esM580(d)) {
                    programarLectura(d, 0);
                } else {
                    pcccService.conectarPLC(d);
                }
                console.info(`[RECONEXION] ID=${d.id}: MAC confirmada; reanudando supervision`);
            }
        } else if (estadoMAC === "DIFERENTE") {
            // Una MAC diferente es un fallo de identidad, no una ausencia temporal.
            invalidarIdentidad(d, "MAC diferente de la esperada; conexion bloqueada");
        } else {
            const ahora = Date.now();
            d.macAusenteDesde ??= ahora;
            const lecturaReciente = d.conectado && d.ultimaRespuesta !== null &&
                ahora - d.ultimaRespuesta < TIEMPO_SIN_RESPUESTA_MS;
            const ultimoOKReciente = d.ultimaMACConfirmada !== null &&
                ahora - d.ultimaMACConfirmada <= GRACIA_ARP_MS;
            if (!(d.identidadCoincide && lecturaReciente && ultimoOKReciente)) {
                invalidarIdentidad(d, "Identidad MAC sin verificar; esperando recuperacion");
            } else {
                // La lectura industrial sigue respondiendo y la ultima MAC
                // se confirmo recientemente. No cortar por un ARP aislado.
                d.error = null;
            }
        }
        return d.identidadCoincide;
    })();
    d.verificacionMACPendiente = tarea;
    try { return await tarea; }
    finally { if (d.verificacionMACPendiente === tarea) d.verificacionMACPendiente = null; }
}

function programarLectura(d, demora = intervaloLectura(d)) {
    if (!estaSupervisando() || !d.ip || !d.mac || !dispositivos.includes(d) || !hayInterfazPLC()) return;
    const generacionActual = generacion;
    if (d.temporizadorLectura !== null) clearTimeout(d.temporizadorLectura);
    const espera = Math.max(0, Number(demora) || 0);
    d.siguienteLecturaEn = Date.now() + espera;
    d.temporizadorLectura = setTimeout(() => {
        d.temporizadorLectura = null;
        d.siguienteLecturaEn = null;
        if (generacionActual !== generacion || !estaSupervisando()) return;
        cicloLectura(d, generacionActual).catch(error => {
            if (generacionActual !== generacion || !estaSupervisando()) return;
            d.error = error.message || String(error);
            programarLectura(d);
        });
    }, espera);
}

function programarReconexion(d) {
    if (!estaSupervisando() || !hayInterfazPLC() || esSupervisionIdentidad(d) || esMicro850(d) || esM580(d) || esSiemens(d) || !dispositivos.includes(d)) return;
    if (d.temporizadorReconexion !== null) {
        clearTimeout(d.temporizadorReconexion);
    }
    const generacionActual = generacion;
    d.temporizadorReconexion = setTimeout(() => {
        if (generacionActual !== generacion || !estaSupervisando()) return;
        d.temporizadorReconexion = null;

        if (d.conectando && d.conectadoDesde === null && d.inicioLectura === null) {
            d.conectando = false;
            const clienteAnterior = d.client;
            d.client = null;
            cancelarTemporizadorInicio(d);
            pcccService.cerrarCliente(clienteAnterior);
        }
        if (d.identidadCoincide) pcccService.conectarPLC(d);
    }, TIEMPO_RECONEXION_MS);
}

function cancelarTemporizadorInicio(d) {
    if (d.temporizadorInicio !== null) {
        clearTimeout(d.temporizadorInicio);
        d.temporizadorInicio = null;
    }
}

function reconectarPLC(d, motivo) {
    if (!estaSupervisando() || !dispositivos.includes(d)) return;
    pcccService.cancelarPendiente(d);
    // Destruir tambien sockets S7/UMAS/CIP que quedaron a medio abrir.
    // Los callbacks antiguos verifican su controlador antes de alterar estados.
    if (d.abortarUMAS) { d.abortarUMAS.abort(); d.abortarUMAS = null; }
    if (d.abortarSiemens) { d.abortarSiemens.abort(); d.abortarSiemens = null; }
    if (d.abortarCIP) { d.abortarCIP.abort(); d.abortarCIP = null; }
    const clienteAnterior = d.client;
    d.client = null;
    cancelarTemporizadorInicio(d);
    d.conectado = false;
    d.conectando = false;
    d.ocupado = false;
    d.conectadoDesde = null;
    d.inicioLectura = null;
    d.ultimaRespuesta = null;
    d.calidad = "NO DISPONIBLE";
    d.error = motivo;
    reiniciarCronometros(d);

    if (d.temporizadorLectura !== null) {
        clearTimeout(d.temporizadorLectura);
        d.temporizadorLectura = null;
    }
    d.siguienteLecturaEn = null;
    // El siguiente chequeo MAC se acelera cuando cae la sesion industrial.
    programarVerificacionPeriodica(d);
    pcccService.cerrarCliente(clienteAnterior);
    if (d.identidadCoincide) programarReconexion(d);
}

// Vigilancia independiente: repara ciclos de lectura cuyo temporizador
// se perdio y reintenta PCCC aunque no haya un nuevo flanco de perdida MAC.
// Nunca hace escrituras al PLC ni bypass a la validacion MAC.
function vigilarRecuperacion() {
    if (!estaSupervisando() || !hayInterfazPLC()) return;
    const ahora = Date.now();
    for (const d of dispositivos) {
        if (!d.ip || !d.mac || !d.identidadCoincide || esSupervisionIdentidad(d)) continue;
        if (d.conectado && d.ultimaRespuesta !== null &&
            ahora - d.ultimaRespuesta < TIEMPO_SIN_RESPUESTA_MS) continue;

        const protocoloSocket = esSiemens(d) || esMicro850(d) || esM580(d);
        if (protocoloSocket && d.ocupado && d.inicioLectura !== null &&
            ahora - d.inicioLectura > TIEMPO_MAX_INICIO_MS) {
            reconectarPLC(d, "Vigilante: lectura industrial excedio tiempo maximo");
        }

        if (protocoloSocket) {
            // No interferir con las lecturas que aun se estan ejecutando.
            if (d.ocupado) continue;
            if (d.temporizadorLectura !== null &&
                d.siguienteLecturaEn !== null &&
                ahora < d.siguienteLecturaEn + MARGEN_TEMPORIZADOR_MS) continue;
            if (d.temporizadorLectura !== null) clearTimeout(d.temporizadorLectura);
            d.temporizadorLectura = null;
            d.siguienteLecturaEn = null;
            d.reactivacionesAutomaticas++;
            d.ultimaReactivacion = ahora;
            console.info(`[VIGILANTE] ID=${d.id} ${d.tipoSupervision}: reactivando ciclo de lectura`);
            programarLectura(d, 0);
        } else {
            const lecturaAtrasada = d.temporizadorLectura === null ||
                (d.siguienteLecturaEn !== null &&
                 ahora > d.siguienteLecturaEn + MARGEN_TEMPORIZADOR_MS);
            const sinLectura = d.ultimaRespuesta === null
                ? d.conectadoDesde !== null && ahora - d.conectadoDesde > TIEMPO_MAX_INICIO_MS
                : ahora - d.ultimaRespuesta > TIEMPO_SIN_RESPUESTA_MS;
            if (d.conectado && !d.ocupado && sinLectura && lecturaAtrasada) {
                d.reactivacionesAutomaticas++;
                d.ultimaReactivacion = ahora;
                console.info(`[VIGILANTE] ID=${d.id} PCCC: reiniciando cliente sin lecturas recientes`);
                reconectarPLC(d, "Vigilante: cliente PCCC sin lectura reciente");
            } else {
                // Un intento con bandera conectando pero sin cliente, cola ni
                // temporizador de inicio es un estado huerfano.
                if (d.conectando && !d.client && !d.pcccEnCola &&
                    d.temporizadorInicio === null && d.temporizadorReconexion === null) {
                    d.conectando = false;
                }
                if (!d.conectado && !d.conectando && !d.pcccEnCola &&
                    d.temporizadorReconexion === null) {
                    d.reactivacionesAutomaticas++;
                    d.ultimaReactivacion = ahora;
                    console.info(`[VIGILANTE] ID=${d.id} PCCC: reenviando intento de conexion`);
                    pcccService.conectarPLC(d);
                }
            }
        }
    }
}
function iniciarVigilante() {
    if (temporizadorVigilante !== null) return;
    temporizadorVigilante = setInterval(vigilarRecuperacion, INTERVALO_VIGILANTE_MS);
}
function detenerVigilante() {
    if (temporizadorVigilante !== null) clearInterval(temporizadorVigilante);
    temporizadorVigilante = null;
}

function registrarConexionValida(d, instante) {
    // Cuenta reconexiones REALES, no la primera conexion al iniciar Node.js.
    if (d.numeroConexionesValidas > 0) {
        d.numeroRecuperaciones++;
        d.ultimaRecuperacion = instante;
    }
    d.numeroConexionesValidas++;
}

const pcccService = crearServicioPCCC({
    estaActivo: () => estaSupervisando() && hayInterfazPLC(),
    reconectar: reconectarPLC,
    programarLectura,
    registrarConexionValida
});

// La perdida de interfaz se confirma antes de invalidar sesiones; un PLC
// individual apagado no afecta los otros dispositivos.
const monitorRed = crearMonitorRed({
    obtenerIPs: () => dispositivos.map(d => d.ip),
    intervaloMs: INTERVALO_INTERFAZ_MS,
    alCambiar(estado, anterior) {
        if (!estaSupervisando()) return;
        if (estado === "SIN_INTERFAZ") {
            console.warn("[RED PLC] Interfaz de red ausente; esperando reconexion fisica");
            for (const d of dispositivos) {
                if (!d.ip || !d.mac) continue;
                detenerVerificacionPeriodica(d);
                d.estadoVerificacionMAC = "SIN_RESPUESTA";
                invalidarIdentidad(d, "PC sin interfaz disponible para la red de PLC");
            }
        } else if (estado === "DISPONIBLE" && anterior === "SIN_INTERFAZ") {
            console.info("[RED PLC] Interfaz restaurada; revalidando la identidad de cada PLC");
            // La cola global de identidad ya limita la concurrencia.
            // Desfasar el primer lote evita una avalancha de sockets.
            let indice = 0;
            for (const d of dispositivos) {
                if (!d.ip || !d.mac) continue;
                d.fallosConsecutivos = 0;
                programarVerificacionPeriodica(d, (indice++ % 8) * 120);
            }
        }
    }
});
function hayInterfazPLC() {
    return monitorRed.obtenerEstado().estado !== "SIN_INTERFAZ";
}

async function cicloLectura(d, generacionActual = generacion) {
    if (!estaSupervisando() || generacionActual !== generacion || !hayInterfazPLC()) return;
    const ahora = Date.now();

    if (esSupervisionIdentidad(d)) {
        d.calidad = d.identidadCoincide ? "IDENTIDAD CONFIRMADA" : "NO DISPONIBLE";
        d.error = d.identidadCoincide ? "Solo verificacion IP/MAC" : "Identidad MAC no verificada";
        programarLectura(d);
        return;
    }

    // Identidad vencida: nunca confiar en una confirmacion indefinidamente.
    if (d.identidadCoincide &&
        ahora - (d.ultimaMACConfirmada ?? d.ultimaVerificacionMAC) >
            (supervisorConfig.limites?.vigenciaMAC || INTERVALO_MAC_MS * 2)) {
        invalidarIdentidad(d, "Verificacion MAC vencida");
    }

    if (
        d.ocupado && d.inicioLectura !== null &&
        ahora - d.inicioLectura >= TIEMPO_MAX_INICIO_MS
    ) {
        if (esMicro850(d)) {
            // Abort CIP I/O; its own finally releases the lock.
            d.abortarCIP?.abort();
        } else {
            reconectarPLC(d, "Tiempo mÃ¡ximo de lectura excedido");
        }
        programarLectura(d);
        return;
    }

    if (!d.identidadCoincide) {
        d.error = "Identidad MAC no verificada";
        d.calidad = "NO DISPONIBLE";
        programarLectura(d);
        return;
    }

    if (esSiemens(d)) {
        if (d.ocupado) { programarLectura(d); return; }
        d.ocupado = true;
        d.inicioLectura = Date.now();
        d.intentosConexion++;
        const controlador = new AbortController();
        d.abortarSiemens = controlador;
        try {
            const inicioMedicion = Date.now();
            const lectura = await consultarSiemens(d.ip, { signal: controlador.signal }).then(
                valor => { registrarLatencia(d, inicioMedicion, true); return valor; },
                error => { registrarLatencia(d, inicioMedicion, false); throw error; }
            );
            if (!estaSupervisando() || generacionActual !== generacion || !dispositivos.includes(d) || d.abortarSiemens !== controlador || !d.identidadCoincide) return;
            const instante = Date.now();
            if (!d.conectado) registrarConexionValida(d, instante);
            d.fallosConsecutivos = 0;
            d.conectado = true;
            d.conectando = false;
            d.ultimaRespuesta = instante;
            d.inicioConexion ??= instante;
            d.modoOperacion = lectura.estado;
            d.codigoModo = lectura.codigoModo;
            d.estadoFalla = null; // RUN/STOP NO indica LED ERROR
            d.inicioFalla = null;
            d.calidad = lectura.estado === "NO DETERMINADO" ? "NO DETERMINADO" : "OK";
            d.error = lectura.estado === "NO DETERMINADO" ? "Codigo S7 no reconocido" : null;
        } catch (error) {
            if (!estaSupervisando() || generacionActual !== generacion || !dispositivos.includes(d) || d.abortarSiemens !== controlador || !d.identidadCoincide) return;
            d.conectado = false;
            d.conectando = false;
            d.fallosConsecutivos++;
            d.ultimaRespuesta = null;
            d.calidad = "NO DISPONIBLE";
            d.error = error.message || String(error);
            reiniciarCronometros(d);
            programarVerificacionPeriodica(d);
        } finally {
            if (d.abortarSiemens === controlador) {
                d.abortarSiemens = null;
                d.ocupado = false;
                d.inicioLectura = null;
                if (estaSupervisando() && generacionActual === generacion && dispositivos.includes(d)) programarLectura(d);
            }
        }
        return;
    }

    if (esM580(d)) {
        if (d.ocupado) { programarLectura(d); return; }
        d.ocupado = true;
        d.inicioLectura = Date.now();
        d.intentosConexion++;
        const controlador = new AbortController();
        d.abortarUMAS = controlador;
        try {
            const inicioMedicion = Date.now();
            const lectura = await consultarM580(d.ip, { signal: controlador.signal }).then(
                valor => { registrarLatencia(d, inicioMedicion, true); return valor; },
                error => { registrarLatencia(d, inicioMedicion, false); throw error; }
            );
            if (!estaSupervisando() || generacionActual !== generacion || !dispositivos.includes(d) || d.abortarUMAS !== controlador || !d.identidadCoincide) return;
            const instante = Date.now();
            if (!d.conectado) registrarConexionValida(d, instante);
            d.fallosConsecutivos = 0;
            d.conectado = true;
            d.conectando = false;
            d.ultimaRespuesta = instante;
            d.inicioConexion ??= instante;
            d.modoOperacion = lectura.estado;
            d.codigoModo = lectura.codigoModo;
            d.estadoFalla = lectura.estadoFalla;
            d.inicioFalla = lectura.estadoFalla === true ? (d.inicioFalla ?? instante) : null;
            d.calidad = lectura.estado === "NO DETERMINADO" ? "NO DETERMINADO" : "OK";
            d.error = lectura.estado === "NO DETERMINADO" ? "Patron UMAS no reconocido" : null;
        } catch (error) {
            if (!estaSupervisando() || generacionActual !== generacion || !dispositivos.includes(d) || d.abortarUMAS !== controlador || !d.identidadCoincide) return;
            d.conectado = false;
            d.conectando = false;
            d.fallosConsecutivos++;
            d.ultimaRespuesta = null;
            d.calidad = "NO DISPONIBLE";
            d.error = error.message || String(error);
            reiniciarCronometros(d);
            programarVerificacionPeriodica(d);
        } finally {
            if (d.abortarUMAS === controlador) {
                d.abortarUMAS = null;
                d.ocupado = false;
                d.inicioLectura = null;
                if (estaSupervisando() && generacionActual === generacion && dispositivos.includes(d)) programarLectura(d);
            }
        }
        return;
    }

    if (esMicro850(d)) {
        // Cada dispositivo consulta CIP por separado, sin abrir conexiones PCCC.
        if (d.ocupado) {
            programarLectura(d);
            return;
        }
        d.ocupado = true;
        d.inicioLectura = Date.now();
        const revisionLectura = d.revisionIdentidad;
        const controlador = new AbortController();
        d.abortarCIP = controlador;
        try {
            const inicioMedicion = Date.now();
            const lectura = await consultarMicro850(d.ip, { signal: controlador.signal }).then(
                valor => { registrarLatencia(d, inicioMedicion, true); return valor; },
                error => { registrarLatencia(d, inicioMedicion, false); throw error; }
            );
            if (!estaSupervisando() || generacionActual !== generacion || !dispositivos.includes(d) || !d.identidadCoincide || revisionLectura !== d.revisionIdentidad || d.abortarCIP !== controlador) return;
            const instante = Date.now();
            if (!d.conectado) registrarConexionValida(d, instante);
            d.fallosConsecutivos = 0;
            d.conectado = true;
            d.conectando = false;
            d.ultimaRespuesta = instante;
            d.inicioConexion ??= instante;
            d.modoOperacion = lectura.estado;
            d.cipStatus = lectura.status;
            d.cipState = lectura.state;
            d.estadoFalla = lectura.fallas.length > 0;
            d.inicioFalla = d.estadoFalla ? (d.inicioFalla ?? instante) : null;
            d.calidad = "OK";
            d.error = null;
        } catch (error) {
            if (!estaSupervisando() || generacionActual !== generacion || !dispositivos.includes(d) || !d.identidadCoincide || revisionLectura !== d.revisionIdentidad || d.abortarCIP !== controlador) return;
            d.conectado = false;
            d.fallosConsecutivos++;
            d.ultimaRespuesta = null;
            d.calidad = "NO DISPONIBLE";
            d.error = error.message || String(error);
            reiniciarCronometros(d);
            programarVerificacionPeriodica(d);
        } finally {
            // Old CIP reads must never release a newer read's lock.
            if (d.abortarCIP === controlador) {
                d.abortarCIP = null;
                d.ocupado = false;
                d.inicioLectura = null;
                if (estaSupervisando() && generacionActual === generacion && dispositivos.includes(d)) programarLectura(d);
            }
        }
        return;
    }

    if (!d.conectado && !d.conectando) {
        pcccService.conectarPLC(d);
        programarLectura(d);
        return;
    }

    if (d.conectando) {
        programarLectura(d);
        return;
    }

    if (
        d.conectado && d.ultimaRespuesta === null &&
        d.conectadoDesde !== null &&
        ahora - d.conectadoDesde >= TIEMPO_MAX_INICIO_MS
    ) {
        reconectarPLC(d, "No se recibiÃ³ una lectura vÃ¡lida inicial");
        programarLectura(d);
        return;
    }

    if (
        d.ultimaRespuesta !== null &&
        ahora - d.ultimaRespuesta >= TIEMPO_SIN_RESPUESTA_MS
    ) {
        reconectarPLC(d, "Tiempo sin respuesta del PLC excedido");
        programarLectura(d);
        return;
    }

    if (d.client && d.conectado) pcccService.leerPLC(d, d.client);
    programarLectura(d);
}

async function iniciarPlataforma() {
    if (estaSupervisando()) {
        if (inicioPendiente) await inicioPendiente;
        return;
    }

    await sincronizarInventario();
    cerrando = false;
    supervisando = true;
    const generacionActual = ++generacion;
    console.log("Iniciando supervisiÃ³n de PLC...");
    iniciarVigilante();
    monitorRed.iniciar();

    const tarea = (async () => {
        // Se activa cada PLC cuando termina SU verificacion, sin que los
        // primeros deban esperar a que terminen las verificaciones de los 111.
        await Promise.all(dispositivos.map(d => activarDispositivo(d)));
        if (!estaSupervisando() || generacionActual !== generacion) return;
        horometroService.iniciar(obtenerEstado);
        console.log("SupervisiÃ³n iniciada.");
    })();

    inicioPendiente = tarea;
    try {
        await tarea;
    } catch (error) {
        if (generacionActual === generacion) detenerPlataforma();
        throw error;
    } finally {
        if (inicioPendiente === tarea) inicioPendiente = null;
    }
}

function detenerPlataforma() {
    detenerVigilante();
    monitorRed.detener();
    horometroService.detener();
    cerrando = true;
    supervisando = false;
    ++generacion;

    for (const d of dispositivos) {
        cancelarDispositivo(d);
        d.identidadCoincide = false;

        d.conectado = false;
        d.conectando = false;
        d.ocupado = false;
        d.conectadoDesde = null;
        d.inicioLectura = null;
        d.ultimaRespuesta = null;
        d.calidad = "NO DISPONIBLE";
        d.error = "SupervisiÃ³n detenida";
        reiniciarCronometros(d);
    }
    console.log("SupervisiÃ³n detenida.");
}

function obtenerEstado() {
    const ahora = Date.now();
    return dispositivos.map(d => {
        const activa = estaSupervisando() && (
            esSupervisionIdentidad(d)
                ? d.identidadCoincide
                : d.conectado && d.identidadCoincide &&
                  d.ultimaRespuesta !== null &&
                  ahora - d.ultimaRespuesta < TIEMPO_SIN_RESPUESTA_MS
        );

        let comunicacion;
        if (esSupervisionIdentidad(d)) {
            comunicacion = activa ? "CONECTADO" : "DESCONECTADO";
        } else if (activa) {
            comunicacion = "CONECTADO";
        } else if (d.conectando && estaSupervisando()) {
            comunicacion = "CONECTANDO";
        } else if (d.conectado && estaSupervisando()) {
            comunicacion = "SIN LECTURA VALIDA";
        } else {
            comunicacion = "DESCONECTADO";
        }

        let falla = (esSupervisionIdentidad(d) || esSiemens(d)) ? "NO MONITOREADA" : "NO DETERMINADO";
        if (!esSupervisionIdentidad(d) && !esSiemens(d) && activa) {
            if (d.estadoFalla === true) falla = "EN FALLA";
            else if (d.estadoFalla === false) falla = "NO EN FALLA";
        }

        return {
            id: d.id,
            modelo: d.modelo,
            marca: d.marca,
            tipoSupervision: d.tipoSupervision,
            ip: d.ip,
            intentosConexion: d.intentosConexion,
            reactivacionesAutomaticas: d.reactivacionesAutomaticas,
            ultimaReactivacion: d.ultimaReactivacion,
            estadoRedPC: monitorRed.obtenerEstado().estado,
            estadoVerificacionMAC: d.estadoVerificacionMAC,
            ultimaMACConfirmada: d.ultimaMACConfirmada,
            fallosConsecutivos: d.fallosConsecutivos,
            numeroConexionesValidas: d.numeroConexionesValidas,
            numeroRecuperaciones: d.numeroRecuperaciones,
            ultimaRecuperacion: d.ultimaRecuperacion,
            ultimaVerificacionMAC: d.ultimaVerificacionMAC,
            macEsperada: d.mac,
            macDetectada: d.macDetectada,
            identidadCoincide: d.identidadCoincide,
            comunicacion,
            falla,
            estadoFalla: activa ? d.estadoFalla : null,
            calidad: activa ? d.calidad : "NO DISPONIBLE",
            modoOperacion: activa ? d.modoOperacion : "DESCONOCIDO",
            codigoModo: activa ? d.codigoModo : null,
            palabraS1: activa ? d.palabraS1 : null,
            cipStatus: activa ? d.cipStatus : null,
            cipState: activa ? d.cipState : null,
            error: d.error,
            ultimaRespuesta: d.ultimaRespuesta,
            tiempoConexion: activa && d.inicioConexion !== null
                ? duracion(ahora - d.inicioConexion) : duracion(0),
            tiempoFalla: activa && d.estadoFalla === true && d.inicioFalla !== null
                ? duracion(ahora - d.inicioFalla) : duracion(0)
        };
    });
}

module.exports = {
    iniciarPlataforma,
    detenerPlataforma,
    obtenerEstado,
    estaSupervisando,
    sincronizarInventario,
    iniciarSincronizacionInventario,
    detenerSincronizacionInventario
};

