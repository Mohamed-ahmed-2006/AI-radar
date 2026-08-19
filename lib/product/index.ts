/**
 * Read models and adapters for the product surfaces: What Changed?, Source
 * Detail, provenance, My Stack, and Model Explorer.
 *
 * Importing this module installs the default adapters, so pages only need
 * `getSourceDetailAdapter()` / `getModelExplorerAdapter()`. The richer
 * source-detail and provenance read model is installed explicitly below, after
 * both adapter modules have loaded, so the winner never depends on import
 * order. The catalog-backed explorer adapter is the current default; a richer
 * Explorer/Compare read model replaces it the same way.
 */

export * from "./provenance";
export * from "./change-feed";
export * from "./watchlist";
export * from "./source-detail";
export * from "./sentinel-source-detail";
export * from "./source-detail-read-model";
export * from "./explorer";
export * from "./explorer-catalog";

import { installCatalogExplorerAdapter } from "./explorer-catalog";
import { installSourceReadModelAdapter } from "./source-detail-read-model";

installSourceReadModelAdapter();
installCatalogExplorerAdapter();
