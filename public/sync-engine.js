/**
 * sync-engine.js - Motor central de sincronización incremental
 * Gestiona la descarga masiva de catálogos y el control de versiones local.
 */

(function () {
    const db = firebase.firestore();

    const SyncEngine = {
        // Definición de recursos a sincronizar
        RESOURCES: {
            QRS: 'qrs',
            INCIDENT_TYPES: 'incident-types',
            CONSIGNAS_PERM: 'consignas-perm',
            CONSIGNAS_TEMP: 'consignas-temp',
            ACCESO_PEATONAL_HOY: 'peatonal-hoy',
            ACCESO_VEHICULAR_HOY: 'vehicular-hoy',
            INCIDENCIAS_HOY: 'incidencias-hoy',
            CATALOGOS_ACCESO: 'catalogos-acceso',
            PUESTOS: 'puestos',
            CUADERNO_HOY: 'cuaderno-hoy',
            VEHICULOS_DENTRO: 'vehiculos-dentro',
            PEATONES_DENTRO: 'peatones-dentro',
            RONDAS_DISPONIBLES: 'rondas-disponibles'
        },

        /**
         * Sincroniza toda la configuración del sistema para el cliente y unidad actual.
         * Solo descarga si detecta que la versión en el servidor es más reciente.
         */
        async syncAll(userProfile, force = false) {
            if (!userProfile || !userProfile.CLIENTE || !userProfile.UNIDAD) {
                console.warn('[SyncEngine] Perfil incompleto para sincronizar.');
                return false;
            }

            const { CLIENTE, UNIDAD } = userProfile;
            console.log(`[SyncEngine] 🔄 Iniciando sincronización global para ${CLIENTE}/${UNIDAD}`);

            if (!navigator.onLine) {
                console.log('[SyncEngine] Offline: Saltando sincronización de red.');
                return false;
            }

            try {
                if (window.UI && UI.updateOfflineBadge) UI.updateOfflineBadge('syncing');

                // --- NUEVO: THROTTLE POR TIEMPO (10 MINUTOS) ---
                const SYNC_THROTTLE_MS = 10 * 60 * 1000; // 10 minutos
                const lastCheck = await offlineStorage.getGlobalData(`last-sync-check-${CLIENTE}-${UNIDAD}`);
                const now = Date.now();

                if (!force && lastCheck && (now - lastCheck < SYNC_THROTTLE_MS)) {
                    console.log(`[SyncEngine] ⏳ Sincronización omitida (última hace ${Math.round((now - lastCheck) / 1000)}s).`);
                    if (window.UI && UI.updateOfflineBadge) UI.updateOfflineBadge('done');
                    return true;
                }

                // 1. Verificar Metadatos de Versión
                const metaPath = `CONFIG_METADATA/${CLIENTE}_${UNIDAD}`;
                const metaDoc = await db.doc(metaPath).get().catch(() => null);
                const serverVersion = metaDoc && metaDoc.exists ? metaDoc.data().version : Date.now();
                const localVersion = await offlineStorage.getGlobalData(`sync-version-${CLIENTE}-${UNIDAD}`);

                if (!force && localVersion && localVersion >= serverVersion) {
                    console.log('[SyncEngine] ✅ Configuración actualizada. No se requiere descarga.');
                    // Actualizamos el last-check incluso si no hubo descarga porque confirmamos que estamos al día
                    await offlineStorage.setGlobalData(`last-sync-check-${CLIENTE}-${UNIDAD}`, now);
                    if (window.UI && UI.updateOfflineBadge) UI.updateOfflineBadge('done');
                    return true;
                }

                console.log('[SyncEngine] 📥 Descargando nueva configuración...');

                // 2. Descargas Masivas en Paralelo (Limitar a los últimos 5 para deltas)
                const [
                    qrs,
                    incidentTypes,
                    consignasPerm,
                    consignasTemp,
                    peatonalHoy,
                    vehicularHoy,
                    incidenciasHoy,
                    catalogosAcceso,
                    puestos,
                    cuadernoHoy,
                    vehiculosDentro,
                    peatonesDentro,
                    rondasDisponibles
                ] = await Promise.all([
                    this._fetchQRs(CLIENTE, UNIDAD),
                    this._fetchIncidentTypes(CLIENTE, UNIDAD),
                    this._fetchConsignas(CLIENTE, UNIDAD, 'CONSIGNA_PERMANENTE'),
                    this._fetchConsignas(CLIENTE, UNIDAD, 'CONSIGNA_TEMPORAL'),
                    this._fetchAccesosHoy(CLIENTE, UNIDAD, 'ACCESO_PEATONAL', 2),
                    this._fetchAccesosHoy(CLIENTE, UNIDAD, 'ACCESO_VEHICULAR', 2),
                    this._fetchAccesosHoy(CLIENTE, UNIDAD, 'INCIDENCIAS_REGISTRADAS', 2),
                    this._fetchCatalogosAcceso(),
                    this._fetchPuestos(CLIENTE, UNIDAD),
                    this._fetchAccesosHoy(CLIENTE, UNIDAD, 'CUADERNO', 2),
                    this._fetchDentro(CLIENTE, UNIDAD, 'ACCESO_VEHICULAR'),
                    this._fetchDentro(CLIENTE, UNIDAD, 'ACCESO_PEATONAL'),
                    this._fetchRondasDisponibles(CLIENTE, UNIDAD)
                ]);

                // 3. Guardar en Caché Local usando MERGE para deltas
                await Promise.all([
                    offlineStorage.saveConfig(this.RESOURCES.QRS, qrs),
                    offlineStorage.saveConfig(this.RESOURCES.INCIDENT_TYPES, incidentTypes),
                    offlineStorage.saveConfig(this.RESOURCES.CONSIGNAS_PERM, consignasPerm),
                    offlineStorage.saveConfig(this.RESOURCES.CONSIGNAS_TEMP, consignasTemp),
                    // Sincronización de Historial (Pool de 2 para Caché Total)
                    offlineStorage.mergeConfig(this.RESOURCES.ACCESO_PEATONAL_HOY, peatonalHoy),
                    offlineStorage.mergeConfig(this.RESOURCES.ACCESO_VEHICULAR_HOY, vehicularHoy),
                    offlineStorage.mergeConfig(this.RESOURCES.INCIDENCIAS_HOY, incidenciasHoy),
                    offlineStorage.saveConfig(this.RESOURCES.CATALOGOS_ACCESO, catalogosAcceso),
                    offlineStorage.saveConfig(this.RESOURCES.PUESTOS, puestos),
                    offlineStorage.mergeConfig(this.RESOURCES.CUADERNO_HOY, cuadernoHoy),
                    offlineStorage.saveConfig(this.RESOURCES.VEHICULOS_DENTRO, vehiculosDentro),
                    offlineStorage.saveConfig(this.RESOURCES.PEATONES_DENTRO, peatonesDentro),
                    offlineStorage.saveConfig(this.RESOURCES.RONDAS_DISPONIBLES, rondasDisponibles),
                    offlineStorage.setGlobalData(`sync-version-${CLIENTE}-${UNIDAD}`, serverVersion),
                    offlineStorage.setGlobalData(`last-sync-check-${CLIENTE}-${UNIDAD}`, Date.now())
                ]);

                console.log(`[SyncEngine] 🎉 Sincronización completada.`);
                console.log(`- QRs: ${qrs.length}, Incidencias: ${incidentTypes.length}`);
                console.log(`- Consignas: ${consignasPerm.length}P / ${consignasTemp.length}T`);
                console.log(`- Registros Hoy: ${peatonalHoy.length} Peat / ${vehicularHoy.length} Veh / ${incidenciasHoy.length} Inc`);
                console.log(`- Puestos: ${puestos.length}, Cuaderno: ${cuadernoHoy.length}`);
                console.log(`- Dentro: ${vehiculosDentro.length} Veh / ${peatonesDentro.length} Peat`);
                console.log(`- Rondas Disponibles: ${rondasDisponibles.length}`);

                if (window.UI && UI.updateOfflineBadge) UI.updateOfflineBadge('done');
                return true;
            } catch (e) {
                console.error('[SyncEngine] ❌ Error en sincronización global:', e);
                if (window.UI && UI.updateOfflineBadge) UI.updateOfflineBadge(0);
                return false;
            }
        },

        async _fetchQRs(cliente, unidad) {
            const snap = await db.collection('QR_CODES')
                .where('cliente', '==', cliente.toUpperCase())
                .where('unidad', '==', unidad.toUpperCase())
                .get();
            return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },

        async _fetchIncidentTypes(cliente, unidad) {
            const path = `/TIPO_INCIDENCIAS/${cliente.toUpperCase()}/UNIDADES/${unidad.toUpperCase()}/TIPO`;
            const snap = await db.collection(path).get();
            return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },

        async _fetchConsignas(cliente, unidad, coleccion) {
            const snap = await db.collection(coleccion)
                .where('cliente', '==', cliente.toUpperCase())
                .where('unidad', '==', unidad.toUpperCase())
                .get();
            return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },

        async _fetchAccesosHoy(cliente, unidad, coleccion, limit = 50) {
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            // Intentar filtrar por 'timestamp' (milisegundos) o 'createdAt' (FieldValue)
            const field = coleccion === 'ACCESO_VEHICULAR' ? 'timestamp' : 'createdAt';

            try {
                const isAcceso = coleccion === 'ACCESO_VEHICULAR' || coleccion === 'ACCESO_PEATONAL';
                const isCuaderno = coleccion === 'CUADERNO';
                const isIncidencias = coleccion === 'INCIDENCIAS_REGISTRADAS';

                let query = db.collection(coleccion)
                    .where(isAcceso ? (coleccion === 'ACCESO_VEHICULAR' ? 'cliente' : 'CLIENTE') : 'cliente', '==', cliente.toUpperCase())
                    .where(isAcceso ? (coleccion === 'ACCESO_VEHICULAR' ? 'unidad' : 'UNIDAD') : 'UNIDAD', '==', unidad.toUpperCase());

                // Ordenar por defecto para el fetch de "Hoy"
                if (isAcceso || isIncidencias || isCuaderno) {
                    // Para incidiencias registradas, el campo es 'timestamp'
                    const sortField = isIncidencias ? 'timestamp' : (isAcceso ? (coleccion === 'ACCESO_VEHICULAR' ? 'timestamp' : 'FECHA_INGRESO') : 'timestamp');
                    query = query.orderBy(sortField, 'desc');
                }

                const snap = await query.limit(limit).get();
                return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (err) {
                console.warn(`[Sync] Falló fetch optimizado para ${coleccion}:`, err.message);
                return [];
            }
        },

        async _fetchCatalogosAcceso() {
            try {
                // Descargamos la estructura básica de CLIENTE_UNIDAD para que el menú funcione offline
                // Eliminamos limit para asegurar que TODO el catálogo esté disponible
                const snap = await db.collection('CLIENTE_UNIDAD').get();
                const catalogos = [];
                snap.forEach(doc => catalogos.push({ id: doc.id, ...doc.data() }));
                return catalogos;
            } catch (err) {
                console.warn('[Sync] Falló fetch de catálogos:', err.message);
                return [];
            }
        },

        async _fetchPuestos(cliente, unidad) {
            try {
                const path = `CLIENTE_UNIDAD/${cliente.toUpperCase()}/UNIDADES/${unidad.toUpperCase()}/PUESTOS`;
                const snap = await db.collection(path).get();
                return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (err) {
                console.warn('[Sync] Falló fetch de puestos:', err.message);
                return [];
            }
        },

        async _fetchDentro(cliente, unidad, coleccion) {
            try {
                const isVeh = coleccion === 'ACCESO_VEHICULAR';
                const fieldEstado = isVeh ? 'estado' : 'ESTADO';
                const valueEstado = isVeh ? 'ingreso' : 'ABIERTO';

                const snap = await db.collection(coleccion)
                    .where(isVeh ? 'cliente' : 'CLIENTE', '==', cliente.toUpperCase())
                    .where(isVeh ? 'unidad' : 'UNIDAD', '==', unidad.toUpperCase())
                    .where(fieldEstado, '==', valueEstado)
                    .limit(100)
                    .get();
                return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (err) {
                console.warn(`[Sync] Falló fetch de ${coleccion} dentro:`, err.message);
                return [];
            }
        },

        async _fetchRondasDisponibles(cliente, unidad) {
            try {
                const snap = await db.collection('Rondas_QR')
                    .where('cliente', '==', cliente.toUpperCase())
                    .where('unidad', '==', unidad.toUpperCase())
                    .get();
                return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (err) {
                console.warn('[Sync] Falló fetch de rondas disponibles:', err.message);
                return [];
            }
        }
    };

    window.SyncEngine = SyncEngine;
})();
