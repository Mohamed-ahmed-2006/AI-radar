import type { RadarDashboardData } from "@/components/radar/types";
import { isSupabaseReadConfigured } from "@/lib/supabase/env";
import { getSentinelView } from "@/lib/sentinel/ui-data";

import { getLiveRadarDashboardData } from "./read-model";
import { sentinelSnapshotFromView, unavailableSentinelSnapshot } from "./sentinel-snapshot";
import { unavailableRadarDashboardData } from "./unavailable";

export interface LoadRadarDashboardOptions {
  /** Override for tests. Production leaves this unset. */
  configured?: boolean;
}

/**
 * Dashboard page data. Missing or failed live reads become an unavailable
 * empty state — never `MOCK_RADAR_DATA`.
 */
export async function loadRadarDashboardPageData(
  options: LoadRadarDashboardOptions = {},
): Promise<RadarDashboardData> {
  const configured = options.configured ?? isSupabaseReadConfigured();
  if (!configured) {
    return unavailableRadarDashboardData(
      "Live catalog is not configured. The dashboard will not substitute fixture models, prices, or Sentinel counts.",
    );
  }

  let data: RadarDashboardData;
  try {
    data = await getLiveRadarDashboardData();
  } catch (cause) {
    return unavailableRadarDashboardData(
      cause instanceof Error
        ? cause.message
        : "Live dashboard data could not be read.",
    );
  }

  try {
    data.sentinel = sentinelSnapshotFromView(await getSentinelView());
  } catch (cause) {
    data.sentinel = unavailableSentinelSnapshot(
      cause instanceof Error
        ? cause.message
        : "Sentinel source health could not be read.",
    );
  }

  return data;
}
