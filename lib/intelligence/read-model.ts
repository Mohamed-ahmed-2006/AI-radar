import {
  createSupabaseServerClient,
  getRecentChangeEvents,
  listModels,
  type ChangeEventRow,
  type SupabaseServerClient,
} from "../supabase";
import { localeQueryParameter } from "../sentinel/contracts";
import type {
  EcosystemSignificanceSummary,
  EvidenceBundle,
  ProviderComparisonResult,
  RelativeDateRange,
  TemporalEvidence,
  TemporalQuery,
} from "./contracts";
import { getDemoTemporalEvidence } from "./demo-evidence";
import { resolveDemoEvidence } from "./demo-gate";
import { transformChangeEventsToEvidence } from "./evidence-builder";
import { extractMostSignificantChanges } from "./ecosystem-highlights";
import { compareProvidersOverPeriod } from "./provider-comparison";
import {
  executeTemporalQuery,
  parseNaturalQuestion,
  resolveDateRange,
} from "./query-engine";
import { buildDeterministicNarrativeSummary } from "./summarizer";

/**
 * Drops capability events whose producing observation would not be admitted
 * today.
 *
 * A change event is a claim about the world backed by one observation. When
 * that observation is later found to be inadmissible — not wrong about a fact,
 * but collected from evidence the source contract now refuses — the claim it
 * produced was never intelligence, and the trusted feed should not present it
 * as such.
 *
 * The test is the contract's own, applied to the snapshot's preserved raw
 * provenance: a capability observation scraped from a localized rendering of a
 * provider page is refused at ingestion now, so an event produced by one before
 * that rule existed is refused here. Nothing is deleted, no event is rewritten,
 * and no invalidation state is stored — the row stays in `change_events` for
 * audit, and this is purely a read-time exclusion.
 *
 * Deliberately narrow. It is not "hide anything later reversed": a provider that
 * genuinely turns a capability off and on again is real intelligence and both
 * events survive, because both are backed by admissible observations.
 */
export async function withoutSupersededCapabilityEvidence(
  db: SupabaseServerClient,
  rows: readonly ChangeEventRow[],
): Promise<ChangeEventRow[]> {
  const snapshotIds = [
    ...new Set(
      rows
        .map((row) => row.current_capability_snapshot_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (snapshotIds.length === 0) return [...rows];

  const { data, error } = await db
    .from("capability_snapshots")
    .select("id, raw")
    .in("id", snapshotIds);
  // A read failure must not silently drop real intelligence; the feed is left
  // exactly as it was rather than filtered on evidence we could not load.
  if (error || !data) return [...rows];

  const inadmissible = new Set(
    data
      .filter((snapshot) => {
        const raw = snapshot.raw as { source_url?: unknown } | null;
        const sourceUrl = typeof raw?.source_url === "string" ? raw.source_url : undefined;
        return localeQueryParameter(sourceUrl) !== null;
      })
      .map((snapshot) => snapshot.id),
  );
  if (inadmissible.size === 0) return [...rows];

  return rows.filter(
    (row) =>
      row.current_capability_snapshot_id === null ||
      !inadmissible.has(row.current_capability_snapshot_id),
  );
}

/**
 * Loads raw change events from Supabase and transforms them into TemporalEvidence.
 * Returns empty array if Supabase is inaccessible or contains no rows.
 */
export async function loadLiveTemporalEvidence(
  options: { since?: string; limit?: number } = {},
): Promise<TemporalEvidence[]> {
  try {
    const db = createSupabaseServerClient();
    const [changeRows, modelsResult, providersResult, sourcesResult] = await Promise.all([
      getRecentChangeEvents(db, {
        since: options.since,
        limit: options.limit ?? 1000,
      }),
      listModels(db),
      db.from("providers").select(),
      db.from("sources").select(),
    ]);

    const modelNamesById = new Map(modelsResult.map((m) => [m.id, m.model_name]));
    const providerSlugsById = new Map(
      (providersResult.data ?? []).map((p) => [p.id, p.slug]),
    );
    const providerNamesById = new Map(
      (providersResult.data ?? []).map((p) => [p.id, p.name]),
    );

    // Bright Data run identity, so a feed item can be traced to the collector
    // execution that produced it. Explicit column list: `collection_runs`
    // grants anon only its non-diagnostic columns.
    const runIds = [
      ...new Set(changeRows.map((row) => row.run_id).filter((id): id is string => id !== null)),
    ];
    const runsResult = runIds.length
      ? await db.from("collection_runs").select("id, external_run_id").in("id", runIds)
      : { data: [] };
    const externalRunIdsByRunId = new Map(
      (runsResult.data ?? []).map((run) => [run.id, run.external_run_id]),
    );

    const trustedRows = await withoutSupersededCapabilityEvidence(db, changeRows);

    return transformChangeEventsToEvidence(trustedRows, {
      sources: sourcesResult.data ?? [],
      modelNamesById,
      providerSlugsById,
      providerNamesById,
      externalRunIdsByRunId,
    });
  } catch {
    // Fail safely for environments without database access
    return [];
  }
}

/**
 * Main query function for temporal intelligence.
 */
export async function queryTemporalIntelligence(
  query: TemporalQuery = {},
): Promise<EvidenceBundle> {
  // Requesting the demo corpus is not enough: the deployment must also have
  // opted in. See `demo-gate.ts` — production never substitutes it.
  const isDemoRequested = resolveDemoEvidence(query.demo);

  let dataset: TemporalEvidence[] = [];

  if (isDemoRequested) {
    dataset = getDemoTemporalEvidence();
  } else {
    const { since } = resolveDateRange(
      query.range,
      query.since,
      query.until,
      query.referenceDate,
    );
    dataset = await loadLiveTemporalEvidence({
      since: since ? since.toISOString() : undefined,
      limit: query.limit ? query.limit * 2 : 500,
    });

    // If production database has 0 events and demo was not explicitly forbidden,
    // we keep the empty bundle for production fidelity, unless demo was requested.
  }

  const bundle = executeTemporalQuery(dataset, query);

  if (query.includeSummary !== false) {
    bundle.narrativeSummary = buildDeterministicNarrativeSummary(bundle);
  }

  return bundle;
}

/**
 * Answers natural hero questions like "What changed in Claude this month?".
 */
export async function answerHeroQuestion(
  question: string,
  options: { demo?: boolean; referenceDate?: string; includeSummary?: boolean } = {},
): Promise<EvidenceBundle> {
  const parsed = parseNaturalQuestion(question);

  const query: TemporalQuery = {
    provider: parsed.provider,
    family: parsed.family,
    model: parsed.model,
    range: parsed.range,
    categories: parsed.categories,
    demo: options.demo,
    referenceDate: options.referenceDate,
    includeSummary: options.includeSummary ?? true,
  };

  return queryTemporalIntelligence(query);
}

/**
 * Compares multi-provider intelligence over a period.
 */
export async function compareProvidersIntelligence(
  providers?: string[],
  range?: RelativeDateRange,
  options: { demo?: boolean; referenceDate?: string } = {},
): Promise<ProviderComparisonResult> {
  let dataset: TemporalEvidence[] = [];

  if (resolveDemoEvidence(options.demo)) {
    dataset = getDemoTemporalEvidence();
  } else {
    dataset = await loadLiveTemporalEvidence();
    if (dataset.length === 0 && options.demo === undefined) {
      // If live is empty, fallback to demo dataset only if demo is active
      dataset = [];
    }
  }

  return compareProvidersOverPeriod(dataset, {
    providers,
    range: range ?? "30d",
    referenceDate: options.referenceDate,
  });
}

/**
 * Retrieves the most significant recent ecosystem moves.
 */
export async function getSignificantEcosystemMoves(
  range?: RelativeDateRange,
  limit?: number,
  options: { demo?: boolean; referenceDate?: string } = {},
): Promise<EcosystemSignificanceSummary> {
  let dataset: TemporalEvidence[] = [];

  if (resolveDemoEvidence(options.demo)) {
    dataset = getDemoTemporalEvidence();
  } else {
    dataset = await loadLiveTemporalEvidence();
  }

  return extractMostSignificantChanges(dataset, {
    range: range ?? "30d",
    limit: limit ?? 10,
    referenceDate: options.referenceDate,
  });
}
