/**
 * offline-storage.js - Sistema compartido de almacenamiento offline
 * Almacena datos del usuario (perfil, cliente, unidad, puesto) para acceso offline
 * Usado por: menu.js, ronda.js, registrar_incidente.js, etc.
 */

class OfflineStorage {
  constructor() {
    this.DB_NAME = 'ronda-app-data';
    this.STORES = {
      user: 'user-profile',
      globals: 'app-globals',
      config: 'config-cache'
    };
    this.init();
  }

  async init() {
    try {
      await this.openDB();
      console.log('✓ OfflineStorage inicializado');
    } catch (e) {
      console.warn('Error inicializando OfflineStorage:', e?.message);
    }
  }

  // Abrir/crear IndexedDB
  openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 2);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        // Crear stores si no existen
        if (!db.objectStoreNames.contains(this.STORES.user)) {
          db.createObjectStore(this.STORES.user, { keyPath: 'key' });
          console.log('✓ Store "user-profile" creado');
        }
        if (!db.objectStoreNames.contains(this.STORES.globals)) {
          db.createObjectStore(this.STORES.globals, { keyPath: 'key' });
          console.log('✓ Store "app-globals" creado');
        }
        if (!db.objectStoreNames.contains(this.STORES.config)) {
          db.createObjectStore(this.STORES.config, { keyPath: 'key' });
          console.log('✓ Store "config-cache" creado');
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Guardar datos del usuario
  async setUserData(userData) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORES.user, 'readwrite');
        const store = tx.objectStore(this.STORES.user);

        const data = {
          key: 'current-user',
          email: userData.email,
          userId: userData.userId,
          nombres: userData.nombres || '',
          apellidos: userData.apellidos || '',
          cliente: userData.cliente || '',
          unidad: userData.unidad || '',
          puesto: userData.puesto || '',
          savedAt: new Date().toISOString()
        };

        const request = store.put(data);
        request.onsuccess = () => {
          console.log('✓ Datos de usuario guardados offline:', data.userId);
          resolve(data);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error('Error guardando userData:', e?.message);
      throw e;
    }
  }

  // Obtener datos del usuario
  async getUserData() {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORES.user, 'readonly');
        const store = tx.objectStore(this.STORES.user);
        const request = store.get('current-user');

        request.onsuccess = () => {
          if (request.result) {
            console.log('✓ Datos de usuario recuperados:', request.result.userId);
            resolve(request.result);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error('Error obteniendo userData:', e?.message);
      return null;
    }
  }

  // Guardar datos globales (cliente, unidad, puesto)
  async setGlobalData(key, value) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORES.globals, 'readwrite');
        const store = tx.objectStore(this.STORES.globals);

        const request = store.put({
          key: key,
          value: value,
          savedAt: new Date().toISOString()
        });

        request.onsuccess = () => {
          console.log(`✓ Dato global guardado: ${key}`);
          resolve(value);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error(`Error guardando global data (${key}):`, e?.message);
      throw e;
    }
  }

  // Obtener datos globales
  async getGlobalData(key) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORES.globals, 'readonly');
        const store = tx.objectStore(this.STORES.globals);
        const request = store.get(key);

        request.onsuccess = () => {
          if (request.result) {
            console.log(`✓ Dato global recuperado: ${key}`);
            resolve(request.result.value);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error(`Error obteniendo global data (${key}):`, e?.message);
      return null;
    }
  }

  // --- NUEVOS MÉTODOS PARA CONFIGURACIÓN (CATÁLOGOS) ---

  /**
   * Guarda un catálogo completo bajo una llave (ej: 'tipo-incidencias', 'qrs')
   */
  async saveConfig(key, data) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORES.config, 'readwrite');
        const store = tx.objectStore(this.STORES.config);
        const request = store.put({
          key: key,
          data: data,
          updatedAt: new Date().toISOString()
        });
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error(`[OfflineStorage] Error guardando config ${key}:`, e);
      return false;
    }
  }

  /**
   * Recupera un catálogo de la base de datos local
   */
  async getConfig(key) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORES.config, 'readonly');
        const store = tx.objectStore(this.STORES.config);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ? request.result.data : null);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error(`[OfflineStorage] Error obteniendo config ${key}:`, e);
      return null;
    }
  }

  // Obtener todos los datos
  async getAllData() {
    try {
      const userData = await this.getUserData();
      const cliente = await this.getGlobalData('selected-cliente');
      const unidad = await this.getGlobalData('selected-unidad');
      const puesto = await this.getGlobalData('selected-puesto');

      return {
        user: userData,
        cliente,
        unidad,
        puesto
      };
    } catch (e) {
      console.error('Error obteniendo todos los datos:', e?.message);
      return null;
    }
  }

  // Limpiar datos offline
  async clearAll() {
    try {
      const db = await this.openDB();
      for (const storeName of Object.values(this.STORES)) {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
      }
      console.log('✓ Datos offline limpiados');
    } catch (e) {
      console.error('Error limpiando datos:', e?.message);
    }
  }
}

// Instancia global
const offlineStorage = new OfflineStorage();
window.offlineStorage = offlineStorage;
