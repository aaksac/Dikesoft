import { ensureSharedPaymentRows } from "./shared-payment-cache.js?v=2026.06.13-indexeddb-v1";
import { state } from "./state.js";
import { dateTR } from "./format.js";
import { sanitizeText, safeNumber, normalizeName } from "./security.js";
import { toast } from "./ui.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES = [
  "", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
];
const customerState = {
  initialized: false,
  loading: false,
  loadingPromise: null,
  allRows: [],
  rows: [],
  lossRows: [],
  manualPeriodTouched: false,
  latestDataDate: null,
  tableFilters: {},
  searchField: "__all",
  searchText: "",
  searchDraftField: "__all",
  searchDraftText: "",
  selectedYears: null,
  selectedMonths: null,
  tableSort: { field: "tahsilatTarihi", direction: "desc" },
  openFilterField: "",
  openToolbarDropdown: "",
  dataVersion: null,
  cacheKey: "",
  renderTimer: null,
  pageSize: 1000,
  currentPage: 1
};

function h(value) {
  return sanitizeText(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I")
    .replace(/İ/g, "I")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s\u00A0]+/g, " ")
    .trim();
}

function isValidDate(date) {
  const y = date?.getFullYear?.();
  return date instanceof Date && !Number.isNaN(date.getTime()) && y >= 1900 && y <= 2100;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return startOfDay(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    const utc = Date.UTC(1899, 11, 30) + Math.floor(value) * DAY_MS;
    const date = new Date(utc);
    const parsed = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return isValidDate(parsed) ? startOfDay(parsed) : null;
  }
  const text = String(value).trim();
  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s+.*)?$/);
  if (tr) {
    let [, d, m, y] = tr;
    if (y.length === 2) y = `20${y}`;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return isValidDate(date) ? startOfDay(date) : null;
  }
  const iso = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[T\s].*)?$/);
  if (iso) {
    const [, y, m, d] = iso;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return isValidDate(date) ? startOfDay(date) : null;
  }
  const ym = text.match(/^(\d{4})[./-](\d{1,2})$/);
  if (ym) {
    const [, y, m] = ym;
    const date = new Date(Number(y), Number(m) - 1, 1);
    return isValidDate(date) ? startOfDay(date) : null;
  }
  return null;
}

function toDateInputValue(value) {
  const date = parseDate(value);
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateValue(value) {
  const date = parseDate(value);
  return date ? dateTR(date) : "-";
}

function getToday() {
  return startOfDay(new Date());
}

function addMonths(date, months) {
  const d = parseDate(date) || getToday();
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

function periodKeyFromParts(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 1900 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) return "";
  return `${y}-${String(m).padStart(2, "0")}`;
}

function periodKeyFromDate(dateValue) {
  const d = parseDate(dateValue);
  return d ? periodKeyFromParts(d.getFullYear(), d.getMonth() + 1) : "";
}

function periodLabel(key) {
  const match = String(key || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return key || "-";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
}

function rowDate(row) {
  return parseDate(row?.tahsilatTarihi || row?.tahsilat_tarihi || row?.TAHSILAT_TARIHI);
}

function rowPeriod(row) {
  return row?.__periodKey || periodKeyFromDate(row?.__tahsilatDate || rowDate(row));
}

function rowInvoiceNo(row) {
  return String(row?.faturaNo || row?.fatura_no || row?.FATURA_NO || "").trim();
}

function rowInvoiceDate(row) {
  return row?.faturaTarihi || row?.fatura_tarihi || row?.FATURA_TARIHI || row?.tarih || "";
}

function rowInvoiceAmount(row) {
  return row?.faturaTutari ?? row?.fatura_tutari ?? row?.FATURA_TUTARI ?? "";
}

function rowTahsilatStatus(row) {
  return row?.tahsilatDurumu || row?.tahsilat_durumu || row?.TAHSILAT_DURUMU || "";
}

function rowTotalAmount(row) {
  return row?.toplamTutar ?? row?.toplam_tutar ?? row?.TOPLAM_TUTAR ?? row?.tutar ?? "";
}

function rowVkn(row) {
  return String(row?.vkn || row?.vknTckn || row?.VKN || row?.VKN_TCKN || "").trim();
}

function rowUnvan(row) {
  return String(row?.unvan || row?.musteri || row?.UNVAN || row?.MUSTERI || "").trim();
}

function rowChannel(row) {
  return String(row?.dagitici || row?.DAGITICI || row?.kanal || row?.KANAL || "").trim();
}

function rowDealer(row) {
  return String(row?.bayi || row?.BAYI || "").trim();
}

function rowIndexValue(row, fallbackIndex = 0) {
  const index = Number(fallbackIndex || 0);
  return Number.isFinite(index) ? index + 1 : 1;
}

function rowCustomerKey(row) {
  const vkn = rowVkn(row);
  const unvan = rowUnvan(row);
  return vkn ? `VKN:${normalizeText(vkn)}` : `UNVAN:${normalizeText(unvan)}`;
}

function groupKey(row) {
  return rowCustomerKey(row);
}

function setStatus(message = "", type = "info") {
  const box = document.getElementById("customerAnalyticsStatus");
  if (!box) return;
  box.textContent = message;
  box.className = `customer-analytics-status ${message ? "" : "hidden"} ${type ? `is-${type}` : ""}`.trim();
}

function getLatestDataDate(rows) {
  return rows.reduce((latest, row) => {
    const d = row.__tahsilatDate || rowDate(row);
    return d && (!latest || d > latest) ? d : latest;
  }, null);
}

function normalizeAllRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    const tahsilatDate = rowDate(row);
    const faturaDate = parseDate(rowInvoiceDate(row));
    return {
      ...row,
      __tahsilatDate: tahsilatDate,
      __faturaDate: faturaDate,
      __periodKey: periodKeyFromDate(tahsilatDate)
    };
  });
}

async function ensureRowsLoaded(force = false) {
  if (customerState.loading && customerState.loadingPromise) return customerState.loadingPromise;
  if (!force && customerState.allRows.length) return customerState.allRows;

  customerState.loading = true;
  customerState.loadingPromise = (async () => {
    setStatus("Müşteri Yönetimi SQL verileri alınıyor…", "info");

    try {
      const result = await ensureSharedPaymentRows({
        force,
        pageSize: 1000,
        onProgress: progress => {
          const fetched = Number(progress?.fetched || 0).toLocaleString("tr-TR");
          if (progress?.done) setStatus(`${fetched} SQL satırı alındı. Tablo hazırlanıyor…`, "info");
          else setStatus(`${fetched} SQL satırı alındı…`, "info");
        }
      });

      customerState.allRows = normalizeAllRows(result.rows || []);
      customerState.rows = customerState.allRows.filter(row => row.__tahsilatDate && row.__periodKey);
      customerState.dataVersion = result.dataVersion || null;
      customerState.cacheKey = result.cacheKey || result.dataVersion?.key || "";
      customerState.latestDataDate = getLatestDataDate(customerState.rows);
      applyDefaultPeriodFromLatestData(customerState.rows);
      renderCustomerAllTable();

      const sourceText = result.source === "shared-memory"
        ? "ortak RAM cache'den kullanıldı"
        : result.source === "persistent-cache"
          ? "kalıcı yerel cache'den kullanıldı"
          : result.source === "persistent-cache-fallback"
            ? "SQL kontrol edilemedi; kalıcı yerel cache'den kullanıldı"
            : result.source === "state-fallback"
              ? "ekrandaki mevcut veriden kullanıldı"
              : "SQL'den alındı";

      setStatus(
        customerState.allRows.length
          ? `${customerState.allRows.length.toLocaleString("tr-TR")} SQL satırı ${sourceText}. Tahsilat tarihi okunabilen satır: ${customerState.rows.length.toLocaleString("tr-TR")}. Son tahsilat tarihi: ${formatDateValue(customerState.latestDataDate)}.`
          : "SQL'de gösterilecek kayıt bulunamadı.",
        customerState.allRows.length ? "success" : "warning"
      );
      return customerState.allRows;
    } catch (error) {
      console.error(error);
      setStatus("Müşteri Yönetimi verisi alınamadı. SQL bağlantısını ve payment_records tablosunu kontrol edin.", "error");
      toast("Müşteri Yönetimi verisi alınamadı.");
      renderCustomerAllTable();
      return [];
    }
  })();

  try {
    return await customerState.loadingPromise;
  } finally {
    customerState.loading = false;
    customerState.loadingPromise = null;
  }
}

function setPeriodInputs(startKey, endKey, overwrite = false) {
  const startYear = document.getElementById("customerLossStartYear");
  const startMonth = document.getElementById("customerLossStartMonth");
  const endYear = document.getElementById("customerLossEndYear");
  const endMonth = document.getElementById("customerLossEndMonth");
  const sm = String(startKey || "").match(/^(\d{4})-(\d{2})$/);
  const em = String(endKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!sm || !em) return;
  if (startYear && (overwrite || !startYear.value)) startYear.value = sm[1];
  if (startMonth && (overwrite || !startMonth.value)) startMonth.value = String(Number(sm[2]));
  if (endYear && (overwrite || !endYear.value)) endYear.value = em[1];
  if (endMonth && (overwrite || !endMonth.value)) endMonth.value = String(Number(em[2]));
}

function applyInitialPeriodByToday() {
  const previousMonth = addMonths(getToday(), -1);
  const key = periodKeyFromParts(previousMonth.getFullYear(), previousMonth.getMonth() + 1);
  setPeriodInputs(key, key, false);
  updatePeriodHint();
}

function applyDefaultPeriodFromLatestData(rows) {
  if (customerState.manualPeriodTouched) return;
  const latest = customerState.latestDataDate || getLatestDataDate(rows);
  if (!latest) return;
  const previousMonth = addMonths(latest, -1);
  const key = periodKeyFromParts(previousMonth.getFullYear(), previousMonth.getMonth() + 1);
  setPeriodInputs(key, key, true);
  updatePeriodHint();
}

function readSelectedPeriodRange() {
  const startKey = periodKeyFromParts(
    document.getElementById("customerLossStartYear")?.value,
    document.getElementById("customerLossStartMonth")?.value
  );
  const endKey = periodKeyFromParts(
    document.getElementById("customerLossEndYear")?.value,
    document.getElementById("customerLossEndMonth")?.value
  );
  let start = startKey;
  let end = endKey;
  if (!start || !end) {
    const previousMonth = addMonths(getToday(), -1);
    const key = periodKeyFromParts(previousMonth.getFullYear(), previousMonth.getMonth() + 1);
    start = start || key;
    end = end || key;
  }
  if (start > end) [start, end] = [end, start];
  return { startKey: start, endKey: end };
}

const customerTableColumns = [
  { field: "sira", label: "Sıra", type: "number", width: 76, filterable: false, searchable: false, sortable: false, value: (row, index) => rowIndexValue(row, index) },
  { field: "dagitici", label: "Kanal / Dağıtıcı", type: "text", width: 116, value: rowChannel },
  { field: "bayi", label: "Bayi", type: "text", width: 120, value: rowDealer },
  { field: "vkn", label: "VKN", type: "text", width: 105, value: rowVkn },
  { field: "unvan", label: "Müşteri / Unvan", type: "text", width: 210, value: rowUnvan },
  { field: "faturaNo", label: "Fatura No", type: "text", width: 112, value: rowInvoiceNo },
  { field: "faturaTarihi", label: "Fatura Tarihi", type: "date", width: 108, value: row => row.__faturaDate || parseDate(rowInvoiceDate(row)) },
  { field: "faturaTutari", label: "Fatura Tutarı", type: "number", width: 112, value: rowInvoiceAmount },
  { field: "tahsilatDurumu", label: "Tahsilat Durumu", type: "text", width: 118, value: rowTahsilatStatus },
  { field: "tahsilatTarihi", label: "Tahsilat Tarihi", type: "date", width: 108, value: row => row.__tahsilatDate || rowDate(row) },
  { field: "toplamTutar", label: "Toplam Tutar", type: "number", width: 112, value: rowTotalAmount }
];

function columnByField(field) {
  return customerTableColumns.find(col => col.field === field) || customerTableColumns[0];
}

function displayColumnValue(row, col, index) {
  const value = col.value(row, index);
  if (col.type === "date") return formatDateValue(value);
  if (col.type === "number") return formatRawAmount(value);
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function sortColumnValue(row, col, index) {
  const value = col.value(row, index);
  if (col.type === "date") return parseDate(value)?.getTime() || 0;
  if (col.type === "number") return safeNumber(value);
  return normalizeText(value);
}

function getFilterValue(key) {
  return customerState.tableFilters[key] || "";
}

function columnHasActiveFilter(col) {
  if (!col || col.filterable === false) return false;
  if (col.type === "date") return Boolean(getFilterValue(`${col.field}From`) || getFilterValue(`${col.field}To`));
  if (col.type === "number") return Boolean(getFilterValue(`${col.field}Min`) || getFilterValue(`${col.field}Max`));
  return Boolean(getFilterValue(col.field));
}

function dateInRange(value, fromValue, toValue) {
  const date = parseDate(value);
  if (!date) return !(fromValue || toValue);
  const from = parseDate(fromValue);
  const to = parseDate(toValue);
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function numberInRange(value, minValue, maxValue) {
  const number = safeNumber(value);
  const hasMin = String(minValue || "").trim() !== "";
  const hasMax = String(maxValue || "").trim() !== "";
  if (!hasMin && !hasMax) return true;
  if (hasMin && number < safeNumber(minValue)) return false;
  if (hasMax && number > safeNumber(maxValue)) return false;
  return true;
}

function periodPartsFromRow(row) {
  const key = rowPeriod(row) || periodKeyFromDate(row?.__faturaDate || parseDate(rowInvoiceDate(row)));
  const match = String(key || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return { year: "", month: "" };
  return { year: match[1], month: String(Number(match[2])) };
}

function yearMonthFilterMatches(row) {
  const years = customerState.selectedYears;
  const months = customerState.selectedMonths;
  const filterYears = Array.isArray(years);
  const filterMonths = Array.isArray(months);
  if (!filterYears && !filterMonths) return true;
  if (filterYears && !years.length) return false;
  if (filterMonths && !months.length) return false;
  const parts = periodPartsFromRow(row);
  if (filterYears && !years.includes(parts.year)) return false;
  if (filterMonths && !months.includes(parts.month)) return false;
  return true;
}

function searchableCustomerColumns() {
  return customerTableColumns.filter(col => col.searchable !== false);
}

function searchFilterMatches(row, index) {
  const query = normalizeText(customerState.searchText || getFilterValue("__global"));
  if (!query) return true;
  const field = customerState.searchField || "__all";
  if (field === "__all") {
    const haystack = normalizeText(searchableCustomerColumns().map(col => displayColumnValue(row, col, index)).join(" "));
    return haystack.includes(query);
  }
  const col = columnByField(field);
  if (col.searchable === false) return true;
  return normalizeText(displayColumnValue(row, col, index)).includes(query);
}

function applyCustomerTableFilters(rows) {
  return rows.filter((row, index) => {
    if (!searchFilterMatches(row, index)) return false;
    if (!yearMonthFilterMatches(row)) return false;

    for (const col of customerTableColumns) {
      if (col.filterable === false) continue;
      if (col.type === "date") {
        if (!dateInRange(col.value(row, index), getFilterValue(`${col.field}From`), getFilterValue(`${col.field}To`))) return false;
      } else if (col.type === "number") {
        if (!numberInRange(col.value(row, index), getFilterValue(`${col.field}Min`), getFilterValue(`${col.field}Max`))) return false;
      } else {
        const query = normalizeText(getFilterValue(col.field));
        if (query && !normalizeText(col.value(row, index)).includes(query)) return false;
      }
    }
    return true;
  });
}

function sortedCustomerTableRows(rows) {
  const sort = customerState.tableSort || { field: "tahsilatTarihi", direction: "desc" };
  const col = columnByField(sort.field);
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortColumnValue(a, col, 0);
    const bv = sortColumnValue(b, col, 0);
    if (col.type === "text") return String(av).localeCompare(String(bv), "tr-TR") * direction;
    return (av - bv) * direction;
  });
}

function filterHtml(col) {
  if (col.type === "date") {
    return `<div class="customer-date-filter">
      <input type="date" value="${h(toDateInputValue(getFilterValue(`${col.field}From`)))}" data-customer-filter-key="${h(`${col.field}From`)}" aria-label="${h(col.label)} başlangıç" />
      <input type="date" value="${h(toDateInputValue(getFilterValue(`${col.field}To`)))}" data-customer-filter-key="${h(`${col.field}To`)}" aria-label="${h(col.label)} bitiş" />
    </div>`;
  }
  if (col.type === "number") {
    return `<div class="customer-number-filter">
      <input type="search" inputmode="decimal" placeholder="Min" value="${h(getFilterValue(`${col.field}Min`))}" data-customer-filter-key="${h(`${col.field}Min`)}" aria-label="${h(col.label)} minimum" />
      <input type="search" inputmode="decimal" placeholder="Max" value="${h(getFilterValue(`${col.field}Max`))}" data-customer-filter-key="${h(`${col.field}Max`)}" aria-label="${h(col.label)} maksimum" />
    </div>`;
  }
  const placeholder = col.field === "unvan" ? "Müşteri ara" : "Ara";
  return `<input class="customer-th-filter" type="search" placeholder="${h(placeholder)}" value="${h(getFilterValue(col.field))}" data-customer-filter-key="${h(col.field)}" aria-label="${h(col.label)} filtrele" />`;
}

function captureActiveFilter() {
  const active = document.activeElement;
  if (!active?.matches?.("[data-customer-filter-key], #customerAllGlobalSearch")) return null;
  return {
    id: active.id || "",
    key: active.dataset?.customerFilterKey || "",
    start: active.selectionStart,
    end: active.selectionEnd
  };
}

function restoreActiveFilter(activeInfo) {
  if (!activeInfo) return;
  const selector = activeInfo.id
    ? `#${CSS.escape(activeInfo.id)}`
    : `[data-customer-filter-key="${CSS.escape(activeInfo.key)}"]`;
  const target = document.querySelector(selector);
  if (!target) return;
  target.focus({ preventScroll: true });
  try {
    if (Number.isInteger(activeInfo.start) && Number.isInteger(activeInfo.end)) {
      target.setSelectionRange(activeInfo.start, activeInfo.end);
    }
  } catch {}
}


function hasAnyCustomerTableFilter() {
  const columnFilterActive = Object.values(customerState.tableFilters || {}).some(value => String(value ?? "").trim() !== "");
  const yearFilterActive = Array.isArray(customerState.selectedYears);
  const monthFilterActive = Array.isArray(customerState.selectedMonths);
  return Boolean(
    columnFilterActive ||
    String(customerState.searchText || "").trim() ||
    yearFilterActive ||
    monthFilterActive
  );
}

function customerIdentityForSummary(row) {
  const vkn = rowVkn(row);
  const unvan = rowUnvan(row);
  if (vkn) return `VKN:${normalizeText(vkn)}`;
  if (unvan) return `UNVAN:${normalizeText(unvan)}`;
  return "";
}

function invoiceAmountValue(row) {
  const invoiceAmount = rowInvoiceAmount(row);
  if (invoiceAmount !== undefined && invoiceAmount !== null && String(invoiceAmount).trim() !== "") {
    return safeNumber(invoiceAmount);
  }
  return safeNumber(rowTotalAmount(row));
}

function formatMoneyValue(value) {
  return Number(value || 0).toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 });
}

function formatRateValue(rate) {
  if (Array.isArray(rate)) return rate.map(formatRateValue).join(" / ");
  if (rate === "Çoklu") return "Çoklu";
  const number = Number(rate || 0);
  return `%${number.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function invoiceCountForRows(rows) {
  const invoiceNos = new Set();
  rows.forEach(row => {
    const no = normalizeText(rowInvoiceNo(row));
    if (no) invoiceNos.add(no);
  });
  return invoiceNos.size || rows.length;
}

function summaryPeriodKey(row) {
  return periodKeyFromDate(row.__faturaDate || parseDate(rowInvoiceDate(row)) || row.__tahsilatDate || rowDate(row));
}

function rateNormalize(value) {
  return normalizeName(value)
    .replace(/İ/g, "I")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function channelDefinitionRate(channelName) {
  const key = rateNormalize(channelName);
  if (!key) return 0;
  const channel = (Array.isArray(state.channels) ? state.channels : []).find(item => {
    return rateNormalize(item?.kanal || item?.DAGITICI || item?.KANAL) === key;
  });
  return Number(channel?.kp || 0);
}

function dealerDefinitionRate(channelName, dealerName) {
  const channelKey = rateNormalize(channelName);
  const dealerKey = rateNormalize(dealerName);
  if (!channelKey || !dealerKey) return 0;
  const dealer = (Array.isArray(state.dealers) ? state.dealers : []).find(item => {
    const itemChannel = rateNormalize(item?.kanal || item?.DAGITICI || item?.KANAL);
    const itemDealer = rateNormalize(item?.bayiKey || item?.bayi || item?.BAYI);
    return itemChannel === channelKey && itemDealer === dealerKey;
  });
  return Number(dealer?.bp || 0);
}

function displayDistinctRate(rates) {
  const distinct = [...new Set((rates || []).map(rate => Number(rate || 0)))];
  if (!distinct.length) return 0;
  return distinct.length === 1 ? distinct[0] : "Çoklu";
}

function distributionSummary(rows, type) {
  const map = new Map();
  rows.forEach(row => {
    const channel = rowChannel(row) || "Belirtilmemiş";
    const dealer = rowDealer(row) || "Belirtilmemiş";
    const amount = invoiceAmountValue(row);
    const isDealer = type === "dealer";
    const key = isDealer ? `${rateNormalize(channel)}::${rateNormalize(dealer)}` : rateNormalize(channel);
    const label = isDealer ? `${dealer} · ${channel}` : channel;
    const rate = isDealer ? dealerDefinitionRate(channel, dealer) : channelDefinitionRate(channel);
    const current = map.get(key) || { key, label, rows: [], invoiceCount: 0, total: 0, shareTotal: 0, rates: [] };
    current.rows.push(row);
    current.total += amount;
    current.shareTotal += amount * rate / 100;
    current.rates.push(rate);
    map.set(key, current);
  });
  return [...map.values()]
    .map(item => ({ ...item, invoiceCount: invoiceCountForRows(item.rows), rate: displayDistinctRate(item.rates) }))
    .sort((a, b) => b.shareTotal - a.shareTotal || b.total - a.total || a.label.localeCompare(b.label, "tr-TR"));
}

function distributionTableHtml(title, rows) {
  const items = rows.slice(0, 12);
  if (!items.length) return "";
  return `<div class="customer-summary-breakdown"><h4>${h(title)}</h4><table><thead><tr><th>Ad</th><th>Fatura</th><th>Fatura Tutarı</th><th>Oran</th><th>Pay Tutarı</th></tr></thead><tbody>${items.map(item => `<tr>
    <td title="${h(item.label)}">${h(item.label)}</td>
    <td class="num">${h(item.invoiceCount.toLocaleString("tr-TR"))}</td>
    <td class="num">${h(formatMoneyValue(item.total))}</td>
    <td class="num">${h(formatRateValue(item.rate))}</td>
    <td class="num">${h(formatMoneyValue(item.shareTotal))}</td>
  </tr>`).join("")}</tbody></table>${rows.length > items.length ? `<p class="muted">+${(rows.length - items.length).toLocaleString("tr-TR")} satır daha var.</p>` : ""}</div>`;
}

function compactDistributionHtml(items) {
  if (!items.length) return "-";
  const visible = items.slice(0, 3);
  const html = visible.map(item => `<span>${h(item.label)}: <strong>${h(formatMoneyValue(item.shareTotal))}</strong> <em>${h(formatRateValue(item.rate))}</em></span>`).join("");
  return `${html}${items.length > visible.length ? `<small>+${items.length - visible.length} daha</small>` : ""}`;
}

function buildMonthlySummary(rows) {
  const map = new Map();
  rows.forEach(row => {
    const key = summaryPeriodKey(row);
    if (!key) return;
    const item = map.get(key) || { key, rows: [], total: 0 };
    item.rows.push(row);
    item.total += invoiceAmountValue(row);
    map.set(key, item);
  });
  return [...map.values()]
    .map(item => {
      const channelItems = distributionSummary(item.rows, "channel");
      const dealerItems = distributionSummary(item.rows, "dealer");
      return {
        ...item,
        invoiceCount: invoiceCountForRows(item.rows),
        channelNames: channelItems.map(detail => detail.label).filter(Boolean),
        dealerNames: dealerItems.map(detail => detail.label).filter(Boolean),
        channelShareTotal: channelItems.reduce((sum, detail) => sum + Number(detail.shareTotal || 0), 0),
        dealerShareTotal: dealerItems.reduce((sum, detail) => sum + Number(detail.shareTotal || 0), 0)
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function monthlyNameListHtml(names) {
  const clean = [...new Set((names || []).map(name => String(name || "").trim()).filter(Boolean))];
  if (!clean.length) return "-";
  const visible = clean.slice(0, 2);
  return `${visible.map(name => `<span title="${h(name)}">${h(name)}</span>`).join("")}${clean.length > visible.length ? `<small>+${clean.length - visible.length} daha</small>` : ""}`;
}

function renderCustomerFilteredSummary(filteredRows) {
  const box = document.getElementById("customerFilteredSummary");
  if (!box) return;
  const rows = Array.isArray(filteredRows) ? filteredRows : [];
  const filtersActive = hasAnyCustomerTableFilter();
  const customerKeys = new Set(rows.map(customerIdentityForSummary).filter(Boolean));

  if (!filtersActive || rows.length === 0 || customerKeys.size !== 1) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  const first = rows.find(row => customerIdentityForSummary(row)) || rows[0];
  const totalAmount = rows.reduce((sum, row) => sum + invoiceAmountValue(row), 0);
  const invoiceCount = invoiceCountForRows(rows);
  const channelItems = distributionSummary(rows, "channel");
  const dealerItems = distributionSummary(rows, "dealer");
  const totalChannelShare = channelItems.reduce((sum, item) => sum + Number(item.shareTotal || 0), 0);
  const totalDealerShare = dealerItems.reduce((sum, item) => sum + Number(item.shareTotal || 0), 0);
  const monthly = buildMonthlySummary(rows);
  const monthlyTotals = monthly.reduce((acc, item) => {
    acc.invoiceCount += Number(item.invoiceCount || 0);
    acc.total += Number(item.total || 0);
    acc.channelShareTotal += Number(item.channelShareTotal || 0);
    acc.dealerShareTotal += Number(item.dealerShareTotal || 0);
    return acc;
  }, { invoiceCount: 0, total: 0, channelShareTotal: 0, dealerShareTotal: 0 });
  const periodText = monthly.length
    ? `${periodLabel(monthly[0].key)} - ${periodLabel(monthly[monthly.length - 1].key)}`
    : "Tarih bulunamadı";

  box.classList.remove("hidden");
  box.innerHTML = `<div class="customer-summary-head">
      <div>
        <h3>Seçili Müşteri Dip Toplamı</h3>
        <p class="muted">${h(rowUnvan(first) || "Müşteri adı yok")} ${rowVkn(first) ? `· VKN: ${h(rowVkn(first))}` : ""}</p>
      </div>
      <span class="search-result-count">${h(periodText)}</span>
    </div>
    <div class="customer-summary-cards">
      ${statCard("Fatura Adedi", invoiceCount.toLocaleString("tr-TR"), "Filtrelenen tek müşteri")}
      ${statCard("Fatura Toplamı", formatMoneyValue(totalAmount), "Fatura tutarı bazlı")}
      ${statCard("Kanal Payı", formatMoneyValue(totalChannelShare), "Tanımlar KP oranı")}
      ${statCard("Bayi Payı", formatMoneyValue(totalDealerShare), "Tanımlar BP oranı")}
    </div>
    <div class="customer-summary-monthly">
      <h4>Ay Ay Fatura Özeti</h4>
      <table>
        <thead><tr><th>Ay</th><th>Kanal</th><th>Bayi</th><th>Fatura Adedi</th><th>Toplam Fatura</th><th>Kanal Payı Toplamı</th><th>Bayi Payı Toplamı</th></tr></thead>
        <tbody>${monthly.map(item => `<tr>
          <td>${h(periodLabel(item.key))}</td>
          <td class="customer-summary-name-list">${monthlyNameListHtml(item.channelNames)}</td>
          <td class="customer-summary-name-list">${monthlyNameListHtml(item.dealerNames)}</td>
          <td class="num">${h(item.invoiceCount.toLocaleString("tr-TR"))}</td>
          <td class="num">${h(formatMoneyValue(item.total))}</td>
          <td class="num">${h(formatMoneyValue(item.channelShareTotal))}</td>
          <td class="num">${h(formatMoneyValue(item.dealerShareTotal))}</td>
        </tr>`).join("") || `<tr><td colspan="7" class="customer-empty-cell">Ay bazlı fatura tarihi bulunamadı.</td></tr>`}</tbody>
        ${monthly.length ? `<tfoot><tr>
          <th colspan="3">Toplam</th>
          <th class="num">${h(monthlyTotals.invoiceCount.toLocaleString("tr-TR"))}</th>
          <th class="num">${h(formatMoneyValue(monthlyTotals.total))}</th>
          <th class="num">${h(formatMoneyValue(monthlyTotals.channelShareTotal))}</th>
          <th class="num">${h(formatMoneyValue(monthlyTotals.dealerShareTotal))}</th>
        </tr></tfoot>` : ""}
      </table>
    </div>`;
}



function availableCustomerPeriods() {
  const years = new Set();
  const months = new Set();
  (customerState.allRows || []).forEach(row => {
    const parts = periodPartsFromRow(row);
    if (parts.year) years.add(parts.year);
    if (parts.month) months.add(parts.month);
  });
  return {
    years: [...years].sort((a, b) => Number(b) - Number(a)),
    months: [...months].sort((a, b) => Number(a) - Number(b))
  };
}

function selectedLabel(type) {
  const list = type === "year" ? customerState.selectedYears : customerState.selectedMonths;
  if (list === null) return type === "year" ? "Tüm yıllar" : "Tüm aylar";
  if (!Array.isArray(list) || !list.length) return type === "year" ? "Yıl seçilmedi" : "Ay seçilmedi";
  if (type === "year") return list.length === 1 ? list[0] : `${list.length} yıl seçili`;
  return list.length === 1 ? MONTH_NAMES[Number(list[0])] || list[0] : `${list.length} ay seçili`;
}

function renderCustomerSearchFieldOptions() {
  const select = document.getElementById("customerAllSearchField");
  if (!select) return;
  const searchableColumns = searchableCustomerColumns();
  const draftField = customerState.searchDraftField || customerState.searchField || "__all";
  const current = searchableColumns.some(col => col.field === draftField) ? draftField : "__all";
  customerState.searchDraftField = current;
  const applied = customerState.searchField || "__all";
  customerState.searchField = searchableColumns.some(col => col.field === applied) ? applied : "__all";
  const html = [`<option value="__all">Tümü</option>`]
    .concat(searchableColumns.map(col => `<option value="${h(col.field)}">${h(col.label)}</option>`))
    .join("");
  if (select.dataset.renderedOptions !== html) {
    select.innerHTML = html;
    select.dataset.renderedOptions = html;
  }
  select.value = current;
}

function customerPeriodOptionHtml(type) {
  const periods = availableCustomerPeriods();
  const options = type === "year" ? periods.years : periods.months;
  const selected = type === "year" ? customerState.selectedYears : customerState.selectedMonths;
  const selectedList = Array.isArray(selected) ? selected : [];
  const isAllMode = selected === null;
  const allChecked = isAllMode || (!!options.length && selectedList.length === options.length);
  const allText = type === "year" ? "Tüm yıllar" : "Tüm aylar";
  const optionHtml = options.map(value => {
    const label = type === "year" ? value : (MONTH_NAMES[Number(value)] || value);
    const checked = isAllMode || selectedList.includes(String(value));
    return `<label class="customer-filter-option"><input type="checkbox" data-customer-period-option="${h(type)}" value="${h(String(value))}" ${checked ? "checked" : ""}> <span>${h(label)}</span></label>`;
  }).join("") || `<div class="customer-filter-option is-empty">Kayıtlı ${type === "year" ? "yıl" : "ay"} yok</div>`;
  return `<label class="customer-filter-option is-all"><input type="checkbox" data-customer-period-all="${h(type)}" ${allChecked ? "checked" : ""}> <span>${h(allText)}</span></label>${optionHtml}`;
}

function customerPeriodDropdown(type) {
  return document.getElementById(type === "year" ? "customerAllYearDropdown" : "customerAllMonthDropdown");
}

function customerPeriodFloatingMenu() {
  return document.getElementById("customerPeriodFloatingMenu");
}

function closeCustomerPeriodFloatingMenu() {
  customerPeriodFloatingMenu()?.remove();
  ["year", "month"].forEach(type => {
    const dropdown = customerPeriodDropdown(type);
    dropdown?.classList.remove("is-open");
    dropdown?.querySelector(".customer-filter-dropdown-toggle")?.setAttribute("aria-expanded", "false");
  });
}

function positionCustomerPeriodFloatingMenu(type) {
  const menu = customerPeriodFloatingMenu();
  const dropdown = customerPeriodDropdown(type);
  const button = dropdown?.querySelector?.(".customer-filter-dropdown-toggle");
  if (!menu || !button) return;

  const rect = button.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
  const margin = 8;

  menu.style.visibility = "hidden";
  menu.style.display = "flex";
  const width = Math.min(Math.max(rect.width || 180, 210), viewportWidth - (margin * 2));
  const height = Math.min(menu.scrollHeight || menu.offsetHeight || 260, 280);

  let left = rect.left;
  left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

  const top = Math.min(rect.bottom + 6, viewportHeight - margin);
  const availableBelow = Math.max(140, viewportHeight - top - margin);

  menu.style.width = `${Math.round(width)}px`;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.maxHeight = `${Math.min(260, availableBelow)}px`;
  menu.style.visibility = "visible";
}

function openCustomerPeriodFloatingMenu(type) {
  if (!type) return;
  closeCustomerFilterPopover();
  closeCustomerPeriodFloatingMenu();

  const dropdown = customerPeriodDropdown(type);
  const button = dropdown?.querySelector?.(".customer-filter-dropdown-toggle");
  if (!dropdown || !button) return;

  dropdown.classList.add("is-open");
  button.setAttribute("aria-expanded", "true");

  const menu = document.createElement("div");
  menu.id = "customerPeriodFloatingMenu";
  menu.className = "customer-period-floating-menu";
  menu.dataset.customerPeriodMenu = type;
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", type === "year" ? "Müşteri Yönetimi yıl seçimi" : "Müşteri Yönetimi ay seçimi");
  menu.innerHTML = customerPeriodOptionHtml(type);
  document.body.appendChild(menu);
  positionCustomerPeriodFloatingMenu(type);
}

function renderCustomerPeriodDropdown(type) {
  const dropdown = customerPeriodDropdown(type);
  if (!dropdown) return;
  const isOpen = customerState.openToolbarDropdown === type;
  const text = dropdown.querySelector(".customer-filter-dropdown-text");
  const menu = dropdown.querySelector(".customer-filter-menu");
  const button = dropdown.querySelector(".customer-filter-dropdown-toggle");
  if (text) text.textContent = selectedLabel(type);
  dropdown.classList.toggle("is-open", isOpen);
  button?.setAttribute("aria-expanded", isOpen ? "true" : "false");

  // Menü artık panel içinde değil, body üzerinde floating olarak açılıyor.
  // İç menüyü boş ve gizli tutuyoruz; böylece toolbar/panel overflow'u seçenekleri kesmiyor.
  if (menu) {
    menu.innerHTML = "";
    menu.hidden = true;
  }
}

function syncCustomerPeriodFloatingMenu() {
  const type = customerState.openToolbarDropdown;
  if (!type) {
    closeCustomerPeriodFloatingMenu();
    return;
  }
  const menu = customerPeriodFloatingMenu();
  if (!menu || menu.dataset.customerPeriodMenu !== type) {
    openCustomerPeriodFloatingMenu(type);
  } else {
    menu.innerHTML = customerPeriodOptionHtml(type);
    positionCustomerPeriodFloatingMenu(type);
  }
}

function renderCustomerToolbarControls() {
  renderCustomerSearchFieldOptions();
  const searchInput = document.getElementById("customerAllSearchInput");
  const draftText = customerState.searchDraftText ?? customerState.searchText ?? "";
  if (searchInput && searchInput.value !== draftText) searchInput.value = draftText;
  renderCustomerPeriodDropdown("year");
  renderCustomerPeriodDropdown("month");
  syncCustomerPeriodFloatingMenu();
}

function setCustomerPeriodSelection(type, values) {
  const periods = availableCustomerPeriods();
  const allValues = type === "year" ? periods.years : periods.months;
  let normalized = [];
  if (values === null || values === "__all") {
    normalized = null;
  } else {
    const clean = [...new Set((values || []).map(value => String(value)).filter(Boolean))]
      .filter(value => allValues.includes(value));
    normalized = clean.length === allValues.length && allValues.length > 0 ? null : clean;
  }
  if (type === "year") customerState.selectedYears = normalized;
  else customerState.selectedMonths = normalized;
}

function clearCustomerToolbarDropdowns() {
  customerState.openToolbarDropdown = "";
  closeCustomerPeriodFloatingMenu();
  renderCustomerPeriodDropdown("year");
  renderCustomerPeriodDropdown("month");
}

function syncCustomerSearchDraftFromDom() {
  const field = document.getElementById("customerAllSearchField");
  const input = document.getElementById("customerAllSearchInput");
  if (field) customerState.searchDraftField = field.value || "__all";
  if (input) customerState.searchDraftText = input.value || "";
}

function customerFilterFloatingPopover() {
  return document.getElementById("customerFilterFloatingPopover");
}

function positionCustomerFilterPopover() {
  const popover = customerFilterFloatingPopover();
  const field = customerState.openFilterField;
  if (!popover || !field) return;

  const table = document.getElementById("customerAllTable");
  const button = table?.querySelector?.(`[data-customer-filter-toggle="${CSS.escape(field)}"]`);
  if (!button) {
    popover.remove();
    return;
  }

  const rect = button.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
  const margin = 8;

  popover.style.visibility = "hidden";
  popover.style.display = "block";
  const width = Math.min(Math.max(popover.offsetWidth || 220, 200), viewportWidth - (margin * 2));
  const height = popover.offsetHeight || 70;

  let left = rect.right - width;
  left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

  let top = rect.bottom + margin;
  if (top + height > viewportHeight - margin) {
    top = Math.max(margin, rect.top - height - margin);
  }

  popover.style.width = `${width}px`;
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
  popover.style.visibility = "visible";
}

function closeCustomerFilterPopover() {
  const table = document.getElementById("customerAllTable");
  customerFilterFloatingPopover()?.remove();
  if (!table) return;
  table.querySelectorAll(".customer-filter-popover").forEach(popover => popover.remove());
  table.querySelectorAll("th.is-filter-open").forEach(th => th.classList.remove("is-filter-open"));
  table.querySelectorAll(".customer-filter-toggle.is-open").forEach(btn => {
    btn.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
  });
}

function openCustomerFilterPopover(field) {
  const table = document.getElementById("customerAllTable");
  if (!table) return;
  const col = columnByField(field);
  if (col.filterable === false) return;
  const button = table.querySelector(`[data-customer-filter-toggle="${CSS.escape(field)}"]`);
  const th = button?.closest?.("th");
  if (!button || !th) return;

  closeCustomerFilterPopover();
  customerState.openFilterField = field;
  th.classList.add("is-filter-open");
  button.classList.add("is-open");
  button.setAttribute("aria-expanded", "true");

  const popover = document.createElement("div");
  popover.id = "customerFilterFloatingPopover";
  popover.className = "customer-filter-popover customer-filter-floating-popover";
  popover.dataset.customerFilterPopover = field;
  popover.innerHTML = filterHtml(col);
  document.body.appendChild(popover);
  positionCustomerFilterPopover();

  const input = popover.querySelector("input");
  input?.focus?.({ preventScroll: true });
  try { input?.select?.(); } catch {}
}

function toggleCustomerFilterPopover(field) {
  if (!field) return;
  if (customerState.openFilterField === field) {
    customerState.openFilterField = "";
    closeCustomerFilterPopover();
    return;
  }
  openCustomerFilterPopover(field);
}

function scheduleCustomerTableRender() {
  if (customerState.renderTimer) window.clearTimeout(customerState.renderTimer);
  customerState.renderTimer = window.setTimeout(() => {
    customerState.renderTimer = null;
    renderCustomerAllTable();
  }, 120);
}

function resetCustomerTablePage() {
  customerState.currentPage = 1;
}

function clampCustomerTablePage(totalRows) {
  const pageSize = Number(customerState.pageSize || 1000);
  const totalPages = Math.max(1, Math.ceil(Number(totalRows || 0) / pageSize));
  const current = Number(customerState.currentPage || 1);
  customerState.currentPage = Math.min(Math.max(1, current), totalPages);
  return { pageSize, totalPages, currentPage: customerState.currentPage };
}

function customerPagerHtml(totalRows, startIndex, endIndex, totalPages, currentPage) {
  if (!Number(totalRows || 0)) return "";
  const pageSize = Number(customerState.pageSize || 1000);
  const showingText = `${(startIndex + 1).toLocaleString("tr-TR")}-${endIndex.toLocaleString("tr-TR")} gösteriliyor`;
  const totalText = `${Number(totalRows || 0).toLocaleString("tr-TR")} filtrelenmiş kayıt`;
  if (totalRows <= pageSize) {
    return `<div class="customer-all-pager"><span>${h(showingText)} · ${h(totalText)}</span></div>`;
  }
  return `<div class="customer-all-pager">
    <button class="btn btn-soft customer-page-btn" type="button" data-customer-page="prev" ${currentPage <= 1 ? "disabled" : ""}>Önceki 1000</button>
    <span>Sayfa ${h(currentPage.toLocaleString("tr-TR"))} / ${h(totalPages.toLocaleString("tr-TR"))} · ${h(showingText)} · ${h(totalText)}</span>
    <button class="btn btn-soft customer-page-btn" type="button" data-customer-page="next" ${currentPage >= totalPages ? "disabled" : ""}>Sonraki 1000</button>
  </div>`;
}

function renderCustomerAllTable() {
  const box = document.getElementById("customerAllTable");
  const count = document.getElementById("customerAllCount");
  if (!box) return;

  renderCustomerToolbarControls();

  if (!customerState.allRows.length) {
    if (count) count.textContent = "0 satır";
    box.innerHTML = `<div class="customer-empty">Müşteri Yönetimi açılınca SQL'deki tüm kayıtlar burada listelenecek.</div>`;
    renderCustomerFilteredSummary([]);
    return;
  }

  const activeInfo = captureActiveFilter();
  const filtered = sortedCustomerTableRows(applyCustomerTableFilters(customerState.allRows));
  renderCustomerFilteredSummary(filtered);

  const { pageSize, totalPages, currentPage } = clampCustomerTablePage(filtered.length);
  const startIndex = filtered.length ? (currentPage - 1) * pageSize : 0;
  const endIndex = filtered.length ? Math.min(startIndex + pageSize, filtered.length) : 0;
  const visibleRows = filtered.slice(startIndex, endIndex);

  if (count) {
    const baseText = filtered.length === customerState.allRows.length
      ? `${filtered.length.toLocaleString("tr-TR")} satır`
      : `${filtered.length.toLocaleString("tr-TR")} / ${customerState.allRows.length.toLocaleString("tr-TR")} satır`;
    count.textContent = filtered.length > pageSize
      ? `${baseText} · ekranda ${visibleRows.length.toLocaleString("tr-TR")}`
      : baseText;
  }

  const sort = customerState.tableSort;
  const colgroup = `<colgroup>${customerTableColumns.map(col => `<col style="width:${Number(col.width || 120)}px">`).join("")}</colgroup>`;
  const header = customerTableColumns.map(col => {
    const canSort = col.sortable !== false;
    const active = canSort && sort.field === col.field;
    const icon = active ? (sort.direction === "asc" ? "↑" : "↓") : "↕";
    const canFilter = col.filterable !== false;
    const filterOpen = canFilter && customerState.openFilterField === col.field;
    const filterActive = canFilter && columnHasActiveFilter(col);
    return `<th class="${col.field === "sira" ? "customer-sira-th" : ""} ${filterOpen ? "is-filter-open" : ""} ${filterActive ? "has-active-filter" : ""}" style="width:${Number(col.width || 120)}px;max-width:${Number(col.width || 120)}px;">
      <div class="customer-th-head">
        ${canSort
          ? `<button class="customer-sort-btn ${active ? "is-active" : ""}" type="button" data-customer-sort="${h(col.field)}" title="Sırala">${h(col.label)} <span>${h(icon)}</span></button>`
          : `<span class="customer-sort-label">${h(col.label)}</span>`}
        ${canFilter ? `<button class="customer-filter-toggle ${filterOpen ? "is-open" : ""} ${filterActive ? "is-active" : ""}" type="button" data-customer-filter-toggle="${h(col.field)}" aria-label="${h(col.label)} filtresini aç/kapat" aria-expanded="${filterOpen ? "true" : "false"}">⌕</button>` : ""}
      </div>
    </th>`;
  }).join("");

  const body = visibleRows.map((row, rowIndex) => `<tr>${customerTableColumns.map(col => {
    const value = displayColumnValue(row, col, startIndex + rowIndex);
    const cls = col.field === "sira" ? "customer-row-index" : col.type === "number" ? "num" : col.field === "unvan" ? "customer-title" : "customer-nowrap";
    return `<td class="${cls}" title="${h(value)}">${h(value)}</td>`;
  }).join("")}</tr>`).join("");
  const pager = customerPagerHtml(filtered.length, startIndex, endIndex, totalPages, currentPage);

  box.innerHTML = `<div class="customer-all-scroll"><table class="customer-all-table">${colgroup}<thead><tr>${header}</tr></thead><tbody>${body || `<tr><td colspan="${customerTableColumns.length}" class="customer-empty-cell">Filtreye uygun kayıt bulunamadı.</td></tr>`}</tbody></table></div>${pager}`;

  restoreActiveFilter(activeInfo);
  if (customerState.openFilterField) positionCustomerFilterPopover();
}

function resetCustomerTableFilters() {
  customerState.tableFilters = {};
  customerState.searchField = "__all";
  customerState.searchText = "";
  customerState.searchDraftField = "__all";
  customerState.searchDraftText = "";
  customerState.selectedYears = null;
  customerState.selectedMonths = null;
  customerState.tableSort = { field: "tahsilatTarihi", direction: "desc" };
  customerState.openFilterField = "";
  customerState.openToolbarDropdown = "";
  resetCustomerTablePage();
  closeCustomerFilterPopover();
  renderCustomerAllTable();
}


function bindCustomerTableControls() {
  const searchField = document.getElementById("customerAllSearchField");
  const searchInput = document.getElementById("customerAllSearchInput");
  const searchBtn = document.getElementById("customerAllSearchBtn");
  const resetBtn = document.getElementById("customerAllResetBtn");
  const refreshBtn = document.getElementById("customerAllRefreshBtn");
  const table = document.getElementById("customerAllTable");

  const applySearch = () => {
    syncCustomerSearchDraftFromDom();
    customerState.searchField = customerState.searchDraftField || "__all";
    customerState.searchText = customerState.searchDraftText || "";
    customerState.openFilterField = "";
    resetCustomerTablePage();
    closeCustomerFilterPopover();
    renderCustomerAllTable();
  };

  searchBtn?.addEventListener("click", applySearch);
  searchInput?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      applySearch();
    }
  });
  searchField?.addEventListener("change", () => {
    customerState.searchDraftField = searchField.value || "__all";
  });
  searchInput?.addEventListener("input", () => {
    customerState.searchDraftText = searchInput.value || "";
  });

  resetBtn?.addEventListener("click", resetCustomerTableFilters);
  refreshBtn?.addEventListener("click", () => ensureRowsLoaded(true));

  document.getElementById("customerAllYearDropdown")?.addEventListener("click", event => {
    const toggle = event.target?.closest?.(".customer-filter-dropdown-toggle");
    if (toggle) {
      syncCustomerSearchDraftFromDom();
      customerState.openToolbarDropdown = customerState.openToolbarDropdown === "year" ? "" : "year";
      renderCustomerToolbarControls();
    }
  });
  document.getElementById("customerAllMonthDropdown")?.addEventListener("click", event => {
    const toggle = event.target?.closest?.(".customer-filter-dropdown-toggle");
    if (toggle) {
      syncCustomerSearchDraftFromDom();
      customerState.openToolbarDropdown = customerState.openToolbarDropdown === "month" ? "" : "month";
      renderCustomerToolbarControls();
    }
  });
  document.addEventListener("click", event => {
    if (event.target?.closest?.("#customerAllYearDropdown, #customerAllMonthDropdown, .customer-period-floating-menu")) return;
    if (customerState.openToolbarDropdown) clearCustomerToolbarDropdowns();
  });

  document.addEventListener("click", event => {
    const insideFilter = event.target?.closest?.(".customer-filter-floating-popover, #customerAllTable .customer-filter-popover, #customerAllTable [data-customer-filter-toggle]");
    if (insideFilter) return;
    if (customerState.openFilterField) {
      customerState.openFilterField = "";
      closeCustomerFilterPopover();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (customerState.openFilterField) {
      customerState.openFilterField = "";
      closeCustomerFilterPopover();
    }
    if (customerState.openToolbarDropdown) clearCustomerToolbarDropdowns();
  });

  window.addEventListener("resize", () => {
    if (customerState.openFilterField) positionCustomerFilterPopover();
    if (customerState.openToolbarDropdown) positionCustomerPeriodFloatingMenu(customerState.openToolbarDropdown);
  });

  document.addEventListener("scroll", () => {
    if (customerState.openFilterField) positionCustomerFilterPopover();
    if (customerState.openToolbarDropdown) positionCustomerPeriodFloatingMenu(customerState.openToolbarDropdown);
  }, true);

  document.addEventListener("change", event => {
    const target = event.target;
    if (!target?.matches?.("input[type='checkbox']")) return;

    const allType = target.dataset.customerPeriodAll;
    const optionType = target.dataset.customerPeriodOption;
    const type = allType || optionType;
    if (type !== "year" && type !== "month") return;

    const scope = target.closest?.(".customer-period-floating-menu") || customerPeriodDropdown(type);
    if (allType) {
      setCustomerPeriodSelection(type, target.checked ? "__all" : []);
    } else {
      const selected = [...(scope?.querySelectorAll?.(`[data-customer-period-option='${type}']:checked`) || [])].map(input => input.value);
      setCustomerPeriodSelection(type, selected);
    }

    syncCustomerSearchDraftFromDom();
    customerState.openToolbarDropdown = type;
    resetCustomerTablePage();
    renderCustomerAllTable();
  });

  document.addEventListener("input", event => {
    const key = event.target?.dataset?.customerFilterKey;
    if (!key) return;
    if (!event.target.closest?.(".customer-filter-floating-popover, #customerAllTable")) return;
    customerState.tableFilters[key] = event.target.value;
    const colField = key.replace(/(From|To|Min|Max)$/u, "");
    customerState.openFilterField = columnByField(colField).field || customerState.openFilterField;
    resetCustomerTablePage();
    scheduleCustomerTableRender();
  });

  table?.addEventListener("click", event => {
    const pageBtn = event.target?.closest?.("[data-customer-page]");
    if (pageBtn) {
      const action = pageBtn.dataset.customerPage;
      if (action === "prev") customerState.currentPage = Math.max(1, Number(customerState.currentPage || 1) - 1);
      if (action === "next") customerState.currentPage = Number(customerState.currentPage || 1) + 1;
      customerState.openFilterField = "";
      closeCustomerFilterPopover();
      renderCustomerAllTable();
      return;
    }

    const filterBtn = event.target?.closest?.("[data-customer-filter-toggle]");
    if (filterBtn) {
      const field = filterBtn.dataset.customerFilterToggle || "";
      clearCustomerToolbarDropdowns();
      toggleCustomerFilterPopover(field);
      return;
    }

    const btn = event.target?.closest?.("[data-customer-sort]");
    if (!btn) return;
    const field = btn.dataset.customerSort;
    const sortCol = columnByField(field);
    if (sortCol.sortable === false) return;
    const current = customerState.tableSort;
    customerState.tableSort = {
      field,
      direction: current.field === field && current.direction === "desc" ? "asc" : "desc"
    };
    customerState.openFilterField = "";
    resetCustomerTablePage();
    closeCustomerFilterPopover();
    renderCustomerAllTable();
  });
}

function groupRows(rows) {
  const groups = new Map();
  rows.forEach(row => {
    const key = groupKey(row);
    if (!key || key.endsWith("UNVAN:")) return;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        vkn: rowVkn(row),
        unvan: rowUnvan(row),
        rows: []
      });
    }
    const group = groups.get(key);
    if (!group.vkn && rowVkn(row)) group.vkn = rowVkn(row);
    if (!group.unvan && rowUnvan(row)) group.unvan = rowUnvan(row);
    group.rows.push(row);
  });
  return [...groups.values()];
}

function calculateLossRows() {
  const range = readSelectedPeriodRange();
  const groups = groupRows(customerState.rows);
  const output = [];

  groups.forEach(group => {
    const sorted = [...group.rows].sort((a, b) => (a.__tahsilatDate || rowDate(a)) - (b.__tahsilatDate || rowDate(b)));
    const selectedRows = sorted.filter(row => {
      const key = rowPeriod(row);
      return key >= range.startKey && key <= range.endKey;
    });
    if (!selectedRows.length) return;

    const hasAnyAfterSelectedRange = sorted.some(row => rowPeriod(row) > range.endKey);
    if (hasAnyAfterSelectedRange) return;

    const lastDate = sorted.reduce((latest, row) => {
      const d = row.__tahsilatDate || rowDate(row);
      return d && (!latest || d > latest) ? d : latest;
    }, null);

    selectedRows.forEach((row, index) => {
      output.push({
        key: `${group.key}|${row.id || index}|${index}`,
        groupKey: group.key,
        group,
        row,
        rowIndex: index,
        lastDate
      });
    });
  });

  output.sort((a, b) => {
    const dateDiff = (b.lastDate || 0) - (a.lastDate || 0);
    if (dateDiff) return dateDiff;
    const labelA = `${rowUnvan(a.row)} ${rowVkn(a.row)} ${rowChannel(a.row)} ${rowDealer(a.row)}`;
    const labelB = `${rowUnvan(b.row)} ${rowVkn(b.row)} ${rowChannel(b.row)} ${rowDealer(b.row)}`;
    return labelA.localeCompare(labelB, "tr-TR");
  });

  customerState.lossRows = output;
  return output;
}

function filteredLossRows() {
  const search = normalizeText(document.getElementById("customerLossSearch")?.value || "");
  const channel = normalizeText(document.getElementById("customerLossChannel")?.value || "");
  const dealer = normalizeText(document.getElementById("customerLossDealer")?.value || "");

  return customerState.lossRows.filter(item => {
    const row = item.row;
    if (search && !`${normalizeText(rowVkn(row))} ${normalizeText(rowUnvan(row))}`.includes(search)) return false;
    if (channel && !normalizeText(rowChannel(row)).includes(channel)) return false;
    if (dealer && !normalizeText(rowDealer(row)).includes(dealer)) return false;
    return true;
  });
}

function statCard(label, value, hint = "") {
  return `<div class="stat-card customer-stat-card"><span>${h(label)}</span><strong>${h(value)}</strong>${hint ? `<em>${h(hint)}</em>` : ""}</div>`;
}

function renderStats(rows) {
  const box = document.getElementById("customerLossStats");
  if (!box) return;
  const uniqueCustomers = new Set(rows.map(item => item.groupKey)).size;
  const range = readSelectedPeriodRange();
  const latest = customerState.latestDataDate;
  box.innerHTML = [
    statCard("Kayıp Müşteri", uniqueCustomers.toLocaleString("tr-TR"), "Müşteri bazında"),
    statCard("Listelenen Satır", rows.length.toLocaleString("tr-TR"), "Seçili aralıktaki gerçek satırlar"),
    statCard("Seçili Aralık", `${periodLabel(range.startKey)} - ${periodLabel(range.endKey)}`),
    statCard("Son Kayıtlı Tarih", latest ? formatDateValue(latest) : "-")
  ].join("");
}

function formatRawAmount(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return String(value);
}

function renderLossTable() {
  const box = document.getElementById("customerLossTable");
  const count = document.getElementById("customerLossCount");
  if (!box) return;
  const rows = filteredLossRows();
  renderStats(rows);
  if (count) count.textContent = `${rows.length.toLocaleString("tr-TR")} satır`;
  document.getElementById("customerLossDetail")?.classList.add("hidden");

  if (!rows.length) {
    box.innerHTML = `<div class="customer-empty">Seçilen yıl-ay aralığında olup bu aralıktan sonra hiçbir kaydı olmayan müşteri satırı bulunamadı.</div>`;
    return;
  }

  box.innerHTML = `<table><thead><tr>
    <th>Sıra</th><th>Kanal / Dağıtıcı</th><th>Bayi</th><th>VKN</th><th>Unvan</th>
    <th>Fatura No</th><th>Fatura Tarihi</th><th>Fatura Tutarı</th>
    <th>Tahsilat Durumu</th><th>Tahsilat Tarihi</th><th>Toplam Tutar</th><th>Son Tahsilat Tarihi</th>
  </tr></thead><tbody>${rows.map((item, index) => {
    const row = item.row;
    return `<tr>
      <td class="customer-nowrap">${h(rowIndexValue(row, index))}</td>
      <td class="customer-nowrap" title="${h(rowChannel(row) || "-")}">${h(rowChannel(row) || "-")}</td>
      <td class="customer-nowrap" title="${h(rowDealer(row) || "-")}">${h(rowDealer(row) || "-")}</td>
      <td class="customer-nowrap">${h(rowVkn(row) || "-")}</td>
      <td class="customer-title" title="${h(rowUnvan(row) || "-")}">${h(rowUnvan(row) || "-")}</td>
      <td class="customer-nowrap" title="${h(rowInvoiceNo(row) || "-")}">${h(rowInvoiceNo(row) || "-")}</td>
      <td>${h(formatDateValue(rowInvoiceDate(row)))}</td>
      <td class="num">${h(formatRawAmount(rowInvoiceAmount(row)))}</td>
      <td>${h(rowTahsilatStatus(row) || "-")}</td>
      <td>${h(formatDateValue(row.__tahsilatDate || rowDate(row)))}</td>
      <td class="num">${h(formatRawAmount(rowTotalAmount(row)))}</td>
      <td>${h(formatDateValue(item.lastDate))}</td>
    </tr>`;
  }).join("")}</tbody></table>`;
}

function updatePeriodHint() {
  const hint = document.getElementById("customerLossHint");
  const range = readSelectedPeriodRange();
  if (hint) {
    hint.textContent = `Kural: ${periodLabel(range.startKey)} - ${periodLabel(range.endKey)} aralığında kaydı olan; bu aralıktan sonra sitede hiçbir surette tahsilat kaydı bulunmayan müşterilerin ilgili aralıktaki yüklenen satırları aynen getirilir.`;
  }
}

async function runLoss(forceLoad = false) {
  await ensureRowsLoaded(forceLoad);
  if (!customerState.rows.length) {
    customerState.lossRows = [];
    renderLossTable();
    return;
  }
  updatePeriodHint();
  calculateLossRows();
  renderLossTable();
}

function bindControl(id, eventName, handler) {
  document.getElementById(id)?.addEventListener(eventName, handler);
}

export function setupCustomerAnalytics() {
  if (customerState.initialized) return;
  customerState.initialized = true;

  bindCustomerTableControls();
  renderCustomerAllTable();

  document.addEventListener("dikesoft:customer-analytics-open", () => {
    ensureRowsLoaded(false);
  });

  ["dikesoft:definitions-loaded", "dikesoft:definitions-saved", "dikesoft:definitions-changed"].forEach(eventName => {
    document.addEventListener(eventName, () => {
      if (customerState.allRows.length && !customerState.loading) renderCustomerAllTable();
    });
  });
}
