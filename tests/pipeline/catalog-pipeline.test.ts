import assert from "node:assert/strict";
import test from "node:test";

import {
  CATALOG_PROVIDERS,
  ingestCatalogProvider,
} from "../../lib/pipeline";
import {
  RecordingCatalogRepository,
  collectorPayload,
} from "../orchestration/support/pipeline-doubles";
import {
  geminiCatalogRecords,
  openAiCatalogRecords,
} from "../orchestration/support/fixtures";
import { InMemorySentinelRepository } from "../../lib/sentinel";


test("ingestCatalogProvider ingests OpenAI catalog and writes snapshots and aliases", async () => {
  const repository = new RecordingCatalogRepository("provider-openai");
  const sentinelRepository = new InMemorySentinelRepository();

  const records = openAiCatalogRecords();
  const payload = collectorPayload(records, {
    collectorId: "c_openai_catalog",
    runId: "run-openai-1",
  });

  const result = await ingestCatalogProvider(CATALOG_PROVIDERS.openai, {
    repository,
    sentinelRepository,
    collect: async () => payload,
    triggeredBy: "test",
  });

  assert.equal(result.success, true);
  assert.equal(result.recordsAccepted, 2);
  assert.equal(result.recordsRejected, 0);
  assert.equal(repository.models.length, 2);
  assert.equal(repository.capabilitySnapshots.length, 2);
  assert.equal(repository.aliases.length, 2);

  const gpt5 = repository.capabilitySnapshots.find((s) => s.apiModelId === "gpt-5.6-sol");
  assert.ok(gpt5);
  assert.equal(gpt5.contextWindow, 256000);
  assert.equal(gpt5.maxOutputTokens, 32768);
  assert.equal(gpt5.supportsVision, true);
  assert.equal(gpt5.supportsToolCalling, true);
});

test("ingestCatalogProvider detects capability changes on subsequent collection", async () => {
  const repository = new RecordingCatalogRepository("provider-anthropic");
  const sentinelRepository = new InMemorySentinelRepository();

  // Run 1: 200k context window
  const initialRecords = [
    {
      api_model_id: "claude-sonnet-4-5-20250929",
      display_name: "Claude Sonnet 4.5",
      context_window_raw: 200000,
      max_output_tokens_raw: 8192,
      supports_vision: true,
      supports_tool_use: true,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
  ];

  await ingestCatalogProvider(CATALOG_PROVIDERS.anthropic, {
    repository,
    sentinelRepository,
    collect: async () =>
      collectorPayload(initialRecords, {
        collectorId: "c_anthropic_catalog",
        runId: "run-anthropic-1",
      }),
  });

  // Mock comparable snapshots returning Run 1's state
  repository.getComparableCapabilitySnapshots = async () => [
    {
      id: "cap-1",
      run_id: "run-1",
      source_id: "source-1",
      provider_id: "provider-1",
      model_id: repository.models[0].id,
      model_name: repository.models[0].model_name,
      provider_name: "Anthropic",
      provider_slug: "anthropic",
      api_model_id: "claude-sonnet-4-5-20250929",
      display_name: "Claude Sonnet 4.5",
      model_family: "Claude Sonnet",
      model_stage: "ga",
      context_window: 200000,
      max_output_tokens: 8192,
      supports_vision: true,
      supports_tool_calling: true,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      supported_features: [],
      source_url: "https://docs.anthropic.com",
      observed_at: "2026-08-18T00:00:00.000Z",
      created_at: "2026-08-18T00:00:00.000Z",
      content_hash: "hash",
      raw: {},
      extra: {},
    },
  ];

  // Run 2: Context window expands to 1M tokens
  const upgradedRecords = [
    {
      api_model_id: "claude-sonnet-4-5-20250929",
      display_name: "Claude Sonnet 4.5",
      context_window_raw: 1000000,
      max_output_tokens_raw: 64000,
      supports_vision: true,
      supports_tool_use: true,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
  ];

  const result = await ingestCatalogProvider(CATALOG_PROVIDERS.anthropic, {
    repository,
    sentinelRepository,
    collect: async () =>
      collectorPayload(upgradedRecords, {
        collectorId: "c_anthropic_catalog",
        runId: "run-anthropic-2",
      }),
  });

  assert.equal(result.success, true);
  assert.equal(result.changesDetected, 2); // contextWindow and maxOutputTokens changed
  assert.equal(repository.changeEvents.length, 2);
  const contextChangeEvent = repository.changeEvents.find((e) => e.fieldName === "contextWindow");
  assert.ok(contextChangeEvent);
  assert.equal(contextChangeEvent.oldValue, 200000);
  assert.equal(contextChangeEvent.newValue, 1000000);
});

test("catalog absence never deletes models or modifies lifecycle state", async () => {
  const repository = new RecordingCatalogRepository("provider-gemini");
  const sentinelRepository = new InMemorySentinelRepository();

  // Run 1: 2 models
  await ingestCatalogProvider(CATALOG_PROVIDERS.gemini, {
    repository,
    sentinelRepository,
    collect: async () =>
      collectorPayload(geminiCatalogRecords(), {
        collectorId: "c_gemini_catalog",
        runId: "run-gemini-1",
      }),
  });
  assert.equal(repository.models.length, 2);

  // Run 2: Catalog page only lists 1 model (one omitted)
  const singleRecord = [geminiCatalogRecords()[0]];
  await ingestCatalogProvider(CATALOG_PROVIDERS.gemini, {
    repository,
    sentinelRepository,
    collect: async () =>
      collectorPayload(singleRecord, {
        collectorId: "c_gemini_catalog",
        runId: "run-gemini-2",
      }),
  });

  // Models count is still 2, and none are deactivated
  assert.equal(repository.models.length, 2);
  assert.ok(repository.models.every((m) => m.is_active === true));
  assert.ok(repository.models.every((m) => m.lifecycle_state === null));
});

/**
 * Sentinel only quarantines a run once the invalid share crosses its threshold,
 * so a single duplicate among many records degrades the source and still
 * reaches persistence. These fillers reproduce that live shape.
 */
function geminiFillerRecords(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    model_id: `gemini-filler-${index}`,
    display_name: `Gemini Filler ${index}`,
    context_window_raw: 1048576,
    max_output_tokens_raw: 65536,
    supports_function_calling: true,
    input_modalities: ["text"],
    output_modalities: ["text"],
  }));
}

test("ingestCatalogProvider collapses a model the source emitted twice identically", async () => {
  const repository = new RecordingCatalogRepository("provider-gemini");
  const sentinelRepository = new InMemorySentinelRepository();

  const record = {
    model_id: "gemini-3.7-flash",
    display_name: "Gemini 3.7 Flash",
    context_window_raw: 1048576,
    max_output_tokens_raw: 65536,
    supports_function_calling: true,
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
  };
  const fillers = geminiFillerRecords(20);

  const result = await ingestCatalogProvider(CATALOG_PROVIDERS.gemini, {
    repository,
    sentinelRepository,
    collect: async () =>
      collectorPayload([record, { ...record }, ...fillers], {
        collectorId: "c_gemini_catalog",
        runId: "run-gemini-dupe",
      }),
    triggeredBy: "test",
  });

  assert.equal(result.recordsAccepted, fillers.length + 1);
  assert.equal(result.recordsRejected, 0);
  assert.equal(
    repository.capabilitySnapshots.filter((s) => s.apiModelId === "gemini-3.7-flash").length,
    1,
  );
});

const GEMINI_MODELS_BASE = "https://ai.google.dev/gemini-api/docs/models";

test("ingestCatalogProvider splits a family page that enumerates several api ids", async () => {
  const repository = new RecordingCatalogRepository("provider-gemini");
  const sentinelRepository = new InMemorySentinelRepository();

  // Google documents the Veo family on one page whose Model code row lists two
  // codes, and the Imagen family on a page listing three.
  const familyRecords = [
    {
      model_id: "veo-3.1-generate-preview veo-3.1-fast-generate-preview",
      display_name: "Veo 3.1",
      context_window_raw: 1024,
      input_modalities: ["text", "image"],
      output_modalities: ["video"],
      source_url: `${GEMINI_MODELS_BASE}/veo-3.1-generate-preview`,
    },
    {
      model_id:
        "imagen-4.0-generate-001 imagen-4.0-ultra-generate-001 imagen-4.0-fast-generate-001",
      display_name: "Imagen 4",
      input_modalities: ["text"],
      output_modalities: ["image"],
      source_url: `${GEMINI_MODELS_BASE}/imagen`,
    },
  ];

  const result = await ingestCatalogProvider(CATALOG_PROVIDERS.gemini, {
    repository,
    sentinelRepository,
    collect: async () =>
      collectorPayload([...familyRecords, ...geminiFillerRecords(20)], {
        collectorId: "c_gemini_catalog",
        runId: "run-gemini-family",
      }),
    triggeredBy: "test",
  });

  assert.equal(result.recordsRejected, 0);

  const ids = repository.capabilitySnapshots.map((s) => s.apiModelId);
  assert.ok(
    ids.every((id) => !/\s/.test(id)),
    "a space-joined enumeration must never become a canonical api model id",
  );
  for (const id of [
    "veo-3.1-generate-preview",
    "veo-3.1-fast-generate-preview",
    "imagen-4.0-generate-001",
    "imagen-4.0-ultra-generate-001",
    "imagen-4.0-fast-generate-001",
  ]) {
    assert.ok(ids.includes(id), `${id} should be its own observation`);
  }

  // The page publishes one property table for every code it lists, so the
  // shared evidence is copied, and the original enumeration is still on record.
  const fast = repository.capabilitySnapshots.find(
    (s) => s.apiModelId === "veo-3.1-fast-generate-preview",
  );
  assert.ok(fast);
  assert.equal(fast.contextWindow, 1024);
  assert.equal(
    (fast.raw as { model_id?: string }).model_id,
    "veo-3.1-generate-preview veo-3.1-fast-generate-preview",
  );
});

test("ingestCatalogProvider keeps a bare family name out of the canonical catalog", async () => {
  const repository = new RecordingCatalogRepository("provider-gemini");
  const sentinelRepository = new InMemorySentinelRepository();

  // Only real ids may be split out. A value carrying a bare word is not an
  // enumeration we can trust, so it is left exactly as published.
  const record = {
    model_id: "imagen and its variants",
    display_name: "Imagen",
    source_url: `${GEMINI_MODELS_BASE}/imagen`,
  };

  const result = await ingestCatalogProvider(CATALOG_PROVIDERS.gemini, {
    repository,
    sentinelRepository,
    collect: async () =>
      collectorPayload([record, ...geminiFillerRecords(20)], {
        collectorId: "c_gemini_catalog",
        runId: "run-gemini-bare",
      }),
    triggeredBy: "test",
  });

  assert.equal(result.success, true);
  const split = repository.capabilitySnapshots.filter((s) =>
    /^imagen/.test(s.apiModelId),
  );
  assert.equal(split.length, 1, "prose must not be guessed apart into ids");
  assert.equal(split[0].apiModelId, "imagen and its variants");
});

test("ingestCatalogProvider trusts the page named after the id when two pages collide", async () => {
  const repository = new RecordingCatalogRepository("provider-gemini");
  const sentinelRepository = new InMemorySentinelRepository();

  // Google's lyria-3-pro-preview page publishes lyria-3-clip-preview as its
  // model code, so two distinct pages claim one id. Only the page named after
  // that id is trustworthy evidence for it.
  const colliding = [
    {
      model_id: "lyria-3-clip-preview",
      display_name: "Lyria 3 Pro preview",
      context_window_raw: 131072,
      output_modalities: ["audio"],
      source_url: `${GEMINI_MODELS_BASE}/lyria-3-pro-preview`,
    },
    {
      model_id: "lyria-3-clip-preview",
      display_name: "Lyria 3 Clip preview",
      context_window_raw: 131072,
      output_modalities: ["audio", "text"],
      source_url: `${GEMINI_MODELS_BASE}/lyria-3-clip-preview`,
    },
  ];
  const fillers = geminiFillerRecords(20);

  const result = await ingestCatalogProvider(CATALOG_PROVIDERS.gemini, {
    repository,
    sentinelRepository,
    collect: async () =>
      collectorPayload([...colliding, ...fillers], {
        collectorId: "c_gemini_catalog",
        runId: "run-gemini-lyria",
      }),
    triggeredBy: "test",
  });

  // The healthy models still ingest, and Clip keeps its own page's evidence.
  assert.equal(result.recordsAccepted, fillers.length + 1);
  assert.equal(result.recordsRejected, 1);

  const clip = repository.capabilitySnapshots.filter(
    (s) => s.apiModelId === "lyria-3-clip-preview",
  );
  assert.equal(clip.length, 1, "two official pages must not collapse into one model");
  assert.equal(clip[0].displayName, "Lyria 3 Clip preview");
  assert.deepEqual(clip[0].outputModalities, ["audio", "text"]);

  // Pro is preserved as an unresolved conflict rather than re-keyed onto its
  // own slug, which would be guessing an api id from page structure.
  assert.equal(
    repository.capabilitySnapshots.some((s) => s.apiModelId === "lyria-3-pro-preview"),
    false,
  );
});

test("ingestCatalogProvider withholds every side of an unresolvable collision", async () => {
  const repository = new RecordingCatalogRepository("provider-gemini");
  const sentinelRepository = new InMemorySentinelRepository();

  // Neither page is named after the id it published, so provenance cannot say
  // which one owns it and no capability evidence may be written for it.
  const colliding = [
    {
      model_id: "lyria-3-clip-preview",
      display_name: "Lyria 3 Pro preview",
      context_window_raw: 131072,
      source_url: `${GEMINI_MODELS_BASE}/lyria-3-pro-preview`,
    },
    {
      model_id: "lyria-3-clip-preview",
      display_name: "Lyria 3 Realtime",
      context_window_raw: 65536,
      source_url: `${GEMINI_MODELS_BASE}/lyria-realtime-exp`,
    },
  ];
  const fillers = geminiFillerRecords(20);

  const result = await ingestCatalogProvider(CATALOG_PROVIDERS.gemini, {
    repository,
    sentinelRepository,
    collect: async () =>
      collectorPayload([...colliding, ...fillers], {
        collectorId: "c_gemini_catalog",
        runId: "run-gemini-unresolvable",
      }),
    triggeredBy: "test",
  });

  assert.equal(result.recordsAccepted, fillers.length);
  assert.equal(result.recordsRejected, colliding.length);
  assert.equal(
    repository.capabilitySnapshots.some((s) => s.apiModelId === "lyria-3-clip-preview"),
    false,
    "an unresolvable identity must not persist capability evidence",
  );
});
