import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ModelDetailView } from "@/components/product/explorer/ModelDetailView";
import { PageIntro } from "@/components/product/common/PageIntro";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import { ErrorState } from "@/components/radar/ui/DataState";
import { getModelExplorerAdapter, type ModelDetailReadModel } from "@/lib/product";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ modelId: string }>;
}): Promise<Metadata> {
  const { modelId } = await params;
  return {
    title: `${decodeURIComponent(modelId)} — AI Radar`,
    description: "Observed identity, pricing, capabilities, limits, lifecycle and provenance for one model.",
  };
}

export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ modelId: string }>;
}) {
  const canonicalId = decodeURIComponent((await params).modelId);
  const adapter = getModelExplorerAdapter();

  let detail: ModelDetailReadModel | null = null;
  let error: string | null = null;

  try {
    detail = await adapter.getModelDetail(canonicalId);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unknown read failure.";
  }

  if (error === null && detail === null) notFound();

  return (
    <RadarShell
      isMock={detail?.isDemo ?? false}
      footer={<p>AI Radar · Model detail · Adapter {adapter.id}</p>}
    >
      <div className="radar-surface-stack">
        <nav aria-label="Breadcrumb" className="radar-breadcrumb">
          <Link href="/models" className="radar-inline-link">
            Models
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-radar-text-muted">
            {detail?.identity.displayName ?? canonicalId}
          </span>
        </nav>

        {detail ? (
          <>
            <PageIntro
              title={detail.identity.displayName}
              description={`${detail.identity.providerName} · observed catalog record. Missing fields stay unavailable rather than invented.`}
            />
            <ModelDetailView detail={detail} />
          </>
        ) : (
          <ErrorState
            title="This model could not be read"
            description={error ?? undefined}
          />
        )}
      </div>
    </RadarShell>
  );
}
