/*
  import-excel.js
  Görev: .xlsx, .xls ve .csv dosyalarını okuyup Dikesoft veri modeline dönüştürür.

  Zorunlu ana başlıklar:
  VKN, UNVAN, DAGITICI, BAYI, FATURA_NO, FATURA_TARIHI, FATURA_TUTARI,
  TAHSILAT_DURUMU, TAHSILAT_TARIHI, TOPLAM_TUTAR
*/
import { neutralizeSpreadsheetFormula, sanitizeText, safeNumber } from "./security.js";
import { validatePaymentRows, validateRequiredHeaders, getPaymentRowIssues } from "./validators.js";

const REQUIRED_HEADERS = [
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

export async function readWorkbook(file) {
  const data = await file.arrayBuffer();

  return XLSX.read(data, {
    type: "array",
    cellDates: false,
    // Sayısal hücreleri biçimlendirilmiş metin olarak değil ham sayı olarak oku.
    // Özellikle 984,00 gibi değerlerin 98.400,00 olarak şişmesini engeller.
    raw: true,
    codepage: 65001,
    WTF: false
  });
}

export function normalizeHeader(header) {
  return String(header || "")
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
}

function findHeaderRow(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    // Veri satırlarında hücre biçimi değil gerçek hücre değeri alınsın.
    // Para kolonlarında Türkçe/İngilizce biçim karışması kaynaklı 100 kat şişme böyle önlenir.
    raw: true
  });

  let bestIndex = 0;
  let bestScore = -1;

  matrix.slice(0, 25).forEach((row, index) => {
    const normalized = row.map(normalizeHeader);
    const score = REQUIRED_HEADERS.filter(header => normalized.includes(header)).length;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return {
    matrix,
    headerRowIndex: bestIndex,
    score: bestScore
  };
}

function sheetToObjects(sheet) {
  const { matrix, headerRowIndex, score } = findHeaderRow(sheet);
  const headers = (matrix[headerRowIndex] || []).map(normalizeHeader);

  const rows = matrix
    .slice(headerRowIndex + 1)
    .filter(row => row.some(cell => String(cell ?? "").trim() !== ""))
    .map(row => {
      const obj = {};

      headers.forEach((header, index) => {
        if (header) obj[header] = row[index] ?? "";
      });

      return obj;
    });

  return {
    rows,
    headers,
    headerRowIndex,
    score
  };
}

function value(row, key) {
  return row[key] !== undefined && row[key] !== null ? row[key] : "";
}

function normalizeDateText(value) {
  if (value instanceof Date && !isNaN(value)) {
    return value.toLocaleDateString("tr-TR");
  }

  const text = String(value ?? "").trim();

  // Excel numeric serial date
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    const utcDays = Math.floor(serial - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    if (!isNaN(date)) return date.toLocaleDateString("tr-TR");
  }

  return text;
}

function rowToPayment(row, index) {
  const faturaTutari = safeNumber(value(row, "FATURA_TUTARI"));
  const toplamTutar = safeNumber(value(row, "TOPLAM_TUTAR"));

  const mapped = {
    sira: index + 1,

    // Excel kolonları birebir
    vkn: neutralizeSpreadsheetFormula(value(row, "VKN")),
    unvan: sanitizeText(value(row, "UNVAN")),
    dagitici: sanitizeText(value(row, "DAGITICI")),
    bayi: sanitizeText(value(row, "BAYI")),
    faturaNo: neutralizeSpreadsheetFormula(value(row, "FATURA_NO")),
    faturaTarihi: normalizeDateText(value(row, "FATURA_TARIHI")),
    faturaTutari,
    tahsilatDurumu: sanitizeText(value(row, "TAHSILAT_DURUMU")),
    tahsilatTarihi: normalizeDateText(value(row, "TAHSILAT_TARIHI")),
    toplamTutar,

    // Raporlama uyumluluk alanları
    tarih: normalizeDateText(value(row, "FATURA_TARIHI")),
    vknTckn: neutralizeSpreadsheetFormula(value(row, "VKN")),
    musteri: sanitizeText(value(row, "UNVAN")),
    // Rapor hesaplaması FATURA_TUTARI bazlıdır. TOPLAM_TUTAR her satırda dönem toplamı
    // taşıyabildiği için tutar uyumluluk alanı da fatura tutarına sabitlenir.
    tutar: faturaTutari,

    // Orijinal ham satır
    rawData: { ...row }
  };

  const rowIssues = getPaymentRowIssues(mapped);

  return {
    ...mapped,
    rowIssues,
    hasIssue: rowIssues.length > 0
  };
}

export async function importPaymentFile(file) {
  const wb = await readWorkbook(file);
  const ws = wb.Sheets[wb.SheetNames[0]];

  const parsed = sheetToObjects(ws);
  const normalizedRows = parsed.rows.map(rowToPayment);

  const issues = validatePaymentRows(normalizedRows);
  const missingHeaders = validateRequiredHeaders(parsed.headers);

  return {
    rows: normalizedRows,
    total: normalizedRows.length,
    issues,
    missingHeaders,
    headers: parsed.headers,
    headerRowIndex: parsed.headerRowIndex,
    headerScore: parsed.score
  };
}

export function exportRowsToXlsx(filename, rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, ws, "veriler");
  XLSX.writeFile(wb, filename);
}
