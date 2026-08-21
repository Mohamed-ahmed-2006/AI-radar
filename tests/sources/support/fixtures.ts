/**
 * Row-level fixtures for the source-detail and provenance read models.
 *
 * These are database rows, not read-model objects: the tests exercise the real
 * assembly path, only with an in-memory port instead of Supabase.
 */

import type {
  ChangeEventRow,
  LifecycleSnapshotRow,
  ModelRow,
  PricingSnapshotRow,
  ProviderRow,
  RunStatus,
  SentinelIncidentRow,
  SentinelSourceHealthRow,
  SourceRow,
} from "../../../lib/supabase/types";
import type {
  InMemorySourceData,
  PublicCollectionRunRow,
  PublicHealingAttemptRow,
} from "../../../lib/sources";

export const NOW = new Date("2026-08-18T12:00:00.000Z");

export function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

export const OPENAI_PROVIDER: ProviderRow = {
  id: "prov-openai",
  slug: "openai",
  name: "OpenAI",
  homepage_url: "https://openai.com",
  created_at: minutesAgo(100_000),
  updated_at: minutesAgo(100_000),
};

export const ANTHROPIC_PROVIDER: ProviderRow = {
  id: "prov-anthropic",
  slug: "anthropic",
  name: "Anthropic",
  homepage_url: "https://www.anthropic.com",
  created_at: minutesAgo(100_000),
  updated_at: minutesAgo(100_000),
};

export const PRICING_SOURCE: SourceRow = {
  id: "src-openai-pricing",
  provider_id: OPENAI_PROVIDER.id,
  kind: "pricing",
  collector_id: "c_openai_pricing",
  source_url: "https://developers.openai.com/api/docs/pricing",
  label: "OpenAI pricing page",
  is_active: true,
  created_at: minutesAgo(100_000),
  updated_at: minutesAgo(100_000),
};

export const LIFECYCLE_SOURCE: SourceRow = {
  id: "src-anthropic-lifecycle",
  provider_id: ANTHROPIC_PROVIDER.id,
  kind: "models",
  collector_id: "c_anthropic_lifecycle",
  source_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  label: "Anthropic model lifecycle and deprecations",
  is_active: true,
  created_at: minutesAgo(100_000),
  updated_at: minutesAgo(100_000),
};

export const GPT_MODEL: ModelRow = {
  id: "model-gpt",
  provider_id: OPENAI_PROVIDER.id,
  model_name: "gpt-5",
  display_name: "GPT-5",
  metadata: {},
  is_active: true,
  lifecycle_state: null,
  deprecated_on: null,
  retirement_date: null,
  retirement_not_before_date: null,
  lifecycle_source_id: null,
  lifecycle_observed_at: null,
  first_seen_at: minutesAgo(100_000),
  last_seen_at: minutesAgo(10),
  created_at: minutesAgo(100_000),
  updated_at: minutesAgo(10),
};

export const CLAUDE_MODEL: ModelRow = {
  ...GPT_MODEL,
  id: "model-claude",
  provider_id: ANTHROPIC_PROVIDER.id,
  model_name: "claude-3-5-sonnet-20240620",
  display_name: "Claude 3.5 Sonnet",
  lifecycle_state: "deprecated",
};

export function run(
  overrides: Partial<PublicCollectionRunRow> & { id: string; source_id: string },
): PublicCollectionRunRow {
  const startedAt = overrides.started_at ?? minutesAgo(60);
  const status: RunStatus = overrides.status ?? "succeeded";
  return {
    status,
    external_run_id: `bd_${overrides.id}`,
    triggered_by: "cron",
    started_at: startedAt,
    completed_at: overrides.completed_at ?? new Date(Date.parse(startedAt) + 42_000).toISOString(),
    records_seen: 12,
    records_accepted: 12,
    records_rejected: 0,
    error_message: null,
    created_at: startedAt,
    ...overrides,
  };
}

export function sentinelHealth(
  overrides: Partial<SentinelSourceHealthRow> & { source_id: string },
): SentinelSourceHealthRow {
  return {
    provider_id: OPENAI_PROVIDER.id,
    provider_name: OPENAI_PROVIDER.name,
    provider_slug: OPENAI_PROVIDER.slug,
    kind: "pricing",
    collector_id: PRICING_SOURCE.collector_id,
    source_url: PRICING_SOURCE.source_url,
    label: PRICING_SOURCE.label,
    is_active: true,
    last_run_id: null,
    last_run_status: null,
    last_run_started_at: null,
    last_run_completed_at: null,
    last_run_records_seen: null,
    last_run_records_accepted: null,
    last_run_records_rejected: null,
    last_run_error_message: null,
    active_incident_id: null,
    active_incident_status: null,
    active_incident_severity: null,
    active_reason_codes: null,
    healing_attempt_count: null,
    last_known_good_count: null,
    last_known_good_at: null,
    sentinel_health_status: "healthy",
    ...overrides,
  };
}

export function incident(
  overrides: Partial<SentinelIncidentRow> & { id: string; source_id: string },
): SentinelIncidentRow {
  return {
    provider_id: OPENAI_PROVIDER.id,
    run_id: null,
    status: "open",
    severity: "critical",
    reason_codes: ["RECORD_COUNT_COLLAPSE"],
    summary: "Record count collapsed",
    records_seen: 3,
    records_valid: 1,
    records_invalid: 2,
    expected_count: 12,
    last_known_good_count: 12,
    last_known_good_run_id: null,
    last_known_good_at: minutesAgo(400),
    healing_attempt_count: 0,
    resolution_note: null,
    created_at: minutesAgo(30),
    updated_at: minutesAgo(30),
    resolved_at: null,
    ...overrides,
  };
}

export function healingAttempt(
  overrides: Partial<PublicHealingAttemptRow> & {
    id: string;
    source_id: string;
    incident_id: string;
  },
): PublicHealingAttemptRow {
  return {
    collector_id: PRICING_SOURCE.collector_id,
    attempt_number: 1,
    status: "candidate_validated",
    refactor_job_id: "job-1",
    candidate_records_count: 12,
    candidate_passed_validation: true,
    error_message: null,
    started_at: minutesAgo(25),
    completed_at: minutesAgo(24),
    created_at: minutesAgo(25),
    ...overrides,
  };
}

export function pricingSnapshot(
  overrides: Partial<PricingSnapshotRow> & { id: string; run_id: string },
): PricingSnapshotRow {
  return {
    source_id: PRICING_SOURCE.id,
    provider_id: OPENAI_PROVIDER.id,
    model_id: GPT_MODEL.id,
    pricing_mode: "standard",
    context_tier: "default",
    input_price_per_1m_tokens: 1.25,
    cached_input_price_per_1m_tokens: 0.125,
    cache_write_price_per_1m_tokens: null,
    output_price_per_1m_tokens: 10,
    currency: "USD",
    pricing_unit: "USD per 1M tokens",
    source_url: PRICING_SOURCE.source_url,
    extra: {},
    raw: {
      model_name: "GPT-5",
      inputPrice: "$1.25",
      "Cached input": "$0.125",
      output_price: "$10.00",
      currency: "USD",
    },
    observed_at: minutesAgo(60),
    created_at: minutesAgo(60),
    content_hash: "hash-1",
    ...overrides,
  };
}

export function lifecycleSnapshot(
  overrides: Partial<LifecycleSnapshotRow> & { id: string; run_id: string },
): LifecycleSnapshotRow {
  return {
    source_id: LIFECYCLE_SOURCE.id,
    provider_id: ANTHROPIC_PROVIDER.id,
    model_id: CLAUDE_MODEL.id,
    api_model_id: "claude-3-5-sonnet-20240620",
    lifecycle_state: "deprecated",
    deprecated_on: "2025-10-22",
    retirement_date: "2026-10-22",
    retirement_not_before_date: null,
    retirement_not_before_observation: "unobserved",
    recommended_replacement: "claude-sonnet-4-5",
    recommended_replacement_model_id: null,
    recommended_replacement_observed: true,
    source_metadata: {},
    source_url: LIFECYCLE_SOURCE.source_url,
    raw: {
      api_model_name: "claude-3-5-sonnet-20240620",
      current_state: "Deprecated",
      deprecation_date: "2025-10-22",
      retirement_date: "2026-10-22",
      recommended_replacement: "claude-sonnet-4-5",
    },
    observed_at: minutesAgo(90),
    created_at: minutesAgo(90),
    content_hash: "hash-lifecycle-1",
    ...overrides,
  };
}

export function changeEvent(
  overrides: Partial<ChangeEventRow> & { id: string },
): ChangeEventRow {
  return {
    provider_id: OPENAI_PROVIDER.id,
    source_id: PRICING_SOURCE.id,
    run_id: "run-latest",
    model_id: GPT_MODEL.id,
    change_type: "price_decreased",
    field_name: "input_price_per_1m_tokens",
    pricing_mode: "standard",
    context_tier: "default",
    old_value: 2.5,
    new_value: 1.25,
    previous_snapshot_id: "snap-old",
    current_snapshot_id: "snap-new",
    previous_lifecycle_snapshot_id: null,
    previous_capability_snapshot_id: null,
    current_capability_snapshot_id: null,
    current_lifecycle_snapshot_id: null,
    summary: "GPT-5 input price halved",
    detected_at: minutesAgo(55),
    created_at: minutesAgo(55),
    ...overrides,
  };
}

/**
 * A healthy pricing source: three successful runs, current snapshots, no
 * incidents.
 */
export function healthySourceData(): InMemorySourceData {
  const runs = [
    run({ id: "run-latest", source_id: PRICING_SOURCE.id, started_at: minutesAgo(60) }),
    run({ id: "run-mid", source_id: PRICING_SOURCE.id, started_at: minutesAgo(420) }),
    run({ id: "run-old", source_id: PRICING_SOURCE.id, started_at: minutesAgo(780) }),
  ];

  return {
    sources: [PRICING_SOURCE],
    providers: [OPENAI_PROVIDER],
    models: [GPT_MODEL],
    runs,
    sentinelHealth: [
      sentinelHealth({
        source_id: PRICING_SOURCE.id,
        last_run_id: "run-latest",
        last_run_status: "succeeded",
        last_run_started_at: minutesAgo(60),
        last_run_completed_at: minutesAgo(59),
        last_run_records_seen: 12,
        last_run_records_accepted: 12,
        last_run_records_rejected: 0,
        sentinel_health_status: "healthy",
      }),
    ],
    pricingSnapshots: [
      pricingSnapshot({ id: "snap-new", run_id: "run-latest", observed_at: minutesAgo(60) }),
      pricingSnapshot({
        id: "snap-old",
        run_id: "run-mid",
        observed_at: minutesAgo(420),
        input_price_per_1m_tokens: 2.5,
        content_hash: "hash-0",
      }),
    ],
    changeEvents: [changeEvent({ id: "evt-price" })],
  };
}
