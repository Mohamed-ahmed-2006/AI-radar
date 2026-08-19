import type { Metadata } from "next";
import Link from "next/link";

import { ModelExplorerView } from "@/components/product/explorer/ModelExplorerView";
import { PageIntro } from "@/components/product/common/PageIntro";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import { ErrorState } from "@/components/radar/ui/DataState";
import {
  compareIdsFromParams,
  explorerFiltersFromParams,
  flattenSearchParams,
  getModelExplorerAdapter,
  type ModelExplorerCatalog,
} from "@/lib/product";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Models — AI Radar",
  description:
    "Explore observed AI model pricing, capabilities, context limits, lifecycle and freshness, each traceable to its source.",
};

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flattenSearchParams(await searchParams);
  const filters = explorerFiltersFromParams(params);
  const compareIds = compareIdsFromParams(params);
  const adapter = getModelExplorerAdapter();

  let catalog: ModelExplorerCatalog | null = null;
  let error: string | null = null;

  try {
    catalog = await adapter.listModels(filters);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unknown read failure.";
  }

  return (
    <RadarShell
      isMock={catalog?.isDemo ?? false}
      footer={<p>AI Radar · Model explorer · Adapter {adapter.id}</p>}
    >
      <div className="radar-surface-stack">
        <PageIntro
          title="Model explorer"
          description="Observed pricing, capabilities, context, lifecycle and freshness across the catalog. Unknown capabilities are shown as Unknown — not as unsupported. Select models to compare; this page does not rank them."
          action={
            <span className="radar-page-intro-links">
              <Link href="/models/compare" className="radar-inline-link">
                Compare
              </Link>
              <Link href="/my-stack" className="radar-inline-link">
                My Stack
              </Link>
              <Link href="/optimizer" className="radar-inline-link">
                Find a best fit
              </Link>
              <Link href="/ask" className="radar-inline-link">
                Ask AI Radar
              </Link>
            </span>
          }
        />

        {error !== null || !catalog ? (
          <ErrorState
            title="The model catalog could not be read"
            description={error ?? undefined}
          />
        ) : (
          <ModelExplorerView
            initialCatalog={catalog}
            initialFilters={filters}
            initialCompareIds={compareIds}
          />
        )}
      </div>
    </RadarShell>
  );
}
