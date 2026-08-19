/**
 * Assembles current trusted evidence for one canonical model.
 *
 * The canonical model row is the spine. Pricing, capability and lifecycle
 * evidence are attached to it independently, and any of them may be absent
 * without disturbing the others — a model with prices but no catalog entry is
 * a normal model with unknown capabilities, and a model that vanished from a
 * catalog page is not thereby deprecated.
 *
 * Where a value is not observed it stays null. Nothing here ever turns an
 * absence into a `false`, a `0`, or an empty string.
 */

import { provenanceTrustFromAuthority, type ProvenanceView } from "../product/provenance";
import { resolveSourceCategory, resolveSourceContractView } from "../sources/contract-view";
import type { AuthorityLevel } from "../intelligence/contracts";
import type {
  LatestCapabilitySnapshotRow,
  LatestLifecycleSnapshotRow,
  LatestPricingSnapshotRow,
  ModelRow,
  ProviderRow,
  SourceRow,
} from "../supabase/types";
import type {
  EvidenceDomain,
  ModelCapabilityEvidence,
  ModelExplorerEntry,
  ModelFreshness,
  ModelLifecycleEvidence,
  ModelPricingEvidence,
  ModelPricingTier,
  ModelProviderIdentity,
} from "./types";

/** Everything provenance needs about the source that produced an observation. */
export interface EvidenceContext {
  sourcesById: Map<string, SourceRow>;
  providersById: Map<string, ProviderRow>;
  externalRunIdsByRunId: Map<string, string | null>;
}

export function buildEvidenceContext(
  sources: readonly SourceRow[],
  providers: readonly ProviderRow[],
  externalRunIds: ReadonlyArray<{ id: string; external_run_id: string | null }>,
): EvidenceContext {
  return {
    sourcesById: new Map(sources.map((source) => [source.id, source])),
    providersById: new Map(providers.map((provider) => [provider.id, provider])),
    externalRunIdsByRunId: new Map(
      externalRunIds.map((run) => [run.id, run.external_run_id]),
    ),
  };
}

function nullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A snapshot that reached a `latest_comparable_*` view was produced by a run
 * that passed the inline Sentinel gate, which is a verified scrape. It is only
 * promoted to `authoritative` when the source's registered contract says the
 * source is an authority on that domain.
 */
function authorityFor(source: SourceRow | undefined, providerSlug: string): AuthorityLevel | null {
  if (!source) return null;
  const contract = resolveSourceContractView(
    source.kind,
    providerSlug,
    source.id,
    source.collector_id,
    source.source_url,
  );
  if (!contract) return "verified_scrape";
  return contract.isAuthoritative ? "authoritative" : "verified_scrape";
}

export interface EvidenceProvenanceInput {
  sourceId: string;
  providerId: string;
  sourceUrl: string | null;
  observedAt: string | null;
  runId: string | null;
  snapshotId: string | null;
}

/** Provenance for one observation, carrying only facts that are known. */
export function buildEvidenceProvenance(
  input: EvidenceProvenanceInput,
  context: EvidenceContext,
): ProvenanceView {
  const source = context.sourcesById.get(input.sourceId);
  const provider = context.providersById.get(input.providerId);
  const providerSlug = provider?.slug ?? "";
  const authority = authorityFor(source, providerSlug);
  const category = source
    ? resolveSourceCategory(source.kind, providerSlug, source.collector_id, source.source_url)
    : null;

  return {
    sourceLabel:
      nullableString(source?.label) ??
      (provider && category ? `${provider.name} ${category}` : null),
    sourceUrl: nullableString(input.sourceUrl) ?? nullableString(source?.source_url),
    sourceKind: category,
    collectorId: nullableString(source?.collector_id),
    observedAt: nullableString(input.observedAt),
    authority,
    confidence: null,
    trust: provenanceTrustFromAuthority(authority),
    validation: null,
    runId: nullableString(input.runId),
    externalRunId: input.runId
      ? nullableString(context.externalRunIdsByRunId.get(input.runId) ?? null)
      : null,
    snapshotId: nullableString(input.snapshotId),
    previousSnapshotId: null,
    isDemo: false,
  };
}

/**
 * The tier the explorer filters and compares on.
 *
 * Deterministic and independent of price: the provider's standard/default tier
 * when it exists, otherwise the lexicographically first (mode, tier) pair. It
 * is never "the cheapest" — ranking is the Stack Optimizer's job, and a read
 * model that silently picked the best number would make every filter depend on
 * which tiers happened to be collected.
 */
export function selectPrimaryPricingTier(
  tiers: readonly ModelPricingTier[],
): ModelPricingTier | null {
  if (tiers.length === 0) return null;
  const standard = tiers.find(
    (tier) => tier.pricingMode === "standard" && tier.contextTier === "default",
  );
  if (standard) return standard;
  return [...tiers].sort((a, b) => {
    const byMode = a.pricingMode.localeCompare(b.pricingMode);
    if (byMode !== 0) return byMode;
    return a.contextTier.localeCompare(b.contextTier);
  })[0];
}

export function buildPricingEvidence(
  rows: readonly LatestPricingSnapshotRow[],
  context: EvidenceContext,
): ModelPricingEvidence {
  const tiers: ModelPricingTier[] = rows.map((row) => ({
    pricingMode: row.pricing_mode,
    contextTier: row.context_tier,
    inputPricePer1MTokens: row.input_price_per_1m_tokens,
    cachedInputPricePer1MTokens: row.cached_input_price_per_1m_tokens,
    cacheWritePricePer1MTokens: row.cache_write_price_per_1m_tokens,
    outputPricePer1MTokens: row.output_price_per_1m_tokens,
    currency: nullableString(row.currency),
    unit: nullableString(row.pricing_unit),
    observedAt: row.observed_at,
    snapshotId: row.id,
  }));
  tiers.sort((a, b) => {
    const byMode = a.pricingMode.localeCompare(b.pricingMode);
    if (byMode !== 0) return byMode;
    return a.contextTier.localeCompare(b.contextTier);
  });

  const primary = selectPrimaryPricingTier(tiers);
  const primaryRow = primary
    ? rows.find((row) => row.id === primary.snapshotId) ?? null
    : null;

  return {
    primary,
    tiers,
    observedAt: primary?.observedAt ?? null,
    provenance: primaryRow
      ? buildEvidenceProvenance(
          {
            sourceId: primaryRow.source_id,
            providerId: primaryRow.provider_id,
            sourceUrl: primaryRow.source_url,
            observedAt: primaryRow.observed_at,
            runId: primaryRow.run_id,
            snapshotId: primaryRow.id,
          },
          context,
        )
      : null,
  };
}

const UNKNOWN_CAPABILITIES: Omit<ModelCapabilityEvidence, "conflicted"> = {
  apiModelId: null,
  displayName: null,
  family: null,
  stage: null,
  contextWindow: null,
  maxOutputTokens: null,
  supportsVision: null,
  supportsToolCalling: null,
  inputModalities: [],
  outputModalities: [],
  supportedFeatures: [],
  observedAt: null,
  provenance: null,
};

/** Identity of the capability evidence itself, ignoring which id published it. */
function capabilityFingerprint(row: LatestCapabilitySnapshotRow): string {
  return JSON.stringify([
    row.display_name,
    row.model_family,
    row.model_stage,
    row.context_window,
    row.max_output_tokens,
    row.supports_vision,
    row.supports_tool_calling,
    [...(row.input_modalities ?? [])].sort(),
    [...(row.output_modalities ?? [])].sort(),
    [...(row.supported_features ?? [])].sort(),
  ]);
}

/**
 * Resolves the capability rows currently attached to one canonical model.
 *
 * A canonical model can legitimately carry several API model ids (an alias and
 * its dated snapshot, for instance). When those ids agree on the evidence, the
 * newest row is the answer. When they disagree, two different models are
 * wearing one canonical identity and there is no non-arbitrary way to choose:
 * the evidence is withheld in full and marked conflicted, exactly as catalog
 * ingestion refuses to write a conflicted identity. Withholding is confined to
 * the capability domain — pricing and lifecycle are unaffected.
 */
export function buildCapabilityEvidence(
  rows: readonly LatestCapabilitySnapshotRow[],
  context: EvidenceContext,
): ModelCapabilityEvidence {
  if (rows.length === 0) {
    return { ...UNKNOWN_CAPABILITIES, conflicted: false };
  }

  const fingerprints = new Set(rows.map(capabilityFingerprint));
  if (fingerprints.size > 1) {
    return { ...UNKNOWN_CAPABILITIES, conflicted: true };
  }

  const row = [...rows].sort(
    (a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at),
  )[0];

  return {
    apiModelId: nullableString(row.api_model_id),
    displayName: nullableString(row.display_name),
    family: nullableString(row.model_family),
    stage: nullableString(row.model_stage),
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    supportsVision: row.supports_vision,
    supportsToolCalling: row.supports_tool_calling,
    inputModalities: [...(row.input_modalities ?? [])],
    outputModalities: [...(row.output_modalities ?? [])],
    supportedFeatures: [...(row.supported_features ?? [])],
    conflicted: false,
    observedAt: row.observed_at,
    provenance: buildEvidenceProvenance(
      {
        sourceId: row.source_id,
        providerId: row.provider_id,
        sourceUrl: row.source_url,
        observedAt: row.observed_at,
        runId: row.run_id,
        snapshotId: row.id,
      },
      context,
    ),
  };
}

/**
 * Lifecycle for one canonical model.
 *
 * The state, deprecation and retirement dates come from the canonical model
 * row — the projection lifecycle ingestion maintains — never from the presence
 * or absence of a catalog entry. The lifecycle snapshot contributes what only
 * it knows: the retirement observation discriminator, the recommended
 * replacement, and provenance.
 */
export function buildLifecycleEvidence(
  model: ModelRow,
  rows: readonly LatestLifecycleSnapshotRow[],
  context: EvidenceContext,
): ModelLifecycleEvidence {
  const row = rows.length > 0
    ? [...rows].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0]
    : null;

  const state = model.lifecycle_state;

  return {
    state,
    deprecationDate: model.deprecated_on,
    retirementDate: model.retirement_date,
    retirementNotBeforeDate: model.retirement_not_before_date,
    retirementNotBeforeObservation: row?.retirement_not_before_observation ?? null,
    recommendedReplacement: nullableString(row?.recommended_replacement),
    recommendedReplacementModelId: nullableString(row?.recommended_replacement_model_id),
    endOfLife: state === "deprecated" || state === "retired",
    observedAt: row?.observed_at ?? model.lifecycle_observed_at,
    provenance: row
      ? buildEvidenceProvenance(
          {
            sourceId: row.source_id,
            providerId: row.provider_id,
            sourceUrl: row.source_url,
            observedAt: row.observed_at,
            runId: row.run_id,
            snapshotId: row.id,
          },
          context,
        )
      : null,
  };
}

function buildFreshness(
  byDomain: Record<EvidenceDomain, string | null>,
  now: Date,
): ModelFreshness {
  const timestamps = Object.values(byDomain)
    .filter((value): value is string => value !== null)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return { lastVerifiedAt: null, ageMinutes: null, byDomain };
  }

  const newest = Math.max(...timestamps);
  return {
    lastVerifiedAt: new Date(newest).toISOString(),
    ageMinutes: Math.max(0, Math.floor((now.getTime() - newest) / 60_000)),
    byDomain,
  };
}

export interface BuildEntryInput {
  model: ModelRow;
  provider: ProviderRow | undefined;
  pricingRows: readonly LatestPricingSnapshotRow[];
  capabilityRows: readonly LatestCapabilitySnapshotRow[];
  lifecycleRows: readonly LatestLifecycleSnapshotRow[];
}

export function buildExplorerEntry(
  input: BuildEntryInput,
  context: EvidenceContext,
  now: Date,
): ModelExplorerEntry {
  const pricing = buildPricingEvidence(input.pricingRows, context);
  const capabilities = buildCapabilityEvidence(input.capabilityRows, context);
  const lifecycle = buildLifecycleEvidence(input.model, input.lifecycleRows, context);

  const provider: ModelProviderIdentity = {
    providerId: input.model.provider_id,
    slug: input.provider?.slug ?? "",
    name: input.provider?.name ?? "",
  };

  const evidenceDomains: EvidenceDomain[] = [];
  if (pricing.tiers.length > 0) evidenceDomains.push("pricing");
  if (!capabilities.conflicted && capabilities.observedAt !== null) {
    evidenceDomains.push("capability");
  }
  if (lifecycle.provenance !== null) evidenceDomains.push("lifecycle");

  return {
    canonicalModelId: input.model.id,
    modelName: input.model.model_name,
    displayName: capabilities.displayName ?? nullableString(input.model.display_name),
    apiModelId: capabilities.apiModelId,
    provider,
    family: capabilities.family,
    stage: capabilities.stage,
    pricing,
    capabilities,
    lifecycle,
    freshness: buildFreshness(
      {
        pricing: pricing.observedAt,
        capability: capabilities.observedAt,
        lifecycle: lifecycle.observedAt,
      },
      now,
    ),
    evidenceDomains,
    provenance: {
      pricing: pricing.provenance,
      capability: capabilities.provenance,
      lifecycle: lifecycle.provenance,
    },
  };
}
