/**
 * Public entry point for the persistence layer.
 *
 * Note: `./client` is intentionally not re-exported here. It is a client
 * component module and importing it from server code would drag "use client"
 * into the server graph — import it directly where you need it.
 */

export * from "./types";
export * from "./repository";
export {
  createSupabaseServerClient,
  createSupabaseAdminClient,
  type SupabaseServerClient,
} from "./server";
