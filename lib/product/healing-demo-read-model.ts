/**
 * Canonical healing-demo adapter.
 *
 * Reads Claude's registered Bright Data backend port and projects it into the
 * UI read model. If the port is missing or throws, the page reports
 * "Real healing demo unavailable". There is no fixture fallback and no path
 * through `runSentinelDemoSimulation`.
 */

import {
  getHealingDemoBackend,
  type HealingDemoBackendPort,
} from "../healing-demo/backend";
import {
  projectHealingDemoSnapshot,
  registerDefaultHealingDemoAdapter,
  unavailableHealingDemoReadModel,
  type HealingDemoAction,
  type HealingDemoAdapter,
  type HealingDemoReadModel,
} from "./healing-demo";

export const CANONICAL_HEALING_DEMO_ADAPTER_ID = "canonical-healing-demo-v1";

export interface CanonicalHealingDemoDeps {
  port?: HealingDemoBackendPort | null;
  now?: () => Date;
}

export function createCanonicalHealingDemoAdapter(
  deps: CanonicalHealingDemoDeps = {},
): HealingDemoAdapter {
  const resolvePort = (): HealingDemoBackendPort | null =>
    deps.port === undefined ? getHealingDemoBackend() : deps.port;

  const unavailable = (reason?: string): HealingDemoReadModel =>
    unavailableHealingDemoReadModel({
      generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
      adapterId: CANONICAL_HEALING_DEMO_ADAPTER_ID,
      reason,
    });

  return {
    id: CANONICAL_HEALING_DEMO_ADAPTER_ID,
    label: "Real Bright Data healing demo",
    isFixture: false,
    async getState(): Promise<HealingDemoReadModel> {
      const port = resolvePort();
      if (!port) return unavailable();
      try {
        return projectHealingDemoSnapshot(await port.getSnapshot(), {
          adapterId: CANONICAL_HEALING_DEMO_ADAPTER_ID,
          kind: "real_bright_data_demo",
          isFixture: false,
        });
      } catch (cause) {
        return unavailable(
          cause instanceof Error ? cause.message : "Real healing demo unavailable",
        );
      }
    },
    async runAction(action: HealingDemoAction): Promise<HealingDemoReadModel> {
      const port = resolvePort();
      if (!port) return unavailable();
      try {
        return projectHealingDemoSnapshot(await port.dispatch(action), {
          adapterId: CANONICAL_HEALING_DEMO_ADAPTER_ID,
          kind: "real_bright_data_demo",
          isFixture: false,
        });
      } catch (cause) {
        return unavailable(
          cause instanceof Error ? cause.message : "Real healing demo unavailable",
        );
      }
    },
  };
}

export function installCanonicalHealingDemoAdapter(): void {
  registerDefaultHealingDemoAdapter(createCanonicalHealingDemoAdapter);
}
