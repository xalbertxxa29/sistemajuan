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
            CATALOGOS_ACCESO: 'catalogos-acceso'
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

                // 1. Verificar Metadatos de Versión
                const metaPath = `CONFIG_METADATA/${CLIENTE}_${UNIDAD}`;
                const metaDoc = await db.doc(metaPath).get().catch(() => null);
                const serverVersion = metaDoc && metaDoc.exists ? metaDoc.data().version : Date.now();
                const localVersion = await offlineStorage.getGlobalData(`sync-version-${CLIENTE}-${UNIDAD}`);

                if (!force && localVersion && localVersion >= serverVersion) {
                    console.log('[SyncEngine] ✅ Configuración actualizada. No se requiere descarga.');
                    if (window.UI && UI.updateOfflineBadge) UI.updateOfflineBadge('done');
                    return true;
                }

                console.log('[SyncEngine] 📥 Descargando nueva configuración...');

                // 2. Descargas Masivas en Paralelo
                const [
                    qrs,
                    incidentTypes,
                    consignasPerm,
                    consignasTemp,
                    peatonalHoy,
                    vehicularHoy
                ] = await Promise.all([
                    this._fetchQRs(CLIENTE, UNIDAD),
                    this._fetchIncidentTypes(CLIENTE, UNIDAD),
                    this._fetchConsignas(CLIENTE, UNIDAD, 'CONSIGNA_PERMANENTE'),
                    this._fetchConsignas(CLIENTE, UNIDAD, 'CONSIGNA_TEMPORAL'),
                    this._fetchAccesosHoy(CLIENTE, UNIDAD, 'ACCESO_PEATONAL'),
                    this._fetchAccesosHoy(CLIENTE, UNIDAD, 'ACCESO_VEHICULAR')
                ]);

                // 3. Guardar en Caché Local (IndexedDB)
                await Promise.all([
                    offlineStorage.saveConfig(this.RESOURCES.QRS, qrs),
                    offlineStorage.saveConfig(this.RESOURCES.INCIDENT_TYPES, incidentTypes),
                    offlineStorage.saveConfig(this.RESOURCES.CONSIGNAS_PERM, consignasPerm),
                    offlineStorage.saveConfig(this.RESOURCES.CONSIGNAS_TEMP, consignasTemp),
                    offlineStorage.saveConfig(this.RESOURCES.ACCESO_PEATONAL_HOY, peatonalHoy),
                    offlineStorage.saveConfig(this.RESOURCES.ACCESO_VEHICULAR_HOY, vehicularHoy),
                    offlineStorage.setGlobalData(`sync-version-${CLIENTE}-${UNIDAD}`, serverVersion)
                ]);

                console.log(`[SyncEngine] 🎉 Sincronización completada.`);
                console.log(`- QRs: ${qrs.length}, Incidencias: ${incidentTypes.length}`);
                console.log(`- Consignas: ${consignasPerm.length}P / ${consignasTemp.length}T`);
                console.log(`- Registros Hoy: ${peatonalHoy.length} Peat / ${vehicularHoy.length} Veh`);

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

        async _fetchAccesosHoy(cliente, unidad, coleccion) {
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            // Intentar filtrar por 'timestamp' (milisegundos) o 'createdAt' (FieldValue)
            // Según el módulo, el campo varía.
            const field = coleccion === 'ACCESO_VEHICULAR' ? 'timestamp' : 'createdAt';
            const value = coleccion === 'ACCESO_VEHICULAR' ? startOfDay.getTime() : startOfDay;

            // Nota: El filtrado exacto depende de los índices. Si falla, bajamos todo el histórico (no recomendado)
            // o simplemente limitamos a los últimos 50 registros para el "Hoy".
            try {
                const snap = await db.collection(coleccion)
                    .where(coleccion === 'ACCESO_VEHICULAR' ? 'cliente' : 'CLIENTE', '==', cliente.toUpperCase())
                    .where(coleccion === 'ACCESO_VEHICULAR' ? 'unidad' : 'UNIDAD', '==', unidad.toUpperCase())
                    .orderBy(field, 'desc')
                    .limit(50)
                    .get();
                return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.warn(`[SyncEngine] Falló fetch optimizado de ${coleccion}:`, e.message);
                return [];
            }
        }
    };

    window.SyncEngine = SyncEngine;
})();
