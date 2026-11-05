"use strict";

const NodePCCC = require("nodepccc");
const supervisorConfig = require("../config/supervisorConfig");

const PUERTO_PLC = supervisorConfig.pccc.puerto;
const DIRECCION_FALLA = supervisorConfig.pccc.direccionFalla;
const TIEMPO_MAX_INICIO_MS = supervisorConfig.tiempos.maximoInicio;
const MAXIMO_CONEXIONES = Math.max(1,
    Number(supervisorConfig.limites?.conexionesPCCCConcurrentes) || 4);
const ESPACIADO_MS = Math.max(0,
    Number(supervisorConfig.limites?.separacionConexionesPCCC) || 150);

// El coordinador proporciona las funciones para gestionar reconexiones,
// temporizadores y el estado general de la plataforma.
function crearServicioPCCC({ estaActivo, reconectar, programarLectura, registrarConexionValida = () => {} }) {
    // La cola evita abrir decenas de sesiones EtherNet/IP en el mismo instante.
    // Solo limita el establecimiento, no las lecturas de conexiones activas.
    const pendientes = [];
    const estableciendo = new Set();
    let despacho = null;

    function despachar() {
        if (despacho !== null || pendientes.length === 0 ||
            estableciendo.size >= MAXIMO_CONEXIONES) return;
        despacho = setTimeout(() => {
            despacho = null;
            if (estableciendo.size >= MAXIMO_CONEXIONES) return;
            while (pendientes.length > 0) {
                const d = pendientes.shift();
                if (!d.pcccEnCola) continue;
                d.pcccEnCola = false;
                if (!estaActivo() || !d.conectando || d.conectado ||
                    !d.identidadCoincide || d.temporizadorReconexion !== null) {
                    // Ya fue cancelado, reemplazado o esta sin identidad.
                    if (!d.client) d.conectando = false;
                    continue;
                }
                abrirConexion(d);
                break;
            }
            despachar();
        }, ESPACIADO_MS);
    }

    function liberarEstablecimiento(cliente) {
        if (estableciendo.delete(cliente)) despachar();
    }

    function cancelarPendiente(d) {
        d.pcccEnCola = false;
        // Evitar que una cola de verificaciones fallidas retenga referencias.
        const indice = pendientes.indexOf(d);
        if (indice !== -1) pendientes.splice(indice, 1);
    }

    // Diferir el cierre de un cliente con lectura pendiente hasta su callback.
    // Cierre de respaldo tras 1000 ms si la libreria no llama al callback.
    const lecturasPendientes = new WeakSet();
    const cierresPendientes = new WeakMap();
    function cerrarCliente(cliente) {
        if (!cliente || cierresPendientes.has(cliente)) return;
        // Un timeout o una invalidacion tambien libera la plaza de conexion.
        liberarEstablecimiento(cliente);
        const cerrar = () => {
            const pendiente = cierresPendientes.get(cliente);
            if (pendiente) {
                clearTimeout(pendiente.temporizador);
                cierresPendientes.delete(cliente);
            }
            try { cliente.dropConnection(); }
            catch (error) {
                console.warn("[PCCC] Error al cerrar cliente:", error.message || String(error));
            }
        };
        if (!lecturasPendientes.has(cliente)) {
            cerrar();
            return;
        }
        const temporizador = setTimeout(cerrar, 1000);
        cierresPendientes.set(cliente, { cerrar, temporizador });
    }
    function finalizarLectura(cliente) {
        lecturasPendientes.delete(cliente);
        const pendiente = cierresPendientes.get(cliente);
        if (pendiente) pendiente.cerrar();
    }

    // Diagnostico de lecturas PCCC: no modifica estados ni reconexiones.
    const metricas = new Map();
    function medirLectura(d, inicio, exito) {
        const clave = d.id;
        const m = metricas.get(clave) || { cantidad: 0, total: 0, maximo: 0, fallos: 0 };
        const duracion = Date.now() - inicio;
        m.cantidad++;
        m.total += duracion;
        m.maximo = Math.max(m.maximo, duracion);
        if (!exito) m.fallos++;
        if (m.cantidad >= 30) {
            console.info(`[LECTURA PLC] ID=${d.id} PCCC promedio=${(m.total / m.cantidad).toFixed(1)}ms max=${m.maximo}ms fallos=${m.fallos}/${m.cantidad}`);
            metricas.delete(clave);
        } else {
            metricas.set(clave, m);
        }
    }

    function leerPLC(d, cliente) {
        if (!estaActivo() || !cliente || d.client !== cliente || d.ocupado) {
            return;
        }

        d.ocupado = true;
        d.inicioLectura = Date.now();

        const inicioMedicion = Date.now();
        lecturasPendientes.add(cliente);
        try {
            cliente.readAllItems((error, valores) => {
                finalizarLectura(cliente);
                if (d.client !== cliente) return;

                const itemMedicion = cliente.findItem("ESTADO_ERROR");
                const itemModoMedicion = cliente.findItem("PALABRA_MODO");
                const lecturaValida = !error &&
                    itemMedicion?.quality === "OK" &&
                    typeof valores?.ESTADO_ERROR === "boolean" &&
                    itemModoMedicion?.quality === "OK" &&
                    typeof valores?.PALABRA_MODO === "number" &&
                    Number.isFinite(valores.PALABRA_MODO);
                medirLectura(d, inicioMedicion, lecturaValida);

                d.ocupado = false;
                d.inicioLectura = null;
                if (!estaActivo()) return;

                const item = cliente.findItem("ESTADO_ERROR");
                const valor = valores?.ESTADO_ERROR;
                const itemModo = cliente.findItem("PALABRA_MODO");
                const valorModo = valores?.PALABRA_MODO;

                if (
                    error || !item || item.quality !== "OK" ||
                    typeof valor !== "boolean" ||
                    !itemModo || itemModo.quality !== "OK" ||
                    typeof valorModo !== "number" || !Number.isFinite(valorModo)
                ) {
                    const detalle = error
                        ? error.message || String(error)
                        : "Lectura inválida o calidad de dato incorrecta";
                    reconectar(d, detalle);
                    return;
                }

                const ahora = Date.now();
                // Un nuevo cliente solo se considera recuperado cuando logra
                // su primera lectura PCCC con calidad y valores validos.
                if (d.ultimaRespuesta === null) registrarConexionValida(d, ahora);
                d.ultimaRespuesta = ahora;
                d.inicioConexion ??= ahora;
                d.estadoFalla = valor;
                d.palabraS1 = valorModo & 0xFFFF;
                d.codigoModo = d.palabraS1 & 0x001F;
                d.modoOperacion = ({0:"REMOTE DOWNLOAD",1:"PROGRAM",3:"SUSPEND IDLE",6:"RUN",7:"REMOTE TEST CONTINUOUS",8:"REMOTE TEST SINGLE SCAN"})[d.codigoModo] || "DESCONOCIDO";
                d.calidad = item.quality;
                d.error = null;
                d.inicioFalla = valor ? (d.inicioFalla ?? ahora) : null;
            });
        } catch (error) {
            finalizarLectura(cliente);
            medirLectura(d, inicioMedicion, false);
            d.ocupado = false;
            d.inicioLectura = null;
            reconectar(d, error.message || String(error));
        }
    }

    function conectarPLC(d) {
        if (!estaActivo() || d.conectando || d.conectado || d.pcccEnCola ||
            d.temporizadorReconexion !== null) return;
        if (!d.identidadCoincide) {
            d.error = "Identidad MAC no verificada";
            d.calidad = "NO DISPONIBLE";
            return;
        }
        d.conectando = true;
        d.pcccEnCola = true;
        pendientes.push(d);
        despachar();
    }

    function abrirConexion(d) {
        d.intentosConexion++;
        let cliente;
        try {
            cliente = new NodePCCC();
        } catch (error) {
            d.conectando = false;
            reconectar(d, error.message || String(error));
            return;
        }
        d.client = cliente;
        estableciendo.add(cliente);

        const temporizadorInicio = setTimeout(() => {
            if (d.temporizadorInicio === temporizadorInicio) {
                d.temporizadorInicio = null;
            }
            if (d.client === cliente && d.conectando && estaActivo()) {
                reconectar(d, "Tiempo máximo de establecimiento de conexión excedido");
            }
        }, TIEMPO_MAX_INICIO_MS);
        d.temporizadorInicio = temporizadorInicio;

        try {
            cliente.initiateConnection({ host: d.ip, port: PUERTO_PLC }, error => {
                liberarEstablecimiento(cliente);
                clearTimeout(temporizadorInicio);
                if (d.temporizadorInicio === temporizadorInicio) {
                    d.temporizadorInicio = null;
                }
                if (d.client !== cliente) return;
                if (!estaActivo()) {
                    d.conectando = false;
                    return;
                }

                d.conectando = false;
                if (error) {
                    reconectar(d, error.message || String(error));
                    return;
                }

                d.conectado = true;
                d.conectadoDesde = Date.now();
                d.ultimaRespuesta = null;

                try {
                    cliente.setTranslationCB(nombre =>
                        nombre === "ESTADO_ERROR" ? DIRECCION_FALLA :
                        nombre === "PALABRA_MODO" ? "S:1" : undefined
                    );
                    cliente.addItems(["ESTADO_ERROR", "PALABRA_MODO"]);
                } catch (errorConfiguracion) {
                    reconectar(d, errorConfiguracion.message || String(errorConfiguracion));
                    return;
                }

                d.error = "Esperando primera lectura válida";
                d.calidad = "NO DISPONIBLE";
                programarLectura(d, 0);
            });
        } catch (error) {
            clearTimeout(temporizadorInicio);
            if (d.temporizadorInicio === temporizadorInicio) {
                d.temporizadorInicio = null;
            }
            reconectar(d, error.message || String(error));
        }
    }

    return { leerPLC, conectarPLC, cerrarCliente, cancelarPendiente };
}

module.exports = { crearServicioPCCC };
