/*
  calculator.js
  Görev: Aktif veri setinden bayi bazlı raporları hesaplar.

  Kesin mantık:
  - Excel DAGITICI = kanal adı.
  - Excel BAYI = bayi adı.
  - Kanal Tanımla: kanal adı + kanal payı (KP).
  - Bayi Tanımla: bayi adı + bağlı kanal + bayi payı (BP).
  - Genel raporda kanal payı satırın gerçek dağıtıcısının KP oranına göre hesaplanır.
  - Bayi payı satırın gerçek dağıtıcısı + bayi eşleşmesindeki BP oranına göre hesaplanır.
*/
import { state } from "./state.js";
import { normalizeName, safeNumber } from "./security.js";
import { money } from "./format.js";
import { renderReports } from "./reports.js";
import { showPage, toast } from "./ui.js";

function normalizePlain(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR");
}

function isAllDistributorValue(value) {
  const normalized = normalizePlain(value);
  return !normalized || normalized === "tümü" || normalized === "tumu" || normalized === "tum" || normalized === "all";
}

function selectedReportDistributorNames() {
  const list = Array.isArray(state.currentReportDistributors)
    ? state.currentReportDistributors
    : [];

  if (list.length) {
    return [...new Set(list
      .map(value => String(value || "").trim())
      .filter(value => value && !isAllDistributorValue(value)))];
  }

  const selected = String(state.currentReportDistributor || "").trim();
  if (isAllDistributorValue(selected)) return [];
  return selected
    .split(/\s+\/\s+/)
    .map(value => value.trim())
    .filter(value => value && !isAllDistributorValue(value));
}

function selectedReportDistributorName() {
  const names = selectedReportDistributorNames();
  return names.length === 1 ? names[0] : "";
}

function resolveReportChannelName(dealer, distributorFromRows) {
  // Belirli bir Kanal / Dağıtıcı filtresi seçilmişse rapordaki kanal adı ve KP
  // bu seçime göre oluşmalıdır.
  const selectedDistributor = selectedReportDistributorName();
  if (selectedDistributor) return selectedDistributor;

  // Tümü seçiliyken rapordaki kanal adı, bayi tanımındaki eski/tek kanal bilgisinden
  // değil, SQL/Excel satırındaki gerçek DAGITICI bilgisinden gelmelidir. Aksi hâlde
  // hesaplama tüm kanalları kapsasa bile tabloda tek kanal adı görünebilir.
  return distributorFromRows || dealer?.kanal || "";
}

function findChannelByName(name) {
  const target = normalizePlain(name);
  if (!target) return null;
  return state.channels.find(channel => normalizePlain(channel.kanal) === target) || null;
}

function distributorFromRow(row) {
  // SQL/veri yöneticisi satırlarında güncel ve kanonik değer row.dagitici alanıdır.
  // rawData yalnızca eski Excel kopyasıdır; hesaplamada önce rawData okunursa,
  // özellikle Tümü hesaplamasında aynı bayi başka dağıtıcının BP oranına yanlış eşleşebilir.
  const directValue = row?.dagitici ?? row?.DAGITICI ?? row?.kanal ?? row?.KANAL;
  if (directValue !== undefined && directValue !== null && String(directValue).trim() !== "") {
    return String(directValue).trim();
  }

  const rawValue = getRawValue(row, "DAGITICI", "dagitici", "KANAL", "kanal");
  return String(rawValue ?? "").trim();
}

function groupKeyForReportRow(row) {
  const bayiKey = normalizeName(row.bayi || row.BAYI);
  if (!bayiKey) return "";

  // Rapor üretimi bayi bazlıdır. Belirli bir kanal seçildiğinde veri zaten o
  // kanala filtrelenmiştir; "Tümü" seçiliyken de aynı bayi farklı kanallarda
  // yer alsa bile tek rapor kartı / tek PDF altında toplanmalıdır.
  return bayiKey;
}

function distributorLabelFromRows(rows, fallback = "") {
  const names = [...new Set((Array.isArray(rows) ? rows : [])
    .map(row => distributorFromRow(row))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "tr-TR"));

  if (names.length) return names.join(" / ");
  return String(fallback || "").trim();
}

function allDistributorsLabel(rows) {
  return distributorLabelFromRows(rows, "Tüm Kanallar");
}

function distinctRateValues(values) {
  return [...new Set(values.map(value => Number(value || 0)))];
}

function displayRate(values) {
  const distinct = distinctRateValues(values);
  if (!distinct.length) return 0;
  return distinct.length === 1 ? distinct[0] : "Çoklu";
}

function strictDealerKey(bayiKey, channelName) {
  const normalizedBayi = normalizeName(bayiKey || "");
  const normalizedChannel = normalizeName(channelName || "");
  if (!normalizedBayi || !normalizedChannel) return "";
  return `${normalizedChannel}::${normalizedBayi}`;
}

function buildDealerIndex() {
  const index = new Map();
  (Array.isArray(state.dealers) ? state.dealers : []).forEach(dealer => {
    const key = strictDealerKey(dealer.bayiKey || dealer.bayi || dealer.BAYI, dealer.kanal || dealer.DAGITICI || dealer.KANAL);
    if (key && !index.has(key)) index.set(key, dealer);
  });
  return index;
}


function dealerRateForRow(row, bayiKey, dealerIndex = null) {
  // Bayi payı her zaman satırın kendi DAGITICI/KANAL değeriyle eşleşmelidir.
  // Seçili filtre değeri burada kullanılmaz; aksi hâlde "Tümü" veya eski seçim
  // durumlarında ortak bayi adı başka dağıtıcının BP oranını yanlışlıkla taşıyabilir.
  const channelName = distributorFromRow(row) || "";
  const dealer = findDealerForReport(bayiKey, channelName, dealerIndex);
  return Number(dealer?.bp || 0);
}

function enrichRowsWithDealerShare(rows, bayiKey, dealerIndex = null) {
  return rows.map(row => {
    const bp = dealerRateForRow(row, bayiKey, dealerIndex);
    const invoiceAmount = getInvoiceAmount(row);
    return {
      ...row,
      reportBp: bp,
      reportDealerShare: invoiceAmount * bp / 100
    };
  });
}

function calculateSharesForRows(rows, bayiKey, dealerIndex = null) {
  let channelShare = 0;
  let dealerShare = 0;
  const kpValues = [];
  const bpValues = [];

  const rowsByDistributor = new Map();
  rows.forEach(row => {
    const distributorName = distributorFromRow(row);
    const distributorKey = normalizePlain(distributorName) || "__kanal_yok";
    if (!rowsByDistributor.has(distributorKey)) {
      rowsByDistributor.set(distributorKey, { distributorName, rows: [] });
    }
    rowsByDistributor.get(distributorKey).rows.push(row);
  });

  rowsByDistributor.forEach(group => {
    // KP ve BP, rapordaki her satırın gerçek DAGITICI/KANAL grubuna göre alınır.
    // currentReportDistributor yalnızca veri filtresi için kullanılır; hesap oranı için
    // kaynak olarak kullanılmaz. Böylece eksik bayi tanımı olan ikinci dağıtıcı,
    // birinci dağıtıcının ortak bayi oranıyla hesaplanmaz.
    const channelName = group.distributorName || "";
    const channel = findChannelByName(channelName);
    const dealer = findDealerForReport(bayiKey, channelName, dealerIndex);
    const kp = Number(channel?.kp || 0);
    const bp = Number(dealer?.bp || 0);
    const subtotal = sumInvoiceTotal(group.rows);

    kpValues.push(kp);
    bpValues.push(bp);
    channelShare += subtotal * kp / 100;
    dealerShare += subtotal * bp / 100;
  });

  return {
    kp: displayRate(kpValues),
    bp: displayRate(bpValues),
    channelShare,
    dealerShare
  };
}


export function findMissingDealerShareDefinitions(rows = []) {
  const dealerIndex = buildDealerIndex();
  const missing = new Map();

  (Array.isArray(rows) ? rows : []).forEach(row => {
    const bayiName = row?.bayi || row?.BAYI || "";
    const bayiKey = normalizeName(bayiName);
    const distributorName = distributorFromRow(row);
    const strictKey = strictDealerKey(bayiKey, distributorName);

    if (!bayiKey || !distributorName || !strictKey) return;
    if (dealerIndex.has(strictKey)) return;

    if (!missing.has(strictKey)) {
      missing.set(strictKey, {
        bayi: String(bayiName || bayiKey).trim(),
        dagitici: String(distributorName).trim()
      });
    }
  });

  return [...missing.values()];
}

function findDealerForReport(bayiKey, channelName, dealerIndex = null) {
  // Kesin eşleşme: DAĞITICI/KANAL + BAYİ.
  // BAYİ adına göre arama/fallback kesinlikle yoktur.
  const key = strictDealerKey(bayiKey, channelName);
  if (!key) return null;

  const index = dealerIndex || buildDealerIndex();
  return index.get(key) || null;
}

function normalizeInvoiceNo(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLocaleUpperCase("tr-TR");
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

function getInvoiceAmount(row) {
  // Raporun kesin tutar kaynağı FATURA_TUTARI sütunudur.
  // Eski kayıtların SQL fatura_tutari alanı hatalı/şişmiş olabilir; bu yüzden
  // varsa önce raw_data içindeki orijinal Excel FATURA_TUTARI okunur.
  const rawValue = getRawValue(row, "FATURA_TUTARI", "faturaTutari");
  if (rawValue !== undefined) return safeNumber(rawValue);
  return safeNumber(row.faturaTutari ?? row.FATURA_TUTARI ?? 0);
}

function withCanonicalInvoiceAmount(row) {
  const invoiceAmount = getInvoiceAmount(row);
  return {
    ...row,
    faturaTutari: invoiceAmount,
    FATURA_TUTARI: invoiceAmount,
    // Rapor/PDF ayrıntılarında yanlışlıkla TOPLAM_TUTAR'a düşülmesin.
    tutar: invoiceAmount
  };
}

function invoiceUniquenessKey(row, index) {
  // FATURA_NO tekil kabul edilemez: aynı fatura numarasıyla iki gerçek kayıt
  // gelebilir. Bu yüzden rapor tekilleştirmesi önce SQL satır ID'sine, sonra
  // içe aktarma oturumu + satır sırasına, en son da görünen satır indeksine dayanır.
  const id = String(row?.id || row?.ID || "").trim();
  if (id) return `id::${id}`;

  const importBatchId = String(row?.importBatchId || row?.import_batch_id || row?.IMPORT_BATCH_ID || "").trim();
  const sira = String(row?.sira ?? row?.SIRA ?? "").trim();
  if (importBatchId && sira) return `batch-row::${importBatchId}::${sira}`;
  if (sira) return `row-sira::${sira}`;

  return `row-index::${index}`;
}

function getUniqueInvoiceRows(rows) {
  const unique = new Map();

  rows.forEach((row, index) => {
    const key = invoiceUniquenessKey(row, index);
    const normalizedRow = withCanonicalInvoiceAmount(row);

    // Aynı FATURA_NO artık tek satıra düşürülmez. Yalnızca aynı SQL satırı / aynı
    // import satırı iki kez listeye girerse tekilleştirilir. Böylece aynı numaralı
    // fakat ayrı iki fatura kaydı rapor toplamına ayrı ayrı dahil olur.
    if (!unique.has(key)) {
      unique.set(key, normalizedRow);
    }
  });

  return [...unique.values()];
}

function sumInvoiceTotal(rows) {
  return getUniqueInvoiceRows(rows).reduce((sum, row) => sum + getInvoiceAmount(row), 0);
}

function countDistinctInvoices(rows) {
  const invoiceRows = new Set();

  rows.forEach((row, index) => {
    const no = normalizeInvoiceNo(row.faturaNo || row.FATURA_NO);
    if (no) invoiceRows.add(invoiceUniquenessKey(row, index));
  });

  return invoiceRows.size;
}

function mostUsedDistributor(rows) {
  const counts = new Map();

  rows.forEach(row => {
    const name = distributorFromRow(row);
    if (!name) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  });

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function makeReportFromGroup(g, index, dealerIndex, forcedVisibleChannelName = null) {
  const uniqueRows = enrichRowsWithDealerShare(getUniqueInvoiceRows(g.rows), g.bayiKey, dealerIndex);
  const invoiceTotal = sumInvoiceTotal(g.rows);
  const distributorFromRows = mostUsedDistributor(g.rows) || g.distributor || "";
  const selectedDistributor = selectedReportDistributorName();
  const visibleChannelName = forcedVisibleChannelName !== null
    ? forcedVisibleChannelName
    : selectedDistributor
      ? selectedDistributor
      : allDistributorsLabel(g.rows);
  const shares = calculateSharesForRows(g.rows, g.bayiKey, dealerIndex);
  const mail = state.mails.find(m => m.bayiKey === g.bayiKey);

  return {
    id: `r_${index}_${g.key}`,
    bayiKey: g.bayiKey,
    bayi: g.bayi,
    dagitici: distributorFromRows,
    kanal: visibleChannelName,
    invoiceCount: countDistinctInvoices(g.rows),
    totalInvoice: invoiceTotal,
    kp: shares.kp,
    bp: shares.bp,
    channelShare: shares.channelShare,
    dealerShare: shares.dealerShare,
    email: mail?.email || "",
    cc: "",
    subject: state.settings.defaultSubject || "Hesap Özeti Raporu",
    body: state.settings.defaultBody || "Sayın yetkili, hesap özeti raporunuz ektedir.",
    rows: uniqueRows,
    periodKey: state.currentReportPeriod || "",
    status: mail?.email ? "Hazır" : "Mail Eksik"
  };
}

function groupRowsForReport(sourceRows, splitByDistributor = false) {
  const grouped = new Map();

  sourceRows.forEach(row => {
    const bayiKey = normalizeName(row.bayi || row.BAYI);
    if (!bayiKey) return;

    const distributorName = distributorFromRow(row);
    const distributorKey = normalizeName(distributorName || "__KANAL_YOK__");
    const key = splitByDistributor ? `${distributorKey}::${bayiKey}` : bayiKey;

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        bayiKey,
        bayi: row.bayi || row.BAYI,
        distributor: distributorName,
        rows: [],
        total: 0
      });
    }

    grouped.get(key).rows.push(row);
  });

  return [...grouped.values()];
}

function mergeDistributorReportsByDealer(distributorReports) {
  const merged = new Map();

  distributorReports.forEach(report => {
    const key = report.bayiKey || normalizeName(report.bayi || "");
    if (!key) return;

    if (!merged.has(key)) {
      merged.set(key, {
        ...report,
        id: `r_${merged.size}_${key}`,
        kanal: "",
        dagitici: "",
        invoiceCount: 0,
        totalInvoice: 0,
        channelShare: 0,
        dealerShare: 0,
        rows: [],
        _kpValues: [],
        _bpValues: []
      });
    }

    const target = merged.get(key);
    target.invoiceCount += Number(report.invoiceCount || 0);
    target.totalInvoice += Number(report.totalInvoice || 0);
    target.channelShare += Number(report.channelShare || 0);
    target.dealerShare += Number(report.dealerShare || 0);
    target.rows.push(...(Array.isArray(report.rows) ? report.rows : []));
    target._kpValues.push(report.kp);
    target._bpValues.push(report.bp);

    if (!target.email && report.email) {
      target.email = report.email;
      target.status = "Hazır";
    }
  });

  return [...merged.values()].map(report => {
    const kpNumericValues = report._kpValues
      .filter(value => value !== "Çoklu")
      .map(value => Number(value || 0));
    const bpNumericValues = report._bpValues
      .filter(value => value !== "Çoklu")
      .map(value => Number(value || 0));
    const hasMultipleKp = report._kpValues.includes("Çoklu") || distinctRateValues(kpNumericValues).length > 1;
    const hasMultipleBp = report._bpValues.includes("Çoklu") || distinctRateValues(bpNumericValues).length > 1;
    const distributorLabel = distributorLabelFromRows(report.rows, report.kanal || report.dagitici || "");

    delete report._kpValues;
    delete report._bpValues;

    return {
      ...report,
      kanal: distributorLabel,
      dagitici: distributorLabel,
      kp: hasMultipleKp ? "Çoklu" : (kpNumericValues[0] ?? 0),
      bp: hasMultipleBp ? "Çoklu" : (bpNumericValues[0] ?? 0)
    };
  });
}

export function calculateReports(options = {}) {
  const { navigate = false, notify = false } = options;
  const sourceRows = Array.isArray(options.rows)
    ? options.rows
    : Array.isArray(state.reportRows)
      ? state.reportRows
      : [];

  const dealerIndex = buildDealerIndex();
  const selectedDistributors = selectedReportDistributorNames();

  if (selectedDistributors.length === 1) {
    // Tek kanal seçildiğinde bayi bazlı raporlar eskisi gibi doğrudan bayi bazında oluşur.
    const selectedDistributor = selectedDistributors[0];
    const groups = groupRowsForReport(sourceRows, false);
    state.reports = groups.map((g, index) => makeReportFromGroup(g, index, dealerIndex, selectedDistributor));
  } else {
    // Tümü veya çoklu kanal seçiminde önce dağıtıcı + bayi bazında ayrı ayrı hesaplanır,
    // sonra aynı bayi tek kart/PDF altında birleştirilir. Böylece KP/BP her satırın kendi
    // dağıtıcısına göre kalır; bayi bazlı rapor yapısı da varsayılan akışı korur.
    const distributorGroups = groupRowsForReport(sourceRows, true);
    const distributorReports = distributorGroups.map((g, index) => makeReportFromGroup(g, index, dealerIndex, g.distributor || ""));
    state.reports = mergeDistributorReportsByDealer(distributorReports);
  }

  document.getElementById("statTotalInvoice").textContent = money(state.reports.reduce((a, r) => a + r.totalInvoice, 0));
  document.getElementById("statDealerCount").textContent = state.reports.length;
  document.getElementById("statInvoiceCount").textContent = state.reports.reduce((a, r) => a + Number(r.invoiceCount || 0), 0);
  document.getElementById("statReadyReports").textContent = state.reports.filter(r => r.email).length;
  document.getElementById("statIssues").textContent = state.reports.filter(r => !r.email).length;

  renderReports();

  if (navigate) showPage("reports");
  if (notify) toast(navigate ? "Hesaplama tamamlandı. Raporlar açıldı." : "Hesaplama tamamlandı.");

  return state.reports;
}

export function calculateReportsFromRows(rows, options = {}) {
  state.reportRows = Array.isArray(rows) ? rows : [];
  return calculateReports({ ...options, rows: state.reportRows });
}
