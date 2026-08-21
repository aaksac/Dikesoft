/*
  validators.js
  Görev: Excel satırları, mail, oran, tarih ve temel veri kontrolleri.
*/
import { sanitizeText, safeNumber } from "./security.js";
import { normalizeHeader } from "./import-excel.js";

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

export function validatePaymentRows(rows) {
  const issues = [];

  rows.forEach((row, index) => {
    const line = index + 1;

    if (!sanitizeText(row.vkn)) {
      issues.push(`${line}. satır: VKN eksik`);
    }

    if (!sanitizeText(row.unvan)) {
      issues.push(`${line}. satır: UNVAN eksik`);
    }

    if (!sanitizeText(row.dagitici)) {
      issues.push(`${line}. satır: DAGITICI eksik`);
    }

    if (!sanitizeText(row.bayi)) {
      issues.push(`${line}. satır: BAYI eksik`);
    }

    if (!sanitizeText(row.faturaNo)) {
      issues.push(`${line}. satır: FATURA_NO eksik`);
    }

    if (!row.faturaTarihi) {
      issues.push(`${line}. satır: FATURA_TARIHI eksik`);
    }

    if (!row.tahsilatTarihi) {
      issues.push(`${line}. satır: TAHSILAT_TARIHI eksik`);
    }

    if (safeNumber(row.faturaTutari) <= 0) {
      issues.push(`${line}. satır: FATURA_TUTARI geçersiz`);
    }

    if (safeNumber(row.tutar) <= 0) {
      issues.push(`${line}. satır: TOPLAM_TUTAR geçersiz`);
    }
  });

  return issues;
}

export function validateRequiredHeaders(headers) {
  const required = [
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

  const normalizedHeaders = headers.map(normalizeHeader);
  return required.filter(header => !normalizedHeaders.includes(header));
}


export function getPaymentRowIssues(row) {
  const issues = [];

  if (!sanitizeText(row.vkn)) issues.push("VKN eksik");
  if (!sanitizeText(row.unvan)) issues.push("UNVAN eksik");
  if (!sanitizeText(row.dagitici)) issues.push("DAGITICI eksik");
  if (!sanitizeText(row.bayi)) issues.push("BAYI eksik");
  if (!sanitizeText(row.faturaNo)) issues.push("FATURA_NO eksik");
  if (!row.faturaTarihi) issues.push("FATURA_TARIHI eksik");
  if (!row.tahsilatTarihi) issues.push("TAHSILAT_TARIHI eksik");
  if (safeNumber(row.faturaTutari) <= 0) issues.push("FATURA_TUTARI geçersiz");
  if (safeNumber(row.tutar || row.toplamTutar) <= 0) issues.push("TOPLAM_TUTAR geçersiz");

  return issues;
}
