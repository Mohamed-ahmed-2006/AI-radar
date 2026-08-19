/**
 * The production environment contract, and the fail-closed behaviour that
 * depends on it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProductionEnv,
  checkProductionEnv,
  PRODUCTION_ENV_CONTRACT,
  PRODUCTION_FORBIDDEN_ENV,
  type EnvSource,
} from "../../lib/config/production-env";
import {
  CATALOG_PROVIDERS,
  PRICING_PROVIDERS,
  resolveCatalogProviderConfiguration,
  resolvePricingProviderConfiguration,
} from "../../lib/pipeline";
import { listCollectionSources } from "../../lib/orchestration/registry";

const COMPLETE: EnvSource = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
  SUPABASE_SECRET_KEY: "secret",
  AI_RADAR_INGEST_SECRET: "ingest",
  CRON_SECRET: "cron",
  AI_RADAR_OPERATOR_KEY: "operator",
  BRIGHTDATA_API_KEY: "brightdata",
  BRIGHTDATA_DEMO_COLLECTOR_ID: "c_demo",
};

test("a complete production environment satisfies the contract", () => {
  const report = checkProductionEnv(COMPLETE);
  assert.equal(report.ok, true);
  assert.deepEqual(report.missingRequired, []);
  assert.deepEqual(report.forbiddenSet, []);
  assert.doesNotThrow(() => assertProductionEnv(COMPLETE));
});

test("an empty environment fails closed and names every required value", () => {
  const report = checkProductionEnv({});
  assert.equal(report.ok, false);
  const missing = report.missingRequired.map((requirement) => requirement.name);
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "AI_RADAR_INGEST_SECRET",
    "CRON_SECRET",
    "BRIGHTDATA_API_KEY",
  ]) {
    assert.ok(missing.includes(name), `expected ${name} to be reported missing`);
  }
  assert.throws(() => assertProductionEnv({}), /Missing required environment variables/);
});

test("a declared-but-blank value counts as missing", () => {
  const report = checkProductionEnv({ ...COMPLETE, BRIGHTDATA_API_KEY: "   " });
  assert.equal(report.ok, false);
  assert.ok(
    report.missingRequired.some((requirement) => requirement.name === "BRIGHTDATA_API_KEY"),
  );
});

test("legacy Supabase names satisfy their modern equivalents", () => {
  const report = checkProductionEnv({
    ...COMPLETE,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    SUPABASE_SECRET_KEY: undefined,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
  });
  assert.equal(report.ok, true);
});

test("every demo switch is rejected on a production deployment", () => {
  for (const name of PRODUCTION_FORBIDDEN_ENV) {
    const report = checkProductionEnv({ ...COMPLETE, [name]: "1" });
    assert.equal(report.ok, false, `${name} must fail the contract`);
    assert.deepEqual(report.forbiddenSet, [name]);
    assert.throws(
      () => assertProductionEnv({ ...COMPLETE, [name]: "1" }),
      /must not be set on a production deployment/,
    );
  }
});

test("the contract names the operator credential that replaces open controls", () => {
  const names = PRODUCTION_ENV_CONTRACT.map((requirement) => requirement.name);
  assert.ok(names.includes("AI_RADAR_OPERATOR_KEY"));
  assert.ok(names.includes("AI_RADAR_HEALING_DEMO_OPEN_CONTROLS"));
  const openControls = PRODUCTION_ENV_CONTRACT.find(
    (requirement) => requirement.name === "AI_RADAR_HEALING_DEMO_OPEN_CONTROLS",
  );
  // It must never be required for a production deployment.
  assert.equal(openControls?.severity, "optional");
});

test("a blank collector override never replaces the committed default", () => {
  for (const provider of Object.values(PRICING_PROVIDERS)) {
    const previous = process.env[provider.collectorEnv];
    process.env[provider.collectorEnv] = "";
    try {
      const configuration = resolvePricingProviderConfiguration(provider);
      assert.equal(configuration.collectorId, provider.defaultCollectorId);
      assert.notEqual(configuration.collectorId.trim(), "");
    } finally {
      if (previous === undefined) delete process.env[provider.collectorEnv];
      else process.env[provider.collectorEnv] = previous;
    }
  }
  for (const provider of Object.values(CATALOG_PROVIDERS)) {
    const previous = process.env[provider.collectorEnv];
    process.env[provider.collectorEnv] = "   ";
    try {
      const configuration = resolveCatalogProviderConfiguration(provider);
      assert.equal(configuration.collectorId, provider.defaultCollectorId);
    } finally {
      if (previous === undefined) delete process.env[provider.collectorEnv];
      else process.env[provider.collectorEnv] = previous;
    }
  }
});

test("every configured source resolves a non-empty collector id and https source URL", () => {
  const sources = listCollectionSources();
  assert.equal(sources.length, 10);
  for (const source of sources) {
    assert.ok(source.collectorId.trim().length > 0, `${source.key} has no collector id`);
    assert.match(source.sourceUrl, /^https:\/\//, `${source.key} source URL is not https`);
    assert.ok(source.schedule.cadenceMinutes > 0, `${source.key} has no cadence`);
    assert.ok(source.retry.maxAttempts >= 1 && source.retry.maxAttempts <= 5);
    assert.ok(typeof source.createHealthContract === "function", `${source.key} has no contract`);
  }
});
