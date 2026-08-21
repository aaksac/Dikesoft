import { state } from "./state.js";
import { money } from "./format.js";
import { createDealerPdf, createDealerPdfBlob, createGeneralPdf } from "./pdf.js?v=2026.06.10-general-report-pdf-channel-wrap-v1";
import { sendReport, showMailSendNotice } from "./mail.js";
import { toast } from "./ui.js";

let reportActionsBound = false;
let reportStatusListenerBound = false;
let mailSendingBusy = false;
let reportDownloadBusy = false;
let dealerReportSearchTerm = "";

function strictReportDealerShare(report) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  return rows.reduce((sum, row) => {
    const value = Number(row?.reportDealerShare);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function sortReportsByTotalInvoiceDesc(reports = []) {
  return [...reports].sort((a, b) => {
    const totalA = Number(a?.totalInvoice || 0);
    const totalB = Number(b?.totalInvoice || 0);
    if (totalB !== totalA) return totalB - totalA;

    return String(a?.bayi || "").localeCompare(String(b?.bayi || ""), "tr-TR");
  });
}

export function renderReports() {
  renderGeneralReport();
  renderDealerReportsList();
}

function renderDealerReportsList(options = {}) {
  const box = document.getElementById("dealerReports");
  if (!box) return;

  box.innerHTML = "";
  syncDealerReportSearchControls();

  if (!state.reports.length) {
    updateDealerReportSearchCount(0, 0);
    box.textContent = "Henüz rapor oluşturulmadı.";
    state.selectedReportIds.clear();
    updateReportSelectionCheckboxes();
    return;
  }

  const sortedReports = sortReportsByTotalInvoiceDesc(state.reports);

  sortedReports.forEach(report => {
    const card = document.createElement("div");
    card.className = "report-card";
    card.dataset.reportId = report.id;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "report-select-checkbox";
    cb.dataset.reportId = report.id;
    cb.checked = state.selectedReportIds.has(report.id);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        state.selectedReportIds.add(report.id);
      } else {
        state.selectedReportIds.delete(report.id);
      }
      updateReportSelectionCheckboxes();
    });

    const info = document.createElement("div");

    const title = document.createElement("strong");
    title.textContent = report.bayi;

    const meta = document.createElement("div");
    meta.className = "report-meta";
    meta.textContent = `${report.kanal || report.dagitici || "Kanal yok"} · ${report.invoiceCount} fatura · ${money(report.totalInvoice)} · KP: ${report.kp || 0} · BP: ${report.bp || 0} · ${report.email || "Mail eksik"} · ${report.status}`;

    info.append(title, meta);

    const sendButton = btn("Gönder", () => confirmAndSendReport(report));
    sendButton.disabled = mailSendingBusy;
    sendButton.classList.toggle("is-busy", mailSendingBusy);

    const actions = document.createElement("div");
    actions.className = "report-actions";
    actions.append(
      btn("Önizle", event => previewDealerReport(report, event)),
      btn("İndir", () => createDealerPdf(report, "save")),
      sendButton
    );

    card.append(cb, info, actions);
    box.appendChild(card);
  });

  applyDealerReportSearchFilter({ preserveFocus: Boolean(options.preserveFocus) });
  updateReportSelectionCheckboxes();
}

function renderGeneralReport() {
  const el = document.getElementById("generalReport");
  if (!el) return;

  if (!state.reports.length) {
    el.textContent = "Henüz hesaplama yapılmadı.";
    return;
  }

  const totals = state.reports.reduce((acc, report) => {
    acc.invoiceCount += Number(report.invoiceCount || 0);
    acc.totalInvoice += Number(report.totalInvoice || 0);
    acc.channelShare += Number(report.channelShare || 0);
    acc.dealerShare += strictReportDealerShare(report);
    return acc;
  }, {
    invoiceCount: 0,
    totalInvoice: 0,
    channelShare: 0,
    dealerShare: 0
  });

  const sortedReports = sortReportsByTotalInvoiceDesc(state.reports);

  const rows = sortedReports.map((report, index) => {
    const channelName = escapeHtml(report.kanal || report.dagitici || "");
    const dealerName = escapeHtml(report.bayi || "");
    const status = escapeHtml(report.status || "");

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${channelName}</td>
        <td class="general-report-bayi-cell">
          <span class="general-report-bayi-name" title="${dealerName}">${dealerName}</span>
        </td>
        <td>${escapeHtml(report.kp || 0)}</td>
        <td>${escapeHtml(report.bp || 0)}</td>
        <td>${escapeHtml(report.invoiceCount || 0)}</td>
        <td class="numeric-cell">${money(report.totalInvoice)}</td>
        <td class="numeric-cell">${money(report.channelShare)}</td>
        <td class="numeric-cell">${money(strictReportDealerShare(report))}</td>
        <td>${status}</td>
      </tr>
    `;
  }).join("");

  const totalRow = `
    <tr class="general-report-total-row">
      <td colspan="5">Genel Toplam</td>
      <td>${totals.invoiceCount}</td>
      <td class="numeric-cell">${money(totals.totalInvoice)}</td>
      <td class="numeric-cell">${money(totals.channelShare)}</td>
      <td class="numeric-cell">${money(totals.dealerShare)}</td>
      <td></td>
    </tr>
  `;

  el.innerHTML = `
    <div class="general-report-mobile-actions">
      <button id="generalReportPreviewBtn" class="btn btn-primary" type="button">Önizle</button>
    </div>
    <div class="data-table general-report">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Kanal / Dağıtıcı</th>
            <th>Bayi</th>
            <th>KP</th>
            <th>BP</th>
            <th>Fatura Adet</th>
            <th>Fatura Tutar</th>
            <th>Kanal Payı</th>
            <th>Bayi Payı</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>${totalRow}</tfoot>
      </table>
    </div>
  `;
}


function previewDealerReport(report, event) {
  // PDF önizleme uygulama dışında açılır; dönüşte arama alanının scroll/focus
  // davranışına karışmamak için burada yalnız aktif buton odağı temizlenir.
  const active = document.activeElement;
  if (active && active !== document.body && typeof active.blur === "function") {
    try { active.blur(); } catch (error) { /* noop */ }
  }

  createDealerPdf(report, "open");
}

function btn(text, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-soft";
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

export function setupReportActions() {
  if (reportActionsBound) return;
  reportActionsBound = true;

  if (!reportStatusListenerBound) {
    reportStatusListenerBound = true;
    document.addEventListener("dikesoft:report-status-changed", () => {
      const reportsPage = document.getElementById("reports");
      if (reportsPage?.classList.contains("is-visible")) {
        renderReports();
      } else {
        renderGeneralReport();
      }
    });
  }


  document.addEventListener("click", event => {
    const target = event.target.closest("button");
    if (!target) return;

    switch (target.id) {
      case "generalReportPreviewBtn":
        if (!state.reports.length) {
          toast("Önizlenecek genel rapor yok.");
          return;
        }
        createGeneralPdf("open");
        break;

      case "selectAllReportsBtn":
        selectAllReports();
        break;

      case "clearSelectionBtn":
      case "clearReportSelectionBtn":
        clearReportSelection();
        break;

      case "downloadSelectedBtn":
      case "downloadSelectedReportsBtn":
        downloadSelectedReports();
        break;

      case "sendSelectedBtn":
      case "sendSelectedReportsBtn":
      case "quickSendSelectedBtn":
        sendSelectedReports();
        break;

      default:
        break;
    }
  });

  document.addEventListener("change", event => {
    if (event.target?.id !== "selectAllReportsCheckbox") return;
    setAllReportsSelected(event.target.checked);
  });

  const searchInput = document.getElementById("dealerReportSearchInput");
  if (searchInput) {
    dealerReportSearchTerm = searchInput.value || "";
    searchInput.addEventListener("input", () => {
      dealerReportSearchTerm = searchInput.value || "";
      applyDealerReportSearchFilter({ preserveFocus: true });
    });
  }

  const clearDealerReportSearchBtn = document.getElementById("clearDealerReportSearchBtn");
  clearDealerReportSearchBtn?.addEventListener("pointerdown", event => {
    // Mobilde çarpı butonu input odağını çalmasın; klavye ve ekran konumu sabit kalsın.
    event.preventDefault();
  });
  clearDealerReportSearchBtn?.addEventListener("mousedown", event => {
    event.preventDefault();
  });

  const handleDealerReportSearchClear = event => {
    event?.preventDefault?.();
    clearDealerReportSearch({ preserveFocus: true });
  };

  clearDealerReportSearchBtn?.addEventListener("pointerup", handleDealerReportSearchClear);
  clearDealerReportSearchBtn?.addEventListener("click", handleDealerReportSearchClear);
}

function clearDealerReportSearch(options = {}) {
  const input = document.getElementById("dealerReportSearchInput");
  if (!dealerReportSearchTerm && !input?.value) {
    return;
  }

  dealerReportSearchTerm = "";
  if (input) {
    input.value = "";
    if (options.preserveFocus !== false) {
      focusDealerReportSearchInput(input);
    }
  }
  applyDealerReportSearchFilter({ preserveFocus: options.preserveFocus !== false });

  if (options.preserveFocus !== false) {
    ensureDealerReportSearchVisible(input);
  }
}

function applyDealerReportSearchFilter(options = {}) {
  const preserveFocus = Boolean(options.preserveFocus);
  const focusSnapshot = preserveFocus ? captureSearchFocusSnapshot() : null;
  const box = document.getElementById("dealerReports");
  if (!box) return;

  syncDealerReportSearchControls();

  const visibleReports = getVisibleDealerReports();
  const visibleIds = new Set(visibleReports.map(report => String(report.id)));

  box.querySelectorAll(".report-card[data-report-id]").forEach(card => {
    const shouldShow = visibleIds.has(String(card.dataset.reportId));
    card.hidden = !shouldShow;
    card.classList.toggle("is-search-hidden", !shouldShow);
  });

  let empty = box.querySelector(".report-empty-state");
  if (!visibleReports.length && state.reports.length) {
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "report-empty-state";
      box.appendChild(empty);
    }
    empty.textContent = `“${dealerReportSearchTerm}” aramasıyla eşleşen bayi raporu bulunamadı.`;
    empty.hidden = false;
  } else if (empty) {
    empty.hidden = true;
  }

  updateDealerReportSearchCount(visibleReports.length, state.reports.length);
  updateReportSelectionCheckboxes();

  if (focusSnapshot) {
    restoreSearchFocusSnapshot(focusSnapshot);
    keepDealerReportSearchUsable();
  }
}


function captureSearchFocusSnapshot() {
  const input = document.getElementById("dealerReportSearchInput");
  return {
    active: document.activeElement === input,
    selectionStart: input?.selectionStart ?? null,
    selectionEnd: input?.selectionEnd ?? null
  };
}

function restoreSearchFocusSnapshot(snapshot) {
  if (!snapshot?.active) return;

  const input = document.getElementById("dealerReportSearchInput");
  if (!input || document.activeElement !== input) return;

  if (Number.isInteger(snapshot.selectionStart) && Number.isInteger(snapshot.selectionEnd)) {
    try {
      input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    } catch (error) {
      // type=search bazı mobil tarayıcılarda seçim aralığını reddedebilir.
    }
  }
}

function focusDealerReportSearchInput(input) {
  if (!input) return;
  try {
    input.focus({ preventScroll: true });
  } catch (error) {
    input.focus();
  }
}

function ensureDealerReportSearchVisible(input = document.getElementById("dealerReportSearchInput")) {
  keepDealerReportSearchUsable(input, { attempts: [0, 90, 220, 360] });
}

function keepDealerReportSearchUsable(
  input = document.getElementById("dealerReportSearchInput"),
  options = {}
) {
  if (!input || !isMobileViewport()) return;

  const attempts = Array.isArray(options.attempts) ? options.attempts : [0, 80, 180];
  const alignIfNeeded = () => {
    if (document.activeElement !== input) return;

    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportHeight = viewport?.height || window.innerHeight || document.documentElement.clientHeight;
    const safeTop = Math.max(72, viewportTop + 12);
    const safeBottom = Math.max(safeTop + 80, viewportTop + viewportHeight - 18);
    const rect = input.getBoundingClientRect();

    // Yalnızca gerçekten klavye altında kalırsa düzelt; görünürken sayfayı oynatma.
    if (rect.bottom > safeBottom) {
      window.scrollBy({ top: rect.bottom - safeBottom, left: 0, behavior: "auto" });
    } else if (rect.top < safeTop) {
      window.scrollBy({ top: rect.top - safeTop, left: 0, behavior: "auto" });
    }
  };

  attempts.forEach(delay => {
    if (delay) {
      window.setTimeout(alignIfNeeded, delay);
    } else {
      window.requestAnimationFrame(alignIfNeeded);
    }
  });
}

function isMobileViewport() {
  return window.matchMedia?.("(max-width: 768px)")?.matches || window.innerWidth <= 768;
}

function syncDealerReportSearchControls() {
  const input = document.getElementById("dealerReportSearchInput");
  const clearButton = document.getElementById("clearDealerReportSearchBtn");

  if (input && input.value !== dealerReportSearchTerm) {
    input.value = dealerReportSearchTerm;
  }

  if (clearButton) {
    clearButton.hidden = !dealerReportSearchTerm.trim();
  }
}

function updateDealerReportSearchCount(visibleCount = 0, totalCount = state.reports.length) {
  const counter = document.getElementById("dealerReportSearchCount");
  if (!counter) return;
  counter.textContent = totalCount ? `${visibleCount}/${totalCount} kayıt` : "0 kayıt";
}

function getVisibleDealerReports() {
  const query = normalizeSearchValue(dealerReportSearchTerm);
  const sortedReports = sortReportsByTotalInvoiceDesc(state.reports);
  if (!query) return sortedReports;

  return sortedReports.filter(report => normalizeSearchValue([
    report.bayi,
    report.kanal,
    report.dagitici,
    report.email,
    report.status,
    report.invoiceCount,
    report.totalInvoice,
    report.kp,
    report.bp
  ].filter(value => value !== undefined && value !== null).join(" ")).includes(query));
}

function normalizeSearchValue(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function selectAllReports() {
  setAllReportsSelected(true);
}

function setAllReportsSelected(shouldSelect) {
  if (!state.reports.length) {
    updateReportSelectionCheckboxes();
    toast("Seçilecek rapor yok.");
    return;
  }

  if (shouldSelect) {
    state.reports.forEach(report => state.selectedReportIds.add(report.id));
    toast(`${state.selectedReportIds.size} rapor seçildi.`);
  } else {
    state.selectedReportIds.clear();
    toast("Rapor seçimi temizlendi.");
  }

  updateReportSelectionCheckboxes();
}

function clearReportSelection() {
  setAllReportsSelected(false);
}

async function downloadSelectedReports() {
  const reports = selectedReports();

  if (!reports.length) {
    toast("İndirilecek rapor seçilmedi.");
    return;
  }

  if (reportDownloadBusy) return;

  setReportDownloadButtonsBusy(true);

  if (reports.length === 1) {
    toast("Seçili rapor PDF olarak hazırlanıyor...");
  } else {
    toast(`${reports.length} rapor ZIP paketi hazırlanıyor...`);
  }

  try {
    if (reports.length === 1) {
      const { blob, filename } = await createDealerPdfBlob(reports[0]);
      await shareOrDownloadFile(blob, filename, "application/pdf");
      toast("Seçili rapor PDF olarak hazırlandı.");
      return;
    }

    const pdfFiles = [];

    for (const report of reports) {
      const pdfFile = await createDealerPdfBlob(report);
      pdfFiles.push(pdfFile);
    }

    const zipBlob = await createStoredZip(pdfFiles);
    const filename = buildBulkZipFilename(reports.length);
    await shareOrDownloadFile(zipBlob, filename, "application/zip");
    toast(`${reports.length} rapor tek ZIP paket olarak hazırlandı.`);
  } catch (error) {
    console.error("Seçili raporları indirme hatası:", error);
    toast(reports.length === 1 ? "PDF hazırlanamadı. Lütfen tekrar deneyin." : "Toplu ZIP hazırlanamadı. Lütfen tekrar deneyin.");
  } finally {
    setReportDownloadButtonsBusy(false);
  }
}

async function sendSelectedReports() {
  const reports = selectedReports();

  if (!reports.length) {
    toast("Gönderilecek rapor seçilmedi.");
    return;
  }

  const confirmed = window.confirm(`${reports.length} bayi raporunu ilgili mail adreslerine göndermek istiyor musunuz?`);
  if (!confirmed) {
    toast("Mail gönderimi iptal edildi.");
    return;
  }

  setMailButtonsBusy(true);

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  try {
    for (let index = 0; index < reports.length; index += 1) {
      const report = reports[index];
      showMailSendNotice(`${index + 1}/${reports.length}: ${report.bayi} için mail gönderiliyor...`, "info", 0);
      const result = await sendReport(report, { notify: false });

      if (result.ok) successCount += 1;
      else if (result.skipped) skippedCount += 1;
      else errorCount += 1;
    }

    const parts = [];
    if (successCount) parts.push(`${successCount} mail gönderildi`);
    if (skippedCount) parts.push(`${skippedCount} mail adresi eksik`);
    if (errorCount) parts.push(`${errorCount} hata`);

    const message = parts.length ? parts.join(", ") + "." : "Mail gönderimi tamamlandı.";
    showMailSendNotice(message, errorCount ? "warning" : "success", errorCount ? 6500 : 1600);
  } finally {
    setMailButtonsBusy(false);
  }
}

async function confirmAndSendReport(report) {
  if (!report) return;

  if (!report.email) {
    toast(`${report.bayi}: Mail adresi eksik.`, { duration: 6000 });
    return;
  }

  const confirmed = window.confirm(`${report.bayi} raporunu ${report.email} adresine göndermek istiyor musunuz?`);
  if (!confirmed) {
    toast("Mail gönderimi iptal edildi.");
    return;
  }

  setMailButtonsBusy(true);
  try {
    await sendReport(report, { notify: true });
  } finally {
    setMailButtonsBusy(false);
  }
}

function setMailButtonsBusy(isBusy) {
  mailSendingBusy = isBusy;
  document.querySelectorAll("#sendSelectedBtn,#sendSelectedReportsBtn,#quickSendSelectedBtn,.report-actions button").forEach(button => {
    const label = button.textContent?.trim();
    const id = button.id || "";
    if (label === "Gönder" || id.toLowerCase().includes("send")) {
      button.disabled = isBusy;
      button.classList.toggle("is-busy", isBusy);
    }
  });
}

function setReportDownloadButtonsBusy(isBusy) {
  reportDownloadBusy = isBusy;
  document.querySelectorAll("#downloadSelectedBtn,#downloadSelectedReportsBtn").forEach(button => {
    button.disabled = isBusy;
    button.classList.toggle("is-busy", isBusy);
  });
}

function buildBulkZipFilename(count) {
  const period = String(state.currentReportPeriod || new Date().toISOString().slice(0, 10))
    .replace(/[^0-9A-Za-z._-]+/g, "_");
  return `bayi-raporlari-${period}-${count}-rapor.zip`;
}

function isMobileShareContext() {
  try {
    const narrowScreen = window.matchMedia?.("(max-width: 767px)")?.matches;
    const coarsePointer = window.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches;
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
    return Boolean(narrowScreen || coarsePointer || standalone);
  } catch {
    return window.innerWidth <= 767;
  }
}

async function shareOrDownloadFile(blob, filename, mimeType) {
  if (isMobileShareContext() && navigator.share && typeof File !== "undefined") {
    try {
      const file = new File([blob], filename, { type: mimeType });
      const sharePayload = { files: [file] };

      if (!navigator.canShare || navigator.canShare(sharePayload)) {
        await navigator.share(sharePayload);
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Dosya paylaşımı başarısız, indirme akışına dönülüyor:", error);
    }
  }

  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createStoredZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = getDosDateTime(new Date());

  for (const file of files) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const nameBytes = encoder.encode(uniqueZipFilename(file.filename, centralParts.length));
    const crc = crc32(bytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, bytes.length, true);
    localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, bytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + bytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
}

function uniqueZipFilename(filename, index) {
  const safeName = String(filename || `rapor-${index + 1}.pdf`).replace(/[\\/:*?"<>|]/g, "_");
  const pdfName = safeName.toLowerCase().endsWith(".pdf") ? safeName : `${safeName}.pdf`;
  const order = String(index + 1).padStart(2, "0");
  return `${order}-${pdfName}`;
}

function getDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }

  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;

  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function selectedReports() {
  return sortReportsByTotalInvoiceDesc(state.reports).filter(report => state.selectedReportIds.has(report.id));
}

function updateReportSelectionCheckboxes() {
  document.querySelectorAll(".report-select-checkbox").forEach(cb => {
    cb.checked = state.selectedReportIds.has(cb.dataset.reportId);
  });

  const selectAllCheckbox = document.getElementById("selectAllReportsCheckbox");
  if (!selectAllCheckbox) return;

  const totalReports = state.reports.length;
  const selectedCount = selectedReports().length;
  selectAllCheckbox.disabled = totalReports === 0;
  selectAllCheckbox.checked = totalReports > 0 && selectedCount === totalReports;
  selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalReports;
}
