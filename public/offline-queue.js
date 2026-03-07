// offline-queue.js (v3) — Cola offline en IndexedDB, robusta y compatible
// API expuesta en window.OfflineQueue:
//   - add(task)            -> Promise<number> (id autoincremental)
//   - takeAll()            -> Promise<Task[]> (ordenadas por createdAt ASC)
//   - remove(id)           -> Promise<void>
//   - count()              -> Promise<number>
//   - clear()              -> Promise<void>
//   - all()                -> Promise<Task[]> (alias legacy, igual que takeAll)
//
// Nota: mantenemos DB_NAME y STORE de tu versión para no perder tareas existentes.

(function () {
  const DB_NAME = 'offlineQueueDB'; // conservar para compatibilidad
  const STORE = 'queue';
  let db = null;

  // ---------- Apertura de DB (reutilizable) ----------
  function openDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const _db = e.target.result;
        if (!_db.objectStoreNames.contains(STORE)) {
          _db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error('IndexedDB open error'));
    });
  }

  async function getDB() {
    if (db) return db;
    db = await openDB();
    return db;
  }

  // Utilidad genérica para transacciones
  async function withStore(mode, fn) {
    const _db = await getDB();
    return new Promise((res, rej) => {
      const tx = _db.transaction(STORE, mode);
      const st = tx.objectStore(STORE);
      let result;
      try {
        result = fn(st);
      } catch (e) {
        rej(e); return;
      }
      tx.oncomplete = () => res(result?.result ?? result);
      tx.onerror = () => rej(tx.error || new Error('IndexedDB tx error'));
      tx.onabort = () => rej(tx.error || new Error('IndexedDB tx aborted'));
    });
  }

  // ---------- API ----------
  async function add(task) {
    const payload = {
      ...task,
      // estándar mínimo para la cola
      createdAt: task && task.createdAt ? task.createdAt : Date.now(),
      kind: task && task.kind ? task.kind : 'generic'
    };
    const res = await withStore('readwrite', (st) => st.add(payload));
    if (window.UI && UI.updateOfflineBadge) {
      count().then(c => UI.updateOfflineBadge(c)).catch(() => { });
    }
    return res;
  }

  async function _getAllRaw() {
    return withStore('readonly', (st) => st.getAll());
  }

  async function takeAll() {
    // Devolver ordenadas por createdAt ASC para comportamiento FIFO
    const all = await _getAllRaw();
    return (all || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  async function remove(id) {
    const res = await withStore('readwrite', (st) => st.delete(id));
    if (window.UI && UI.updateOfflineBadge) {
      // Nota: Si una sincronización está en curso ('syncing'), no queremos sobrescribir 
      // con el número N a menos que sea el final. 
      // Pero por ahora, mostramos el número real.
      count().then(c => UI.updateOfflineBadge(c)).catch(() => { });
    }
    return res;
  }

  async function count() {
    return withStore('readonly', (st) => st.count());
  }

  async function clear() {
    const res = await withStore('readwrite', (st) => st.clear());
    if (window.UI && UI.updateOfflineBadge) {
      UI.updateOfflineBadge(0);
    }
    return res;
  }

  // Alias legacy para compatibilidad con tu código anterior
  async function all() {
    // Igual que takeAll()
    return takeAll();
  }

  // Exponer en window
  window.OfflineQueue = { add, takeAll, remove, count, clear, all };
})();
