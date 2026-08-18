import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SourceDetail } from "@/components/product/sources/SourceDetail";
import { RadarShell } from "@/components/radar/layout/RadarShell";
import { ErrorState } from "@/components/radar/ui/DataState";
// Importing the barrel installs the default Sentinel-backed adapter.
import { getSourceDetailAdapter, type SourceDetailView } from "@/lib/product";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Source detail — AI Radar",
  description:
    "Collection integrity, freshness, validation history, incidents and provenance for a single AI Radar source.",
};

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}) {
  const { sourceId } = await params;
  const adapter = getSourceDetailAdapter();

  let detail: SourceDetailView | null = null;
  let error: string | null = null;

  try {
    detail = await adapter.getSourceDetail(decodeURIComponent(sourceId));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unknown read failure.";
  }

  if (error === null && detail === null) notFound();

  return (
    <RadarShell
      isMock={detail?.isDemo ?? false}
      footer={<p>AI Radar · Source detail · Adapter {adapter.id}</p>}
    >
      <div className="radar-surface-stack">
        <nav aria-label="Breadcrumb" className="radar-breadcrumb">
          <Link href="/sources" className="radar-inline-link">
            Sources
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-radar-text-muted">{detail?.identity.name ?? sourceId}</span>
        </nav>

        {detail ? (
          <SourceDetail detail={detail} />
        ) : (
          <ErrorState
            title="This source could not be read"
            description={error ?? undefined}
          />
        )}
      </div>
    </RadarShell>
  );
}
