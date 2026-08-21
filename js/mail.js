import { state } from "./state.js";
import { toast } from "./ui.js";
import { saveSendLogToCloud, loadSendLogsFromCloud } from "./cloud.js";
import { mailConfig, databaseConfig } from "./config.js";
import { createDealerPdfBase64 } from "./pdf.js";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function fileSafe(name) {
  return String(name || "rapor").replace(/[\\/:*?"<>|]/g, "_").trim() || "rapor";
}

let sendLogSearchTerm = "";

function normalizeSendLogSearchValue(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getVisibleSendLogs(rows = state.sendLogs) {
  const query = normalizeSendLogSearchValue(sendLogSearchTerm);
  if (!query) return rows;
  return rows.filter(log => normalizeSendLogSearchValue(log?.bayi).includes(query));
}

function syncSendLogSearchControls() {
  const input = document.getElementById("sendLogSearchInput");
  const clearButton = document.getElementById("clearSendLogSearchBtn");

  if (input && input.value !== sendLogSearchTerm) {
    input.value = sendLogSearchTerm;
  }

  if (clearButton) {
    clearButton.hidden = !sendLogSearchTerm.trim();
  }
}

function updateSendLogSearchCount(visibleCount = 0, totalCount = state.sendLogs.length) {
  const counter = document.getElementById("sendLogSearchCount");
  if (!counter) return;
  counter.textContent = totalCount ? `${visibleCount}/${totalCount} kayıt` : "0 kayıt";
}


export function setupSendLogs() {
  const start = document.getElementById("sendLogStartDate");
  const end = document.getElementById("sendLogEndDate");
  const btn = document.getElementById("loadSendLogsBtn");
  const searchInput = document.getElementById("sendLogSearchInput");

  if (start && !start.value) start.value = monthStartIso();
  if (end && !end.value) end.value = todayIso();

  btn?.addEventListener("click", async () => {
    await loadFilteredSendLogs();
  });

  if (searchInput) {
    sendLogSearchTerm = searchInput.value || "";
    searchInput.addEventListener("input", () => {
      sendLogSearchTerm = searchInput.value || "";
      renderSendLogs();
    });
  }

  document.getElementById("clearSendLogSearchBtn")?.addEventListener("click", () => {
    sendLogSearchTerm = "";
    const input = document.getElementById("sendLogSearchInput");
    if (input) {
      input.value = "";
      try {
        input.focus({ preventScroll: true });
      } catch (error) {
        input.focus();
      }
    }
    renderSendLogs();
  });

  syncSendLogSearchControls();
  renderSendLogs([], "Tarih aralığı seçip Geçmişi Getir butonuna basın.");
}

export function showMailSendNotice(message, type = "info", duration = 5000) {
  toast(message, { duration, variant: "mail", type });
}

function setReportStatus(report, status) {
  if (!report) return;
  report.status = status;
  document.dispatchEvent(new CustomEvent("dikesoft:report-status-changed", {
    detail: { id: report.id, status }
  }));
}

export async function sendReport(report, options = {}) {
  const { notify = true } = options;

  if (!report?.email) {
    const message = `${report?.bayi || "Bayi"}: Mail adresi eksik.`;
    setReportStatus(report, "Mail Eksik");
    if (notify) showMailSendNotice(message, "warning", 6000);
    return { ok: false, skipped: true, report, message };
  }

  if (!mailConfig.appsScriptWebAppUrl) {
    const message = "Gmail Apps Script URL tanımlı değil.";
    if (notify) showMailSendNotice(message, "error", 7000);
    return { ok: false, report, message };
  }

  const now = new Date();
  const log = {
    bayi: report.bayi,
    email: report.email,
    tarih: now.toLocaleString("tr-TR"),
    createdAt: now.toISOString(),
    durum: "Gönderiliyor",
    periodKey: report.periodKey || state.currentReportPeriod || "",
    importBatchId: report.importBatchId || ""
  };

  setReportStatus(report, "Gönderiliyor");
  if (notify) {
    showMailSendNotice(`${report.bayi} için PDF hazırlanıyor ve mail gönderiliyor...`, "info", 0);
  }

  try {
    const pdfBase64 = await createDealerPdfBase64(report);
    const bodyText = report.body || state.settings.defaultBody || "Sayın yetkili, hesap özeti raporunuz ektedir.";

    await fetch(mailConfig.appsScriptWebAppUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        token: mailConfig.mailToken,
        fromName: mailConfig.fromName,
        to: report.email,
        subject: report.subject || state.settings.defaultSubject || "Dikesoft Raporu",
        body: bodyText,
        html: `<p>${bodyText.replace(/\n/g, "<br>")}</p>`,
        filename: `${fileSafe(report.bayi)}.pdf`,
        pdfBase64
      })
    });

    log.durum = "Gönderildi";
    setReportStatus(report, "Gönderildi");

    const message = `${report.bayi} için mail gönderildi.`;
    if (notify) showMailSendNotice(message, "success", 1300);
    return { ok: true, report, log, message };
  } catch (error) {
    console.error(error);
    const detail = error.message || error;
    log.durum = `Hata: ${detail}`;
    setReportStatus(report, "Gönderilemedi");

    const message = `${report.bayi} mail gönderim hatası: ${detail}`;
    if (notify) showMailSendNotice(message, "error", 8000);
    return { ok: false, report, log, message, error };
  } finally {
    state.sendLogs.unshift(log);

    try {
      await saveSendLogToCloud(log);
    } catch (error) {
      console.warn("Gönderim logu SQL'e kaydedilemedi:", error);
    }

    const page = document.getElementById("sendLogs");
    if (page?.classList.contains("is-visible")) {
      await loadFilteredSendLogs(false);
    }
  }
}

async function loadFilteredSendLogs(showToast = true) {
  const start = document.getElementById("sendLogStartDate")?.value;
  const end = document.getElementById("sendLogEndDate")?.value;

  if (!start || !end) {
    toast("Başlangıç ve bitiş tarihi seçilmelidir.");
    return;
  }

  if (start > end) {
    toast("Başlangıç tarihi bitiş tarihinden büyük olamaz.");
    return;
  }

  try {
    const result = await loadSendLogsFromCloud(start, end);
    state.sendLogs = result.rows || [];
    renderSendLogs(state.sendLogs);

    if (showToast) {
      toast(`${start} - ${end} aralığında ${state.sendLogs.length} gönderim kaydı getirildi.`);
    }
  } catch (error) {
    console.error(error);
    toast("Gönderim geçmişi getirilemedi.");
  }
}

export function renderSendLogs(rows = state.sendLogs, emptyText = "Seçilen aralıkta gönderim yok.") {
  const el = document.getElementById("sendLogList");
  if (!el) return;

  syncSendLogSearchControls();

  if (!rows.length) {
    updateSendLogSearchCount(0, 0);
    el.textContent = emptyText;
    return;
  }

  const visibleRows = getVisibleSendLogs(rows);
  updateSendLogSearchCount(visibleRows.length, rows.length);

  if (!visibleRows.length) {
    el.textContent = "Arama kriterine uygun gönderim kaydı yok.";
    return;
  }

  el.innerHTML = "";

  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Bayi</th><th>Mail</th><th>Tarih</th><th>Durum</th></tr></thead>";

  const tbody = document.createElement("tbody");

  visibleRows.forEach(log => {
    const tr = document.createElement("tr");
    ["bayi", "email", "tarih", "durum"].forEach(k => {
      const td = document.createElement("td");
      td.textContent = log[k] || "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  el.appendChild(table);
}
