/**
 * Row-level fixtures for the model explorer, detail and compare read models.
 *
 * These are database rows, not read-model objects: the tests exercise the real
 * assembly path with an in-memory port instead of Supabase. The mix is
 * deliberate — one provider with full evidence, one with prices but no catalog
 * entry, one with a catalog entry but no prices, a deprecated model, a stable
 * and a preview variant of the same family, and a canonical model two API ids
 * disagree about.
 */

import {
  DEFAULT_ANTHROPIC_CATALOG_COLLECTOR_ID,
  DEFAULT_GEMINI_CATALOG_COLLECTOR_ID,
  DEFAULT_OPENAI_CATALOG_COLLECTOR_ID,
  DEFAULT_XAI_CATALOG_COLLECTOR_ID,
} from "../../../lib/brightdata/collectors/catalog";
import type { InMemoryExplorerData } from "../../../lib/explorer";
import type {
  CapabilitySnapshotRow,
  ChangeEventRow,
  LifecycleSnapshotRow,
  ModelAliasRow,
  ModelRow,
  PricingSnapshotRow,
  ProviderRow,
  SourceRow,
} from "../../../lib/supabase/types";

export const NOW = new Date("2026-08-19T12:00:00.000Z");

export function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

export const now = () => NOW;

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

function provider(slug: string, name: string, homepage: string): ProviderRow {
  return {
    id: `prov-${slug}`,
    slug,
    name,
    homepage_url: homepage,
    created_at: minutesAgo(100_000),
    updated_at: minutesAgo(100_000),
  };
}

export const OPENAI = provider("openai", "OpenAI", "https://openai.com");
export const ANTHROPIC = provider("anthropic", "Anthropic", "https://www.anthropic.com");
export const GOOGLE = provider("gemini", "Google", "https://ai.google.dev");
export const XAI = provider("xai", "xAI", "https://x.ai");

export const PROVIDERS: ProviderRow[] = [OPENAI, ANTHROPIC, GOOGLE, XAI];

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function source(overrides: Partial<SourceRow> & { id: string; provider_id: string; source_url: string }): SourceRow {
  return {
    kind: "pricing",
    collector_id: null,
    label: null,
    is_active: true,
    created_at: minutesAgo(100_000),
    updated_at: minutesAgo(100_000),
    ...overrides,
  };
}

export const OPENAI_PRICING_SOURCE = source({
  id: "src-openai-pricing",
  provider_id: OPENAI.id,
  kind: "pricing",
  collector_id: "c_openai_pricing",
  source_url: "https://developers.openai.com/api/docs/pricing",
  label: "OpenAI pricing page",
});

export const OPENAI_CATALOG_SOURCE = source({
  id: "src-openai-catalog",
  provider_id: OPENAI.id,
  kind: "models",
  collector_id: DEFAULT_OPENAI_CATALOG_COLLECTOR_ID,
  source_url: "https://platform.openai.com/docs/models",
  label: "OpenAI model catalog",
});

export const ANTHROPIC_PRICING_SOURCE = source({
  id: "src-anthropic-pricing",
  provider_id: ANTHROPIC.id,
  kind: "pricing",
  collector_id: "c_anthropic_pricing",
  source_url: "https://platform.claude.com/docs/en/about-claude/pricing",
  label: "Anthropic pricing page",
});

export const ANTHROPIC_CATALOG_SOURCE = source({
  id: "src-anthropic-catalog",
  provider_id: ANTHROPIC.id,
  kind: "models",
  collector_id: DEFAULT_ANTHROPIC_CATALOG_COLLECTOR_ID,
  source_url: "https://platform.claude.com/docs/en/about-claude/models/overview",
  label: "Anthropic model catalog",
});

export const ANTHROPIC_LIFECYCLE_SOURCE = source({
  id: "src-anthropic-lifecycle",
  provider_id: ANTHROPIC.id,
  kind: "models",
  collector_id: "c_msxj0fk3153bu9oz7l",
  source_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  label: "Anthropic model lifecycle and deprecations",
});

export const GEMINI_PRICING_SOURCE = source({
  id: "src-gemini-pricing",
  provider_id: GOOGLE.id,
  kind: "pricing",
  collector_id: "c_gemini_pricing",
  source_url: "https://ai.google.dev/gemini-api/docs/pricing",
  label: "Google Gemini pricing page",
});

export const GEMINI_CATALOG_SOURCE = source({
  id: "src-gemini-catalog",
  provider_id: GOOGLE.id,
  kind: "models",
  collector_id: DEFAULT_GEMINI_CATALOG_COLLECTOR_ID,
  source_url: "https://ai.google.dev/gemini-api/docs/models",
  label: "Google Gemini model catalog",
});

export const GEMINI_LIFECYCLE_SOURCE = source({
  id: "src-gemini-lifecycle",
  provider_id: GOOGLE.id,
  kind: "models",
  collector_id: "c_msxqpelk2cpxz8r386",
  source_url: "https://ai.google.dev/gemini-api/docs/changelog",
  label: "Google Gemini model versions",
});

export const XAI_CATALOG_SOURCE = source({
  id: "src-xai-catalog",
  provider_id: XAI.id,
  kind: "models",
  collector_id: DEFAULT_XAI_CATALOG_COLLECTOR_ID,
  source_url: "https://docs.x.ai/developers/models",
  label: "xAI model catalog",
});

export const SOURCES: SourceRow[] = [
  OPENAI_PRICING_SOURCE,
  OPENAI_CATALOG_SOURCE,
  ANTHROPIC_PRICING_SOURCE,
  ANTHROPIC_CATALOG_SOURCE,
  ANTHROPIC_LIFECYCLE_SOURCE,
  GEMINI_PRICING_SOURCE,
  GEMINI_CATALOG_SOURCE,
  GEMINI_LIFECYCLE_SOURCE,
  XAI_CATALOG_SOURCE,
];

// ---------------------------------------------------------------------------
// Canonical models
// ---------------------------------------------------------------------------

export function model(
  overrides: Partial<ModelRow> & { id: string; provider_id: string; model_name: string },
): ModelRow {
  return {
    display_name: null,
    metadata: {},
    is_active: true,
    lifecycle_state: null,
    deprecated_on: null,
    retirement_date: null,
    retirement_not_before_date: null,
    lifecycle_source_id: null,
    lifecycle_observed_at: null,
    first_seen_at: minutesAgo(100_000),
    last_seen_at: minutesAgo(30),
    created_at: minutesAgo(100_000),
    updated_at: minutesAgo(30),
    ...overrides,
  };
}

/** Full evidence: prices and catalog capabilities, no lifecycle source. */
export const GPT_5 = model({
  id: "model-gpt-5",
  provider_id: OPENAI.id,
  model_name: "gpt-5",
  display_name: "GPT-5",
});

/** Prices and capabilities, plus an active lifecycle assertion. */
export const CLAUDE_SONNET_5 = model({
  id: "model-claude-sonnet-5",
  provider_id: ANTHROPIC.id,
  model_name: "claude-sonnet-5",
  display_name: "Claude Sonnet 5",
  lifecycle_state: "active",
  lifecycle_source_id: ANTHROPIC_LIFECYCLE_SOURCE.id,
  lifecycle_observed_at: minutesAgo(120),
});

/** Deprecated, with prices, and deliberately absent from the catalog. */
export const CLAUDE_3_OPUS = model({
  id: "model-claude-3-opus",
  provider_id: ANTHROPIC.id,
  model_name: "claude-3-opus-20240229",
  display_name: "Claude 3 Opus",
  lifecycle_state: "deprecated",
  deprecated_on: "2026-01-21",
  retirement_date: "2026-03-01",
  lifecycle_source_id: ANTHROPIC_LIFECYCLE_SOURCE.id,
  lifecycle_observed_at: minutesAgo(120),
});

/** Catalog capabilities but no pricing observation at all. */
export const GROK_4 = model({
  id: "model-grok-4",
  provider_id: XAI.id,
  model_name: "grok-4",
  display_name: "Grok 4",
});

/** Pricing only: nobody has published its capabilities. */
export const GEMINI_3_PRO = model({
  id: "model-gemini-3-pro",
  provider_id: GOOGLE.id,
  model_name: "gemini-3-pro",
  display_name: "Gemini 3 Pro",
});

/** Stable and preview variants are separate canonical models. */
export const GEMINI_25_FLASH = model({
  id: "model-gemini-2-5-flash",
  provider_id: GOOGLE.id,
  model_name: "gemini-2.5-flash",
  display_name: "Gemini 2.5 Flash",
  lifecycle_state: "active",
});

export const GEMINI_25_FLASH_PREVIEW = model({
  id: "model-gemini-2-5-flash-preview",
  provider_id: GOOGLE.id,
  model_name: "gemini-2.5-flash-preview-09-2025",
  display_name: "Gemini 2.5 Flash Preview",
  lifecycle_state: "deprecated",
  retirement_not_before_date: "2026-09-30",
});

/** Two API ids claim this canonical model with different capability evidence. */
export const GEMINI_IMAGEN = model({
  id: "model-imagen",
  provider_id: GOOGLE.id,
  model_name: "imagen-4.0-generate-001",
  display_name: "Imagen 4",
  lifecycle_state: "active",
});

export const MODELS: ModelRow[] = [
  GPT_5,
  CLAUDE_SONNET_5,
  CLAUDE_3_OPUS,
  GROK_4,
  GEMINI_3_PRO,
  GEMINI_25_FLASH,
  GEMINI_25_FLASH_PREVIEW,
  GEMINI_IMAGEN,
];

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

export function pricing(
  overrides: Partial<PricingSnapshotRow> & {
    id: string;
    model_id: string;
    provider_id: string;
    source_id: string;
  },
): PricingSnapshotRow {
  const observedAt = overrides.observed_at ?? minutesAgo(60);
  return {
    run_id: `run-${overrides.source_id}`,
    pricing_mode: "standard",
    context_tier: "default",
    input_price_per_1m_tokens: null,
    cached_input_price_per_1m_tokens: null,
    cache_write_price_per_1m_tokens: null,
    output_price_per_1m_tokens: null,
    currency: "USD",
    pricing_unit: "1M tokens",
    source_url: null,
    extra: {},
    raw: null,
    created_at: observedAt,
    content_hash: `hash-${overrides.id}`,
    ...overrides,
    observed_at: observedAt,
  };
}

export function capability(
  overrides: Partial<CapabilitySnapshotRow> & {
    id: string;
    model_id: string;
    provider_id: string;
    source_id: string;
    api_model_id: string;
  },
): CapabilitySnapshotRow {
  const observedAt = overrides.observed_at ?? minutesAgo(45);
  return {
    run_id: `run-${overrides.source_id}`,
    display_name: null,
    model_family: null,
    model_stage: null,
    context_window: null,
    max_output_tokens: null,
    supports_vision: null,
    supports_tool_calling: null,
    input_modalities: [],
    output_modalities: [],
    supported_features: [],
    source_url: "https://example.invalid/models",
    extra: {},
    raw: null,
    created_at: observedAt,
    content_hash: `hash-${overrides.id}`,
    ...overrides,
    observed_at: observedAt,
  };
}

export function lifecycle(
  overrides: Partial<LifecycleSnapshotRow> & {
    id: string;
    model_id: string;
    provider_id: string;
    source_id: string;
    api_model_id: string;
  },
): LifecycleSnapshotRow {
  const observedAt = overrides.observed_at ?? minutesAgo(120);
  return {
    run_id: `run-${overrides.source_id}`,
    lifecycle_state: null,
    deprecated_on: null,
    retirement_date: null,
    retirement_not_before_date: null,
    retirement_not_before_observation: "unobserved",
    recommended_replacement: null,
    recommended_replacement_model_id: null,
    recommended_replacement_observed: false,
    source_metadata: {},
    source_url: "https://example.invalid/lifecycle",
    raw: null,
    created_at: observedAt,
    content_hash: `hash-${overrides.id}`,
    ...overrides,
    observed_at: observedAt,
  };
}

export function alias(
  overrides: Partial<ModelAliasRow> & {
    id: string;
    model_id: string;
    provider_id: string;
    alias: string;
  },
): ModelAliasRow {
  return {
    source_id: null,
    alias_type: "api_model_id",
    first_seen_at: minutesAgo(100_000),
    last_seen_at: minutesAgo(45),
    created_at: minutesAgo(100_000),
    updated_at: minutesAgo(45),
    ...overrides,
  };
}

export function changeEvent(
  overrides: Partial<ChangeEventRow> & { id: string; provider_id: string },
): ChangeEventRow {
  const detectedAt = overrides.detected_at ?? minutesAgo(60);
  return {
    source_id: null,
    run_id: null,
    model_id: null,
    change_type: "price_decreased",
    field_name: null,
    pricing_mode: null,
    context_tier: null,
    old_value: null,
    new_value: null,
    previous_snapshot_id: null,
    current_snapshot_id: null,
    previous_lifecycle_snapshot_id: null,
    previous_capability_snapshot_id: null,
    current_capability_snapshot_id: null,
    current_lifecycle_snapshot_id: null,
    summary: null,
    created_at: detectedAt,
    ...overrides,
    detected_at: detectedAt,
  };
}

// ---------------------------------------------------------------------------
// The mixed-provider dataset every explorer test reads
// ---------------------------------------------------------------------------

export function explorerData(): Required<InMemoryExplorerData> {
  const pricingSnapshots: PricingSnapshotRow[] = [
    // GPT-5: an older observation and the current one, plus a long-context tier.
    pricing({
      id: "price-gpt5-old",
      model_id: GPT_5.id,
      provider_id: OPENAI.id,
      source_id: OPENAI_PRICING_SOURCE.id,
      input_price_per_1m_tokens: 1.5,
      output_price_per_1m_tokens: 12,
      observed_at: minutesAgo(2000),
    }),
    pricing({
      id: "price-gpt5",
      model_id: GPT_5.id,
      provider_id: OPENAI.id,
      source_id: OPENAI_PRICING_SOURCE.id,
      input_price_per_1m_tokens: 1.25,
      cached_input_price_per_1m_tokens: 0.125,
      output_price_per_1m_tokens: 10,
      source_url: "https://developers.openai.com/api/docs/pricing",
      observed_at: minutesAgo(60),
    }),
    pricing({
      id: "price-gpt5-long",
      model_id: GPT_5.id,
      provider_id: OPENAI.id,
      source_id: OPENAI_PRICING_SOURCE.id,
      pricing_mode: "standard",
      context_tier: "long_context",
      input_price_per_1m_tokens: 2.5,
      output_price_per_1m_tokens: 20,
      observed_at: minutesAgo(60),
    }),
    pricing({
      id: "price-sonnet5",
      model_id: CLAUDE_SONNET_5.id,
      provider_id: ANTHROPIC.id,
      source_id: ANTHROPIC_PRICING_SOURCE.id,
      input_price_per_1m_tokens: 3,
      output_price_per_1m_tokens: 15,
      observed_at: minutesAgo(90),
    }),
    pricing({
      id: "price-opus3",
      model_id: CLAUDE_3_OPUS.id,
      provider_id: ANTHROPIC.id,
      source_id: ANTHROPIC_PRICING_SOURCE.id,
      input_price_per_1m_tokens: 15,
      output_price_per_1m_tokens: 75,
      observed_at: minutesAgo(90),
    }),
    pricing({
      id: "price-gemini3pro",
      model_id: GEMINI_3_PRO.id,
      provider_id: GOOGLE.id,
      source_id: GEMINI_PRICING_SOURCE.id,
      input_price_per_1m_tokens: 2,
      output_price_per_1m_tokens: 12,
      observed_at: minutesAgo(30),
    }),
    pricing({
      id: "price-flash",
      model_id: GEMINI_25_FLASH.id,
      provider_id: GOOGLE.id,
      source_id: GEMINI_PRICING_SOURCE.id,
      input_price_per_1m_tokens: 0.3,
      output_price_per_1m_tokens: 2.5,
      observed_at: minutesAgo(30),
    }),
    pricing({
      id: "price-flash-preview",
      model_id: GEMINI_25_FLASH_PREVIEW.id,
      provider_id: GOOGLE.id,
      source_id: GEMINI_PRICING_SOURCE.id,
      input_price_per_1m_tokens: 0.15,
      output_price_per_1m_tokens: 0.6,
      observed_at: minutesAgo(30),
    }),
  ];

  const capabilitySnapshots: CapabilitySnapshotRow[] = [
    capability({
      id: "cap-gpt5",
      model_id: GPT_5.id,
      provider_id: OPENAI.id,
      source_id: OPENAI_CATALOG_SOURCE.id,
      api_model_id: "gpt-5",
      display_name: "GPT-5",
      model_family: "gpt-5",
      model_stage: "stable",
      context_window: 400_000,
      max_output_tokens: 128_000,
      supports_vision: true,
      supports_tool_calling: true,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      supported_features: ["streaming", "structured_outputs"],
      source_url: "https://platform.openai.com/docs/models/gpt-5",
      observed_at: minutesAgo(45),
    }),
    // Sonnet 5: tool calling observed, vision never observed. Unknown, not false.
    capability({
      id: "cap-sonnet5",
      model_id: CLAUDE_SONNET_5.id,
      provider_id: ANTHROPIC.id,
      source_id: ANTHROPIC_CATALOG_SOURCE.id,
      api_model_id: "claude-sonnet-5",
      display_name: "Claude Sonnet 5",
      model_family: "claude-sonnet",
      model_stage: "stable",
      context_window: 200_000,
      max_output_tokens: 64_000,
      supports_vision: null,
      supports_tool_calling: true,
      input_modalities: ["text"],
      output_modalities: ["text"],
      observed_at: minutesAgo(45),
    }),
    // Grok 4: explicitly no vision. False is an observation, not an absence.
    capability({
      id: "cap-grok4",
      model_id: GROK_4.id,
      provider_id: XAI.id,
      source_id: XAI_CATALOG_SOURCE.id,
      api_model_id: "grok-4",
      display_name: "Grok 4",
      model_family: "grok-4",
      model_stage: "stable",
      context_window: 256_000,
      max_output_tokens: 32_000,
      supports_vision: false,
      supports_tool_calling: true,
      input_modalities: ["text"],
      output_modalities: ["text"],
      observed_at: minutesAgo(45),
    }),
    capability({
      id: "cap-flash",
      model_id: GEMINI_25_FLASH.id,
      provider_id: GOOGLE.id,
      source_id: GEMINI_CATALOG_SOURCE.id,
      api_model_id: "gemini-2.5-flash",
      display_name: "Gemini 2.5 Flash",
      model_family: "gemini-2.5-flash",
      model_stage: "stable",
      context_window: 1_000_000,
      max_output_tokens: 65_536,
      supports_vision: true,
      supports_tool_calling: true,
      input_modalities: ["text", "image", "audio"],
      output_modalities: ["text"],
      observed_at: minutesAgo(45),
    }),
    capability({
      id: "cap-flash-preview",
      model_id: GEMINI_25_FLASH_PREVIEW.id,
      provider_id: GOOGLE.id,
      source_id: GEMINI_CATALOG_SOURCE.id,
      api_model_id: "gemini-2.5-flash-preview-09-2025",
      display_name: "Gemini 2.5 Flash Preview",
      model_family: "gemini-2.5-flash",
      model_stage: "preview",
      context_window: 32_768,
      max_output_tokens: 8_192,
      supports_vision: false,
      supports_tool_calling: null,
      input_modalities: ["text"],
      output_modalities: ["text"],
      observed_at: minutesAgo(45),
    }),
    // Two ids, one canonical model, different evidence: a genuine conflict.
    capability({
      id: "cap-imagen-family",
      model_id: GEMINI_IMAGEN.id,
      provider_id: GOOGLE.id,
      source_id: GEMINI_CATALOG_SOURCE.id,
      api_model_id: "imagen-4.0-generate-001",
      display_name: "Imagen 4",
      model_stage: "stable",
      context_window: 480,
      supports_vision: true,
      input_modalities: ["text"],
      output_modalities: ["image"],
      source_url: "https://ai.google.dev/gemini-api/docs/models/imagen",
      observed_at: minutesAgo(45),
    }),
    capability({
      id: "cap-imagen-fast",
      model_id: GEMINI_IMAGEN.id,
      provider_id: GOOGLE.id,
      source_id: GEMINI_CATALOG_SOURCE.id,
      api_model_id: "imagen-4.0-fast-generate-001",
      display_name: "Imagen 4 Fast",
      model_stage: "stable",
      context_window: 240,
      supports_vision: true,
      input_modalities: ["text"],
      output_modalities: ["image"],
      source_url: "https://ai.google.dev/gemini-api/docs/models/imagen-fast",
      observed_at: minutesAgo(40),
    }),
  ];

  const lifecycleSnapshots: LifecycleSnapshotRow[] = [
    lifecycle({
      id: "life-sonnet5",
      model_id: CLAUDE_SONNET_5.id,
      provider_id: ANTHROPIC.id,
      source_id: ANTHROPIC_LIFECYCLE_SOURCE.id,
      api_model_id: "claude-sonnet-5",
      lifecycle_state: "active",
      source_url: ANTHROPIC_LIFECYCLE_SOURCE.source_url,
      observed_at: minutesAgo(120),
    }),
    lifecycle({
      id: "life-opus3",
      model_id: CLAUDE_3_OPUS.id,
      provider_id: ANTHROPIC.id,
      source_id: ANTHROPIC_LIFECYCLE_SOURCE.id,
      api_model_id: "claude-3-opus-20240229",
      lifecycle_state: "deprecated",
      deprecated_on: "2026-01-21",
      retirement_date: "2026-03-01",
      recommended_replacement: "claude-sonnet-5",
      recommended_replacement_model_id: CLAUDE_SONNET_5.id,
      recommended_replacement_observed: true,
      source_url: ANTHROPIC_LIFECYCLE_SOURCE.source_url,
      observed_at: minutesAgo(120),
    }),
    lifecycle({
      id: "life-flash-preview",
      model_id: GEMINI_25_FLASH_PREVIEW.id,
      provider_id: GOOGLE.id,
      source_id: GEMINI_LIFECYCLE_SOURCE.id,
      api_model_id: "gemini-2.5-flash-preview-09-2025",
      lifecycle_state: "deprecated",
      retirement_not_before_date: "2026-09-30",
      retirement_not_before_observation: "date",
      recommended_replacement: "gemini-2.5-flash",
      recommended_replacement_observed: true,
      source_url: GEMINI_LIFECYCLE_SOURCE.source_url,
      observed_at: minutesAgo(150),
    }),
  ];

  return {
    providers: PROVIDERS,
    sources: SOURCES,
    models: MODELS,
    modelAliases: [
      alias({
        id: "alias-gpt5",
        model_id: GPT_5.id,
        provider_id: OPENAI.id,
        alias: "gpt-5",
        source_id: OPENAI_CATALOG_SOURCE.id,
      }),
      alias({
        id: "alias-gpt5-dated",
        model_id: GPT_5.id,
        provider_id: OPENAI.id,
        alias: "gpt-5-2026-01-15",
        source_id: OPENAI_CATALOG_SOURCE.id,
      }),
      alias({
        id: "alias-gpt5-source-name",
        model_id: GPT_5.id,
        provider_id: OPENAI.id,
        alias: "GPT-5",
        alias_type: "source_name",
        source_id: OPENAI_PRICING_SOURCE.id,
      }),
    ],
    pricingSnapshots,
    capabilitySnapshots,
    lifecycleSnapshots,
    changeEvents: [
      changeEvent({
        id: "change-gpt5-price",
        provider_id: OPENAI.id,
        model_id: GPT_5.id,
        source_id: OPENAI_PRICING_SOURCE.id,
        run_id: `run-${OPENAI_PRICING_SOURCE.id}`,
        change_type: "price_decreased",
        field_name: "input_price_per_1m_tokens",
        pricing_mode: "standard",
        context_tier: "default",
        old_value: 1.5,
        new_value: 1.25,
        previous_snapshot_id: "price-gpt5-old",
        current_snapshot_id: "price-gpt5",
        summary: "Input price decreased",
        detected_at: minutesAgo(60),
      }),
      changeEvent({
        id: "change-opus3-lifecycle",
        provider_id: ANTHROPIC.id,
        model_id: CLAUDE_3_OPUS.id,
        source_id: ANTHROPIC_LIFECYCLE_SOURCE.id,
        run_id: `run-${ANTHROPIC_LIFECYCLE_SOURCE.id}`,
        change_type: "lifecycle_changed",
        field_name: "lifecycle_state",
        old_value: "active",
        new_value: "deprecated",
        current_lifecycle_snapshot_id: "life-opus3",
        summary: "Claude 3 Opus was deprecated",
        detected_at: minutesAgo(120),
      }),
    ],
    runStatuses: {},
    externalRunIds: {
      [`run-${OPENAI_PRICING_SOURCE.id}`]: "bd_openai_pricing_run",
      [`run-${OPENAI_CATALOG_SOURCE.id}`]: "bd_openai_catalog_run",
      [`run-${ANTHROPIC_LIFECYCLE_SOURCE.id}`]: "bd_anthropic_lifecycle_run",
    },
  };
}
