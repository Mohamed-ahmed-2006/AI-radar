/**
 * Environment access for the Supabase layer.
 *
 * `NEXT_PUBLIC_*` values are safe in the browser bundle. The service role key
 * is read through `requireServiceRoleKey`, which refuses to run outside the
 * server so it can never be inlined into client code.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. See .env.example for the full list.`,
    );
  }
  return value;
}

export function getSupabaseUrl(): string {
  // Referenced statically so Next.js can inline it at build time.
  return required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

export function getSupabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function isSupabaseReadConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

/** @deprecated Prefer getSupabasePublishableKey. */
export const getSupabaseAnonKey = getSupabasePublishableKey;

export function assertServerOnly(what: string): void {
  if (typeof window !== "undefined") {
    throw new Error(`${what} must never be used in client code.`);
  }
}

export function requireServiceRoleKey(): string {
  assertServerOnly("SUPABASE_SECRET_KEY");
  return required(
    "SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)",
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
