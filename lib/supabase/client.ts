"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublishableKey, getSupabaseUrl } from "./env";
import type { Database } from "./types";

export type SupabaseBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

let cached: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * Anon-key client for client components. Reads only: every table is
 * public-select / no-write under RLS.
 */
export function createSupabaseBrowserClient() {
  cached ??= createBrowserClient<Database>(getSupabaseUrl(), getSupabasePublishableKey());
  return cached;
}
