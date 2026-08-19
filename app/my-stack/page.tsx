import type { Metadata } from "next";
import Link from "next/link";

import { PageIntro } from "@/components/product/common/PageIntro";
import { MyStackView } from "@/components/product/watchlist/MyStackView";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import { queryTemporalIntelligence } from "@/lib/intelligence";
import {
  buildChangeFeed,
  type ChangeFeedFilters,
} from "@/lib/product/change-feed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Stack — AI Radar",
  description:
    "Track the models you depend on and see the pricing, lifecycle and deprecation changes that affect them.",
};

/**
 * The stack itself lives in the visitor's browser, so the server can only
 * prepare the candidate change set; the client narrows it to the watched
 * models after mount.
 */
export default async function MyStackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const demo = (Array.isArray(params.demo) ? params.demo[0] : params.demo) === "true";

  const filters: ChangeFeedFilters = {
    provider: null,
    category: null,
    range: "90d",
    demo,
  };

  const bundle = await queryTemporalIntelligence({
    range: filters.range,
    demo,
    limit: 200,
    includeSummary: false,
  });

  const feed = buildChangeFeed(bundle);

  return (
    <RadarShell
      isMock={feed.isDemoData}
      footer={<p>AI Radar · My Stack is stored in this browser only</p>}
    >
      <div className="radar-surface-stack">
        <PageIntro
          title="My Stack"
          description="The models you depend on. Changes affecting them are prioritized here and in the change feed. Your stack is stored in this browser only — there is no account and nothing is sent anywhere."
          action={
            <span className="radar-page-intro-links">
              <Link href="/optimizer" className="radar-inline-link">
                Optimize this stack
              </Link>
              <Link href="/models" className="radar-inline-link">
                Explore Models
              </Link>
              <Link href="/changes" className="radar-inline-link">
                Browse all changes
              </Link>
            </span>
          }
        />
        <MyStackView initialFeed={feed} filters={filters} />
      </div>
    </RadarShell>
  );
}
