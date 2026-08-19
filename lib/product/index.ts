/**
 * Read models and adapters for the product surfaces: What Changed?, Source
 * Detail, provenance, and My Stack.
 *
 * Importing this module installs the default source-detail adapter, so pages
 * only need `getSourceDetailAdapter()`. The richer source-detail and provenance
 * read model is installed explicitly below, after both adapter modules have
 * loaded, so the winner never depends on import order. The Sentinel-backed
 * projection stays exported as a drop-in alternative.
 */

export * from "./provenance";
export * from "./change-feed";
export * from "./watchlist";
export * from "./source-detail";
export * from "./sentinel-source-detail";
export * from "./source-detail-read-model";

import { installSourceReadModelAdapter } from "./source-detail-read-model";

installSourceReadModelAdapter();
