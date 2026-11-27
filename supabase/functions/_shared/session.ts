// Staff sessions — the Supabase replacement for the original login model.
// ORIGINAL MODEL (Kode.js): no Supabase Auth, no Google login. Staff log in
// by picking an employee and entering a 4–6 digit PIN; verifyPin() compares
// the SHA-256 hex digest (hashPassword()) with employees.pin_hash and the
// browser keeps the employee in localStorage ('bento_session_user').
// THIS SCAFFOLD PRESERVES THAT MODEL, with one deliberate hardening: the
// browser no longer holds a bare employee object that any script could
// forge. verifyPin() (in staff-api) now also issues a short-lived HMAC
// token (12h) signed with STAFF_SESSION_SECRET, and staff-api verifies it
// on every staff action. The token is stored in sessionStorage.
// This is NOT Supabase Auth. If the resto later wants real accounts
// (email/password, MFA, per-user RLS), that is a separate, larger change —
// see MIGRATION_NOTES.md §5. The secret must be set per project:
//   supabase secrets set STAFF_SESSION_SECRET="$(openssl rand -hex 32)"
// Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256).

export interface StaffSession {
  employeeId: string;
  name: string;
  role: string;
  scope: "staff" | "display";
  exp: number; // epoch ms
}

function b64url(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(
  session: Omit<StaffSession, "exp">,
  ttlMs = 12 * 60 * 60 * 1000,
): Promise<string> {
  const secret = Deno.env.get("STAFF_SESSION_SECRET");
  if (!secret) throw new Error("STAFF_SESSION_SECRET not set");
  const payload: StaffSession = { ...session, exp: Date.now() + ttlMs };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(body),
  );
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

export async function verifySession(token: string | null | undefined): Promise<StaffSession | null> {
  try {
    if (!token) return null;
    const secret = Deno.env.get("STAFF_SESSION_SECRET");
    if (!secret) return null;
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      unb64url(sig),
      new TextEncoder().encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(unb64url(body)),
    ) as StaffSession;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** SHA-256 hex digest, identical to hashPassword() in Kode.js. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(input)),
  );
  return [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
