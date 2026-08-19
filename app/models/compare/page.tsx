import type { Metadata } from "next";
import Link from "next/link";

import { ModelCompareView } from "@/components/product/explorer/ModelCompareView";
import { PageIntro } from "@/components/product/common/PageIntro";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import { ErrorState } from "@/components/radar/ui/DataState";
import {
  compareIdsFromParams,
  flattenSearchParams,
  getModelExplorerAdapter,
  type ModelCompareReadModel,
} from "@/lib/product";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compare models — AI Radar",
  description:
    "Side-by-side observed pricing, capabilities, limits, lifecycle and freshness. Canonical ids make a comparison shareable. No ranking.",
};

export default async function ModelComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ids = compareIdsFromParams(flattenSearchParams(await searchParams));
  const adapter = getModelExplorerAdapter();

  let comparison: ModelCompareReadModel | null = null;
  let error: string | null = null;

  try {
    comparison = await adapter.compareModels(ids);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unknown read failure.";
  }

  return (
    <RadarShell
      isMock={comparison?.isDemo ?? false}
      footer={<p>AI Radar · Model compare · Adapter {adapter.id}</p>}
    >
      <div className="radar-surface-stack">
        <nav aria-label="Breadcrumb" className="radar-breadcrumb">
          <Link href="/models" className="radar-inline-link">
            Models
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-radar-text-muted">Compare</span>
        </nav>

        <PageIntro
          title="Compare models"
          description="Aligned observations for the canonical ids in this URL. Values that were not observed stay Not observed. This view does not rank models or name a winner."
          action={
            <span className="radar-page-intro-links">
              <Link href="/models" className="radar-inline-link">
                Models
              </Link>
              <Link href="/models/compare" className="radar-inline-link">
                Compare
              </Link>
              <Link href="/my-stack" className="radar-inline-link">
                My Stack
              </Link>
              <Link href="/optimizer" className="radar-inline-link">
                Rank with Optimizer
              </Link>
              <Link href="/ask" className="radar-inline-link">
                Ask AI Radar
              </Link>
            </span>
          }
        />

        {error !== null || !comparison ? (
          <ErrorState
            title="This comparison could not be read"
            description={error ?? undefined}
          />
        ) : (
          <ModelCompareView comparison={comparison} />
        )}
      </div>
    </RadarShell>
  );
}
