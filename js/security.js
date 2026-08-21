const DANGEROUS_PATTERNS = [/<\s*script/gi,/<\s*iframe/gi,/javascript\s*:/gi,/onerror\s*=/gi,/onclick\s*=/gi,/\b(drop|delete|insert|update|select|alter|truncate)\b/gi];
export function sanitizeText(value){let text=String(value??"").trim();DANGEROUS_PATTERNS.forEach(rx=>{text=text.replace(rx,"")});return text.replace(/[<>]/g,"")}
export function neutralizeSpreadsheetFormula(value){const text=sanitizeText(value);return /^[=+\-@]/.test(text)?"'"+text:text}
export function safeNumber(value){
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  let text = String(value ?? "").trim();
  if (!text) return 0;

  text = text
    .replace(/\s+/g, "")
    .replace(/[₺TLTRY]/gi, "")
    .replace(/[^0-9,.-]/g, "");

  if (!text || text === "-" || text === "." || text === ",") return 0;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    // Ondalık ayırıcı en sağdaki işarettir: 1.234,56 veya 1,234.56
    if (lastComma > lastDot) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    const parts = text.split(",");
    const decimalPart = parts[parts.length - 1] || "";
    if (parts.length === 2 && decimalPart.length > 0 && decimalPart.length <= 2) {
      text = parts[0].replace(/,/g, "") + "." + decimalPart;
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (lastDot > -1) {
    const parts = text.split(".");
    const decimalPart = parts[parts.length - 1] || "";
    const looksLikeThousands = parts.length > 1 && parts.slice(1).every(part => part.length === 3);
    if (parts.length === 2 && decimalPart.length > 0 && decimalPart.length <= 2) {
      text = parts[0] + "." + decimalPart;
    } else if (looksLikeThousands) {
      text = text.replace(/\./g, "");
    } else {
      text = parts.slice(0, -1).join("") + "." + decimalPart;
    }
  }

  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}
export function normalizeName(value){return sanitizeText(value).toLocaleUpperCase("tr-TR").replace(/\s+/g," ").trim()}
