/**
 * Model Explorer read boundary: the explorer grid, model detail and model
 * comparison.
 *
 * Everything exported here is read-only by construction. There is no write path
 * in this module — models, prices, lifecycle and capabilities are written by
 * ingestion with the service-role client, never through this boundary.
 */

export * from "./types";
export * from "./evidence";
export * from "./filters";
export * from "./read-model";
export * from "./handler";
export {
  createModelExplorerReadPort,
  SupabaseModelExplorerReadPort,
  type ModelExplorerReadPort,
} from "./port";
export {
  InMemoryModelExplorerReadPort,
  type InMemoryExplorerData,
} from "./in-memory-port";
