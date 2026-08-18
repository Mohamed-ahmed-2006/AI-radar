import test from "node:test";
import assert from "node:assert/strict";
import {
  createPricingSourceHealthContract,
  InMemorySentinelRepository,
  MockSentinelHealer,
  runSentinelProtectedIngestion,
} from "../../lib/sentinel";

test("Sentinel Safety: quarantined runs never mutate canonical persistence", async () => {
  const repo = new InMemorySentinelRepository();
  const contract = createPricingSourceHealthContract("openai");
  const source = {
    id: "src-openai",
    providerId: "prov-openai",
    collectorId: "c_msx3bqlyjtv2qustx",
    sourceUrl: "https://developers.openai.com/api/docs/pricing",
  };
  const provider = {
    id: "prov-openai",
    slug: "openai",
    name: "OpenAI",
  };

  let canonicalPersistenceCalled = false;
  let canonicalRecordCount = 0;

  const persistCanonical = async (records: unknown[]) => {
    canonicalPersistenceCalled = true;
    canonicalRecordCount += records.length;
    return { acceptedCount: records.length, rejectedCount: 0, changesDetected: 0 };
  };

  // Malformed broken payload
  const brokenPayload = [
    {
      invalid_structure: true,
      price: "not_a_number",
    },
  ];

  const result = await runSentinelProtectedIngestion(
    contract,
    source,
    provider,
    async () => ({
      success: true,
      data: brokenPayload,
      metadata: { collectorId: source.collectorId, status: "success" },
    }),
    persistCanonical,
    {
      repository: repo,
      healer: new MockSentinelHealer("fail_validation"),
      autoHealOverride: false,
    },
  );

  assert.equal(result.isQuarantined, true);
  assert.equal(result.recordsAccepted, 0);
  assert.equal(canonicalPersistenceCalled, false);
  assert.equal(canonicalRecordCount, 0);
  assert.equal(repo.incidents.length, 1);
  assert.equal(repo.quarantinePayloads.length, 1);
});

test("Sentinel Safety: last-known-good baseline is preserved when collector fails", async () => {
  const repo = new InMemorySentinelRepository();
  const contract = createPricingSourceHealthContract("anthropic");
  const source = {
    id: "src-anthropic",
    providerId: "prov-anthropic",
    collectorId: "c_msxbuggp1czbtysx06",
    sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
  };
  const provider = {
    id: "prov-anthropic",
    slug: "anthropic",
    name: "Anthropic",
  };

  // Pre-seed Last-Known-Good baseline with 5 verified models
  repo.setLastKnownGoodBaseline(source.id, {
    runId: "run-lkg-initial",
    recordCount: 5,
    observedAt: new Date(Date.now() - 3600_000).toISOString(),
  });

  // Run with total failure (0 records)
  const result = await runSentinelProtectedIngestion(
    contract,
    source,
    provider,
    async () => ({
      success: true,
      data: [],
      metadata: { collectorId: source.collectorId, status: "success" },
    }),
    async (records) => ({ acceptedCount: records.length, rejectedCount: 0, changesDetected: 0 }),
    {
      repository: repo,
      autoHealOverride: false,
    },
  );

  assert.equal(result.isQuarantined, true);
  assert.equal(result.lastKnownGoodCount, 5);
  assert.equal(result.lastKnownGoodPreserved, true);
  assert.equal(repo.incidents[0]?.last_known_good_count, 5);
});

test("Sentinel Safety: one broken source does not block unrelated provider ingestion", async () => {
  const repo = new InMemorySentinelRepository();

  const openaiSource = {
    id: "src-openai",
    providerId: "prov-openai",
    collectorId: "c_openai",
    sourceUrl: "https://developers.openai.com/api/docs/pricing",
  };
  const openaiProvider = { id: "prov-openai", slug: "openai", name: "OpenAI" };

  const anthropicSource = {
    id: "src-anthropic",
    providerId: "prov-anthropic",
    collectorId: "c_anthropic",
    sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
  };
  const anthropicProvider = { id: "prov-anthropic", slug: "anthropic", name: "Anthropic" };

  // OpenAI fails & quarantines
  const openaiResult = await runSentinelProtectedIngestion(
    createPricingSourceHealthContract("openai", openaiSource.id),
    openaiSource,
    openaiProvider,
    async () => ({
      success: false,
      data: [],
      metadata: { collectorId: openaiSource.collectorId, status: "failed", error: "500 Internal Error" },
    }),
    async () => ({ acceptedCount: 0, rejectedCount: 0, changesDetected: 0 }),
    { repository: repo, autoHealOverride: false },
  );

  // Anthropic succeeds completely
  const anthropicResult = await runSentinelProtectedIngestion(
    createPricingSourceHealthContract("anthropic", anthropicSource.id),
    anthropicSource,
    anthropicProvider,
    async () => ({
      success: true,
      data: [
        {
          provider: "Anthropic",
          model_name: "Claude 3.5 Sonnet",
          pricing_mode: "standard",
          context_tier: "default",
          input_price_per_1m_tokens: 3.0,
          cached_input_price_per_1m_tokens: 0.3,
          cache_write_price_per_1m_tokens: 3.75,
          output_price_per_1m_tokens: 15.0,
          pricing_unit: "USD per 1M tokens",
          source_url: anthropicSource.sourceUrl,
        },
      ],
      metadata: { collectorId: anthropicSource.collectorId, status: "success" },
    }),
    async (records) => ({ acceptedCount: records.length, rejectedCount: 0, changesDetected: 1 }),
    { repository: repo, autoHealOverride: false },
  );

  assert.equal(openaiResult.isQuarantined, true);
  assert.equal(openaiResult.status, "quarantined");

  assert.equal(anthropicResult.isQuarantined, false);
  assert.equal(anthropicResult.status, "healthy");
  assert.equal(anthropicResult.recordsAccepted, 1);
});

test("Sentinel Safety: pricing absence never deactivates models or mutates lifecycle", () => {
  const contract = createPricingSourceHealthContract("openai");
  assert.equal(contract.isAuthoritative, false);
  assert.equal(contract.authorityDomain, "pricing");
});
