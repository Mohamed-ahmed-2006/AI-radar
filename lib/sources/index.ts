/**
 * SourcePulse: source detail and provenance read boundary.
 *
 * Everything exported here is read-only by construction. There is no write
 * path in this module: source configuration, incidents and healing state are
 * mutated by ingestion and Sentinel with the service-role client, never through
 * this boundary.
 */

export * from "./types";
export * from "./contract-view";
export * from "./transformation";
export * from "./sanitize";
export * from "./read-model";
export * from "./provenance";
export * from "./handler";
export {
  createSourceReadPort,
  SupabaseSourceReadPort,
  type SourceReadPort,
  type PublicCollectionRunRow,
  type PublicHealingAttemptRow,
} from "./port";
export { InMemorySourceReadPort, type InMemorySourceData } from "./in-memory-port";
