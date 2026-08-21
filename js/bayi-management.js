/*
  bayi-management.js
  Görev: Mevcut rapor akışını bozmadan bağımsız Bayi Yönetimi ekranı üretir.
  - Çoklu Kanal / Yıl / Ay checkbox filtresi
  - Seçili yıl-ay bazlı bayi-pay raporu
  - Görsel istatistik kartları ve yatay PDF önizleme
*/
import { state } from "./state.js";
import { getBayiDataVersion } from "./cloud.js";
import { ensureSharedPaymentRows, getSharedPaymentRowsSnapshot } from "./shared-payment-cache.js?v=2026.06.13-indexeddb-v1";
import { money } from "./format.js";
import { safeNumber, sanitizeText, normalizeName } from "./security.js";
import { toast } from "./ui.js";

const MONTHS = [
  "", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
];

const BAYI_CACHE_KEY = "dikesoft:bayiManagement:compactRows:v1";

const managerState = {
  initialized: false,
  loading: false,
  loadingPromise: null,
  rows: [],
  reportRows: [],
  reportPeriods: [],
  selectedChannels: [],
  selectedYears: [],
  selectedMonths: [],
  dataVersion: null,
  cacheKey: ""
};

function h(value) {
  return sanitizeText(value)
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeFilter(value) {
  return normalizeName(value)
    .replace(/İ/g, "I")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const utc = Date.UTC(1899, 11, 30) + Math.floor(value) * 86400 * 1000;
    const date = new Date(utc);
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  const text = String(value).trim();
  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s+.*)?$/);
  if (tr) {
    let [, d, m, y] = tr;
    if (y.length === 2) y = `20${y}`;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[T\s].*)?$/);
  if (iso) {
    const [, y, m, d] = iso;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const ym = text.match(/^(\d{4})[./-](\d{1,2})$/);
  if (ym) {
    const [, y, m] = ym;
    const date = new Date(Number(y), Number(m) - 1, 1);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function periodKeyFromDate(value) {
  const date = parseDate(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  if (year < 1900 || year > 2100) return "";
  return `${year}-${month}`;
}


function normalizePeriodKeyValue(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const text = String(value).trim();
  const ym = text.match(/^(\d{4})[./-](\d{1,2})$/);
  if (ym) {
    const month = Number(ym[2]);
    if (month >= 1 && month <= 12) return `${ym[1]}-${String(month).padStart(2, "0")}`;
  }
  return periodKeyFromDate(text);
}

function periodParts(key) {
  const match = String(key || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return { year: "", month: "", monthNo: 0, label: "-" };
  const monthNo = Number(match[2]);
  return {
    year: match[1],
    month: MONTHS[monthNo] || match[2],
    monthNo,
    label: `${match[1]} / ${MONTHS[monthNo] || match[2]}`
  };
}

function rowPeriod(row) {
  // Bayi Yönetimi tüm kayıtlı dönemleri göstermelidir.
  // Öncelik: normalize edilmiş __periodKey/cache dönemi; sonra tahsilat/import dönemi; yoksa fatura dönemi; o da yoksa tarih alanlarından okuma.
  const directCandidates = [
    row?.__periodKey,
    row?.tahsilatPeriodKey,
    row?.tahsilat_period_key,
    row?.periodKey,
    row?.period_key,
    row?.faturaPeriodKey,
    row?.fatura_period_key,
    getRawValue(row, "tahsilatPeriodKey", "tahsilat_period_key", "TAHSILAT_PERIOD_KEY", "periodKey", "period_key", "PERIOD_KEY", "faturaPeriodKey", "fatura_period_key", "FATURA_PERIOD_KEY")
  ];

  for (const candidate of directCandidates) {
    const key = normalizePeriodKeyValue(candidate);
    if (key) return key;
  }

  return periodKeyFromDate(row?.tahsilatTarihi || row?.tahsilat_tarihi || row?.TAHSILAT_TARIHI || getRawValue(row, "TAHSILAT_TARIHI", "tahsilat_tarihi", "tahsilatTarihi"))
    || periodKeyFromDate(row?.faturaTarihi || row?.fatura_tarihi || row?.FATURA_TARIHI || row?.tarih || row?.TARIH || getRawValue(row, "FATURA_TARIHI", "fatura_tarihi", "faturaTarihi", "TARIH", "tarih"));
}

function rowChannel(row) {
  return String(row?.dagitici || row?.DAGITICI || row?.kanal || row?.KANAL || "").trim();
}

function rowDealer(row) {
  return String(row?.bayi || row?.BAYI || "").trim();
}

function getRawValue(row, ...keys) {
  const raw = row?.rawData || row?.raw_data || row?.raw || {};
  const candidates = [raw, raw?.rawData, raw?.raw_data].filter(Boolean);
  for (const source of candidates) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const value = source[key];
        if (value !== undefined && value !== null && String(value).trim() !== "") return value;
      }
    }
  }
  return undefined;
}

function rowInvoiceAmount(row) {
  const rawValue = getRawValue(row, "FATURA_TUTARI", "faturaTutari");
  if (rawValue !== undefined) return safeNumber(rawValue);
  return safeNumber(row?.faturaTutari ?? row?.fatura_tutari ?? row?.FATURA_TUTARI ?? 0);
}

function rowInvoiceKey(row, index) {
  const id = String(row?.id || row?.ID || "").trim();
  if (id) return `id::${id}`;
  const batch = String(row?.importBatchId || row?.import_batch_id || "").trim();
  const sira = String(row?.sira ?? row?.SIRA ?? "").trim();
  if (batch && sira) return `batch-row::${batch}::${sira}`;
  if (sira) return `row-sira::${sira}`;
  return `row-index::${index}`;
}

function uniqueRows(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const key = rowInvoiceKey(row, index);
    if (!map.has(key)) map.set(key, row);
  });
  return [...map.values()];
}

function compactRowForBayiManagement(row, index = 0) {
  return {
    id: String(row?.id || row?.ID || "").trim(),
    importBatchId: String(row?.importBatchId || row?.import_batch_id || "").trim(),
    sira: row?.sira ?? row?.SIRA ?? index + 1,
    __periodKey: row?.__periodKey || rowPeriod(row),
    dagitici: rowChannel(row),
    bayi: rowDealer(row),
    faturaTutari: rowInvoiceAmount(row)
  };
}

function normalizeRowsForBayiManagement(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const compactRows = sourceRows.map((row, index) => compactRowForBayiManagement(row, index));
  const usableRows = compactRows.filter(row => row.__periodKey && row.dagitici && row.bayi);
  return {
    sourceCount: sourceRows.length,
    rows: usableRows,
    skippedCount: Math.max(0, compactRows.length - usableRows.length)
  };
}

function readSessionCache(versionKey) {
  if (!versionKey) return null;
  try {
    const raw = sessionStorage.getItem(BAYI_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.versionKey !== versionKey || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(versionKey, normalized) {
  if (!versionKey || !normalized?.rows?.length) return;
  try {
    sessionStorage.setItem(BAYI_CACHE_KEY, JSON.stringify({
      versionKey,
      savedAt: new Date().toISOString(),
      sourceCount: normalized.sourceCount,
      skippedCount: normalized.skippedCount,
      rows: normalized.rows
    }));
  } catch (error) {
    // Büyük veride tarayıcı kotası dolarsa sorun çıkarma; aynı sayfa içinde bellek cache'i zaten çalışır.
    console.warn("Bayi Yönetimi geçici session cache yazılamadı; bellek cache kullanılacak.", error);
  }
}

function clearSessionCache() {
  try { sessionStorage.removeItem(BAYI_CACHE_KEY); } catch {}
}

function applyLoadedRows(normalized, dataVersion, source = "postgres") {
  managerState.rows = normalized.rows || [];
  managerState.dataVersion = dataVersion || null;
  managerState.cacheKey = dataVersion?.key || "";

  renderFilters();

  const skipped = Number(normalized.skippedCount || 0);
  const sourceCount = Number(normalized.sourceCount || managerState.rows.length || 0);
  const versionText = dataVersion?.rowCount ? ` · SQL imzası: ${Number(dataVersion.rowCount || 0).toLocaleString("tr-TR")} satır` : "";
  const sourceText = source === "cache"
    ? "geçici cache'den kullanıldı"
    : source === "persistent"
      ? "kalıcı yerel cache'den kullanıldı"
      : source === "persistent-fallback"
        ? "SQL kontrol edilemedi; kalıcı yerel cache'den kullanıldı"
        : source === "shared"
          ? "ortak RAM cache'inden kullanıldı"
          : source === "state"
            ? "ekrandaki mevcut veriden kullanıldı"
            : "SQL'den alındı";

  setStatus(
    managerState.rows.length
      ? `${sourceCount.toLocaleString("tr-TR")} SQL satırı ${sourceText}; ${managerState.rows.length.toLocaleString("tr-TR")} satır Bayi Yönetimi raporuna uygun.${skipped ? ` ${skipped.toLocaleString("tr-TR")} satır dönem/kanal/bayi bilgisi eksik olduğu için tabloya alınmadı.` : ""}${versionText}`
      : "Kayıtlı satır bulundu ancak dönem, kanal veya bayi bilgisi okunamadığı için Bayi Yönetimi raporuna alınamadı.",
    managerState.rows.length ? "success" : "warning"
  );
}

function channelRate(name) {
  const key = normalizeFilter(name);
  const channel = (state.channels || []).find(item => normalizeFilter(item.kanal || item.DAGITICI || item.KANAL) === key);
  return Number(channel?.kp || 0);
}

function dealerRate(channelName, dealerName) {
  const channelKey = normalizeFilter(channelName);
  const dealerKey = normalizeName(dealerName);
  const dealer = (state.dealers || []).find(item => {
    const itemChannel = normalizeFilter(item.kanal || item.DAGITICI || item.KANAL);
    const itemDealer = normalizeName(item.bayiKey || item.bayi || item.BAYI);
    return itemChannel === channelKey && itemDealer === dealerKey;
  });
  return Number(dealer?.bp || 0);
}

function setStatus(message = "", type = "info") {
  const box = document.getElementById("bayiManagementStatus");
  if (!box) return;
  box.textContent = message;
  box.className = `customer-analytics-status ${message ? "" : "hidden"} ${type ? `is-${type}` : ""}`.trim();
}

let progressTimer = null;
let progressStartedAt = 0;
let progressFetchedRows = 0;
let progressPages = 0;

function formatElapsed(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function setLoadingProgress({ active = false, fetched = progressFetchedRows, page = progressPages, done = false } = {}) {
  const root = document.getElementById("bayiManagementProgress");
  const text = document.getElementById("bayiManagementProgressText");
  const time = document.getElementById("bayiManagementProgressTime");
  const bar = document.getElementById("bayiManagementProgressBar");
  if (!root || !text || !time || !bar) return;

  if (!active && !done) {
    root.classList.add("hidden");
    root.setAttribute("aria-hidden", "true");
    if (progressTimer) window.clearInterval(progressTimer);
    progressTimer = null;
    progressStartedAt = 0;
    progressFetchedRows = 0;
    progressPages = 0;
    bar.style.width = "0%";
    return;
  }

  progressFetchedRows = Number(fetched) || 0;
  progressPages = Number(page) || progressPages || 0;

  if (!progressStartedAt) progressStartedAt = Date.now();
  root.classList.remove("hidden");
  root.setAttribute("aria-hidden", "false");
  root.classList.toggle("is-done", Boolean(done));
  root.classList.toggle("is-active", !done);

  const render = () => {
    const elapsed = Date.now() - progressStartedAt;
    const rowText = progressFetchedRows.toLocaleString("tr-TR");
    const pageText = progressPages ? `${progressPages.toLocaleString("tr-TR")} parça` : "hazırlanıyor";
    text.textContent = done
      ? `${rowText} SQL satırı alındı. Rapor hazırlanıyor…`
      : `${rowText} SQL satırı alındı · ${pageText}`;
    time.textContent = formatElapsed(elapsed);
  };

  render();
  if (!done && !progressTimer) progressTimer = window.setInterval(render, 1000);
  if (done && progressTimer) {
    window.clearInterval(progressTimer);
    progressTimer = null;
  }
}

function dropdownLabel(values, allText, suffix = "") {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) return allText;
  if (list.length === 1) return `${list[0]}${suffix}`;
  return `${list.length} seçim`;
}

function setDropdownLayerState() {
  const page = document.getElementById("bayiManagement");
  if (!page) return;
  const hasOpenDropdown = Boolean(page.querySelector(".bayi-management-dropdown.is-open"));
  page.classList.toggle("bayi-management-dropdown-active", hasOpenDropdown);
}

function openDropdown(id) {
  document.querySelectorAll(".bayi-management-dropdown.is-open").forEach(el => {
    if (el.id !== id) el.classList.remove("is-open");
  });
  document.getElementById(id)?.classList.toggle("is-open");
  setDropdownLayerState();
}

function closeDropdowns() {
  document.querySelectorAll(".bayi-management-dropdown.is-open").forEach(el => el.classList.remove("is-open"));
  setDropdownLayerState();
}

function renderDropdown({ id, values, allLabel, optionLabel = value => value, selected = [] }) {
  const root = document.getElementById(id);
  if (!root) return;

  const selectedSet = new Set((selected || []).map(String));
  const allChecked = !selectedSet.size;
  const optionsHtml = values.map(value => {
    const checked = !allChecked && selectedSet.has(String(value));
    return `<label class="bayi-management-option"><input type="checkbox" value="${h(value)}"${checked ? " checked" : ""} /><span title="${h(optionLabel(value))}">${h(optionLabel(value))}</span></label>`;
  }).join("");

  const toggleText = root.querySelector(".bayi-management-toggle-text");
  if (toggleText) {
    const visibleSelected = values.filter(value => selectedSet.has(String(value))).map(optionLabel);
    toggleText.textContent = allChecked ? allLabel : dropdownLabel(visibleSelected, allLabel);
  }

  const menu = root.querySelector(".bayi-management-menu");
  if (!menu) return;
  const emptyLabel = managerState.rows.length ? "Kayıt yok" : "Göster deyince yüklenecek";
  menu.innerHTML = `
    <label class="bayi-management-option bayi-management-option-all"><input type="checkbox" value="" data-all${allChecked ? " checked" : ""} /><span>${h(allLabel)}</span></label>
    ${optionsHtml || `<div class="bayi-management-empty-option">${h(emptyLabel)}</div>`}
  `;
}

function uniqueSorted(values, compare = (a, b) => String(a).localeCompare(String(b), "tr-TR")) {
  return [...new Set(values.filter(value => value !== undefined && value !== null && String(value).trim() !== "").map(value => String(value).trim()))].sort(compare);
}

function getAvailableChannels(rows = managerState.rows) {
  return uniqueSorted(rows.map(rowChannel));
}

function getAvailableYears(rows = managerState.rows) {
  return uniqueSorted(rows.map(row => periodParts(rowPeriod(row)).year).filter(Boolean), (a, b) => Number(b) - Number(a));
}

function getAvailableMonths(rows = managerState.rows) {
  const nums = [...new Set(rows.map(row => periodParts(rowPeriod(row)).monthNo).filter(Boolean))].sort((a, b) => a - b);
  return nums.map(String);
}

function monthOptionLabel(value) {
  return MONTHS[Number(value)] || String(value);
}

function renderFilters() {
  renderDropdown({
    id: "bayiManagementChannelDropdown",
    values: getAvailableChannels(),
    allLabel: "Tüm kanallar",
    selected: managerState.selectedChannels
  });
  renderDropdown({
    id: "bayiManagementYearDropdown",
    values: getAvailableYears(),
    allLabel: "Tüm yıllar",
    selected: managerState.selectedYears
  });
  renderDropdown({
    id: "bayiManagementMonthDropdown",
    values: getAvailableMonths(),
    allLabel: "Tüm aylar",
    optionLabel: monthOptionLabel,
    selected: managerState.selectedMonths
  });
}

function syncDropdownSelection(dropdownId, stateKey) {
  const root = document.getElementById(dropdownId);
  if (!root) return;
  const all = root.querySelector("input[data-all]");
  const items = [...root.querySelectorAll("input[type='checkbox']:not([data-all])")];
  const checked = items.filter(input => input.checked).map(input => input.value);

  if (all?.checked || !checked.length) {
    managerState[stateKey] = [];
    if (all) all.checked = true;
    items.forEach(input => { input.checked = false; });
  } else {
    managerState[stateKey] = checked;
    if (all) all.checked = false;
  }
  renderFilters();
}

function bindDropdown(rootId, stateKey) {
  const root = document.getElementById(rootId);
  const toggle = root?.querySelector(".bayi-management-toggle");
  toggle?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openDropdown(rootId);
  });
  root?.addEventListener("click", event => event.stopPropagation());
  root?.addEventListener("change", event => {
    const target = event.target;
    if (!target?.matches?.("input[type='checkbox']")) return;

    const all = root.querySelector("input[data-all]");
    const items = [...root.querySelectorAll("input[type='checkbox']:not([data-all])")];

    if (target.hasAttribute("data-all")) {
      if (target.checked) items.forEach(input => { input.checked = false; });
    } else {
      if (target.checked && all) all.checked = false;
      if (!items.some(input => input.checked) && all) all.checked = true;
    }

    syncDropdownSelection(rootId, stateKey);
  });
}

async function ensureRowsLoaded(force = false) {
  if (managerState.loading && managerState.loadingPromise) return managerState.loadingPromise;

  managerState.loading = true;
  managerState.loadingPromise = (async () => {
    setStatus("Veri sürümü kontrol ediliyor…", "info");

    try {
      const dataVersion = await getBayiDataVersion();
      const versionKey = dataVersion?.key || "";

      if (!force && managerState.rows.length && managerState.cacheKey === versionKey) {
        renderFilters();
        setLoadingProgress({ active: false });
        setStatus(`Veri değişmemiş; ${managerState.rows.length.toLocaleString("tr-TR")} satır Bayi Yönetimi bellek cache'inden kullanıldı. Filtreler hazır.`, "success");
        return managerState.rows;
      }

      if (!force) {
        const shared = getSharedPaymentRowsSnapshot();
        if (shared?.rows?.length && shared.cacheKey === versionKey) {
          const normalized = normalizeRowsForBayiManagement(shared.rows);
          setLoadingProgress({ active: false });
          applyLoadedRows(normalized, dataVersion, "shared");
          writeSessionCache(versionKey, normalized);
          return managerState.rows;
        }

        const cached = readSessionCache(versionKey);
        if (cached?.rows?.length) {
          setLoadingProgress({ active: false });
          applyLoadedRows({
            sourceCount: Number(cached.sourceCount || cached.rows.length),
            rows: cached.rows,
            skippedCount: Number(cached.skippedCount || 0)
          }, dataVersion, "cache");
          return managerState.rows;
        }
      }

      if (managerState.rows.length && managerState.cacheKey && managerState.cacheKey !== versionKey) {
        clearSessionCache();
        managerState.rows = [];
        managerState.reportRows = [];
        managerState.reportPeriods = [];
      }

      setStatus("Veri değişmiş veya cache yok; Bayi Yönetimi verileri SQL'den alınıyor…", "info");
      setLoadingProgress({ active: true, fetched: 0, page: 0 });

      const result = await ensureSharedPaymentRows({
        force,
        dataVersion,
        pageSize: 1000,
        onProgress: progress => setLoadingProgress({
          active: true,
          fetched: progress?.fetched || 0,
          page: progress?.page || 0,
          done: Boolean(progress?.done)
        })
      });

      const normalized = normalizeRowsForBayiManagement(result.rows || []);
      const source = result.source === "shared-memory"
        ? "shared"
        : result.source === "persistent-cache"
          ? "persistent"
          : result.source === "persistent-cache-fallback"
            ? "persistent-fallback"
            : result.source === "state-fallback"
              ? "state"
              : "postgres";
      applyLoadedRows(normalized, dataVersion, source);
      writeSessionCache(versionKey, normalized);
      return managerState.rows;
    } catch (error) {
      console.error(error);
      setLoadingProgress({ active: false });
      setStatus("Bayi yönetimi verisi alınamadı. SQL bağlantısını, system_settings ve payment_records tablolarını kontrol edin.", "error");
      toast("Bayi yönetimi verisi alınamadı.");
      return [];
    }
  })();

  try {
    return await managerState.loadingPromise;
  } finally {
    managerState.loading = false;
    managerState.loadingPromise = null;
  }
}

function filterRows(rows) {
  const channelSet = new Set(managerState.selectedChannels.map(normalizeFilter));
  const yearSet = new Set(managerState.selectedYears.map(String));
  const monthSet = new Set(managerState.selectedMonths.map(value => String(Number(value))));

  return rows.filter(row => {
    const period = periodParts(row.__periodKey || rowPeriod(row));
    if (channelSet.size && !channelSet.has(normalizeFilter(rowChannel(row)))) return false;
    if (yearSet.size && !yearSet.has(period.year)) return false;
    if (monthSet.size && !monthSet.has(String(period.monthNo))) return false;
    return true;
  });
}


function formatRate(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function uniqueSlash(values, compare = (a, b) => String(a).localeCompare(String(b), "tr-TR")) {
  return [...new Set((values || []).filter(value => value !== undefined && value !== null && String(value).trim() !== "").map(value => String(value).trim()))]
    .sort(compare)
    .join(" / ");
}

function emptyMetric(periodKey = "") {
  const parts = periodParts(periodKey);
  return {
    periodKey,
    year: parts.year,
    monthNo: parts.monthNo,
    month: parts.month,
    invoiceCount: 0,
    totalInvoice: 0,
    channelShare: 0,
    dealerShare: 0
  };
}

function addMetric(target, source) {
  target.invoiceCount += Number(source.invoiceCount || 0);
  target.totalInvoice += Number(source.totalInvoice || 0);
  target.channelShare += Number(source.channelShare || 0);
  target.dealerShare += Number(source.dealerShare || 0);
  return target;
}

function groupForReport(rows) {
  const map = new Map();
  const periodSet = new Set();

  rows.forEach((row, index) => {
    const period = row.__periodKey || rowPeriod(row);
    if (!period) return;

    const channel = rowChannel(row) || "Kanal yok";
    const dealer = rowDealer(row) || "Bayi yok";
    const dealerKey = normalizeName(dealer) || dealer;
    const invoiceKey = rowInvoiceKey(row, index);
    const amount = rowInvoiceAmount(row);
    const kp = channelRate(channel);
    const bp = dealerRate(channel, dealer);
    const channelShare = amount * Number(kp || 0) / 100;
    const dealerShare = amount * Number(bp || 0) / 100;
    const parts = periodParts(period);

    periodSet.add(period);

    if (!map.has(dealerKey)) {
      map.set(dealerKey, {
        key: dealerKey,
        dealer,
        channelsMap: new Map(),
        kpSet: new Set(),
        bpSet: new Set(),
        invoiceKeys: new Set(),
        periods: {},
        channelBreakdown: new Map(),
        rows: [],
        invoiceCount: 0,
        totalInvoice: 0,
        channelShare: 0,
        dealerShare: 0,
        missingBp: false
      });
    }

    const item = map.get(dealerKey);
    if (item.invoiceKeys.has(invoiceKey)) return;
    item.invoiceKeys.add(invoiceKey);
    item.rows.push(row);

    item.channelsMap.set(normalizeFilter(channel), channel);
    item.kpSet.add(formatRate(kp));
    item.bpSet.add(formatRate(bp));
    if (!Number(bp || 0)) item.missingBp = true;

    if (!item.periods[period]) {
      item.periods[period] = {
        periodKey: period,
        year: parts.year,
        monthNo: parts.monthNo,
        month: parts.month,
        invoiceCount: 0,
        totalInvoice: 0,
        channelShare: 0,
        dealerShare: 0
      };
    }

    const periodMetric = item.periods[period];
    periodMetric.invoiceCount += 1;
    periodMetric.totalInvoice += amount;
    periodMetric.channelShare += channelShare;
    periodMetric.dealerShare += dealerShare;

    item.invoiceCount += 1;
    item.totalInvoice += amount;
    item.channelShare += channelShare;
    item.dealerShare += dealerShare;

    const channelKey = normalizeFilter(channel) || channel;
    if (!item.channelBreakdown.has(channelKey)) {
      item.channelBreakdown.set(channelKey, {
        channel,
        invoiceCount: 0,
        totalInvoice: 0,
        channelShare: 0,
        dealerShare: 0
      });
    }
    const channelMetric = item.channelBreakdown.get(channelKey);
    channelMetric.invoiceCount += 1;
    channelMetric.totalInvoice += amount;
    channelMetric.channelShare += channelShare;
    channelMetric.dealerShare += dealerShare;
  });

  managerState.reportPeriods = [...periodSet].sort((a, b) => a.localeCompare(b));

  const output = [...map.values()].map(item => {
    const channels = [...item.channelsMap.values()].sort((a, b) => a.localeCompare(b, "tr-TR"));
    const channelBreakdown = [...item.channelBreakdown.values()].sort((a, b) => b.totalInvoice - a.totalInvoice);
    return {
      key: item.key,
      dealer: item.dealer,
      channels,
      channel: channels.join(" / "),
      kp: uniqueSlash([...item.kpSet], (a, b) => Number(a.replace(",", ".")) - Number(b.replace(",", "."))),
      bp: uniqueSlash([...item.bpSet], (a, b) => Number(a.replace(",", ".")) - Number(b.replace(",", "."))),
      periods: item.periods,
      channelBreakdown,
      rows: item.rows,
      invoiceCount: item.invoiceCount,
      totalInvoice: item.totalInvoice,
      channelShare: item.channelShare,
      dealerShare: item.dealerShare,
      status: item.missingBp ? "BP Eksik" : "Tanımlı"
    };
  });

  output.sort((a, b) => {
    const priceDiff = Number(b.totalInvoice || 0) - Number(a.totalInvoice || 0);
    if (priceDiff) return priceDiff;
    return a.dealer.localeCompare(b.dealer, "tr-TR");
  });

  managerState.reportRows = output;
  return output;
}

function totals(rows) {
  return rows.reduce((acc, row) => {
    acc.invoiceCount += Number(row.invoiceCount || 0);
    acc.totalInvoice += Number(row.totalInvoice || 0);
    acc.channelShare += Number(row.channelShare || 0);
    acc.dealerShare += Number(row.dealerShare || 0);
    acc.dealers.add(normalizeName(row.dealer));
    (row.channels || String(row.channel || "").split(" / ")).forEach(channel => {
      if (channel) acc.channels.add(normalizeFilter(channel));
    });
    return acc;
  }, {
    invoiceCount: 0,
    totalInvoice: 0,
    channelShare: 0,
    dealerShare: 0,
    dealers: new Set(),
    channels: new Set()
  });
}

function totalsByPeriod(rows, periods = managerState.reportPeriods || []) {
  const map = new Map(periods.map(period => [period, emptyMetric(period)]));
  rows.forEach(row => {
    Object.values(row.periods || {}).forEach(metric => {
      if (!map.has(metric.periodKey)) map.set(metric.periodKey, emptyMetric(metric.periodKey));
      addMetric(map.get(metric.periodKey), metric);
    });
  });
  return map;
}

function statCard(label, value, hint = "") {
  return `<div class="stat-card customer-stat-card"><span>${h(label)}</span><strong>${h(value)}</strong>${hint ? `<em>${h(hint)}</em>` : ""}</div>`;
}

function renderStats(rows) {
  const box = document.getElementById("bayiManagementStats");
  if (!box) return;
  const t = totals(rows);
  box.innerHTML = [
    statCard("Kanal", t.channels.size.toLocaleString("tr-TR"), "Seçili filtre"),
    statCard("Bayi", t.dealers.size.toLocaleString("tr-TR"), "Tekil bayi"),
    statCard("Fatura Adedi", t.invoiceCount.toLocaleString("tr-TR"), "Satır/ID bazlı"),
    statCard("Fatura Tutarı", money(t.totalInvoice), "Büyükten küçüğe"),
    statCard("Kanal Payı", money(t.channelShare)),
    statCard("Bayi Payı", money(t.dealerShare))
  ].join("");
}

function aggregateBy(rows, keyFn, valueFn = row => Number(row.totalInvoice || 0)) {
  const map = new Map();
  rows.forEach(row => {
    const key = keyFn(row) || "-";
    map.set(key, (map.get(key) || 0) + valueFn(row));
  });
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function aggregateByChannel(rows, valueKey = "totalInvoice") {
  const map = new Map();
  rows.forEach(row => {
    (row.channelBreakdown || []).forEach(item => {
      const key = item.channel || "-";
      map.set(key, (map.get(key) || 0) + Number(item[valueKey] || 0));
    });
  });
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function aggregateByPeriodMetrics(rows, valueKey = "totalInvoice") {
  const map = new Map();
  rows.forEach(row => {
    Object.values(row.periods || {}).forEach(metric => {
      if (!map.has(metric.periodKey)) {
        const parts = periodParts(metric.periodKey);
        map.set(metric.periodKey, { label: `${parts.year} / ${parts.month}`, value: 0, periodKey: metric.periodKey });
      }
      map.get(metric.periodKey).value += Number(metric[valueKey] || 0);
    });
  });
  return [...map.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey));
}

function barChart(title, rows, options = {}) {
  const max = Math.max(...rows.map(row => Number(row.value || 0)), 1);
  const valueFormat = options.valueFormat || money;
  const limited = rows.slice(0, options.limit || 8);
  if (!limited.length) {
    return `<div class="bayi-chart-card"><h3>${h(title)}</h3><div class="bayi-chart-empty">Gösterilecek veri yok.</div></div>`;
  }
  return `<div class="bayi-chart-card"><h3>${h(title)}</h3><div class="bayi-chart-bars">${limited.map(item => {
    const width = Math.max(4, Math.round(Number(item.value || 0) / max * 100));
    return `<div class="bayi-chart-row"><span class="bayi-chart-label" title="${h(item.label)}">${h(item.label)}</span><span class="bayi-chart-track"><i style="width:${width}%"></i></span><strong>${h(valueFormat(item.value))}</strong></div>`;
  }).join("")}</div></div>`;
}

function renderCharts(rows) {
  const box = document.getElementById("bayiManagementCharts");
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = `<div class="customer-empty">Görsel rapor için önce filtre seçip Göster butonuna basın.</div>`;
    return;
  }

  const byChannel = aggregateByChannel(rows, "totalInvoice");
  const byPeriod = aggregateByPeriodMetrics(rows, "totalInvoice");
  const byDealerShare = aggregateBy(rows, row => row.dealer, row => Number(row.dealerShare || 0));
  const byInvoiceCount = aggregateByChannel(rows, "invoiceCount");

  box.innerHTML = [
    barChart("Kanala Göre Fatura Tutarı", byChannel),
    barChart("Yıl / Ay Bazlı Fatura Tutarı", byPeriod, { limit: 12 }),
    barChart("En Yüksek Bayi Payı", byDealerShare),
    barChart("Kanala Göre Fatura Adedi", byInvoiceCount, { valueFormat: value => Number(value || 0).toLocaleString("tr-TR") })
  ].join("");
}

function periodCellHtml(metric) {
  if (!metric || !Number(metric.invoiceCount || 0)) {
    return `<td class="bayi-period-empty">—</td>`;
  }
  return `<td class="bayi-period-cell">
    <strong>${h(money(metric.totalInvoice))}</strong>
    <span>Adet: ${h(metric.invoiceCount)}</span>
    <span>Kanal: ${h(money(metric.channelShare))}</span>
    <span>Bayi: ${h(money(metric.dealerShare))}</span>
  </td>`;
}

function syncBayiManagementTableScroll() {
  const box = document.getElementById("bayiManagementTable");
  const topScroll = box?.querySelector(".bayi-management-scroll-top");
  const bodyScroll = box?.querySelector(".bayi-management-scroll-body");
  if (!topScroll || !bodyScroll) return;

  let syncing = false;
  const sync = (source, target) => {
    if (syncing) return;
    syncing = true;
    target.scrollLeft = source.scrollLeft;
    window.requestAnimationFrame(() => { syncing = false; });
  };

  topScroll.addEventListener("scroll", () => sync(topScroll, bodyScroll), { passive: true });
  bodyScroll.addEventListener("scroll", () => sync(bodyScroll, topScroll), { passive: true });
}

function renderTable(rows) {
  const box = document.getElementById("bayiManagementTable");
  const count = document.getElementById("bayiManagementCount");
  if (!box) return;
  if (count) count.textContent = `${rows.length.toLocaleString("tr-TR")} bayi`;

  renderStats(rows);
  renderCharts(rows);

  if (!rows.length) {
    box.innerHTML = `<div class="customer-empty">Seçilen kanal/yıl/ay filtresine göre kayıt bulunamadı.</div>`;
    return;
  }

  const periods = managerState.reportPeriods || [];
  const periodTotals = totalsByPeriod(rows, periods);
  const t = totals(rows);
  const minWidth = Math.max(1180, 760 + periods.length * 190);

  const tableHtml = `<table class="bayi-management-pivot-table" style="min-width:${minWidth}px"><thead><tr>
    <th>Kanal / Dağıtıcı</th><th>Bayi</th><th>KP</th><th>BP</th>
    ${periods.map(period => `<th class="bayi-period-head">${h(periodParts(period).label)}</th>`).join("")}
    <th class="num">Toplam Adet</th><th class="num">Toplam Fatura</th><th class="num">Toplam Kanal Payı</th><th class="num">Toplam Bayi Payı</th><th>Durum</th>
  </tr></thead><tbody>${rows.map(row => `<tr>
    <td class="customer-title bayi-channel-cell" title="${h(row.channel)}">${h(row.channel)}</td>
    <td class="customer-title" title="${h(row.dealer)}">${h(row.dealer)}</td>
    <td class="num customer-nowrap" title="${h(row.kp)}">${h(row.kp)}</td>
    <td class="num customer-nowrap" title="${h(row.bp)}">${h(row.bp)}</td>
    ${periods.map(period => periodCellHtml(row.periods?.[period])).join("")}
    <td class="num">${h(row.invoiceCount)}</td>
    <td class="num">${h(money(row.totalInvoice))}</td>
    <td class="num">${h(money(row.channelShare))}</td>
    <td class="num">${h(money(row.dealerShare))}</td>
    <td class="customer-nowrap ${row.status === "BP Eksik" ? "is-negative" : "is-positive"}">${h(row.status)}</td>
  </tr>`).join("")}</tbody><tfoot><tr class="general-report-total-row">
    <td colspan="4">Genel Toplam</td>
    ${periods.map(period => periodCellHtml(periodTotals.get(period))).join("")}
    <td class="num">${h(t.invoiceCount)}</td>
    <td class="num">${h(money(t.totalInvoice))}</td>
    <td class="num">${h(money(t.channelShare))}</td>
    <td class="num">${h(money(t.dealerShare))}</td>
    <td></td>
  </tr></tfoot></table>`;

  box.innerHTML = `<div class="bayi-management-scroll-top" aria-label="Tablo yatay kaydırma"><div style="width:${minWidth}px"></div></div><div class="bayi-management-scroll-body">${tableHtml}</div>`;
  syncBayiManagementTableScroll();
}

async function runReport(forceLoad = false) {
  const rows = await ensureRowsLoaded(forceLoad);
  if (!rows.length) {
    managerState.reportRows = [];
    managerState.reportPeriods = [];
    renderTable([]);
    return;
  }

  const filtered = filterRows(rows);
  const reportRows = groupForReport(filtered);
  renderTable(reportRows);
  setStatus(`${reportRows.length.toLocaleString("tr-TR")} bayi satırı oluşturuldu. Aynı bayi birden fazla kanalda varsa kanal adları slash ile birleştirildi; rapor toplam fatura tutarına göre büyükten küçüğe sıralandı.`, reportRows.length ? "success" : "warning");
}

function ensurePdfMake() {
  if (!window.pdfMake) {
    alert("PDF kütüphanesi yüklenemedi. İnternet bağlantısını veya script yüklemesini kontrol edin.");
    throw new Error("pdfMake missing");
  }
}

function pdfCell(text, options = {}) {
  return {
    text: String(text ?? ""),
    fontSize: options.fontSize || 6.6,
    bold: Boolean(options.bold),
    alignment: options.alignment || "left",
    noWrap: options.noWrap ?? false,
    margin: options.margin || [0, 1, 0, 1]
  };
}

function periodCellText(metric) {
  if (!metric || !Number(metric.invoiceCount || 0)) return "—";
  return `Adet: ${Number(metric.invoiceCount || 0).toLocaleString("tr-TR")}\nTutar: ${money(metric.totalInvoice)}\nKanal: ${money(metric.channelShare)}\nBayi: ${money(metric.dealerShare)}`;
}

function previewPdf() {
  const rows = managerState.reportRows || [];
  if (!rows.length) {
    toast("Önizlenecek Bayi Yönetimi raporu yok.");
    return;
  }

  ensurePdfMake();
  const periods = managerState.reportPeriods || [];
  const periodTotals = totalsByPeriod(rows, periods);
  const t = totals(rows);
  const smallFont = periods.length > 6 ? 5.5 : 6.2;
  const pageSize = periods.length > 3 ? "A3" : "A4";

  const body = [[
    pdfCell("Kanal", { bold: true }),
    pdfCell("Bayi", { bold: true }),
    pdfCell("KP", { bold: true, alignment: "right" }),
    pdfCell("BP", { bold: true, alignment: "right" }),
    ...periods.map(period => pdfCell(periodParts(period).label, { bold: true, alignment: "center", fontSize: smallFont })),
    pdfCell("Toplam Adet", { bold: true, alignment: "right" }),
    pdfCell("Toplam Fatura", { bold: true, alignment: "right" }),
    pdfCell("Kanal Payı", { bold: true, alignment: "right" }),
    pdfCell("Bayi Payı", { bold: true, alignment: "right" }),
    pdfCell("Durum", { bold: true })
  ], ...rows.map(row => [
    pdfCell(row.channel, { fontSize: smallFont }),
    pdfCell(row.dealer, { fontSize: smallFont }),
    pdfCell(row.kp, { alignment: "right", fontSize: smallFont }),
    pdfCell(row.bp, { alignment: "right", fontSize: smallFont }),
    ...periods.map(period => pdfCell(periodCellText(row.periods?.[period]), { fontSize: smallFont })),
    pdfCell(row.invoiceCount, { alignment: "right", noWrap: true, fontSize: smallFont }),
    pdfCell(money(row.totalInvoice), { alignment: "right", noWrap: true, fontSize: smallFont }),
    pdfCell(money(row.channelShare), { alignment: "right", noWrap: true, fontSize: smallFont }),
    pdfCell(money(row.dealerShare), { alignment: "right", noWrap: true, fontSize: smallFont }),
    pdfCell(row.status, { noWrap: true, fontSize: smallFont })
  ])];

  body.push([
    pdfCell("Genel Toplam", { bold: true, margin: [0, 2, 0, 2] }),
    pdfCell("", { bold: true }),
    pdfCell("", { bold: true }),
    pdfCell("", { bold: true }),
    ...periods.map(period => pdfCell(periodCellText(periodTotals.get(period)), { bold: true, fontSize: smallFont })),
    pdfCell(t.invoiceCount, { bold: true, alignment: "right" }),
    pdfCell(money(t.totalInvoice), { bold: true, alignment: "right", fontSize: smallFont }),
    pdfCell(money(t.channelShare), { bold: true, alignment: "right", fontSize: smallFont }),
    pdfCell(money(t.dealerShare), { bold: true, alignment: "right", fontSize: smallFont }),
    pdfCell("", { bold: true })
  ]);

  const doc = {
    pageSize,
    pageOrientation: "landscape",
    pageMargins: [16, 24, 16, 22],
    defaultStyle: { fontSize: smallFont },
    content: [
      { text: "BAYİ YÖNETİMİ RAPORU", bold: true, fontSize: 13, color: "#17351a", margin: [0, 0, 0, 4] },
      { text: `Rapor Üretim Tarihi: ${new Date().toLocaleDateString("tr-TR")} · Bayi: ${rows.length.toLocaleString("tr-TR")} · Fatura Adedi: ${t.invoiceCount.toLocaleString("tr-TR")} · Sıralama: Fatura tutarı büyükten küçüğe`, fontSize: 8, color: "#66785f", margin: [0, 0, 0, 8] },
      {
        columns: [
          { text: `Fatura Tutarı: ${money(t.totalInvoice)}`, bold: true },
          { text: `Kanal Payı: ${money(t.channelShare)}`, bold: true, alignment: "center" },
          { text: `Bayi Payı: ${money(t.dealerShare)}`, bold: true, alignment: "right" }
        ],
        margin: [0, 0, 0, 8]
      },
      {
        table: {
          headerRows: 1,
          widths: [76, 112, 28, 28, ...periods.map(() => "*"), 42, 58, 56, 56, 38],
          body
        },
        layout: {
          hLineColor: () => "#d9e8d0",
          vLineColor: () => "#d9e8d0",
          fillColor: rowIndex => rowIndex === 0 ? "#eef8e5" : rowIndex % 2 === 0 ? "#fbfff7" : null,
          paddingTop: () => 3,
          paddingBottom: () => 3,
          paddingLeft: () => 3,
          paddingRight: () => 3
        }
      }
    ],
    footer: (currentPage, pageCount) => ({ text: `${currentPage} / ${pageCount}`, alignment: "right", margin: [0, 6, 18, 0], fontSize: 7, color: "#66785f" })
  };

  window.pdfMake.createPdf(doc).open();
}

function resetFilters() {
  managerState.selectedChannels = [];
  managerState.selectedYears = [];
  managerState.selectedMonths = [];
  renderFilters();
}

export function setupBayiManagement() {
  if (managerState.initialized) return;
  managerState.initialized = true;

  bindDropdown("bayiManagementChannelDropdown", "selectedChannels");
  bindDropdown("bayiManagementYearDropdown", "selectedYears");
  bindDropdown("bayiManagementMonthDropdown", "selectedMonths");
  document.addEventListener("click", closeDropdowns);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeDropdowns();
  });

  document.getElementById("bayiManagementLoadBtn")?.addEventListener("click", () => runReport(false));
  document.getElementById("bayiManagementPreviewBtn")?.addEventListener("click", previewPdf);
  document.getElementById("bayiManagementClearBtn")?.addEventListener("click", () => {
    resetFilters();
    toast("Bayi Yönetimi filtreleri temizlendi.");
  });

  document.addEventListener("dikesoft:bayi-management-open", async () => {
    if (!managerState.reportRows.length) {
      renderStats([]);
      renderCharts([]);
    }

    renderFilters();
    setStatus("Bayi Yönetimi verisi kontrol ediliyor. Cache boşsa veya veri değişmişse SQL’den otomatik alınacak…", "info");

    const rows = await ensureRowsLoaded(false);
    if (rows.length && !managerState.reportRows.length) {
      setStatus(`${rows.length.toLocaleString("tr-TR")} satır hazır. Kanal/yıl/ay filtresini seçip Göster butonuna basın.`, "success");
    }
  });

  renderFilters();
}
