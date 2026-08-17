import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  assertServerOnly,
  getSupabaseAnonKey,
  getSupabaseUrl,
  requireServiceRoleKey,
} from "./env";
import type { Database } from "./types";

export type SupabaseServerClient = SupabaseClient<Database>;

const noSessionAuth = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

let readClient: SupabaseServerClient | undefined;
let adminClient: SupabaseServerClient | undefined;

/**
 * Anon-key client for server components and route handlers that only read
 * public data. Subject to RLS, so it cannot write.
 */
export function createSupabaseServerClient(): SupabaseServerClient {
  assertServerOnly("createSupabaseServerClient");
  readClient ??= createClient<Database>(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    noSessionAuth,
  );
  return readClient;
}

/**
 * Service-role client used by ingestion. Bypasses RLS, so it must only ever
 * be constructed on the server — `requireServiceRoleKey` enforces that.
 */
export function createSupabaseAdminClient(): SupabaseServerClient {
  const serviceRoleKey = requireServiceRoleKey();
  adminClient ??= createClient<Database>(
    getSupabaseUrl(),
    serviceRoleKey,
    noSessionAuth,
  );
  return adminClient;
}
