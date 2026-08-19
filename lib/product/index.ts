/**
 * Read models and adapters for the product surfaces: What Changed?, Source
 * Detail, provenance, and My Stack.
 *
 * Importing this module installs the default (Sentinel-backed) source-detail
 * adapter, so pages only need `getSourceDetailAdapter()`.
 */

export * from "./provenance";
export * from "./change-feed";
export * from "./watchlist";
export * from "./source-detail";
export * from "./sentinel-source-detail";
