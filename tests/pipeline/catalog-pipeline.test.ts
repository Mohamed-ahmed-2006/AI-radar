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
