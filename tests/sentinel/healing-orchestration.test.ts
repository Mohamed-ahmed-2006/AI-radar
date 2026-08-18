import test from "node:test";
import assert from "node:assert/strict";
import {
  BrightDataScraperHealer,
  createPricingSourceHealthContract,
  InMemorySentinelRepository,
  MockSentinelHealer,
  runSentinelProtectedIngestion,
} from "../../lib/sentinel";
import { BrightDataConfigError } from "../../lib/brightdata/errors";

test("Sentinel Healing: validated repaired candidate recovers source to 'recovered' status", async () => {
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

  const validHealedCandidate = [
    {
      provider: "OpenAI",
      model_name: "gpt-4o",
      pricing_mode: "standard",
      context_tier: "default",
      input_price_per_1m_tokens: 2.5,
      cached_input_price_per_1m_tokens: 1.25,
      cache_write_price_per_1m_tokens: null,
      output_price_per_1m_tokens: 10.0,
      pricing_unit: "USD per 1M tokens",
      source_url: source.sourceUrl,
    },
  ];

  const healer = new MockSentinelHealer("succeed", validHealedCandidate);

  let canonicalPersistedCount = 0;
  const persistCanonical = async (records: unknown[]) => {
    canonicalPersistedCount = records.length;
    return { acceptedCount: records.length, rejectedCount: 0, changesDetected: records.length };
  };

  // Run with broken payload initially (all nulls)
  const result = await runSentinelProtectedIngestion(
    contract,
    source,
    provider,
    async () => ({
      success: true,
      data: [
        {
          provider: "OpenAI",
          model_name: "gpt-4o",
          pricing_mode: "standard",
          context_tier: "default",
          input_price_per_1m_tokens: null,
          output_price_per_1m_tokens: null,
          pricing_unit: "USD per 1M tokens",
          source_url: source.sourceUrl,
        },
      ],
      metadata: { collectorId: source.collectorId, status: "success" },
    }),
    persistCanonical,
    {
      repository: repo,
      healer,
      autoHealOverride: true,
    },
  );

  assert.equal(result.status, "recovered");
  assert.equal(result.success, true);
  assert.equal(result.isQuarantined, false);
  assert.equal(result.healingAttempted, true);
  assert.equal(result.recordsAccepted, 1);
  assert.equal(canonicalPersistedCount, 1);
  assert.equal(healer.recordedAttempts.length, 1);
  assert.equal(repo.healingAttempts.length, 2); // initiated + approved
  assert.equal(repo.healingAttempts[1]?.status, "approved");
  assert.equal(repo.incidents[0]?.status, "resolved");
});

test("Sentinel Healing: candidate failing validation is rejected, template retained, marks 'needs_review'", async () => {
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

  // Healer returns candidate that still fails validation (missing price)
  const invalidCandidate = [
    {
      provider: "OpenAI",
      model_name: "gpt-4o",
      pricing_mode: "standard",
      context_tier: "default",
      input_price_per_1m_tokens: null,
      output_price_per_1m_tokens: null,
      pricing_unit: "USD per 1M tokens",
      source_url: source.sourceUrl,
    },
  ];

  const healer = new MockSentinelHealer("fail_validation", invalidCandidate);

  let canonicalPersisted = false;
  const persistCanonical = async () => {
    canonicalPersisted = true;
    return { acceptedCount: 0, rejectedCount: 0, changesDetected: 0 };
  };

  const result = await runSentinelProtectedIngestion(
    contract,
    source,
    provider,
    async () => ({
      success: true,
      data: [{ broken: "data" }],
      metadata: { collectorId: source.collectorId, status: "success" },
    }),
    persistCanonical,
    {
      repository: repo,
      healer,
      autoHealOverride: true,
    },
  );

  assert.equal(result.status, "needs_review");
  assert.equal(result.isQuarantined, true);
  assert.equal(canonicalPersisted, false);
  assert.equal(healer.recordedAttempts.length, 1);
  assert.equal(repo.healingAttempts[1]?.status, "candidate_rejected");
  assert.equal(repo.incidents[0]?.status, "needs_review");
});

test("Sentinel Healing: live BrightDataScraperHealer throws BrightDataConfigError when API key is missing", async () => {
  const healer = new BrightDataScraperHealer({ apiKey: "" });
  const contract = createPricingSourceHealthContract("openai");

  await assert.rejects(
    async () => {
      await healer.healScraper(
        {
          collectorId: "c_msx3bqlyjtv2qustx",
          prompt: "Fix extraction",
        },
        contract,
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof BrightDataConfigError);
      assert.ok((err as Error).message.includes("BRIGHTDATA_API_KEY"));
      return true;
    },
  );
});
