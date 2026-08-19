import { RadarDashboard } from "@/components/radar/dashboard/RadarDashboard";
import { MOCK_RADAR_DATA } from "@/components/radar/fixtures/mock-radar-data";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import {
  getLiveRadarDashboardData,
  sentinelSnapshotFromView,
  unavailableSentinelSnapshot,
} from "@/lib/radar";
import { isSupabaseReadConfigured } from "@/lib/supabase/env";
import { getSentinelView } from "@/lib/sentinel/ui-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = isSupabaseReadConfigured()
    ? await getLiveRadarDashboardData()
    : structuredClone(MOCK_RADAR_DATA);

  if (!data.isMock) {
    try {
      data.sentinel = sentinelSnapshotFromView(await getSentinelView());
    } catch (cause) {
      data.sentinel = unavailableSentinelSnapshot(
        cause instanceof Error
          ? cause.message
          : "Sentinel source health could not be read.",
      );
    }
  }

  return (
    <RadarShell
      isMock={data.isMock}
      footer={
        <p>
          AI Radar · Bright Data Scraper Studio · {data.isMock ? `Fixture ${data.fixtureVersion}` : "Live Supabase data"}
        </p>
      }
    >
      <RadarDashboard data={data} />
    </RadarShell>
  );
}
