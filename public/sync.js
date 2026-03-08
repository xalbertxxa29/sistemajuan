// sync.js (v5) — Sincroniza cola al reconectar, con marcas de tiempo y lock
(function () {
  if (!('OfflineQueue' in window)) return;

  // ---- Guardas & helpers ----
  let isFlushing = false;
  let lastRunTs = 0;

  function dataURLtoBlob(u) {
    if (typeof u !== 'string' || !u.startsWith('data:')) return null;
    const a = u.split(','), m = a[0].match(/:(.*?);/)[1];
    const b = atob(a[1]); let n = b.length; const x = new Uint8Array(n);
    while (n--) x[n] = b.charCodeAt(n);
    return new Blob([x], { type: m });
  }

  async function uploadTo(storage, path, blobOrDataURL) {
    const ref = storage.ref().child(path);

    let blob = blobOrDataURL;
    if (!(blobOrDataURL instanceof Blob)) {
      const maybe = dataURLtoBlob(blobOrDataURL);
      if (!maybe) throw new Error('Invalid image payload');
      blob = maybe;
    }

    await ref.put(blob);
    return await ref.getDownloadURL();
  }

  function pickBaseFolder(task) {
    // Prioriza 'kind'; compat con 'type' legacy
    const tag = (task?.kind || task?.type || '').toString();
    if (tag.includes('cuaderno')) return 'cuaderno';
    return 'incidencias'; // default
  }

  function nowLocalISO() {
    try { return new Date().toISOString(); } catch { return null; }
  }

  function deviceTZ() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }

  // ---- Proceso principal ----
  async function flush() {
    console.log('[sync] 🔄 flush() llamado');

    // Debounce + lock
    if (isFlushing) {
      console.log('[sync] ⏸️ Ya hay una sincronización en progreso, saliendo');
      return;
    }
    if (!navigator.onLine) {
      console.log('[sync] 📡 Sin conexión, saliendo');
      return;
    }
    if (!firebase?.apps?.length) {
      console.log('[sync] ⚠️ Firebase no inicializado, saliendo');
      return;
    }

    const db = firebase.firestore?.();
    const storage = firebase.storage?.();
    if (!db) {
      console.log('[sync] ⚠️ Firestore no disponible');
      return;
    }
    if (!storage) {
      console.log('[sync] ⚠️ Storage no disponible (se omitirán archivos)');
    }

    isFlushing = true;
    try {
      // Toma tareas (FIFO); compat con all() legacy
      const getTasks = window.OfflineQueue.takeAll || window.OfflineQueue.all;
      const tasks = await getTasks.call(window.OfflineQueue);

      console.log(`[sync] 📦 Tareas en cola: ${tasks?.length || 0}`);

      if (!Array.isArray(tasks) || !tasks.length) {
        console.log('[sync] ✅ No hay tareas pendientes');
        if (window.UI && UI.updateOfflineBadge) UI.updateOfflineBadge(0);
        return;
      }

      // Actualizar badge inicial
      if (window.UI && UI.updateOfflineBadge) UI.updateOfflineBadge(tasks.length);

      // Mostrar feedback visual
      if (typeof UI !== 'undefined' && UI.updateOfflineBadge) {
        UI.updateOfflineBadge('syncing');
      }
      console.log(`[sync] 🚀 Iniciando sincronización de ${tasks.length} tarea(s)`);

      let syncedCount = 0;

      for (const t of tasks) {
        const id = t.id;
        const baseFolder = pickBaseFolder(t);
        const stamp = Date.now();

        const docPath = t.docPath;
        const cliente = t.cliente;
        const unidad = t.unidad;

        // Campos soportados
        const fotoEmbedded = t.fotoEmbedded || t.foto_base64 || null;
        const firmaEmbedded = t.firmaEmbedded || t.firma_base64 || null;

        // ========== COMPORTAMIENTO ESPECIAL: Creación de documento completo ==========
        // Estos tipos NO requieren docPath porque crean documentos nuevos
        const isFullDocCreation = (t.kind && (
          t.kind === 'ronda-manual-full' ||
          t.kind === 'peatonal-full' ||
          t.kind === 'vehicular-full' ||
          t.kind === 'incidente-full' ||
          t.kind === 'ronda-programada-point' ||
          t.kind === 'ronda-programada-end' ||
          t.kind === 'ronda-start' ||
          t.kind === 'relevo-full'
        ));

        if (isFullDocCreation) {
          try {
            console.log(`[sync] Procesando ${t.kind}...`);
            const payload = { ...t.data };

            // Determinar colección destino
            let targetCollection = 'RONDA_MANUAL';
            if (t.kind === 'peatonal-full') targetCollection = 'ACCESO_PEATONAL';
            else if (t.kind === 'vehicular-full') targetCollection = 'ACCESO_VEHICULAR';
            else if (t.kind === 'incidente-full') targetCollection = 'INCIDENCIAS_REGISTRADAS';
            else if (t.kind === 'ronda-programada-end' || t.kind === 'ronda-start') targetCollection = 'RONDAS_COMPLETADAS';
            else if (t.kind === 'relevo-full') targetCollection = 'CUADERNO';

            // Subir foto si viene en base64
            if (payload.foto && payload.foto.startsWith('data:')) {
              if (!storage) {
                console.warn('[sync] Omitiendo foto doc: Storage no disponible');
              } else {
                const folder = t.kind === 'ronda-manual-full' ? 'rondas_manuales' :
                  t.kind === 'vehicular-full' ? 'acceso-vehicular' :
                    t.kind === 'incidente-full' ? 'incidencias' : 'misc';
                const url = await uploadTo(storage, `${folder}/${cliente}/${unidad}/${stamp}_foto.jpg`, payload.foto);
                payload.foto = url;
                console.log(`[sync] Foto subida: ${url}`);
              }
            }

            // Subir fotoBase64 (vehicular)
            if (payload.fotoBase64 && payload.fotoBase64.startsWith('data:')) {
              if (!storage) {
                console.warn('[sync] Omitiendo fotoBase64: Storage no disponible');
              } else {
                const url = await uploadTo(storage, `acceso-vehicular/${cliente}/${unidad}/${stamp}_foto.jpg`, payload.fotoBase64);
                payload.fotoURL = url;
                delete payload.fotoBase64;
                console.log(`[sync] FotoBase64 subida: ${url}`);
              }
            }

            // Subir fotoEmbedded (incidentes)
            if (payload.fotoEmbedded && payload.fotoEmbedded.startsWith('data:')) {
              if (!storage) {
                console.warn('[sync] Omitiendo fotoEmbedded: Storage no disponible');
              } else {
                const url = await uploadTo(storage, `incidencias/${cliente}/${unidad}/${stamp}_foto.jpg`, payload.fotoEmbedded);
                payload.fotoURL = url;
                delete payload.fotoEmbedded;
                console.log(`[sync] FotoEmbedded subida: ${url}`);
              }
            }

            // Agregar timestamp de sincronización
            payload.sincronizadoEn = firebase.firestore.FieldValue.serverTimestamp();

            // --- RECONSTRUCCIÓN DE TIMESTAMPS PARA RONDAS ---
            // IndexedDB elimina los métodos de los objetos (convierte Timestamp a un objeto simple {seconds, nanoseconds})
            const restoreTs = (val) => {
              if (!val) return val;
              if (typeof val.toDate === 'function') return val; // Ya es Timestamp
              if (typeof val === 'object' && typeof val.seconds === 'number' && typeof val.nanoseconds === 'number') {
                return new firebase.firestore.Timestamp(val.seconds, val.nanoseconds);
              }
              if (typeof val === 'string' && !isNaN(Date.parse(val))) {
                return firebase.firestore.Timestamp.fromDate(new Date(val));
              }
              return val;
            };

            if (payload.horarioInicio) payload.horarioInicio = restoreTs(payload.horarioInicio);
            if (payload.horarioTermino) payload.horarioTermino = restoreTs(payload.horarioTermino);

            // Crear o Actualizar documento
            if (t.kind === 'ronda-programada-end' && t.docId) {
              await db.collection(targetCollection).doc(t.docId).update(payload);
              console.log(`[sync] ✅ Ronda programada terminada: ${t.docId}`);
            } else if (t.kind === 'ronda-programada-point' && t.docId && t.index !== undefined) {
              const updateKey = `puntosRegistrados.${t.index}`;

              // Asegurar que el timestamp del punto sea un objeto Timestamp
              if (payload.timestamp) payload.timestamp = restoreTs(payload.timestamp);

              const updateData = {
                [updateKey]: payload,
                ultimaActualizacion: firebase.firestore.FieldValue.serverTimestamp()
              };
              await db.collection('RONDAS_COMPLETADAS').doc(t.docId).update(updateData);
              console.log(`[sync] ✅ Punto ${t.index} sincronizado para ronda ${t.docId}`);
            } else if (t.kind === 'ronda-start' && t.docId) {
              await db.collection(targetCollection).doc(t.docId).set(payload);
              console.log(`[sync] ✅ Ronda iniciada sincronizada: ${t.docId}`);
            } else {
              const docRef = await db.collection(targetCollection).add(payload);
              console.log(`[sync] ✅ Documento creado en ${targetCollection}: ${docRef.id}`);
            }

            // Remover de la cola
            await window.OfflineQueue.remove?.(id);
            continue; // Siguiente tarea
          } catch (err) {
            console.error(`[sync] ❌ Error subiendo ${t.kind}:`, err);
            continue; // Reintentar en próxima ejecución
          }
        }

        // ========== VALIDACIÓN PARA TAREAS DE ACTUALIZACIÓN ==========
        // Solo las tareas que NO son creación de documentos requieren docPath
        if (!docPath || !cliente || !unidad) {
          console.warn('[sync] Tarea incompleta, se descarta:', t);
          await window.OfflineQueue.remove?.(id);
          continue;
        }

        // ========== LÓGICA DE ACTUALIZACIÓN PARA TAREAS NORMALES ==========
        const updates = {
          reconectado: true,
          reconectadoEn: firebase.firestore.FieldValue.serverTimestamp(),
          reconectadoLocalAt: nowLocalISO(),
          reconectadoDeviceTz: deviceTZ()
        };

        let changed = false;

        try {
          if (fotoEmbedded) {
            if (!storage) {
              console.warn('[sync] Omitiendo foto: Storage no disponible');
            } else {
              const url = await uploadTo(storage, `${baseFolder}/${cliente}/${unidad}/${stamp}_foto.jpg`, fotoEmbedded);
              updates.fotoURL = url;
              updates.fotoEmbedded = firebase.firestore.FieldValue.delete();
              changed = true;
            }
          }

          if (firmaEmbedded) {
            if (!storage) {
              console.warn('[sync] Omitiendo firma: Storage no disponible');
            } else {
              const url = await uploadTo(storage, `${baseFolder}/${cliente}/${unidad}/${stamp}_firma.png`, firmaEmbedded);
              updates.firmaURL = url;
              updates.firmaEmbedded = firebase.firestore.FieldValue.delete();
              changed = true;
            }
          }

          // Aplica cambios si hubo algo que actualizar
          if (changed) {
            await db.doc(docPath).set(updates, { merge: true });
          }

          // Si todo ok, borramos la tarea
          await window.OfflineQueue.remove?.(id);
          syncedCount++;
          console.log(`[sync] ✅ Tarea actualizada: ${id}`);
        } catch (e) {
          console.warn('[sync] Falló tarea, reintenta luego:', e);
        }
      }

      // Feedback final
      console.log(`[sync] 🎉 Sincronización completada: ${syncedCount}/${tasks.length} exitosas`);

      if (typeof UI !== 'undefined') {
        if (UI.updateOfflineBadge) {
          UI.updateOfflineBadge(syncedCount > 0 && tasks.length === syncedCount ? 'done' : 0);
        }
        if (UI.toast && syncedCount > 0) {
          UI.toast(`✅ ${syncedCount} registro(s) sincronizado(s)`);
        }
      }

    } finally {
      isFlushing = false;
      lastRunTs = Date.now();
      console.log('[sync] 🔒 Lock liberado');
    }
  }

  // ---- Disparadores ----
  // Al cargar (si hay red)
  window.addEventListener('load', () => { if (navigator.onLine) flush(); });

  // Al volver la red
  window.addEventListener('online', () => flush());

  // Al volver a la app (WebView visible)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });

  // Reintento periódico (30 seg) para entornos donde 'online' no dispara
  setInterval(() => {
    // Evita espamear si corrió muy recientemente
    if (Date.now() - lastRunTs > 25_000) flush();
  }, 30_000);

  // Primer intento inmediato
  flush();
})();
