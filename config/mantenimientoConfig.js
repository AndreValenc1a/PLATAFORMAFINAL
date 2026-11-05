"use strict";
// Listas preventivas orientativas. Adaptarlas a los procedimientos del laboratorio
// y al manual del fabricante. No intervenir equipos energizados sin autorización.
const GENERAL = [
  "Inspección visual del estado del PLC y su gabinete",
  "Comprobar indicadores LED y registrar anomalías",
  "Verificar comunicación y revisar desconexiones registradas",
  "Inspeccionar externamente cableado, conectores y alimentación",
  "Registrar observaciones y acciones pendientes"
];
const TAREAS = {
  ML1100: [...GENERAL, "Revisar diagnóstico S:1/13 y calidad de lecturas PCCC"],
  ML1400: [...GENERAL, "Revisar diagnóstico S:1/13 y calidad de lecturas PCCC"],
  M580: [...GENERAL, "Inspeccionar visualmente CPU, rack y módulos; verificar LEDs de error"],
  Micro850: [...GENERAL, "Revisar LEDs de estado y conectividad EtherNet/IP"],
  Siemens: [...GENERAL, "Revisar indicadores de CPU, módulos y comunicación PROFINET"]
};
function obtenerTareas(modelo) {return [...(TAREAS[modelo] || GENERAL)];}
module.exports={obtenerTareas};
