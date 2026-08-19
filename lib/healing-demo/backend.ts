/**
 * Registration point for Claude's real Bright Data healing-demo backend.
 *
 * This module owns no healing logic, no collector calls and no persistence.
 * Until a port is registered, the UI reports "Real healing demo unavailable"
 * and never falls back to the in-memory Sentinel simulation.
 *
 * Claude's merge should call `registerHealingDemoBackend(port)` from the
 * real-healing-demo backend module, then import that module from the product
 * barrel so the port is installed at boot.
 */

import type {
  HealingDemoAction,
  HealingDemoBackendSnapshot,
} from "../product/healing-demo";

export interface HealingDemoBackendPort {
  getSnapshot(): Promise<HealingDemoBackendSnapshot>;
  dispatch(action: HealingDemoAction): Promise<HealingDemoBackendSnapshot>;
}

let registered: HealingDemoBackendPort | null = null;

export function registerHealingDemoBackend(
  port: HealingDemoBackendPort | null,
): void {
  registered = port;
}

export function getHealingDemoBackend(): HealingDemoBackendPort | null {
  return registered;
}
