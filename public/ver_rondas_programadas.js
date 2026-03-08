document.addEventListener('DOMContentLoaded', async () => {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();

    const resultsList = document.getElementById('results-list');
    const btnSearch = document.getElementById('btn-search');
    const btnClear = document.getElementById('btn-clear');
    const filterDateInput = document.getElementById('filter-date');
    const loadMoreContainer = document.getElementById('load-more-container');
    const btnLoadMore = document.getElementById('btn-load-more');

    let lastDoc = null;
    let isFilterActive = false;
    const LIMIT = 20;
    let unsubscribeLive = null;

    // 1. Autenticación y Obtención de Perfil
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        const userId = user.email.split('@')[0];
        try {
            let userData = null;
            if (window.getUserProfile) {
                userData = await window.getUserProfile(userId);
            } else {
                const doc = await db.collection('USUARIOS').doc(userId).get();
                if (doc.exists) userData = doc.data();
            }

            if (userData) {
                userCliente = (userData.CLIENTE || userData.cliente || '').toUpperCase();
                userUnidad = (userData.UNIDAD || userData.unidad || '').toUpperCase();
                cargarRegistros();
            } else {
                resultsList.innerHTML = '<div class="info-msg">No se encontró perfil de usuario.</div>';
            }
        } catch (e) {
            console.error("Error al obtener perfil usuario:", e);
            resultsList.innerHTML = `<div class="info-msg">Error al cargar perfil: ${e.message}</div>`;
        }
    });

    // Variables globales para reporte
    let allLoadedData = [];

    // Helper para renderizar los datos (usado por onSnapshot y cargarRegistros)
    function renderResults(dataArray) {
        resultsList.innerHTML = '';
        allLoadedData = []; // Reset on new render
        if (dataArray.length === 0) {
            resultsList.innerHTML = '<div class="info-msg">No se encontraron rondas programadas.</div>';
            loadMoreContainer.style.display = 'none';
            return;
        }
        dataArray.forEach(data => {
            allLoadedData.push(data); // Store for report
            const card = crearCard(data);
            resultsList.appendChild(card);
        });
    }

    // 2. Cargar Registros
    async function cargarRegistros(isNextPage = false) {
        const dateVal = filterDateInput.value; // Get dateVal here to be accessible for onSnapshot condition

        if (!isNextPage) {
            resultsList.innerHTML = '<div class="info-msg">Cargando...</div>';
            lastDoc = null;
            loadMoreContainer.style.display = 'none';
            allLoadedData = []; // Reset on new search

            // 1. Carga Instantánea desde Caché Local (Zero-Read load)
            if (!dateVal && window.offlineStorage) {
                const cached = await offlineStorage.getConfig('rondas-programadas-hoy');
                if (cached && cached.length > 0) {
                    console.log('[Rondas Programadas] Carga desde caché.');
                    renderResults(cached.slice(0, 2));
                    loadMoreContainer.style.display = 'block';
                }
            }

            // 2. Listeners en Tiempo Real + Persistencia Proactiva
            if (!dateVal) { // Only use onSnapshot if no date filter is active
                if (unsubscribeLive) unsubscribeLive(); // Unsubscribe previous listener
                unsubscribeLive = db.collection('RONDAS_COMPLETADAS') // Changed to RONDAS_COMPLETADAS based on existing code
                    .where('cliente', '==', userCliente)
                    .where('unidad', '==', userUnidad)
                    .orderBy('horarioInicio', 'desc')
                    .limit(2)
                    .onSnapshot(snap => {
                        console.log('[Rondas Programadas] Update live');
                        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                        renderResults(data); // Use the new render helper

                        // Persistir en caché local
                        if (window.offlineStorage && !snap.empty) {
                            offlineStorage.saveConfig('rondas-programadas-hoy', data);
                        }

                        if (!snap.empty) lastDoc = snap.docs[snap.docs.length - 1];
                        if (snap.docs.length >= 2) {
                            loadMoreContainer.style.display = 'block';
                        } else {
                            loadMoreContainer.style.display = 'none';
                        }
                    }, error => {
                        console.error("Error en onSnapshot:", error);
                        resultsList.innerHTML = `<div class="info-msg" style="color:salmon;">Error en tiempo real: ${error.message}</div>`;
                    });
                return; // Exit function after setting up live listener
            } else if (unsubscribeLive) { // If date filter is active, stop live listener
                unsubscribeLive();
                unsubscribeLive = null;
            }
        }

        // If a date filter is active or loading more, proceed with traditional query
        try {
            let query = db.collection('RONDAS_COMPLETADAS');

            // Filtros obligatorios por Cliente y Unidad (claves minúscula según instrucciones, valores mayúscula)
            query = query.where('cliente', '==', userCliente)
                .where('unidad', '==', userUnidad);

            // Filtro por fecha (usando horarioInicio)
            const dateVal = filterDateInput.value;
            if (dateVal) {
                // Rango de fecha
                const start = new Date(dateVal + 'T00:00:00');
                const end = new Date(dateVal + 'T23:59:59');
                query = query.where('horarioInicio', '>=', start)
                    .where('horarioInicio', '<=', end);
                // Ordenar
                query = query.orderBy('horarioInicio', 'desc');
            } else {
                // Orden por defecto
                query = query.orderBy('horarioInicio', 'desc');
            }

            // Paginación y límite dinámico
            const finalLimit = (!dateVal && !isNextPage) ? 2 : LIMIT;

            if (isNextPage && lastDoc) {
                query = query.startAfter(lastDoc);
            }
            query = query.limit(finalLimit);

            const snapshot = await query.get();

            if (!isNextPage) {
                resultsList.innerHTML = '';
            }

            if (snapshot.empty) {
                if (!isNextPage) {
                    resultsList.innerHTML = '<div class="info-msg">No se encontraron rondas programadas.</div>';
                } else {
                    loadMoreContainer.style.display = 'none';
                }
                return;
            }

            lastDoc = snapshot.docs[snapshot.docs.length - 1];

            snapshot.forEach(doc => {
                const data = doc.data();
                allLoadedData.push(data); // Store for report
                const card = crearCard(data);
                resultsList.appendChild(card);
            });

            if (snapshot.docs.length === LIMIT) {
                loadMoreContainer.style.display = 'block';
            } else {
                loadMoreContainer.style.display = 'none';
            }

        } catch (error) {
            console.error("Error cargando rondas programadas:", error);
            let msg = error.message;
            if (msg.includes("requires an index")) {
                msg = "Falta índice en Firestore. Revisa la consola para el link de creación.";
            }
            if (!isNextPage) {
                resultsList.innerHTML = `<div class="info-msg" style="color:salmon;">Error: ${msg}</div>`;
            } else {
                alert("Error cargando más: " + msg);
            }
        }
    }

    // ... (rest of crearCard and helper functions remain same, update btnGeneralReport listener)

    // 3. Renderizar Card
    function crearCard(data) {
        const div = document.createElement('div');
        div.className = 'list-card';

        // Campos: nombre, estado, unidad, horarioInicio
        const nombre = data.nombre || 'Sin nombre';
        const estado = data.estado || 'Desconocido';
        const unidad = data.unidad || '--';

        let fechaTexto = 'Sin fecha';
        if (data.horarioInicio && data.horarioInicio.toDate) {
            fechaTexto = toDateTimeText(data.horarioInicio.toDate());
        }

        // Color del badge estado (usando clases de style.css si es posible o inline para especificidad)
        let badgeClass = 'badge-gray';
        if (estado === 'TERMINADA' || estado === 'REALIZADA') badgeClass = 'badge-info'; // Usamos info (azul) o custom green
        else if (estado === 'INCOMPLETA') badgeClass = 'badge-warning';
        else if (estado === 'NO REALIZADA') badgeClass = 'badge-gray'; // O rojo si definimos badge-danger

        // Override manual para colores específicos si style.css no tiene danger/success
        let badgeStyle = '';
        if (estado === 'TERMINADA' || estado === 'REALIZADA') badgeStyle = 'background:#d1fae5; color:#065f46;'; // Green
        if (estado === 'NO REALIZADA') badgeStyle = 'background:#fee2e2; color:#991b1b;'; // Red

        div.innerHTML = `
      <div class="list-card-head">
        <h3 class="list-card-title">${nombre}</h3>
        <span class="badge ${badgeClass}" style="${badgeStyle}">${estado}</span>
      </div>
      <div class="list-card-meta">
        <span class="chip"><i class="fas fa-clock"></i> ${fechaTexto}</span>
        <span class="chip"><i class="fas fa-building"></i> ${unidad}</span>
      </div>
      ${data.usuario ? `
      <div style="margin-top:0.6rem; font-size:0.9rem; color:var(--theme-text);">
        <strong>Usuario:</strong> ${data.usuario}
      </div>` : ''}
      <div style="margin-top:10px; border-top:1px solid #444; padding-top:8px; text-align:right;">
          <button class="btn-report" style="background:transparent; border:1px solid #666; color:var(--theme-text); border-radius:4px; padding:5px 10px; cursor:pointer;">
              <i class="fas fa-file-pdf" style="color:#e74c3c;"></i> Descargar Reporte
          </button>
      </div>
    `;

        div.querySelector('.btn-report').addEventListener('click', (e) => {
            e.stopPropagation();
            // Asegurar que tenemos puntos para el reporte
            ReportService.generateAndUpload(data, 'RONDA_PROGRAMADA', 'ronda');
        });

        return div;
    }

    // Helper Fecha
    function toDateTimeText(dateObj) {
        if (!dateObj) return "";
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        const seconds = String(dateObj.getSeconds()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    }

    // Event Listeners
    btnSearch.addEventListener('click', () => {
        isFilterActive = true;
        cargarRegistros(false);
    });

    btnClear.addEventListener('click', () => {
        filterDateInput.value = '';
        isFilterActive = false;
        cargarRegistros(false);
    });

    btnLoadMore.addEventListener('click', () => {
        cargarRegistros(true);
    });

    const btnGeneral = document.getElementById('btnGeneralReport');
    if (btnGeneral) {
        btnGeneral.addEventListener('click', () => {
            if (allLoadedData.length === 0) {
                alert('No hay datos cargados para generar el reporte general.');
                return;
            }
            ReportService.generateGeneralListReport(allLoadedData, 'RONDA_PROGRAMADA', 'REPORTE GENERAL DE RONDAS PROGRAMADAS');
        });
    }
});
