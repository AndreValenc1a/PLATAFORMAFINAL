/* PLATAFORMAFINAL · SCADA Premium Fase 7.7
 * Capa visual compartida para Supervisión, Eventos, Horómetro y Reportes.
 * Solo GET /api/supervisor. No controla PLC, no reconoce alarmas industriales.
 */
(() => {
  'use strict';
  const paginas = {
    '/': 'Supervisión', '/horometro': 'Horómetro y mantenimiento',
    '/eventos': 'Eventos y alarmas', '/reportes': 'Centro de reportes'
  };
  const pagina = paginas[location.pathname.replace(/\/$/, '') || '/'] || 'PLATAFORMAFINAL';
  const KEY_AVISOS = 'plataformafinal:fase73:avisos';
  const KEY_ESTADOS = 'plataformafinal:fase73:estados';
  const MAX_AVISOS = 35;
  const INTERVALO = 4500;
  const MAX_CONTINUIDAD = 20000;
  // Edite esta lista SOLO si el laboratorio define qué PLC tienen prioridad de proceso.
  // Por defecto ninguno se presume crítico solo por estar apagado.
  // Ejemplo, cuando así se apruebe: new Set(['50'])
  const PLC_PRIORITARIOS = new Set([]);
  const reducirMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const crear = (tag, clase, texto) => {
    const el = document.createElement(tag);
    if (clase) el.className = clase;
    if (texto !== undefined) el.textContent = texto;
    return el;
  };
  const relojEcuador = fecha => new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(fecha);
  function leerSesion(llave, fallback) {
    try { const data = JSON.parse(sessionStorage.getItem(llave)); return data ?? fallback; }
    catch (_) { return fallback; }
  }
  function guardarSesion(llave, valor) {
    try { sessionStorage.setItem(llave, JSON.stringify(valor)); } catch (_) { /* almacenamiento opcional */ }
  }

  function contextualizar() {
    const main = document.querySelector('main');
    if (!main || document.querySelector('.ui-pagebar')) return;
    const barra = crear('div', 'ui-pagebar');
    barra.setAttribute('aria-label', 'Contexto de la vista');
    const lugar = crear('div', 'ui-crumb');
    const punto = crear('span', 'ui-live'); punto.setAttribute('aria-hidden', 'true');
    lugar.append(punto, crear('span', '', 'PLATAFORMAFINAL  /  '), crear('b', '', pagina));
    const reloj = crear('time', 'ui-clock');
    reloj.setAttribute('aria-label', 'Hora de Ecuador');
    barra.append(lugar, reloj);
    main.prepend(barra);
    const pie = crear('footer', 'ui-footer');
    const marca = crear('span');
    marca.append(crear('strong', '', 'PLATAFORMAFINAL'), document.createTextNode(' · Laboratorio de Redes Industriales'));
    pie.append(marca, crear('span', '', 'Sin comunicación no significa falla interna confirmada'));
    document.body.append(pie);
    function actualizarReloj() {
      reloj.textContent = new Intl.DateTimeFormat('es-EC', {
        timeZone: 'America/Guayaquil', weekday: 'short', day: '2-digit',
        month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date()) + ' · Ecuador';
    }
    actualizarReloj(); setInterval(actualizarReloj, 30000);
  }

  function animarInterfaz() {
    if (reducirMovimiento()) return;
    const selectors = '.hero,.scada-hero,.panel,.resumen-card,.metric,.kpi,.encabezado-seccion,.herramientas-plc,.navegacion-modulos';
    const vistos = new WeakSet();
    const observador = 'IntersectionObserver' in window ? new IntersectionObserver(entradas => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        entrada.target.classList.add('ui-entered');
        observador.unobserve(entrada.target);
      }
    }, { threshold: 0.08, rootMargin: '0px 0px 35px 0px' }) : null;
    function preparar(el, idx) {
      if (vistos.has(el)) return;
      vistos.add(el);
      el.classList.add('ui-entrance');
      el.style.setProperty('--ui-delay', `${Math.min(idx % 5, 4) * 55}ms`);
      if (observador) observador.observe(el);
      else el.classList.add('ui-entered');
    }
    document.querySelectorAll(selectors).forEach(preparar);
    // Las tarjetas PLC se crean de forma dinámica; animarlas solo una vez.
    const lista = document.getElementById('lista-plc');
    if (lista && 'MutationObserver' in window) {
      const ids = new Set();
      const animarTarjetas = () => {
        [...lista.querySelectorAll('.plc')].forEach((card, idx) => {
          if (ids.has(card.id)) return;
          ids.add(card.id);
          card.classList.add('ui-card-enter');
          card.style.setProperty('--ui-delay', `${Math.min(idx % 6, 5) * 45}ms`);
        });
      };
      animarTarjetas();
      new MutationObserver(animarTarjetas).observe(lista, { childList: true, subtree: false });
    }
  }

  // Localizador autónomo. En versiones anteriores el centro de avisos llamaba
  // a PLATAFORMA_LOCALIZAR_PLC, que se eliminó al retirar el panel duplicado.
  // Esta implementación no depende de otros módulos y nunca escribe al PLC.
  let etiquetaLocalizacion = null;
  let tarjetaLocalizada = null;
  let limpiezaLocalizacion = null;
  function quitarLocalizacion() {
    if (tarjetaLocalizada) tarjetaLocalizada.classList.remove('ui-plc-target', 'ui-plc-target-enter');
    tarjetaLocalizada = null;
    etiquetaLocalizacion?.remove();
    etiquetaLocalizacion = null;
    if (limpiezaLocalizacion) clearTimeout(limpiezaLocalizacion);
    limpiezaLocalizacion = null;
  }
  function localizarPLC(id) {
    const normalizado = String(id).trim();
    if (!/^\d{1,8}$/.test(normalizado) || location.pathname !== '/') return false;
    const tarjeta = document.getElementById('plc-' + normalizado);
    if (!tarjeta) return false; // Se volverá a intentar cuando llegue el inventario.

    // Los filtros visuales pueden ocultar el PLC: restablecerlos antes de desplazarse.
    const busqueda = document.getElementById('buscar-plc');
    const filtro = document.getElementById('filtrar-plc');
    if (busqueda && busqueda.value) {
      busqueda.value = '';
      busqueda.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (filtro && filtro.value !== 'todos') {
      filtro.value = 'todos';
      filtro.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // Fallback ante filtros externos: mantener visible el destino hasta localizarlo.
    tarjeta.classList.remove('plc-oculto');
    quitarLocalizacion();
    tarjetaLocalizada = tarjeta;
    const encabezado = tarjeta.querySelector('.plc-cabecera') || tarjeta;
    const aviso = crear('span', 'ui-target-flag', '✓ PLC-' + normalizado + ' localizado');
    aviso.setAttribute('role', 'status');
    encabezado.append(aviso);
    etiquetaLocalizacion = aviso;
    tarjeta.classList.add('ui-plc-target');
    if (!reducirMovimiento()) {
      tarjeta.classList.remove('ui-plc-target-enter');
      void tarjeta.offsetWidth;
      tarjeta.classList.add('ui-plc-target-enter');
    }
    // Evitar que el centro flotante tape el PLC al navegar.
    document.dispatchEvent(new CustomEvent('plataforma:cerrar-avisos'));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!tarjeta.isConnected) return;
      tarjeta.scrollIntoView({ behavior: reducirMovimiento() ? 'auto' : 'smooth', block: 'center' });
      tarjeta.setAttribute('tabindex', '-1');
      try { tarjeta.focus({ preventScroll: true }); } catch (_) { tarjeta.focus(); }
    }));
    limpiezaLocalizacion = setTimeout(quitarLocalizacion, 10000);
    return true;
  }
  function esperarPLC(id, limpiarUrl = false) {
    const normalizado = String(id).trim();
    if (!/^\d{1,8}$/.test(normalizado)) return;
    let intentos = 0;
    const intentar = () => {
      if (localizarPLC(normalizado)) {
        clearInterval(intervalo);
        if (limpiarUrl) {
          try { history.replaceState(history.state, '', '/'); } catch (_) { /* opcional */ }
        }
        return true;
      }
      if (++intentos >= 65) {
        clearInterval(intervalo);
        const estado = crear('div', 'ui-location-error', 'No se encontró PLC-' + normalizado + ' en el inventario recibido.');
        estado.setAttribute('role', 'alert');
        document.body.append(estado);
        setTimeout(() => estado.remove(), 6500);
      }
      return false;
    };
    // La primera prueba es inmediata. Las siguientes cubren la carga HTTP asíncrona.
    if (localizarPLC(normalizado)) {
      if (limpiarUrl) {
        try { history.replaceState(history.state, '', '/'); } catch (_) { /* opcional */ }
      }
      return;
    }
    const intervalo = setInterval(intentar, 200);
  }
  function irAlPLC(id) {
    const normalizado = String(id).trim();
    if (!/^\d{1,8}$/.test(normalizado)) return;
    if (location.pathname === '/') {
      esperarPLC(normalizado);
      return;
    }
    // Desde otro módulo es inevitable navegar; el localizador se ejecuta al cargar.
    location.assign('/?plc=' + encodeURIComponent(normalizado));
  }
  function irATimeline(id) {
    const normalizado = String(id).trim();
    if (!/^\d{1,8}$/.test(normalizado)) return;
    if (location.pathname === '/eventos' && typeof window.PLATAFORMA_ABRIR_TIMELINE === 'function') {
      window.PLATAFORMA_ABRIR_TIMELINE(normalizado);
      document.dispatchEvent(new CustomEvent('plataforma:cerrar-avisos'));
      return;
    }
    location.assign('/eventos?plc=' + encodeURIComponent(normalizado) + '#timeline-plc');
  }

  function resolverEnlacePLC() {
    if (location.pathname !== '/') return;
    const id = new URLSearchParams(location.search).get('plc');
    if (id && /^\d{1,8}$/.test(id)) esperarPLC(id, true);
  }
  function activarVistaPremium() {
    if (location.pathname !== '/') return;
    const barra = document.querySelector('.herramientas-plc');
    if (!barra || barra.querySelector('.ui-premium-layout')) return;
    const controls = crear('div', 'ui-premium-layout');
    const compacta = crear('button', 'ui-premium-layout-toggle');
    compacta.type = 'button';
    const key = 'plataformafinal:premium:compacta';
    let elegido = false;
    try { elegido = localStorage.getItem(key) === '1'; } catch (_) { /* opcional */ }
    const aplicar = valor => {
      elegido = valor;
      document.body.classList.toggle('ui-premium-compact', valor);
      compacta.setAttribute('aria-pressed', String(valor));
      compacta.textContent = valor ? '▤  Vista cómoda' : '▦  Vista compacta';
      compacta.title = valor ? 'Mostrar información con más espacio' : 'Visualizar más PLC por pantalla';
    };
    compacta.addEventListener('click', () => {
      aplicar(!elegido);
      try { localStorage.setItem(key, elegido ? '1' : '0'); } catch (_) { /* opcional */ }
    });
    aplicar(elegido);
    controls.append(compacta);
    barra.append(controls);
  }

  function activarAvisos() {
    if (!window.fetch || document.querySelector('.ui-notify')) return;
    const prevData = leerSesion(KEY_ESTADOS, null);
    const prev = new Map();
    let listo = false;
    if (prevData && Date.now() - prevData.marca < MAX_CONTINUIDAD && Array.isArray(prevData.equipos)) {
      for (const [id, estado] of prevData.equipos) prev.set(id, estado);
      listo = true;
    }
    const historico = leerSesion(KEY_AVISOS, []);
    const avisos = Array.isArray(historico) ? historico.filter(a => a && /^\d+$/.test(String(a.id))
      && typeof a.titulo === 'string' && typeof a.detalle === 'string').slice(0, MAX_AVISOS) : [];
    let activos = [];
    let activoValidado = false;
    let estadoHttp = 'consultando';
    let consultando = false;
    let panelAbierto = false;
    let pestaña = 'activos';
    let ultimaNotificacion = 0;
    const scrollTab = { activos: 0, cambios: 0 };
    let firmaDibujo = '';
    let primerDibujo = true;
    let bloqueandoScroll = false;
    let versionDibujo = 0;

    const aside = crear('aside', 'ui-notify');
    aside.setAttribute('aria-label', 'Centro de avisos global');
    const panel = crear('section', 'ui-notify-panel'); panel.hidden = true;
    panel.id = 'ui-notify-panel';
    panel.setAttribute('aria-label', 'Estado y novedades de la supervisión');
    const cabecera = crear('div', 'ui-notify-head');
    const encabezado = crear('div');
    encabezado.append(crear('strong', '', 'Centro de avisos'), crear('small', '', 'Disponible desde todos los módulos · Solo lectura'));
    const cerrar = crear('button', 'ui-notify-close', 'Cerrar'); cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Cerrar el centro de avisos');
    cabecera.append(encabezado, cerrar);
    const estado = crear('div', 'ui-notify-health', 'Consultando estado del servidor…');
    estado.setAttribute('role', 'status');
    const tabs = crear('div', 'ui-notify-tabs'); tabs.setAttribute('role', 'tablist');
    const tabActivos = crear('button', 'ui-notify-tab', 'Condiciones activas');
    const tabNuevos = crear('button', 'ui-notify-tab', 'Cambios recientes');
    tabActivos.type = tabNuevos.type = 'button';
    tabActivos.setAttribute('role', 'tab'); tabNuevos.setAttribute('role', 'tab');
    tabActivos.id = 'ui-notify-tab-active';
    tabNuevos.id = 'ui-notify-tab-recent';
    tabs.append(tabActivos, tabNuevos);
    const listado = crear('div', 'ui-notify-items'); listado.id = 'ui-notify-items';
    listado.setAttribute('role', 'tabpanel'); listado.setAttribute('aria-live', 'off');
    listado.setAttribute('aria-labelledby', tabActivos.id);
    tabActivos.setAttribute('aria-controls', listado.id);
    tabNuevos.setAttribute('aria-controls', listado.id);
    const indicadores = crear('div', 'ui-notify-priority-summary');
    indicadores.setAttribute('aria-label', 'Resumen de prioridades');
    const pie = crear('div', 'ui-notify-foot');
    const enlace = crear('a', '', 'Ver historial completo'); enlace.href = '/eventos';
    const vistos = crear('button', 'ui-notify-action', 'Marcar cambios como vistos'); vistos.type = 'button';
    pie.append(enlace, vistos);
    panel.append(cabecera, estado, tabs, indicadores, listado, pie);
    const boton = crear('button', 'ui-notify-toggle'); boton.type = 'button';
    boton.setAttribute('aria-controls', 'ui-notify-panel');
    boton.setAttribute('aria-expanded', 'false');
    const etiqueta = crear('span', 'ui-notify-title', '◉  Centro de avisos');
    const resumen = crear('span', 'ui-notify-summary', 'Consultando…');
    const contador = crear('span', 'ui-notify-count', '0'); contador.setAttribute('aria-label', 'Cambios nuevos sin ver');
    boton.append(etiqueta, resumen, contador);
    const toast = crear('div', 'ui-notify-toast'); toast.hidden = true;
    toast.setAttribute('role', 'status');
    aside.append(toast, panel, boton);
    document.body.append(aside);
    listado.addEventListener('scroll', () => {
      if (!bloqueandoScroll) scrollTab[pestaña] = listado.scrollTop;
    }, { passive: true });

    let timerToast = null;
    function guardarScrollActual() {
      if (!bloqueandoScroll) scrollTab[pestaña] = listado.scrollTop;
    }
    // Al redibujar, conservar el punto de lectura. CSS scroll-behavior:auto
    // evita el salto animado que anteriormente regresaba la lista al principio.
    function restablecerScroll(posicion) {
      const version = ++versionDibujo;
      const fijar = () => {
        const maximo = Math.max(0, listado.scrollHeight - listado.clientHeight);
        listado.scrollTop = Math.min(posicion, maximo);
      };
      fijar();
      requestAnimationFrame(() => {
        if (version !== versionDibujo) return;
        fijar();
        bloqueandoScroll = false;
        scrollTab[pestaña] = listado.scrollTop;
      });
    }
    function firmaActual() {
      if (pestaña === 'activos') {
        return 'activos|' + estadoHttp + '|' + activoValidado + '|' + activos.map(a => [a.id, a.gravedad, a.prioridad, a.detalle].join(':')).join('|');
      }
      return 'cambios|' + avisos.map(a => [a.id, a.ts || a.hora, a.visto ? 1 : 0, a.detalle].join(':')).join('|');
    }
    function mostrarToast(aviso) {
      if (reducirMovimiento() || document.hidden || Date.now() - ultimaNotificacion < 8000) return;
      ultimaNotificacion = Date.now();
      toast.replaceChildren();
      const info = crear('div');
      info.append(crear('strong', '', aviso.titulo), crear('small', '', aviso.detalle));
      const ir = crear('button', 'ui-notify-action', 'Ver PLC'); ir.type = 'button';
      ir.addEventListener('click', () => irAlPLC(aviso.id));
      const linea = crear('button', 'ui-notify-action ui-notify-timeline', 'Timeline'); linea.type = 'button';
      linea.setAttribute('aria-label', 'Ver timeline del PLC-' + aviso.id);
      linea.addEventListener('click', () => irATimeline(aviso.id));
      const descartar = crear('button', 'ui-notify-toast-close', '×'); descartar.type = 'button';
      descartar.setAttribute('aria-label', 'Cerrar notificación');
      descartar.addEventListener('click', () => { toast.hidden = true; });
      toast.append(info, ir, linea, descartar);
      toast.dataset.severity = aviso.gravedad;
      toast.hidden = false;
      clearTimeout(timerToast);
      timerToast = setTimeout(() => { toast.hidden = true; }, 7000);
    }

    function abrir(valor, foco = true) {
      panelAbierto = valor;
      panel.hidden = !valor;
      boton.setAttribute('aria-expanded', String(valor));
      if (!valor) guardarScrollActual();
      if (valor) dibujar();
      document.body.classList.toggle('ui-overlay-open', valor);
      if (foco) (valor ? cerrar : boton).focus();
    }
    boton.addEventListener('click', () => abrir(!panelAbierto));
    cerrar.addEventListener('click', () => abrir(false));
    document.addEventListener('plataforma:cerrar-avisos', () => { if (panelAbierto) abrir(false, false); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && panelAbierto) abrir(false);
    });
    document.addEventListener('pointerdown', event => {
      if (panelAbierto && !aside.contains(event.target)) abrir(false, false);
    });
    tabActivos.addEventListener('click', () => { cambiarPestana('activos'); });
    tabNuevos.addEventListener('click', () => { cambiarPestana('cambios'); });
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const siguiente = event.key === 'Home' ? 'activos' : event.key === 'End' ? 'cambios'
        : (pestaña === 'activos' ? 'cambios' : 'activos');
      cambiarPestana(siguiente);
      (siguiente === 'activos' ? tabActivos : tabNuevos).focus();
    });
    function cambiarPestana(nueva) {
      if (pestaña === nueva) return;
      guardarScrollActual();
      pestaña = nueva;
      dibujar(true, true);
    }
    vistos.addEventListener('click', () => {
      avisos.forEach(aviso => { aviso.visto = true; });
      guardarSesion(KEY_AVISOS, avisos); dibujar(true);
    });

    function actualizarBarra() {
      const nuevos = avisos.filter(a => !a.visto).length;
      const numActivos = activoValidado ? activos.length : null;
      resumen.textContent = numActivos === null
        ? (estadoHttp === 'detenido' ? 'Supervisor detenido' : 'Estado sin confirmar')
        : `${numActivos} activas · ${nuevos} nuevos`;
      contador.textContent = String(nuevos);
      contador.hidden = nuevos === 0;
      boton.dataset.pendientes = nuevos ? 'si' : 'no';
      boton.dataset.activas = numActivos > 0 ? 'si' : 'no';
      tabActivos.textContent = `Condiciones activas${numActivos !== null ? ' (' + numActivos + ')' : ''}`;
      tabNuevos.textContent = `Cambios recientes (${avisos.length})`;
      tabActivos.setAttribute('aria-selected', String(pestaña === 'activos'));
      tabNuevos.setAttribute('aria-selected', String(pestaña === 'cambios'));
      tabActivos.tabIndex = pestaña === 'activos' ? 0 : -1;
      tabNuevos.tabIndex = pestaña === 'cambios' ? 0 : -1;
      listado.setAttribute('aria-labelledby', pestaña === 'activos' ? tabActivos.id : tabNuevos.id);
      estado.dataset.http = estadoHttp;
      const mensajes = {
        ok: `Datos comprobados · ${relojEcuador(new Date())} · Ecuador`,
        error: 'Sin respuesta HTTP válida · estados actuales no verificables',
        detenido: 'Supervisión detenida · condiciones no evaluadas',
        consultando: 'Consultando estado del servidor…'
      };
      estado.textContent = mensajes[estadoHttp];
      vistos.hidden = pestaña !== 'cambios';
      vistos.disabled = avisos.every(a => a.visto);
      indicadores.hidden = pestaña !== 'activos' || !activoValidado;
      if (!indicadores.hidden) {
        const criticas = activos.filter(a => a.prioridad === 'critica').length;
        const atencion = activos.filter(a => a.prioridad === 'atencion').length;
        const revision = activos.filter(a => a.prioridad === 'revision').length;
        const ficha = [criticas, atencion, revision].join('|');
        if (indicadores.dataset.ficha !== ficha) {
          indicadores.dataset.ficha = ficha;
          indicadores.replaceChildren();
          for (const [cantidad, titulo, clase] of [
            [criticas, 'críticas', 'critical'],
            [atencion, 'sin comunicación', 'warning'],
            [revision, 'por verificar', 'info']
          ]) {
            const chip = crear('span', 'ui-notify-priority-chip', `${cantidad} ${titulo}`);
            chip.dataset.severity = clase;
            indicadores.append(chip);
          }
        }
      }
    }

    function filaAviso(item, esCambio) {
      const fila = crear('article', esCambio ? 'ui-notify-item ui-timeline-entry' : 'ui-notify-item ui-priority-item');
      fila.dataset.severity = item.gravedad;
      if (esCambio && !item.visto) fila.classList.add('ui-notify-new');
      const informacion = crear('div', 'ui-notify-main');
      const cabeceraItem = crear('div', 'ui-notify-item-head');
      cabeceraItem.append(crear('strong', '', item.titulo));
      const etiqueta = crear('span', 'ui-notify-severity', esCambio
        ? (item.gravedad === 'critical' ? 'CRÍTICO' : item.gravedad === 'good' ? 'RECUPERADO' : 'CAMBIO')
        : (item.prioridad === 'critica' ? 'CRÍTICA' : item.prioridad === 'atencion' ? 'ATENCIÓN' : 'REVISIÓN'));
      etiqueta.dataset.severity = item.gravedad;
      cabeceraItem.append(etiqueta);
      informacion.append(cabeceraItem, crear('p', '', item.detalle));
      fila.append(informacion);
      if (esCambio) {
        const tiempo = crear('time', 'ui-timeline-time', item.hora || 'Hora no registrada');
        if (Number.isFinite(item.ts)) tiempo.dateTime = new Date(item.ts).toISOString();
        fila.append(tiempo);
      }
      const acciones = crear('div', 'ui-notify-row-actions');
      const ir = crear('button', 'ui-notify-action ui-notify-go', 'Ver PLC');
      ir.type = 'button';
      ir.setAttribute('aria-label', 'Localizar PLC-' + item.id + ' en Supervisión');
      ir.addEventListener('click', () => irAlPLC(item.id));
      acciones.append(ir);
      const irTimeline = crear('button', 'ui-notify-action ui-notify-timeline', 'Ver timeline');
      irTimeline.type = 'button';
      irTimeline.setAttribute('aria-label', 'Ver timeline del PLC-' + item.id);
      irTimeline.addEventListener('click', () => irATimeline(item.id));
      acciones.append(irTimeline);
      if (esCambio) {
        const marcar = crear('button', 'ui-notify-action', item.visto ? 'Visto' : 'Marcar visto');
        marcar.type = 'button'; marcar.disabled = item.visto;
        marcar.addEventListener('click', () => {
          item.visto = true; guardarSesion(KEY_AVISOS, avisos); dibujar(true);
        });
        acciones.append(marcar);
      }
      fila.append(acciones);
      return fila;
    }
    function bloquePrioridad(nombre, descripcion, prioridad, elementos) {
      if (!elementos.length) return null;
      const grupo = crear('section', 'ui-priority-group');
      grupo.dataset.priority = prioridad;
      const cabecera = crear('div', 'ui-priority-group-head');
      const icono = crear('span', 'ui-priority-indicator'); icono.setAttribute('aria-hidden', 'true');
      const titulo = crear('div');
      titulo.append(crear('strong', '', nombre), crear('small', '', descripcion));
      const contador = crear('span', 'ui-priority-group-count', String(elementos.length));
      cabecera.append(icono, titulo, contador);
      grupo.append(cabecera);
      for (const item of elementos) grupo.append(filaAviso(item, false));
      return grupo;
    }
    function dibujar(forzar = false, cambioPestana = false) {
      actualizarBarra();
      const nuevaFirma = firmaActual();
      if (!forzar && !primerDibujo && nuevaFirma === firmaDibujo) return;
      // Al cambiar pestaña, no tomar el scroll de la pestaña anterior.
      const posicion = cambioPestana ? (scrollTab[pestaña] || 0) : listado.scrollTop;
      firmaDibujo = nuevaFirma;
      primerDibujo = false;
      bloqueandoScroll = true;
      listado.replaceChildren();
      if (pestaña === 'activos') {
        if (!activoValidado) {
          listado.append(crear('div', 'ui-notify-empty',
            estadoHttp === 'detenido' ? 'Supervisor detenido. No se pueden confirmar condiciones actuales.' :
              'Estado actual no disponible. Verifica la conexión con el backend.'));
        } else if (activos.length === 0) {
          listado.append(crear('div', 'ui-notify-empty ui-notify-all-clear',
            'Sin condiciones activas clasificadas como alarma. Un PLC en PROGRAM no implica falla.'));
        } else {
          const prioridades = [
            ['Prioridad crítica', 'Falla diagnosticada o discrepancia MAC verificada', 'critica'],
            ['Sin comunicación', 'Revisar alimentación y enlace; no implica falla interna', 'atencion'],
            ['Por verificar', 'Identidad o diagnóstico pendiente de confirmación', 'revision']
          ];
          for (const [nombre, detalle, prioridad] of prioridades) {
            const grupo = bloquePrioridad(nombre, detalle, prioridad, activos.filter(a => a.prioridad === prioridad));
            if (grupo) listado.append(grupo);
          }
        }
      } else if (avisos.length === 0) {
        listado.append(crear('div', 'ui-notify-empty',
          'Aún no hay cambios detectados en esta sesión. Las condiciones existentes están en «Condiciones activas».'));
      } else {
        const timeline = crear('section', 'ui-timeline');
        timeline.setAttribute('aria-label', 'Línea de tiempo de cambios recientes');
        const cabecera = crear('div', 'ui-timeline-intro');
        cabecera.append(crear('strong', '', 'Línea de tiempo'), crear('small', '', 'Cambios detectados por esta interfaz · más recientes primero'));
        timeline.append(cabecera);
        for (const aviso of avisos) timeline.append(filaAviso(aviso, true));
        listado.append(timeline);
      }
      restablecerScroll(posicion);
    }
    // Una animación por transición REAL, no por cada consulta ni por cada tick del reloj.
    const timersTransicion = new WeakMap();
    function enfatizarCambioPLC(id, gravedad, tipo = 'general', detalle = '') {
      const card = document.getElementById('plc-' + id);
      if (!card || reducirMovimiento()) return;
      const texto = String(detalle || '');
      let clave = gravedad === 'critical' ? 'falla' : gravedad === 'good' ? 'recuperacion' : 'revision';
      if (tipo === 'comunicacion') clave = gravedad === 'good' ? 'recuperacion' : 'desconexion';
      else if (tipo === 'modo') {
        if (/\bPROGRAM\b/.test(texto)) clave = 'program';
        else if (/\bSTOP\b/.test(texto)) clave = 'stop';
        else if (/\bRUN\b/.test(texto)) clave = 'run';
        else clave = 'revision';
      } else if (tipo === 'identidad') clave = gravedad === 'critical' ? 'identidad' : 'recuperacion';
      else if (tipo === 'falla') clave = gravedad === 'critical' ? 'falla' : 'recuperacion';
      const titulo = {
        desconexion: 'Comunicación perdida', recuperacion: 'Estado recuperado',
        run: 'Modo RUN', program: 'Modo PROGRAM', stop: 'Modo STOP',
        falla: 'Diagnóstico de falla', identidad: 'Identidad MAC', revision: 'Cambio detectado'
      }[clave];
      const anterior = timersTransicion.get(card);
      if (anterior) clearTimeout(anterior);
      card.querySelector('.scada-change-flag')?.remove();
      card.classList.remove('scada-transition');
      card.removeAttribute('data-scada-change');
      void card.offsetWidth;
      card.dataset.scadaChange = clave;
      card.classList.add('scada-transition');
      const bandera = crear('span', 'scada-change-flag', titulo);
      bandera.setAttribute('aria-hidden', 'true');
      card.append(bandera);
      const timer = setTimeout(() => {
        card.classList.remove('scada-transition');
        card.removeAttribute('data-scada-change');
        bandera.remove();
        timersTransicion.delete(card);
      }, 1750);
      timersTransicion.set(card, timer);
      const porTipo = {
        comunicacion: ['comunicacion-', 'punto-'], falla: ['falla-'],
        modo: ['modo-operacion-'], identidad: ['identidad-', 'mac-']
      };
      for (const prefijo of porTipo[tipo] || []) {
        const el = document.getElementById(prefijo + id);
        if (!el) continue;
        el.classList.remove('scada-field-highlight');
        void el.offsetWidth;
        el.classList.add('scada-field-highlight');
        setTimeout(() => el.classList.remove('scada-field-highlight'), 1550);
      }
    }
    function latidoCritico(id, tipo, gravedad) {
      // Nunca reproducir latido por cada consulta: solo ante un EVENTO nuevo.
      // Un PLC desconectado no se considera una falla interna confirmada.
      const confirmado = tipo === 'falla' || tipo === 'identidad';
      const prioritario = tipo === 'comunicacion' && PLC_PRIORITARIOS.has(String(id));
      if (gravedad !== 'critical' || (!confirmado && !prioritario) || reducirMovimiento()) return;
      boton.classList.remove('ui-notify-critical-heartbeat');
      void boton.offsetWidth;
      boton.classList.add('ui-notify-critical-heartbeat');
      setTimeout(() => boton.classList.remove('ui-notify-critical-heartbeat'), 2100);
      const card = document.getElementById('plc-' + id);
      if (card) {
        card.classList.remove('ui-plc-critical-heartbeat');
        void card.offsetWidth;
        card.classList.add('ui-plc-critical-heartbeat');
        setTimeout(() => card.classList.remove('ui-plc-critical-heartbeat'), 2100);
      }
    }
    function registrar(id, titulo, detalle, gravedad, tipo = 'general') {
      const aviso = { id, titulo, detalle, gravedad, tipo, ts: Date.now(), hora: relojEcuador(new Date()), visto: false };
      avisos.unshift(aviso); avisos.length = Math.min(avisos.length, MAX_AVISOS);
      guardarSesion(KEY_AVISOS, avisos);
      dibujar(true);
      enfatizarCambioPLC(id, gravedad, tipo, detalle);
      latidoCritico(id, tipo, gravedad);
      // Indicador breve sin parpadeos repetitivos ante cambios comunes.
      boton.classList.remove('ui-notify-attention');
      if (!reducirMovimiento() && gravedad !== 'critical') {
        void boton.offsetWidth;
        boton.classList.add('ui-notify-attention');
        setTimeout(() => boton.classList.remove('ui-notify-attention'), 1200);
      }
      mostrarToast(aviso);
    }
    function capturar(p) {
      return {
        comunicacion: String(p.comunicacion || 'NO DISPONIBLE').toUpperCase(),
        modo: String(p.modoOperacion || 'DESCONOCIDO').toUpperCase(),
        falla: p.estadoFalla === true,
        macDistinta: p.identidadCoincide === false && /^[0-9A-F]{12}$/.test(
          String(p.macDetectada || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase())
      };
    }
    function clasificarActivas(plcs) {
      const resultado = [];
      for (const plc of plcs) {
        const id = String(plc.id);
        const titulo = `PLC-${id} · ${plc.modelo || 'Equipo'}`;
        const actual = capturar(plc);
        // Orden: discrepancia MAC verificada > falla reportada > sin comunicación > identidad por verificar.
        if (actual.macDistinta) {
          resultado.push({id, titulo, detalle: 'MAC detectada distinta a la esperada. Verifica identidad e IP.',
            gravedad: 'critical', prioridad: 'critica'});
        } else if (actual.comunicacion === 'CONECTADO' && actual.falla) {
          resultado.push({id, titulo, detalle: 'El diagnóstico del PLC reporta una falla.',
            gravedad: 'critical', prioridad: 'critica'});
        } else if (actual.comunicacion === 'DESCONECTADO') {
          resultado.push({id, titulo,
            detalle: PLC_PRIORITARIOS.has(id)
              ? 'PLC marcado como prioritario: comunicación perdida. Puede estar apagado; revisar alimentación y red.'
              : 'Sin comunicación confirmada. Puede estar apagado; no implica falla interna.',
            gravedad: PLC_PRIORITARIOS.has(id) ? 'critical' : 'warning',
            prioridad: PLC_PRIORITARIOS.has(id) ? 'critica' : 'atencion'});
        } else if (actual.comunicacion === 'CONECTADO' && plc.identidadCoincide === false) {
          resultado.push({id, titulo, detalle: 'Identidad IP/MAC requiere verificación.',
            gravedad: 'warning', prioridad: 'revision'});
        }
      }
      const orden = {critica:0, atencion:1, revision:2};
      return resultado.sort((a,b) => orden[a.prioridad] - orden[b.prioridad] || Number(a.id) - Number(b.id));
    }
    function comparar(id, plc, anterior, actual) {
      const titulo = `PLC-${id} · ${plc.modelo || 'Equipo'}`;
      if (anterior.comunicacion !== actual.comunicacion) {
        if (actual.comunicacion === 'DESCONECTADO')
          registrar(id, titulo, 'Pérdida de comunicación. Comprueba alimentación y red.', PLC_PRIORITARIOS.has(id) ? 'critical' : 'warning', 'comunicacion');
        else if (anterior.comunicacion === 'DESCONECTADO' && actual.comunicacion === 'CONECTADO')
          registrar(id, titulo, 'Comunicación restablecida.', 'good', 'comunicacion');
        else registrar(id, titulo, 'Comunicación: ' + actual.comunicacion + '.', 'warning', 'comunicacion');
      }
      if (anterior.comunicacion === 'CONECTADO' && actual.comunicacion === 'CONECTADO') {
        if (anterior.falla !== actual.falla)
          registrar(id, titulo, actual.falla ? 'Falla reportada por diagnóstico del PLC.' : 'El diagnóstico ya no reporta la falla anterior.', actual.falla ? 'critical' : 'good', 'falla');
        if (anterior.modo !== actual.modo)
          registrar(id, titulo, 'Cambio de modo a ' + actual.modo + '.', actual.modo === 'RUN' ? 'good' : 'warning', 'modo');
        if (anterior.macDistinta !== actual.macDistinta)
          registrar(id, titulo, actual.macDistinta ? 'MAC detectada distinta de la esperada.' : 'Discrepancia de identidad MAC ya no detectada.', actual.macDistinta ? 'critical' : 'good', 'identidad');
      }
    }
    async function comprobar() {
      if (consultando || document.hidden) return;
      consultando = true;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 5500);
      try {
        const respuesta = await fetch('/api/supervisor', {cache: 'no-store', signal: ctrl.signal});
        if (!respuesta.ok) throw Error('HTTP ' + respuesta.status);
        const data = await respuesta.json();
        if (!data || data.estado !== 'ACTIVO' || !Array.isArray(data.plc)) {
          estadoHttp = data && data.estado === 'DETENIDO' ? 'detenido' : 'error';
          activoValidado = false; activos = [];
          listo = false; prev.clear();
          guardarSesion(KEY_ESTADOS, null);
          dibujar();
          window.dispatchEvent(new CustomEvent('plataforma:sin-datos', {
            detail: { motivo: estadoHttp === 'detenido' ? 'Supervisión detenida' : 'Respuesta sin datos válidos' }
          }));
          return;
        }
        estadoHttp = 'ok';
        activos = clasificarActivas(data.plc);
        activoValidado = true;
        const encontrados = new Set();
        // No se generan avisos por el estado inicial de la página.
        for (const plc of data.plc) {
          const id = String(plc.id), nuevo = capturar(plc), viejo = prev.get(id);
          encontrados.add(id);
          if (listo && viejo) comparar(id, plc, viejo, nuevo);
          prev.set(id, nuevo);
        }
        for (const id of prev.keys()) if (!encontrados.has(id)) prev.delete(id);
        listo = true;
        guardarSesion(KEY_ESTADOS, {marca:Date.now(),equipos:[...prev.entries()]});
        dibujar();
        window.dispatchEvent(new CustomEvent('plataforma:estado', {
          detail: { plc: data.plc, estado: data.estado, comprobadoEn: Date.now() }
        }));
      } catch (_) {
        estadoHttp = 'error';
        activoValidado = false; activos = [];
        listo = false; prev.clear();
        guardarSesion(KEY_ESTADOS, null);
        dibujar();
        window.dispatchEvent(new CustomEvent('plataforma:sin-datos', {
          detail: { motivo: 'Sin conexión HTTP con el servidor' }
        }));
      } finally {
        clearTimeout(timeout); consultando = false;
      }
    }
    dibujar(); comprobar();
    setInterval(comprobar, INTERVALO);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        // Tras ausencias prolongadas no se infieren transiciones de PLC.
        const respaldo = leerSesion(KEY_ESTADOS, null);
        if (!respaldo || Date.now() - respaldo.marca > MAX_CONTINUIDAD) {
          listo = false; prev.clear();
        }
        comprobar();
      }
    });
  }
  function definirContextoVisual() {
    const ruta = location.pathname.replace(/\/$/, '') || '/';
    const paginaActual = {
      '/': 'supervision',
      '/horometro': 'horometro',
      '/eventos': 'eventos',
      '/reportes': 'reportes'
    }[ruta] || 'general';
    document.body.dataset.uiPage = paginaActual;
    const acentos = {
      supervision: '#8fd3ff',
      horometro: '#8ce3c8',
      eventos: '#f2c782',
      reportes: '#aeb5ff',
      general: '#8fd3ff'
    };
    document.documentElement.style.setProperty('--ui-module-accent', acentos[paginaActual] || acentos.general);
  }

  function activarSuperficiesPremium() {
    const selector = [
      '.hero', '.scada-hero', '.panel', '.metric', '.kpi', '.resumen-card',
      '.plc', '.ui-notify-panel', '.ui-notify-toggle', '.ui-pagebar', '.herramientas-plc',
      '.timeline-entry', '.feeditem', '.ui-priority-group', '.ui-priority-group-head', '.tablewrap'
    ].join(',');
    const registrar = element => {
      if (!(element instanceof HTMLElement) || element.dataset.uiPremiumBound === '1') return;
      element.dataset.uiPremiumBound = '1';
      element.classList.add('ui-premium-surface');
      if (!element.querySelector(':scope > .ui-surface-glow')) {
        const glow = crear('span', 'ui-surface-glow');
        glow.setAttribute('aria-hidden', 'true');
        element.prepend(glow);
      }
      const mover = event => {
        const rect = element.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
        const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
        element.style.setProperty('--mx', `${Math.max(0, Math.min(100, x)).toFixed(2)}%`);
        element.style.setProperty('--my', `${Math.max(0, Math.min(100, y)).toFixed(2)}%`);
      };
      element.addEventListener('pointermove', mover, { passive: true });
      element.addEventListener('pointerenter', mover, { passive: true });
    };
    const revisar = root => {
      if (!root) return;
      if (root.matches?.(selector)) registrar(root);
      root.querySelectorAll?.(selector).forEach(registrar);
    };
    revisar(document);
    if ('MutationObserver' in window) {
      new MutationObserver(registros => {
        for (const registro of registros) {
          registro.addedNodes.forEach(nodo => {
            if (nodo.nodeType === 1) revisar(nodo);
          });
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  function observarActualizacionesVisuales() {
    const selector = '.resumen-valor:not(#ultima-actualizacion), .metric strong, .kpi strong, .timeline-metric strong, .ui-notify-count, .ui-priority-group-count, .scada-ribbon-value';
    const aplicar = elemento => {
      if (!(elemento instanceof HTMLElement) || elemento.dataset.uiWatchBound === '1') return;
      elemento.dataset.uiWatchBound = '1';
      elemento.dataset.uiLastValue = elemento.textContent.trim();
      const animar = () => {
        const actual = elemento.textContent.trim();
        const anterior = elemento.dataset.uiLastValue ?? '';
        if (!actual || actual === anterior) return;
        elemento.dataset.uiLastValue = actual;
        if (!anterior || reducirMovimiento()) return;
        const objetivo = elemento.closest('.resumen-card, .metric, .kpi, .timeline-metric, .ui-notify-toggle, .ui-priority-group-head') || elemento;
        objetivo.classList.remove('ui-value-updated');
        void objetivo.offsetWidth;
        objetivo.classList.add('ui-value-updated');
        setTimeout(() => objetivo.classList.remove('ui-value-updated'), 820);
      };
      new MutationObserver(animar).observe(elemento, { childList: true, characterData: true, subtree: true });
    };
    const revisar = root => {
      if (!root) return;
      if (root.matches?.(selector)) aplicar(root);
      root.querySelectorAll?.(selector).forEach(aplicar);
    };
    revisar(document);
    if ('MutationObserver' in window) {
      new MutationObserver(registros => {
        for (const registro of registros) {
          registro.addedNodes.forEach(nodo => {
            if (nodo.nodeType === 1) revisar(nodo);
          });
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
  }


  // ================================================================
  // FASE 8 · Vista operativa: usa el MISMO resultado GET del centro de avisos.
  // No ejecuta acciones de control, no presupone la topología física.
  // ================================================================
  function activarCentroOperativo() {
    const main = document.querySelector('main');
    if (!main || document.querySelector('.scada-status-ribbon')) return;
    const ribbon = crear('section', 'scada-status-ribbon');
    ribbon.setAttribute('aria-label', 'Resumen del estado de supervisión');
    const entrada = [
      ['servidor', 'Conexión HTTP', 'Consultando', 'server'],
      ['total', 'PLC registrados', '—', 'cpu'],
      ['conectados', 'Conectados', '—', 'wifi'],
      ['sinCom', 'Sin comunicación', '—', 'wifi-off'],
      ['criticos', 'Críticos confirmados', '—', 'alert-triangle']
    ];
    const valores = new Map();
    for (const [clave, titulo, valor] of entrada) {
      const ficha = crear('div', 'scada-ribbon-item'); ficha.dataset.item = clave;
      ficha.append(crear('span', 'scada-ribbon-label', titulo));
      const cifra = crear('strong', 'scada-ribbon-value', valor);
      ficha.append(cifra);
      valores.set(clave, cifra);
      ribbon.append(ficha);
    }
    const actualizacion = crear('div', 'scada-ribbon-update', 'Esperando datos recientes del servidor');
    actualizacion.setAttribute('role', 'status');
    ribbon.append(actualizacion);
    const intro = main.querySelector('.ui-pagebar');
    if (intro) intro.insertAdjacentElement('afterend', ribbon);
    else main.prepend(ribbon);
    let ultimoOk = null;
    const mover = (clave, valor) => {
      const elemento = valores.get(clave);
      if (!elemento || elemento.textContent === String(valor)) return;
      elemento.textContent = String(valor);
      if (!reducirMovimiento() && clave !== 'servidor') {
        elemento.classList.remove('scada-value-change'); void elemento.offsetWidth;
        elemento.classList.add('scada-value-change');
      }
    };
    const invalidar = texto => {
      ribbon.dataset.frescura = 'sin-datos';
      mover('servidor', 'No verificable');
      for (const clave of ['total', 'conectados', 'sinCom', 'criticos']) mover(clave, '—');
      actualizacion.textContent = texto + ' · valores actuales sin confirmar';
      document.dispatchEvent(new CustomEvent('plataforma:mapa-invalido'));
    };
    window.addEventListener('plataforma:estado', evento => {
      const datos = evento.detail?.plc || [];
      ultimoOk = evento.detail?.comprobadoEn || Date.now();
      const conectados = datos.filter(d => d.comunicacion === 'CONECTADO').length;
      const sinCom = datos.filter(d => d.comunicacion === 'DESCONECTADO').length;
      const macValida = d => /^[0-9A-F]{12}$/i.test(String(d.macDetectada || '').replace(/[^0-9A-F]/ig, ''));
      const criticos = datos.filter(d =>
        (d.comunicacion === 'CONECTADO' && d.estadoFalla === true) ||
        (d.identidadCoincide === false && macValida(d))
      ).length;
      ribbon.dataset.frescura = 'ok';
      mover('servidor', 'ACTIVO'); mover('total', datos.length);
      mover('conectados', conectados); mover('sinCom', sinCom); mover('criticos', criticos);
      actualizacion.textContent = 'Lectura recibida · ' + relojEcuador(new Date(ultimoOk)) + ' · Ecuador';
    });
    window.addEventListener('plataforma:sin-datos', evento => {
      ultimoOk = null;
      invalidar(evento.detail?.motivo || 'Consulta no disponible');
    });
    // El reloj NO simula lecturas; solo comprueba que la última respuesta sea reciente.
    setInterval(() => {
      if (ultimoOk && Date.now() - ultimoOk > 13000) {
        ultimoOk = null;
        invalidar('La última lectura superó 13 segundos');
      }
    }, 2000);
  }

  function activarMapaLogico() {
    if (location.pathname !== '/') return;
    const resumen = document.getElementById('panel-resumen');
    if (!resumen || document.getElementById('scada-topologia')) return;
    const seccion = crear('section', 'scada-topologia'); seccion.id = 'scada-topologia';
    seccion.setAttribute('aria-labelledby', 'scada-topologia-titulo');
    const cabecera = crear('div', 'scada-map-head');
    const titulos = crear('div');
    titulos.append(crear('span', 'scada-eyebrow', 'INVENTARIO VISUAL'),
      crear('h2', '', 'Mapa lógico de supervisión'),
      crear('p', '', 'Estado de equipos supervisados vía Ethernet. No representa cableado ni conexiones físicas del laboratorio.'));
    titulos.querySelector('h2').id = 'scada-topologia-titulo';
    const boton = crear('button', 'scada-map-toggle', 'Mostrar mapa lógico');
    boton.type = 'button'; boton.setAttribute('aria-expanded', 'false');
    boton.setAttribute('aria-controls', 'scada-map-content');
    cabecera.append(titulos, boton);
    const contenido = crear('div', 'scada-map-body'); contenido.id = 'scada-map-content'; contenido.hidden = true;
    const bus = crear('div', 'scada-map-bus');
    bus.append(crear('span', 'scada-map-bus-symbol', '⌁'));
    const busText = crear('div'); busText.append(crear('strong', '', 'Centro de supervisión'),
      crear('small', '', 'Representación lógica · estado obtenido desde la API'));
    bus.append(busText);
    const meta = crear('span', 'scada-map-status', 'Esperando estados');
    bus.append(meta);
    const nodos = crear('div', 'scada-map-grid'); nodos.setAttribute('aria-label', 'PLC supervisados');
    const nota = crear('p', 'scada-map-foot', 'Selecciona un equipo para localizar su tarjeta o consultar su historial. Los colores indican el diagnóstico actual, no el cableado.');
    contenido.append(bus, nodos, nota);
    seccion.append(cabecera, contenido);
    resumen.insertAdjacentElement('afterend', seccion);
    const elementos = new Map();
    const crearNodo = d => {
      const id = String(d.id);
      const box = crear('article', 'scada-map-node'); box.dataset.plc = id;
      const cab = crear('div', 'scada-node-head');
      cab.append(crear('strong', '', 'PLC-' + id), crear('span', 'scada-node-dot'));
      const modelo = crear('span', 'scada-node-model');
      const ip = crear('span', 'scada-node-ip');
      const estado = crear('span', 'scada-node-state');
      const actions = crear('div', 'scada-node-actions');
      const ver = crear('button', '', 'Ver PLC'); ver.type = 'button';
      ver.setAttribute('aria-label', 'Localizar PLC-' + id);
      ver.addEventListener('click', () => irAlPLC(id));
      const historial = crear('button', '', 'Timeline'); historial.type = 'button';
      historial.setAttribute('aria-label', 'Ver timeline del PLC-' + id);
      historial.addEventListener('click', () => irATimeline(id));
      actions.append(ver, historial);
      box.append(cab, modelo, ip, estado, actions);
      return {box,modelo,ip,estado};
    };
    function actualizar(datos) {
      const ids = new Set();
      for (const d of datos) {
        const id = String(d.id);
        if (!/^\d{1,8}$/.test(id)) continue;
        ids.add(id);
        let nodo = elementos.get(id);
        if (!nodo) { nodo = crearNodo(d); elementos.set(id, nodo); }
        nodo.modelo.textContent = d.modelo || 'Modelo no indicado';
        nodo.ip.textContent = d.ip || 'IP no disponible';
        const macConfirmada = d.identidadCoincide === false && /^[0-9A-F]{12}$/i.test(String(d.macDetectada || '').replace(/[^0-9A-F]/ig, ''));
        const nivel = macConfirmada || (d.comunicacion === 'CONECTADO' && d.estadoFalla === true)
          ? 'critico' : d.comunicacion === 'CONECTADO' ? 'conectado' :
            d.comunicacion === 'DESCONECTADO' ? 'desconectado' : 'sin-datos';
        const texto = nivel === 'critico' ? 'Revisar diagnóstico' :
          nivel === 'conectado' ? (d.modoOperacion || 'CONECTADO') :
          nivel === 'desconectado' ? 'SIN COMUNICACIÓN' : 'SIN DATOS';
        nodo.estado.textContent = texto;
        if (nodo.box.dataset.estado !== nivel) {
          nodo.box.dataset.estado = nivel;
          if (!reducirMovimiento() && nodo.box.isConnected) {
            nodo.box.classList.remove('scada-node-changed'); void nodo.box.offsetWidth;
            nodo.box.classList.add('scada-node-changed');
          }
        }
      }
      for (const [id,nodo] of elementos) {
        if (!ids.has(id)) { nodo.box.remove(); elementos.delete(id); }
      }
      // Mantener el orden del inventario sin reconstruir cada nodo.
      for (const [posicion, id] of [...ids].sort((a,b) => Number(a)-Number(b)).entries()) {
        const nodo = elementos.get(id);
        if (nodo && nodos.children[posicion] !== nodo.box) {
          nodos.insertBefore(nodo.box, nodos.children[posicion] || null);
        }
      }
      meta.textContent = `${ids.size} equipos · Datos recientes`;
      seccion.dataset.frescura = 'ok';
    }
    boton.addEventListener('click', () => {
      contenido.hidden = !contenido.hidden;
      boton.setAttribute('aria-expanded', String(!contenido.hidden));
      boton.textContent = contenido.hidden ? 'Mostrar mapa lógico' : 'Ocultar mapa lógico';
      if (!contenido.hidden && !reducirMovimiento()) contenido.classList.add('scada-map-reveal');
    });
    window.addEventListener('plataforma:estado', e => actualizar(e.detail?.plc || []));
    document.addEventListener('plataforma:mapa-invalido', () => {
      seccion.dataset.frescura = 'sin-datos';
      meta.textContent = 'Datos no verificables';
      for (const nodo of elementos.values()) {
        nodo.box.dataset.estado = 'sin-datos';
        nodo.estado.textContent = 'DATOS DESACTUALIZADOS';
      }
    });
  }

  function activarSalaControl() {
    if (location.pathname !== '/') return;
    const barra = document.querySelector('.herramientas-plc');
    if (!barra || barra.querySelector('.scada-wallboard-button')) return;
    const boton = crear('button', 'scada-wallboard-button', '▣ Sala de control'); boton.type = 'button';
    boton.setAttribute('aria-pressed', 'false');
    boton.title = 'Vista de 14 PLC para monitor de laboratorio, sin modificar ningún equipo';
    const salida = crear('button', 'scada-wallboard-exit', 'Salir de sala de control'); salida.type = 'button';
    salida.hidden = true;
    const entrar = valor => {
      document.body.classList.toggle('scada-wallboard', valor);
      boton.setAttribute('aria-pressed', String(valor));
      salida.hidden = !valor;
      if (valor) {
        // El modo sala de control debe mostrar TODOS los equipos.
        const buscar = document.getElementById('buscar-plc');
        const filtrar = document.getElementById('filtrar-plc');
        if (buscar && buscar.value) { buscar.value=''; buscar.dispatchEvent(new Event('input',{bubbles:true})); }
        if (filtrar && filtrar.value !== 'todos') { filtrar.value='todos'; filtrar.dispatchEvent(new Event('change',{bubbles:true})); }
      }
    };
    boton.addEventListener('click', () => entrar(!document.body.classList.contains('scada-wallboard')));
    salida.addEventListener('click', () => entrar(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('scada-wallboard')) entrar(false); });
    barra.append(boton);
    document.body.append(salida);
  }

  // Panel lateral de solo lectura, reutiliza el estado recibido por el centro de avisos.
  // No consulta ni modifica registros de PLC y nunca simula valores no disponibles.
  function activarDiagnosticoLateral() {
    if (location.pathname !== '/') return;
    const lista = document.getElementById('lista-plc');
    if (!lista || document.getElementById('scada-diagnostic-drawer')) return;
    const overlay = crear('div', 'scada-diagnostic-overlay');
    overlay.hidden = true;
    const panel = crear('aside', 'scada-diagnostic-drawer');
    panel.id = 'scada-diagnostic-drawer';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'scada-diagnostic-title');
    const cabecera = crear('div', 'scada-diagnostic-head');
    const titulos = crear('div');
    titulos.append(crear('span', 'scada-diagnostic-eyebrow', 'DIAGNÓSTICO DEL EQUIPO'));
    const titulo = crear('h2', '', 'PLC'); titulo.id = 'scada-diagnostic-title';
    const modelo = crear('p', '', '');
    titulos.append(titulo, modelo);
    const cerrar = crear('button', 'scada-diagnostic-close', 'Cerrar ×');
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Cerrar panel de diagnóstico');
    cabecera.append(titulos, cerrar);
    const vigencia = crear('div', 'scada-diagnostic-freshness', 'Esperando datos del supervisor');
    vigencia.setAttribute('role', 'status');
    const grid = crear('div', 'scada-diagnostic-grid');
    const campos = [
      ['Comunicación', 'comunicacion'], ['Modo de operación', 'modoOperacion'],
      ['Diagnóstico de falla', 'falla'], ['Calidad', 'calidad'],
      ['Dirección IP', 'ip'], ['MAC esperada', 'macEsperada'],
      ['MAC detectada', 'macDetectada'], ['Identidad de red', 'identidad'],
      ['Tiempo conectado', 'tiempoConexion'], ['Tiempo en falla', 'tiempoFalla'],
      ['Última respuesta', 'ultimaRespuesta']
    ];
    const valores = new Map();
    for (const [etiqueta, clave] of campos) {
      const caja = crear('div', 'scada-diagnostic-field');
      const lbl = crear('span', 'scada-diagnostic-label', etiqueta);
      const valor = crear('strong', 'scada-diagnostic-value', '—');
      caja.append(lbl, valor); grid.append(caja);
      valores.set(clave, valor);
    }
    const nota = crear('p', 'scada-diagnostic-note',
      'Información de solo lectura procedente del supervisor. Sin comunicación no significa falla interna confirmada.');
    const acciones = crear('div', 'scada-diagnostic-actions');
    const ir = crear('button', '', 'Localizar tarjeta'); ir.type = 'button';
    const timeline = crear('button', '', 'Ver timeline'); timeline.type = 'button';
    acciones.append(ir, timeline);
    panel.append(cabecera, vigencia, grid, nota, acciones);
    document.body.append(overlay, panel);
    let abierto = null;
    let anteriorFoco = null;
    let ultimoEstado = new Map();
    let marca = 0;
    let disponible = false;
    const texto = valor => valor === undefined || valor === null || valor === '' ? 'No disponible' : String(valor);
    const formatearFecha = fecha => {
      if (!fecha) return 'No disponible';
      const date = new Date(fecha);
      return Number.isNaN(date.getTime()) ? 'No disponible' : date.toLocaleString('es-EC', {
        timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'medium'
      });
    };
    function pintar() {
      if (!abierto) return;
      const d = ultimoEstado.get(abierto);
      const valido = disponible && marca && Date.now() - marca <= 13000;
      panel.dataset.frescura = valido ? 'actual' : 'sin-datos';
      titulo.textContent = 'PLC-' + abierto;
      modelo.textContent = d?.modelo || 'Equipo del inventario';
      vigencia.textContent = valido ? 'Lectura actual del backend · ' + relojEcuador(new Date(marca)) :
        'DATOS NO VERIFICABLES · Esperando una respuesta HTTP válida';
      const macDetectadaValida = d && /^[0-9A-F]{12}$/i.test(String(d.macDetectada || '').replace(/[^0-9A-F]/ig, ''));
      const datos = valido && d ? {
        comunicacion: texto(d.comunicacion),
        modoOperacion: d.comunicacion === 'CONECTADO' ? texto(d.modoOperacion) : 'No determinado',
        falla: d.comunicacion === 'CONECTADO' ?
          d.estadoFalla === true ? 'Falla reportada' : d.estadoFalla === false ? 'Sin falla reportada' : 'No determinado' : 'No determinado',
        calidad: texto(d.calidad), ip: texto(d.ip),
        macEsperada: texto(d.macEsperada), macDetectada: texto(d.macDetectada),
        identidad: d.identidadCoincide === true ? 'Coincide' :
          d.identidadCoincide === false && macDetectadaValida ? 'No coincide · verificar' : 'No verificada',
        tiempoConexion: texto(d.tiempoConexion), tiempoFalla: texto(d.tiempoFalla),
        ultimaRespuesta: formatearFecha(d.ultimaRespuesta)
      } : {};
      for (const [clave, valor] of valores) {
        valor.textContent = datos[clave] ?? '—';
        valor.dataset.estado = clave === 'comunicacion' && valido ?
          (d.comunicacion === 'CONECTADO' ? 'ok' : 'warning') : '';
      }
    }
    function cerrarPanel() {
      if (!abierto) return;
      abierto = null;
      overlay.hidden = true;
      panel.hidden = true;
      document.body.classList.remove('scada-drawer-open');
      if (anteriorFoco?.isConnected) anteriorFoco.focus({preventScroll:true});
      anteriorFoco = null;
    }
    function abrirPanel(id, origen) {
      abierto = String(id);
      anteriorFoco = origen;
      overlay.hidden = false;
      panel.hidden = false;
      document.body.classList.add('scada-drawer-open');
      pintar();
      cerrar.focus({preventScroll:true});
    }
    function crearBotones(root) {
      for (const card of root.querySelectorAll?.('.plc') || []) {
        if (card.querySelector('.scada-diagnostic-open')) continue;
        const id = card.id.replace(/^plc-/, '');
        if (!/^\d{1,8}$/.test(id)) continue;
        const destino = card.querySelector('.plc-contenido') || card;
        const boton = crear('button', 'scada-diagnostic-open', 'Ver diagnóstico');
        boton.type = 'button'; boton.dataset.plc = id;
        boton.setAttribute('aria-label', 'Abrir diagnóstico del PLC-' + id);
        destino.append(boton);
      }
    }
    crearBotones(lista);
    new MutationObserver(() => crearBotones(lista)).observe(lista, {childList:true});
    lista.addEventListener('click', e => {
      const boton = e.target.closest('.scada-diagnostic-open');
      if (boton && lista.contains(boton)) abrirPanel(boton.dataset.plc, boton);
    });
    cerrar.addEventListener('click', cerrarPanel);
    overlay.addEventListener('click', cerrarPanel);
    document.addEventListener('keydown', e => {
      if (!abierto) return;
      if (e.key === 'Escape') { e.preventDefault(); cerrarPanel(); }
      else if (e.key === 'Tab') {
        const disponibles = [...panel.querySelectorAll('button:not([disabled])')];
        const primero = disponibles[0], ultimo = disponibles[disponibles.length-1];
        if (e.shiftKey && document.activeElement === primero) {e.preventDefault(); ultimo.focus();}
        else if (!e.shiftKey && document.activeElement === ultimo) {e.preventDefault(); primero.focus();}
      }
    });
    ir.addEventListener('click', () => { const id = abierto; cerrarPanel(); irAlPLC(id); });
    timeline.addEventListener('click', () => {const id = abierto; cerrarPanel(); irATimeline(id);});
    window.addEventListener('plataforma:estado', e => {
      ultimoEstado = new Map((e.detail?.plc || []).map(p => [String(p.id), p]));
      marca = e.detail?.comprobadoEn || Date.now();
      disponible = e.detail?.estado === 'ACTIVO';
      if (abierto) pintar();
    });
    window.addEventListener('plataforma:sin-datos', () => { disponible = false; if (abierto) pintar(); });
    setInterval(() => { if (abierto && marca && Date.now() - marca > 13000 && disponible) {disponible=false; pintar();} }, 2000);
  }

  function iniciar() {
    definirContextoVisual();
    contextualizar();
    activarCentroOperativo();
    activarMapaLogico();
    activarSalaControl();
    animarInterfaz();
    activarDiagnosticoLateral();
    activarSuperficiesPremium();
    observarActualizacionesVisuales();
    window.PLATAFORMA_LOCALIZAR_PLC = localizarPLC;
    activarVistaPremium();
    resolverEnlacePLC();
    activarAvisos();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, {once:true});
  else iniciar();
})();
