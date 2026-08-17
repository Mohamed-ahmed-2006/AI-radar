import { RadarDashboard } from "@/components/radar/dashboard/RadarDashboard";
import { MOCK_RADAR_DATA } from "@/components/radar/fixtures/mock-radar-data";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import { getLiveRadarDashboardData } from "@/lib/radar/read-model";
import { isSupabaseReadConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = isSupabaseReadConfigured()
    ? await getLiveRadarDashboardData()
    : MOCK_RADAR_DATA;

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
