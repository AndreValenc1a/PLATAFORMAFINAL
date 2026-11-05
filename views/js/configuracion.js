"use strict";

// ==================================================
// CONFIGURACION DE LA INTERFAZ
// ==================================================

const CONFIGURACION = Object.freeze({
piePagina: {
    titulo: "Nota de operación:",
    descripcion: "Plataforma de supervisión industrial de solo lectura, desarrollada con Node.js y comunicación HTTP.",
    diagnostico: "Los diagnósticos internos se muestran únicamente en los equipos que permiten su lectura.",
    funcionamiento: "La plataforma inicia la supervisión automáticamente y permite visualizar el estado de comunicación de los equipos."
},
    aplicacion: {
        
        titulo: "INDUSTRIAL MONITOR",
        subtitulo: "SUPERVISIÓN DE ACTIVOS INDUSTRIALES",
        intervaloActualizacion: 500
    },

secciones: {
    tituloResumen: "Panel general de supervisión",
    tituloDispositivos: "Dispositivos supervisados",
    descripcionRed: "Red Ethernet industrial · Puerto 44818"
},

mensajes: {
    detenido: "MONITOR DETENIDO",
    activo: "SUPERVISIÓN ACTIVA",
    iniciando: "INICIANDO SUPERVISIÓN",
    errorLectura: "ERROR DE LECTURA",
    errorInicio: "ERROR AL INICIAR",
    errorDetencion: "ERROR AL DETENER"
},
    etiquetas: {
        direccionIP: "Dirección IP",
        identidad: "Identidad IP/MAC",
        direccionMAC: "Dirección MAC detectada",
        fallaMicroLogix: "Estado de falla S:1/13",
        fallaGeneral: "Diagnóstico interno del PLC",
        tiempoConexion: "Tiempo conectado",
        tiempoFalla: "Tiempo en falla",
        ultimaRespuesta: "Última respuesta"
    },

    resumen: {
        total: "PLC REGISTRADOS",
        conectados: "CONECTADOS",
        fallas: "EN FALLA",
        actualizacion: "ÚLTIMA ACTUALIZACIÓN"
    },

    colores: {
        conectado: "var(--verde)",
        desconectado: "var(--rojo)",
        advertencia: "var(--amarillo)",
        informacion: "var(--azul)"
    },

    estados: {
        conectado: "CONECTADO",
        desconectado: "DESCONECTADO",
        enFalla: "EN FALLA",
        sinFalla: "NO EN FALLA",
        noMonitoreado: "NO MONITOREADO",
        sinDatos: "SIN DATOS",
        sinVerificar: "Sin verificar",
        sinDetectar: "Sin detectar"
    },

    diagnosticos: {
    perfiles: {
        PCCC: {
            lecturaFalla: true,
            etiqueta: "Estado de falla S:1/13"
        },

        CIP_MICRO850: {
            lecturaFalla: true,
            etiqueta: "Diagnóstico interno del PLC"
        },

        S7_SIEMENS: {
            lecturaFalla: false,
            etiqueta: "LED ERROR: NO MONITOREADO"
        },

        UMAS_M580: {
            lecturaFalla: true,
            etiqueta: "Diagnóstico UMAS del PLC"
        },

        IDENTIDAD: {
            lecturaFalla: false,
            etiqueta: "Diagnóstico interno del PLC"
        }
    }
}

});

// Disponible para los demás archivos JavaScript
window.CONFIGURACION = CONFIGURACION;
