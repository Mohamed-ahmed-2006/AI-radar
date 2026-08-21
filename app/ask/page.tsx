import type { Metadata } from "next";
import Link from "next/link";

import { AskView } from "@/components/product/ask/AskView";
import { PageIntro } from "@/components/product/common/PageIntro";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import { ErrorState } from "@/components/radar/ui/DataState";
import {
  askQueryFromParams,
  flattenSearchParams,
  getAskAdapter,
  type AskReadModel,
} from "@/lib/product";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ask AI Radar — Natural-language intelligence",
  description:
    "Ask temporal and decision questions answered from live trusted evidence, not model memory.",
};

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flattenSearchParams(await searchParams);
  const query = askQueryFromParams(params);
  const adapter = getAskAdapter();

  let result: AskReadModel | null = null;
  let error: string | null = null;

  if (query) {
    try {
      result = await adapter.ask(query);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Unknown read failure.";
    }
  }

  return (
    <RadarShell
      isMock={result?.isDemo ?? false}
      footer={<p>AI Radar · Ask · Adapter {adapter.id}</p>}
    >
      <div className="radar-surface-stack">
        <PageIntro
          title="Ask AI Radar"
          description="Model facts about one model, temporal questions about what changed, and decision questions about eligible models. Answers are assembled from observed evidence — not from model memory."
          action={
            <span className="radar-page-intro-links">
              <Link href="/changes" className="radar-inline-link">
                Changes
              </Link>
              <Link href="/optimizer" className="radar-inline-link">
                Optimizer
              </Link>
              <Link href="/models" className="radar-inline-link">
                Models
              </Link>
              <Link href="/sources" className="radar-inline-link">
                Sources
              </Link>
            </span>
          }
        />

        {error !== null ? (
          <ErrorState
            title="Ask AI Radar could not be read"
            description={error}
          />
        ) : (
          <AskView initialQuery={query} initialResult={result} />
        )}
      </div>
    </RadarShell>
  );
}
