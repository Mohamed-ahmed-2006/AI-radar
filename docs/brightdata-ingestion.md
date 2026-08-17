# Bright Data Ingestion Layer (Lane C)

This directory and module provide server-side plumbing for invoking Bright Data Scraper Studio collectors, polling for asynchronous dataset delivery, validating data with Zod schemas, and tracking execution metadata for health monitoring.

---

## 1. Environment Variables

Configure the following variables in your `.env` / `.env.local` file (see `.env.example`):

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `BRIGHTDATA_API_KEY` | **Yes** | — | Bearer token for Bright Data API authentication. |
| `BRIGHTDATA_BASE_URL` | No | `https://api.brightdata.com` | Base URL for Bright Data API endpoints. |
| `BRIGHTDATA_POLL_INTERVAL_MS` | No | `2000` | Delay in ms between dataset poll attempts. |
| `BRIGHTDATA_POLL_TIMEOUT_MS` | No | `120000` | Max duration in ms to poll before timing out. |
| `BRIGHTDATA_OPENAI_COLLECTOR_ID`| No | `c_msx3bqlyjtv2qustx` | Production Scraper Studio collector ID for OpenAI pricing. |
| `OPENAI_PRICING_SOURCE_URL` | No | `https://developers.openai.com/api/docs/pricing` | Target documentation URL scraped by the collector. |

---

## 2. Public API Reference

The adapter is exported from `lib/brightdata`:

```typescript
import {
  BrightDataClient,
  fetchOpenAIPricing,
  OpenAIPricingRecordSchema,
  parseOpenAIPricingRecord,
  parseOpenAIPricingRecords,
  BrightDataError,
  BrightDataAuthError,
  BrightDataRateLimitError,
  BrightDataTimeoutError,
  BrightDataCollectorError,
  BrightDataParseError,
  BrightDataConfigError,
} from "@/lib/brightdata";
import type {
  BrightDataClientConfig,
  CollectorRunMetadata,
  CollectorRunResult,
  OpenAIPricingRecord,
} from "@/lib/brightdata";
```

### `BrightDataClient`

Reusable client managing authentication, collector triggering (`POST /dca/trigger`), dataset polling (`GET /dca/dataset`), and run metadata tracking.

- **`BrightDataClient.fromEnv(overrides?)`**: Instantiate with process environment variables.
- **`triggerCollector(optionsOrId, inputs?)`**: Trigger collector asynchronously, returns `{ runId: string }`.
- **`pollDataset(runId, options?)`**: Poll dataset endpoint until records are ready, handles intermediate states (`building`, `running`), returns raw record array.
- **`runCollector(options)`**: Executes trigger -> poll -> parse pipeline and returns `CollectorRunResult<T>`.

### `fetchOpenAIPricing(options?)`

Specialized runner for OpenAI pricing data.

```typescript
const result = await fetchOpenAIPricing({
  collectorId?: string,
  sourceUrl?: string,
  pollTimeoutMs?: number,
  onProgress?: (progress) => console.log(progress),
});

if (result.success) {
  console.log(`Fetched ${result.data.length} models:`, result.data);
  console.log("Run metadata:", result.metadata);
} else {
  console.error("Ingestion failed:", result.metadata.error);
}
```

### Run Metadata Structure

Every execution records structured metadata useful for observability:

```typescript
interface CollectorRunMetadata {
  collectorId: string;       // e.g. "c_msx3bqlyjtv2qustx"
  runId?: string;            // e.g. "j_abc123"
  startedAt: string;         // ISO 8601 timestamp
  completedAt: string;       // ISO 8601 timestamp
  durationMs: number;        // Elapsed runtime
  resultCount: number;       // Number of valid parsed records
  status: "success" | "failed" | "timeout";
  error?: string;            // Error description on failure
}
```

---

## 3. Running Ingestion Script

Run the OpenAI pricing ingestion script directly:

```bash
# Display help and options
node scripts/ingestion/trigger-openai-pricing.ts --help

# Run with environment variables
node --env-file=.env scripts/ingestion/trigger-openai-pricing.ts

# Output pure JSON
node --env-file=.env scripts/ingestion/trigger-openai-pricing.ts --json
```

---

## 4. Extending for Future Providers (Anthropic, Google, xAI)

To add a new provider collector:
1. Define the Zod record schema in `lib/brightdata/schemas.ts` (or a dedicated schema file).
2. Create a helper in `lib/brightdata/collectors/<provider>.ts`:
   ```typescript
   export async function fetchAnthropicPricing(options?: FetchProviderOptions) {
     const client = options?.client ?? BrightDataClient.fromEnv();
     return client.runCollector<InputType, AnthropicPricingRecord>({
       collectorId: options?.collectorId || process.env.BRIGHTDATA_ANTHROPIC_COLLECTOR_ID || DEFAULT_ID,
       inputs: [{ url: options?.sourceUrl || DEFAULT_URL }],
       parser: parseAnthropicPricingRecord,
       ...options,
     });
   }
   ```
3. Export from `lib/brightdata/index.ts`.

---

## 5. Development Fallback: Bright Data CLI

For interactive debugging during development:
```bash
npm install -g @brightdata/cli
bdata auth --token <YOUR_TOKEN>
bdata scraper trigger c_msx3bqlyjtv2qustx
```

*Note: The production runtime uses the HTTP adapter (`BrightDataClient`) and does not shell out to CLI.*

---

## 6. Integration Lane Hand-off Notes

When merging with persistence (Supabase) and contract lanes:
- The adapter returns clean typed `OpenAIPricingRecord[]` objects and `CollectorRunMetadata`.
- The database lane can map `OpenAIPricingRecord` into the target pricing table.
- The monitoring lane can write `CollectorRunMetadata` directly into run health logs / audit tables.
