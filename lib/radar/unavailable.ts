import type { RadarDashboardData } from "@/components/radar/types";

import { unavailableSentinelSnapshot } from "./sentinel-snapshot";

export const UNAVAILABLE_DASHBOARD_VERSION = "live-unavailable";

/**
 * Honest empty dashboard. Used when live reads are not configured or fail.
 * Never a stand-in for `MOCK_RADAR_DATA`: no invented models, prices, or
 * Sentinel zeros.
 */
export function unavailableRadarDashboardData(
  reason: string,
): RadarDashboardData {
  return {
    isMock: false,
    fixtureVersion: UNAVAILABLE_DASHBOARD_VERSION,
    unavailableReason: reason,
    ecosystem: {
      status: "unknown",
      modelsTracked: 0,
      providersTracked: 0,
      sourcesMonitored: 0,
      changesLast24h: 0,
      priceChangesLast7d: 0,
      lifecycleChangesLast7d: 0,
      activeAlerts: 0,
      lastGlobalRefreshAt: "",
    },
    sentinel: unavailableSentinelSnapshot(reason),
    changes: [],
    models: [],
    providers: [],
    sources: [],
    provenance: [],
  };
}
