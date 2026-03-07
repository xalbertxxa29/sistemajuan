// auth.js v69 — Login + Registro + Catálogos (Cliente/Unidad/Puesto) con compatibilidad de esquemas
(() => {
  // Firebase ya está inicializado en initFirebase.js, solo obtener referencias
  const auth = firebase.auth();
  const db = firebase.firestore();

  // 🆕 Guardar referencia global a db para control de tiempos
  window.firestoreDb = db;

  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => { });

  const UX = {
    show: (m) => (window.UI && UI.showOverlay) ? UI.showOverlay(m) : void 0,
    hide: () => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (t, m, cb) => (window.UI && UI.alert) ? UI.alert(t, m, cb) : (alert(`${t || ''}\n\n${m || ''}`), cb && cb()),
  };
  const $ = (id) => document.getElementById(id);

  /* ===================== TABS ===================== */
  const tabLogin = $('tab-login');
  const tabRegister = $('tab-register');
  const loginTab = $('login-tab');
  const registerTab = $('register-tab');

  function showTab(which) {
    if (!loginTab || !registerTab || !tabLogin || !tabRegister) return;
    const showLogin = (which === 'login');
    tabLogin.classList.toggle('active', showLogin);
    tabRegister.classList.toggle('active', !showLogin);
    loginTab.style.display = showLogin ? 'block' : 'none';
    registerTab.style.display = showLogin ? 'none' : 'block';
  }

  tabLogin?.addEventListener('click', () => showTab('login'));
  tabRegister?.addEventListener('click', () => showTab('register'));

  /* ============ CONTROL DE TIEMPOS: Registro Invisible de Conexiones ============ */

  // Almacenar ID de registro de control actual
  window.currentControlTimerId = null;

  // Iniciar control de tiempo - CON DATOS COMPLETOS DEL USUARIO
  window.iniciarControlTiempo = async function (userId, razonInicio = 'LOGIN') {
    try {
      console.log(`[control-tiempos] ⏳ Iniciando control para ${userId}... Razón: ${razonInicio}`);

      let db_ref = window.firestoreDb;
      if (!db_ref) {
        console.warn('[control-tiempos] ⚠️ window.firestoreDb no disponible, usando db global');
        db_ref = db;
      }

      if (!db_ref) {
        console.error('[control-tiempos] ❌ NO hay DB disponible');
        return null;
      }

      // VERIFICAR si ya existe un registro ACTIVO para este usuario
      console.log(`[control-tiempos] 🔍 Buscando registro ACTIVO existente para ${userId}...`);
      const querySnapshot = await db_ref.collection('CONTROL_TIEMPOS_USUARIOS')
        .where('usuarioID', '==', userId)
        .where('estado', '==', 'ACTIVO')
        .limit(1)
        .get();

      if (!querySnapshot.empty) {
        // YA EXISTE UN REGISTRO ACTIVO
        const docExistente = querySnapshot.docs[0];
        console.log(`[control-tiempos] ⚠️ Ya existe registro ACTIVO: ${docExistente.id}`);
        console.log('[control-tiempos] ℹ️ Reutilizando registro existente...');
        window.currentControlTimerId = docExistente.id;
        return docExistente.id;
      }

      // LEER DATOS DEL USUARIO DESDE FIRESTORE
      console.log(`[control-tiempos] 📖 Leyendo datos del usuario desde USUARIOS...`);
      const usuarioDoc = await db_ref.collection('USUARIOS').doc(userId).get();

      if (!usuarioDoc.exists) {
        console.error(`[control-tiempos] ❌ Usuario ${userId} no encontrado en USUARIOS`);
        return null;
      }

      const usuarioData = usuarioDoc.data();
      console.log(`[control-tiempos] ✓ Datos del usuario obtenidos`);

      // NO EXISTE REGISTRO ACTIVO - CREAR UNO NUEVO CON TODOS LOS DATOS
      console.log(`[control-tiempos] ✨ Creando nuevo registro con datos completos...`);
      const nuevoRegistro = {
        usuarioID: userId,
        nombreUsuario: `${usuarioData.NOMBRES || ''} ${usuarioData.APELLIDOS || ''}`.trim().toUpperCase(),
        cliente: usuarioData.CLIENTE || '',
        unidad: usuarioData.UNIDAD || '',
        puesto: usuarioData.PUESTO || '',
        horaInicio: firebase.firestore.FieldValue.serverTimestamp(),
        horaCierre: null,
        duracionSegundos: null,
        razon: razonInicio,
        estado: 'ACTIVO'
      };

      console.log(`[control-tiempos] 📋 Datos a guardar:`, JSON.stringify(nuevoRegistro, null, 2));
      console.log(`[control-tiempos] 💾 Escribiendo a CONTROL_TIEMPOS_USUARIOS...`);

      const colRef = db_ref.collection('CONTROL_TIEMPOS_USUARIOS');
      const docRef = await colRef.add(nuevoRegistro);
      console.log(`[control-tiempos] ✅ GUARDADO - ID: ${docRef.id}`);

      window.currentControlTimerId = docRef.id;
      return docRef.id;
    } catch (error) {
      console.error('[control-tiempos] ❌ ERROR:', error.message);
      console.error('[control-tiempos] 📍 Stack:', error.stack);
      return null;
    }
  };
  console.log('[auth] 🟢 iniciarControlTiempo registrada');

  // Finalizar control de tiempo - CON CÁLCULO DE DURACIÓN
  window.finalizarControlTiempo = async function (userId, razonCierre = 'LOGOUT') {
    try {
      console.log(`[control-tiempos] ⏳ Finalizando... Razón: ${razonCierre}`);

      const db_ref = window.firestoreDb;

      if (!window.currentControlTimerId) {
        console.log('[control-tiempos] ⚠️ No hay ID de control');
        return;
      }

      console.log(`[control-tiempos] 💾 Actualizando ID: ${window.currentControlTimerId}`);

      // LEER EL DOCUMENTO ACTUAL PARA OBTENER horaInicio
      const docActual = await db_ref.collection('CONTROL_TIEMPOS_USUARIOS').doc(window.currentControlTimerId).get();

      if (!docActual.exists) {
        console.error('[control-tiempos] ❌ Documento no encontrado');
        return;
      }

      const datosActuales = docActual.data();
      let duracionSegundos = null;

      // CALCULAR DURACIÓN SI EXISTE horaInicio
      if (datosActuales.horaInicio) {
        console.log('[control-tiempos] 📊 Calculando duración...');
        // horaInicio es un Timestamp de Firestore, convertir a milisegundos
        const horaInicioMs = datosActuales.horaInicio.toMillis ?
          datosActuales.horaInicio.toMillis() :
          new Date(datosActuales.horaInicio).getTime();

        const ahora = Date.now();
        duracionSegundos = Math.floor((ahora - horaInicioMs) / 1000);
        console.log(`[control-tiempos] ✓ Duración calculada: ${duracionSegundos} segundos`);
      }

      const updateData = {
        horaCierre: firebase.firestore.FieldValue.serverTimestamp(),
        duracionSegundos: duracionSegundos,
        razon: razonCierre,
        estado: 'CERRADO'
      };

      await db_ref.collection('CONTROL_TIEMPOS_USUARIOS').doc(window.currentControlTimerId).update(updateData);

      console.log(`[control-tiempos] ✅ CERRADO - Duración: ${duracionSegundos}s, Razón: ${razonCierre}`);
      window.currentControlTimerId = null;
    } catch (error) {
      console.error('[control-tiempos] ❌ ERROR:', error.message);
    }
  };

  /* ============ SELECTS de Registro ============ */
  const selCliente = $('reg-cliente');
  const selUnidad = $('reg-unidad');
  const selPuesto = $('reg-puesto');

  // ========= Carga CLIENTES =========
  async function loadClientes() {
    if (!selCliente || !selUnidad || !selPuesto) return;
    selCliente.innerHTML = '<option value="" disabled selected>Cargando…</option>';
    selUnidad.innerHTML = '<option value="" disabled selected>Selecciona un cliente…</option>';
    selUnidad.disabled = true;
    selPuesto.innerHTML = '<option value="" disabled selected>Selecciona una unidad…</option>';
    selPuesto.disabled = true;

    try {
      const snap = await db.collection('CLIENTE_UNIDAD')
        .orderBy(firebase.firestore.FieldPath.documentId())
        .get();

      if (snap.empty) {
        selCliente.innerHTML = '<option value="" disabled>No hay clientes</option>';
        return;
      }

      selCliente.innerHTML = '<option value="" disabled selected>Selecciona…</option>';
      snap.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = doc.id;
        selCliente.appendChild(opt);
      });
      console.log('[auth] Clientes cargados:', selCliente.options.length - 1);
    } catch (e) {
      console.error('[auth] loadClientes', e);
      selCliente.innerHTML = '<option value="" disabled>Error al cargar</option>';
      UX.alert('Error', 'No se pudieron cargar los clientes.');
    }
  }

  // ========= Carga UNIDADES (Estructura B: Subcolecciones) =========
  async function loadUnidades(cliente) {
    if (!selUnidad || !selPuesto) return;
    selUnidad.innerHTML = '<option value="" disabled selected>Cargando…</option>';
    selUnidad.disabled = true;
    selPuesto.innerHTML = '<option value="" disabled selected>Selecciona una unidad…</option>';
    selPuesto.disabled = true;

    try {
      const base = db.collection('CLIENTE_UNIDAD').doc(cliente);

      // Leer subcolección UNIDADES
      const unidadesSnapshot = await base.collection('UNIDADES').get();
      const unidades = [];
      unidadesSnapshot.forEach(doc => unidades.push(doc.id));
      console.log('[auth] UNIDADES desde subcolección:', unidades);

      if (!unidades.length) {
        selUnidad.innerHTML = '<option value="" disabled>No hay unidades</option>';
        return;
      }

      unidades.sort();
      selUnidad.innerHTML = '<option value="" disabled selected>Selecciona…</option>';
      for (const u of unidades) {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = u;
        selUnidad.appendChild(opt);
      }
      selUnidad.disabled = false;
    } catch (e) {
      console.error('[auth] loadUnidades', e);
      selUnidad.innerHTML = '<option value="" disabled>Error</option>';
      UX.alert('Error', 'No se pudieron cargar las unidades.');
    }
  }

  // ========= Carga PUESTOS (Estructura B: Subcolecciones) =========
  async function loadPuestos(cliente, unidad) {
    if (!selPuesto) return;
    selPuesto.innerHTML = '<option value="" disabled selected>Cargando…</option>';
    selPuesto.disabled = true;

    try {
      const baseCliente = db.collection('CLIENTE_UNIDAD').doc(cliente);
      const baseUnidad = baseCliente.collection('UNIDADES').doc(unidad);

      // Leer subcolección PUESTOS
      const puestosSnapshot = await baseUnidad.collection('PUESTOS').get();
      const puestos = [];
      puestosSnapshot.forEach(doc => puestos.push(doc.id));
      console.log('[auth] PUESTOS desde subcolección:', puestos);

      if (!puestos.length) {
        selPuesto.innerHTML = '<option value="" disabled>No hay puestos</option>';
        return;
      }

      puestos.sort();
      selPuesto.innerHTML = '<option value="" disabled selected>Selecciona…</option>';
      for (const p of puestos) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        selPuesto.appendChild(opt);
      }
      selPuesto.disabled = false;
    } catch (e) {
      console.error('[auth] loadPuestos', e);
      selPuesto.innerHTML = '<option value="" disabled>Error</option>';
      UX.alert('Error', 'No se pudieron cargar los puestos.');
    }
  }

  selCliente?.addEventListener('change', (e) => {
    loadUnidades(e.target.value);
    actualizarEstadoBotonRegistro();
  });
  selUnidad?.addEventListener('change', (e) => {
    loadPuestos(selCliente.value, e.target.value);
    actualizarEstadoBotonRegistro();
  });

  /* ============ Validación en Tiempo Real del Formulario ============ */
  function actualizarEstadoBotonRegistro() {
    const registerBtn = $('register-btn');
    if (!registerBtn) return;

    const validacion = validarFormularioRegistro();
    registerBtn.disabled = validacion.error;

    // Agregar visual feedback
    if (validacion.error) {
      registerBtn.style.opacity = '0.5';
      registerBtn.title = validacion.mensaje;
      registerBtn.style.cursor = 'not-allowed';
    } else {
      registerBtn.style.opacity = '1';
      registerBtn.title = 'Haz clic para registrar';
      registerBtn.style.cursor = 'pointer';
    }
  }

  // Escuchar cambios en campos de texto
  ['reg-id', 'reg-nombres', 'reg-apellidos', 'reg-pass1', 'reg-pass2'].forEach(id => {
    $(id)?.addEventListener('input', actualizarEstadoBotonRegistro);
    $(id)?.addEventListener('change', actualizarEstadoBotonRegistro);
  });

  // Validación inicial
  actualizarEstadoBotonRegistro();

  /* ============ Modales “+” ============ */
  const open = (el) => el && (el.style.display = 'flex');
  const close = (el) => el && (el.style.display = 'none');

  // Cliente
  const modalAddCliente = $('modal-add-cliente');
  $('add-cliente-btn')?.addEventListener('click', () => {
    $('nuevo-cliente').value = '';
    open(modalAddCliente);
  });
  $('cancel-add-cliente')?.addEventListener('click', () => close(modalAddCliente));
  $('save-add-cliente')?.addEventListener('click', async () => {
    const cli = String($('nuevo-cliente').value || '').trim().toUpperCase();
    if (!cli) return UX.alert('Aviso', 'Escribe el nombre del cliente.');
    try {
      UX.show('Guardando cliente…');
      await db.collection('CLIENTE_UNIDAD').doc(cli)
        .set({ creadoEn: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      close(modalAddCliente);
      await loadClientes();
      selCliente.value = cli;
      selCliente.dispatchEvent(new Event('change'));
    } catch (e) {
      console.error(e); UX.alert('Error', 'No se pudo crear el cliente.');
    } finally { UX.hide(); }
  });

  // Unidad
  const modalAddUnidad = $('modal-add-unidad');
  $('add-unidad-btn')?.addEventListener('click', () => {
    const cli = selCliente.value;
    if (!cli) return UX.alert('Aviso', 'Selecciona primero un cliente.');
    $('nueva-unidad').value = '';
    $('ctx-unidad').textContent = `Cliente: ${cli}`;
    open(modalAddUnidad);
  });
  $('cancel-add-unidad')?.addEventListener('click', () => close(modalAddUnidad));
  $('save-add-unidad')?.addEventListener('click', async () => {
    const cli = selCliente.value;
    const uni = String($('nueva-unidad').value || '').trim().toUpperCase();
    if (!cli) return UX.alert('Aviso', 'Selecciona un cliente.');
    if (!uni) return UX.alert('Aviso', 'Escribe la unidad.');
    try {
      UX.show('Guardando unidad…');
      // Doc de la unidad + compat
      const base = db.collection('CLIENTE_UNIDAD').doc(cli);
      await base.collection('UNIDADES').doc(uni)
        .set({ puestos: [], actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await base.set({
        unidades: firebase.firestore.FieldValue.arrayUnion(uni)
      }, { merge: true });

      close(modalAddUnidad);
      await loadUnidades(cli);
      selUnidad.value = uni;
      selUnidad.dispatchEvent(new Event('change'));
    } catch (e) {
      console.error(e); UX.alert('Error', 'No se pudo crear la unidad.');
    } finally { UX.hide(); }
  });

  // Puesto
  const modalAddPuesto = $('modal-add-puesto');
  $('add-puesto-btn')?.addEventListener('click', () => {
    const cli = selCliente.value, uni = selUnidad.value;
    if (!cli) return UX.alert('Aviso', 'Selecciona un cliente.');
    if (!uni) return UX.alert('Aviso', 'Selecciona una unidad.');
    $('nuevo-puesto').value = '';
    $('ctx-puesto').textContent = `Cliente: ${cli} • Unidad: ${uni}`;
    open(modalAddPuesto);
  });
  $('cancel-add-puesto')?.addEventListener('click', () => close(modalAddPuesto));
  $('save-add-puesto')?.addEventListener('click', async () => {
    const cli = selCliente.value, uni = selUnidad.value;
    const pto = String($('nuevo-puesto').value || '').trim().toUpperCase();
    if (!pto) return UX.alert('Aviso', 'Escribe el puesto.');
    try {
      UX.show('Guardando puesto…');
      const base = db.collection('CLIENTE_UNIDAD').doc(cli).collection('UNIDADES').doc(uni);
      // Subcolección
      await base.collection('PUESTOS').doc(pto)
        .set({ creadoEn: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      // Campo array en la unidad
      await base.set({ puestos: firebase.firestore.FieldValue.arrayUnion(pto) }, { merge: true });
      // Campo anidado en doc cliente (objeto unidades[unidad] = array)
      await db.collection('CLIENTE_UNIDAD').doc(cli).set({
        unidades: { [uni]: firebase.firestore.FieldValue.arrayUnion(pto) }
      }, { merge: true });

      close(modalAddPuesto);
      await loadPuestos(cli, uni);
      selPuesto.value = pto;
    } catch (e) {
      console.error(e); UX.alert('Error', 'No se pudo crear el puesto.');
    } finally { UX.hide(); }
  });

  /* ============ Login ============ */
  $('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = String(($('login-email')?.value || '')).trim();
    const pass = String(($('login-pass')?.value || ''));
    if (!user || !pass) return UX.alert('Aviso', 'Completa usuario y contraseña.');
    // El email siempre usa dominio @liderman.com.pe
    const email = user.includes('@') ? user : `${user}@liderman.com.pe`;
    try {
      UX.show('Ingresando…');
      console.log('[auth] 🔵 Login iniciado:', email);
      await auth.signInWithEmailAndPassword(email, pass);
      console.log('[auth] ✅ Login exitoso');

      // 🚩 ACTIVAR validación de usuario duplicado solo en login
      window.validarUsuarioDuplicado = true;

      // Mantenemos el overlay ACTIVO ("Ingresando...") para que empate con "Validando perfil..." en menu.js
      // UX.hide(); 
      location.href = 'menu.html';
    } catch (err) {
      console.error(err); UX.hide();
      const msg =
        err?.code === 'auth/user-not-found' ? 'Usuario no encontrado.' :
          err?.code === 'auth/wrong-password' ? 'Contraseña incorrecta.' :
            err?.code === 'auth/invalid-email' ? 'Usuario inválido.' :
              'No fue posible iniciar sesión.';
      UX.alert('Login', msg);
    }
  });

  /* ============ Guardar Usuario en Firestore (con reintentos) ============ */
  async function guardarUsuarioEnFirestore(userId, datosUsuario) {
    const maxIntentos = 3;
    let ultimoError = null;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      try {
        console.log(`[auth] Intento ${intento}/${maxIntentos} guardando usuario en Firestore...`);

        await db.collection('USUARIOS').doc(userId).set(datosUsuario, { merge: true });

        console.log(`[auth] ✅ Usuario guardado exitosamente en USUARIOS/${userId}`);
        console.log('[auth] Datos guardados:', datosUsuario);
        return true;

      } catch (error) {
        ultimoError = error;
        console.error(`[auth] ❌ Intento ${intento} falló:`, {
          code: error.code,
          message: error.message,
          details: error
        });

        // Si hay más intentos, esperar antes de reintentar
        if (intento < maxIntentos) {
          const espera = 1000 * intento;  // 1s, 2s, 3s
          console.log(`[auth] Esperando ${espera}ms antes de reintentar...`);
          await new Promise(resolve => setTimeout(resolve, espera));
        }
      }
    }

    // Si llegamos aquí, todos los intentos fallaron
    throw new Error(
      `No se pudo guardar usuario en Firestore después de ${maxIntentos} intentos. ` +
      `Último error: ${ultimoError?.code || 'UNKNOWN'} - ${ultimoError?.message || 'Sin detalles'}`
    );
  }

  /* ============ Validar Formulario Registro ============ */
  function validarFormularioRegistro() {
    const id = String(($('reg-id')?.value || '')).trim();
    const nom = String(($('reg-nombres')?.value || '')).trim();
    const ape = String(($('reg-apellidos')?.value || '')).trim();
    const cli = String(selCliente?.value || '').trim();
    const uni = String(selUnidad?.value || '').trim();
    const pue = String(selPuesto?.value || '').trim();
    const p1 = String(($('reg-pass1')?.value || ''));
    const p2 = String(($('reg-pass2')?.value || ''));

    // Validar campo por campo con mensajes específicos
    if (!id) return { error: true, mensaje: 'Ingresa tu ID o Usuario.' };
    if (!nom) return { error: true, mensaje: 'Ingresa tu Nombre.' };
    if (!ape) return { error: true, mensaje: 'Ingresa tu Apellido.' };

    if (!cli) return { error: true, mensaje: '❌ CLIENTE: Selecciona uno de la lista.' };
    if (!uni || selUnidad?.disabled) return { error: true, mensaje: '❌ UNIDAD: Selecciona una. (Si no ves opciones, crea una con el botón +)' };
    if (!pue || selPuesto?.disabled) return { error: true, mensaje: '❌ PUESTO: Selecciona uno. (Si no ves opciones, crea uno con el botón +)' };

    if (!p1) return { error: true, mensaje: 'Ingresa una Contraseña (mín. 6 caracteres).' };
    if (!p2) return { error: true, mensaje: 'Repite la Contraseña.' };
    if (p1.length < 6) return { error: true, mensaje: 'La Contraseña debe tener AL MENOS 6 caracteres.' };
    if (p1 !== p2) return { error: true, mensaje: 'Las Contraseñas NO COINCIDEN.' };

    // Todo OK
    return { error: false, datos: { id, nom, ape, cli, uni, pue, p1, p2 } };
  }

  /* ============ Registro ============ */
  $('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validar formulario
    const validacion = validarFormularioRegistro();
    if (validacion.error) {
      return UX.alert('❌ Registro Incompleto', validacion.mensaje);
    }

    const { id, nom, ape, cli, uni, pue, p1 } = validacion.datos;
    const tipo = 'AGENTE';
    const email = `${id}@liderman.com.pe`;

    try {
      UX.show('Creando usuario...');
      console.log('[auth] ===== REGISTRO NUEVO ORDEN: FIRESTORE PRIMERO =====');

      // ==========================================
      // PASO 1: CREAR DOCUMENTO EN FIRESTORE PRIMERO
      // ==========================================
      console.log(`[auth] Paso 1: Guardando ${id} en Firestore USUARIOS...`);
      UX.show('Guardando datos en Firestore...');

      await guardarUsuarioEnFirestore(id, {
        ID: id,
        NOMBRES: nom.toUpperCase(),
        APELLIDOS: ape.toUpperCase(),
        CLIENTE: cli.toUpperCase(),
        UNIDAD: uni.toUpperCase(),
        PUESTO: pue.toUpperCase(),
        TIPO: tipo,
        ESTADO: 'ACTIVO',
        EMAIL: email,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
      });

      console.log(`[auth] ✅ PASO 1 EXITOSO: Documento creado en USUARIOS/${id}`);
      console.log('[auth] Datos en Firestore:', { ID: id, NOMBRES: nom, CLIENTE: cli, UNIDAD: uni, PUESTO: pue });

      // ==========================================
      // PASO 2: CREAR USUARIO EN FIREBASE AUTH
      // ==========================================
      console.log(`[auth] Paso 2: Creando autenticación en Firebase Auth...`);
      UX.show('Configurando autenticación...');

      try {
        await auth.createUserWithEmailAndPassword(email, p1);
        console.log(`[auth] ✅ PASO 2 EXITOSO: Usuario creado en Firebase Auth`);
        console.log(`[auth] Email: ${email}`);

        // ✅ TODO ÉXITO
        console.log('[auth] ✅✅✅ REGISTRO COMPLETADO EXITOSAMENTE ✅✅✅');
        console.log('[auth] Usuario disponible en: USUARIOS/' + id);
        console.log('[auth] Autenticación: ' + email);

        UX.hide();
        UX.alert(
          '✅ ¡Éxito!',
          `Usuario ${id} creado correctamente\n\nEmail: ${email}\n\nRedirigiendo al dashboard...`,
          () => {
            setTimeout(() => { location.href = 'menu.html'; }, 500);
          }
        );

      } catch (authErr) {
        // ❌ Firebase Auth falló, PERO datos YA están en Firestore
        console.error(`[auth] ❌ PASO 2 FALLÓ: Error en Firebase Auth`, authErr.code, authErr.message);
        console.error(`[auth] ⚠️  IMPORTANTE: Datos YA están guardados en Firestore (USUARIOS/${id})`);
        console.error(`[auth] ⚠️  Solo falló la autenticación`);

        UX.hide();

        let mensajeAuth = 'Error en autenticación.';
        if (authErr?.code === 'auth/email-already-in-use') {
          mensajeAuth = '⚠️ Ese email ya tiene cuenta.\n\n¡PERO tus datos SÍ se guardaron en el sistema!\n\nIntenta loguear.';
        } else if (authErr?.code === 'auth/weak-password') {
          mensajeAuth = '⚠️ Contraseña muy débil.\n\n¡PERO tus datos SÍ se guardaron!\n\nIntenta de nuevo con contraseña más fuerte.';
        } else if (authErr?.code === 'auth/invalid-email') {
          mensajeAuth = '⚠️ Email inválido.\n\n¡PERO tus datos SÍ se guardaron!\n\nContacta admin.';
        } else {
          mensajeAuth = `⚠️ ${authErr.message || 'Error desconocido'}\n\n¡PERO tus datos SÍ se guardaron en el sistema!`;
        }

        UX.alert('⚠️ Problema de Autenticación', mensajeAuth + '\n\nContacta al administrador para completar el registro.');
      }

    } catch (fsErr) {
      // ❌ Firestore falló = Error fatal
      console.error(`[auth] ❌❌ ERROR CRÍTICO EN FIRESTORE ❌❌`, fsErr.code, fsErr.message);
      console.error(`[auth] Detalles:`, fsErr);

      UX.hide();

      let mensajeFS = 'No se pudieron guardar tus datos en el sistema.';

      if (fsErr?.message?.includes('permission-denied')) {
        mensajeFS = '❌ Permiso denegado.\n\nNo tienes permisos para crear cuenta.\n\nContacta al administrador.';
      } else if (fsErr?.message?.includes('No se pudo guardar usuario')) {
        mensajeFS = `❌ ${fsErr.message}`;
      } else {
        mensajeFS = `❌ Error: ${fsErr.message || 'Desconocido'}`;
      }

      UX.alert('❌ Error Crítico', mensajeFS);
    }
  });

  /* ============ HELPER: Obtener Nombre Completo del Usuario ============ */
  window.obtenerNombreCompletoUsuario = async function () {
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) {
        console.log('[auth] No hay usuario autenticado');
        return 'USUARIO DESCONOCIDO';
      }

      const docUsuario = await db.collection('USUARIOS').doc(userId).get();
      if (docUsuario.exists) {
        const { NOMBRES = '', APELLIDOS = '' } = docUsuario.data();
        const nombreCompleto = `${NOMBRES} ${APELLIDOS}`.trim().toUpperCase();
        console.log(`[auth] Nombre completo obtenido: ${nombreCompleto}`);
        return nombreCompleto;
      }

      console.log('[auth] Documento USUARIOS no existe, usando ID');
      return userId; // Fallback al ID
    } catch (error) {
      console.error('[auth] Error obteniendo nombre completo:', error);
      return auth.currentUser?.uid || 'ERROR';
    }
  };

  /* ============ Inicio ============ */
  console.log('[auth] 🟢 auth.js IIFE ejecutándose...');
  console.log('[auth] 🟢 window.firestoreDb disponible:', !!window.firestoreDb);
  console.log('[auth] 🟢 window.iniciarControlTiempo disponible:', typeof window.iniciarControlTiempo);

  loadClientes().catch(console.error);

  // Por defecto, mostrar "Iniciar Sesión".
  // Solo ir a "Registrarse" si la URL trae #register
  if (location.hash === '#register') {
    showTab('register');
  } else {
    showTab('login');
  }

  console.log('[auth] 🟢 auth.js IIFE COMPLETADO - Control de tiempos listo');
})();
