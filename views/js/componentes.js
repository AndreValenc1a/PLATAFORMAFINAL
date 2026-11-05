"use strict";

// ==================================================
// COMPONENTES DE LA INTERFAZ
// Generacion dinamica de tarjetas PLC
// ==================================================

const COMPONENTES = {
    obtenerTarjetasResumen() {
        return [
            {
                clave: "total",
                id: "total-plc",
                valor: "0",
                nota: "Equipos configurados"
            },
            {
                clave: "conectados",
                id: "plc-conectados",
                valor: "0",
                nota: "Equipos con comunicación válida",
                color: "var(--verde)"
            },
            {
                clave: "fallas",
                id: "plc-falla",
                valor: "0",
                nota: "Equipos que reportan falla",
                color: "var(--rojo)"
            },
            {
                clave: "actualizacion",
                id: "ultima-actualizacion",
                valor: "--:--:--",
                nota: "Esperando datos del supervisor",
                tamano: "20px"
            }
        ];
    },

    renderizarResumen(contenedor) {
        if (!contenedor) {
            throw new Error("No se encontró el contenedor del resumen");
        }

        const tarjetas = this.obtenerTarjetasResumen();

        contenedor.innerHTML = tarjetas.map(tarjeta => {
            const titulo = CONFIGURACION.resumen[tarjeta.clave];

            const estilos = [
                tarjeta.color ? `color: ${tarjeta.color}` : "",
                tarjeta.tamano ? `font-size: ${tarjeta.tamano}` : ""
            ].filter(Boolean).join("; ");

            return `
                <div class="resumen-card">
                    <div class="resumen-titulo">
                        ${this.escaparHTML(titulo)}
                    </div>

                    <div
                        class="resumen-valor"
                        id="${this.escaparHTML(tarjeta.id)}"
                        style="${estilos}"
                    >
                        ${this.escaparHTML(tarjeta.valor)}
                    </div>

                    <div class="resumen-nota">
                        ${this.escaparHTML(tarjeta.nota)}
                    </div>
                </div>
            `;
        }).join("");
    },

    // Evita insertar texto recibido del backend como HTML.
    escaparHTML(valor) {
        return String(valor ?? "").replace(/[&<>"']/g, caracter => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[caracter]);
    },

    obtenerDiagnostico(equipo) {
        const perfiles = CONFIGURACION.diagnosticos.perfiles;
        const tipo = equipo.tipoSupervision;

        return perfiles[tipo] || {
            lecturaFalla: false,
            etiqueta: CONFIGURACION.etiquetas.fallaGeneral
        };
    },

    obtenerCampos(equipo) {
        const diagnostico = this.obtenerDiagnostico(equipo);

        return [
            {
                clave: "direccionIP",
                valor: equipo.ip
            },
            {
                clave: "identidad",
                id: `identidad-${equipo.id}`,
                valor: CONFIGURACION.estados.sinVerificar
            },
            {
                clave: "direccionMAC",
                id: `mac-${equipo.id}`,
                valor: CONFIGURACION.estados.sinDetectar
            },
            {
                etiqueta: diagnostico.etiqueta,
                id: `falla-${equipo.id}`,
                valor: diagnostico.lecturaFalla
                    ? "Sin lectura"
                    : CONFIGURACION.estados.noMonitoreado,
                clase: "estado-falla"
            },
            {
                etiqueta: "MODO DE OPERACIÓN",
                id: `modo-operacion-${equipo.id}`,
                valor: "SIN DATOS",
                clase: "estado-modo"
            },
            {
                etiqueta: "TIPO DE SUPERVISIÓN",
                id: `tipo-supervision-${equipo.id}`,
                valor: equipo.tipoSupervision === "PCCC" ? "PCCC" :
                    equipo.tipoSupervision === "CIP_MICRO850" ? "CIP / EtherNet/IP" :
                    equipo.tipoSupervision === "UMAS_M580" ? "UMAS" :
                    equipo.tipoSupervision === "S7_SIEMENS" ? "S7 / TCP 102" : "IDENTIDAD IP / MAC"
            },
            {
                clave: "tiempoConexion",
                id: `conexion-${equipo.id}`,
                valor: "--:--:--",
                clase: "cronometro"
            },
            {
                clave: "tiempoFalla",
                id: `tiempo-falla-${equipo.id}`,
                valor: "--:--:--",
                clase: "cronometro"
            },
            {
                clave: "ultimaRespuesta",
                id: `respuesta-${equipo.id}`,
                valor: CONFIGURACION.estados.sinDatos
            }
        ];
    },

    crearCampo(campo) {
        const etiqueta = campo.etiqueta ||
            CONFIGURACION.etiquetas[campo.clave] ||
            campo.clave;

        const id = campo.id
            ? ` id="${this.escaparHTML(campo.id)}"`
            : "";

        const clase = campo.clase
            ? ` ${this.escaparHTML(campo.clase)}`
            : "";

        return `
            <div class="dato">
                <span class="dato-label">${this.escaparHTML(etiqueta)}</span>
                <span class="dato-valor${clase}"${id}>
                    ${this.escaparHTML(campo.valor)}
                </span>
            </div>
        `;
    },

    // La marca solo define la apariencia, nunca el estado operativo.
    obtenerFabricante(equipo) {
        const marca = String(equipo.marca ?? "").trim();
        const normalizada = marca.normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase();

        // El fabricante proviene del inventario MySQL, no del modelo.
        if (normalizada.includes("ALLEN") || normalizada.includes("ROCKWELL")) {
            return { clase: "allen-bradley", nombre: marca };
        }
        if (normalizada.includes("SCHNEIDER") || normalizada.includes("MODICON")) {
            return { clase: "schneider", nombre: marca };
        }
        if (normalizada.includes("SIEMENS")) {
            return { clase: "siemens", nombre: marca };
        }
        return { clase: "generico", nombre: marca || "Marca no registrada" };
    },

    crearTarjeta(equipo) {
        const id = equipo.id;
        const numero = String(id).padStart(2, "0");
        const fabricante = this.obtenerFabricante(equipo);
        const tipoSupervision = String(equipo.tipoSupervision ?? "").toUpperCase();
        const modo = tipoSupervision === "PCCC"
            ? "DIAGNÓSTICO PCCC"
            : tipoSupervision === "CIP_MICRO850"
                ? "DIAGNÓSTICO CIP / ETHERNET-IP"
                : tipoSupervision === "UMAS_M580"
                    ? "DIAGNÓSTICO UMAS"
                    : tipoSupervision === "S7_SIEMENS"
                        ? "ESTADO RUN / STOP · S7"
                    : "VERIFICACIÓN IP / MAC";

        // Los IDs de los campos se mantienen para supervisor.js.
        // Los datos técnicos ocultos siguen actualizándose normalmente.
        const campos = this.obtenerCampos(equipo);
        const principales = campos.filter(campo =>
            campo.clave === "direccionIP" ||
            (campo.id && campo.id.startsWith("falla-")) ||
            (campo.id && campo.id.startsWith("modo-operacion-")) ||
            (campo.id && campo.id.startsWith("conexion-")) ||
            (campo.id && campo.id.startsWith("tiempo-falla-"))
        );
        const adicionales = campos.filter(campo => !principales.includes(campo));

        return `
            <article class="plc plc-${fabricante.clase}" id="plc-${this.escaparHTML(id)}">
                <div class="plc-cabecera">
                    <div class="plc-identificacion">
                        <div class="plc-fabricante">${this.escaparHTML(fabricante.nombre)}</div>
                        <div class="plc-nombre">PLC-${this.escaparHTML(numero)}</div>
                        <div class="plc-modelo">${this.escaparHTML(equipo.modelo)}</div>
                        <div class="plc-modo">${this.escaparHTML(modo)}</div>
                    </div>
                    <div class="indicador" aria-label="Estado de comunicación">
                        <span class="punto" id="punto-${this.escaparHTML(id)}"></span>
                        <span id="comunicacion-${this.escaparHTML(id)}"
                              style="color: var(--amarillo)">
                            ${this.escaparHTML(CONFIGURACION.estados.sinDatos)}
                        </span>
                    </div>
                </div>

                <div class="plc-contenido">
                    <div class="plc-datos-principales">
                        ${principales.map(campo => this.crearCampo(campo)).join("")}
                    </div>
                    <details class="plc-detalles">
                        <summary>Detalles técnicos</summary>
                        <div class="plc-detalles-contenido">
                            ${adicionales.map(campo => this.crearCampo(campo)).join("")}
                        </div>
                    </details>
                </div>
            </article>
        `;
    },

    renderizarTarjetas(datos, contenedor) {
        if (!Array.isArray(datos)) {
            throw new Error("El inventario recibido no es válido");
        }

        contenedor.innerHTML = datos
            .map(equipo => this.crearTarjeta(equipo))
            .join("");
    }
};

window.COMPONENTES = COMPONENTES;
