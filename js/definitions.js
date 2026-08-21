/*
  definitions.js
  Görev: Kanal, bayi ve mail tanımları.
  Mantık:
  - Kanal Tanımı: DAGITICI/Kanal + KP
  - Bayi Tanımı: DAGITICI/Kanal + BAYI + BP
  - Mail Tanımı: BAYI + EMAIL
*/
import { state } from "./state.js";
import { sanitizeText, safeNumber, normalizeName } from "./security.js";
import { isValidEmail } from "./validators.js";
import { toast } from "./ui.js";
import { readWorkbook } from "./import-excel.js";
import { saveDefinitionsToCloud, loadDefinitionsFromCloud } from "./cloud.js";

let editing = { type: "", index: -1 };

const selectedDefinitions = {
  channels: new Set(),
  dealers: new Set(),
  mails: new Set()
};

let activeDefinitionView = "channels";


const definitionSearchState = {
  channels: { field: "kanal", query: "" },
  dealers: { field: "kanal", query: "" },
  mails: { field: "bayi", query: "" }
};

const definitionSearchOptions = {
  channels: [{ value: "kanal", label: "DAGITICI / Kanal" }],
  dealers: [
    { value: "kanal", label: "DAGITICI / Kanal" },
    { value: "bayi", label: "BAYI" }
  ],
  mails: [{ value: "bayi", label: "BAYI" }]
};


const definitionColumnWidths = {
  channels: { table: 340, kanal: 190, kp: 96 },
  dealers: { table: 560, kanal: 180, bayi: 230, bp: 96 },
  mails: { table: 520, bayi: 210, email: 256 }
};

function getDefinitionTableWidth(type) {
  return `${definitionColumnWidths[type]?.table || 520}px`;
}

function getDefinitionColumnWidth(type, key) {
  return `${definitionColumnWidths[type]?.[key] || 180}px`;
}

function createDefinitionColGroup(type, columns) {
  const colgroup = document.createElement("colgroup");
  const selectCol = document.createElement("col");
  selectCol.className = "definition-col-select";
  selectCol.style.width = "54px";
  colgroup.appendChild(selectCol);

  columns.forEach(col => {
    const column = document.createElement("col");
    column.className = `definition-col-${col.key}`;
    column.style.width = getDefinitionColumnWidth(type, col.key);
    colgroup.appendChild(column);
  });

  return colgroup;
}

const definitionTableConfig = {
  channels: {
    containerId: "channelsTable",
    columns: [
      { key: "kanal", label: "DAGITICI / Kanal" },
      { key: "kp", label: "Kanal Payı", type: "number" }
    ]
  },
  dealers: {
    containerId: "dealersTable",
    columns: [
      { key: "kanal", label: "DAGITICI / Kanal" },
      { key: "bayi", label: "BAYI" },
      { key: "bp", label: "Bayi Payı", type: "number" }
    ]
  },
  mails: {
    containerId: "mailsTable",
    columns: [
      { key: "bayi", label: "BAYI" },
      { key: "email", label: "EMAIL" }
    ]
  }
};

function normalizeDefinitionSearch(value) {
  return String(value ?? "")
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I")
    .replace(/İ/g, "I")
    .replace(/\s+/g, " ")
    .trim();
}

function getDefinitionSearchLabel(type) {
  const search = definitionSearchState[type] || {};
  const options = definitionSearchOptions[type] || [];
  return options.find(option => option.value === search.field)?.label || "Arama";
}

function getFilteredDefinitionItems(type, rows = []) {
  const search = definitionSearchState[type] || { field: "", query: "" };
  const field = search.field || definitionSearchOptions[type]?.[0]?.value || "";
  const query = normalizeDefinitionSearch(search.query);
  const items = (Array.isArray(rows) ? rows : []).map((row, index) => ({ row, index }));

  if (!query) return items;

  return items.filter(({ row }) => normalizeDefinitionSearch(row?.[field]).includes(query));
}

function focusDefinitionSearchInput(type) {
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-definition-search-input="${type}"]`);
    if (!input) return;
    input.focus({ preventScroll: true });
    const length = input.value.length;
    try { input.setSelectionRange(length, length); } catch (_) {}
  });
}

function resetDefinitionSelectionForSearch(type) {
  selectedDefinitions[type]?.clear();
  if (editing.type === type) editing = { type: "", index: -1 };
}

function createDefinitionSearchBar(type, totalCount, visibleCount) {
  const options = definitionSearchOptions[type] || [];
  const search = definitionSearchState[type] || { field: options[0]?.value || "", query: "" };
  if (!definitionSearchState[type]) definitionSearchState[type] = search;
  if (!search.field) search.field = options[0]?.value || "";

  const bar = document.createElement("div");
  bar.className = `definition-searchbar definition-searchbar-${type}${options.length > 1 ? " has-field-select" : " is-single-field"}`;
  bar.setAttribute("role", "search");
  bar.setAttribute("aria-label", `${type} tanımları arama`);

  if (options.length > 1) {
    const selectLabel = document.createElement("label");
    selectLabel.className = "definition-search-field definition-search-select";
    const selectCaption = document.createElement("span");
    selectCaption.textContent = "Arama Alanı";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Arama yapılacak tanım alanını seç");
    options.forEach(option => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      opt.selected = option.value === search.field;
      select.appendChild(opt);
    });
    select.addEventListener("change", event => {
      search.field = event.target.value;
      resetDefinitionSelectionForSearch(type);
      renderDefinitions();
      focusDefinitionSearchInput(type);
    });
    selectLabel.append(selectCaption, select);
    bar.appendChild(selectLabel);
  }

  const queryLabel = document.createElement("label");
  queryLabel.className = "definition-search-field definition-search-query";
  const queryCaption = document.createElement("span");
  queryCaption.textContent = options.length > 1 ? "Arama" : getDefinitionSearchLabel(type);

  const control = document.createElement("span");
  control.className = "definition-search-control";

  const input = document.createElement("input");
  input.type = "search";
  input.autocomplete = "off";
  input.inputMode = "search";
  input.value = search.query || "";
  input.placeholder = options.length > 1 ? "Seçili alanda ara" : `${getDefinitionSearchLabel(type)} ara`;
  input.setAttribute("aria-label", `${getDefinitionSearchLabel(type)} alanında ara`);
  input.setAttribute("data-definition-search-input", type);
  input.addEventListener("input", event => {
    search.query = event.target.value;
    resetDefinitionSelectionForSearch(type);
    renderDefinitions();
  });

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "definition-search-clear";
  clear.textContent = "×";
  clear.title = "Aramayı temizle";
  clear.setAttribute("aria-label", "Aramayı temizle");
  clear.hidden = !search.query;

  let lastClearAt = 0;
  const clearDefinitionSearch = event => {
    event.preventDefault();
    event.stopPropagation();

    const now = Date.now();
    if (now - lastClearAt < 180) {
      try { input.focus({ preventScroll: true }); } catch (_) {}
      return;
    }
    lastClearAt = now;

    if (!search.query && !input.value) {
      try { input.focus({ preventScroll: true }); } catch (_) {}
      return;
    }

    search.query = "";
    input.value = "";
    clear.hidden = true;
    resetDefinitionSelectionForSearch(type);
    refreshDefinitionResults(type);

    requestAnimationFrame(() => {
      try {
        input.focus({ preventScroll: true });
        input.setSelectionRange(0, 0);
      } catch (_) {
        focusDefinitionSearchInput(type);
      }
    });
  };

  clear.addEventListener("pointerdown", clearDefinitionSearch);
  clear.addEventListener("mousedown", event => {
    if (event.pointerType) return;
    clearDefinitionSearch(event);
  });
  clear.addEventListener("touchstart", event => {
    if (window.PointerEvent) return;
    clearDefinitionSearch(event);
  }, { passive: false });
  clear.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    try { input.focus({ preventScroll: true }); } catch (_) {}
  });

  control.append(input, clear);
  queryLabel.append(queryCaption, control);
  bar.appendChild(queryLabel);

  const counter = document.createElement("div");
  counter.className = "definition-search-count";
  counter.textContent = totalCount ? `${visibleCount}/${totalCount} kayıt` : "Kayıt yok";
  bar.appendChild(counter);

  return bar;
}


function setupDefinitionTableScrollGuard(scrollHost) {
  if (!scrollHost) return;
  scrollHost.dataset.definitionScrollGuard = "css-boundary";
}


function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal?.open) modal.close();
}

function resetAndClose(form, modalId) {
  form.reset();
  closeModal(modalId);
}

let definitionSaveProgressRunId = 0;
let definitionSaveProgressTimer = null;

function getDefinitionSaveProgressElements() {
  return {
    box: document.getElementById("definitionSaveProgress"),
    text: document.getElementById("definitionSaveProgressText"),
    percent: document.getElementById("definitionSaveProgressPercent"),
    fill: document.getElementById("definitionSaveProgressFill")
  };
}

function showDefinitionSaveProgress(message = "Kaydediliyor…") {
  const runId = ++definitionSaveProgressRunId;
  clearTimeout(definitionSaveProgressTimer);
  const { box, text, percent, fill } = getDefinitionSaveProgressElements();
  if (!box) return runId;
  box.classList.remove("hidden", "is-complete", "is-error");
  box.classList.add("is-running");
  box.setAttribute("aria-hidden", "false");
  if (text) text.textContent = message;
  if (percent) percent.textContent = "35%";
  if (fill) fill.style.width = "35%";
  requestAnimationFrame(() => {
    if (definitionSaveProgressRunId !== runId) return;
    if (percent) percent.textContent = "75%";
    if (fill) fill.style.width = "75%";
  });
  return runId;
}

function completeDefinitionSaveProgress(message = "Kaydedildi", runId = definitionSaveProgressRunId) {
  if (runId !== definitionSaveProgressRunId) return;
  const { box, text, percent, fill } = getDefinitionSaveProgressElements();
  if (!box) {
    toast(message);
    return;
  }
  box.classList.remove("is-running", "is-error");
  box.classList.add("is-complete");
  if (text) text.textContent = message;
  if (percent) percent.textContent = "100%";
  if (fill) fill.style.width = "100%";
  definitionSaveProgressTimer = setTimeout(() => {
    if (runId !== definitionSaveProgressRunId) return;
    box.classList.add("hidden");
    box.setAttribute("aria-hidden", "true");
  }, 850);
}

function failDefinitionSaveProgress(message, runId = definitionSaveProgressRunId) {
  if (runId !== definitionSaveProgressRunId) return;
  const { box, text, percent, fill } = getDefinitionSaveProgressElements();
  if (!box) {
    toast(message);
    return;
  }
  box.classList.remove("is-running", "is-complete");
  box.classList.add("is-error");
  if (text) text.textContent = message;
  if (percent) percent.textContent = "!";
  if (fill) fill.style.width = "100%";
  definitionSaveProgressTimer = setTimeout(() => {
    if (runId !== definitionSaveProgressRunId) return;
    box.classList.add("hidden");
    box.setAttribute("aria-hidden", "true");
  }, 1800);
}

async function createDefinitionRecord({ form, modalId, type, row, successMessage, errorPrefix }) {
  if (!form || !row || !Array.isArray(state[type])) return;

  resetAndClose(form, modalId);
  const progressRunId = showDefinitionSaveProgress("Kaydediliyor…");

  state[type].push(row);
  activeDefinitionView = type;

  try {
    const result = await persistDefinitionsToSql();
    document.dispatchEvent(new CustomEvent("dikesoft:definitions-saved", {
      detail: { channelCount: result.channelCount, dealerCount: result.dealerCount, mailCount: result.mailCount }
    }));

    renderDefinitions();
    completeDefinitionSaveProgress("Kaydedildi", progressRunId);
  } catch (error) {
    state[type] = state[type].filter(item => item.id !== row.id);
    console.error(error);
    renderDefinitions();
    failDefinitionSaveProgress(`${errorPrefix || "Tanım"} kaydedilemedi`, progressRunId);
    toast(`${errorPrefix || "Tanım"} SQL’e kaydedilemedi: ${error.message || error}`);
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pick(row, keys, fallback = "") {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return fallback;
}

function normalizeImportedRow(row) {
  const normalized = {};

  Object.keys(row || {}).forEach(key => {
    const normalizedKey = String(key)
      .trim()
      .toLocaleUpperCase("tr-TR")
      .replace(/İ/g, "I")
      .replace(/İ/g, "I")
      .replace(/Ğ/g, "G")
      .replace(/Ü/g, "U")
      .replace(/Ş/g, "S")
      .replace(/Ö/g, "O")
      .replace(/Ç/g, "C")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/[^A-Z0-9_]/g, "")
      .replace(/^_+|_+$/g, "");

    normalized[normalizedKey] = row[key];
  });

  return normalized;
}


function dealerDefinitionKey(row = {}) {
  const bayiKey = normalizeName(row.bayi || row.BAYI || row.bayiKey || "");
  if (!bayiKey) return "";

  const channelKey = normalizeName(row.kanal || row.DAGITICI || row.KANAL || "");
  return `${channelKey || "__KANAL_YOK__"}::${bayiKey}`;
}

function mergeImportedDefinitionRows(type, currentRows = [], importedRows = [], makeKey) {
  const idPrefixes = {
    channels: "kanal",
    dealers: "bayi",
    mails: "mail"
  };

  const prefix = idPrefixes[type] || "tanim";
  const rows = (Array.isArray(currentRows) ? currentRows : []).map(row => ({
    ...row,
    id: row.id || makeId(prefix)
  }));

  const indexByKey = new Map();

  rows.forEach((row, index) => {
    const key = makeKey(row);
    if (key && !indexByKey.has(key)) indexByKey.set(key, index);
  });

  const stats = { added: 0, updated: 0 };

  (Array.isArray(importedRows) ? importedRows : []).forEach(importedRow => {
    const key = makeKey(importedRow);
    if (!key) return;

    if (indexByKey.has(key)) {
      const index = indexByKey.get(key);
      const existingRow = rows[index] || {};
      rows[index] = {
        ...existingRow,
        ...importedRow,
        id: existingRow.id || importedRow.id || makeId(prefix)
      };
      stats.updated += 1;
      return;
    }

    const row = {
      ...importedRow,
      id: importedRow.id || makeId(prefix)
    };

    rows.push(row);
    indexByKey.set(key, rows.length - 1);
    stats.added += 1;
  });

  return { rows, stats };
}

function showDefinitionView(type) { return; }

export async function loadDefinitionsFromSql({ notify = false } = {}) {
  try {
    const loaded = await loadDefinitionsFromCloud();

    state.channels = loaded.channels || [];
    state.dealers = loaded.dealers || [];
    state.mails = loaded.mails || [];

    renderDefinitions();
    document.dispatchEvent(new CustomEvent("dikesoft:definitions-loaded", {
      detail: { channelCount: state.channels.length, dealerCount: state.dealers.length, mailCount: state.mails.length }
    }));

    if (notify) {
      toast(`Tanımlar SQL’den yüklendi. Kanal: ${state.channels.length}, Bayi: ${state.dealers.length}, Mail: ${state.mails.length}`);
    }

    return loaded;
  } catch (error) {
    console.warn("Tanımlar SQL’den yüklenemedi:", error);
    if (notify) toast(`Tanımlar yüklenemedi: ${error.message || error}`);
    return { channels: [], dealers: [], mails: [] };
  }
}

export function setupDefinitionForms() {
  document.querySelectorAll("[data-open-modal]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.definitionView) showDefinitionView(btn.dataset.definitionView);
      const modal = document.getElementById(btn.dataset.openModal);
      if (modal && !modal.open) modal.showModal();
    });
  });

  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  document.querySelectorAll("dialog.modal").forEach(dialog => {
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
  });

  document.getElementById("channelForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);

    await createDefinitionRecord({
      form,
      modalId: "channelModal",
      type: "channels",
      row: {
        id: makeId("kanal"),
        kanal: sanitizeText(fd.get("channelName")),
        kp: safeNumber(fd.get("kpRate"))
      },
      successMessage: "Kanal kaydedildi.",
      errorPrefix: "Kanal"
    });
  });

  document.getElementById("dealerForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const bayi = sanitizeText(fd.get("dealerName"));

    await createDefinitionRecord({
      form,
      modalId: "dealerModal",
      type: "dealers",
      row: {
        id: makeId("bayi"),
        bayi,
        bayiKey: normalizeName(bayi),
        kanal: sanitizeText(fd.get("channelName")),
        bp: safeNumber(fd.get("bpRate"))
      },
      successMessage: "Bayi kaydedildi.",
      errorPrefix: "Bayi"
    });
  });

  document.getElementById("mailForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const bayi = sanitizeText(fd.get("dealerName"));
    const email = sanitizeText(fd.get("email"));

    if (!isValidEmail(email)) {
      toast("Mail adresi geçersiz.");
      return;
    }

    await createDefinitionRecord({
      form,
      modalId: "mailModal",
      type: "mails",
      row: {
        id: makeId("mail"),
        bayi,
        bayiKey: normalizeName(bayi),
        email
      },
      successMessage: "Mail tanımı kaydedildi.",
      errorPrefix: "Mail tanımı"
    });
  });

  document.getElementById("exportDefinitionsBtn")?.addEventListener("click", exportDefinitions);
  setupTemplateDownload();
  document.getElementById("importDefinitionsBtn")?.addEventListener("click", () => document.getElementById("definitionsFileInput")?.click());
  document.getElementById("definitionsFileInput")?.addEventListener("change", importDefinitions);
  document.getElementById("saveDefinitionsToSqlBtn")?.addEventListener("click", saveDefinitionsToSql);
  document.getElementById("loadDefinitionsFromSqlBtn")?.addEventListener("click", () => loadDefinitionsFromSql({ notify: true }));

  renderDefinitions();
  showDefinitionView(activeDefinitionView);
  document.dispatchEvent(new CustomEvent("dikesoft:definitions-rendered", { detail: { view: activeDefinitionView } }));
}

export function renderDefinitions() {
  Object.entries(definitionTableConfig).forEach(([type, config]) => {
    renderEditableTable(config.containerId, type, config.columns);
  });

  showDefinitionView(activeDefinitionView);
}


function refreshDefinitionResults(type) {
  const config = definitionTableConfig[type];
  if (!config) return renderDefinitions();

  const container = document.getElementById(config.containerId);
  const shell = container?.querySelector(".definition-table-shell");
  if (!container || !shell) {
    renderEditableTable(config.containerId, type, config.columns);
    return;
  }

  const allRows = state[type] || [];
  const visibleItems = getFilteredDefinitionItems(type, allRows);
  const rows = visibleItems.map(item => item.row);

  const counter = shell.querySelector(".definition-search-count");
  if (counter) counter.textContent = allRows.length ? `${rows.length}/${allRows.length} kayıt` : "Kayıt yok";

  const clear = shell.querySelector(".definition-search-clear");
  if (clear) clear.hidden = !(definitionSearchState[type]?.query);

  const previousActionBar = shell.querySelector(".definition-table-action-bar");
  const previousWrapper = shell.querySelector(".definition-table-wrap");
  const previousScrollTop = previousWrapper?.scrollTop || 0;
  const previousScrollLeft = previousWrapper?.scrollLeft || 0;

  previousActionBar?.remove();
  previousWrapper?.remove();

  const { actionBar, wrapper } = createDefinitionActionAndTable(type, config.columns, allRows, visibleItems);
  const searchbar = shell.querySelector(".definition-searchbar");
  if (searchbar?.nextSibling) {
    shell.insertBefore(actionBar, searchbar.nextSibling);
  } else {
    shell.appendChild(actionBar);
  }
  shell.appendChild(wrapper);

  requestAnimationFrame(() => {
    if (wrapper.scrollHeight > wrapper.clientHeight) wrapper.scrollTop = previousScrollTop;
    if (wrapper.scrollWidth > wrapper.clientWidth) wrapper.scrollLeft = previousScrollLeft;
  });
}

function createDefinitionActionAndTable(type, columns, allRows, visibleItems) {
  const rows = visibleItems.map(item => item.row);
  if (!selectedDefinitions[type]) selectedDefinitions[type] = new Set();

  const actionBar = document.createElement("div");
  actionBar.className = "definition-table-action-bar";

  const wrapper = document.createElement("div");
  wrapper.className = "definition-table-wrap definition-mobile-scroll-wrap data-editor-like-scroll";
  wrapper.setAttribute("data-scroll-axis", "xy");
  wrapper.style.overflowX = "auto";
  wrapper.style.overflowY = "auto";
  wrapper.style.webkitOverflowScrolling = "touch";
  wrapper.style.touchAction = "pan-x pan-y";
  wrapper.style.overscrollBehavior = "contain";
  setupDefinitionTableScrollGuard(wrapper);

  const modalIdByType = {
    channels: "channelModal",
    dealers: "dealerModal",
    mails: "mailModal"
  };

  const currentRowIds = visibleItems.map(({ row, index }) => row.id || String(index));
  const allRowsSelected = currentRowIds.length > 0 && currentRowIds.every(id => selectedDefinitions[type].has(id));
  const selectedCount = currentRowIds.filter(id => selectedDefinitions[type].has(id)).length;
  const isEditingThisTable = editing.type === type && editing.index >= 0;
  const isEditingOtherTable = editing.type && editing.type !== type;

  const selectAllToggle = document.createElement("label");
  selectAllToggle.className = "definition-select-all-toggle";
  selectAllToggle.title = "Görünen kayıtları seç";

  const selectAllCheckbox = document.createElement("input");
  selectAllCheckbox.type = "checkbox";
  selectAllCheckbox.checked = allRowsSelected;
  selectAllCheckbox.disabled = currentRowIds.length === 0;
  selectAllCheckbox.setAttribute("aria-label", "Görünen kayıtları seç");
  selectAllCheckbox.addEventListener("change", () => {
    if (selectAllCheckbox.checked) {
      currentRowIds.forEach(id => selectedDefinitions[type].add(id));
    } else {
      currentRowIds.forEach(id => selectedDefinitions[type].delete(id));
    }
    wrapper.querySelectorAll('td.definition-select-col input[type="checkbox"]').forEach(cb => {
      cb.checked = selectAllCheckbox.checked;
    });
    syncDefinitionSelectionControls();
  });
  selectAllToggle.appendChild(selectAllCheckbox);

  function syncDefinitionSelectionControls() {
    const selectedCountNow = currentRowIds.filter(id => selectedDefinitions[type].has(id)).length;
    selectAllCheckbox.checked = currentRowIds.length > 0 && selectedCountNow === currentRowIds.length;
    selectAllCheckbox.indeterminate = selectedCountNow > 0 && selectedCountNow < currentRowIds.length;
    selectAllCheckbox.disabled = currentRowIds.length === 0;
    editSelected.disabled = isEditingOtherTable || (!isEditingThisTable && selectedCountNow !== 1);
    deleteSelected.disabled = selectedCountNow === 0;
  }

  const editSelected = actionButton(isEditingThisTable ? "Kaydet" : "Düzenle", "btn btn-soft mini-btn definition-edit-selected-btn", () => editSelectedDefinitionRow(type, columns));
  editSelected.disabled = isEditingOtherTable || (!isEditingThisTable && selectedCount !== 1);
  editSelected.title = isEditingThisTable ? "Düzenlenen tanımı kaydet" : "Seçili tek tanımı düzenle";

  const deleteSelected = actionButton("Sil", "btn btn-danger mini-btn", () => deleteSelectedDefinitionRows(type));
  deleteSelected.disabled = selectedCount === 0;

  const addNew = actionButton("+Yeni", "btn btn-primary mini-btn definition-add-btn", () => {
    const modal = document.getElementById(modalIdByType[type]);
    if (modal && !modal.open) modal.showModal();
  });

  actionBar.append(selectAllToggle, editSelected, deleteSelected, addNew);

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = allRows.length ? "Arama sonucunda kayıt bulunamadı." : "Henüz kayıt yok.";
    wrapper.appendChild(empty);
    return { actionBar, wrapper };
  }

  const table = document.createElement("table");
  table.className = "definition-edit-table";
  table.setAttribute("data-definition-edit-table", type);
  table.style.minWidth = getDefinitionTableWidth(type);
  table.style.width = getDefinitionTableWidth(type);
  table.style.tableLayout = "fixed";
  table.appendChild(createDefinitionColGroup(type, columns));

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th class="definition-select-col" aria-label="Seçim" title="Seç">Seç</th>
      ${columns.map(col => `<th class="definition-cell definition-cell-${col.key}" title="${col.label}">${col.label}</th>`).join("")}
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  visibleItems.forEach(({ row, index }) => {
    const tr = document.createElement("tr");
    const rowIsEditing = editing.type === type && editing.index === index;
    if (rowIsEditing) tr.classList.add("is-editing");
    const rowId = row.id || String(index);

    const selectTd = document.createElement("td");
    selectTd.className = "definition-select-col";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "definition-row-checkbox";
    checkbox.setAttribute("aria-label", "Satırı seç");
    checkbox.checked = selectedDefinitions[type].has(rowId);
    checkbox.addEventListener("change", () => {
      checkbox.checked ? selectedDefinitions[type].add(rowId) : selectedDefinitions[type].delete(rowId);
      syncDefinitionSelectionControls();
    });
    selectTd.appendChild(checkbox);
    tr.appendChild(selectTd);

    columns.forEach(col => {
      const td = document.createElement("td");
      td.className = `definition-cell definition-cell-${col.key}`;
      const cellValue = row[col.key] ?? "";
      td.title = String(cellValue);
      if (rowIsEditing) {
        const input = document.createElement("input");
        input.className = "definition-inline-input";
        input.name = col.key;
        input.value = row[col.key] ?? "";
        input.inputMode = col.type === "number" ? "decimal" : "text";
        td.appendChild(input);
      } else {
        td.textContent = cellValue;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);
  return { actionBar, wrapper };
}

function renderEditableTable(containerId, type, columns) {
  const container = document.getElementById(containerId);
  const allRows = state[type] || [];
  const visibleItems = getFilteredDefinitionItems(type, allRows);
  const rows = visibleItems.map(item => item.row);
  if (!container) return;

  const existingScrollHost = container.querySelector(".definition-table-wrap") || container;
  const previousScrollTop = existingScrollHost.scrollTop || 0;
  const previousScrollLeft = existingScrollHost.scrollLeft || 0;
  const activeElement = document.activeElement;
  const preserveActiveSearch = activeElement?.getAttribute?.("data-definition-search-input") === type;
  const existingShell = container.querySelector(".definition-table-shell");
  const existingSearchBar = preserveActiveSearch ? existingShell?.querySelector(`.definition-searchbar-${type}`) : null;
  let activeScrollHost = null;
  const restoreDefinitionTableScroll = () => {
    requestAnimationFrame(() => {
      const scrollHost = activeScrollHost || container.querySelector(".definition-table-wrap") || container;
      if (!scrollHost) return;
      const canScrollY = scrollHost.scrollHeight > scrollHost.clientHeight;
      const canScrollX = scrollHost.scrollWidth > scrollHost.clientWidth;
      if (canScrollY) scrollHost.scrollTop = previousScrollTop;
      if (canScrollX) scrollHost.scrollLeft = previousScrollLeft;
    });
  };

  if (!selectedDefinitions[type]) selectedDefinitions[type] = new Set();

  const shell = existingSearchBar ? existingShell : document.createElement("div");
  shell.className = "definition-table-shell";

  if (existingSearchBar) {
    const counter = existingSearchBar.querySelector(".definition-search-count");
    if (counter) counter.textContent = allRows.length ? `${rows.length}/${allRows.length} kayıt` : "Kayıt yok";

    const clear = existingSearchBar.querySelector(".definition-search-clear");
    if (clear) clear.hidden = !definitionSearchState[type]?.query;

    shell.querySelectorAll(":scope > .definition-table-action-bar, :scope > .definition-table-wrap").forEach(node => node.remove());
  } else {
    shell.textContent = "";
    shell.appendChild(createDefinitionSearchBar(type, allRows.length, rows.length));
  }

  const actionBar = document.createElement("div");
  actionBar.className = "definition-table-action-bar";

  const wrapper = document.createElement("div");
  wrapper.className = "definition-table-wrap definition-mobile-scroll-wrap data-editor-like-scroll";
  wrapper.setAttribute("data-scroll-axis", "xy");
  wrapper.style.overflowX = "auto";
  wrapper.style.overflowY = "auto";
  wrapper.style.webkitOverflowScrolling = "touch";
  wrapper.style.touchAction = "pan-x pan-y";
  wrapper.style.overscrollBehavior = "contain";
  setupDefinitionTableScrollGuard(wrapper);
  activeScrollHost = wrapper;

  const modalIdByType = {
    channels: "channelModal",
    dealers: "dealerModal",
    mails: "mailModal"
  };

  const addNew = actionButton("+Yeni", "btn btn-primary mini-btn definition-add-btn", () => {
    const modal = document.getElementById(modalIdByType[type]);
    if (modal && !modal.open) modal.showModal();
  });

  const currentRowIds = visibleItems.map(({ row, index }) => row.id || String(index));
  const allRowsSelected = currentRowIds.length > 0 && currentRowIds.every(id => selectedDefinitions[type].has(id));
  const selectedCount = currentRowIds.filter(id => selectedDefinitions[type].has(id)).length;
  const isEditingThisTable = editing.type === type && editing.index >= 0;
  const isEditingOtherTable = editing.type && editing.type !== type;

  const selectAllToggle = document.createElement("label");
  selectAllToggle.className = "definition-select-all-toggle";
  selectAllToggle.title = "Görünen kayıtları seç";

  const selectAllCheckbox = document.createElement("input");
  selectAllCheckbox.type = "checkbox";
  selectAllCheckbox.checked = allRowsSelected;
  selectAllCheckbox.disabled = currentRowIds.length === 0;
  selectAllCheckbox.setAttribute("aria-label", "Görünen kayıtları seç");
  selectAllCheckbox.addEventListener("change", () => {
    if (selectAllCheckbox.checked) {
      currentRowIds.forEach(id => selectedDefinitions[type].add(id));
    } else {
      currentRowIds.forEach(id => selectedDefinitions[type].delete(id));
    }
    wrapper.querySelectorAll('td.definition-select-col input[type="checkbox"]').forEach(cb => {
      cb.checked = selectAllCheckbox.checked;
    });
    syncDefinitionSelectionControls();
  });

  selectAllToggle.appendChild(selectAllCheckbox);

  function syncDefinitionSelectionControls() {
    const selectedCountNow = currentRowIds.filter(id => selectedDefinitions[type].has(id)).length;
    selectAllCheckbox.checked = currentRowIds.length > 0 && selectedCountNow === currentRowIds.length;
    selectAllCheckbox.indeterminate = selectedCountNow > 0 && selectedCountNow < currentRowIds.length;
    selectAllCheckbox.disabled = currentRowIds.length === 0;
    editSelected.disabled = isEditingOtherTable || (!isEditingThisTable && selectedCountNow !== 1);
    deleteSelected.disabled = selectedCountNow === 0;
  }

  const editSelected = actionButton(isEditingThisTable ? "Kaydet" : "Düzenle", "btn btn-soft mini-btn definition-edit-selected-btn", () => editSelectedDefinitionRow(type, columns));
  editSelected.disabled = isEditingOtherTable || (!isEditingThisTable && selectedCount !== 1);
  editSelected.title = isEditingThisTable ? "Düzenlenen tanımı kaydet" : "Seçili tek tanımı düzenle";

  const deleteSelected = actionButton("Sil", "btn btn-danger mini-btn", () => deleteSelectedDefinitionRows(type));
  deleteSelected.disabled = selectedCount === 0;

  actionBar.append(selectAllToggle, editSelected, deleteSelected, addNew);
  shell.appendChild(actionBar);

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = allRows.length ? "Arama sonucunda kayıt bulunamadı." : "Henüz kayıt yok.";
    wrapper.appendChild(empty);
    shell.appendChild(wrapper);
    if (!existingSearchBar) {
      container.innerHTML = "";
      container.appendChild(shell);
    }
    restoreDefinitionTableScroll();
    return;
  }

  const table = document.createElement("table");
  table.className = "definition-edit-table";
  table.setAttribute("data-definition-edit-table", type);
  table.style.minWidth = getDefinitionTableWidth(type);
  table.style.width = getDefinitionTableWidth(type);
  table.style.tableLayout = "fixed";
  table.appendChild(createDefinitionColGroup(type, columns));

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th class="definition-select-col" aria-label="Seçim" title="Seç">Seç</th>
      ${columns.map(col => `<th class="definition-cell definition-cell-${col.key}" title="${col.label}">${col.label}</th>`).join("")}
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  visibleItems.forEach(({ row, index }) => {
    const tr = document.createElement("tr");
    const rowIsEditing = editing.type === type && editing.index === index;
    if (rowIsEditing) tr.classList.add("is-editing");
    const rowId = row.id || String(index);

    const selectTd = document.createElement("td");
    selectTd.className = "definition-select-col";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "definition-row-checkbox";
    checkbox.setAttribute("aria-label", "Satırı seç");
    checkbox.checked = selectedDefinitions[type].has(rowId);
    checkbox.addEventListener("change", () => {
      checkbox.checked ? selectedDefinitions[type].add(rowId) : selectedDefinitions[type].delete(rowId);
      syncDefinitionSelectionControls();
    });
    selectTd.appendChild(checkbox);
    tr.appendChild(selectTd);

    columns.forEach(col => {
      const td = document.createElement("td");
      td.className = `definition-cell definition-cell-${col.key}`;
      const cellValue = row[col.key] ?? "";
      td.title = String(cellValue);

      if (rowIsEditing) {
        const input = document.createElement("input");
        input.className = "definition-inline-input";
        input.name = col.key;
        input.value = row[col.key] ?? "";
        input.inputMode = col.type === "number" ? "decimal" : "text";
        td.appendChild(input);
      } else {
        td.textContent = cellValue;
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);
  shell.appendChild(wrapper);
  if (!existingSearchBar) {
    container.innerHTML = "";
    container.appendChild(shell);
  }
  restoreDefinitionTableScroll();
}

async function editSelectedDefinitionRow(type, columns) {
  if (editing.type === type && editing.index >= 0) {
    const containerIdByType = {
      channels: "channelsTable",
      dealers: "dealersTable",
      mails: "mailsTable"
    };
    const row = state[type]?.[editing.index];
    const tr = document.querySelector(`#${containerIdByType[type]} tr.is-editing`);

    if (!row || !tr) {
      editing = { type: "", index: -1 };
      renderDefinitions();
      return;
    }

    await saveDefinitionRow(type, editing.index, columns, tr);
    return;
  }

  if (editing.type && editing.type !== type) {
    toast("Önce düzenlenen tanımı kaydedin.");
    return;
  }

  const rows = state[type] || [];
  const selected = selectedDefinitions[type] || new Set();
  const selectedIndexes = rows
    .map((row, index) => ({ id: row.id || String(index), index }))
    .filter(item => selected.has(item.id));

  if (!selectedIndexes.length) {
    toast("Düzenlemek için tanım seçilmedi.");
    return;
  }

  if (selectedIndexes.length > 1) {
    toast("Düzenlemek için sadece bir tanım seçin.");
    return;
  }

  editing = { type, index: selectedIndexes[0].index };
  renderDefinitions();
}

async function saveDefinitionRow(type, index, columns, tr) {
  const target = state[type][index];
  if (!target) return;

  columns.forEach(col => {
    const input = tr.querySelector(`[name="${col.key}"]`);
    if (!input) return;
    target[col.key] = col.type === "number" ? safeNumber(input.value) : sanitizeText(input.value);
  });

  if (type === "dealers" || type === "mails") {
    target.bayiKey = normalizeName(target.bayi);
  }

  editing = { type: "", index: -1 };
  renderDefinitions();

  try {
    await persistDefinitionsToSql();
    toast("Tanım güncellendi ve SQL’e kaydedildi.");
  } catch (error) {
    console.error(error);
    toast(`Tanım güncellendi fakat SQL’e kaydedilemedi: ${error.message || error}`);
  }
}

async function deleteDefinitionRow(type, index) {
  const label = type === "channels" ? "kanal" : type === "dealers" ? "bayi" : "mail";
  if (!confirm(`Bu ${label} tanımı silinsin mi?`)) return;

  const row = state[type][index];
  if (row?.id) selectedDefinitions[type]?.delete(row.id);
  state[type].splice(index, 1);
  editing = { type: "", index: -1 };
  renderDefinitions();

  try {
    await persistDefinitionsToSql();
    toast("Tanım silindi ve SQL güncellendi.");
  } catch (error) {
    console.error(error);
    toast(`Tanım silindi fakat SQL güncellenemedi: ${error.message || error}`);
  }
}

async function deleteSelectedDefinitionRows(type) {
  const rows = state[type] || [];
  const selected = selectedDefinitions[type] || new Set();

  if (!selected.size) {
    toast("Silmek için kayıt seçilmedi.");
    return;
  }

  const label = type === "channels" ? "kanal" : type === "dealers" ? "bayi" : "mail";
  if (!confirm(`${selected.size} ${label} tanımı silinsin mi?`)) return;

  state[type] = rows.filter((row, index) => !selected.has(row.id || String(index)));
  selected.clear();
  editing = { type: "", index: -1 };
  renderDefinitions();

  try {
    await persistDefinitionsToSql();
    toast("Seçilen tanımlar silindi ve SQL güncellendi.");
  } catch (error) {
    console.error(error);
    toast(`Seçilen tanımlar silindi fakat SQL güncellenemedi: ${error.message || error}`);
  }
}

function actionButton(text, className, handler) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = text;
  btn.className = className;
  btn.addEventListener("click", handler);
  return btn;
}

async function persistDefinitionsToSql() {
  return saveDefinitionsToCloud({
    channels: state.channels,
    dealers: state.dealers,
    mails: state.mails
  });
}

async function saveDefinitionsToSql() {
  try {
    const result = await persistDefinitionsToSql();
    document.dispatchEvent(new CustomEvent("dikesoft:definitions-saved", {
      detail: { channelCount: result.channelCount, dealerCount: result.dealerCount, mailCount: result.mailCount }
    }));

    toast(`Tanımlar SQL’e kaydedildi. Kanal: ${result.channelCount}, Bayi: ${result.dealerCount}, Mail: ${result.mailCount}`);
  } catch (error) {
    console.error(error);
    toast(`Tanımları kaydetme hatası: ${error.message || error}`);
  }
}


function workbookToExcelFile(workbook, filename) {
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  return new File([blob], filename, { type: blob.type });
}

function isMobileDownloadContext() {
  try {
    return window.matchMedia("(max-width: 767px)").matches || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
  } catch {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
  }
}

async function saveWorkbookWithoutNavigation(workbook, filename, successMessage) {
  const file = workbookToExcelFile(workbook, filename);

  // Mobil Safari/Chrome bazı XLSX indirmelerinde dosyayı aynı WebView geçmişine ekleyebiliyor.
  // Dosya paylaşımı destekleniyorsa belge sayfasına yönlenmeden, yalnızca dosya olarak dışarı aktar.
  if (isMobileDownloadContext() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      toast(successMessage || "Dosya hazır.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Mobil dosya paylaşımı başarısız; doğrudan indirme deneniyor.", error);
    }
  }

  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.position = "fixed";
  anchor.style.left = "-9999px";
  anchor.style.top = "-9999px";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
  toast(successMessage || "Dosya indiriliyor.");
}

async function exportDefinitions() {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(state.channels.map(row => ({
      DAGITICI: row.kanal,
      KANAL_PAYI: row.kp
    }))),
    "kanallar"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(state.dealers.map(row => ({
      DAGITICI: row.kanal,
      BAYI: row.bayi,
      BAYI_PAYI: row.bp
    }))),
    "bayiler"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(state.mails.map(row => ({
      BAYI: row.bayi,
      EMAIL: row.email
    }))),
    "mailler"
  );

  await saveWorkbookWithoutNavigation(wb, "dikesoft-tanimlar.xlsx", "Tanımlar dosyası hazır.");
}

function setupTemplateDownload() {
  const templateButton = document.getElementById("downloadTemplateBtn");

  templateButton?.addEventListener("click", event => {
    event.preventDefault();
    downloadTemplate();
  });
}

async function downloadTemplate() {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ DAGITICI: "Örnek Dağıtıcı", KANAL_PAYI: 50 }]),
    "kanallar"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ DAGITICI: "Örnek Dağıtıcı", BAYI: "Örnek Bayi", BAYI_PAYI: 30 }]),
    "bayiler"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ BAYI: "Örnek Bayi", EMAIL: "muhasebe@ornek.com" }]),
    "mailler"
  );

  await saveWorkbookWithoutNavigation(wb, "dikesoft-tanimlar-sablon.xlsx", "Şablon dosyası hazır.");
}

async function importDefinitions(event) {
  const file = event.target.files[0];
  if (!file) return;

  const wb = await readWorkbook(file);

  const normalizeSheetName = value => String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i");

  const getSheetRows = (...names) => {
    const targets = names.map(normalizeSheetName);
    const sheetName = wb.SheetNames.find(sheet => targets.includes(normalizeSheetName(sheet)));
    return sheetName ? XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" }) : [];
  };

  const allRows = wb.SheetNames.flatMap(sheetName =>
    XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" })
  );

  const channelsSource = getSheetRows("kanallar", "kanal", "channels");
  const dealersSource = getSheetRows("bayiler", "bayi", "dealers");
  const mailsSource = getSheetRows("mailler", "mail", "mails", "emails", "e-mail");

  const normalizedAll = allRows.map(normalizeImportedRow);

  const channelFallback = normalizedAll.filter(row =>
    pick(row, ["DAGITICI", "KANAL", "KANAL_ADI"]) &&
    pick(row, ["KANAL_PAYI", "KP", "KP_ORANI"])
  );

  const dealerFallback = normalizedAll.filter(row =>
    pick(row, ["BAYI", "BAYI_ADI"]) &&
    (pick(row, ["BAYI_PAYI", "BP", "BP_ORANI"]) || pick(row, ["DAGITICI", "KANAL", "KANAL_ADI"]))
  );

  const mailFallback = normalizedAll.filter(row =>
    pick(row, ["BAYI", "BAYI_ADI"]) &&
    pick(row, ["EMAIL", "MAIL", "EPOSTA", "E_POSTA", "E_MAIL"])
  );

  const importedChannels = (channelsSource.length ? channelsSource : channelFallback).map(sourceRow => {
    const row = normalizeImportedRow(sourceRow);
    const kanal = sanitizeText(pick(row, ["DAGITICI", "KANAL", "KANAL_ADI"]));
    return {
      id: makeId("kanal"),
      kanal,
      kp: safeNumber(pick(row, ["KANAL_PAYI", "KP", "KP_ORANI"]))
    };
  }).filter(row => row.kanal);

  const importedDealers = (dealersSource.length ? dealersSource : dealerFallback).map(sourceRow => {
    const row = normalizeImportedRow(sourceRow);
    const bayi = sanitizeText(pick(row, ["BAYI", "BAYI_ADI"]));
    return {
      id: makeId("bayi"),
      bayi,
      bayiKey: normalizeName(bayi),
      kanal: sanitizeText(pick(row, ["DAGITICI", "KANAL", "KANAL_ADI"])),
      bp: safeNumber(pick(row, ["BAYI_PAYI", "BP", "BP_ORANI"]))
    };
  }).filter(row => row.bayi);

  const importedMails = (mailsSource.length ? mailsSource : mailFallback).map(sourceRow => {
    const row = normalizeImportedRow(sourceRow);
    const bayi = sanitizeText(pick(row, ["BAYI", "BAYI_ADI"]));
    return {
      id: makeId("mail"),
      bayi,
      bayiKey: normalizeName(bayi),
      email: sanitizeText(pick(row, ["EMAIL", "MAIL", "EPOSTA", "E_POSTA", "E_MAIL"]))
    };
  }).filter(row => row.bayi && row.email);

  const mergedChannels = mergeImportedDefinitionRows(
    "channels",
    state.channels,
    importedChannels,
    row => normalizeName(row.kanal || "")
  );

  const mergedDealers = mergeImportedDefinitionRows(
    "dealers",
    state.dealers,
    importedDealers,
    dealerDefinitionKey
  );

  const mergedMails = mergeImportedDefinitionRows(
    "mails",
    state.mails,
    importedMails,
    row => normalizeName(row.bayi || "")
  );

  state.channels = mergedChannels.rows;
  state.dealers = mergedDealers.rows;
  state.mails = mergedMails.rows;

  event.target.value = "";
  editing = { type: "", index: -1 };
  selectedDefinitions.channels.clear();
  selectedDefinitions.dealers.clear();
  selectedDefinitions.mails.clear();

  if (importedChannels.length) {
    activeDefinitionView = "channels";
  } else if (importedDealers.length) {
    activeDefinitionView = "dealers";
  } else if (importedMails.length) {
    activeDefinitionView = "mails";
  }

  renderDefinitions();
  document.dispatchEvent(new CustomEvent("dikesoft:definitions-imported", { detail: { view: activeDefinitionView } }));

  try {
    const result = await persistDefinitionsToSql();
    document.dispatchEvent(new CustomEvent("dikesoft:definitions-saved", {
      detail: { channelCount: result.channelCount, dealerCount: result.dealerCount, mailCount: result.mailCount }
    }));

    const addedCount = mergedChannels.stats.added + mergedDealers.stats.added + mergedMails.stats.added;
    const updatedCount = mergedChannels.stats.updated + mergedDealers.stats.updated + mergedMails.stats.updated;
    toast(`Tanımlar mevcut kayıtlar korunarak içe aktarıldı ve SQL’e kaydedildi. Kanal: ${result.channelCount}, Bayi: ${result.dealerCount}, Mail: ${result.mailCount}. Eklenen: ${addedCount}, Güncellenen: ${updatedCount}`);
  } catch (error) {
    console.error(error);
    toast(`Tanımlar içe aktarıldı fakat SQL’e kaydedilemedi: ${error.message || error}`);
  }
}
