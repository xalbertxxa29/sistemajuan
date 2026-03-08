// accesovehicular.js (v69) - Ingreso Vehicular Simple
// Patrón idéntico a peatonal.js para consistencia
document.addEventListener('DOMContentLoaded', () => {
  // Firebase ya debe estar inicializado por initFirebase.js
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage();

  const form = document.getElementById('acceso-form');
  const fotoInput = document.getElementById('foto-input');
  const fotoPreview = document.getElementById('foto-preview');
  const btnCamera = document.getElementById('btn-camera');

  let selectedFile = null;
  let currentUser = null;

  // Estado de sesión
  let userCtx = { email: '', uid: '', cliente: '', unidad: '', puesto: '', nombreCompleto: '' };

  // Obtener usuario autenticado y sus datos
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = 'index.html';
      return;
    }

    currentUser = user;
    const userId = user.email.split('@')[0];
    userCtx.email = user.email;
    userCtx.uid = user.uid;

    try {
      // 🛡️ Usar caché global (Zero-Read)
      const userData = await window.getUserProfile(userId);

      if (userData) {
        userCtx.cliente = userData.CLIENTE || userData.cliente || '';
        userCtx.unidad = userData.UNIDAD || userData.unidad || '';
        userCtx.puesto = userData.PUESTO || userData.puesto || '';
        // v73: Guardar nombre completo
        userCtx.nombreCompleto = `${userData.NOMBRES || userData.nombres || ''} ${userData.APELLIDOS || userData.apellidos || ''}`.trim().toUpperCase();
        console.log('✓ Datos del usuario obtenidos del caché global');
      } else {
        console.warn('Perfil de usuario no encontrado en caché ni red');
      }
    } catch (e) {
      console.error('[vehicular] Error cargando perfil:', e);
    }
  });

  // Manejo de selección de archivo
  fotoInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    selectedFile = file;
    try {
      fotoPreview.src = URL.createObjectURL(file);
      fotoPreview.hidden = false;
    } catch (err) {
      console.error('Error mostrando preview:', err);
    }
  });

  // Botón cámara
  btnCamera?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Modal simple para cámara
      const modal = document.createElement('div');
      modal.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;background:black;z-index:9999;' +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:15px;';
      modal.innerHTML = `
        <video style="width:100%;max-width:500px;border-radius:8px;" id="camera-video"></video>
        <div style="display:flex;gap:10px;">
          <button id="capture-btn" class="btn-primary">Capturar</button>
          <button id="cancel-btn" class="btn-secondary">Cancelar</button>
        </div>
      `;
      document.body.appendChild(modal);

      const videoEl = modal.querySelector('#camera-video');
      videoEl.srcObject = stream;

      modal.querySelector('#capture-btn').addEventListener('click', () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          selectedFile = new File([blob], `foto-${Date.now()}.jpg`, {
            type: 'image/jpeg'
          });
          fotoPreview.src = URL.createObjectURL(selectedFile);
          fotoPreview.hidden = false;
          fotoInput.value = '';
          stream.getTracks().forEach(t => t.stop());
          modal.remove();
        });
      });

      modal.querySelector('#cancel-btn').addEventListener('click', () => {
        stream.getTracks().forEach(t => t.stop());
        modal.remove();
      });
    } catch (err) {
      alert('Error al acceder a la cámara: ' + err.message);
    }
  });

  // Convertir File a base64
  function fileToBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  // Subir foto a Storage
  async function uploadFoto(file, docId) {
    try {
      if (!navigator.onLine) return null;
      const path = `acceso-vehicular/${docId}/${file.name}`;
      const ref = storage.ref().child(path);
      await ref.put(file);
      return await ref.getDownloadURL();
    } catch (err) {
      console.warn('No se pudo subir foto:', err.message);
      return null;
    }
  }

  // Envío del formulario
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validar usuario autenticado
    if (!currentUser) {
      alert('No hay sesión activa. Por favor, inicia sesión.');
      window.location.href = 'index.html';
      return;
    }

    // Recopilar datos
    const placa = document.getElementById('placa').value.trim();
    const marca = document.getElementById('marca').value.trim();
    const modelo = document.getElementById('modelo').value.trim();
    const color = document.getElementById('color').value.trim();
    const dni = document.getElementById('dni').value.trim();
    const nombres = document.getElementById('nombres').value.trim();
    const observaciones = document.getElementById('observaciones').value.trim();

    // Validar campos requeridos
    if (!placa || !marca || !modelo || !color || !dni || !nombres) {
      alert('Por favor completa todos los campos requeridos (*)');
      return;
    }

    if (UI?.showOverlay) UI.showOverlay('Guardando acceso vehicular...');

    try {
      // Generar ID único
      const docId = `${placa.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;

      // Subir foto si existe
      let fotoURL = null;
      let fotoBase64 = null;
      if (selectedFile) {
        fotoURL = await uploadFoto(selectedFile, docId);
        if (!fotoURL) {
          fotoBase64 = await fileToBase64(selectedFile);
        }
      }

      // Datos a guardar
      const accesoData = {
        placa,
        marca,
        modelo,
        color,
        dni,
        nombres,
        observaciones,
        fotoURL: fotoURL || null,
        fotoBase64: fotoBase64 || null,
        cliente: userCtx.cliente,
        unidad: userCtx.unidad,
        puesto: userCtx.puesto,
        usuario: userCtx.nombreCompleto,
        usuarioID: currentUser.uid,
        usuarioEmail: currentUser.email,
        estado: 'ingreso',
        fechaIngreso: firebase.firestore.FieldValue.serverTimestamp(),
        timestamp: Date.now()
      };

      // --- Lógica de Guardado (Online/Offline) ---
      if (!navigator.onLine) {
        if (window.OfflineQueue) {
          await window.OfflineQueue.add({
            kind: 'vehicular-full',
            collection: 'ACCESO_VEHICULAR',
            docId: docId,
            data: {
              ...accesoData,
              fechaIngreso: new Date().toISOString() // Fallback a string ISO para offline
            },
            createdAt: Date.now()
          });
          UI?.hideOverlay?.();
          UI?.alert?.('Guardado Offline', 'Registro guardado localmente por falta de conexión.');
          setTimeout(() => window.location.href = 'menu.html', 1500);
          return;
        }
      }

      try {
        // Intento Online con Timeout
        const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 5000));
        const savePromise = db.collection('ACCESO_VEHICULAR').doc(docId).set(accesoData);
        await Promise.race([savePromise, timeoutPromise]);

        UI?.hideOverlay?.();
        UI?.alert?.('Éxito', 'Acceso vehicular registrado correctamente.', () => {
          window.location.href = 'menu.html';
        });
      } catch (errSave) {
        console.warn('Fallo guardado online vehicular:', errSave);
        if (window.OfflineQueue) {
          await window.OfflineQueue.add({
            kind: 'vehicular-full',
            collection: 'ACCESO_VEHICULAR',
            docId: docId,
            data: {
              ...accesoData,
              fechaIngreso: new Date().toISOString()
            },
            createdAt: Date.now()
          });
          UI?.hideOverlay?.();
          UI?.alert?.('Guardado Offline', 'La red está inestable. El registro se guardó localmente y se enviará pronto.');
          setTimeout(() => window.location.href = 'menu.html', 1500);
        } else {
          throw errSave;
        }
      }

    } catch (err) {
      UI?.hideOverlay?.();
      console.error('Error guardando acceso:', err);
      UI?.alert?.('Error', 'No fue posible guardar el acceso vehicular: ' + err.message);
    }
  });
});
