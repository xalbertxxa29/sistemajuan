// registrar_incidente.js (v60)
// Botones “+” con modal centrado (sin prompt), foto offline, Nivel de Riego (sin firma)
document.addEventListener('DOMContentLoaded', () => {
  // --- Firebase ---
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage();

  // Sesión persistente
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => { });

  // --- Utilidades UI ---
  const UX = {
    show: (m) => (window.UI && UI.showOverlay) ? UI.showOverlay(m) : void 0,
    hide: () => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (t, m, cb) => (window.UI && UI.alert) ? UI.alert(t, m, cb) : (alert(`${t}\n\n${m || ''}`), cb && cb())
  };

  // --- DOM ---
  const form = document.getElementById('incidente-form');
  const tipoIncidenteSelect = document.getElementById('tipo-incidente');
  const detalleIncidenteSelect = document.getElementById('detalle-incidente');
  const nivelRiesgoSelect = document.getElementById('nivel-riesgo');
  const comentarioEl = document.getElementById('comentario');
  const fotoInput = document.getElementById('foto-input');
  const fotoPreview = document.getElementById('foto-preview');
  const addTipoBtn = document.getElementById('add-tipo-btn');
  const addDetalleBtn = document.getElementById('add-detalle-btn');

  // --- Modal centrado reutilizable ---
  const modalOverlay = document.getElementById('custom-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalInput = document.getElementById('modal-input');
  const modalSave = document.getElementById('modal-save');
  const modalCancel = document.getElementById('modal-cancel');
  let currentModalType = null; // "tipo" | "detalle"

  function openModal(title, placeholder, type) {
    if (!modalOverlay || !modalInput || !modalTitle) return false; // fallback si no existe
    currentModalType = type;
    modalTitle.textContent = title || 'Agregar';
    modalInput.placeholder = placeholder || 'Escribe aquí...';
    modalInput.value = '';
    modalOverlay.style.display = 'flex';
    // Truca el scroll del body tras abrir para iOS/Android webview
    setTimeout(() => modalInput.focus(), 50);
    return true;
  }
  function closeModal() {
    if (!modalOverlay) return;
    modalOverlay.style.display = 'none';
    currentModalType = null;
  }
  modalCancel?.addEventListener('click', closeModal);
  modalOverlay?.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  // Enter = Guardar, ESC = Cancelar
  modalInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); modalSave?.click(); }
    if (e.key === 'Escape') closeModal();
  });

  // --- Imagen: compresión y vista previa ---
  let pendingPhoto = null;
  fotoInput?.addEventListener('change', async () => {
    const f = fotoInput.files && fotoInput.files[0];
    if (!f) { pendingPhoto = null; fotoPreview.hidden = true; fotoPreview.src = ''; return; }
    try {
      UX.show('Procesando imagen…');

      // Usar ImageOptimizer centralizado (v1)
      if (window.ImageOptimizer) {
        pendingPhoto = await ImageOptimizer.compress(f, 'incidente');
      } else if (typeof imageCompression !== 'undefined') {
        // Fallback
        const opt = { maxSizeMB: 0.35, maxWidthOrHeight: 1024, useWebWorker: true, fileType: 'image/jpeg' };
        pendingPhoto = await imageCompression(f, opt);
      } else {
        pendingPhoto = f;
      }

      fotoPreview.src = URL.createObjectURL(pendingPhoto);
      fotoPreview.hidden = false;
    } catch (e) {
      console.error('Error procesando imagen:', e);
      UX.alert('Aviso', 'No se pudo procesar la imagen. Se usará la original.');
      pendingPhoto = f; // Usar imagen original como fallback
      fotoPreview.src = URL.createObjectURL(f);
      fotoPreview.hidden = false;
    } finally { UX.hide(); }
  });

  // --- Subida segura / base64 fallback ---
  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      console.log('[blobToDataURL] Convertiendo blob a DataURL, tamaño:', blob.size, 'bytes');
      const r = new FileReader();
      r.onload = () => {
        console.log('[blobToDataURL] ✅ Conversión exitosa, DataURL length:', r.result.length);
        res(r.result);
      };
      r.onerror = (err) => {
        console.error('[blobToDataURL] ❌ Error en FileReader:', err);
        rej(err);
      };
      r.readAsDataURL(blob);
    });
  }

  async function uploadTo(path, blob) {
    try {
      console.log('[uploadTo] Iniciando subida a:', path);
      console.log('[uploadTo] Tamaño del blob:', blob.size, 'bytes');
      console.log('[uploadTo] Tipo de blob:', blob.type);
      console.log('[uploadTo] Usuario autenticado:', auth.currentUser?.email);

      const ref = storage.ref().child(path);
      console.log('[uploadTo] Referencia creada, iniciando put...');

      // Agregar metadatos
      const metadata = {
        contentType: 'image/jpeg',
        customMetadata: {
          uploadedBy: auth.currentUser?.email,
          uploadedAt: new Date().toISOString()
        }
      };

      const uploadTask = await ref.put(blob, metadata);
      console.log('[uploadTo] ✅ Upload completado, metadata:', uploadTask.metadata);

      const downloadURL = await ref.getDownloadURL();
      console.log('[uploadTo] ✅ Download URL obtenida:', downloadURL);
      return downloadURL;
    } catch (err) {
      console.error('[uploadTo] ❌ Error en uploadTo');
      console.error('[uploadTo] Código:', err.code);
      console.error('[uploadTo] Mensaje:', err.message);
      console.error('[uploadTo] Stack completo:', err);

      // Detalles adicionales
      if (err.code === 'storage/unauthorized') {
        console.error('[uploadTo] ❌ PROBLEMA: No tienes permisos en Firebase Storage');
      } else if (err.code === 'storage/unknown') {
        console.error('[uploadTo] ⚠️ Error desconocido de Storage. Revisa las reglas de Firestore');
      }

      throw err;
    }
  }

  async function safeUploadOrEmbed(path, blob) {
    console.log('[safeUploadOrEmbed] Iniciando con path:', path, 'online:', navigator.onLine);
    try {
      if (!navigator.onLine) {
        console.log('[safeUploadOrEmbed] ⚠️ Offline detectado, usando fallback base64');
        throw new Error('offline');
      }

      console.log('[safeUploadOrEmbed] 🌐 Online, intentando subir a Storage...');
      const url = await uploadTo(path, blob);
      console.log('[safeUploadOrEmbed] ✅ Subida exitosa');
      return { url: url, embedded: null };
    } catch (err) {
      console.log('[safeUploadOrEmbed] ⚠️ Fallo en subida, usando base64 embebido. Error:', err.message);
      const embedded = await blobToDataURL(blob);
      console.log('[safeUploadOrEmbed] ✅ Base64 embebido creado, length:', embedded.length);
      return { url: null, embedded: embedded };
    }
  }
  const MAX_EMBED_LEN = 600 * 1024;

  // --- Perfil de usuario ---
  let currentUserProfile = null;
  auth.onAuthStateChanged(async (user) => {
    if (!user) { setTimeout(() => { if (!auth.currentUser) window.location.href = 'index.html'; }, 150); return; }

    try {
      const userId = user.email.split('@')[0];

      // 1. CARGA RÁPIDA DESDE CACHÉ (Zero-Wait)
      if (window.offlineStorage) {
        const localUser = await offlineStorage.getUserData();
        if (localUser && localUser.cliente) {
          currentUserProfile = { ...localUser, id: userId };
          console.log('[Incidente] Perfil cargado desde caché.');
          cargarTiposIncidente(); // Carga inmediata del caché
        }
      }

      // 2. SINCRONIZACIÓN DE PERFIL (Fondo)
      let userData = null;
      if (window.getUserProfile) {
        userData = await window.getUserProfile(userId);
      } else {
        const prof = await db.collection('USUARIOS').doc(userId).get({ source: 'cache' }).catch(() => null);
        if (prof && prof.exists) userData = prof.data();
      }

      if (userData) {
        currentUserProfile = { ...userData, id: userId };
        // Refrescar si hubo cambios o si no se cargó el local
        await cargarTiposIncidente();
      } else if (!currentUserProfile) {
        throw new Error('No se encontró tu perfil.');
      }
    } catch (e) {
      console.error('[Incidente] Error cargando perfil:', e);
      if (!currentUserProfile) UX.alert('Error', 'No se pudo cargar tu perfil. Revisa tu conexión.');
    } finally { UX.hide(); }
  });

  // --- Catálogos: Tipos / Detalles ---
  async function cargarTiposIncidente() {
    if (!currentUserProfile) return;
    const tipoSeleccionado = tipoIncidenteSelect?.value;
    if (tipoIncidenteSelect) tipoIncidenteSelect.innerHTML = '<option value="" disabled selected>Cargando...</option>';
    try {
      const { CLIENTE, UNIDAD } = currentUserProfile;

      // 1. INTENTAR CACHÉ PRIMERO (SyncEngine)
      if (window.offlineStorage) {
        const cachedTypes = await offlineStorage.getConfig('incident-types');
        if (cachedTypes && cachedTypes.length > 0) {
          console.log('[Incidente] Cargando tipos desde caché local.');
          renderizarTipos(cachedTypes, tipoSeleccionado);
          return;
        }
      }

      // 2. FALLBACK A RED SI NO HAY CACHÉ
      const path = `/TIPO_INCIDENCIAS/${CLIENTE}/UNIDADES/${UNIDAD}/TIPO`;
      const snapshot = await db.collection(path).get();

      if (snapshot.empty) {
        if (tipoIncidenteSelect) tipoIncidenteSelect.innerHTML = '<option value="" disabled>No hay tipos definidos</option>';
        return;
      }

      const typesFromNet = [];
      snapshot.forEach(doc => typesFromNet.push({ id: doc.id, ...doc.data() }));
      renderizarTipos(typesFromNet, tipoSeleccionado);

    } catch (e) {
      console.error('Error cargando tipos:', e);
      if (tipoIncidenteSelect) tipoIncidenteSelect.innerHTML = '<option value="">Error al cargar</option>';
    }
  }

  function renderizarTipos(types, seleccionado) {
    if (!tipoIncidenteSelect) return;
    tipoIncidenteSelect.innerHTML = '<option value="" disabled selected>Seleccione un tipo</option>';
    types.forEach(t => {
      const op = document.createElement('option');
      op.value = t.id;
      op.textContent = t.id;
      if (t.id === seleccionado) op.selected = true;
      tipoIncidenteSelect.appendChild(op);
    });
    tipoIncidenteSelect.disabled = false;
    if (seleccionado) tipoIncidenteSelect.dispatchEvent(new Event('change'));
  }

  async function cargarDetallesIncidente(tipoId) {
    if (!tipoId || !currentUserProfile) return;
    if (detalleIncidenteSelect) {
      detalleIncidenteSelect.innerHTML = '<option value="">Cargando...</option>';
      detalleIncidenteSelect.disabled = true;
    }
    try {
      const { CLIENTE, UNIDAD } = currentUserProfile;

      // 1. INTENTAR CACHÉ PRIMERO
      if (window.offlineStorage) {
        const cachedTypes = await offlineStorage.getConfig('incident-types');
        const tipoEncontrado = cachedTypes ? cachedTypes.find(t => t.id === tipoId) : null;
        if (tipoEncontrado) {
          console.log('[Incidente] Cargando detalles desde caché local.');
          renderizarDetalles(tipoEncontrado.DETALLES || tipoEncontrado.detalles || tipoEncontrado);
          return;
        }
      }

      // 2. FALLBACK A RED
      const path = `/TIPO_INCIDENCIAS/${CLIENTE}/UNIDADES/${UNIDAD}/TIPO`;
      const doc = await db.collection(path).doc(tipoId).get();

      if (!doc.exists) {
        if (detalleIncidenteSelect) detalleIncidenteSelect.innerHTML = '<option value="" disabled>No hay detalles</option>';
        return;
      }
      renderizarDetalles(doc.data());

    } catch (error) {
      console.error('Error cargando detalles:', error);
      if (detalleIncidenteSelect) detalleIncidenteSelect.innerHTML = '<option value="">Error</option>';
    }
  }

  function renderizarDetalles(data) {
    if (!detalleIncidenteSelect) return;
    let detalles = [];
    if (Array.isArray(data)) detalles = data.slice();
    else if (Array.isArray(data.DETALLES)) detalles = data.DETALLES.slice();
    else if (Array.isArray(data.detalles)) detalles = data.detalles.slice();
    else if (data.DETALLES && typeof data.DETALLES === 'object') detalles = Object.values(data.DETALLES);
    else if (data && typeof data === 'object') {
      const vals = Object.values(data).filter(v => typeof v === 'string' && v !== data.id);
      if (vals.length) detalles = vals;
    }
    detalles = [...new Set(detalles)].sort();

    detalleIncidenteSelect.innerHTML = detalles.length
      ? '<option value="" disabled selected>Seleccione un detalle</option>'
      : '<option value="" disabled>No hay detalles</option>';
    detalles.forEach(det => {
      const op = document.createElement('option');
      op.value = det; op.textContent = det;
      detalleIncidenteSelect.appendChild(op);
    });
    detalleIncidenteSelect.disabled = detalles.length === 0;
  }

  tipoIncidenteSelect?.addEventListener('change', (e) => cargarDetallesIncidente(e.target.value));

  // --- Guardado desde el modal ---
  modalSave?.addEventListener('click', async () => {
    const val = (modalInput?.value || '').trim().toUpperCase();
    if (!val) return UX.alert('Aviso', 'Debe ingresar un texto.');

    try {
      UX.show('Guardando…');
      const { CLIENTE, UNIDAD } = currentUserProfile || {};
      if (!CLIENTE || !UNIDAD) throw new Error('Perfil no cargado.');

      const path = `/TIPO_INCIDENCIAS/${CLIENTE}/UNIDADES/${UNIDAD}/TIPO`;

      if (currentModalType === 'tipo') {
        await db.collection(path).doc(val).set(
          { DETALLES: [], actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        await cargarTiposIncidente();
        if (tipoIncidenteSelect) {
          tipoIncidenteSelect.value = val;
          tipoIncidenteSelect.dispatchEvent(new Event('change'));
        }
      }

      if (currentModalType === 'detalle') {
        const tipo = (tipoIncidenteSelect?.value || '').trim();
        if (!tipo) throw new Error('Selecciona un tipo primero.');
        await db.collection(path).doc(tipo).set(
          {
            DETALLES: firebase.firestore.FieldValue.arrayUnion(val),
            actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        await cargarDetallesIncidente(tipo);
        if (detalleIncidenteSelect) detalleIncidenteSelect.value = val;
      }

      closeModal();
    } catch (e) {
      console.error(e);
      UX.alert('Error', e.message || 'No fue posible guardar.');
    } finally { UX.hide(); }
  });

  // --- Botones “+” que abren el modal (con fallback) ---
  addTipoBtn?.addEventListener('click', () => {
    if (!openModal('Nuevo Tipo de Incidencia', 'Escribe el nombre del tipo…', 'tipo')) {
      // Fallback si el modal no existe
      const v = (prompt('Nuevo Tipo de Incidencia:') || '').trim().toUpperCase();
      if (!v) return;
      (async () => {
        try {
          UX.show('Guardando tipo…');
          const { CLIENTE, UNIDAD } = currentUserProfile;
          const path = `/TIPO_INCIDENCIAS/${CLIENTE}/UNIDADES/${UNIDAD}/TIPO`;
          await db.collection(path).doc(v).set(
            { DETALLES: [], actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
          await cargarTiposIncidente();
          if (tipoIncidenteSelect) {
            tipoIncidenteSelect.value = v;
            tipoIncidenteSelect.dispatchEvent(new Event('change'));
          }
        } catch (e) { console.error(e); UX.alert('Error', 'No fue posible crear el tipo.'); }
        finally { UX.hide(); }
      })();
    }
  });

  addDetalleBtn?.addEventListener('click', () => {
    const tipo = (tipoIncidenteSelect?.value || '').trim();
    if (!tipo) return UX.alert('Aviso', 'Primero seleccione un Tipo de Incidencia.');
    if (!openModal('Nuevo Detalle de Incidencia', 'Escribe el detalle…', 'detalle')) {
      const d = (prompt(`Nuevo detalle para "${tipo}":`) || '').trim().toUpperCase();
      if (!d) return;
      (async () => {
        try {
          UX.show('Guardando detalle…');
          const { CLIENTE, UNIDAD } = currentUserProfile;
          const path = `/TIPO_INCIDENCIAS/${CLIENTE}/UNIDADES/${UNIDAD}/TIPO`;
          await db.collection(path).doc(tipo).set(
            {
              DETALLES: firebase.firestore.FieldValue.arrayUnion(d),
              actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
          await cargarDetallesIncidente(tipo);
          if (detalleIncidenteSelect) detalleIncidenteSelect.value = d;
        } catch (e) { console.error(e); UX.alert('Error', 'No fue posible crear el detalle.'); }
        finally { UX.hide(); }
      })();
    }
  });

  // --- Guardar Incidencia ---
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('[SUBMIT] 🚀 Iniciando envío del formulario');

    const tipoIncidente = (tipoIncidenteSelect?.value || '').trim();
    const detalleIncidente = (detalleIncidenteSelect?.value || '').trim();
    const nivelRiesgo = (nivelRiesgoSelect?.value || '').trim();
    const comentario = (comentarioEl?.value || '').trim();

    console.log('[SUBMIT] Validando campos:', { tipoIncidente, detalleIncidente, nivelRiesgo, comentarioLen: comentario.length });

    if (!tipoIncidente || !detalleIncidente || !nivelRiesgo || !comentario || comentario.length < 5) {
      UX.alert('Aviso', 'Complete todos los campos requeridos (comentario mínimo 5 caracteres).');
      return;
    }

    UX.show('Guardando incidente…');
    try {
      console.log('[SUBMIT] ✅ Campos válidos');
      const { CLIENTE, UNIDAD, NOMBRES, APELLIDOS, PUESTO } = currentUserProfile;
      console.log('[SUBMIT] Datos del usuario:', { CLIENTE, UNIDAD, NOMBRES, APELLIDOS });

      const stamp = Date.now();
      console.log('[SUBMIT] Timestamp:', stamp);

      const nom = currentUserProfile.NOMBRES || currentUserProfile.nombres || '';
      const ape = currentUserProfile.APELLIDOS || currentUserProfile.apellidos || '';
      const nombreCompleto = `${nom} ${ape}`.trim() || 'Usuario';
      const usuarioID = auth.currentUser?.email?.split('@')[0] || currentUserProfile.id || 'N/A';
      const usuarioEmail = auth.currentUser?.email || 'N/A';

      let fotoURL = null, fotoEmbedded = null;
      if (pendingPhoto) {
        console.log('[SUBMIT] 📸 Foto pendiente detectada, tamaño:', pendingPhoto.size, 'bytes');
        const r = await safeUploadOrEmbed(`incidencias/${CLIENTE}/${UNIDAD}/${stamp}_foto.jpg`, pendingPhoto);
        fotoURL = r.url;
        fotoEmbedded = r.embedded;
        console.log('[SUBMIT] 📸 Procesamiento de foto completado:', { fotoURL: !!fotoURL, fotoEmbeddedLen: fotoEmbedded?.length || 0 });
      } else {
        console.log('[SUBMIT] ⚠️ No hay foto pendiente');
      }

      if (fotoEmbedded && fotoEmbedded.length > MAX_EMBED_LEN) {
        console.log('[SUBMIT] ⚠️ Base64 muy grande, descartando. Length:', fotoEmbedded.length, 'MAX:', MAX_EMBED_LEN);
        fotoEmbedded = null;
      }

      console.log('[SUBMIT] 💾 Guardando en Firestore...');
      const incidenteData = {
        cliente: CLIENTE,
        unidad: UNIDAD,
        puesto: PUESTO || null,
        registradoPor: nombreCompleto,
        usuarioID: usuarioID,
        usuarioEmail: usuarioEmail,
        tipoIncidente,
        detalleIncidente,
        Nivelderiesgo: nivelRiesgo,
        comentario,
        estado: 'Pendiente',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        ...(fotoURL ? { fotoURL } : {}),
        ...(fotoEmbedded ? { fotoEmbedded } : {}),
      };

      console.log('[SUBMIT] Documento a guardar:', incidenteData);

      // --- Lógica de Guardado (Online/Offline) ---
      if (!navigator.onLine) {
        if (window.OfflineQueue) {
          await window.OfflineQueue.add({
            kind: 'incidente-full',
            collection: 'INCIDENCIAS_REGISTRADAS',
            cliente: CLIENTE,
            unidad: UNIDAD,
            data: { ...incidenteData, timestamp: new Date().toISOString() },
            createdAt: Date.now()
          });
          UX.hide();
          UX.alert('Guardado Offline', 'Sin conexión. El incidente se guardó localmente.', () => window.location.href = 'menu.html');
          return;
        }
      }

      try {
        const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 6000));
        const savePromise = db.collection('INCIDENCIAS_REGISTRADAS').add(incidenteData);
        const ref = await Promise.race([savePromise, timeoutPromise]);

        console.log('[SUBMIT] ✅ Documento guardado en Firestore, ID:', ref.id);

        // Reintento de subida si se guardó embebido
        if (fotoEmbedded && window.OfflineQueue) {
          await OfflineQueue.add({
            type: 'incidencia-upload',
            docPath: `INCIDENCIAS_REGISTRADAS/${ref.id}`,
            cliente: CLIENTE,
            unidad: UNIDAD,
            fotoEmbedded,
            createdAt: Date.now()
          });
        }
        UX.hide();
        UX.alert('Éxito', 'Incidente guardado correctamente.', () => window.location.href = 'menu.html');

      } catch (errSave) {
        console.warn('[SUBMIT] Fallo guardado online, usando cola offline:', errSave.message);
        if (window.OfflineQueue) {
          await OfflineQueue.add({
            kind: 'incidente-full',
            collection: 'INCIDENCIAS_REGISTRADAS',
            cliente: CLIENTE,
            unidad: UNIDAD,
            data: { ...incidenteData, timestamp: new Date().toISOString() },
            createdAt: Date.now()
          });
          UX.hide();
          UX.alert('Guardado Offline', 'La red está inestable. Se guardó localmente para su envío automático.', () => window.location.href = 'menu.html');
        } else {
          throw errSave;
        }
      }

    } catch (err) {
      console.error('[SUBMIT] ❌ Error completo:', err);
      UX.hide();
      UX.alert('Error', err.message || 'No fue posible guardar el incidente.');
    }
  });
});
