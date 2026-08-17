import { RadarDashboard } from "@/components/radar/dashboard/RadarDashboard";
import { MOCK_RADAR_DATA } from "@/components/radar/fixtures/mock-radar-data";
import { RadarShell } from "@/components/radar/layout/RadarShell";

export default function Home() {
  // Integration point: replace MOCK_RADAR_DATA with server-fetched API/Supabase data
  const data = MOCK_RADAR_DATA;

  return (
    <RadarShell
      footer={
        <p>
          AI Radar · Bright Data Scraper Studio · Fixture {data.fixtureVersion}
        </p>
      }
    >
      <RadarDashboard data={data} />
    </RadarShell>
  );
}
