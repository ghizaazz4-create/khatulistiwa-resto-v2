// Phone helpers — a direct port of normalizePhoneDigits() / phonesMatch()
// from Kode.js. The original compares by trailing digits so that
// 0 / +62 / +20 prefixes all match the same customer.
export function normalizePhoneDigits(p: unknown): string {
  return String(p ?? "").replace(/\D/g, "");
}

export function phonesMatch(a: unknown, b: unknown): boolean {
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (!da || !db) return false;
  const n = Math.min(da.length, db.length, 10);
  if (n < 7) return da === db;
  return da.slice(-n) === db.slice(-n);
}

/** Last-10-digits key used for the DB lookup (customers.phone_digits). */
export function phoneLookupKey(p: unknown): string {
  const d = normalizePhoneDigits(p);
  return d.slice(-10);
}

/**
 * Normalise a phone for wa.me / the WhatsApp API template, mirroring
 * sendWhatsAppReceipt(): strip non-digits, replace a leading 0 with the
 * default country code. The admin number is stored as 201515041807.
 */
export function normalizeForWhatsApp(phone: unknown, defaultCountryCode: string): string {
  let d = normalizePhoneDigits(phone);
  if (!d) return "";
  if (d.startsWith("0")) d = defaultCountryCode + d.slice(1);
  else if (!d.startsWith(defaultCountryCode)) d = defaultCountryCode + d;
  return d;
}
