/*
  shared-payment-cache.js
  Görev: Müşteri Yönetimi ve Bayi Yönetimi için aynı SQL payment_records verisini
  ortak cache üzerinden paylaşmak.

  Cache katmanları:
  1) RAM cache: Aynı oturumda ekranlar arasında hızlı geçiş.
  2) IndexedDB cache: Tarayıcı kapatılıp açılsa bile büyük SQL verisini yerelde tutma.

  Önemli: IndexedDB sadece görüntüleme/veri okuma hızını artırır. Veri değişim kontrolü için
  küçük SQL imzası yine getBayiDataVersion() ile kontrol edilir. İmza değişirse yerel cache
  kullanılmaz, SQL'den yeni veri çekilip cache güncellenir.
*/
import { state } from "./state.js";
import { loadAllPaymentRows, getBayiDataVersion } from "./cloud.js";

const IDB_DB_NAME = "dikesoft-payment-cache-db";
const IDB_DB_VERSION = 1;
const IDB_STORE_NAME = "paymentRowsCache";
const IDB_RECORD_ID = "paymentRows";

const sharedState = {
  loading: false,
  loadingPromise: null,
  rows: [],
  dataVersion: null,
  cacheKey: "",
  source: "none",
  loadedAt: null
};

function fallbackRows() {
  if (Array.isArray(state.rows) && state.rows.length) return state.rows;
  if (Array.isArray(state.reportRows) && state.reportRows.length) return state.reportRows;
  return [];
}

function safeVersionKey(dataVersion) {
  return dataVersion?.key || dataVersion?.recordSignature?.signature || "";
}

function idbAvailable() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openPaymentCacheDb() {
  if (!idbAvailable()) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);

    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB açılamadı."));
    request.onblocked = () => reject(new Error("IndexedDB işlemi başka sekme tarafından engellendi."));
  });
}

function withStore(mode, operation) {
  return openPaymentCacheDb().then(db => {
    if (!db) return null;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, mode);
      const store = tx.objectStore(IDB_STORE_NAME);
      let settled = false;

      const finish = value => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      tx.oncomplete = () => finish(operation.resultValue);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction hatası."));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction iptal edildi."));

      try {
        const maybeRequest = operation(store);
        if (maybeRequest && typeof maybeRequest === "object" && "onsuccess" in maybeRequest) {
          maybeRequest.onsuccess = () => {
            operation.resultValue = maybeRequest.result;
          };
          maybeRequest.onerror = () => reject(maybeRequest.error || new Error("IndexedDB request hatası."));
        } else if (maybeRequest !== undefined) {
          operation.resultValue = maybeRequest;
        }
      } catch (error) {
        reject(error);
      }
    }).finally(() => {
      try { db.close(); } catch {}
    });
  });
}

async function readPersistentPaymentRows(versionKey = "") {
  if (!versionKey) return null;

  try {
    const cached = await withStore("readonly", store => store.get(IDB_RECORD_ID));
    if (!cached || cached.cacheKey !== versionKey || !Array.isArray(cached.rows)) return null;
    return cached;
  } catch (error) {
    console.warn("Kalıcı müşteri/bayi cache okunamadı; SQL/bellek cache kullanılacak.", error);
    return null;
  }
}

async function readLatestPersistentPaymentRows() {
  try {
    const cached = await withStore("readonly", store => store.get(IDB_RECORD_ID));
    if (!cached || !Array.isArray(cached.rows) || !cached.rows.length) return null;
    return cached;
  } catch (error) {
    console.warn("Kalıcı müşteri/bayi cache fallback okunamadı.", error);
    return null;
  }
}

async function writePersistentPaymentRows({ rows = [], dataVersion = null, cacheKey = "", source = "postgres" } = {}) {
  if (!cacheKey || !Array.isArray(rows) || !rows.length) return false;

  const record = {
    id: IDB_RECORD_ID,
    cacheKey,
    dataVersion,
    source,
    savedAt: new Date().toISOString(),
    rowCount: rows.length,
    rows
  };

  try {
    await withStore("readwrite", store => store.put(record));
    return true;
  } catch (error) {
    // Kota dolarsa uygulamayı durdurma; RAM cache aynı oturumda çalışmaya devam eder.
    console.warn("Kalıcı müşteri/bayi cache yazılamadı; sadece bellek cache kullanılacak.", error);
    return false;
  }
}

async function clearPersistentPaymentRowsCache() {
  try {
    await withStore("readwrite", store => store.delete(IDB_RECORD_ID));
    return true;
  } catch (error) {
    console.warn("Kalıcı müşteri/bayi cache temizlenemedi.", error);
    return false;
  }
}

function applySharedRows({ rows = [], dataVersion = null, cacheKey = "", source = "none", loadedAt = null } = {}) {
  sharedState.rows = Array.isArray(rows) ? rows : [];
  sharedState.dataVersion = dataVersion || null;
  sharedState.cacheKey = cacheKey || safeVersionKey(dataVersion) || "";
  sharedState.source = source || "none";
  sharedState.loadedAt = loadedAt || new Date().toISOString();
}

export function getSharedPaymentRowsSnapshot() {
  return {
    rows: sharedState.rows,
    dataVersion: sharedState.dataVersion,
    cacheKey: sharedState.cacheKey,
    source: sharedState.source,
    loadedAt: sharedState.loadedAt
  };
}

export function clearSharedPaymentRowsCache({ persistent = false } = {}) {
  sharedState.rows = [];
  sharedState.dataVersion = null;
  sharedState.cacheKey = "";
  sharedState.source = "none";
  sharedState.loadedAt = null;

  if (persistent) {
    // Eski çağıranları bozmamak için fonksiyon sync kalır; kalıcı temizleme arka planda yapılır.
    clearPersistentPaymentRowsCache();
  }
}

export async function clearAllSharedPaymentRowsCache() {
  clearSharedPaymentRowsCache();
  await clearPersistentPaymentRowsCache();
}

export async function ensureSharedPaymentRows({
  force = false,
  pageSize = 1000,
  dataVersion = null,
  onProgress = null
} = {}) {
  if (sharedState.loading && sharedState.loadingPromise) return sharedState.loadingPromise;

  sharedState.loading = true;
  sharedState.loadingPromise = (async () => {
    let version = dataVersion;
    let versionKey = safeVersionKey(version);

    try {
      if (!version) {
        version = await getBayiDataVersion();
        versionKey = safeVersionKey(version);
      }

      if (!force && sharedState.rows.length && sharedState.cacheKey && sharedState.cacheKey === versionKey) {
        return {
          rows: sharedState.rows,
          dataVersion: sharedState.dataVersion || version,
          cacheKey: sharedState.cacheKey,
          source: "shared-memory",
          fromCache: true
        };
      }

      if (sharedState.rows.length && sharedState.cacheKey && versionKey && sharedState.cacheKey !== versionKey) {
        clearSharedPaymentRowsCache();
      }

      if (!force && versionKey) {
        const persistent = await readPersistentPaymentRows(versionKey);
        if (persistent?.rows?.length) {
          applySharedRows({
            rows: persistent.rows,
            dataVersion: persistent.dataVersion || version,
            cacheKey: persistent.cacheKey || versionKey,
            source: "persistent-cache",
            loadedAt: persistent.savedAt || new Date().toISOString()
          });

          return {
            rows: sharedState.rows,
            dataVersion: sharedState.dataVersion,
            cacheKey: sharedState.cacheKey,
            source: "persistent-cache",
            fromCache: true,
            savedAt: persistent.savedAt || ""
          };
        }
      }

      const result = await loadAllPaymentRows({
        onlyWithTahsilatDate: false,
        pageSize,
        onProgress
      });

      const rows = result.rows || [];
      applySharedRows({
        rows,
        dataVersion: version,
        cacheKey: versionKey,
        source: result.source || "postgres"
      });

      await writePersistentPaymentRows({
        rows: sharedState.rows,
        dataVersion: sharedState.dataVersion,
        cacheKey: sharedState.cacheKey,
        source: sharedState.source
      });

      return {
        rows: sharedState.rows,
        dataVersion: sharedState.dataVersion,
        cacheKey: sharedState.cacheKey,
        source: sharedState.source,
        fromCache: false
      };
    } catch (error) {
      // SQL sürüm kontrolü veya veri çekme hatasında, en son kalıcı cache varsa kullanıcıyı tamamen boş bırakma.
      const persistent = await readLatestPersistentPaymentRows();
      if (persistent?.rows?.length && !force) {
        applySharedRows({
          rows: persistent.rows,
          dataVersion: persistent.dataVersion || version || null,
          cacheKey: persistent.cacheKey || versionKey || `persistent-fallback|${persistent.rows.length}`,
          source: "persistent-cache-fallback",
          loadedAt: persistent.savedAt || new Date().toISOString()
        });

        return {
          rows: sharedState.rows,
          dataVersion: sharedState.dataVersion,
          cacheKey: sharedState.cacheKey,
          source: sharedState.source,
          fromCache: true,
          warning: error,
          savedAt: persistent.savedAt || ""
        };
      }

      const rows = fallbackRows();
      if (!rows.length) throw error;

      applySharedRows({
        rows,
        dataVersion: version || null,
        cacheKey: versionKey || `fallback|${rows.length}`,
        source: "state-fallback"
      });

      return {
        rows: sharedState.rows,
        dataVersion: sharedState.dataVersion,
        cacheKey: sharedState.cacheKey,
        source: sharedState.source,
        fromCache: false,
        warning: error
      };
    }
  })();

  try {
    return await sharedState.loadingPromise;
  } finally {
    sharedState.loading = false;
    sharedState.loadingPromise = null;
  }
}
