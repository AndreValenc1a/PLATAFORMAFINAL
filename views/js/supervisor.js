"use strict";

// ==================================================
// SUPERVISOR DE LA INTERFAZ
// ==================================================

const INTERFAZ = {

    inventarioRenderizado: "",
    solicitandoEstado: false,
    operacionEnCurso: false,
    versionEstado: 0,
    medicionesHTTP: { cantidad: 0, sumaMs: 0, maximoMs: 0 },
    temporizador: null,
    ultimaRecepcionHTTP: null,
    avisoDatos: null,
    monitorVigencia: null,
    diagnosticoVisibilidad: {
        visible: { cantidad: 0, suma: 0, max: 0 },
        oculto: { cantidad: 0, suma: 0, max: 0 },
        ultimaMarca: null,
        ultimaVisible: null
    },
    diagnosticoFase4: {
        cantidad: 0, sumaRender: 0, maxRender: 0,
        sumaIntervalo: 0, maxIntervalo: 0, intervalos: 0,
        sumaAntiguedad: 0, maxAntiguedad: 0, muestrasAntiguedad: 0,
        ultimaActualizacion: null
    },

    elementos: {
        lista: document.getElementById("lista-plc"),
        estado: document.getElementById("estado-sistema"),
        total: document.getElementById("total-plc"),
        conectados: document.getElementById("plc-conectados"),
        fallas: document.getElementById("plc-falla"),
        actualizacion: document.getElementById("ultima-actualizacion")
    },

    obtenerColor(estado) {
        const colores = CONFIGURACION.colores;

        if (estado === CONFIGURACION.estados.conectado) {
            return colores.conectado;
        }

        if (estado === CONFIGURACION.estados.desconectado) {
            return colores.desconectado;
        }

        return colores.advertencia;
    },

    mostrarEstado(texto, color) {
        this.elementos.estado.textContent = `● ${texto}`;
        this.elementos.estado.style.color = color;
    },

    // ==================================================
// ACTUALIZACION DINAMICA DEL INVENTARIO
// ==================================================

actualizarInventario(datos) {
    const firma = JSON.stringify(
        datos.map(equipo => ({
            id: equipo.id,
            modelo: equipo.modelo,
            marca: equipo.marca,
            ip: equipo.ip,
            tipoSupervision: equipo.tipoSupervision
        }))
    );

    if (firma === this.inventarioRenderizado) {
        return;
    }

    COMPONENTES.renderizarTarjetas(
        datos,
        this.elementos.lista
    );

    this.inventarioRenderizado = firma;
},
actualizarModelos(datos) {
    const cantidades = {};

    datos.forEach(equipo => {
        const modelo = equipo.modelo || "DESCONOCIDO";

        cantidades[modelo] = (cantidades[modelo] || 0) + 1;
    });

    const resumen = Object.entries(cantidades)
        .map(([modelo, cantidad]) => `${cantidad} ${modelo}`)
        .join(" · ");

    document.getElementById("resumen-modelos").textContent =
        resumen || "Sin equipos registrados";
},

    // Esta nota se actualiza junto con las lecturas; evita mensajes iniciales obsoletos.
    actualizarNotaResumen(mensaje, estado) {
        const tarjeta = this.elementos.actualizacion?.closest(".resumen-card");
        if (!tarjeta) return;
        const nota = tarjeta.querySelector(".resumen-nota");
        if (nota) nota.textContent = mensaje;
        tarjeta.dataset.frescura = estado;
    },

    actualizarResumen(datos) {
        this.elementos.total.textContent = datos.length;

        this.elementos.conectados.textContent = datos.filter(
            equipo => equipo.comunicacion === CONFIGURACION.estados.conectado
        ).length;

        this.elementos.fallas.textContent = datos.filter(
            equipo => equipo.comunicacion === CONFIGURACION.estados.conectado &&
                equipo.estadoFalla === true &&
                COMPONENTES.obtenerDiagnostico(equipo).lecturaFalla
        ).length;

        this.elementos.actualizacion.textContent =
            new Date().toLocaleTimeString("es-EC", { timeZone: "America/Guayaquil" });
        this.actualizarNotaResumen("Datos recibidos correctamente", "ok");
    },

    actualizarEquipo(equipo) {
        const id = equipo.id;

        const obtener = prefijo =>
            document.getElementById(`${prefijo}-${id}`);

        const comunicacion = obtener("comunicacion");
        if (!comunicacion) return;

        const punto = obtener("punto");
        const identidad = obtener("identidad");
        const mac = obtener("mac");
        const falla = obtener("falla");
        const conexion = obtener("conexion");
        const tiempoFalla = obtener("tiempo-falla");
        const respuesta = obtener("respuesta");

        comunicacion.textContent =
            equipo.comunicacion || CONFIGURACION.estados.sinDatos;

        const color = this.obtenerColor(equipo.comunicacion);
        comunicacion.style.color = color;
        punto.style.background = color;

        mac.textContent =
            equipo.macDetectada || CONFIGURACION.estados.sinDetectar;

        const colorIdentidad =
            equipo.identidadCoincide === true
                ? CONFIGURACION.colores.conectado
                : equipo.identidadCoincide === false
                    ? CONFIGURACION.colores.desconectado
                    : CONFIGURACION.colores.advertencia;

identidad.textContent =
    equipo.macDetectada === "No verificada"
        ? CONFIGURACION.estados.sinVerificar
        : equipo.macDetectada === "No encontrada" ||
          equipo.macDetectada === "No disponible"
            ? "No disponible"
            : equipo.identidadCoincide === true
                ? "Verificada"
                : "No coincide";

        const diagnostico = COMPONENTES.obtenerDiagnostico(equipo);

        if (!diagnostico.lecturaFalla) {
            falla.textContent = CONFIGURACION.estados.noMonitoreado;
            falla.style.color = CONFIGURACION.colores.advertencia;
        } else {
            falla.textContent = equipo.falla || "Sin lectura";

            falla.style.color =
                equipo.falla === CONFIGURACION.estados.enFalla
                    ? CONFIGURACION.colores.desconectado
                    : equipo.falla === CONFIGURACION.estados.sinFalla
                        ? CONFIGURACION.colores.conectado
                        : CONFIGURACION.colores.advertencia;
        }

        // Modo operativo: PCCC, CIP Micro850 y UMAS M580.
        const modoElemento = obtener("modo-operacion");
        if (modoElemento) {
            const permiteModo = ["PCCC", "CIP_MICRO850", "UMAS_M580", "S7_SIEMENS"].includes(equipo.tipoSupervision);
            const modoValido = permiteModo && equipo.comunicacion === "CONECTADO" &&
                ["RUN", "PROGRAM", "STOP", "ERROR"].includes(String(equipo.modoOperacion || "").toUpperCase());
            const modo = modoValido ? String(equipo.modoOperacion).toUpperCase() :
                permiteModo ? "DESCONOCIDO" : "NO MONITOREADO";
            modoElemento.textContent = modo;
            modoElemento.dataset.modo = modo;
        }

        conexion.textContent = equipo.tiempoConexion || "00:00:00";
        tiempoFalla.textContent = equipo.tiempoFalla || "00:00:00";

        respuesta.textContent = equipo.ultimaRespuesta
            ? new Date(equipo.ultimaRespuesta).toLocaleTimeString("es-EC")
            : CONFIGURACION.estados.sinDatos;
    },

async solicitar(ruta, metodo = "GET") {
    const controlador = new AbortController();
    const tiempoMaximo = 5000;

    const temporizador = setTimeout(() => {
        controlador.abort();
    }, tiempoMaximo);

    try {
        const respuesta = await fetch(ruta, {
            method: metodo,
            signal: controlador.signal,
            cache: "no-store"
        });

        if (!respuesta.ok) {
            throw new Error(`Error HTTP ${respuesta.status}`);
        }

        return await respuesta.json();

    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error(
                "Tiempo máximo de respuesta del servidor excedido"
            );
        }

        throw error;

    } finally {
        clearTimeout(temporizador);
    }
},

  async consultarEstado() {
    if (this.solicitandoEstado || this.operacionEnCurso) return;

    this.solicitandoEstado = true;

    // Guardar la versión correspondiente a esta consulta
    const versionConsulta = this.versionEstado;

    try {
        const inicioConsulta = performance.now();
        const resultado = await this.solicitar("/api/supervisor");
        const duracionMs = performance.now() - inicioConsulta;
        const metricas = this.medicionesHTTP;
        metricas.cantidad++;
        metricas.sumaMs += duracionMs;
        metricas.maximoMs = Math.max(metricas.maximoMs, duracionMs);
        if (metricas.cantidad % 30 === 0) {
            console.info(
                `[Rendimiento HTTP] 30 consultas: promedio ${(metricas.sumaMs / metricas.cantidad).toFixed(1)} ms, máximo ${metricas.maximoMs.toFixed(1)} ms`
            );
            metricas.cantidad = 0;
            metricas.sumaMs = 0;
            metricas.maximoMs = 0;
        }
          if (
    !resultado ||
    !Array.isArray(resultado.plc) ||
    !["ACTIVO", "DETENIDO"].includes(resultado.estado)
) {
    throw new Error("Respuesta inválida del supervisor");
}
 // Evitar aplicar una respuesta antigua durante una operación
if (
    this.operacionEnCurso ||
    versionConsulta !== this.versionEstado
) {
    return;
}

const inicioRender = performance.now();
const relojActual = Date.now();
const diagnostico = this.diagnosticoFase4;
if (diagnostico.ultimaActualizacion !== null) {
    const intervalo = inicioRender - diagnostico.ultimaActualizacion;
    diagnostico.sumaIntervalo += intervalo;
    diagnostico.maxIntervalo = Math.max(diagnostico.maxIntervalo, intervalo);
    diagnostico.intervalos++;
}
diagnostico.ultimaActualizacion = inicioRender;
for (const equipo of resultado.plc) {
    if (!equipo.ultimaRespuesta) continue;
    const valor = equipo.ultimaRespuesta;
    const marca = typeof valor === "number" ? valor :
        /^\d{13}$/.test(String(valor)) ? Number(valor) : Date.parse(valor);
    if (!Number.isFinite(marca)) continue;
    const antiguedad = relojActual - marca;
    if (antiguedad < 0 || antiguedad > 86400000) continue;
    diagnostico.sumaAntiguedad += antiguedad;
    diagnostico.maxAntiguedad = Math.max(diagnostico.maxAntiguedad, antiguedad);
    diagnostico.muestrasAntiguedad++;
}

this.ultimaRecepcionHTTP = Date.now();
this.revisarVigencia();
this.actualizarInventario(resultado.plc);
this.actualizarModelos(resultado.plc);
this.actualizarResumen(resultado.plc);

            resultado.plc.forEach(equipo => this.actualizarEquipo(equipo));

            const activo = resultado.estado === "ACTIVO";

            this.mostrarEstado(
                activo ? CONFIGURACION.mensajes.activo : CONFIGURACION.mensajes.detenido,
                activo
                    ? CONFIGURACION.colores.conectado
                    : CONFIGURACION.colores.advertencia
            );

            const renderMs = performance.now() - inicioRender;
            diagnostico.cantidad++;
            diagnostico.sumaRender += renderMs;
            diagnostico.maxRender = Math.max(diagnostico.maxRender, renderMs);
            if (diagnostico.cantidad >= 30) {
                const prom = (suma, cantidad) => cantidad ? (suma / cantidad).toFixed(1) : "N/D";
                console.info(
                    `[FASE 4] 30 actualizaciones: render promedio=${prom(diagnostico.sumaRender, diagnostico.cantidad)}ms ` +
                    `max=${diagnostico.maxRender.toFixed(1)}ms | ` +
                    `intervalo real promedio=${prom(diagnostico.sumaIntervalo, diagnostico.intervalos)}ms ` +
                    `max=${diagnostico.maxIntervalo.toFixed(1)}ms | ` +
                    `antiguedad PLC promedio=${prom(diagnostico.sumaAntiguedad, diagnostico.muestrasAntiguedad)}ms ` +
                    `max=${diagnostico.maxAntiguedad.toFixed(1)}ms`
                );
                Object.assign(diagnostico, {
                    cantidad: 0, sumaRender: 0, maxRender: 0,
                    sumaIntervalo: 0, maxIntervalo: 0, intervalos: 0,
                    sumaAntiguedad: 0, maxAntiguedad: 0, muestrasAntiguedad: 0
                });
            }

                } catch (error) {
            console.error("Error de supervisión:", error);
            // Ignorar errores de consultas anteriores
    if (
        this.operacionEnCurso ||
        versionConsulta !== this.versionEstado
    ) {
        return;
    }

// Evitar mostrar modos antiguos si se pierde la conexión HTTP.
this.elementos.lista.querySelectorAll('[id^="modo-operacion-"]').forEach(elemento => {
    elemento.textContent = "SIN DATOS ACTUALES";
    elemento.dataset.modo = "NO DISPONIBLE";
});

// Marcar las lecturas de falla como desactualizadas
this.elementos.lista
    .querySelectorAll('[id^="falla-"]')
    .forEach(elemento => {

        elemento.textContent = "SIN DATOS ACTUALES";

        elemento.style.color =
            CONFIGURACION.colores.advertencia;
    });
// Los conteos actuales no pueden verificarse sin el backend
this.elementos.conectados.textContent = "—";
this.elementos.fallas.textContent = "—";

            // Indicar que los datos mostrados ya no están actualizados
this.elementos.actualizacion.textContent =
    "SIN COMUNICACIÓN HTTP";
this.actualizarNotaResumen("Datos desactualizados · revisar servidor HTTP", "error");

    // Marcar los estados de comunicación como desactualizados
// Marcar visualmente los datos como desactualizados
this.elementos.lista
    .querySelectorAll('[id^="comunicacion-"]')
    .forEach(elemento => {

        elemento.textContent = "SIN DATOS ACTUALES";
        elemento.style.color =
            CONFIGURACION.colores.advertencia;

        // Obtener el ID del PLC
        const id = elemento.id.replace("comunicacion-", "");

        // Buscar el indicador circular correspondiente
        const punto = document.getElementById(`punto-${id}`);

        if (punto) {
            punto.style.background =
                CONFIGURACION.colores.advertencia;
        }
    });

            this.mostrarEstado(
                CONFIGURACION.mensajes.errorLectura,
                CONFIGURACION.colores.desconectado
            );

        } finally {
            this.solicitandoEstado = false;
        }
    },

    crearAvisoVigencia() {
        if (this.avisoDatos) return;
        const aviso = document.createElement("div");
        aviso.id = "aviso-vigencia-plc";
        aviso.setAttribute("role", "status");
        aviso.className = "ui-data-stale";
        aviso.setAttribute("aria-live", "polite");
        aviso.style.display = "none";
        document.body.appendChild(aviso);
        this.avisoDatos = aviso;
    },

    revisarVigencia() {
        if (!this.avisoDatos) return;
        const umbral = 2500;
        const edad = this.ultimaRecepcionHTTP === null
            ? null : Date.now() - this.ultimaRecepcionHTTP;
        const caducado = edad === null || edad > umbral;
        if (caducado) {
            this.avisoDatos.textContent = edad === null
                ? "Esperando el primer estado del servidor..."
                : `Datos de pantalla desactualizados (ultima respuesta HTTP hace ${(edad / 1000).toFixed(1)} s).`;
            this.avisoDatos.style.display = "block";
        } else {
            this.avisoDatos.style.display = "none";
        }
    },

    registrarVisibilidad() {
        const diagnostico = this.diagnosticoVisibilidad;
        const ahora = performance.now();
        if (diagnostico.ultimaMarca !== null) {
            const intervalo = ahora - diagnostico.ultimaMarca;
            const clave = diagnostico.ultimaVisible ? "visible" : "oculto";
            const grupo = diagnostico[clave];
            grupo.cantidad++;
            grupo.suma += intervalo;
            grupo.max = Math.max(grupo.max, intervalo);
            if (grupo.cantidad >= 30) {
                console.info(`[FASE 4B] intervalos ${clave}: promedio=${(grupo.suma / grupo.cantidad).toFixed(1)}ms max=${grupo.max.toFixed(1)}ms (n=${grupo.cantidad})`);
                Object.assign(grupo, { cantidad: 0, suma: 0, max: 0 });
            }
        }
        diagnostico.ultimaMarca = ahora;
        diagnostico.ultimaVisible = !document.hidden;
    },

    inicializar() {

// Estado inicial del supervisor
this.mostrarEstado(
    CONFIGURACION.mensajes.detenido,
    CONFIGURACION.colores.advertencia
);

      // Cargar los textos del encabezado desde el objeto de configuración
document.getElementById("titulo-aplicacion").textContent =
    CONFIGURACION.aplicacion.titulo;

document.getElementById("subtitulo-aplicacion").textContent =
    CONFIGURACION.aplicacion.subtitulo;

   // Etiquetas de las secciones
document.getElementById("titulo-resumen").textContent =
    CONFIGURACION.secciones.tituloResumen;

document.getElementById("titulo-dispositivos").textContent =
    CONFIGURACION.secciones.tituloDispositivos;

document.getElementById("descripcion-red").textContent =
    CONFIGURACION.secciones.descripcionRed;

// Generar las tarjetas del resumen desde objetos
COMPONENTES.renderizarResumen(
    document.getElementById("panel-resumen")
);

// Obtener las referencias a los elementos generados
this.elementos.total =
    document.getElementById("total-plc");

this.elementos.conectados =
    document.getElementById("plc-conectados");

this.elementos.fallas =
    document.getElementById("plc-falla");

this.elementos.actualizacion =
    document.getElementById("ultima-actualizacion");

        this.crearAvisoVigencia();
        this.revisarVigencia();
        this.monitorVigencia = setInterval(() => {
            this.registrarVisibilidad();
            this.revisarVigencia();
        }, CONFIGURACION.aplicacion.intervaloActualizacion);

        document.addEventListener("visibilitychange", () => {
            this.diagnosticoVisibilidad.ultimaMarca = null;
            this.diagnosticoFase4.ultimaActualizacion = null;
            this.diagnosticoVisibilidad.ultimaVisible = !document.hidden;
            if (!document.hidden) {
                console.info("[FASE 4B] Pagina visible: solicitando estado actualizado");
                this.consultarEstado();
                this.revisarVigencia();
            }
        });

        this.consultarEstado();

        this.temporizador = setInterval(
            () => {
                if (!document.hidden) this.consultarEstado();
            },
            CONFIGURACION.aplicacion.intervaloActualizacion
        );
    }
};

document.addEventListener("DOMContentLoaded", () => {
    INTERFAZ.inicializar();
});
