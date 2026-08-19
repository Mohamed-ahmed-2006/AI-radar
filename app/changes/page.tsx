import type { Metadata } from "next";
import Link from "next/link";

import { ChangeFeedView } from "@/components/product/changes/ChangeFeedView";
import { PageIntro } from "@/components/product/common/PageIntro";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import { queryTemporalIntelligence } from "@/lib/intelligence";
import {
  buildChangeFeed,
  changeFeedFiltersFromParams,
  type ChangeFeedFilters,
} from "@/lib/product/change-feed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "What Changed? — AI Radar",
  description:
    "Every observed change across the AI model ecosystem: price moves, lifecycle transitions, deprecations, retirements and recommended replacements, each traceable to its source.",
};

const FEED_LIMIT = 100;

/**
 * The first page is rendered on the server from the same temporal-intelligence
 * query the API exposes — calling it directly avoids a network hop back into
 * our own route. Filtering afterwards happens client-side against
 * `/api/intelligence/changes`.
 */
export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }

  const filters: ChangeFeedFilters = changeFeedFiltersFromParams(flat);

  const [filtered, unfiltered] = await Promise.all([
    queryTemporalIntelligence({
      provider: filters.provider ?? undefined,
      categories: filters.category ? [filters.category] : undefined,
      range: filters.range,
      demo: filters.demo,
      limit: FEED_LIMIT,
    }),
    // Drives the filter controls, so choosing one provider never hides the rest.
    queryTemporalIntelligence({
      range: "all",
      demo: filters.demo,
      limit: 1000,
      includeSummary: false,
    }),
  ]);

  const feed = buildChangeFeed(filtered);
  const options = buildChangeFeed(unfiltered);

  return (
    <RadarShell
      isMock={feed.isDemoData}
      footer={
        <p>
          AI Radar · Temporal intelligence ·{" "}
          {feed.isDemoData ? "Labelled demo evidence" : "Live change events"}
        </p>
      }
    >
      <div className="radar-surface-stack">
        <PageIntro
          title="What changed?"
          description="Observed movement across the AI model ecosystem — price changes, lifecycle transitions, deprecation and retirement schedules, and recommended replacements. Every entry can be traced back to the source page and collection run that produced it."
          action={
            <span className="radar-page-intro-links">
              <Link href="/models" className="radar-inline-link">
                Models
              </Link>
              <Link href="/sources" className="radar-inline-link">
                Sources
              </Link>
              <Link href="/ask" className="radar-inline-link">
                Ask what changed
              </Link>
            </span>
          }
        />
        <ChangeFeedView
          initialFeed={feed}
          initialFilters={filters}
          providerOptions={options.providerOptions}
          categoryOptions={options.categoryOptions}
        />
      </div>
    </RadarShell>
  );
}
