/**
 * Read models and adapters for the product surfaces: What Changed?, Source
 * Detail, provenance, My Stack, Model Explorer, Stack Optimizer, and Ask AI Radar.
 *
 * Importing this module installs the default adapters, so pages only need
 * `getSourceDetailAdapter()` / `getModelExplorerAdapter()` /
 * `getOptimizerAdapter()` / `getAskAdapter()`. The richer source-detail and
 * provenance read model is installed explicitly below, after both adapter
 * modules have loaded, so the winner never depends on import order.
 *
 * Stack Optimizer and Ask AI Radar are served by the deterministic backend in
 * `lib/optimizer` and `lib/ask`. Fixture adapters remain exported for tests
 * and are not installed as a production fallback.
 */

export * from "./provenance";
export * from "./change-feed";
export * from "./watchlist";
export * from "./source-detail";
export * from "./sentinel-source-detail";
export * from "./source-detail-read-model";
export * from "./explorer";
export * from "./explorer-read-model";
export * from "./optimizer";
export * from "./optimizer-read-model";
export * from "./optimizer-fixture";
export * from "./ask";
export * from "./ask-read-model";
export * from "./ask-fixture";

import { installCanonicalAskAdapter } from "./ask-read-model";
import { installCanonicalExplorerAdapter } from "./explorer-read-model";
import { installCanonicalOptimizerAdapter } from "./optimizer-read-model";
import { installSourceReadModelAdapter } from "./source-detail-read-model";

installSourceReadModelAdapter();
installCanonicalExplorerAdapter();
installCanonicalOptimizerAdapter();
installCanonicalAskAdapter();
