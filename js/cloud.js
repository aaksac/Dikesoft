/*
  cloud.js
  Görev: PostgreSQL/Supabase veri kaydı, son yüklenen veri, satır düzenleme/silme. Dönem cache devre dışıdır.

  Önemli:
  - Fonksiyon adları eski sürümle aynı tutuldu. Böylece main.js, data-manager.js ve raporlar bozulmaz.
  - Firestore kullanılmaz.
  - Ana veritabanı PostgreSQL'dir.
  - Supabase REST API, PostgreSQL'e erişim katmanı olarak kullanılır.
*/
import { databaseConfig } from "./config.js";
import { state } from "./state.js";
import { safeNumber } from "./security.js";

const LOCAL_ONLY =
  !databaseConfig?.supabaseUrl ||
  databaseConfig.supabaseUrl.includes("BURAYA_") ||
  !databaseConfig?.supabaseAnonKey ||
  databaseConfig.supabaseAnonKey.includes("BURAYA_");

const API_BASE = LOCAL_ONLY ? "" : `${databaseConfig.supabaseUrl.replace(/\/$/, "")}/rest/v1`;

function headers(extra = {}) {
  return {
    apikey: databaseConfig.supabaseAnonKey,
    Authorization: `Bearer ${databaseConfig.supabaseAnonKey}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function api(path, options = {}) {
  if (LOCAL_ONLY) {
    if (databaseConfig.allowLocalFallback) {
      throw new Error("SUPABASE_NOT_CONFIGURED_LOCAL_FALLBACK");
    }
    throw new Error("Supabase ayarları js/config.js içinde yapılmamış.");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...options,
    headers: headers(options.headers || {})
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase API hatası: ${response.status} ${text}`);
  }

  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

async function apiWithResponse(path, options = {}) {
  if (LOCAL_ONLY) {
    if (databaseConfig.allowLocalFallback) {
      throw new Error("SUPABASE_NOT_CONFIGURED_LOCAL_FALLBACK");
    }
    throw new Error("Supabase ayarları js/config.js içinde yapılmamış.");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...options,
    headers: headers(options.headers || {})
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase API hatası: ${response.status} ${text}`);
  }

  return response;
}

async function getPaymentRecordsSignature() {
  const response = await apiWithResponse(
    "/payment_records?select=id,updated_at&order=updated_at.desc.nullslast,id.desc&limit=1",
    { headers: { Prefer: "count=exact" } }
  );
  const contentRange = response.headers.get("content-range") || "";
  const total = contentRange.includes("/") ? contentRange.split("/").pop() : "";
  const rows = await response.json().catch(() => []);
  const latest = Array.isArray(rows) && rows.length ? rows[0] : null;
  return {
    total: Number(total || 0),
    latestId: latest?.id || "",
    latestUpdatedAt: latest?.updated_at || "",
    signature: `${total || 0}|${latest?.updated_at || ""}|${latest?.id || ""}`
  };
}

export async function getBayiDataVersion() {
  if (LOCAL_ONLY) {
    throw new Error("SQL bağlantısı yok. js/config.js içindeki supabaseUrl ve supabaseAnonKey alanlarını doldurun.");
  }

  const [versionResult, signatureResult] = await Promise.allSettled([
    api("/system_settings?key=eq.bayi_data_version&select=value,updated_at&limit=1"),
    getPaymentRecordsSignature()
  ]);

  const versionRow = versionResult.status === "fulfilled" ? versionResult.value?.[0] : null;
  const value = versionRow?.value || {};
  const version = Number(value.version || 0);
  const updatedAt = value.updatedAt || versionRow?.updated_at || "";
  const recordSignature = signatureResult.status === "fulfilled"
    ? signatureResult.value
    : { total: 0, latestId: "", latestUpdatedAt: "", signature: "unknown" };

  if (versionResult.status === "rejected" && signatureResult.status === "rejected") {
    throw versionResult.reason || signatureResult.reason;
  }

  return {
    version,
    updatedAt,
    reason: value.reason || "",
    updatedBy: value.updatedBy || "",
    rowCount: recordSignature.total || Number(value.rowCount || 0),
    recordSignature,
    // Anahtar hem manuel veri sürümünü hem de tablodaki toplam/son güncelleme imzasını içerir.
    // Böylece eski kurulumlarda bayi_data_version henüz yoksa bile 22 bin satırlık veri değişimi yakalanır.
    key: `${version}|${updatedAt}|${recordSignature.signature}`
  };
}

export async function bumpBayiDataVersion(reason = "data_changed") {
  if (LOCAL_ONLY) return null;

  const now = new Date().toISOString();
  const version = Date.now();
  const value = {
    version,
    reason,
    updatedAt: now,
    updatedBy: state.user?.email || ""
  };

  await api("/system_settings", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      key: "bayi_data_version",
      value,
      updated_at: now
    })
  });

  return value;
}


function isValidDateParts(year, month, day = 1) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;

  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function dateFromParts(year, month, day = 1) {
  return isValidDateParts(year, month, day)
    ? new Date(Number(year), Number(month) - 1, Number(day))
    : null;
}

function toSqlDate(value) {
  const date = parseExcelDate(value);
  if (!date) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseExcelDate(value) {
  if (value === undefined || value === null || value === "") return null;

  if (value instanceof Date && !isNaN(value)) {
    return dateFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const serial = Math.floor(value);
    if (serial < 1) return null;

    // Excel 1900 date system. UTC kullanımı saat dilimi kaynaklı ay kaymasını engeller.
    const utc = Date.UTC(1899, 11, 30) + serial * 86400 * 1000;
    const date = new Date(utc);
    return dateFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = String(value).trim();
  if (!text) return null;

  // Excel seri tarihi metin olarak gelirse: 45658 veya 45658.00
  if (/^\d{5}(?:[.,]\d+)?$/.test(text)) {
    return parseExcelDate(Number(text.replace(",", ".")));
  }

  // 01.02.2026, 01/02/2026, 01-02-2026, saat bilgisi varsa da kabul edilir.
  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s+.*)?$/);
  if (tr) {
    let [, day, month, year] = tr;
    if (year.length === 2) year = `20${year}`;
    return dateFromParts(year, month, day);
  }

  // 2026-02-01, 2026/02/01, 2026.02.01, saat bilgisi varsa da kabul edilir.
  const iso = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[T\s].*)?$/);
  if (iso) {
    const [, year, month, day] = iso;
    return dateFromParts(year, month, day);
  }

  // 2026-02 veya 2026/02 gibi doğrudan dönem değeri.
  const yearMonth = text.match(/^(\d{4})[./-](\d{1,2})$/);
  if (yearMonth) {
    const [, year, month] = yearMonth;
    return dateFromParts(year, month, 1);
  }

  // Serbest new Date ayrıştırması kullanılmaz; 01.02.2026 gibi tarihleri tarayıcı ay/gün sanabilir.
  return null;
}

export function getPeriodKeyFromRows(rows) {
  const firstRow = rows.find(row => row.tahsilatTarihi);
  const firstDateValue = firstRow?.tahsilatTarihi;
  const date = parseExcelDate(firstDateValue);

  if (!date) {
    throw new Error("TAHSILAT_TARIHI alanından yıl/ay bilgisi okunamadı.");
  }

  return getPeriodKey(date.getFullYear(), date.getMonth() + 1);
}

function getRowTahsilatDateValue(row) {
  const raw = row?.rawData || row?.raw_data || row?.raw || {};
  return row?.tahsilatTarihi || row?.TAHSILAT_TARIHI || raw?.TAHSILAT_TARIHI || raw?.tahsilatTarihi || "";
}

function getRowTahsilatPeriodKey(row) {
  return getPeriodKeyFromDateValue(getRowTahsilatDateValue(row));
}

export function getPeriodDistribution(rows) {
  const counts = {};

  rows.forEach(row => {
    const key = getRowTahsilatPeriodKey(row);
    if (!key) return;

    counts[key] = (counts[key] || 0) + 1;
  });

  return counts;
}

export function getPeriodKey(year, month) {
  const y = Number(year);
  const m = String(Number(month)).padStart(2, "0");

  if (!y || !month) {
    throw new Error("Yıl ve ay seçilmelidir.");
  }

  return `${y}-${m}`;
}

export function createImportBatchId(periodKey) {
  return `${periodKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function setDefaultPeriodInputs() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  ["reportYearInput", "dataYearInput", "importYearInput"].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = String(year);
  });

  ["dataMonthInput"].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = String(month);
  });

  // Dosya içe aktarmada ay bilinçli seçilmelidir; varsayılan Ocak veya mevcut ay atanmaz.
  const importMonthInput = document.getElementById("importMonthInput");
  if (importMonthInput && !importMonthInput.value) importMonthInput.value = "";
}


function draftKey() {
  return "dikesoft:currentDraft";
}

export function saveCurrentDraft(periodKey, rows, fileName = "") {
  localStorage.setItem(draftKey(), JSON.stringify({
    periodKey,
    fileName,
    savedAt: new Date().toISOString(),
    rows
  }));
}

export function loadCurrentDraft() {
  const raw = localStorage.getItem(draftKey());
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed?.rows?.length ? parsed : null;
  } catch {
    return null;
  }
}

export function clearCurrentDraft() {
  localStorage.removeItem(draftKey());
}

function cacheKey(periodKey) {
  return `dikesoft:period:${periodKey}`;
}

function latestKey() {
  return "dikesoft:latestPeriod";
}

export function saveLatestPeriodLocal(periodKey, importBatchId = "") {
  // SQL-only mod: son yüklenen meta localStorage'a yazılmaz.
}

export function loadLatestPeriodLocal() {
  // SQL-only mod: son yüklenen meta SQL/system_settings üzerinden okunur.
  return null;
}

export function savePeriodToLocalCache(periodKey, rows, { append = true } = {}) {
  // SQL-only mod: dönem verisi tarayıcı cache'ine yazılmaz.
}

export function replacePeriodLocalCache(periodKey, rows) {
  // SQL-only mod: dönem verisi tarayıcı cache'ine yazılmaz.
}

export function loadPeriodFromLocalCache(periodKey) {
  // SQL-only mod: dönem verisi yalnızca SQL'den okunur.
  return null;
}

export function clearPeriodLocalCache(periodKey) {
  // SQL-only mod: dönem cache'i yoktur.
}

function toDbRow(row, periodKey, importBatchId, sourceFileName) {
  return {
    period_key: periodKey,
    tahsilat_period_key: getPeriodKeyFromDateValue(row.tahsilatTarihi),
    fatura_period_key: getPeriodKeyFromDateValue(row.faturaTarihi || row.tarih),
    import_batch_id: importBatchId,
    source_file_name: sourceFileName || "",
    sira: Number(row.sira || 0),
    vkn: String(row.vkn || row.vknTckn || ""),
    unvan: String(row.unvan || row.musteri || ""),
    dagitici: String(row.dagitici || ""),
    bayi: String(row.bayi || ""),
    fatura_no: String(row.faturaNo || ""),
    fatura_tarihi: toSqlDate(row.faturaTarihi || row.tarih),
    fatura_tutari: safeNumber(row.faturaTutari),
    tahsilat_durumu: String(row.tahsilatDurumu || ""),
    tahsilat_tarihi: toSqlDate(row.tahsilatTarihi),
    toplam_tutar: safeNumber(row.toplamTutar || row.tutar || row.faturaTutari),
    raw_data: row
  };
}

function fromDbRow(row) {
  const raw = row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {};

  return {
    ...raw,
    id: row.id,
    periodKey: row.period_key,
    tahsilatPeriodKey: row.tahsilat_period_key || row.period_key,
    faturaPeriodKey: row.fatura_period_key || "",
    importBatchId: row.import_batch_id,
    sourceFileName: row.source_file_name || "",
    sira: row.sira,
    vkn: row.vkn || "",
    vknTckn: row.vkn || "",
    unvan: row.unvan || "",
    musteri: row.unvan || "",
    dagitici: row.dagitici || "",
    bayi: row.bayi || "",
    faturaNo: row.fatura_no || "",
    faturaTarihi: row.fatura_tarihi || "",
    tarih: row.fatura_tarihi || "",
    faturaTutari: safeNumber(row.fatura_tutari),
    tahsilatDurumu: row.tahsilat_durumu || "",
    tahsilatTarihi: row.tahsilat_tarihi || "",
    toplamTutar: safeNumber(row.toplam_tutar),
    tutar: safeNumber(row.toplam_tutar || row.fatura_tutari)
  };
}

function localRowsWithIds(periodKey, rows, importBatchId, fileName) {
  return rows.map((row, index) => ({
    ...row,
    id: row.id || `local-${importBatchId}-${index + 1}`,
    periodKey,
    importBatchId,
    sourceFileName: fileName || ""
  }));
}

async function insertRowsToSupabase(periodKey, rows, importBatchId, fileName, onProgress) {
  const dbRows = rows.map(row => toDbRow(row, periodKey, importBatchId, fileName));
  const chunkSize = 500;
  const insertedRows = [];

  for (let start = 0; start < dbRows.length; start += chunkSize) {
    const chunk = dbRows.slice(start, start + chunkSize);
    const inserted = await api("/payment_records", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(chunk)
    });
    insertedRows.push(...inserted);

    if (typeof onProgress === "function") {
      const done = Math.min(dbRows.length, start + chunk.length);
      const insertPercent = dbRows.length ? done / dbRows.length : 1;
      onProgress({
        percent: 35 + insertPercent * 50,
        message: `SQL'e aktarılıyor… ${done}/${dbRows.length} satır`
      });
    }
  }

  return insertedRows.map(fromDbRow);
}




export function getFaturaPeriodKeyFromRows(rows) {
  const firstRow = rows.find(row => row.faturaTarihi || row.tarih);
  const firstDateValue = firstRow?.faturaTarihi || firstRow?.tarih;
  const date = parseExcelDate(firstDateValue);

  if (!date) {
    throw new Error("FATURA_TARIHI alanından yıl/ay bilgisi okunamadı.");
  }

  return getPeriodKey(date.getFullYear(), date.getMonth() + 1);
}

export function getFaturaPeriodDistribution(rows) {
  const counts = {};

  rows.forEach(row => {
    const date = parseExcelDate(row.faturaTarihi || row.tarih);
    if (!date) return;

    const key = getPeriodKey(date.getFullYear(), date.getMonth() + 1);
    counts[key] = (counts[key] || 0) + 1;
  });

  return counts;
}

function getPeriodKeyFromDateValue(value) {
  const date = parseExcelDate(value);
  return date ? getPeriodKey(date.getFullYear(), date.getMonth() + 1) : "";
}


export function prepareRowsForPreview(periodKey, rows, fileName = "") {
  const importBatchId = createImportBatchId(periodKey);

  const prepared = rows.map((row, index) => ({
    ...row,
    id: row.id || `draft-${importBatchId}-${index + 1}`,
    periodKey,
    importBatchId,
    sourceFileName: fileName || ""
  }));

  // Sadece SQL'e kaydedilmeden önce ekranda düzenlenebilen geçici taslak tutulur.
  // Kaydet butonundan sonra clearCurrentDraft() ile temizlenir.
  saveCurrentDraft(periodKey, prepared, fileName);

  return {
    periodKey,
    importBatchId,
    rows: prepared
  };
}





export async function saveSendLogToCloud(log) {
  const localLogs = JSON.parse(localStorage.getItem("dikesoft:sendLogs") || "[]");
  localLogs.unshift(log);
  localStorage.setItem("dikesoft:sendLogs", JSON.stringify(localLogs.slice(0, 500)));

  if (LOCAL_ONLY && databaseConfig.allowLocalFallback) {
    return { source: "local" };
  }

  await api("/send_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      bayi: log.bayi || "",
      email: log.email || "",
      period_key: log.periodKey || "",
      import_batch_id: log.importBatchId || "",
      durum: log.durum || "",
      detail: log.tarih || "",
      created_at: log.createdAt || new Date().toISOString()
    })
  });

  return { source: "postgres" };
}

export async function loadSendLogsFromCloud(startDate, endDate) {
  const startIso = `${startDate}T00:00:00.000Z`;
  const endIso = `${endDate}T23:59:59.999Z`;

  if (LOCAL_ONLY && databaseConfig.allowLocalFallback) {
    const localLogs = JSON.parse(localStorage.getItem("dikesoft:sendLogs") || "[]");
    const rows = localLogs.filter(log => {
      const created = log.createdAt || "";
      return created >= startIso && created <= endIso;
    });
    return { rows, source: "local" };
  }

  const dbRows = await api(`/send_logs?created_at=gte.${encodeURIComponent(startIso)}&created_at=lte.${encodeURIComponent(endIso)}&select=*&order=created_at.desc`);

  const rows = dbRows.map(row => ({
    bayi: row.bayi || "",
    email: row.email || "",
    tarih: row.detail || (row.created_at ? new Date(row.created_at).toLocaleString("tr-TR") : ""),
    createdAt: row.created_at || "",
    durum: row.durum || "",
    periodKey: row.period_key || "",
    importBatchId: row.import_batch_id || ""
  }));

  return { rows, source: "postgres" };
}



export async function saveDefinitionsToCloud({ channels = [], dealers = [], mails = [] } = {}) {
  if (LOCAL_ONLY) {
    throw new Error("SQL bağlantısı yok. js/config.js içindeki supabaseUrl ve supabaseAnonKey alanlarını doldurun.");
  }

  // Tanımlar küçük veri setidir. Kayıt bütünlüğü için mevcut tanımlar temizlenip yeniden yazılır.
  await api("/definition_channels?kanal=not.is.null", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  }).catch(() => null);

  await api("/definition_dealers?bayi=not.is.null", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  }).catch(() => null);

  await api("/definition_mails?email=not.is.null", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  }).catch(() => null);

  if (channels.length) {
    await api("/definition_channels", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(channels.map(row => ({
        kanal: row.kanal || "",
        kp: Number(row.kp || 0),
        raw_data: row
      })))
    });
  }

  if (dealers.length) {
    await api("/definition_dealers", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(dealers.map(row => ({
        kanal: row.kanal || "",
        bayi: row.bayi || "",
        bayi_key: row.bayiKey || "",
        bp: Number(row.bp || 0),
        raw_data: row
      })))
    });
  }

  if (mails.length) {
    await api("/definition_mails", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(mails.map(row => ({
        bayi: row.bayi || "",
        bayi_key: row.bayiKey || "",
        email: row.email || "",
        raw_data: row
      })))
    });
  }

  await api("/system_settings", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      key: "definitions_last_saved",
      value: {
        channelCount: channels.length,
        dealerCount: dealers.length,
        mailCount: mails.length,
        savedAt: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    })
  });

  return {
    channelCount: channels.length,
    dealerCount: dealers.length,
    mailCount: mails.length
  };
}

export async function loadDefinitionsFromCloud() {
  if (LOCAL_ONLY) {
    throw new Error("SQL bağlantısı yok. js/config.js içindeki supabaseUrl ve supabaseAnonKey alanlarını doldurun.");
  }

  const [channels, dealers, mails] = await Promise.all([
    api("/definition_channels?select=*&order=kanal.asc"),
    api("/definition_dealers?select=*&order=bayi.asc"),
    api("/definition_mails?select=*&order=bayi.asc")
  ]);

  return {
    channels: channels.map(row => ({
      id: row.id,
      kanal: row.kanal || "",
      kp: Number(row.kp || 0)
    })),
    dealers: dealers.map(row => ({
      id: row.id,
      kanal: row.kanal || "",
      bayi: row.bayi || "",
      bayiKey: row.bayi_key || "",
      bp: Number(row.bp || 0)
    })),
    mails: mails.map(row => ({
      id: row.id,
      bayi: row.bayi || "",
      bayiKey: row.bayi_key || "",
      email: row.email || ""
    }))
  };
}


export async function saveGlobalMailSettings(settings) {
  localStorage.setItem("dikesoft:globalMailSettings", JSON.stringify({
    ...settings,
    savedAt: new Date().toISOString()
  }));

  if (LOCAL_ONLY && databaseConfig.allowLocalFallback) {
    return { source: "local" };
  }

  await api("/system_settings", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      key: "global_mail_settings",
      value: settings,
      updated_at: new Date().toISOString()
    })
  });

  return { source: "postgres" };
}

export async function loadGlobalMailSettings() {
  const localRaw = localStorage.getItem("dikesoft:globalMailSettings");
  let local = null;

  try {
    local = localRaw ? JSON.parse(localRaw) : null;
  } catch {
    local = null;
  }

  if (LOCAL_ONLY && databaseConfig.allowLocalFallback) {
    return local || null;
  }

  try {
    const result = await api("/system_settings?key=eq.global_mail_settings&select=value&limit=1");
    const remote = result?.[0]?.value || null;

    if (remote) {
      localStorage.setItem("dikesoft:globalMailSettings", JSON.stringify({
        ...remote,
        savedAt: new Date().toISOString()
      }));
    }

    return remote || local || null;
  } catch {
    return local || null;
  }
}


export async function savePeriodToCloud(periodKey, rows, meta = {}) {
  const importBatchId = meta.importBatchId || createImportBatchId(periodKey);
  const fileName = meta.fileName || "";
  const onProgress = typeof meta.onProgress === "function" ? meta.onProgress : null;

  if (!Array.isArray(rows) || !rows.length) {
    return { periodKey, importBatchId, rowCount: 0, rows: [] };
  }

  const periodRows = rows.filter(row => getRowTahsilatPeriodKey(row) === periodKey);
  if (!periodRows.length) {
    return { periodKey, importBatchId, rowCount: 0, rows: [] };
  }

  if (LOCAL_ONLY) {
    throw new Error("Supabase ayarları yapılmadan SQL'e kayıt yapılamaz.");
  }

  onProgress?.({ percent: 18, message: "Dönem kaydı hazırlanıyor…" });

  await api("/imports", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      period_key: periodKey,
      last_file_name: fileName,
      last_import_batch_id: importBatchId,
      last_uploaded_by: state.user?.email || "",
      last_import_row_count: periodRows.length,
      updated_at: new Date().toISOString()
    })
  });

  onProgress?.({ percent: 26, message: "İçe aktarma oturumu oluşturuluyor…" });

  await api("/import_batches", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      import_batch_id: importBatchId,
      period_key: periodKey,
      file_name: fileName,
      row_count: periodRows.length,
      uploaded_by: state.user?.email || ""
    })
  });

  onProgress?.({ percent: 34, message: "Satırlar SQL'e aktarılıyor…" });
  const savedRows = await insertRowsToSupabase(periodKey, periodRows, importBatchId, fileName, onProgress);

  onProgress?.({ percent: 88, message: "Son kayıt bilgisi güncelleniyor…" });

  await api("/system_settings", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      key: "latest_import",
      value: {
        periodKey,
        importBatchId,
        fileName,
        rowCount: periodRows.length,
        uploadedBy: state.user?.email || "",
        uploadedAt: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    })
  });

  onProgress?.({ percent: 96, message: "Kayıt tamamlanıyor…" });
  try {
    await bumpBayiDataVersion("payment_import");
  } catch (versionError) {
    console.warn("Bayi Yönetimi veri sürümü güncellenemedi; tablo imzası yedek kontrol olarak kullanılacak.", versionError);
  }
  clearCurrentDraft();

  return {
    periodKey,
    importBatchId,
    rowCount: savedRows.length,
    rows: savedRows
  };
}

export async function getLatestImportMeta() {
  if (LOCAL_ONLY) return null;

  const result = await api("/system_settings?key=eq.latest_import&select=value&limit=1");
  return result?.[0]?.value || null;
}

export async function loadPeriodRows(periodKey, { preferCache = true, importBatchId = "" } = {}) {
  // SQL-only: Veri Yönetimi normalde TAHSILAT_TARIHI dönemine göre SQL'den veri çeker.
  // Eski/eksik kayıtlarda tahsilat_period_key boş kalmışsa period_key yedeğiyle tekrar dener.
  if (LOCAL_ONLY) {
    throw new Error("SQL bağlantısı yok. js/config.js içindeki supabaseUrl ve supabaseAnonKey alanlarını doldurun.");
  }

  const encodedPeriod = encodeURIComponent(periodKey);
  const encodedBatch = importBatchId ? encodeURIComponent(importBatchId) : "";
  const buildUrl = (field, includeBatch = true) => {
    let url = `/payment_records?${field}=eq.${encodedPeriod}&select=*&order=sira.asc`;
    if (includeBatch && encodedBatch) {
      url += `&import_batch_id=eq.${encodedBatch}`;
    }
    return url;
  };

  let dbRows = await api(buildUrl("tahsilat_period_key"));
  let source = "postgres";

  if (!dbRows.length) {
    dbRows = await api(buildUrl("period_key"));
    source = "postgres-period-key";
  }

  // latest_import içindeki import_batch_id eski/stale kaldıysa, aynı dönem verisini batch filtresiz de kontrol et.
  if (!dbRows.length && importBatchId) {
    dbRows = await api(buildUrl("period_key", false));
    source = "postgres-period-key";
  }

  const rows = dbRows.map(fromDbRow).filter(row => {
    const rowPeriod = row.tahsilatPeriodKey || row.periodKey || getPeriodKeyFromDateValue(row.tahsilatTarihi);
    return rowPeriod === periodKey;
  });

  return { rows, source };
}



export async function loadFaturaPeriodRows(periodKey, { preferCache = true } = {}) {
  // SQL-only: FATURA_TARIHI dönemine göre yalnızca SQL'den veri çeker.
  if (LOCAL_ONLY) {
    throw new Error("SQL bağlantısı yok. js/config.js içindeki supabaseUrl ve supabaseAnonKey alanlarını doldurun.");
  }

  const dbRows = await api(`/payment_records?fatura_period_key=eq.${encodeURIComponent(periodKey)}&select=*&order=sira.asc`);
  const rows = dbRows.map(fromDbRow).filter(row => {
    const rowPeriod = row.faturaPeriodKey || getPeriodKeyFromDateValue(row.faturaTarihi || row.tarih);
    return rowPeriod === periodKey;
  });

  return { rows, source: "postgres" };
}


export async function loadLatestRows({ preferCache = true } = {}) {
  const latest = await getLatestImportMeta();
  if (!latest?.periodKey) return { rows: [], source: "none", latest: null };

  const result = await loadPeriodRows(latest.periodKey, {
    preferCache,
    importBatchId: latest.importBatchId || ""
  });

  return { ...result, latest };
}


export async function loadAllPaymentRows({ onlyWithTahsilatDate = false, pageSize = 1000, onProgress = null } = {}) {
  if (LOCAL_ONLY) {
    throw new Error("SQL bağlantısı yok. js/config.js içindeki supabaseUrl ve supabaseAnonKey alanlarını doldurun.");
  }

  const rows = [];
  let offset = 0;
  let page = 0;
  // Supabase/PostgREST varsayılan üst sınırı çoğu projede 1000 satırdır.
  // 5000 istenirse API yine 1000 döndürebilir; bu durumda 1000 < 5000 diye erken kırılmamak gerekir.
  // Bu nedenle sayfa boyutu 1000'i aşmaz ve offset, gerçekten gelen satır sayısı kadar ilerler.
  const safePageSize = Math.max(100, Math.min(Number(pageSize) || 1000, 1000));

  onProgress?.({ fetched: 0, page: 0, pageSize: safePageSize, done: false });

  while (true) {
    const dateFilter = onlyWithTahsilatDate ? "&tahsilat_tarihi=not.is.null" : "";
    const dbRows = await api(`/payment_records?select=*${dateFilter}&order=tahsilat_tarihi.asc.nullslast,id.asc&limit=${safePageSize}&offset=${offset}`);
    if (!Array.isArray(dbRows) || !dbRows.length) break;

    rows.push(...dbRows.map(fromDbRow));
    page += 1;
    offset += dbRows.length;
    onProgress?.({ fetched: rows.length, page, pageSize: safePageSize, lastPageCount: dbRows.length, done: false });

    if (dbRows.length < safePageSize) break;
  }

  onProgress?.({ fetched: rows.length, page, pageSize: safePageSize, done: true });
  return { rows, source: "postgres" };
}

function toPatchDb(periodKey, patch, fullRow = null) {
  const dbPatch = {};

  if (patch.vkn !== undefined || patch.vknTckn !== undefined) dbPatch.vkn = String(patch.vkn || patch.vknTckn || "");
  if (patch.unvan !== undefined || patch.musteri !== undefined) dbPatch.unvan = String(patch.unvan || patch.musteri || "");
  if (patch.dagitici !== undefined) dbPatch.dagitici = String(patch.dagitici || "");
  if (patch.bayi !== undefined) dbPatch.bayi = String(patch.bayi || "");
  if (patch.faturaNo !== undefined) dbPatch.fatura_no = String(patch.faturaNo || "");
  if (patch.faturaTarihi !== undefined || patch.tarih !== undefined) {
    const faturaDateValue = patch.faturaTarihi || patch.tarih;
    dbPatch.fatura_tarihi = toSqlDate(faturaDateValue);
    dbPatch.fatura_period_key = getPeriodKeyFromDateValue(faturaDateValue);
  }
  if (patch.faturaTutari !== undefined) dbPatch.fatura_tutari = safeNumber(patch.faturaTutari);
  if (patch.tahsilatDurumu !== undefined) dbPatch.tahsilat_durumu = String(patch.tahsilatDurumu || "");
  if (patch.tahsilatTarihi !== undefined) {
    const nextTahsilatPeriod = getPeriodKeyFromDateValue(patch.tahsilatTarihi);
    dbPatch.tahsilat_tarihi = toSqlDate(patch.tahsilatTarihi);
    dbPatch.tahsilat_period_key = nextTahsilatPeriod;
    // Veri Yönetimi tahsilat dönemine göre çalıştığı için eski yedek alan da aynı döneme taşınır.
    // Aksi hâlde fallback sorguları kaydı eski ayda tekrar gösterebilir.
    dbPatch.period_key = nextTahsilatPeriod || periodKey;
  }
  if (patch.toplamTutar !== undefined || patch.tutar !== undefined) dbPatch.toplam_tutar = safeNumber(patch.toplamTutar || patch.tutar);

  dbPatch.raw_data = fullRow && typeof fullRow === "object" ? fullRow : patch;
  dbPatch.updated_at = new Date().toISOString();
  return dbPatch;
}

export async function updatePaymentRow(periodKey, rowId, patch, fullRow = null) {
  if (!rowId) return null;

  if (String(rowId).startsWith("draft-")) {
    // Taslak satırlar henüz SQL'e gönderilmemiştir; ekrandaki state zaten güncellenir.
    return fullRow || patch;
  }

  if (LOCAL_ONLY) {
    throw new Error("SQL bağlantısı yok. js/config.js içindeki supabaseUrl ve supabaseAnonKey alanlarını doldurun.");
  }

  const updated = await api(`/payment_records?id=eq.${encodeURIComponent(rowId)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(toPatchDb(periodKey, patch, fullRow))
  });

  if (!Array.isArray(updated) || !updated.length) {
    throw new Error("SQL kaydı güncellenemedi. Kayıt ID bulunamadı veya yetki sorunu oluştu.");
  }

  try {
    await bumpBayiDataVersion("payment_update");
  } catch (versionError) {
    console.warn("Bayi Yönetimi veri sürümü güncellenemedi; tablo imzası yedek kontrol olarak kullanılacak.", versionError);
  }

  return fromDbRow(updated[0]);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function deletePaymentRows(periodKey, rowIds, options = {}) {
  if (!rowIds?.length) return;

  const remoteIds = [...new Set(rowIds
    .map(id => String(id || "").trim())
    .filter(id => id && !id.startsWith("draft-") && !id.startsWith("local-"))
  )];

  if (!remoteIds.length) return;

  if (LOCAL_ONLY) {
    throw new Error("SQL bağlantısı yok. js/config.js içindeki supabaseUrl ve supabaseAnonKey alanlarını doldurun.");
  }

  // Toplu seçimde yüzlerce/binlerce ID tek URL'ye yazılırsa PostgREST veya tarayıcı URL sınırına takılabilir.
  // Bu yüzden SQL silme işlemi küçük parçalara bölünür; tüm parçalar tamamlanmadan ekrandaki kayıtlar temizlenmez.
  const chunks = chunkArray(remoteIds, 80);

  const total = chunks.length;
  let done = 0;
  options?.onProgress?.({ done, total, percent: total ? 0 : 100 });

  for (const ids of chunks) {
    await api(`/payment_records?id=in.(${ids.map(encodeURIComponent).join(",")})`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    done += 1;
    options?.onProgress?.({ done, total, percent: Math.round((done / total) * 100) });
  }

  try {
    await bumpBayiDataVersion("payment_delete");
  } catch (versionError) {
    console.warn("Bayi Yönetimi veri sürümü güncellenemedi; tablo imzası yedek kontrol olarak kullanılacak.", versionError);
  }
}
