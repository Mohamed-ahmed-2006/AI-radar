import type { Metadata } from "next";
import Link from "next/link";

import { DemoNotice } from "@/components/product/common/DemoNotice";
import { PageIntro } from "@/components/product/common/PageIntro";
import { SourceDirectoryList } from "@/components/product/sources/SourceDirectoryList";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import { ErrorState } from "@/components/radar/ui/DataState";
import { Panel } from "@/components/radar/ui/Panel";
// Importing the barrel installs the default Sentinel-backed adapter.
import { getSourceDetailAdapter, type SourceDirectory } from "@/lib/product";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sources — AI Radar",
  description:
    "Every collection source AI Radar tracks, with current Sentinel health, freshness, collector identity and provenance.",
};

export default async function SourcesPage() {
  const adapter = getSourceDetailAdapter();
  let directory: SourceDirectory | null = null;
  let error: string | null = null;

  try {
    directory = await adapter.listSources();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unknown read failure.";
  }

  return (
    <RadarShell
      isMock={directory?.isDemo ?? false}
      footer={<p>AI Radar · Source registry · Adapter {adapter.id}</p>}
    >
      <div className="radar-surface-stack">
        <PageIntro
          title="Sources"
          description="Every page AI Radar collects from, with its current collection state. Open a source to inspect its run history, what it observed versus what was trusted, its incident and healing record, and how its raw payload becomes normalized data."
          action={
            <Link href="/source-health" className="radar-inline-link">
              Sentinel fleet view
            </Link>
          }
        />

        {directory?.isDemo && (
          <DemoNotice title="Source health is showing the deterministic demo simulation.">
            {directory.demoScenario
              ? `Scenario: ${directory.demoScenario}.`
              : "No production collection run produced this state."}
          </DemoNotice>
        )}

        <Panel
          id="source-registry"
          title="Tracked sources"
          subtitle={
            directory
              ? `${directory.entries.length} source${directory.entries.length === 1 ? "" : "s"}`
              : undefined
          }
        >
          {error !== null ? (
            <ErrorState title="Source registry could not be read" description={error} />
          ) : (
            <SourceDirectoryList entries={directory?.entries ?? []} />
          )}
        </Panel>
      </div>
    </RadarShell>
  );
}
