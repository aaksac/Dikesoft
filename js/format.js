export function money(value){return Number(value||0).toLocaleString("tr-TR",{style:"currency",currency:"TRY"})}
export function number(value){return Number(value||0).toLocaleString("tr-TR")}

function isValidDateParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function normalizeYear(year) {
  const text = String(year ?? "").trim();
  if (/^\d{2}$/.test(text)) return Number(`20${text}`);
  return Number(text);
}

function dateFromParts(year, month, day) {
  const y = normalizeYear(year);
  return isValidDateParts(y, month, day) ? new Date(y, Number(month) - 1, Number(day)) : null;
}

function parseDateForDisplay(value) {
  if (value === undefined || value === null || value === "") return null;

  if (value instanceof Date && !isNaN(value)) {
    return dateFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const serial = Math.floor(value);
    if (serial < 1) return null;
    const utc = Date.UTC(1899, 11, 30) + serial * 86400 * 1000;
    const date = new Date(utc);
    return dateFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{5}(?:[.,]\d+)?$/.test(text)) {
    return parseDateForDisplay(Number(text.replace(",", ".")));
  }

  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s+.*)?$/);
  if (tr) {
    const [, day, month, year] = tr;
    return dateFromParts(year, month, day);
  }

  const iso = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[T\s].*)?$/);
  if (iso) {
    const [, year, month, day] = iso;
    return dateFromParts(year, month, day);
  }

  return null;
}

export function dateTR(value){
  if(!value)return"";
  const d=parseDateForDisplay(value);
  if(!d)return String(value);
  const day=String(d.getDate()).padStart(2,"0");
  const month=String(d.getMonth()+1).padStart(2,"0");
  const year=String(d.getFullYear());
  return `${day}.${month}.${year}`;
}
