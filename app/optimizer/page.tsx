import type { Metadata } from "next";
import Link from "next/link";

import { OptimizerView } from "@/components/product/optimizer/OptimizerView";
import { PageIntro } from "@/components/product/common/PageIntro";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import { ErrorState } from "@/components/radar/ui/DataState";
import {
  flattenSearchParams,
  getOptimizerAdapter,
  optimizerInputFromParams,
  optimizerInputWithDefaults,
  type OptimizerReadModel,
} from "@/lib/product";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stack Optimizer — AI Radar",
  description:
    "Find the best-fit model for a workload from observed pricing, context, vision, tools and lifecycle. Ranking is not calculated in the UI.",
};

export default async function OptimizerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flattenSearchParams(await searchParams);
  const input = optimizerInputWithDefaults(optimizerInputFromParams(params), params);
  const adapter = getOptimizerAdapter();

  let result: OptimizerReadModel | null = null;
  let error: string | null = null;

  try {
    result = await adapter.optimize(input);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unknown read failure.";
  }

  return (
    <RadarShell
      isMock={result?.isDemo ?? false}
      footer={<p>AI Radar · Stack Optimizer · Adapter {adapter.id}</p>}
    >
      <div className="radar-surface-stack">
        <PageIntro
          title="Stack Optimizer"
          description="Submit a workload and constraints. Eligible models are ranked by the optimizer adapter. Unknown evidence is not treated as unsupported, and missing prices stay unavailable."
          action={
            <span className="radar-page-intro-links">
              <Link href="/models" className="radar-inline-link">
                Models
              </Link>
              <Link href="/models/compare" className="radar-inline-link">
                Compare
              </Link>
              <Link href="/ask" className="radar-inline-link">
                Ask AI Radar
              </Link>
            </span>
          }
        />

        {error !== null || !result ? (
          <ErrorState
            title="The optimizer could not be read"
            description={error ?? undefined}
          />
        ) : (
          <OptimizerView initialInput={input} initialResult={result} />
        )}
      </div>
    </RadarShell>
  );
}
