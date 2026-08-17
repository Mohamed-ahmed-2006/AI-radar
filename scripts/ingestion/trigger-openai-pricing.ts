#!/usr/bin/env node
/**
 * Executable script to trigger the OpenAI Pricing Bright Data Collector.
 *
 * Usage:
 *   npx tsx scripts/ingestion/trigger-openai-pricing.ts [options]
 *   node scripts/ingestion/trigger-openai-pricing.ts [options]
 *
 * Options:
 *   --collector-id <id>   Override collector ID (default: env BRIGHTDATA_OPENAI_COLLECTOR_ID or c_msx3bqlyjtv2qustx)
 *   --source-url <url>    Override source URL (default: env OPENAI_PRICING_SOURCE_URL or https://developers.openai.com/api/docs/pricing)
 *   --timeout <ms>        Max polling timeout in ms (default: 120000)
 *   --json                Output full result JSON to stdout
 *   --help, -h            Show help
 */

import { fetchOpenAIPricing } from "../../lib/brightdata";

function parseArgs(args: string[]) {
  const options: {
    collectorId?: string;
    sourceUrl?: string;
    timeoutMs?: number;
    jsonOutput?: boolean;
    help?: boolean;
  } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.jsonOutput = true;
    } else if (arg === "--collector-id" && i + 1 < args.length) {
      options.collectorId = args[++i];
    } else if (arg === "--source-url" && i + 1 < args.length) {
      options.sourceUrl = args[++i];
    } else if (arg === "--timeout" && i + 1 < args.length) {
      options.timeoutMs = parseInt(args[++i], 10);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
AI Radar - OpenAI Pricing Ingestion Script

Usage:
  npx tsx scripts/ingestion/trigger-openai-pricing.ts [options]

Options:
  --collector-id <id>   Bright Data Collector ID (default: c_msx3bqlyjtv2qustx)
  --source-url <url>    Target pricing page URL
  --timeout <ms>        Polling timeout in milliseconds (default: 120000)
  --json                Output pure JSON result to stdout
  -h, --help            Show this help message

Environment Variables:
  BRIGHTDATA_API_KEY              Required: Bright Data API bearer token
  BRIGHTDATA_OPENAI_COLLECTOR_ID  Optional: Default collector ID
  OPENAI_PRICING_SOURCE_URL       Optional: Default source URL
  BRIGHTDATA_POLL_INTERVAL_MS     Optional: Polling interval (default 2000ms)
  BRIGHTDATA_POLL_TIMEOUT_MS      Optional: Polling timeout (default 120000ms)
`);
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const isJson = options.jsonOutput ?? false;

  if (!isJson) {
    console.log("==================================================");
    console.log("AI Radar - Bright Data OpenAI Pricing Ingestion");
    console.log("==================================================");
  }

  const result = await fetchOpenAIPricing({
    collectorId: options.collectorId,
    sourceUrl: options.sourceUrl,
    pollTimeoutMs: options.timeoutMs,
    onProgress: (prog) => {
      if (!isJson) {
        console.log(
          `[Polling] Attempt ${prog.attempt} (${(prog.elapsedMs / 1000).toFixed(1)}s) - Status: ${prog.status || "processing"}`
        );
      }
    },
  });

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("\n---------------- Run Summary ----------------");
    console.log(`Status:       ${result.metadata.status.toUpperCase()}`);
    console.log(`Collector ID: ${result.metadata.collectorId}`);
    console.log(`Run ID:       ${result.metadata.runId || "N/A"}`);
    console.log(`Started:      ${result.metadata.startedAt}`);
    console.log(`Completed:    ${result.metadata.completedAt}`);
    console.log(`Duration:     ${(result.metadata.durationMs / 1000).toFixed(2)}s`);
    console.log(`Result Count: ${result.metadata.resultCount}`);

    if (result.success) {
      console.log("\nSample Extracted Records (up to 5):");
      console.table(
        result.data.slice(0, 5).map((r) => ({
          model: r.model_name,
          input: `$${r.input_price_per_1m_tokens}`,
          cached_input: r.cached_input_price_per_1m_tokens != null ? `$${r.cached_input_price_per_1m_tokens}` : "N/A",
          output: `$${r.output_price_per_1m_tokens}`,
          unit: r.pricing_unit,
        }))
      );
      console.log(`\nTotal models retrieved: ${result.data.length}`);
    } else {
      console.error("\nRun Failed:");
      console.error(result.metadata.error || result.error?.message || "Unknown error");
    }
  }

  process.exit(result.success ? 0 : 1);
}

import { fileURLToPath } from "node:url";

const isDirectRun = Boolean(
  process.argv[1] &&
    (process.argv[1].includes("trigger-openai-pricing") ||
      (import.meta.url && fileURLToPath(import.meta.url) === process.argv[1]))
);

if (isDirectRun) {
  main().catch((err) => {
    console.error("Unhandled error in ingestion script:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
