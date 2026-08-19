import type { Metadata } from "next";
import Link from "next/link";

import { HealingDemoView } from "@/components/product/healing-demo/HealingDemoView";
import { PageIntro } from "@/components/product/common/PageIntro";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import {
  getHealingDemoAdapter,
  HEALING_DEMO_UNAVAILABLE_TITLE,
  unavailableHealingDemoReadModel,
  type HealingDemoReadModel,
} from "@/lib/product";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SourcePulse recovery demo — AI Radar",
  description:
    "Judge-facing SourcePulse recovery: Bright Data Scraper Studio healing, Sentinel quarantine, last-known-good, preview validation and recovery.",
};

export default async function HealingDemoPage() {
  const adapter = getHealingDemoAdapter();
  let model: HealingDemoReadModel;
  try {
    model = await adapter.getState();
  } catch (cause) {
    model = unavailableHealingDemoReadModel({
      adapterId: adapter.id,
      reason: cause instanceof Error ? cause.message : HEALING_DEMO_UNAVAILABLE_TITLE,
    });
  }

  return (
    <RadarShell
      isMock={model.isDemo}
      footer={
        <p>
          AI Radar · SourcePulse · Bright Data Scraper Studio · Adapter {adapter.id}
        </p>
      }
    >
      <div className="radar-surface-stack">
        <PageIntro
          title="SourcePulse recovery"
          description="Real Bright Data healing demo. Sentinel detects a contract break, quarantines the candidate, keeps last-known-good, then heals, validates, approves, reruns and recovers."
          action={
            <span className="radar-page-intro-links">
              <Link href="/source-health" className="radar-inline-link">
                Source Health
              </Link>
              <Link href="/sources" className="radar-inline-link">
                Sources
              </Link>
            </span>
          }
        />
        <HealingDemoView initial={model} />
      </div>
    </RadarShell>
  );
}
