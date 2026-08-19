/**
 * Read models and adapters for the product surfaces: What Changed?, Source
 * Detail, provenance, My Stack, Model Explorer, Stack Optimizer, and Ask AI Radar.
 *
 * Importing this module installs the default adapters, so pages only need
 * `getSourceDetailAdapter()` / `getModelExplorerAdapter()` /
 * `getOptimizerAdapter()` / `getAskAdapter()`. The richer source-detail and
 * provenance read model is installed explicitly below, after both adapter
 * modules have loaded, so the winner never depends on import order. The
 * explorer seam is served by the canonical Explorer/Compare read model in
 * `lib/explorer`, installed the same way.
 *
 * Optimizer and Ask ship a replaceable fixture adapter until Claude's
 * deterministic optimizer and grounded NL backend are installed. Components
 * never call those backends directly.
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
export * from "./optimizer-fixture";
export * from "./ask";
export * from "./ask-fixture";

import { installCanonicalExplorerAdapter } from "./explorer-read-model";
import { installSourceReadModelAdapter } from "./source-detail-read-model";

installSourceReadModelAdapter();
installCanonicalExplorerAdapter();
