/**
 * Canonical ingestion for the demo source.
 *
 * This is deliberately the same shape as `ingestPricingProvider`: upsert the
 * provider and source, open a collection run, call `assertSentinelSafe`, and
 * only then write canonical rows. The gate call is the *same function* the
 * pricing, lifecycle and catalog pipelines call — there is no demo-specific
 * validation path and no way for a demo payload to reach `demo_quote_snapshots`
 * without passing it.
 *
 * That is the whole point of the harness: what the judges watch protecting the
 * demo source is the code that protects production.
 */

import { assertSentinelSafe, toSentinelSummary, type SentinelIngestionSummary } from "../pipeline";
import type { SentinelRepository } from "../sentinel/repository";
import type { SourceHealthContract } from "../sentinel/types";
import {
  completeCollectionRun,
  createSupabaseAdminClient,
  failCollectionRun,
  startCollectionRun,
  upsertProvider,
  upsertSource,
  type CollectionRunRow,
  type Json,
  type ProviderRow,
  type SourceRow,
} from "../supabase";
import {
  createDemoSourceHealthContract,
  demoQuoteIdentity,
  type RawDemoQuoteRecord,
} from "./contract";
import {
  DEMO_PROVIDER_HOMEPAGE,
  DEMO_PROVIDER_NAME,
  DEMO_PROVIDER_SLUG,
  type DemoLayout,
  type DemoSourceConfiguration,
} from "./source";

export interface DemoQuoteSnapshotInput {
  runId: string;
  sourceId: string;
  providerId: string;
  quoteKey: string;
  quoteText: string;
  author: string;
  tags: string[];
  sourceUrl: string;
  observedAt: string;
}

/**
 * The persistence surface the demo pipeline needs. Injectable so tests can
 * observe every canonical write without a database.
 */
export interface DemoPipelineRepository {
  upsertProvider(input: {
    slug: string;
    name: string;
    homepageUrl?: string | null;
  }): Promise<ProviderRow>;
  upsertSource(input: {
    providerId: string;
    sourceUrl: string;
    collectorId?: string | null;
    label?: string | null;
  }): Promise<SourceRow>;
  startCollectionRun(input: {
    sourceId: string;
    externalRunId?: string | null;
    triggeredBy?: string;
  }): Promise<CollectionRunRow>;
  completeCollectionRun(
    runId: string,
    counts: { recordsSeen: number; recordsAccepted: number; recordsRejected: number },
  ): Promise<CollectionRunRow>;
  failCollectionRun(
    runId: string,
    error: { message: string; details?: Json },
    counts?: Partial<{ recordsSeen: number; recordsAccepted: number; recordsRejected: number }>,
  ): Promise<CollectionRunRow>;
  /** The only canonical write the demo source performs. */
  saveDemoQuoteSnapshots(input: readonly DemoQuoteSnapshotInput[]): Promise<{ id: string }[]>;
}

export function createDemoPipelineRepository(): DemoPipelineRepository {
  const db = createSupabaseAdminClient();
  return {
    upsertProvider: (input) => upsertProvider(db, input),
    upsertSource: (input) => upsertSource(db, { ...input, kind: "other" }),
    startCollectionRun: (input) => startCollectionRun(db, input),
    completeCollectionRun: (runId, counts) => completeCollectionRun(db, runId, counts),
    failCollectionRun: (runId, error, counts) => failCollectionRun(db, runId, error, counts),
    saveDemoQuoteSnapshots: async (input) => {
      if (input.length === 0) return [];
      const { data, error } = await db
        .from("demo_quote_snapshots")
        .insert(
          input.map((record) => ({
            run_id: record.runId,
            source_id: record.sourceId,
            provider_id: record.providerId,
            quote_key: record.quoteKey,
            quote_text: record.quoteText,
            author: record.author,
            tags: record.tags,
            source_url: record.sourceUrl,
            observed_at: record.observedAt,
          })),
        )
        .select("id");
      if (error) throw new Error(`Failed to save demo quote snapshots: ${error.message}`);
      return (data ?? []) as { id: string }[];
    },
  };
}

export interface IngestDemoObservationOptions {
  configuration: DemoSourceConfiguration;
  /** Which layout produced this payload; recorded as provenance. */
  layout: DemoLayout;
  rawRecords: unknown[];
  /** Set when the collector itself failed. Forces a quarantine decision. */
  collectorError?: Error | string | null;
  externalRunId?: string | null;
  triggeredBy: string;
  observedAt?: string;
  repository?: DemoPipelineRepository;
  sentinelRepository?: SentinelRepository;
}

export interface DemoIngestionResult {
  collectionRunId: string;
  externalRunId: string | null;
  sourceId: string;
  providerId: string;
  acceptedCount: number;
  rejectedCount: number;
  durationMs: number;
  sentinel: SentinelIngestionSummary;
}

/**
 * Runs one demo observation end to end.
 *
 * Throws `SentinelQuarantineError` when the gate refuses the payload. Nothing
 * after the gate call executes in that case, so a refused payload contributes
 * exactly zero canonical rows and leaves the previous run standing as the
 * last-known-good baseline.
 */
export async function ingestDemoObservation(
  options: IngestDemoObservationOptions,
): Promise<DemoIngestionResult> {
  if (typeof window !== "undefined") {
    throw new Error("ingestDemoObservation must only run on the server");
  }

  const repository = options.repository ?? createDemoPipelineRepository();
  const configuration = options.configuration;
  const observedAt = options.observedAt ?? new Date().toISOString();
  const startedAt = Date.now();
  const layoutUrl = configuration.layouts[options.layout].url;

  const provider = await repository.upsertProvider({
    slug: DEMO_PROVIDER_SLUG,
    name: DEMO_PROVIDER_NAME,
    homepageUrl: DEMO_PROVIDER_HOMEPAGE,
  });
  const source = await repository.upsertSource({
    providerId: provider.id,
    // Keyed by the canonical URL so switching layouts stays one source with
    // one continuous run history and one last-known-good baseline.
    sourceUrl: configuration.canonicalSourceUrl,
    collectorId: configuration.collectorId,
    label: configuration.label,
  });

  const run = await repository.startCollectionRun({
    sourceId: source.id,
    externalRunId: options.externalRunId ?? null,
    triggeredBy: options.triggeredBy,
  });

  const contract = createDemoSourceHealthContract(
    source.id,
  ) as unknown as SourceHealthContract<unknown>;

  // The shared Sentinel gate. Identical call site shape to every production
  // pipeline: it fails the run and throws when the payload is unsafe.
  const gate = await assertSentinelSafe({
    contract,
    source: {
      id: source.id,
      providerId: provider.id,
      collectorId: configuration.collectorId,
      sourceUrl: layoutUrl,
      label: configuration.label,
    },
    rawRecords: options.rawRecords,
    collectorError: options.collectorError ?? null,
    observedAt,
    runId: run.id,
    externalRunId: options.externalRunId ?? undefined,
    repository: options.sentinelRepository,
    failRun: (message, details) =>
      repository.failCollectionRun(run.id, { message, details }, {
        recordsSeen: options.rawRecords.length,
        recordsAccepted: 0,
        recordsRejected: options.rawRecords.length,
      }),
  });

  // --- nothing below this line runs for a quarantined payload ---

  const accepted = gate.evaluation.validRecords as RawDemoQuoteRecord[];
  const counts = {
    recordsSeen: gate.evaluation.recordsSeen,
    recordsAccepted: accepted.length,
    recordsRejected: gate.evaluation.recordsInvalid,
  };

  try {
    await repository.saveDemoQuoteSnapshots(
      accepted.map((record) => ({
        runId: run.id,
        sourceId: source.id,
        providerId: provider.id,
        quoteKey: demoQuoteIdentity(record),
        quoteText: record.quote_text,
        author: record.author,
        tags: record.tags,
        sourceUrl: layoutUrl,
        observedAt,
      })),
    );
    await repository.completeCollectionRun(run.id, counts);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo persistence failed";
    await repository.failCollectionRun(run.id, { message }, counts);
    throw error;
  }

  return {
    collectionRunId: run.id,
    externalRunId: options.externalRunId ?? null,
    sourceId: source.id,
    providerId: provider.id,
    acceptedCount: accepted.length,
    rejectedCount: counts.recordsRejected,
    durationMs: Date.now() - startedAt,
    sentinel: toSentinelSummary(gate),
  };
}
