// ver_peatonal.js (v1) — Lista de ACCESO_PEATONAL.
document.addEventListener('DOMContentLoaded', () => {
    // ---------- Firebase ----------
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();

    // ---------- UI wrapper ----------
    const UX = {
        show: (msg) => (window.UI && UI.showOverlay) ? UI.showOverlay(msg) : void 0,
        hide: () => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
        alert: (title, msg) => (window.UI && UI.alert) ? UI.alert(title, msg) : alert((title ? title + '\n\n' : '') + (msg || '')),
    };

    // ---------- DOM ----------
    const cont = document.getElementById('peatonal-container');
    const fechaInput = document.getElementById('fecha-filtro');
    const btnBuscar = document.getElementById('buscar-btn');
    const btnLimpiar = document.getElementById('limpiar-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');

    // ---------- Estado ----------
    const PAGE_SIZE = 10;
    let perfil = null;            // { CLIENTE, UNIDAD }
    let lastDoc = null;           // cursor para "siguiente"
    let pageStack = [];           // pila de primeros docs por página para retroceder
    let unsubscribeLive = null;   // Listener en tiempo real

    // ---------- Sesión ----------
    auth.onAuthStateChanged(async (user) => {
        if (!user) { window.location.href = 'index.html'; return; }
        try {
            const userId = user.email.split('@')[0];
            const d = await db.collection('USUARIOS').doc(userId).get();
            if (!d.exists) throw new Error('No se encontró tu perfil.');
            const { CLIENTE, UNIDAD } = d.data();
            perfil = { CLIENTE, UNIDAD };
            await cargarRegistros();
        } catch (e) {
            console.error(e);
            UX.alert('Error', e.message || 'No se pudo cargar tu perfil.');
        }
    });

    const startEndOfDay = (yyyy_mm_dd) => {
        // Como FECHA_INGRESO es un string "YYYY-MM-DD" o similar en la DB según imagen, 
        // pero a veces se guarda como timestamp. Asumiremos timestamp para ordenamiento 
        // o filtrado si el campo principal de orden es timestamp.
        // Sin embargo, la imagen muestra FECHA_INGRESO: "2026-01-21".
        // El ordenamiento ideal es por un campo timestamp real si existe, o created_at.
        // Si no, tendremos que filtrar por string. 
        // Vemos que la colección ACCESO_PEATONAL suele tener 'timestamp' en otros proyectos, 
        // pero aquí usaremos el filtro indicado.
        // Para simplificar y dado que la imagen muestra campos separados de fecha y hora,
        // intentaremos ordenar por FECHA_INGRESO (string) y HORA_INGRESO (string).

        // NOTA: Firestore no ordena bien strings de fecha si no están en formato ISO estricto Y-M-D.
        // Asumiremos que FECHA_INGRESO es YYYY-MM-DD.
        return [yyyy_mm_dd, yyyy_mm_dd];
    };

    function buildQuery(direction, cursor) {
        // Corrección: peatonal.js guarda en MAYÚSCULAS (toUpperIfText).
        // Si el perfil de usuario tiene "Grupo Educa", debemos buscar "GRUPO EDUCA".
        const CLIENTE = (perfil.CLIENTE || '').toUpperCase();
        const UNIDAD = (perfil.UNIDAD || '').toUpperCase();

        let ref = db.collection('ACCESO_PEATONAL')
            .where('CLIENTE', '==', CLIENTE)
            .where('UNIDAD', '==', UNIDAD);

        if (fechaInput.value) {
            ref = ref.where('FECHA_INGRESO', '==', fechaInput.value);
        }

        // Determinar límite: 2 para carga inicial sin filtro, PAGE_SIZE para otros casos
        const finalLimit = (!fechaInput.value && !direction && !cursor) ? 2 : PAGE_SIZE;

        ref = ref.orderBy('FECHA_INGRESO', 'desc').limit(finalLimit);

        if (direction === 'next' && cursor) ref = ref.startAfter(cursor);
        if (direction === 'prev' && cursor) ref = ref.endBefore(cursor).limitToLast(PAGE_SIZE);
        return ref;
    }

    // Helper para convertir YYYY-MM-DD a DD/MM/YYYY
    const fmtDateStr = (s) => {
        if (!s || s.length < 10) return s || '';
        const [y, m, d] = s.split('-');
        return `${d}/${m}/${y}`;
    };

    function cardPeatonalHTML(data) {
        // Campos solicitados:
        // AREA, EMPRESA, FECHA_INGRESO, HORA_INGRESO, FECHA_SALIDA, HORA_FIN, 
        // ESTADO, MOTIVO, NOMBRES_COMPLETOS, TIPO_ACCESO (corregido), UNIDAD, USUARIO, USUARIO_SALIDA

        // Formato solicitado: dd/mm/yyyy y hh:mm:ss
        const fechaIng = fmtDateStr(data.FECHA_INGRESO);
        const horaIng = data.HORA_INGRESO || '';
        const ingreso = `${fechaIng} ${horaIng}`.trim();

        const fechaSal = fmtDateStr(data.FECHA_SALIDA);
        const horaSal = data.HORA_FIN || ''; // Es HORA_FIN según estructura
        const salida = `${fechaSal} ${horaSal}`.trim();

        const estado = data.ESTADO || '—';
        const nombre = data.NOMBRES_COMPLETOS || '—';
        const empresa = data.EMPRESA || '—';
        const motivo = data.MOTIVO || '—';
        const area = data.AREA || '—';
        const usuarioIngreso = data.USUARIO || '—';
        const usuarioSalida = data.USUARIO_SALIDA || '—';
        const tipo = data.TIPO_ACCESO || data.TIPO_ACCES || '—';

        // Badge color
        let badgeClass = 'badge-gray';
        if (estado === 'EN PLANTA' || estado === 'INGRESO') badgeClass = 'badge-green';
        if (estado === 'SALIO' || estado === 'CERRADO') badgeClass = 'badge-red';

        return `
      <article class="list-card" style="border-left: 4px solid #3182ce;">
        <div class="list-card-header">
          <span class="badge ${badgeClass}">${estado}</span>
          <span class="muted">${ingreso}</span>
        </div>
        
        <div style="font-size: 1rem; font-weight: 600; margin-bottom: 4px;">${nombre}</div>
        <div class="muted" style="margin-bottom: 8px;">${empresa} - ${tipo}</div>

        <div style="font-size: 0.9rem; margin-bottom: 0.5rem; line-height: 1.5;">
          <div><strong>Área:</strong> ${area}</div>
          <div><strong>Motivo:</strong> ${motivo}</div>
          <div><strong>Ingreso registrado por:</strong> ${usuarioIngreso}</div>
          ${(fechaSal || horaSal) ? `<div><strong>Salida:</strong> ${salida}</div>` : ''}
          ${usuarioSalida !== '—' ? `<div><strong>Salida registrada por:</strong> ${usuarioSalida}</div>` : ''}
        </div>
      </article>`;
    }

    function render(docs) {
        cont.innerHTML = '';
        if (!docs.length) {
            cont.innerHTML = `<p class="muted">Sin registros peatonales.</p>`;
            return;
        }

        docs.forEach(d => {
            const data = d.data();
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = cardPeatonalHTML(data);
            const article = tempDiv.firstElementChild;

            // Add button
            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = "margin-top:10px; border-top:1px solid #444; padding-top:8px; text-align:right;";
            btnContainer.innerHTML = `
              <button class="btn-report" style="background:transparent; border:1px solid #666; color:#ccc; border-radius:4px; padding:5px 10px; cursor:pointer;">
                  <i class="fas fa-file-pdf" style="color:#e74c3c;"></i> Descargar Reporte
              </button>
            `;
            btnContainer.querySelector('button').addEventListener('click', (e) => {
                e.stopPropagation();
                ReportService.generateAndUpload(data, 'PEATONAL', 'peatonal');
            });
            article.appendChild(btnContainer);

            cont.appendChild(article);
        });
    }

    // ---------- Carga / paginación ----------
    let allLoadedData = [];

    async function cargarRegistros(direction) {
        if (!perfil) return;
        UX.show('Cargando historial peatonal…');

        try {
            // 1. Carga Instantánea desde Caché Local (Zero-Read load)
            if (!direction && !fechaInput.value && window.offlineStorage) {
                const cached = await offlineStorage.getConfig('acceso-peatonal-hoy');
                if (cached && cached.length > 0) {
                    console.log('[ver_peatonal] Carga instantánea desde caché (Zero-Read).');
                    renderData(cached.slice(0, 2));
                    UX.hide();
                }
            }

            // 2. Listeners en Tiempo Real + Persistencia Proactiva
            if (!direction && !fechaInput.value) {
                if (unsubscribeLive) unsubscribeLive();

                UX.show('Sincronizando peatonal...');
                unsubscribeLive = db.collection('ACCESO_PEATONAL')
                    .where('CLIENTE', '==', perfil.CLIENTE)
                    .where('UNIDAD', '==', perfil.UNIDAD)
                    .orderBy('FECHA_INGRESO', 'desc')
                    .limit(2)
                    .onSnapshot(snap => {
                        console.log('[Peatonal] Update live recibido');
                        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                        renderData(data);

                        // Persistir en caché local
                        if (window.offlineStorage && !snap.empty) {
                            offlineStorage.saveConfig('acceso-peatonal-hoy', data);
                        }

                        if (!snap.empty) lastDoc = snap.docs[snap.docs.length - 1];
                        UX.hide();
                    }, err => {
                        console.error('[Peatonal] Error live:', err);
                        UX.hide();
                    });
                return;
            }

            // Cancelar live si hay filtro
            if (unsubscribeLive) {
                unsubscribeLive();
                unsubscribeLive = null;
            }

            let cursor = null;
            if (direction === 'next') cursor = lastDoc;
            if (direction === 'prev') {
                if (pageStack.length > 1) {
                    pageStack.pop();
                    cursor = pageStack[pageStack.length - 1];
                } else { UX.hide(); return; }
            }

            if (!direction) allLoadedData = [];

            const snap = await buildQuery(direction, cursor).get();

            if (snap.empty) {
                if (allLoadedData.length === 0) renderData([]);
                prevBtn.disabled = pageStack.length <= 1;
                nextBtn.disabled = true;
                UX.hide();
                return;
            }

            const first = snap.docs[0];
            const last = snap.docs[snap.docs.length - 1];
            lastDoc = last;
            if (direction !== 'prev') pageStack.push(first);

            const fetchedData = snap.docs.map(d => d.data());
            if (!direction) allLoadedData = fetchedData;
            else snap.docs.forEach(d => allLoadedData.push(d.data()));

            renderData(fetchedData);

            prevBtn.disabled = pageStack.length <= 1;
            nextBtn.disabled = snap.docs.length < PAGE_SIZE;
        } catch (e) {
            console.error('Error cargando peatonal:', e);
            let msg = 'No se pudieron cargar los registros.';
            if (e.message.includes('index')) {
                msg = '<i class="fas fa-exclamation-triangle" style="color:orange;"></i> Falta índice en Firebase.<br><br>' +
                    '<span style="font-size:0.9rem">Abre la consola del navegador (F12) y busca el enlace para crearlo.</span>';
            } else {
                msg += `<br><br><small style="color:#f87171">${e.message}</small>`;
            }
            cont.innerHTML = `<div style="text-align:center; padding:2rem;">${msg}</div>`;
        } finally {
            UX.hide();
        }
    }

    // Refactor de render para aceptar datos planos en lugar de docs
    function renderData(dataList) {
        cont.innerHTML = '';
        if (!dataList || !dataList.length) {
            cont.innerHTML = `<p class="muted">Sin registros peatonales.</p>`;
            return;
        }

        dataList.forEach(data => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = cardPeatonalHTML(data);
            const article = tempDiv.firstElementChild;

            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = "margin-top:10px; border-top:1px solid #444; padding-top:8px; text-align:right;";
            btnContainer.innerHTML = `
              <button class="btn-report" style="background:transparent; border:1px solid #666; color:#ccc; border-radius:4px; padding:5px 10px; cursor:pointer;">
                  <i class="fas fa-file-pdf" style="color:#e74c3c;"></i> Descargar Reporte
              </button>
            `;
            btnContainer.querySelector('button').addEventListener('click', (e) => {
                e.stopPropagation();
                ReportService.generateAndUpload(data, 'PEATONAL', 'peatonal');
            });
            article.appendChild(btnContainer);
            cont.appendChild(article);
        });
    }

    // ---------- Eventos ----------
    const btnGeneral = document.getElementById('btnGeneralReport');
    if (btnGeneral) {
        btnGeneral.addEventListener('click', () => {
            if (allLoadedData.length === 0) {
                UX.alert('Aviso', 'No hay datos cargados para generar el reporte general.');
                return;
            }
            ReportService.generateGeneralListReport(allLoadedData, 'PEATONAL', 'REPORTE GENERAL PEATONAL');
        });
    }

    btnBuscar?.addEventListener('click', () => {
        pageStack = []; lastDoc = null; cargarRegistros();
    });
    btnLimpiar?.addEventListener('click', () => {
        fechaInput.value = ''; pageStack = []; lastDoc = null; cargarRegistros();
    });
    nextBtn?.addEventListener('click', () => cargarRegistros('next'));
    prevBtn?.addEventListener('click', () => cargarRegistros('prev'));
});
