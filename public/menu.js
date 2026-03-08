// menu.js (v69) — Relevo funcional, cambio de sesión sin redirigir al login
document.addEventListener("DOMContentLoaded", () => {
  try {
    // Solo inicializar si aún no lo hemos hecho
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    const auth = firebase.auth();
    const db = firebase.firestore();

    const emailFromId = id => `${id}@liderman.com.pe`;
    const sanitizeId = raw => raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');

    let secondaryApp = null;
    const getSecondaryAuth = () => {
      if (!secondaryApp)
        secondaryApp = firebase.apps.find(a => a.name === "secondary") || firebase.initializeApp(firebaseConfig, "secondary");
      return secondaryApp.auth();
    };

    let usuarioSalienteData = null;
    let relevoSignaturePad = null;
    let clientesDataCU = {};
    let switchingSession = false; // 👈 evita redirección al login durante el switch

    // === Auth principal ===
    auth.onAuthStateChanged(async user => {
      // Si estamos cambiando sesión, ignorar el user=null intermedio
      if (!user) {
        if (switchingSession) return;
        window.location.href = "index.html";
        return;
      }
      try {
        const userId = user.email.split("@")[0];
        console.log('[menu] 👤 Usuario autenticado:', userId);

        // 🛡️ 1. MOSTRAR OVERLAY DE VALIDACIÓN
        if (typeof UI !== 'undefined' && UI.showOverlay) {
          UI.showOverlay("Validando perfil de usuario...");
        }

        let perfilValido = false;
        let userData = null;

        // 🛡️ 2. BUSCAR DATOS EN CACHÉ GLOBAL (OPTIMIZADO)
        try {
          if (window.getUserProfile) {
            userData = await window.getUserProfile(userId);
            if (userData && userData.CLIENTE && userData.UNIDAD) {
              perfilValido = true;
            }
          } else {
            // Fallback directo si initFirebase no ha cargado la función
            const doc = await db.collection("USUARIOS").doc(userId).get();
            if (doc.exists) {
              userData = { ...doc.data(), id: userId };
              perfilValido = true;
            }
          }
        } catch (firebaseError) {
          console.warn('[menu] No se pudo cargar perfil:', firebaseError?.message);
        }

        // 🛡️ 3. FALLBACK OFFLINE SI FIRESTORE FALLÓ O NO EXISTÍA
        if (!perfilValido && typeof offlineStorage !== 'undefined') {
          try {
            const cachedUser = await offlineStorage.getUserData();
            if (cachedUser && cachedUser.userId === userId) {
              if (cachedUser.cliente && cachedUser.unidad) {
                // Adaptamos las claves del cache a mayúsculas para mantener consistencia 
                userData = {
                  ...cachedUser,
                  CLIENTE: cachedUser.cliente,
                  UNIDAD: cachedUser.unidad,
                  NOMBRES: cachedUser.nombres,
                  APELLIDOS: cachedUser.apellidos,
                  PUESTO: cachedUser.puesto,
                  id: userId
                };
                perfilValido = true;
                console.log('[menu] ✓ Perfil recuperado de caché offline válido.');
              } else {
                console.warn('[menu] Cache offline incompleto (sin cliente/unidad).');
              }
            } else if (cachedUser) {
              console.log('[menu] Usuario en cache diferente al logueado. Limpiando cache...');
              await offlineStorage.clearAll();
            }
          } catch (cacheError) {
            console.warn('[menu] Error accediendo a cache offline:', cacheError?.message);
          }
        }

        // 🛡️ 4. DECISIÓN: CERRAMOS SESIÓN SI EL PERFIL NO ES VÁLIDO
        if (!perfilValido) {
          console.warn(`[menu] ❌ El usuario ${userId} NO tiene perfil básico válido (Cliente/Unidad) ni en BD ni en caché.`);
          if (typeof UI !== 'undefined' && UI.hideOverlay) UI.hideOverlay();
          await auth.signOut();

          if (typeof UI !== 'undefined' && UI.alert) {
            UI.alert("Error de Perfil", "Tu perfil no tiene un Cliente o Unidad designados. Contacta a soporte para que configuren tu cuenta.", () => {
              window.location.href = "index.html";
            });
          } else {
            alert("Error: Tu perfil no tiene un Cliente o Unidad designados. Contacta a soporte para que configuren tu cuenta.");
            window.location.href = "index.html";
          }
          return;
        }

        // Si llegamos aquí, el usuario ES 100% VÁLIDO y tiene userData
        usuarioSalienteData = userData;

        // Limpiar el overlay rápido para que vea la interfaz
        if (typeof UI !== 'undefined' && UI.hideOverlay) {
          UI.hideOverlay();
        }

        // Actualizar UI con su nombre y unidad
        const nameEl = $("#user-details");
        const unitEl = $("#user-client-unit");
        const userDataRaw = userData || {};
        const nom = userDataRaw.NOMBRES || userDataRaw.nombres || '';
        const ape = userDataRaw.APELLIDOS || userDataRaw.apellidos || '';
        const fullname = `${nom} ${ape}`.trim();
        nameEl.textContent = fullname || userId;
        unitEl.textContent = `${userDataRaw.CLIENTE || userDataRaw.cliente || ''} - ${userDataRaw.UNIDAD || userDataRaw.unidad || ''} - ${userDataRaw.PUESTO || userDataRaw.puesto || ''}`;

        // 💾 5. GUARDAR / REFRESCAR CACHE LOCAL DEL PERFIL
        if (typeof offlineStorage !== 'undefined') {
          await offlineStorage.setUserData({
            email: user.email,
            userId: userId,
            nombres: nom,
            apellidos: ape,
            cliente: userDataRaw.CLIENTE || userDataRaw.cliente || '',
            unidad: userDataRaw.UNIDAD || userDataRaw.unidad || '',
            puesto: userDataRaw.PUESTO || userDataRaw.puesto || ''
          }).catch(e => console.warn('[menu] Error refrescando caché offline:', e));
        }

        // 🔍 6. VALIDAR USUARIOS DUPLICADOS (Si recién hizo login manual)
        if (window.validarUsuarioDuplicado === true) {
          const otrosConectados = await db.collection('CONTROL_TIEMPOS_USUARIOS')
            .where('usuarioID', '!=', userId)
            .where('cliente', '==', userData.CLIENTE)
            .where('unidad', '==', userData.UNIDAD)
            .where('estado', '==', 'ACTIVO')
            .limit(1)
            .get();

          if (!otrosConectados.empty) {
            const otroUsuario = otrosConectados.docs[0].data();
            console.warn(`[menu] ⚠️ Otro usuario ya conectado: ${otroUsuario.usuarioID} (${otroUsuario.nombreUsuario})`);
            if (typeof UI !== 'undefined' && UI.alert) {
              UI.alert('Advertencia de Relevo', `Parece que ${otroUsuario.nombreUsuario} dejó su sesión activa en este puesto. Por favor, asegúrate de realizar formalmente un "Relevo" para evitar discrepancias.`);
            }
          }
          // Limpiar flag
          window.validarUsuarioDuplicado = false;
        }

        // ⏱️ 7. INICIAR EL CONTROL DE TIEMPO AHORA SÍ CON SEGURIDAD
        if (window.iniciarControlTiempo) {
          console.log('[menu] ⏳ Iniciando control de tiempo validado...');
          await window.iniciarControlTiempo(userId, 'LOGIN');
          console.log('[menu] ✅ Control iniciado');
        } else {
          console.warn('[menu] ⚠️ iniciarControlTiempo no disponible en window');
        }

        // 🔄 8. SINCRONIZACIÓN GLOBAL INCREMENTAL (NUEVA ARQUITECTURA)
        if (window.SyncEngine) {
          console.log('[menu] 🚀 Iniciando Sincronización Global Bloqueante...');
          if (typeof UI !== 'undefined' && UI.showOverlay) {
            UI.showOverlay('Sincronizando información... por favor espere.');
          }

          try {
            // Await asegura que la sincronización termine antes de quitar el overlay
            await window.SyncEngine.syncAll(userData);
            console.log('[menu] ✅ Sincronización Global Inicial completada');
          } catch (err) {
            console.error('[menu] Error en Sincronización Global:', err);
          } finally {
            if (typeof UI !== 'undefined' && UI.hideOverlay) UI.hideOverlay();
          }
        }

      } catch (err) {
        console.error("[menu] Error crítico en auth callback:", err);
        if (typeof UI !== 'undefined' && UI.hideOverlay) UI.hideOverlay();
      }
    });

    // === Selectores ===
    const logoutBtn = $("#logout-btn"),
      // === Modal Ver Información ===
      verBtn = $("#ver-info-btn"); // Restored verBtn
    const verModal = $("#ver-info-modal-overlay"); // Restore verModal if it was used
    const verCancel = $("#ver-info-cancel-btn"); // Restore verCancel if it was used

    const verInfoBtn = verBtn; // Alias if we want to use new name too, but let's stick to old one for safety
    const verInfoModal = verModal;
    const verInfoCancel = verCancel;

    if (verInfoBtn) {
      verInfoBtn.addEventListener("click", e => {
        e.preventDefault();
        verInfoModal.style.display = "flex";
      });
    }
    if (verInfoCancel) {
      verInfoCancel.addEventListener("click", () => {
        verInfoModal.style.display = "none";
      });
    }

    // === Modal Ver Rondas ===
    const btnVerRondas = $("#btn-ver-rondas");
    const verRondasModal = $("#ver-rondas-modal-overlay");
    const verRondasCancel = $("#ver-rondas-cancel-btn");

    if (btnVerRondas) {
      btnVerRondas.addEventListener("click", e => {
        e.preventDefault();
        // Cerrar modal anterior si está abierto (aunque está dentro, mejor prevenir)
        if (verInfoModal) verInfoModal.style.display = "none";
        verRondasModal.style.display = "flex";
      });
    }

    if (verRondasCancel) {
      verRondasCancel.addEventListener("click", () => {
        verRondasModal.style.display = "none";
        // Reabrir el modal de información al volver
        if (verInfoModal) verInfoModal.style.display = "flex";
      });
    }
    relevoBtn = $("#relevo-btn"),
      relevoModal = $("#relevo-modal-overlay"),
      relevoForm = $("#relevo-form"),
      relevoCanvas = $("#relevo-firma-canvas"),
      relevoClear = $("#relevo-clear-firma"),
      relevoCancel = $("#relevo-cancel-btn"),
      relevoCrearUser = $("#relevo-crear-usuario-btn"),
      crearUserModal = $("#crear-usuario-modal"),
      crearUserForm = $("#crear-usuario-form"),
      crearUserCancel = $("#cu-cancel"),
      iframeModal = $("#iframe-modal"),
      iframe = $("#add-item-iframe"),
      iframeTitle = $("#iframe-title"),
      iframeClose = $("#close-iframe-modal-btn");

    const cuClienteInput = $("#cu-cliente-input"),
      cuClienteList = $("#cu-cliente-list"),
      cuUnidadInput = $("#cu-unidad-input"),
      cuUnidadList = $("#cu-unidad-list"),
      cuPuestoInput = $("#cu-puesto-input"),
      cuPuestoList = $("#cu-puesto-list"),
      cuAddCliente = $("#cu-add-cliente-btn"),
      cuAddUnidad = $("#cu-add-unidad-btn"),
      cuAddPuesto = $("#cu-add-puesto-btn");

    // === Utils ===
    const openModal = m => (m.style.display = "flex");
    const closeModal = m => (m.style.display = "none");
    function $(s) { return document.querySelector(s); }

    // === Logout ===
    logoutBtn.addEventListener("click", async e => {
      e.preventDefault();
      console.log('[menu] 🔴 Logout iniciado');
      try {
        if (window.finalizarControlTiempo && auth.currentUser) {
          console.log('[menu] ⏹️ Finalizando control');
          await window.finalizarControlTiempo(auth.currentUser.email.split('@')[0], 'LOGOUT');
          console.log('[menu] ✅ Control cerrado');
        }
        console.log('[menu] 🚪 Sign out');
        await auth.signOut();
        window.location.href = "index.html";
      } catch (error) {
        console.error('[menu] ❌ Error:', error);
        auth.signOut().then(() => (window.location.href = "index.html"));
      }
    });

    // === Ver ===
    verBtn.addEventListener("click", e => { e.preventDefault(); openModal(verModal); });
    verCancel.addEventListener("click", () => closeModal(verModal));
    verModal.addEventListener("click", e => { if (e.target === verModal) closeModal(verModal); });

    // === Firma Relevo ===
    const resizeRelevoCanvas = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = relevoCanvas.getBoundingClientRect();
      relevoCanvas.width = rect.width * ratio;
      relevoCanvas.height = rect.height * ratio;
      const ctx = relevoCanvas.getContext("2d");
      ctx.scale(ratio, ratio);
      if (relevoSignaturePad) relevoSignaturePad.clear();
    };

    relevoBtn.addEventListener("click", e => {
      e.preventDefault();
      openModal(relevoModal);
      if (!relevoSignaturePad)
        relevoSignaturePad = new SignaturePad(relevoCanvas, { backgroundColor: "white" });
      resizeRelevoCanvas();
    });
    window.addEventListener("resize", resizeRelevoCanvas);
    relevoClear.addEventListener("click", () => relevoSignaturePad?.clear());
    relevoCancel.addEventListener("click", () => { relevoForm.reset(); relevoSignaturePad?.clear(); closeModal(relevoModal); });

    // === Guardar Relevo ===
    relevoForm.addEventListener("submit", async e => {
      e.preventDefault();
      const id = sanitizeId($("#relevo-id").value);
      const pass = $("#relevo-password").value;
      const comentario = $("#relevo-comentario").value;

      if (!id || !pass || !comentario || relevoSignaturePad.isEmpty()) {
        UI.alert("Campos incompletos", "Completa todos los campos y firma."); return;
      }

      UI.showOverlay("Procesando relevo…");
      try {
        const doc = await db.collection("USUARIOS").doc(id).get();
        if (!doc.exists) throw new Error("El ID del usuario entrante no existe.");
        const u = doc.data();
        if (u.CLIENTE !== usuarioSalienteData.CLIENTE || u.UNIDAD !== usuarioSalienteData.UNIDAD)
          throw new Error("El usuario entrante no pertenece al mismo cliente/unidad.");
        if (u.ESTADO !== "ACTIVO") throw new Error("El usuario entrante no está activo.");

        // 🔐 VALIDAR CREDENCIALES PRIMERO (antes de cambiar nada)
        // Validar credenciales del entrante con auth secundaria (no rompe la sesión actual)
        const sec = getSecondaryAuth();
        try {
          await sec.signInWithEmailAndPassword(emailFromId(id), pass);
          await sec.signOut();
        } catch (authErr) {
          // ❌ Contraseña incorrecta - DETENER AQUÍ sin hacer cambios
          throw new Error('Credenciales incorrectas del usuario entrante.');
        }

        // ✅ CREDENCIALES VALIDADAS - Ahora verificar si usuario entrante ya está conectado

        // 🔍 VALIDAR que el usuario entrante NO esté conectado en otro dispositivo
        const controlActivo = await db.collection('CONTROL_TIEMPOS_USUARIOS')
          .where('usuarioID', '==', id)
          .where('estado', '==', 'ACTIVO')
          .limit(1)
          .get();

        if (!controlActivo.empty) {
          throw new Error(`El usuario ${id} ya está conectado en otro dispositivo. No se puede hacer relevo.`);
        }

        // Crear registro de relevo
        await db.collection("CUADERNO").add({
          tipoRegistro: "RELEVO",
          cliente: usuarioSalienteData.CLIENTE,
          unidad: usuarioSalienteData.UNIDAD,
          comentario,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          // v73: Guardar nombre completo de usuario saliente y entrante
          usuarioSaliente: {
            id: usuarioSalienteData.id,
            nombre: `${usuarioSalienteData.NOMBRES} ${usuarioSalienteData.APELLIDOS}`.trim().toUpperCase()
          },
          usuarioEntrante: {
            id,
            nombre: `${u.NOMBRES} ${u.APELLIDOS}`.trim().toUpperCase()
          }
        });

        // Finalizar control del saliente
        const usuarioActualEmail = auth.currentUser?.email;
        const usuarioSalienteId = usuarioActualEmail.split('@')[0];
        if (window.finalizarControlTiempo && usuarioActualEmail) {
          console.log(`[menu-relevo] ⏹️ Finalizando ${usuarioSalienteId}`);
          await window.finalizarControlTiempo(usuarioSalienteId, 'RELEVO');
          console.log(`[menu-relevo] ✅ Saliente cerrado`);
        }

        // 🔁 Cambiar sesión principal SIN hacer signOut manual para evitar user=null
        switchingSession = true;
        await auth.signInWithEmailAndPassword(emailFromId(id), pass);

        // Esperar a que onAuthStateChanged tenga al nuevo usuario
        // El onAuthStateChanged automáticamente iniciará el control para el nuevo usuario
        await new Promise((resolve) => {
          const unsub = auth.onAuthStateChanged(u2 => {
            if (u2 && u2.email === emailFromId(id)) { unsub(); resolve(); }
          });
        });

        // 🔄 Iniciar explícitamente control del entrante si no se inició automáticamente
        await new Promise(resolve => setTimeout(resolve, 500)); // Pequeño delay para asegurar que onAuthStateChanged completó
        if (window.iniciarControlTiempo) {
          console.log(`[menu-relevo] ⏳ Iniciando control del entrante: ${id}`);
          await window.iniciarControlTiempo(id, 'RELEVO');
          console.log(`[menu-relevo] ✅ Entrante registrado`);
        }

        switchingSession = false;

        UI.hideOverlay();
        UI.alert("Éxito", "Relevo completado correctamente.", () => location.reload());
      } catch (err) {
        console.error(err);
        switchingSession = false;
        UI.hideOverlay();
        const msg = err.code?.includes("auth/") ? "Credenciales incorrectas." : err.message;
        UI.alert("Error en Relevo", msg);
      }
    });

    // === Cargar catálogos (Optimizado con Caché) ===
    async function cargarDatosCU(cliPre, uniPre) {
      UI.showOverlay("Cargando catálogos...");
      try {
        // 1. Cargar CLIENTES (Caché primero)
        let clientes = [];
        if (typeof offlineStorage !== 'undefined') {
          clientes = await offlineStorage.getGlobalData('catalogo-clientes') || [];
        }

        if (clientes.length === 0 && navigator.onLine) {
          const clientesSnap = await db.collection("CLIENTE_UNIDAD").get();
          clientesSnap.forEach(doc => clientes.push(doc.id));
          clientes.sort();
          if (typeof offlineStorage !== 'undefined') {
            offlineStorage.setGlobalData('catalogo-clientes', clientes).catch(() => { });
          }
        }

        UI.createSearchableDropdown(cuClienteInput, cuClienteList, clientes, async cli => {
          cuUnidadInput.disabled = false;
          if (typeof offlineStorage !== 'undefined') {
            offlineStorage.setGlobalData('selected-cliente', cli).catch(() => { });
          }

          // 2. Cargar UNIDADES
          try {
            let unidades = [];
            if (typeof offlineStorage !== 'undefined') {
              unidades = await offlineStorage.getGlobalData(`catalogo-unidades-${cli}`) || [];
            }

            if (unidades.length === 0 && navigator.onLine) {
              const unidadesSnap = await db.collection("CLIENTE_UNIDAD").doc(cli).collection("UNIDADES").get();
              unidadesSnap.forEach(doc => unidades.push(doc.id));
              unidades.sort();
              if (typeof offlineStorage !== 'undefined') {
                offlineStorage.setGlobalData(`catalogo-unidades-${cli}`, unidades).catch(() => { });
              }
            }

            UI.createSearchableDropdown(cuUnidadInput, cuUnidadList, unidades, async uni => {
              cuPuestoInput.disabled = false;
              if (typeof offlineStorage !== 'undefined') {
                offlineStorage.setGlobalData('selected-unidad', uni).catch(() => { });
              }

              // 3. Cargar PUESTOS
              try {
                let puestos = [];
                if (typeof offlineStorage !== 'undefined') {
                  puestos = await offlineStorage.getGlobalData(`catalogo-puestos-${cli}-${uni}`) || [];
                }

                if (puestos.length === 0 && navigator.onLine) {
                  const puestosSnap = await db.collection("CLIENTE_UNIDAD").doc(cli).collection("UNIDADES").doc(uni).collection("PUESTOS").get();
                  puestosSnap.forEach(doc => puestos.push(doc.id));
                  puestos.sort();
                  if (typeof offlineStorage !== 'undefined') {
                    offlineStorage.setGlobalData(`catalogo-puestos-${cli}-${uni}`, puestos).catch(() => { });
                  }
                }

                UI.createSearchableDropdown(cuPuestoInput, cuPuestoList, puestos, pue => {
                  if (typeof offlineStorage !== 'undefined') {
                    offlineStorage.setGlobalData('selected-puesto', pue).catch(() => { });
                  }
                });
              } catch (e) {
                console.error('Error puestos:', e);
                UI.createSearchableDropdown(cuPuestoInput, cuPuestoList, [], () => { });
              }
            });
          } catch (e) {
            console.error('Error unidades:', e);
            UI.createSearchableDropdown(cuUnidadInput, cuUnidadList, [], () => { });
          }
        });

        if (cliPre) {
          cuClienteInput.value = cliPre;
          cuUnidadInput.disabled = false;
          try {
            const unidadesSnap = await db.collection("CLIENTE_UNIDAD").doc(cliPre).collection("UNIDADES").get();
            const unidades = [];
            unidadesSnap.forEach(doc => unidades.push(doc.id));
            unidades.sort();
            UI.createSearchableDropdown(cuUnidadInput, cuUnidadList, unidades);
            if (uniPre) cuUnidadInput.value = uniPre;
          } catch (e) {
            console.error('[cargarDatosCU] Error preseleccionando:', e);
          }
        }
      } catch (e) {
        console.error(e);
        UI.alert("Error", "No se pudieron cargar los catálogos.");
      } finally {
        UI.hideOverlay();
      }
    }

    // === Iframe de altas rápidas (+) ===
    const openIframeModal = (url, title) => {
      iframe.src = url;
      iframeTitle.textContent = title;
      iframeModal.style.display = "flex";
    };
    const closeIframeModal = () => {
      iframeModal.style.display = "none";
      iframe.src = "about:blank";
    };
    iframeClose.addEventListener("click", closeIframeModal);
    iframeModal.addEventListener("click", e => { if (e.target === iframeModal) closeIframeModal(); });

    // Botones "+"
    $("#cu-add-cliente-btn").addEventListener("click", () => openIframeModal("add_cliente_unidad.html", "Añadir Cliente, Unidad y Puesto"));
    $("#cu-add-unidad-btn").addEventListener("click", () => {
      const cliente = cuClienteInput.value.trim();
      if (!cliente) return UI.alert("Aviso", "Seleccione un cliente primero.");
      openIframeModal(`add_unidad.html?cliente=${encodeURIComponent(cliente)}`, "Añadir Unidad");
    });
    $("#cu-add-puesto-btn").addEventListener("click", () => {
      const cliente = cuClienteInput.value.trim();
      const unidad = cuUnidadInput.value.trim();
      if (!cliente || !unidad) return UI.alert("Aviso", "Seleccione cliente y unidad primero.");
      openIframeModal(`add_puesto.html?cliente=${encodeURIComponent(cliente)}&unidad=${encodeURIComponent(unidad)}`, "Añadir Puesto");
    });

    // Recibir mensajes desde iframes y refrescar listas
    window.addEventListener("message", event => {
      const data = event.data;
      if (!data) return;
      if (data === "clienteAgregado") cargarDatosCU();
      if (data.type === "unidadAgregada") cargarDatosCU(data.cliente);
      if (data.type === "puestoAgregado") cargarDatosCU(data.cliente, data.unidad);
    });

    // === Crear usuario rápido (desde Relevo) ===
    relevoCrearUser.addEventListener("click", () => { openModal(crearUserModal); cargarDatosCU(); });
    crearUserCancel.addEventListener("click", () => { crearUserForm.reset(); cuUnidadInput.disabled = true; cuPuestoInput.disabled = true; closeModal(crearUserModal); });

    crearUserForm.addEventListener("submit", async e => {
      e.preventDefault();
      const id = sanitizeId($("#cu-id").value),
        nom = $("#cu-nombres").value.trim(),
        ape = $("#cu-apellidos").value.trim(),
        cli = cuClienteInput.value.trim(),
        uni = cuUnidadInput.value.trim(),
        pue = cuPuestoInput.value.trim(),
        pass1 = $("#cu-pass").value,
        pass2 = $("#cu-pass2").value;

      if (!id || !nom || !ape || !cli || !uni || !pue || !pass1 || !pass2) return UI.alert("Aviso", "Complete todos los campos.");
      if (pass1 !== pass2) return UI.alert("Aviso", "Las contraseñas no coinciden.");
      if (pass1.length < 6) return UI.alert("Aviso", "La contraseña debe tener al menos 6 caracteres.");

      UI.showOverlay("Creando usuario…");
      try {
        const sec = getSecondaryAuth();
        await sec.createUserWithEmailAndPassword(emailFromId(id), pass1);
        await db.collection("USUARIOS").doc(id).set({
          NOMBRES: nom.toUpperCase(),
          APELLIDOS: ape.toUpperCase(),
          CLIENTE: cli.toUpperCase(),
          UNIDAD: uni.toUpperCase(),
          PUESTO: pue.toUpperCase(),
          TIPO: "AGENTE",
          ESTADO: "ACTIVO",
          creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        });
        await sec.signOut();

        $("#relevo-id").value = id;
        UI.hideOverlay();
        UI.alert("Usuario creado", "Ahora ingresa su contraseña para continuar el relevo.", () => closeModal(crearUserModal));
      } catch (err) {
        console.error(err);
        UI.hideOverlay();
        const msg = err.code === "auth/email-already-in-use" ? "Ese ID ya está registrado."
          : err.code === "auth/weak-password" ? "Contraseña débil (mínimo 6 caracteres)."
            : err.message;
        UI.alert("Error", msg);
      }
    });

    // === Detección de cambios de conexión (para WebView) ===
    let lastOnlineState = navigator.onLine;
    setInterval(() => {
      const currentOnlineState = navigator.onLine;
      if (!lastOnlineState && currentOnlineState) {
        console.log('🌐 Cambio detectado: Pasó de OFFLINE a ONLINE en menu.js');
        lastOnlineState = true;
        // Reintentar cargar catálogos
        cargarDatosCU();
      } else if (lastOnlineState && !currentOnlineState) {
        console.log('🔌 Cambio detectado: Pasó de ONLINE a OFFLINE en menu.js');
        lastOnlineState = false;
      }
    }, 2000); // Verificar cada 2 segundos

    window.addEventListener('online', () => {
      console.log('🌐 Evento "online" detectado en menu.js');
      cargarDatosCU();
    });

    window.addEventListener('offline', () => {
      console.log('🔌 Evento "offline" detectado en menu.js');
    });

  } catch (err) {
    console.error('Error fatal en menu.js:', err);
  }
});
