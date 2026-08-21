import { initAuth } from "./auth.js";
import { state } from "./state.js";
import { setupDeviceClasses, showPage, toast, setupSidebarToggle, setupMobileMoreMenu, setupMobileScrollBoundaries } from "./ui.js?v=2026.05.21-tablet-layout";
import { importPaymentFile } from "./import-excel.js";
import { setupDefinitionForms, renderDefinitions, loadDefinitionsFromSql } from "./definitions.js";
import { setupDefinitionViewController, refreshDefinitionView } from "./definitions-view.js";
import { calculateReports, findMissingDealerShareDefinitions } from "./calculator.js?v=2026.06.10-dropdown-checkbox-report-v1";
import { getPaymentRowIssues, validatePaymentRows } from "./validators.js";
import { money, dateTR } from "./format.js";
import { safeNumber, sanitizeText } from "./security.js";
import { setupReportActions } from "./reports.js?v=2026.06.10-general-report-pdf-channel-wrap-v1";
import { setupReportViewControls, showReportView } from "./reports-view.js";
import { setupSendLogs } from "./mail.js";
import { setupSettings } from "./settings.js";
import { savePeriodToCloud, loadPeriodRows, loadFaturaPeriodRows, getPeriodKey, getPeriodDistribution, getFaturaPeriodDistribution, prepareRowsForPreview, clearCurrentDraft, setDefaultPeriodInputs } from "./cloud.js";
import { setupDataManager } from "./data-manager.js";
import { setupCustomerAnalytics } from "./customer-analytics.js?v=2026.06.13-indexeddb-v18";
import { setupBayiManagement } from "./bayi-management.js?v=2026.06.13-indexeddb-v18";
import { checkForAppUpdate, setupSilentAutoUpdate } from "./updater.js";

const MOBILE_STARTUP_QUERY = "(max-width: 768px), (hover: none) and (pointer: coarse)";

const REPORT_DEFINITION_WARNING_TEXT = "Dağıtıcı bazlı bayi pay oranlarını belirleyiniz.";

function setReportDefinitionWarning(message = "") {
  const box = document.getElementById("reportDefinitionWarning");
  if (!box) return;
  const cleanMessage = String(message || "").trim();
  box.textContent = cleanMessage;
  box.classList.toggle("hidden", !cleanMessage);
}

function buildMissingDealerShareWarning(missing = []) {
  if (!Array.isArray(missing) || !missing.length) return "";
  const samples = missing
    .slice(0, 5)
    .map(item => `${item.dagitici} / ${item.bayi}`)
    .join(", ");
  const more = missing.length > 5 ? ` +${missing.length - 5} eşleşme` : "";
  return `${REPORT_DEFINITION_WARNING_TEXT} Eksik eşleşme: ${samples}${more}.`;
}


function isMobileStartupMode() {
  try {
    if (window.matchMedia && window.matchMedia(MOBILE_STARTUP_QUERY).matches) return true;
  } catch (error) {}
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(window.navigator.userAgent || "");
}

function markDikesoftSplashImageReady(splash) {
  const img = splash?.querySelector?.(".dikesoft-splash-image-element");
  if (img && img.complete && img.naturalWidth > 0) {
    img.classList.add("is-loaded");
    [document.documentElement, document.body].filter(Boolean).forEach(target => {
      target.classList.add("dikesoft-splash-ready");
    });
  }
}

function hydrateAppStartupSplash() {
  // Rota programındaki kararlı akış: app.html ikinci splash katmanı açmaz.
  // Böylece uygulama açılmadan hemen önce splash'ın alttan kesilip kapanması engellenir.
  const splash = document.getElementById("appStartupSplash");
  if (splash) {
    splash.classList.remove("is-visible", "is-hiding");
    splash.setAttribute("aria-hidden", "true");
    splash.dataset.mode = "image";
  }
  [document.documentElement, document.body].filter(Boolean).forEach(target => {
    target.classList.remove(
      "dikesoft-app-startup-active",
      "dikesoft-splash-active",
      "dikesoft-splash-image",
      "dikesoft-splash-ready",
      "dikesoft-splash-leaving"
    );
  });
  clearAppStartupSplashSession();
  return null;
}

function clearAppStartupSplashSession() {
  try {
    sessionStorage.removeItem("dikesoftStartupSplash");
    sessionStorage.removeItem("dikesoftStartupSplashAt");
  } catch {}
}

async function closeAppStartupSplash(state) {
  if (!state) return;
  if (state.fallbackTimer) window.clearTimeout(state.fallbackTimer);

  await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));

  const targets = [document.documentElement, document.body].filter(Boolean);

  if (state.splash) {
    state.splash.classList.add("is-hiding");
    state.splash.dataset.mode = "image";
  }

  targets.forEach(target => {
    target.classList.add("dikesoft-splash-leaving");
  });

  await new Promise(resolve => window.setTimeout(resolve, 360));

  if (state.splash) {
    state.splash.classList.remove("is-visible", "is-hiding");
    state.splash.setAttribute("aria-hidden", "true");
    state.splash.dataset.mode = "image";
  }

  targets.forEach(target => {
    target.classList.remove("dikesoft-app-startup-active", "dikesoft-splash-active", "dikesoft-splash-image", "dikesoft-splash-ready", "dikesoft-splash-leaving");
  });

  clearAppStartupSplashSession();
}

setupDeviceClasses();
document.documentElement.classList.remove("dikesoft-app-first-paint");
setupSidebarToggle();
setupMobileMoreMenu();
setupMobileScrollBoundaries();
setDefaultPeriodInputs();
const appStartupSplashState = hydrateAppStartupSplash();
initAuth().catch(console.warn).finally(() => closeAppStartupSplash(appStartupSplashState));

let importIssueFilterActive = false;

function syncPeriodInputs(periodKey, prefix) {
  const match = String(periodKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return;

  const [, year, month] = match;
  const yearInput = document.getElementById(`${prefix}YearInput`);

  if (yearInput) yearInput.value = year;

  if (prefix === "report") {
    const dropdown = document.getElementById("reportMonthDropdown");
    const allCheckbox = dropdown?.querySelector("[data-report-month-all]");
    const monthCheckboxes = [...(dropdown?.querySelectorAll("input[data-report-month]") || [])];
    monthCheckboxes.forEach(input => { input.checked = Number(input.value) === Number(month); });
    if (allCheckbox) allCheckbox.checked = false;
    if (dropdown) syncReportMonthState();
    return;
  }

  const monthInput = document.getElementById(`${prefix}MonthInput`);
  if (monthInput) monthInput.value = String(Number(month));
}

function isValidImportDateParts(year, month, day = 1) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;

  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function dateFromImportParts(year, month, day = 1) {
  return isValidImportDateParts(year, month, day)
    ? new Date(Number(year), Number(month) - 1, Number(day))
    : null;
}

function parseImportDate(value) {
  if (value === undefined || value === null || value === "") return null;

  if (value instanceof Date && !isNaN(value)) {
    return dateFromImportParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const serial = Math.floor(value);
    if (serial < 1) return null;

    // Excel 1900 date system. UTC kullanımı saat dilimi kaymasıyla ayın değişmesini engeller.
    const utc = Date.UTC(1899, 11, 30) + serial * 86400 * 1000;
    const date = new Date(utc);
    return dateFromImportParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = String(value).trim();
  if (!text) return null;

  // Excel seri tarihi metin olarak gelirse: 45658 veya 45658.00
  if (/^\d{5}(?:[.,]\d+)?$/.test(text)) {
    return parseImportDate(Number(text.replace(",", ".")));
  }

  // 01.02.2026, 01/02/2026, 01-02-2026, saat bilgisi varsa da kabul edilir.
  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s+.*)?$/);
  if (tr) {
    let [, day, month, year] = tr;
    if (year.length === 2) year = `20${year}`;
    return dateFromImportParts(year, month, day);
  }

  // 2026-02-01, 2026/02/01, 2026.02.01, saat bilgisi varsa da kabul edilir.
  const iso = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[T\s].*)?$/);
  if (iso) {
    const [, year, month, day] = iso;
    return dateFromImportParts(year, month, day);
  }

  // 2026-02 veya 2026/02 gibi doğrudan dönem değeri.
  const yearMonth = text.match(/^(\d{4})[./-](\d{1,2})$/);
  if (yearMonth) {
    const [, year, month] = yearMonth;
    return dateFromImportParts(year, month, 1);
  }

  // Tarayıcının new Date("01.02.2026") gibi değerleri ay/gün olarak yanlış yorumlamasını önlemek için
  // serbest JS tarih ayrıştırması özellikle kullanılmaz.
  return null;
}

function hasImportPeriodSelection() {
  const year = String(document.getElementById("importYearInput")?.value || "").trim();
  const month = String(document.getElementById("importMonthInput")?.value || "").trim();
  return Boolean(year && month);
}

function warnImportPeriodSelectionRequired() {
  toast("Lütfen önce ay ve yıl seçimi yapınız.");
  const yearInput = document.getElementById("importYearInput");
  const monthInput = document.getElementById("importMonthInput");
  if (!String(yearInput?.value || "").trim()) {
    yearInput?.focus();
  } else {
    monthInput?.focus();
  }
}

function getImportSelectedPeriodKey() {
  const year = String(document.getElementById("importYearInput")?.value || "").trim();
  const month = String(document.getElementById("importMonthInput")?.value || "").trim();

  if (!year || !month) {
    throw new Error("Lütfen önce ay ve yıl seçimi yapınız.");
  }

  return getPeriodKey(year, month);
}

function getImportRowTahsilatPeriodKey(row) {
  const raw = row?.rawData || row?.raw_data || row?.raw || {};
  const candidates = [
    row?.tahsilatTarihi,
    row?.TAHSILAT_TARIHI,
    raw?.TAHSILAT_TARIHI,
    raw?.tahsilatTarihi
  ];

  for (const value of candidates) {
    const date = parseImportDate(value);
    if (date) return getPeriodKey(date.getFullYear(), date.getMonth() + 1);
  }

  return "";
}

function getImportRowTahsilatDate(row) {
  const raw = row?.rawData || row?.raw_data || row?.raw || {};
  const candidates = [
    row?.tahsilatTarihi,
    row?.TAHSILAT_TARIHI,
    raw?.TAHSILAT_TARIHI,
    raw?.tahsilatTarihi
  ];

  for (const value of candidates) {
    const date = parseImportDate(value);
    if (date) return date;
  }

  return null;
}

function sortImportedRowsByTahsilatDate(rows = []) {
  return [...rows]
    .map((row, index) => ({ row, index, date: getImportRowTahsilatDate(row) }))
    .sort((a, b) => {
      const aTime = a.date ? a.date.getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.date ? b.date.getTime() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return a.index - b.index;
    })
    .map(item => item.row);
}

function getImportTahsilatDateRange(rows = []) {
  let first = null;
  let last = null;

  rows.forEach(row => {
    const date = getImportRowTahsilatDate(row);
    if (!date) return;
    if (!first || date.getTime() < first.getTime()) first = date;
    if (!last || date.getTime() > last.getTime()) last = date;
  });

  return { first, last };
}

function ensureImportTahsilatRangeInfo() {
  let rangeInfo = document.getElementById("importTahsilatRangeInfo");
  if (rangeInfo) return rangeInfo;

  const info = document.getElementById("importPreviewInfo");
  if (!info?.parentElement) return null;

  rangeInfo = document.createElement("div");
  rangeInfo.id = "importTahsilatRangeInfo";
  rangeInfo.className = "import-tahsilat-range hidden";
  rangeInfo.setAttribute("aria-live", "polite");
  info.insertAdjacentElement("afterend", rangeInfo);
  return rangeInfo;
}

function updateImportTahsilatRangeInfo() {
  const rangeInfo = ensureImportTahsilatRangeInfo();
  if (!rangeInfo) return;

  if (!state.importRows.length) {
    rangeInfo.classList.add("hidden");
    rangeInfo.innerHTML = "";
    return;
  }

  const range = getImportTahsilatDateRange(state.importRows);
  rangeInfo.innerHTML = `
    <span><strong>İlk Tahsilat Tarihi:</strong> ${range.first ? dateTR(range.first) : "-"}</span>
    <span><strong>Son Tahsilat Tarihi:</strong> ${range.last ? dateTR(range.last) : "-"}</span>
  `;
  rangeInfo.classList.remove("hidden");
}

function formatPeriodDistribution(distribution) {
  return Object.keys(distribution || {})
    .sort()
    .map(key => `${key} (${distribution[key]} satır)`)
    .join(", ");
}


function normalizeDistributorFilterValue(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I")
    .replace(/İ/g, "I")
    .replace(/[\s\u00A0]+/g, " ")
    .replace(/[\u2010-\u2015]/g, "-")
    .trim();
}


function escapeHtmlAttribute(value) {
  return sanitizeText(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlText(value) {
  return sanitizeText(value).replace(/&/g, "&amp;");
}

function rowDistributorName(row) {
  const raw = row?.rawData || row?.raw_data || row?.raw || {};
  return String(
    row?.dagitici ||
    row?.DAGITICI ||
    row?.kanal ||
    raw?.DAGITICI ||
    raw?.dagitici ||
    raw?.KANAL ||
    raw?.kanal ||
    ""
  ).trim();
}

function channelDefinitionName(channel) {
  return String(channel?.kanal || channel?.dagitici || channel?.DAGITICI || "").trim();
}

function uniqueDistributorNames(rows = []) {
  const names = new Map();

  (Array.isArray(state.channels) ? state.channels : []).forEach(channel => {
    const name = channelDefinitionName(channel);
    const key = normalizeDistributorFilterValue(name);
    if (name && !names.has(key)) names.set(key, name);
  });

  // Tanımlarda olmayan ama SQL verisinde gelen dağıtıcı varsa Tümü dışındaki
  // manuel raporlamada görünür kalsın. Öncelik yine Tanımlar > Kanal listesindedir.
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const name = rowDistributorName(row);
    const key = normalizeDistributorFilterValue(name);
    if (name && !names.has(key)) names.set(key, name);
  });

  return [...names.values()].sort((a, b) => a.localeCompare(b, "tr"));
}

function reportDistributorSelectionLabel(values = []) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  return list.length ? list.join(" / ") : "Tümü";
}

function normalizeReportDistributorSelection(values = []) {
  const source = Array.isArray(values)
    ? values
    : String(values || "").split(/\s+\/\s+/);
  const map = new Map();

  source.forEach(value => {
    const name = String(value || "").trim();
    const key = normalizeDistributorFilterValue(name);
    if (name && key && !map.has(key)) map.set(key, name);
  });

  return [...map.values()];
}

function updateReportDistributorButtonLabel(selected = null) {
  const dropdown = document.getElementById("reportDistributorInput");
  const label = dropdown?.querySelector(".report-distributor-toggle-text");
  if (!label) return;

  const selection = Array.isArray(selected) ? selected : getReportDistributorSelection();
  label.textContent = reportDistributorSelectionLabel(selection);
  label.title = reportDistributorSelectionLabel(selection);
}

function closeReportDistributorDropdown() {
  const dropdown = document.getElementById("reportDistributorInput");
  const toggle = document.getElementById("reportDistributorToggle");
  if (!dropdown) return;
  dropdown.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
}

function toggleReportDistributorDropdown() {
  const dropdown = document.getElementById("reportDistributorInput");
  const toggle = document.getElementById("reportDistributorToggle");
  if (!dropdown || !toggle) return;
  const nextOpen = !dropdown.classList.contains("is-open");
  dropdown.classList.toggle("is-open", nextOpen);
  toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");
}

function getReportDistributorSelection() {
  const dropdown = document.getElementById("reportDistributorInput");
  if (!dropdown) return [];

  const allCheckbox = dropdown.querySelector("[data-report-distributor-all]");
  const checked = [...dropdown.querySelectorAll("input[type='checkbox']:checked:not([data-report-distributor-all])")]
    .map(input => input.value)
    .filter(Boolean);

  if (allCheckbox?.checked || !checked.length) return [];
  return normalizeReportDistributorSelection(checked);
}

function syncReportDistributorState() {
  const selected = getReportDistributorSelection();
  state.currentReportDistributors = selected;
  state.currentReportDistributor = selected.join(" / ");
  updateReportDistributorButtonLabel(selected);
  return selected;
}

function updateReportDistributorOptions(rows = []) {
  const dropdown = document.getElementById("reportDistributorInput");
  const menu = dropdown?.querySelector("[data-report-distributor-menu]");
  if (!dropdown || !menu) return;

  const options = uniqueDistributorNames(rows);
  const previousSelection = normalizeReportDistributorSelection(
    Array.isArray(state.currentReportDistributors) && state.currentReportDistributors.length
      ? state.currentReportDistributors
      : state.currentReportDistributor
  );
  const optionKeys = new Map(options.map(name => [normalizeDistributorFilterValue(name), name]));
  const matchedSelection = previousSelection
    .map(name => optionKeys.get(normalizeDistributorFilterValue(name)))
    .filter(Boolean);
  const selectedKeys = new Set(matchedSelection.map(name => normalizeDistributorFilterValue(name)));
  const allChecked = selectedKeys.size === 0;

  const optionHtml = options.map(name => {
    const text = escapeHtmlText(name);
    const value = escapeHtmlAttribute(name);
    const key = normalizeDistributorFilterValue(name);
    const checked = selectedKeys.has(key) ? " checked" : "";
    return `<label class="report-distributor-option"><input type="checkbox" value="${value}"${checked} /><span>${text}</span></label>`;
  }).join("");

  menu.innerHTML = `
    <label class="report-distributor-option report-distributor-option-all">
      <input type="checkbox" value="" data-report-distributor-all${allChecked ? " checked" : ""} />
      <span>Tümü</span>
    </label>
    ${optionHtml}
  `;

  state.currentReportDistributors = matchedSelection;
  state.currentReportDistributor = matchedSelection.join(" / ");
  updateReportDistributorButtonLabel(matchedSelection);
}

function filterRowsByReportDistributor(rows, distributorNames) {
  const selected = normalizeReportDistributorSelection(distributorNames);
  if (!selected.length) return rows;

  const targets = new Set(selected.map(name => normalizeDistributorFilterValue(name)));
  return (Array.isArray(rows) ? rows : []).filter(row => targets.has(normalizeDistributorFilterValue(rowDistributorName(row))));
}

const REPORT_MONTH_NAMES = [
  "", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
];

function normalizeReportMonthSelection(values = []) {
  const source = Array.isArray(values) ? values : [values];
  return [...new Set(source
    .map(value => Number(value))
    .filter(month => Number.isInteger(month) && month >= 1 && month <= 12))]
    .sort((a, b) => a - b);
}

function reportMonthSelectionLabel(values = []) {
  const months = normalizeReportMonthSelection(values);
  if (months.length === 12) return "Tümü";
  if (!months.length) return "-";
  if (months.length <= 3) return months.map(month => REPORT_MONTH_NAMES[month]).join(" / ");
  return `${months.length} ay seçili`;
}

function reportPeriodSelectionLabel(year, values = []) {
  const months = normalizeReportMonthSelection(values);
  const y = String(year || "").trim();
  if (!y) return reportMonthSelectionLabel(months);
  if (months.length === 12) return `${y} / Tüm Aylar`;
  return `${y} / ${months.map(month => REPORT_MONTH_NAMES[month]).join(", ")}`;
}

function closeReportMonthDropdown() {
  const dropdown = document.getElementById("reportMonthDropdown");
  const toggle = document.getElementById("reportMonthToggle");
  if (!dropdown) return;
  dropdown.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
}

function toggleReportMonthDropdown() {
  const dropdown = document.getElementById("reportMonthDropdown");
  const toggle = document.getElementById("reportMonthToggle");
  if (!dropdown || !toggle) return;
  const nextOpen = !dropdown.classList.contains("is-open");
  closeReportDistributorDropdown();
  dropdown.classList.toggle("is-open", nextOpen);
  toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");
}

function getReportMonthSelection() {
  const dropdown = document.getElementById("reportMonthDropdown");
  if (!dropdown) return [];

  const allCheckbox = dropdown.querySelector("[data-report-month-all]");
  if (allCheckbox?.checked) return Array.from({ length: 12 }, (_, index) => index + 1);

  return normalizeReportMonthSelection(
    [...dropdown.querySelectorAll("input[data-report-month]:checked")].map(input => input.value)
  );
}

function updateReportMonthButtonLabel(values = null) {
  const dropdown = document.getElementById("reportMonthDropdown");
  const label = dropdown?.querySelector(".report-month-toggle-text");
  if (!label) return;
  const months = Array.isArray(values) ? normalizeReportMonthSelection(values) : getReportMonthSelection();
  const text = reportMonthSelectionLabel(months);
  label.textContent = text;
  label.title = months.length === 12
    ? "Tüm aylar"
    : months.map(month => REPORT_MONTH_NAMES[month]).join(" / ");
}

function syncReportMonthState() {
  const months = getReportMonthSelection();
  state.currentReportMonths = months;
  updateReportMonthButtonLabel(months);
  return months;
}

function initializeReportMonthSelection() {
  const dropdown = document.getElementById("reportMonthDropdown");
  if (!dropdown) return;

  const currentMonth = new Date().getMonth() + 1;
  const allCheckbox = dropdown.querySelector("[data-report-month-all]");
  const monthCheckboxes = [...dropdown.querySelectorAll("input[data-report-month]")];
  const hasSelection = Boolean(allCheckbox?.checked || monthCheckboxes.some(input => input.checked));

  if (!hasSelection) {
    monthCheckboxes.forEach(input => { input.checked = Number(input.value) === currentMonth; });
    if (allCheckbox) allCheckbox.checked = false;
  }

  syncReportMonthState();
}

initializeReportMonthSelection();
setupSilentAutoUpdate();
window.setTimeout(() => checkForAppUpdate(), 1500);
setInterval(checkForAppUpdate, 10 * 60 * 1000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.warn);
}

function refreshReportDistributorOptions() {
  const baseRows = Array.isArray(state.reportRows) && state.reportRows.length
    ? state.reportRows
    : Array.isArray(state.rows)
      ? state.rows
      : [];
  updateReportDistributorOptions(baseRows);
}

document.querySelectorAll("[data-page]").forEach(btn => {
  btn.addEventListener("click", () => {
    showPage(btn.dataset.page);
    if (btn.dataset.page === "reports") refreshReportDistributorOptions();
    if (btn.dataset.page === "customerAnalytics") {
      document.dispatchEvent(new CustomEvent("dikesoft:customer-analytics-open"));
    }
    if (btn.dataset.page === "bayiManagement") {
      document.dispatchEvent(new CustomEvent("dikesoft:bayi-management-open"));
    }
  });
});
document.querySelectorAll("[data-go]").forEach(btn => {
  btn.addEventListener("click", () => showPage(btn.dataset.go));
});

document.getElementById("reportDistributorToggle")?.addEventListener("click", event => {
  event.preventDefault();
  event.stopPropagation();
  closeReportMonthDropdown();
  toggleReportDistributorDropdown();
});

document.getElementById("reportDistributorInput")?.addEventListener("click", event => {
  event.stopPropagation();
});

document.getElementById("reportMonthToggle")?.addEventListener("click", event => {
  event.preventDefault();
  event.stopPropagation();
  toggleReportMonthDropdown();
});

document.getElementById("reportMonthDropdown")?.addEventListener("click", event => {
  event.stopPropagation();
});

document.getElementById("reportMonthDropdown")?.addEventListener("change", event => {
  const target = event.target;
  if (!target?.matches?.("input[type='checkbox']")) return;

  const dropdown = document.getElementById("reportMonthDropdown");
  const allCheckbox = dropdown?.querySelector("[data-report-month-all]");
  const monthCheckboxes = [...(dropdown?.querySelectorAll("input[data-report-month]") || [])];

  if (target.hasAttribute("data-report-month-all")) {
    if (target.checked) monthCheckboxes.forEach(input => { input.checked = false; });
    else if (!monthCheckboxes.some(input => input.checked)) target.checked = true;
  } else {
    if (target.checked && allCheckbox) allCheckbox.checked = false;
    if (!monthCheckboxes.some(input => input.checked) && allCheckbox) allCheckbox.checked = true;
  }

  syncReportMonthState();
  setReportDefinitionWarning("");
});

document.addEventListener("click", () => {
  closeReportDistributorDropdown();
  closeReportMonthDropdown();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeReportDistributorDropdown();
    closeReportMonthDropdown();
  }
});

document.getElementById("reportDistributorInput")?.addEventListener("change", event => {
  const target = event.target;
  if (!target?.matches?.("input[type='checkbox']")) return;

  const dropdown = document.getElementById("reportDistributorInput");
  const allCheckbox = dropdown?.querySelector("[data-report-distributor-all]");
  const itemCheckboxes = [...(dropdown?.querySelectorAll("input[type='checkbox']:not([data-report-distributor-all])") || [])];

  if (target.hasAttribute("data-report-distributor-all")) {
    if (target.checked) itemCheckboxes.forEach(input => { input.checked = false; });
  } else {
    if (target.checked && allCheckbox) allCheckbox.checked = false;
    if (!itemCheckboxes.some(input => input.checked) && allCheckbox) allCheckbox.checked = true;
  }

  syncReportDistributorState();
  setReportDefinitionWarning("");
});

document.addEventListener("dikesoft:definitions-imported", refreshReportDistributorOptions);
document.addEventListener("dikesoft:definitions-loaded", refreshReportDistributorOptions);
document.addEventListener("dikesoft:definitions-saved", refreshReportDistributorOptions);
document.addEventListener("dikesoft:definitions-changed", refreshReportDistributorOptions);





const importEditableFields = [
  ["vkn", "VKN"],
  ["unvan", "UNVAN"],
  ["dagitici", "DAGITICI"],
  ["bayi", "BAYI"],
  ["faturaNo", "FATURA_NO"],
  ["faturaTarihi", "FATURA_TARIHI"],
  ["faturaTutari", "FATURA_TUTARI"],
  ["tahsilatDurumu", "TAHSILAT_DURUMU"],
  ["tahsilatTarihi", "TAHSILAT_TARIHI"],
  ["toplamTutar", "TOPLAM_TUTAR"]
];

let editingImportRowId = null;
let importSaveInProgress = false;
let importSaveProgressTimer = null;
let importSaveProgressRunId = 0;

function setImportSaveProgress(percent, message = "SQL veritabanına kaydediliyor…", { stateClass = "is-running" } = {}) {
  const box = document.getElementById("importSaveProgress");
  const text = document.getElementById("importSaveProgressText");
  const value = document.getElementById("importSaveProgressPercent");
  const fill = document.getElementById("importSaveProgressFill");
  if (!box || !text || !value || !fill) return;

  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  if (importSaveProgressTimer) {
    clearTimeout(importSaveProgressTimer);
    importSaveProgressTimer = null;
  }

  box.classList.remove("hidden", "is-running", "is-complete", "is-error");
  if (stateClass) box.classList.add(stateClass);
  box.setAttribute("aria-hidden", "false");
  text.textContent = message;
  value.textContent = `${safePercent}%`;
  fill.style.width = `${safePercent}%`;
}

function beginImportSaveProgress(message = "Kaydediliyor…") {
  importSaveProgressRunId += 1;
  setImportSaveProgress(3, message);
  return importSaveProgressRunId;
}

function hideImportSaveProgress(runId = importSaveProgressRunId) {
  if (runId !== importSaveProgressRunId) return;
  const box = document.getElementById("importSaveProgress");
  if (!box) return;
  box.classList.add("hidden");
  box.classList.remove("is-running", "is-complete", "is-error");
  box.setAttribute("aria-hidden", "true");
}

function finishImportSaveProgress(message = "Kaydedildi", runId = importSaveProgressRunId) {
  if (runId !== importSaveProgressRunId) return Promise.resolve();
  setImportSaveProgress(100, message, { stateClass: "is-complete" });
  return new Promise(resolve => {
    importSaveProgressTimer = setTimeout(() => {
      hideImportSaveProgress(runId);
      resolve();
    }, 850);
  });
}

function failImportSaveProgress(message = "Kaydetme tamamlanamadı", runId = importSaveProgressRunId) {
  if (runId !== importSaveProgressRunId) return;
  setImportSaveProgress(100, message, { stateClass: "is-error" });
}

function handleImportSaveProgress({ percent } = {}) {
  const safePercent = Number.isFinite(Number(percent)) ? Number(percent) : 10;
  setImportSaveProgress(Math.max(6, safePercent), "Kaydediliyor…");
}

function normalizeImportedRowPatch(raw) {
  return {
    vkn: String(raw.vkn || "").trim(),
    unvan: sanitizeText(raw.unvan || ""),
    dagitici: sanitizeText(raw.dagitici || ""),
    bayi: sanitizeText(raw.bayi || ""),
    faturaNo: String(raw.faturaNo || "").trim(),
    faturaTarihi: String(raw.faturaTarihi || "").trim(),
    faturaTutari: safeNumber(raw.faturaTutari),
    tahsilatDurumu: sanitizeText(raw.tahsilatDurumu || ""),
    tahsilatTarihi: String(raw.tahsilatTarihi || "").trim(),
    toplamTutar: safeNumber(raw.toplamTutar)
  };
}

function appendImportTextCell(tr, text, className = "") {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text ?? "";
  tr.appendChild(td);
}

function createImportSelectCell(row) {
  const td = document.createElement("td");
  td.className = "col-select";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = row.id ? state.importSelectedRowIds.has(row.id) : false;
  cb.addEventListener("change", () => {
    if (!row.id) return;
    cb.checked ? state.importSelectedRowIds.add(row.id) : state.importSelectedRowIds.delete(row.id);
    renderImportPreviewTable();
  });
  td.appendChild(cb);
  return td;
}

function createImportDisplayRow(row, index) {
  const tr = document.createElement("tr");
  const issues = row.rowIssues || getPaymentRowIssues(row);
  if (issues.length) { tr.classList.add("has-error"); tr.title = issues.join(", "); }

  tr.appendChild(createImportSelectCell(row));
  appendImportTextCell(tr, String(index + 1), "col-index");
  appendImportTextCell(tr, row.vkn || "");
  appendImportTextCell(tr, row.unvan || "", "col-wide");
  appendImportTextCell(tr, row.dagitici || "");
  appendImportTextCell(tr, row.bayi || "");
  appendImportTextCell(tr, row.faturaNo || "");
  appendImportTextCell(tr, dateTR(row.faturaTarihi));
  appendImportTextCell(tr, money(row.faturaTutari), "col-money");
  appendImportTextCell(tr, row.tahsilatDurumu || "");
  appendImportTextCell(tr, dateTR(row.tahsilatTarihi));
  appendImportTextCell(tr, money(row.toplamTutar || row.tutar), "col-money");
  appendImportTextCell(tr, issues.length ? issues.join(", ") : "Sorunsuz", issues.length ? "col-issue issue-text" : "col-issue ok-text");

  return tr;
}

function createImportEditingRow(row, index) {
  const tr = document.createElement("tr");
  tr.className = "is-editing";
  tr.appendChild(createImportSelectCell(row));
  appendImportTextCell(tr, String(index + 1), "col-index");

  importEditableFields.forEach(([key, label]) => {
    const td = document.createElement("td");
    if (label === "UNVAN") td.className = "col-wide";
    if (label.includes("TUTAR")) td.className = "col-money";
    const input = document.createElement("input");
    input.dataset.field = key;
    input.value = key.includes("Tarihi") ? dateTR(row[key]) : (row[key] ?? "");
    input.type = label.includes("TUTAR") ? "number" : "text";
    if (label.includes("TUTAR")) input.step = "0.01";
    input.setAttribute("aria-label", label);
    td.appendChild(input);
    tr.appendChild(td);
  });

  appendImportTextCell(tr, "Ön izleme düzenleniyor", "col-issue issue-text");
  return tr;
}

function rowHasImportIssue(row) {
  return Boolean((row.rowIssues || getPaymentRowIssues(row)).length);
}

function getVisibleImportRows() {
  return importIssueFilterActive ? state.importRows.filter(rowHasImportIssue) : state.importRows;
}

function syncImportToolbar() {
  const selectAll = document.getElementById("selectAllImportRowsBtn");
  const filterBtn = document.getElementById("filterImportIssuesBtn");
  const editBtn = document.getElementById("editSelectedImportRowBtn");
  const deleteBtn = document.getElementById("deleteSelectedImportRowsBtn");
  const saveBtn = document.getElementById("saveImportedRowsBtn");

  const visibleRows = getVisibleImportRows();
  const ids = visibleRows.map(row => row.id).filter(Boolean);
  const selectedCount = ids.filter(id => state.importSelectedRowIds.has(id)).length;
  const issueCount = state.importRows.filter(rowHasImportIssue).length;

  if (filterBtn) {
    filterBtn.textContent = importIssueFilterActive ? "Tümü" : "Sorunlu";
    filterBtn.classList.toggle("is-active", importIssueFilterActive);
    filterBtn.disabled = state.importRows.length === 0 || (!importIssueFilterActive && issueCount === 0);
    filterBtn.title = importIssueFilterActive ? "Filtreyi kaldır ve tüm satırları göster" : "Ön Kontrol sütununda sorunlu görünen satırları filtrele";
  }
  if (selectAll) {
    selectAll.checked = ids.length > 0 && selectedCount === ids.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < ids.length;
    selectAll.disabled = importSaveInProgress || ids.length === 0;
  }
  if (editBtn) {
    editBtn.textContent = editingImportRowId ? "Uygula" : "Düzenle";
    editBtn.disabled = importSaveInProgress || (editingImportRowId ? false : state.importSelectedRowIds.size !== 1);
  }
  if (deleteBtn) deleteBtn.disabled = importSaveInProgress || state.importSelectedRowIds.size === 0;
  if (saveBtn) {
    saveBtn.disabled = importSaveInProgress || state.importRows.length === 0;
    saveBtn.textContent = importSaveInProgress ? "Kaydediliyor" : "Kaydet";
  }
}

function renderImportPreviewTable() {
  const box = document.getElementById("importPreviewTable");
  const info = document.getElementById("importPreviewInfo");
  if (!box) return;

  syncImportToolbar();
  updateImportTahsilatRangeInfo();

  if (info) {
    const selected = state.importSelectedRowIds.size;
    const issueCount = state.importRows.filter(rowHasImportIssue).length;
    const visibleCount = getVisibleImportRows().length;
    info.textContent = state.importPeriod
      ? `Dönem: ${state.importPeriod} · Satır: ${state.importRows.length}${importIssueFilterActive ? ` · Gösterilen sorunlu: ${visibleCount}` : ` · Sorunlu: ${issueCount}`}${selected ? ` · Seçili: ${selected}` : ""}. Kaydedilmeden Veri Yönetimi ve Raporlar alanına aktarılmaz.`
      : "Dosya içe aktarılınca kayıtlar burada ön kontrole alınır. Kaydedilmeden Veri Yönetimi ve Raporlar alanına aktarılmaz.";
  }

  if (!state.importRows.length) {
    box.innerHTML = `<div class="empty-state">Henüz içe aktarılan veri yok.</div>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "editor-table import-preview-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th class="col-select">Seç</th>
        <th class="col-index">Sıra</th>
        <th>VKN</th>
        <th class="col-wide">UNVAN</th>
        <th>DAGITICI</th>
        <th>BAYI</th>
        <th>FATURA_NO</th>
        <th>FATURA_TARIHI</th>
        <th class="col-money">FATURA_TUTARI</th>
        <th>TAHSILAT_DURUMU</th>
        <th>TAHSILAT_TARIHI</th>
        <th class="col-money">TOPLAM_TUTAR</th>
        <th>Ön Kontrol</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");
  const visibleRows = getVisibleImportRows();
  visibleRows.forEach((row, index) => {
    const rowIndex = state.importRows.indexOf(row);
    tbody.appendChild(row.id === editingImportRowId ? createImportEditingRow(row, rowIndex) : createImportDisplayRow(row, rowIndex));
  });
  table.appendChild(tbody);
  box.innerHTML = "";

  if (importIssueFilterActive && !visibleRows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state import-filter-empty";
    empty.textContent = "Ön kontrolde sorunlu satır bulunamadı.";
    box.appendChild(empty);
  }
  box.appendChild(table);
}

function setupImportPreviewActions() {
  document.getElementById("selectAllImportRowsBtn")?.addEventListener("change", event => {
    const visibleRows = getVisibleImportRows();
    const visibleIds = visibleRows.map(row => row.id).filter(Boolean);
    visibleIds.forEach(id => state.importSelectedRowIds.delete(id));
    if (event.target.checked) visibleIds.forEach(id => state.importSelectedRowIds.add(id));
    renderImportPreviewTable();
  });

  document.getElementById("filterImportIssuesBtn")?.addEventListener("click", () => {
    if (!state.importRows.length) return toast("Filtrelenecek satır yok.");
    const issueCount = state.importRows.filter(rowHasImportIssue).length;
    if (!importIssueFilterActive && !issueCount) return toast("Sorunlu satır yok.");
    importIssueFilterActive = !importIssueFilterActive;
    if (!importIssueFilterActive) {
      editingImportRowId = null;
    } else if (editingImportRowId) {
      const editingRow = state.importRows.find(row => row.id === editingImportRowId);
      if (!editingRow || !rowHasImportIssue(editingRow)) editingImportRowId = null;
    }
    renderImportPreviewTable();
  });

  document.getElementById("editSelectedImportRowBtn")?.addEventListener("click", () => {
    if (editingImportRowId) {
      const row = state.importRows.find(item => item.id === editingImportRowId);
      const tr = document.querySelector("#importPreviewTable tr.is-editing");
      if (!row || !tr) {
        editingImportRowId = null;
        renderImportPreviewTable();
        return;
      }
      const raw = {};
      tr.querySelectorAll("input[data-field]").forEach(input => {
        raw[input.dataset.field] = input.value;
      });
      const patch = normalizeImportedRowPatch(raw);
      // Dosya İçe Aktar ekranı yalnızca ön inceleme/taslak alanıdır.
      // Buradaki düzenleme SQL'e gitmez; SQL kaydı sadece saveImportedRowsToSql()
      // fonksiyonuna bağlı "Kaydet" butonuyla yapılır.
      Object.assign(row, patch, {
        tarih: patch.faturaTarihi,
        vknTckn: patch.vkn,
        musteri: patch.unvan,
        tutar: patch.toplamTutar > 0 ? patch.toplamTutar : patch.faturaTutari
      });
      row.rowIssues = getPaymentRowIssues(row);
      row.hasIssue = row.rowIssues.length > 0;
      state.importRows = sortImportedRowsByTahsilatDate(state.importRows);
      editingImportRowId = null;
      renderImportPreviewTable();
      toast("Ön izleme satırı güncellendi. SQL'e kaydetmek için Kaydet'e basın.");
      return;
    }

    const ids = [...state.importSelectedRowIds];
    if (!ids.length) return toast("Düzenlemek için satır seçin.");
    if (ids.length > 1) return toast("Düzenlemek için sadece bir satır seçin.");
    editingImportRowId = ids[0];
    renderImportPreviewTable();
  });

  document.getElementById("deleteSelectedImportRowsBtn")?.addEventListener("click", () => {
    const ids = [...state.importSelectedRowIds];
    if (!ids.length) return toast("Silmek için satır seçin.");
    if (!confirm(`${ids.length} içe aktarılan satır ön kontrolden çıkarılsın mı?`)) return;
    state.importRows = state.importRows.filter(row => !ids.includes(row.id));
    state.importSelectedRowIds.clear();
    if (editingImportRowId && ids.includes(editingImportRowId)) editingImportRowId = null;
    renderImportPreviewTable();
    toast("Seçili içe aktarma satırları kaldırıldı.");
  });

  document.getElementById("saveImportedRowsBtn")?.addEventListener("click", saveImportedRowsToSql);
}

async function saveImportedRowsToSql() {
  if (importSaveInProgress) return;
  if (!state.importRows.length) return toast("Kaydedilecek içe aktarma verisi yok.");
  if (!state.importPeriod) return toast("İçe aktarılan dosyada dönem bilgisi bulunamadı.");

  const issueCount = state.importRows.filter(row => (row.rowIssues || getPaymentRowIssues(row)).length).length;
  const warning = issueCount ? `

${issueCount} satırda ön kontrol uyarısı var. Yine de kaydedilsin mi?` : "";
  if (!confirm(`${state.importPeriod} dönemi için ${state.importRows.length} satır SQL veritabanına kaydedilsin mi?${warning}`)) return;

  const progressRunId = beginImportSaveProgress("Kaydediliyor…");
  importSaveInProgress = true;
  syncImportToolbar();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    const rowsForSave = state.importRows.map(({ id, periodKey, importBatchId, sourceFileName, rowIssues, hasIssue, ...row }) => row);
    handleImportSaveProgress({ percent: 12 });
    const saveResult = await savePeriodToCloud(state.importPeriod, rowsForSave, {
      fileName: state.importFileName || "",
      importBatchId: state.importRows[0]?.importBatchId || undefined,
      onProgress: handleImportSaveProgress
    });

    const savedCount = saveResult?.rowCount ?? state.importRows.length;
    state.importRows = [];
    state.importSelectedRowIds.clear();
    state.importPeriod = null;
    state.importFileName = "";
    editingImportRowId = null;
    importIssueFilterActive = false;
    const fileInput = document.getElementById("paymentFileInput");
    if (fileInput) fileInput.value = "";
    document.getElementById("importResult")?.classList.add("hidden");
    const validationBox = document.getElementById("validationList");
    if (validationBox) validationBox.textContent = "Kayıt tamamlandı. Yeni dosya içe aktarabilirsiniz.";
    renderImportPreviewTable();
    await finishImportSaveProgress("Kaydedildi", progressRunId);
    toast(`${savedCount} satır SQL veritabanına kaydedildi.`);
  } catch (error) {
    console.error(error);
    failImportSaveProgress("Kaydetme tamamlanamadı", progressRunId);
    toast(`Kaydetme hatası: ${error.message || error}`);
  } finally {
    importSaveInProgress = false;
    syncImportToolbar();
  }
}

setupImportPreviewActions();
renderImportPreviewTable();

const paymentFileInput = document.getElementById("paymentFileInput");
if (paymentFileInput) {
  const guardImportFileSelection = (event) => {
    if (hasImportPeriodSelection()) return;
    event.preventDefault();
    event.stopPropagation();
    paymentFileInput.value = "";
    warnImportPeriodSelectionRequired();
  };

  paymentFileInput.addEventListener("click", guardImportFileSelection);
  paymentFileInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      guardImportFileSelection(event);
    }
  });
  paymentFileInput.addEventListener("change", () => {
    if (!hasImportPeriodSelection()) {
      paymentFileInput.value = "";
      warnImportPeriodSelectionRequired();
    }
  });
}

document.getElementById("paymentImportBtn").addEventListener("click", async () => {
  const file = document.getElementById("paymentFileInput").files[0];
  if (!file) return toast("Dosya seçilmedi.");

  const box = document.getElementById("importResult");
  const validationBox = document.getElementById("validationList");

  try {
    const periodKey = getImportSelectedPeriodKey();
    const result = await importPaymentFile(file);
    const allImportedRows = result.rows || [];
    const importedRows = sortImportedRowsByTahsilatDate(
      allImportedRows.filter(row => getImportRowTahsilatPeriodKey(row) === periodKey)
    );
    const excludedCount = Math.max(0, allImportedRows.length - importedRows.length);
    const distribution = getPeriodDistribution(allImportedRows);
    const selectedDistribution = getPeriodDistribution(importedRows);
    let faturaDistribution = {};

    try {
      faturaDistribution = getFaturaPeriodDistribution(importedRows);
    } catch (error) {
      faturaDistribution = {};
    }

    state.importRows = [];
    clearCurrentDraft();
    state.importPeriod = periodKey;
    state.importFileName = file.name;
    state.importSelectedRowIds.clear();
    editingImportRowId = null;
    importIssueFilterActive = false;

    if (importedRows.length) {
      const prepared = prepareRowsForPreview(periodKey, importedRows, file.name);
      state.importRows = prepared.rows;
    }

    // İçe aktarılan dosya artık Veri Yönetimi veya Raporlar alanına otomatik aktarılmaz.
    // Bu alanlar yalnızca SQL'den getirilen/kaydedilmiş verilerle çalışmaya devam eder.
    syncPeriodInputs(periodKey, "import");
    syncPeriodInputs(periodKey, "data");
    syncPeriodInputs(periodKey, "report");

    box.classList.remove("hidden");
    box.textContent = importedRows.length
      ? `${periodKey} tahsilat dönemi seçildi. Dosyada okunan ${result.total} satırdan ${importedRows.length} satır ön kontrole alındı; ${excludedCount} satır seçilen yıl/ay dışında kaldığı veya TAHSILAT_TARIHI okunamadığı için alınmadı. Kaydetmeden Veri Yönetimi ve Raporlar alanında görünmez.`
      : `${periodKey} tahsilat dönemi seçildi ancak dosyada bu döneme ait satır bulunamadı. Okunan ${result.total} satırın ${excludedCount} satırı seçilen yıl/ay dışında kaldığı veya TAHSILAT_TARIHI okunamadığı için alınmadı.`;

    const parts = [];
    const periodKeys = Object.keys(distribution);
    if (periodKeys.length > 1) {
      parts.push(`<strong>Bilgi:</strong> Dosyadaki tahsilat dönemleri: ${formatPeriodDistribution(distribution)}. Yalnızca ${periodKey} dönemi içe alındı.`);
    } else if (periodKeys.length === 1 && !selectedDistribution[periodKey]) {
      parts.push(`<strong>Bilgi:</strong> Dosyada yalnızca ${formatPeriodDistribution(distribution)} dönemi var; seçilen ${periodKey} dönemine ait satır yok.`);
    }

    if (excludedCount > 0) {
      parts.push(`<strong>Filtre:</strong> ${excludedCount} satır seçilen tahsilat yılı/ayı dışında kaldığı veya TAHSILAT_TARIHI okunamadığı için önizlemeye alınmadı.`);
    }

    const faturaPeriodKeys = Object.keys(faturaDistribution);
    if (faturaPeriodKeys.length > 1) {
      parts.push(`<strong>Uyarı:</strong> Seçilen tahsilat dönemi içindeki fatura dönemleri: ${formatPeriodDistribution(faturaDistribution)}. Rapor filtresi ilk bulunan FATURA_TARIHI dönemine göre ayarlandı.`);
    }

    if (result.missingHeaders?.length) {
      parts.push(`<strong>Eksik başlıklar:</strong> ${result.missingHeaders.join(", ")}`);
      parts.push(`<strong>Okunan başlıklar:</strong> ${result.headers.join(", ")}`);
    }

    const filteredIssues = validatePaymentRows(importedRows);
    if (filteredIssues.length) {
      const preview = filteredIssues.slice(0, 40).map(x => `<div>${x}</div>`).join("");
      parts.push(`<strong>İçe alınan satırlardaki ilk ${Math.min(40, filteredIssues.length)} hata:</strong>`);
      parts.push(preview);

      if (filteredIssues.length > 40) {
        parts.push(`<div><strong>+ ${filteredIssues.length - 40} hata daha var.</strong> Lütfen başlıkları ve veri formatını kontrol edin.</div>`);
      }
    }

    if (!importedRows.length && !result.missingHeaders?.length) {
      parts.push("Seçilen tahsilat yılı/ayına ait kayıt bulunamadı. Farklı bir yıl/ay seçip dosyayı yeniden içe aktarın.");
    } else if (!parts.length) {
      parts.push("Ön kontrolde hata bulunmadı. Veriyi bu ekranda kontrol edip Kaydet butonuyla SQL veritabanına aktarabilirsiniz.");
    }

    validationBox.innerHTML = parts.join("");
    renderImportPreviewTable();
    toast(importedRows.length ? "Seçilen döneme ait veri ön kontrole alındı." : "Seçilen döneme ait satır bulunamadı.");
  } catch (error) {
    console.error(error);
    const message = error.message || String(error);
    box.classList.remove("hidden");
    box.textContent = `İçe aktarma hatası: ${message}`;
    toast(message.includes("Tahsilat") || message.includes("Lütfen önce") ? message : "İçe aktarma sırasında hata oluştu.");
  }
});





document.getElementById("calculateBtn")?.addEventListener("click", () => calculateReports({ navigate: true, notify: true }));
document.getElementById("quickCalculateBtn")?.addEventListener("click", () => calculateReports({ navigate: true, notify: true }));


document.getElementById("loadPeriodReportsBtn")?.addEventListener("click", async () => {
  const year = document.getElementById("reportYearInput")?.value;
  const months = syncReportMonthState();
  setReportDefinitionWarning("");

  if (!year) {
    toast("Tahsilat yılı seçilmelidir.");
    return;
  }

  if (!months.length) {
    toast("En az bir tahsilat ayı seçilmelidir.");
    return;
  }

  const periodKeys = months.map(month => getPeriodKey(year, month));
  const reportPeriodKey = periodKeys.join(",");
  const periodLabel = reportPeriodSelectionLabel(year, months);
  let results;

  try {
    results = await Promise.all(periodKeys.map(periodKey => loadPeriodRows(periodKey, { preferCache: true })));
  } catch (error) {
    console.error(error);
    const offlineText = navigator.onLine === false ? " İnternet bağlantısı kapalı görünüyor." : "";
    toast(`Rapor verisi çekilemedi. Bağlantı veya SQL erişimini kontrol edin.${offlineText}`);
    return;
  }

  const rows = results.flatMap(result => Array.isArray(result?.rows) ? result.rows : []);
  const sources = [...new Set(results.map(result => result?.source).filter(Boolean))];
  updateReportDistributorOptions(rows);
  const distributorFilter = syncReportDistributorState();
  const distributorLabel = reportDistributorSelectionLabel(distributorFilter);
  const reportRows = filterRowsByReportDistributor(rows, distributorFilter);

  state.currentReportPeriod = reportPeriodKey;
  state.currentReportMonths = months;

  if (!rows.length) {
    state.reportRows = [];
    calculateReports({ navigate: false, rows: [] });
    toast(`${periodLabel} döneminde veri bulunamadı.`);
    return;
  }

  if (!reportRows.length) {
    state.reportRows = [];
    calculateReports({ navigate: false, rows: [] });
    toast(`${periodLabel} döneminde ${distributorLabel} için veri bulunamadı.`);
    return;
  }

  state.reportRows = reportRows;

  // Bayi payı kontrolü yalnızca "Tümü" seçimine bağlı değildir.
  // Tek veya çoklu dağıtıcı seçiminde ilgili BAYI tanımı yoksa rapor üretilmez.
  const missingDealerShareDefinitions = findMissingDealerShareDefinitions(reportRows);
  if (missingDealerShareDefinitions.length) {
    const warningMessage = buildMissingDealerShareWarning(missingDealerShareDefinitions);
    state.reports = [];
    calculateReports({ navigate: false, rows: [] });
    showReportView("general");
    setReportDefinitionWarning(warningMessage);
    toast(REPORT_DEFINITION_WARNING_TEXT, { duration: 6500 });
    return;
  }

  calculateReports({ navigate: false, rows: reportRows });
  showReportView("general");

  const sourceText = sources.length === 1
    ? sources[0] === "cache"
      ? "önbellekten"
      : sources[0] === "postgres" || sources[0] === "postgres-period-key"
        ? "SQL veritabanından"
        : "yerel kayıttan"
    : "SQL veritabanından";
  const distributorText = ` / ${distributorLabel}`;

  toast(`${periodLabel}${distributorText} tahsilat dönemi ${sourceText} yüklendi.`);
});


setupDefinitionForms();
setupDefinitionViewController();
refreshDefinitionView();
setupReportActions();
setupReportViewControls();
setupSendLogs();
setupSettings();
setupDataManager();
setupCustomerAnalytics();
setupBayiManagement();

loadDefinitionsFromSql({ notify: false }).then(() => {
  updateReportDistributorOptions(state.reportRows || []);
  refreshDefinitionView();
}).catch(() => {
  updateReportDistributorOptions(state.reportRows || []);
  renderDefinitions();
});
