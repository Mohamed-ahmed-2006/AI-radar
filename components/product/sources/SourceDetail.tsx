import Link from "next/link";

import { Panel } from "../../radar/ui/Panel";
import { HEALING_DEMO_HREF } from "../../../lib/product/healing-demo";
import type { SourceDetailView } from "../../../lib/product/source-detail";
import { DemoNotice } from "../common/DemoNotice";
import { PageIntro } from "../common/PageIntro";
import { ProvenanceDetails } from "../provenance/ProvenanceDetails";
import { SourceDataPanel } from "./SourceDataPanel";
import { SourceDetailLayout } from "./SourceDetailLayout";
import { SourceHealthSummary } from "./SourceHealthSummary";
import { SourceIdentityPanel } from "./SourceIdentityPanel";
import { SourceIncidentPanel } from "./SourceIncidentPanel";
import { SourceNormalizationPanel } from "./SourceNormalizationPanel";
import { SourceRunHistoryPanel } from "./SourceRunHistoryPanel";

/**
 * Everything known about one collection source.
 *
 * The whole page reads `SourceDetailView` and nothing else, so replacing the
 * adapter behind it (see `lib/product/source-detail.ts`) changes what these
 * panels can show without changing any of this markup.
 */
export function SourceDetail({ detail }: { detail: SourceDetailView }) {
  return (
    <SourceDetailLayout
      hero={
        <>
          <PageIntro
            title={detail.identity.name}
            description={`${detail.identity.providerName} · ${detail.identity.category} source. Collection integrity, freshness, provenance and the path from raw payload to trusted data.`}
            action={
              <span className="radar-page-intro-links">
                <Link href="/source-health" className="radar-inline-link">
                  Source Health
                </Link>
                <Link href={HEALING_DEMO_HREF} className="radar-inline-link">
                  Real healing demo
                </Link>
              </span>
            }
          />

          {detail.isDemo && (
            <DemoNotice title="This source page is showing the deterministic demo simulation.">
              {detail.demoScenario
                ? `Scenario: ${detail.demoScenario}. `
                : ""}
              No production collection run produced the state below.
            </DemoNotice>
          )}

          <SourceHealthSummary
            health={detail.health}
            recovery={detail.recovery}
            freshness={detail.freshness}
          />
        </>
      }
      overview={
        <SourceDataPanel
          observedData={detail.observedData}
          lastKnownGood={detail.lastKnownGood}
        />
      }
      runs={<SourceRunHistoryPanel runHistory={detail.runHistory} />}
      incidents={
        <SourceIncidentPanel
          incidents={detail.incidents}
          healingTimeline={detail.healingTimeline}
          sourceName={detail.identity.name}
        />
      }
      healing={
        <SourceIncidentPanel
          incidents={detail.incidents}
          healingTimeline={detail.healingTimeline}
          sourceName={detail.identity.name}
        />
      }
      evidence={
        <div className="radar-surface-stack">
          <SourceIdentityPanel identity={detail.identity} />
          <SourceNormalizationPanel normalization={detail.normalization} />
          <Panel
            id="source-provenance"
            title="Provenance"
            subtitle="The record behind everything on this page"
          >
            <ProvenanceDetails provenance={detail.provenance} />
          </Panel>
        </div>
      }
    />
  );
}
