import type { Metadata } from "next";

import { RadarShell } from "@/components/radar/layout/RadarShell";
import { SourceHealthDashboard } from "@/components/radar/sentinel/SourceHealthDashboard";
import type { SentinelView } from "@/components/radar/sentinel/types";
import { getSentinelView } from "@/lib/sentinel/ui-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Source Health — AI Radar Sentinel",
  description:
    "Collection integrity for every AI Radar source: anomaly detection, snapshot quarantine, self-healing, and last-known-good recovery.",
};

export default async function SourceHealthPage() {
  let view: SentinelView | null = null;
  let error: string | null = null;

  try {
    view = await getSentinelView();
  } catch (cause) {
    // A read failure must not blank the page; the dashboard renders its error
    // state so the operator can still see that Sentinel is unreachable.
    error = cause instanceof Error ? cause.message : "Unknown read failure.";
  }

  return (
    <RadarShell
      isMock={view?.isDemo ?? false}
      footer={
        <p>
          AI Radar Sentinel ·{" "}
          {view?.isDemo
            ? `Demo simulation — ${view.demoScenario ?? "deterministic scenario"}`
            : "Live Sentinel source health"}
        </p>
      }
    >
      <SourceHealthDashboard view={view} error={error} />
    </RadarShell>
  );
}
