/*
  data-manager.js
  Görev: Son yüklenen veriyi açılışta getirme, veri satırı üzerinde doğrudan düzenleme,
  tekli/toplu silme ve güncel veriden raporları yeniden hesaplama.
*/
import { state } from "./state.js";
import { toast, showPage } from "./ui.js";
import { loadLatestRows, loadPeriodRows, getPeriodKey, updatePaymentRow, deletePaymentRows, savePeriodToCloud, loadCurrentDraft, saveCurrentDraft, clearCurrentDraft } from "./cloud.js";
import { money, dateTR } from "./format.js";
import { safeNumber, sanitizeText } from "./security.js";
import { getPaymentRowIssues } from "./validators.js";

const editableFields = [
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

let editingRowId = null;
let dataColumnSearchBound = false;
let dataDeleteProgressTimer = null;
let dataDeleteProgressRunId = 0;

const dataColumnSearch = {
  field: "unvan",
  query: ""
};

const dataColumnSearchLabels = {
  unvan: "UNVAN",
  dagitici: "DAGITICI",
  bayi: "BAYI"
};

function getPeriodKeyFromDateInput(value) {
  if (!value) return "";
  const text = String(value).trim();
  let date = null;

  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (tr) {
    const [, d, m, y] = tr;
    date = new Date(Number(y), Number(m) - 1, Number(d));
  } else {
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
      const [, y, m, d] = iso;
      date = new Date(Number(y), Number(m) - 1, Number(d));
    } else {
      date = new Date(text);
    }
  }

  if (!date || isNaN(date)) return "";
  const year = date.getFullYear();
  if (year < 1900 || year > 2100) return "";
  return getPeriodKey(year, date.getMonth() + 1);
}

function beginDataDeleteProgress(message = "Siliniyor…") {
  dataDeleteProgressRunId += 1;
  if (dataDeleteProgressTimer) {
    clearTimeout(dataDeleteProgressTimer);
    dataDeleteProgressTimer = null;
  }
  setDataDeleteProgress(6, message);
  return dataDeleteProgressRunId;
}

function setDataDeleteProgress(percent, message = "Siliniyor…") {
  const box = document.getElementById("dataDeleteProgress");
  const text = document.getElementById("dataDeleteProgressText");
  const value = document.getElementById("dataDeleteProgressPercent");
  const fill = document.getElementById("dataDeleteProgressFill");
  if (!box || !text || !value || !fill) return;

  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  if (dataDeleteProgressTimer) {
    clearTimeout(dataDeleteProgressTimer);
    dataDeleteProgressTimer = null;
  }
  box.classList.remove("hidden", "is-complete");
  box.classList.add("is-running");
  box.setAttribute("aria-hidden", "false");
  text.textContent = message;
  value.textContent = `${safePercent}%`;
  fill.style.width = `${safePercent}%`;
}

function hideDataDeleteProgress(runId = dataDeleteProgressRunId) {
  if (runId !== dataDeleteProgressRunId) return;
  const box = document.getElementById("dataDeleteProgress");
  if (!box) return;
  box.classList.add("hidden");
  box.classList.remove("is-running", "is-complete");
  box.setAttribute("aria-hidden", "true");
}

function finishDataDeleteProgress(message = "Silindi", runId = dataDeleteProgressRunId) {
  const box = document.getElementById("dataDeleteProgress");
  const text = document.getElementById("dataDeleteProgressText");
  const value = document.getElementById("dataDeleteProgressPercent");
  const fill = document.getElementById("dataDeleteProgressFill");
  if (!box || !text || !value || !fill) return Promise.resolve();
  if (runId !== dataDeleteProgressRunId) return Promise.resolve();

  if (dataDeleteProgressTimer) {
    clearTimeout(dataDeleteProgressTimer);
    dataDeleteProgressTimer = null;
  }
  box.classList.remove("hidden", "is-running");
  box.classList.add("is-complete");
  box.setAttribute("aria-hidden", "false");
  text.textContent = message;
  value.textContent = "100%";
  fill.style.width = "100%";
  return new Promise(resolve => {
    dataDeleteProgressTimer = setTimeout(() => {
      hideDataDeleteProgress(runId);
      resolve();
    }, 650);
  });
}

function handleDataDeleteProgress({ percent }) {
  const safePercent = Number.isFinite(Number(percent)) ? Number(percent) : 8;
  setDataDeleteProgress(Math.max(8, safePercent), "Siliniyor…");
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}


function syncDataPeriodInputs(periodKey) {
  const match = String(periodKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return;

  const [, year, month] = match;
  const yearInput = document.getElementById("dataYearInput");
  const monthInput = document.getElementById("dataMonthInput");

  if (yearInput) yearInput.value = year;
  if (monthInput) monthInput.value = String(Number(month));
}


export function setupDataManager() {
  document.getElementById("loadDataPeriodBtn")?.addEventListener("click", () => loadSelectedDataPeriod(true));
  document.getElementById("saveCurrentRowsBtn")?.addEventListener("click", saveCurrentRowsToSql);

  document.getElementById("selectAllRowsBtn")?.addEventListener("change", event => {
    const checked = event.target.checked;
    const visibleRows = getVisibleDataRows();
    state.selectedRowIds.clear();
    if (checked) visibleRows.forEach(({ row }) => row.id && state.selectedRowIds.add(row.id));
    document.querySelectorAll('#dataTable .editor-table td.col-select input[type="checkbox"]').forEach(cb => {
      cb.checked = checked;
    });
    syncSelectAllRowsControl(visibleRows);
    syncDataPeriodInfo(visibleRows);
  });

  document.getElementById("editSelectedRowBtn")?.addEventListener("click", editSelectedRow);
  document.getElementById("deleteSelectedRowsBtn")?.addEventListener("click", deleteSelectedRows);
  document.getElementById("exportSelectedRowsBtn")?.addEventListener("click", exportSelectedRowsToExcel);
  setupDataColumnSearch();
}

export async function loadLatestData(showToast = false) {
  let result;

  try {
    result = await loadLatestRows({ preferCache: true });
  } catch (error) {
    console.error(error);
    if (showToast) {
      const offlineText = navigator.onLine === false ? " İnternet bağlantısı kapalı görünüyor." : "";
      toast(`Son veri çekilemedi. Bağlantı veya SQL erişimini kontrol edin.${offlineText}`);
    }
    return;
  }

  if (!result.rows.length) {
    renderDataTable();
    if (showToast) toast("Son yüklenen veri bulunamadı.");
    return;
  }

  state.rows = result.rows;
  state.currentPeriod = result.latest.periodKey;
  syncDataPeriodInputs(state.currentPeriod);
  state.selectedRowIds.clear();
  state.pendingSave = false;
  state.pendingFileName = "";
  editingRowId = null;
  if (state.pendingSave) saveCurrentDraft(state.currentPeriod, state.rows, state.pendingFileName);

  renderDataTable();
  showPage("data");

  if (showToast) toast(`Son yüklenen veri açıldı: ${result.latest.periodKey}`);
}


export async function loadSelectedDataPeriod(showToast = false) {
  const year = document.getElementById("dataYearInput")?.value;
  const month = document.getElementById("dataMonthInput")?.value;
  const periodKey = getPeriodKey(year, month);

  let result;

  try {
    result = await loadPeriodRows(periodKey, { preferCache: true });
  } catch (error) {
    console.error(error);
    if (showToast) {
      const offlineText = navigator.onLine === false ? " İnternet bağlantısı kapalı görünüyor." : "";
      toast(`Veri çekilemedi. Bağlantı veya SQL erişimini kontrol edin.${offlineText}`);
    }
    return;
  }

  if (!result.rows.length) {
    state.rows = [];
    state.currentPeriod = periodKey;
    syncDataPeriodInputs(state.currentPeriod);
    state.selectedRowIds.clear();
    state.pendingSave = false;
    state.pendingFileName = "";
    clearCurrentDraft();
    editingRowId = null;
    renderDataTable();
    if (showToast) toast(`${periodKey} döneminde veri bulunamadı.`);
    return;
  }

  state.rows = result.rows;
  state.currentPeriod = periodKey;
  syncDataPeriodInputs(state.currentPeriod);
  state.selectedRowIds.clear();
  state.pendingSave = false;
  state.pendingFileName = "";
  editingRowId = null;

  renderDataTable();
  showPage("data");

  if (showToast) {
    const sourceText = result.source === "cache"
      ? "önbellekten"
      : result.source === "postgres"
        ? "SQL veritabanından"
        : result.source === "postgres-period-key"
          ? "SQL veritabanından"
          : "yerel kayıttan";
    toast(`${periodKey} dönemi ${sourceText} getirildi.`);
  }
}


export function loadDraftData(showToast = false) {
  const draft = loadCurrentDraft();

  if (!draft) {
    if (showToast) toast("Kaydedilmemiş taslak veri bulunamadı.");
    return false;
  }

  state.rows = draft.rows;
  state.currentPeriod = draft.periodKey;
  syncDataPeriodInputs(state.currentPeriod);
  state.pendingSave = true;
  state.pendingFileName = draft.fileName || "";
  state.selectedRowIds.clear();
  editingRowId = null;

  renderDataTable();
  showPage("data");

  if (showToast) toast("Kaydedilmemiş taslak veri açıldı.");
  return true;
}

export function renderDataTable() {
  const box = document.getElementById("dataTable");

  if (!box) return;

  syncDataColumnSearchControls();

  const visibleRows = getVisibleDataRows();
  updateDataColumnSearchCount(visibleRows.length, state.rows.length);
  syncSelectAllRowsControl(visibleRows);
  syncDataPeriodInfo(visibleRows);

  if (!state.rows.length) {
    box.innerHTML = `<div class="empty-state">Henüz veri yüklenmedi.</div>`;
    return;
  }

  if (!visibleRows.length) {
    box.innerHTML = `<div class="empty-state">Seçili arama ölçütleriyle eşleşen veri bulunamadı.</div>`;
    return;
  }

  box.innerHTML = "";

  const table = document.createElement("table");
  table.className = "editor-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th class="col-select" aria-label="Seçim">Seç</th>
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
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");

  visibleRows.forEach(({ row, index }) => {
    tbody.appendChild(row.id === editingRowId ? createEditingRow(row, index) : createDisplayRow(row, index));
  });

  table.appendChild(tbody);
  box.appendChild(table);
}

function setupDataColumnSearch() {
  if (dataColumnSearchBound) return;
  dataColumnSearchBound = true;

  const fieldSelect = document.getElementById("dataFilterFieldSelect");
  const queryInput = document.getElementById("dataFilterQueryInput");
  const clearButton = document.getElementById("clearDataFilterQueryBtn");

  if (fieldSelect) {
    dataColumnSearch.field = getSafeDataSearchField(fieldSelect.value);
    fieldSelect.addEventListener("change", () => {
      dataColumnSearch.field = getSafeDataSearchField(fieldSelect.value);
      state.selectedRowIds.clear();
      renderDataTable();
    });
  }

  if (queryInput) {
    dataColumnSearch.query = queryInput.value || "";
    queryInput.addEventListener("input", () => {
      dataColumnSearch.query = queryInput.value || "";
      state.selectedRowIds.clear();
      renderDataTable();
    });
  }

  clearButton?.addEventListener("click", () => {
    dataColumnSearch.query = "";
    const targetInput = document.getElementById("dataFilterQueryInput");
    if (targetInput) {
      targetInput.value = "";
      try {
        targetInput.focus({ preventScroll: true });
      } catch (error) {
        targetInput.focus();
      }
    }
    state.selectedRowIds.clear();
    renderDataTable();
  });

  syncDataColumnSearchControls();
}

function syncDataColumnSearchControls() {
  const fieldSelect = document.getElementById("dataFilterFieldSelect");
  const queryInput = document.getElementById("dataFilterQueryInput");
  const clearButton = document.getElementById("clearDataFilterQueryBtn");
  const safeField = getSafeDataSearchField(dataColumnSearch.field);

  if (fieldSelect && fieldSelect.value !== safeField) {
    fieldSelect.value = safeField;
  }

  if (queryInput && queryInput.value !== dataColumnSearch.query) {
    queryInput.value = dataColumnSearch.query;
  }

  if (clearButton) {
    clearButton.hidden = !String(dataColumnSearch.query || "").trim();
  }
}

function updateDataColumnSearchCount(visibleCount = 0, totalCount = state.rows.length) {
  const counter = document.getElementById("dataFilterResultCount");
  if (!counter) return;
  counter.textContent = totalCount ? `${visibleCount}/${totalCount} kayıt` : "0 kayıt";
}

function hasActiveDataColumnFilters() {
  return Boolean(normalizeSearchValue(dataColumnSearch.query));
}

function getVisibleDataRows() {
  const entries = state.rows.map((row, index) => ({ row, index }));
  const query = normalizeSearchValue(dataColumnSearch.query);
  const field = getSafeDataSearchField(dataColumnSearch.field);

  if (!query) return entries;

  return entries.filter(({ row }) => normalizeSearchValue(row?.[field]).includes(query));
}

function getSafeDataSearchField(field) {
  return Object.prototype.hasOwnProperty.call(dataColumnSearchLabels, field) ? field : "unvan";
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

function appendDataPeriodInfoPart(fragment, text, className = "") {
  const part = document.createElement("span");
  part.className = className ? `data-period-info-part ${className}` : "data-period-info-part";
  part.textContent = text;
  fragment.appendChild(part);
}

function appendDataPeriodInfoSeparator(fragment) {
  appendDataPeriodInfoPart(fragment, "·", "data-period-info-separator");
}

function syncDataPeriodInfo(visibleRows = getVisibleDataRows()) {
  const info = document.getElementById("dataPeriodInfo");
  if (!info) return;

  if (!state.currentPeriod) {
    info.classList.remove("has-data-period-meta");
    info.textContent = "Son yüklenen veri otomatik getirilecek.";
    return;
  }

  const selected = state.selectedRowIds.size;
  const fragment = document.createDocumentFragment();

  if (state.pendingSave) {
    appendDataPeriodInfoPart(fragment, "SQL’e kaydedilmemiş taslak", "data-period-info-draft");
    appendDataPeriodInfoSeparator(fragment);
  }

  appendDataPeriodInfoPart(fragment, `Dönem: ${state.currentPeriod}`);
  appendDataPeriodInfoSeparator(fragment);
  appendDataPeriodInfoPart(fragment, `Satır: ${state.rows.length}`);

  if (hasActiveDataColumnFilters()) {
    appendDataPeriodInfoSeparator(fragment);
    appendDataPeriodInfoPart(fragment, `Filtreli: ${visibleRows.length}`);
  }

  if (selected) {
    appendDataPeriodInfoSeparator(fragment);
    appendDataPeriodInfoPart(fragment, `Seçili: ${selected}`, "data-period-info-selected");
  }

  info.classList.add("has-data-period-meta");
  info.replaceChildren(fragment);
}

function syncSelectAllRowsControl(visibleRows = getVisibleDataRows()) {
  const selectAll = document.getElementById("selectAllRowsBtn");
  const editBtn = document.getElementById("editSelectedRowBtn");
  const deleteBtn = document.getElementById("deleteSelectedRowsBtn");
  const exportBtn = document.getElementById("exportSelectedRowsBtn");

  const selectableIds = visibleRows.map(({ row }) => row.id).filter(Boolean);
  const selectedCount = selectableIds.filter(id => state.selectedRowIds.has(id)).length;

  if (selectAll) {
    selectAll.checked = selectableIds.length > 0 && selectedCount === selectableIds.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < selectableIds.length;
    selectAll.disabled = selectableIds.length === 0;
  }

  if (editBtn) {
    editBtn.textContent = editingRowId ? "Kaydet" : "Düzenle";
    editBtn.disabled = editingRowId ? false : selectedCount !== 1;
    editBtn.title = editingRowId ? "Düzenlenen satırı kaydet" : "Seçili tek satırı düzenle";
  }

  if (deleteBtn) {
    deleteBtn.disabled = selectedCount === 0;
  }

  if (exportBtn) {
    exportBtn.disabled = selectedCount === 0;
    exportBtn.title = selectedCount ? `${selectedCount} seçili satırı Excel olarak dışa aktar` : "Dışa aktarmak için satır seçin";
  }
}

function createRowSelectCell(row) {
  const checkboxTd = document.createElement("td");
  checkboxTd.className = "col-select";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = row.id ? state.selectedRowIds.has(row.id) : false;
  cb.addEventListener("change", () => {
    if (!row.id) return;
    cb.checked ? state.selectedRowIds.add(row.id) : state.selectedRowIds.delete(row.id);
    const visibleRows = getVisibleDataRows();
    syncSelectAllRowsControl(visibleRows);
    syncDataPeriodInfo(visibleRows);
  });
  checkboxTd.appendChild(cb);
  return checkboxTd;
}

function createDisplayRow(row, index) {
  const tr = document.createElement("tr");
  const issues = row.rowIssues || getPaymentRowIssues(row);
  if (issues.length) { tr.classList.add("has-error"); tr.title = issues.join(", "); }
  tr.dataset.rowId = row.id || "";

  appendCell(tr, createRowSelectCell(row));
  appendTextCell(tr, String(index + 1), "col-index");
  appendTextCell(tr, row.vkn || "");
  appendTextCell(tr, row.unvan || "", "col-wide");
  appendTextCell(tr, row.dagitici || "");
  appendTextCell(tr, row.bayi || "");
  appendTextCell(tr, row.faturaNo || "");
  appendTextCell(tr, dateTR(row.faturaTarihi));
  appendTextCell(tr, money(row.faturaTutari), "col-money");
  appendTextCell(tr, row.tahsilatDurumu || "");
  appendTextCell(tr, dateTR(row.tahsilatTarihi));
  appendTextCell(tr, money(row.toplamTutar || row.tutar), "col-money");

  appendTextCell(tr, issues.length ? issues.join(", ") : "Sorunsuz", issues.length ? "col-issue issue-text" : "col-issue ok-text");

  return tr;
}

function createEditingRow(row, index) {
  const tr = document.createElement("tr");
  tr.className = "is-editing";
  tr.dataset.rowId = row.id || "";

  appendCell(tr, createRowSelectCell(row));
  appendTextCell(tr, String(index + 1), "col-index");

  const inputs = {};
  editableFields.forEach(([key, label]) => {
    const td = document.createElement("td");
    if (key === "unvan") td.className = "col-wide";
    if (["faturaTutari", "toplamTutar"].includes(key)) td.className = "col-money";

    const input = document.createElement(key.includes("Tarihi") ? "input" : "input");
    input.className = "inline-input";
    input.name = key;
    input.value = key.includes("Tarihi") ? dateTR(row[key]) : (row[key] ?? "");
    input.placeholder = label;
    input.type = ["faturaTutari", "toplamTutar"].includes(key) ? "text" : "text";
    if (["faturaTutari", "toplamTutar"].includes(key)) input.inputMode = "decimal";

    inputs[key] = input;
    td.appendChild(input);
    tr.appendChild(td);
  });

  // Tabloda tüm editableFields görünmüyor. Görünür tablo 8 edit hücresi istiyor:
  // Önce oluşturulan fazla hücreleri sadeleştiriyoruz.
  tr.innerHTML = "";
  appendCell(tr, createRowSelectCell(row));
  appendTextCell(tr, String(index + 1), "col-index");

  const visibleKeys = ["vkn", "unvan", "dagitici", "bayi", "faturaNo", "faturaTarihi", "faturaTutari", "tahsilatDurumu", "tahsilatTarihi", "toplamTutar"];
  visibleKeys.forEach(key => {
    const td = document.createElement("td");
    if (key === "unvan") td.className = "col-wide";
    if (["faturaTutari", "toplamTutar"].includes(key)) td.className = "col-money";

    const input = document.createElement("input");
    input.className = "inline-input";
    input.name = key;
    input.value = key.includes("Tarihi") ? dateTR(row[key]) : (row[key] ?? "");
    input.placeholder = editableFields.find(([k]) => k === key)?.[1] || key;
    if (["faturaTutari", "toplamTutar"].includes(key)) input.inputMode = "decimal";
    td.appendChild(input);
    tr.appendChild(td);
  });

  return tr;
}

async function saveInlineRow(row, tr) {
  if (!row.id || !state.currentPeriod) {
    toast("Bu satırın kayıt ID bilgisi yok.");
    return;
  }

  const patch = {};
  tr.querySelectorAll(".inline-input").forEach(input => {
    const key = input.name;
    const current = row[key] ?? "";
    const next = input.value;

    if (String(next) !== String(current)) {
      patch[key] = ["faturaTutari", "toplamTutar"].includes(key) ? safeNumber(next) : sanitizeText(next);
    }
  });

  if (!Object.keys(patch).length) {
    editingRowId = null;
    renderDataTable();
    toast("Değişiklik yapılmadı.");
    return;
  }

  if (patch.toplamTutar !== undefined) patch.tutar = patch.toplamTutar;
  if (patch.unvan !== undefined) patch.musteri = patch.unvan;
  if (patch.faturaTarihi !== undefined) patch.tarih = patch.faturaTarihi;
  if (patch.vkn !== undefined) patch.vknTckn = patch.vkn;

  const mergedRow = { ...row, ...patch };
  if (patch.tahsilatTarihi !== undefined) {
    mergedRow.tahsilatPeriodKey = getPeriodKeyFromDateInput(patch.tahsilatTarihi);
    mergedRow.periodKey = mergedRow.tahsilatPeriodKey || mergedRow.periodKey;
  }
  if (patch.faturaTarihi !== undefined || patch.tarih !== undefined) {
    mergedRow.faturaPeriodKey = getPeriodKeyFromDateInput(patch.faturaTarihi || patch.tarih);
  }

  const updatedRow = await updatePaymentRow(state.currentPeriod, row.id, patch, mergedRow);
  const finalRow = updatedRow && typeof updatedRow === "object" ? updatedRow : mergedRow;
  finalRow.rowIssues = getPaymentRowIssues(finalRow);
  finalRow.hasIssue = finalRow.rowIssues.length > 0;

  const nextTahsilatPeriod = finalRow.tahsilatPeriodKey || getPeriodKeyFromDateInput(finalRow.tahsilatTarihi);
  const rowIndex = state.rows.findIndex(item => item.id === row.id);
  if (rowIndex !== -1) {
    if (nextTahsilatPeriod && nextTahsilatPeriod !== state.currentPeriod) {
      state.rows.splice(rowIndex, 1);
    } else {
      state.rows[rowIndex] = { ...row, ...finalRow };
    }
  } else {
    Object.assign(row, finalRow);
  }

  editingRowId = null;
  if (state.pendingSave) saveCurrentDraft(state.currentPeriod, state.rows, state.pendingFileName);
  renderDataTable();
  toast(nextTahsilatPeriod && nextTahsilatPeriod !== state.currentPeriod ? "Satır güncellendi ve yeni tahsilat dönemine taşındı." : "Satır güncellendi.");
}

async function editSelectedRow() {
  if (editingRowId) {
    const row = state.rows.find(item => item.id === editingRowId);
    const tr = document.querySelector("#dataTable tr.is-editing");

    if (!row || !tr) {
      editingRowId = null;
      renderDataTable();
      return;
    }

    await saveInlineRow(row, tr);
    return;
  }

  const ids = [...state.selectedRowIds];

  if (!ids.length) return toast("Düzenlemek için satır seçilmedi.");
  if (ids.length > 1) return toast("Düzenlemek için sadece bir satır seçin.");

  const row = state.rows.find(item => item.id === ids[0]);
  if (!row?.id) return toast("Bu satırın kayıt ID bilgisi yok.");

  editingRowId = row.id;
  renderDataTable();
}

async function deleteOneRow(row) {
  if (!row.id || !state.currentPeriod) return toast("Bu satırın kayıt ID bilgisi yok.");
  if (!confirm("Bu satır silinsin mi?")) return;

  await deletePaymentRows(state.currentPeriod, [row.id]);
  state.rows = state.rows.filter(r => r.id !== row.id);
  state.selectedRowIds.delete(row.id);
  if (state.pendingSave) saveCurrentDraft(state.currentPeriod, state.rows, state.pendingFileName);

  renderDataTable();
  toast("Satır silindi.");
}

async function deleteSelectedRows() {
  const ids = [...state.selectedRowIds];

  if (!ids.length) return toast("Silmek için satır seçilmedi.");
  if (!state.currentPeriod) return toast("Aktif dönem bilgisi yok.");
  if (!confirm(`${ids.length} satır silinsin mi?`)) return;

  const progressRunId = beginDataDeleteProgress("Siliniyor…");
  await nextFrame();
  try {
    await deletePaymentRows(state.currentPeriod, ids, { onProgress: handleDataDeleteProgress });
    state.rows = state.rows.filter(row => !ids.includes(row.id));
    if (editingRowId && ids.includes(editingRowId)) editingRowId = null;
    state.selectedRowIds.clear();
    if (state.pendingSave) saveCurrentDraft(state.currentPeriod, state.rows, state.pendingFileName);

    renderDataTable();
    await finishDataDeleteProgress("Silindi", progressRunId);
  } catch (error) {
    hideDataDeleteProgress(progressRunId);
    console.error(error);
    toast("Silme işlemi tamamlanamadı. Bağlantı veya SQL erişimini kontrol edin.");
  }
}

function isMobileExcelShareContext() {
  try {
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
    return window.innerWidth <= 767 || standalone;
  } catch {
    return window.innerWidth <= 767;
  }
}

function safeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "veriler";
}

function selectedDataRowsForExport() {
  const ids = new Set(state.selectedRowIds);
  return state.rows.filter(row => row?.id && ids.has(row.id));
}

function mapDataRowForExcel(row) {
  return {
    VKN: row.vkn ?? row.vknTckn ?? "",
    UNVAN: row.unvan ?? row.musteri ?? "",
    DAGITICI: row.dagitici ?? "",
    BAYI: row.bayi ?? "",
    FATURA_NO: row.faturaNo ?? "",
    FATURA_TARIHI: row.faturaTarihi ?? row.tarih ?? "",
    FATURA_TUTARI: row.faturaTutari ?? "",
    TAHSILAT_DURUMU: row.tahsilatDurumu ?? "",
    TAHSILAT_TARIHI: row.tahsilatTarihi ?? "",
    TOPLAM_TUTAR: row.toplamTutar ?? row.tutar ?? ""
  };
}

function buildSelectedRowsWorkbook(rows) {
  const wb = XLSX.utils.book_new();
  const headers = [
    "VKN",
    "UNVAN",
    "DAGITICI",
    "BAYI",
    "FATURA_NO",
    "FATURA_TARIHI",
    "FATURA_TUTARI",
    "TAHSILAT_DURUMU",
    "TAHSILAT_TARIHI",
    "TOPLAM_TUTAR"
  ];
  const ws = XLSX.utils.json_to_sheet(rows.map(mapDataRowForExcel), { header: headers });
  ws["!cols"] = [
    { wch: 16 },
    { wch: 34 },
    { wch: 22 },
    { wch: 24 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 20 },
    { wch: 16 },
    { wch: 16 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, "veriler");
  return wb;
}

function workbookToExcelFile(wb, filename) {
  const arrayBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([arrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  return new File([blob], filename, { type: blob.type });
}

async function shareExcelFile(file) {
  if (!navigator.share || typeof File === "undefined") return false;

  const payload = { files: [file] };
  if (navigator.canShare && !navigator.canShare(payload)) return false;

  await navigator.share(payload);
  return true;
}

async function exportSelectedRowsToExcel() {
  const rows = selectedDataRowsForExport();

  if (!rows.length) {
    toast("Dışa aktarmak için satır seçin.");
    return;
  }

  if (typeof XLSX === "undefined") {
    toast("Excel dışa aktarma kütüphanesi yüklenemedi.");
    return;
  }

  const filename = `dikesoft-veriler-${safeFilePart(state.currentPeriod || "secili")}-${rows.length}-satir.xlsx`;
  const wb = buildSelectedRowsWorkbook(rows);

  if (isMobileExcelShareContext()) {
    try {
      const file = workbookToExcelFile(wb, filename);
      const shared = await shareExcelFile(file);
      if (shared) {
        toast(`${rows.length} satır Excel dosyası olarak hazırlandı.`);
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Excel dosya paylaşımı başarısız, varsayılan indirme akışına dönülüyor:", error);
    }
  }

  XLSX.writeFile(wb, filename);
  toast(`${rows.length} satır Excel olarak dışa aktarıldı.`);
}

async function deleteAllVisibleRows() {
  const ids = state.rows.map(row => row.id).filter(Boolean);

  if (!ids.length) return toast("Silinecek kayıt yok.");
  if (!state.currentPeriod) return toast("Aktif dönem bilgisi yok.");
  if (!confirm(`Ekrandaki ${ids.length} satırın tamamı silinsin mi?`)) return;

  const progressRunId = beginDataDeleteProgress("Siliniyor…");
  await nextFrame();
  try {
    await deletePaymentRows(state.currentPeriod, ids, { onProgress: handleDataDeleteProgress });
    state.rows = [];
    state.selectedRowIds.clear();
    state.pendingSave = false;
    state.pendingFileName = "";
    editingRowId = null;

    renderDataTable();
    await finishDataDeleteProgress("Silindi", progressRunId);
  } catch (error) {
    hideDataDeleteProgress(progressRunId);
    console.error(error);
    toast("Silme işlemi tamamlanamadı. Bağlantı veya SQL erişimini kontrol edin.");
  }
}


async function saveCurrentRowsToSql() {
  if (!state.rows.length) {
    toast("Kaydedilecek veri yok.");
    return;
  }

  if (!state.currentPeriod) {
    toast("Dönem bilgisi bulunamadı.");
    return;
  }

  // Veri Getir ile SQL'den gelen satırlar zaten kayıtlıdır.
  // Kaydet butonu bu durumda aynı satırları tekrar insert etmemeli.
  if (!state.pendingSave) {
    clearCurrentDraft();
    toast("Veri güncellendi.");
    return;
  }

  const draftRows = state.rows.filter(row => {
    const id = String(row.id || "");
    return !id || id.startsWith("draft-");
  });

  if (!draftRows.length) {
    state.pendingSave = false;
    state.pendingFileName = "";
    clearCurrentDraft();
    toast("Veri güncellendi.");
    return;
  }

  if (!confirm(`${state.currentPeriod} dönemi için ${draftRows.length} yeni satır SQL veritabanına kaydedilsin mi?`)) {
    return;
  }

  try {
    const rowsForSave = draftRows.map(({ id, periodKey, importBatchId, sourceFileName, ...row }) => row);
    const saved = await savePeriodToCloud(state.currentPeriod, rowsForSave, {
      fileName: state.pendingFileName || draftRows[0]?.sourceFileName || ""
    });

    state.rows = saved.rows?.length ? saved.rows : state.rows;
    state.pendingSave = false;
    state.pendingFileName = "";
    clearCurrentDraft();
    state.selectedRowIds.clear();
    editingRowId = null;

    renderDataTable();
      toast("İçe aktarılan veriler SQL veritabanına kaydedildi.");
  } catch (error) {
    console.error(error);
    toast(`Kaydetme hatası: ${error.message || error}`);
  }
}


function appendTextCell(tr, text, className = "") {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text ?? "";
  tr.appendChild(td);
}

function appendCell(tr, td) {
  tr.appendChild(td);
}

function button(text, className, handler) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener("click", handler);
  return btn;
}
