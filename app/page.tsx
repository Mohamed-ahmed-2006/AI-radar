import { RadarDashboard } from "@/components/radar/dashboard/RadarDashboard";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import { loadRadarDashboardPageData } from "@/lib/radar";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await loadRadarDashboardPageData();
  const live = !data.isMock && !data.unavailableReason;

  return (
    <RadarShell
      isMock={data.isMock}
      footer={
        <p>
          AI Radar · Bright Data Scraper Studio ·{" "}
          {data.isMock
            ? `Fixture ${data.fixtureVersion}`
            : live
              ? "Live Supabase data"
              : "Live data unavailable"}
        </p>
      }
    >
      <RadarDashboard data={data} />
    </RadarShell>
  );
}
