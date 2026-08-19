#!/usr/bin/env node
/**
 * Executes one live, end-to-end proof of the Sentinel self-healing demo and
 * prints the evidence record.
 *
 * Every step here is the real one: the real Bright Data collector, the real
 * Sentinel gate, the real canonical writes. There is no simulation path and no
 * flag that makes a step pass without doing its work — if a step cannot run,
 * the script says which step and why, and stops.
 *
 * Usage:
 *   npx tsx scripts/demo/run-healing-proof.ts [--preflight] [--json]
 *
 * Options:
 *   --preflight  Check configuration and Bright Data reachability, then stop
 *                without running the collector or writing anything.
 *   --break-template
 *                Produce the controlled failure with a real Scraper Studio
 *                refactor instead of the layout switch. Slower, and it spends
 *                an AI-Flow job; use it only when no controllable page is
 *                reachable.
 *   --json       Print the evidence record as JSON only.
 *
 * Required configuration:
 *   BRIGHTDATA_API_KEY            an account whose zone can make requests
 *   BRIGHTDATA_DEMO_COLLECTOR_ID  the DEDICATED demo collector, never a
 *                                 pricing, lifecycle or catalog one
 *   SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL
 *   AI_RADAR_DEMO_SOURCE_BASE_URL optional; serves both layouts ourselves
 */

import {
  DemoHealingOrchestrator,
  type DemoAction,
  type DemoActionResult,
} from "../../lib/demo-healing/orchestrator";
import { getDemoHealingReadModel } from "../../lib/demo-healing/read-model";
import {
  DemoSourceNotConfiguredError,
  resolveDemoSourceConfiguration,
} from "../../lib/demo-healing/source";

interface StepRecord {
  step: number;
  action: DemoAction;
  status: DemoActionResult["status"];
  phase: string;
  summary: string;
}

const PRODUCTION_COLLECTOR_ENV_KEYS = [
  "BRIGHTDATA_OPENAI_COLLECTOR_ID",
  "BRIGHTDATA_ANTHROPIC_COLLECTOR_ID",
  "BRIGHTDATA_GEMINI_COLLECTOR_ID",
  "BRIGHTDATA_XAI_COLLECTOR_ID",
  "BRIGHTDATA_OPENAI_CATALOG_COLLECTOR_ID",
  "BRIGHTDATA_ANTHROPIC_CATALOG_COLLECTOR_ID",
  "BRIGHTDATA_GEMINI_CATALOG_COLLECTOR_ID",
  "BRIGHTDATA_XAI_CATALOG_COLLECTOR_ID",
  "BRIGHTDATA_ANTHROPIC_LIFECYCLE_COLLECTOR_ID",
  "BRIGHTDATA_GEMINI_LIFECYCLE_COLLECTOR_ID",
];

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/**
 * Refuses to proceed on anything but a dedicated collector.
 *
 * The orchestrator already restricts the *source*; this restricts the
 * *collector*, so a demo pointed at a production collector by a stray
 * environment variable stops here rather than refactoring it.
 */
function assertDedicatedCollector(collectorId: string): void {
  for (const key of PRODUCTION_COLLECTOR_ENV_KEYS) {
    const production = process.env[key]?.trim();
    if (production && production === collectorId) {
      fail(
        `BRIGHTDATA_DEMO_COLLECTOR_ID is set to the same collector as ${key}. `
          + "The demo refuses to refactor a production collector.",
      );
    }
  }
}

async function checkBrightDataAccount(apiKey: string): Promise<void> {
  const baseUrl = (process.env.BRIGHTDATA_BASE_URL || "https://api.brightdata.com").replace(
    /\/+$/,
    "",
  );
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    fail(`Could not reach Bright Data: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    fail(`Bright Data /status returned HTTP ${response.status}. The API key is not usable.`);
  }
  const status = (await response.json()) as {
    status?: string;
    can_make_requests?: boolean;
    auth_fail_reason?: string;
  };
  console.log(`  Bright Data account status : ${status.status ?? "unknown"}`);
  console.log(`  Can make requests          : ${status.can_make_requests}`);
  if (status.can_make_requests === false) {
    fail(
      "The Bright Data account cannot make requests"
        + (status.auth_fail_reason ? ` (${status.auth_fail_reason})` : "")
        + ". Provision a zone for this key before running the live proof. "
        + "No step of this proof can be completed without it, and none will be simulated.",
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const preflightOnly = args.includes("--preflight");
  const breakWithTemplate = args.includes("--break-template");

  const log = (message: string) => {
    if (!jsonOnly) console.log(message);
  };

  log("Sentinel self-healing demo — live proof");
  log("=".repeat(60));
  log("\nPreflight");

  const apiKey = process.env.BRIGHTDATA_API_KEY?.trim();
  if (!apiKey) fail("BRIGHTDATA_API_KEY is not set.");

  let configuration;
  try {
    configuration = resolveDemoSourceConfiguration();
  } catch (error) {
    if (error instanceof DemoSourceNotConfiguredError) fail(error.message);
    throw error;
  }
  assertDedicatedCollector(configuration.collectorId);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) fail("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail("No Supabase service credential is set; the proof cannot record its evidence.");
  }

  log(`  Demo collector             : ${configuration.collectorId}`);
  log(`  Healthy layout             : ${configuration.layouts.healthy.url}`);
  log(`  Incompatible layout        : ${configuration.layouts.broken.url}`);
  await checkBrightDataAccount(apiKey);

  if (preflightOnly) {
    log("\n✔ Preflight passed. Re-run without --preflight to execute the live proof.");
    return;
  }

  const orchestrator = new DemoHealingOrchestrator({ live: true });
  const steps: StepRecord[] = [];
  let stepNumber = 0;

  /** Runs one step and stops the proof if it did not do what it must. */
  const step = async (action: DemoAction, mustSucceed: DemoActionResult["status"][]) => {
    stepNumber += 1;
    log(`\n[${stepNumber}] ${action}`);
    const result = await orchestrator.execute(action);
    steps.push({
      step: stepNumber,
      action,
      status: result.status,
      phase: result.phase,
      summary: result.summary,
    });
    log(`    ${result.status.toUpperCase()} — ${result.summary}`);
    if (!mustSucceed.includes(result.status)) {
      console.error(`\n✖ Step '${action}' ended as '${result.status}': ${result.summary}`);
      console.error("  Stopping. The remaining steps are not simulated.");
      process.exit(1);
    }
    return result;
  };

  await step("reset", ["ok"]);
  await step("run_baseline", ["ok"]);
  await step(breakWithTemplate ? "break_template" : "arm_failure", ["ok"]);
  // The invalid observation MUST be refused. An "ok" here would mean the
  // controlled incompatibility did not actually break extraction, which
  // invalidates the proof rather than passing it.
  await step("run_broken", ["refused"]);
  await step("request_heal", ["ok"]);
  await step("validate_preview", ["ok"]);
  await step("approve", ["ok"]);
  await step("rerun", ["ok"]);

  const readModel = await getDemoHealingReadModel({
    configuration,
    harness: orchestrator.getHarnessRepository(),
    includeOperatorDetail: true,
  });

  const evidence = {
    collectorId: configuration.collectorId,
    sourceKey: configuration.sourceKey,
    healthyLayoutUrl: configuration.layouts.healthy.url,
    incompatibleLayoutUrl: configuration.layouts.broken.url,
    baselineRunId: readModel.lastKnownGoodRun?.runId ?? null,
    invalidRunId: readModel.quarantine.incident ? readModel.currentRun?.runId ?? null : null,
    sentinelReasonCodes: readModel.sentinel.reasonCodes,
    incidentId: readModel.quarantine.incident?.incidentId ?? null,
    canonicalWritesFromRefusedRun: readModel.quarantine.canonicalWritesFromRefusedRun,
    lastKnownGoodPreserved: readModel.lastKnownGoodPreserved,
    refactorJobId: readModel.healing.refactorJobId ?? null,
    previewRecordsCount: readModel.healing.previewRecordsCount,
    previewValidationPassed: readModel.healing.previewValidationPassed,
    approvalState: readModel.healing.approvalState,
    approvedAt: readModel.healing.approvedAt,
    recoveredRunId: readModel.recovery.recoveredRunId,
    finalPhase: readModel.phase.phase,
    canonicalRecordTotal: readModel.canonicalRecordTotal,
    isLive: readModel.evidence.isLive,
    steps,
  };

  if (jsonOnly) {
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }

  log(`\n${"=".repeat(60)}`);
  log("Evidence record");
  log("=".repeat(60));
  for (const [key, value] of Object.entries(evidence)) {
    if (key === "steps") continue;
    log(`  ${key.padEnd(30)} ${JSON.stringify(value)}`);
  }
  log(
    evidence.finalPhase === "recovered" && evidence.canonicalWritesFromRefusedRun === 0
      ? "\n✔ Live proof complete."
      : "\n✖ Live proof did not reach a recovered state.",
  );
}

main().catch((error) => {
  console.error(`\n✖ ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
