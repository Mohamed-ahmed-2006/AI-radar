#!/usr/bin/env node
/**
 * Live acquisition proof for the model catalog / capability collectors.
 *
 * For each configured provider this script:
 *   1. runs the real Bright Data collector through the production client,
 *   2. validates every raw record against that provider's raw contract,
 *   3. replays the same records through the provider's Sentinel health
 *      contract, exactly as the ingestion gate does before canonical writes,
 *   4. adapts the valid records and asserts the capability invariants:
 *      unknown stays null (never false), and only exact token counts are
 *      normalized while the raw evidence is preserved.
 *
 * It never writes to Supabase. It is a read-only proof of acquisition.
 *
 * Usage:
 *   npx tsx scripts/ingestion/verify-catalog-collectors.ts [options]
 *
 * Options:
 *   --provider <slug>   Verify one provider only (openai|anthropic|gemini|xai)
 *   --timeout <ms>      Collector poll timeout in ms (default: 300000)
 *   --json              Emit the full report as JSON
 *   --help, -h          Show help
 */

import { fetchCatalogCollector } from "../../lib/brightdata";
import {
  CATALOG_PROVIDERS,
  resolveCatalogProviderConfiguration,
  type CatalogProviderDefinition,
} from "../../lib/pipeline";
import {
  createCatalogSourceHealthContract,
  evaluateSourceHealth,
} from "../../lib/sentinel";
import {
  RawAnthropicCatalogRecordSchema,
  RawGeminiCatalogRecordSchema,
  RawOpenAiCatalogRecordSchema,
  RawXaiCatalogRecordSchema,
  type CatalogProviderSlug,
  type NormalizedCatalogRecord,
} from "../../lib/contracts";
import type { ZodType } from "zod";

const RAW_SCHEMAS: Record<CatalogProviderSlug, ZodType> = {
  openai: RawOpenAiCatalogRecordSchema,
  anthropic: RawAnthropicCatalogRecordSchema,
  gemini: RawGeminiCatalogRecordSchema,
  xai: RawXaiCatalogRecordSchema,
};

interface ProviderReport {
  provider: CatalogProviderSlug;
  sourceUrl: string;
  collectorId: string;
  runId: string | null;
  durationMs: number;
  recordsReturned: number;
  contractValid: number;
  contractInvalid: number;
  contractIssues: string[];
  sentinelStatus: string;
  sentinelReasonCodes: string[];
  exactContextWindows: number;
  unknownContextWindows: number;
  unknownVision: number;
  unknownToolCalling: number;
  invariantViolations: string[];
  models: Array<{
    apiModelId: string;
    displayName: string | null;
    contextWindow: number | null;
    maxOutputTokens: number | null;
    supportsVision: boolean | null;
    supportsToolCalling: boolean | null;
  }>;
  ok: boolean;
  error?: string;
}

/**
 * Absence of evidence must never be recorded as evidence of absence. A raw
 * record that omits a capability must adapt to null, and a raw record that
 * only publishes a vague token count must adapt to null while keeping the
 * original string in raw evidence.
 */
function checkInvariants(
  raw: Record<string, unknown>,
  adapted: NormalizedCatalogRecord,
): string[] {
  const violations: string[] = [];
  const stated = (key: string) => raw[key] !== undefined && raw[key] !== null;

  if (!stated("supports_vision") && adapted.supportsVision === false) {
    violations.push(`${adapted.apiModelId}: unstated vision support became false`);
  }
  if (
    !stated("supports_function_calling") &&
    !stated("supports_tool_use") &&
    !(raw.features && typeof raw.features === "object") &&
    adapted.supportsToolCalling === false
  ) {
    violations.push(`${adapted.apiModelId}: unstated tool calling became false`);
  }
  if (adapted.contextWindow !== null && !Number.isSafeInteger(adapted.contextWindow)) {
    violations.push(`${adapted.apiModelId}: context window is not an exact integer`);
  }
  if (Object.keys(adapted.rawEvidence).length === 0) {
    violations.push(`${adapted.apiModelId}: raw evidence was not preserved`);
  }
  return violations;
}

async function verifyProvider(
  provider: CatalogProviderDefinition,
  timeoutMs: number,
  verbose: boolean,
): Promise<ProviderReport> {
  const configuration = resolveCatalogProviderConfiguration(provider);
  const report: ProviderReport = {
    provider: provider.slug,
    sourceUrl: configuration.sourceUrl,
    collectorId: configuration.collectorId,
    runId: null,
    durationMs: 0,
    recordsReturned: 0,
    contractValid: 0,
    contractInvalid: 0,
    contractIssues: [],
    sentinelStatus: "unknown",
    sentinelReasonCodes: [],
    exactContextWindows: 0,
    unknownContextWindows: 0,
    unknownVision: 0,
    unknownToolCalling: 0,
    invariantViolations: [],
    models: [],
    ok: false,
  };

  if (verbose) {
    console.log(`\n=== ${provider.name} (${provider.slug}) ===`);
    console.log(`collector: ${configuration.collectorId}`);
    console.log(`source:    ${configuration.sourceUrl}`);
  }

  const collection = await fetchCatalogCollector({
    collectorId: configuration.collectorId,
    sourceUrl: configuration.sourceUrl,
    pollTimeoutMs: timeoutMs,
    onProgress: (progress) => {
      if (verbose) {
        console.log(
          `  [poll] attempt ${progress.attempt} (${(progress.elapsedMs / 1000).toFixed(1)}s) ${progress.status ?? "processing"}`,
        );
      }
    },
  });

  report.runId = collection.metadata?.runId ?? null;
  report.durationMs = collection.metadata?.durationMs ?? 0;

  if (!collection.success) {
    report.error = collection.metadata?.error ?? "collector run failed";
    return report;
  }

  const rawRecords = Array.isArray(collection.data) ? collection.data : [];
  report.recordsReturned = rawRecords.length;

  // 1. Raw contract validation.
  const schema = RAW_SCHEMAS[provider.slug];
  const validRaw: Record<string, unknown>[] = [];
  for (const record of rawRecords) {
    const parsed = schema.safeParse(record);
    if (parsed.success) {
      validRaw.push(parsed.data as Record<string, unknown>);
    } else {
      report.contractInvalid += 1;
      for (const issue of parsed.error.issues) {
        report.contractIssues.push(`[${issue.path.join(".") || "root"}] ${issue.message}`);
      }
    }
  }
  report.contractValid = validRaw.length;

  // 2. Sentinel health contract, the same gate ingestion runs before writes.
  const contract = createCatalogSourceHealthContract(provider.slug);
  const evaluation = evaluateSourceHealth(rawRecords, contract, null, {
    observedAt: new Date().toISOString(),
  });
  report.sentinelStatus = evaluation.status;
  report.sentinelReasonCodes = [...evaluation.reasonCodes];

  // 3. Adapt and assert the capability invariants.
  for (const raw of validRaw) {
    const adapted = provider.adapt(
      raw,
      configuration.sourceUrl,
      configuration.collectorId,
      new Date().toISOString(),
    );
    report.invariantViolations.push(...checkInvariants(raw, adapted));

    if (adapted.contextWindow === null) report.unknownContextWindows += 1;
    else report.exactContextWindows += 1;
    if (adapted.supportsVision === null) report.unknownVision += 1;
    if (adapted.supportsToolCalling === null) report.unknownToolCalling += 1;

    report.models.push({
      apiModelId: adapted.apiModelId,
      displayName: adapted.displayName,
      contextWindow: adapted.contextWindow,
      maxOutputTokens: adapted.maxOutputTokens,
      supportsVision: adapted.supportsVision,
      supportsToolCalling: adapted.supportsToolCalling,
    });
  }

  report.ok =
    report.contractInvalid === 0 &&
    report.invariantViolations.length === 0 &&
    evaluation.status !== "quarantined";

  return report;
}

function printReport(report: ProviderReport): void {
  console.log(`\n--- ${report.provider} ---`);
  if (report.error) {
    console.log(`  FAILED: ${report.error}`);
    return;
  }
  console.log(`  run id:            ${report.runId ?? "n/a"}`);
  console.log(`  duration:          ${(report.durationMs / 1000).toFixed(1)}s`);
  console.log(`  records returned:  ${report.recordsReturned}`);
  console.log(`  contract valid:    ${report.contractValid}`);
  console.log(`  contract invalid:  ${report.contractInvalid}`);
  console.log(`  sentinel status:   ${report.sentinelStatus} ${report.sentinelReasonCodes.join(",") || ""}`);
  console.log(`  exact context:     ${report.exactContextWindows}`);
  console.log(`  unknown context:   ${report.unknownContextWindows}`);
  console.log(`  unknown vision:    ${report.unknownVision}`);
  console.log(`  unknown tools:     ${report.unknownToolCalling}`);
  console.log(`  invariant issues:  ${report.invariantViolations.length}`);
  for (const violation of report.invariantViolations) {
    console.log(`    ! ${violation}`);
  }
  for (const issue of report.contractIssues.slice(0, 10)) {
    console.log(`    x ${issue}`);
  }
  console.table(report.models);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let only: CatalogProviderSlug | undefined;
  let timeoutMs = 300_000;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npx tsx scripts/ingestion/verify-catalog-collectors.ts [--provider <slug>] [--timeout <ms>] [--json]",
      );
      process.exit(0);
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--provider" && i + 1 < args.length) {
      only = args[++i] as CatalogProviderSlug;
    } else if (arg === "--timeout" && i + 1 < args.length) {
      timeoutMs = Number.parseInt(args[++i], 10);
    }
  }

  const slugs = (only ? [only] : (Object.keys(CATALOG_PROVIDERS) as CatalogProviderSlug[]));
  const reports: ProviderReport[] = [];

  for (const slug of slugs) {
    const provider = CATALOG_PROVIDERS[slug];
    if (!provider) {
      console.error(`unknown provider: ${slug}`);
      process.exit(1);
    }
    try {
      reports.push(await verifyProvider(provider, timeoutMs, !json));
    } catch (error) {
      reports.push({
        provider: slug,
        sourceUrl: resolveCatalogProviderConfiguration(provider).sourceUrl,
        collectorId: resolveCatalogProviderConfiguration(provider).collectorId,
        runId: null,
        durationMs: 0,
        recordsReturned: 0,
        contractValid: 0,
        contractInvalid: 0,
        contractIssues: [],
        sentinelStatus: "unknown",
        sentinelReasonCodes: [],
        exactContextWindows: 0,
        unknownContextWindows: 0,
        unknownVision: 0,
        unknownToolCalling: 0,
        invariantViolations: [],
        models: [],
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const report of reports) printReport(report);
    console.log("\n================ SUMMARY ================");
    for (const report of reports) {
      console.log(
        `${report.ok ? "PASS" : "FAIL"}  ${report.provider.padEnd(10)} ${String(report.recordsReturned).padStart(3)} records  ${report.collectorId}`,
      );
    }
  }

  process.exit(reports.every((report) => report.ok) ? 0 : 1);
}

main().catch((error) => {
  console.error("verification failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
