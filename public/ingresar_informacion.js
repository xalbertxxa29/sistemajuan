// ingresar_informacion.js (v51) — Guarda en CUADERNO con reintento offline (cola)
document.addEventListener('DOMContentLoaded', () => {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage();

  // Sesión persistente (no se cierra sola)
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => { });

  const UX = {
    show: (m) => (window.UI && UI.showOverlay) ? UI.showOverlay(m) : void 0,
    hide: () => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (t, m, cb) => (window.UI && UI.alert) ? UI.alert(t, m, cb) : (alert(`${t}\n\n${m || ''}`), cb && cb())
  };

  // DOM
  const form = document.getElementById('info-form');
  const comentario = document.getElementById('comentario');
  const fotoInput = document.getElementById('foto-input');
  const fotoPreview = document.getElementById('foto-preview');
  const canvas = document.getElementById('firma-canvas');
  const btnClear = document.getElementById('clear-firma');

  // Firma
  const sigPad = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)' });
  function resizeCanvas() {
    const r = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * r;
    canvas.height = canvas.offsetHeight * r;
    canvas.getContext('2d').scale(r, r);
    sigPad.clear();
  }
  window.addEventListener('resize', resizeCanvas);
  setTimeout(resizeCanvas, 80);

  btnClear?.addEventListener('click', () => sigPad.clear());

  // Imagen (compresión)
  let pendingPhoto = null;
  fotoInput?.addEventListener('change', async () => {
    const f = fotoInput.files && fotoInput.files[0];
    if (!f) { pendingPhoto = null; fotoPreview.hidden = true; fotoPreview.src = ''; return; }
    try {
      UX.show('Procesando imagen…');

      // Usar ImageOptimizer centralizado (v1)
      if (window.ImageOptimizer) {
        pendingPhoto = await ImageOptimizer.compress(f, 'consigna');
      } else if (typeof imageCompression !== 'undefined') {
        const opt = { maxSizeMB: 0.3, maxWidthOrHeight: 1024, useWebWorker: true, fileType: 'image/jpeg' };
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

  // Utils
  function dataURLtoBlob(u) {
    const a = u.split(','), m = a[0].match(/:(.*?);/)[1];
    const b = atob(a[1]); let n = b.length; const x = new Uint8Array(n);
    while (n--) x[n] = b.charCodeAt(n);
    return new Blob([x], { type: m });
  }
  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
    });
  }
  async function uploadTo(p, blob) {
    const ref = storage.ref().child(p);
    await ref.put(blob);
    return await ref.getDownloadURL();
  }

  // Perfil
  let profile = null;
  auth.onAuthStateChanged(async (user) => {
    // Pequeño delay para hidratación en WebView
    if (!user) { setTimeout(() => { if (!auth.currentUser) window.location.href = 'index.html'; }, 150); return; }
    const userId = user.email.split('@')[0];

    // OPTIMIZACIÓN "ZERO-READ": Usar el caché global
    let userData = null;
    if (window.getUserProfile) {
      userData = await window.getUserProfile(userId);
    } else {
      const doc = await db.collection('USUARIOS').doc(userId).get().catch(() => null);
      if (doc && doc.exists) userData = doc.data();
    }

    if (userData) {
      profile = { ...userData, id: userId };
      setTimeout(resizeCanvas, 120);
    } else {
      UX.alert('Error', 'No se encontró tu perfil.');
      window.location.href = 'menu.html';
    }
  });

  // Guardar
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = (comentario?.value || '').trim();
    if (!texto || texto.length < 3) { UX.alert('Aviso', 'Ingresa un comentario válido.'); return; }
    if (!profile) { UX.alert('Error', 'Perfil no cargado.'); return; }

    UX.show('Guardando…');
    try {
      const { CLIENTE, UNIDAD, PUESTO, NOMBRES, APELLIDOS } = profile;
      const stamp = Date.now();

      // Foto (URL si online, embebida si offline)
      let fotoURL = null, fotoEmbedded = null;
      if (pendingPhoto) {
        try {
          if (!navigator.onLine) throw new Error('offline');
          fotoURL = await uploadTo(`cuaderno/${CLIENTE}/${UNIDAD}/${stamp}_foto.jpg`, pendingPhoto);
        } catch {
          fotoEmbedded = await blobToDataURL(pendingPhoto);
        }
      }

      // Firma (URL si online, embebida si offline)
      let firmaURL = null, firmaEmbedded = null;
      if (!sigPad.isEmpty()) {
        const firmaBlob = dataURLtoBlob(sigPad.toDataURL('image/png'));
        try {
          if (!navigator.onLine) throw new Error('offline');
          firmaURL = await uploadTo(`cuaderno/${CLIENTE}/${UNIDAD}/${stamp}_firma.png`, firmaBlob);
        } catch {
          firmaEmbedded = await blobToDataURL(firmaBlob);
        }
      }

      // --- Lógica de Guardado (Online/Offline) ---
      if (!navigator.onLine) {
        if (window.OfflineQueue) {
          await window.OfflineQueue.add({
            kind: 'cuaderno-full',
            collection: 'CUADERNO',
            cliente: CLIENTE,
            unidad: UNIDAD,
            data: {
              cliente: CLIENTE,
              unidad: UNIDAD,
              puesto: PUESTO || null,
              usuario: `${NOMBRES || ''} ${APELLIDOS || ''}`.trim(),
              comentario: texto,
              tipoRegistro: 'REGISTRO',
              timestamp: new Date().toISOString(),
              fotoEmbedded: fotoEmbedded || null,
              firmaEmbedded: firmaEmbedded || null
            },
            createdAt: Date.now()
          });
          UX.hide();
          UX.alert('Guardado Offline', 'Sin conexión. El registro se guardó localmente.', () => window.location.href = 'menu.html');
          return;
        }
      }

      const cuadernoData = {
        cliente: CLIENTE,
        unidad: UNIDAD,
        puesto: PUESTO || null,
        usuario: `${NOMBRES || ''} ${APELLIDOS || ''}`.trim(),
        comentario: texto,
        tipoRegistro: 'REGISTRO',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        ...(fotoURL ? { fotoURL } : {}),
        ...(firmaURL ? { firmaURL } : {}),
        ...(fotoEmbedded ? { fotoEmbedded } : {}),
        ...(firmaEmbedded ? { firmaEmbedded } : {}),
      };

      try {
        const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 6000));
        const savePromise = db.collection('CUADERNO').add(cuadernoData);
        const ref = await Promise.race([savePromise, timeoutPromise]);

        // Encolar si quedaron embebidos (para re-subir luego y limpiar el documento)
        if ((fotoEmbedded || firmaEmbedded) && window.OfflineQueue) {
          await OfflineQueue.add({
            type: 'cuaderno-upload',
            docPath: `CUADERNO/${ref.id}`,
            cliente: CLIENTE,
            unidad: UNIDAD,
            fotoEmbedded: fotoEmbedded || null,
            firmaEmbedded: firmaEmbedded || null,
            createdAt: Date.now()
          });
        }
        UX.hide();
        UX.alert('Éxito', 'Información guardada correctamente.', () => window.location.href = 'menu.html');

      } catch (errSave) {
        console.warn('[CUADERNO] Fallo guardado online, usando cola offline:', errSave.message);
        if (window.OfflineQueue) {
          await OfflineQueue.add({
            kind: 'cuaderno-full',
            collection: 'CUADERNO',
            cliente: CLIENTE,
            unidad: UNIDAD,
            data: { ...cuadernoData, timestamp: new Date().toISOString() },
            createdAt: Date.now()
          });
          UX.hide();
          UX.alert('Guardado Offline', 'Red inestable. Se guardó localmente para su envío automático.', () => window.location.href = 'menu.html');
        } else {
          throw errSave;
        }
      }

      UX.hide();
      UX.alert('Éxito', 'Información guardada.', () => window.location.href = 'menu.html');
    } catch (err) {
      console.error(err);
      UX.hide();
      UX.alert('Error', err.message || 'No se pudo guardar.');
    }
  });
});
