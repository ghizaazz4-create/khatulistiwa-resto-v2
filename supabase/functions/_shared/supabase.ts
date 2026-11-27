// Shared Supabase clients for Edge Functions.
// - serviceClient(): SERVICE_ROLE key — bypasses RLS. ONLY ever used inside
//   Edge Functions, never shipped to the browser. This is the trust boundary:
//   the anon key can only read the public menu (see 001_init.sql RLS).
// - anonClient(): anon key, for the rare case a function needs an RLS-checked read.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function anonClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Settings as a plain {key: value} object, exactly like getAppData() returns. */
export async function getSettings(
  sb: SupabaseClient,
): Promise<Record<string, string>> {
  const { data, error } = await sb.from("settings").select("key, value");
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const row of data ?? []) out[String(row.key).trim()] = String(row.value ?? "");
  return out;
}
