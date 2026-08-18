import {
  createSupabaseServerClient,
  getRecentChangeEvents,
  listModels,
} from "../supabase";
import type {
  EcosystemSignificanceSummary,
  EvidenceBundle,
  ProviderComparisonResult,
  RelativeDateRange,
  TemporalEvidence,
  TemporalQuery,
} from "./contracts";
import { getDemoTemporalEvidence } from "./demo-evidence";
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

    return transformChangeEventsToEvidence(changeRows, {
      sources: sourcesResult.data ?? [],
      modelNamesById,
      providerSlugsById,
      providerNamesById,
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
  const isDemoRequested = query.demo === true;

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

  if (options.demo) {
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

  if (options.demo) {
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
