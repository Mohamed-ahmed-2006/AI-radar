import { z } from "zod";
import { BrightDataParseError } from "./errors";

/**
 * Zod Schema for OpenAI Pricing Record emitted by Bright Data Scraper Studio Collector
 */
export const OpenAIPricingRecordSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional().default({}),
  provider: z.string().min(1, "Provider name is required"),
  model_name: z.string().min(1, "Model name is required"),
  pricing_mode: z.string().optional().default("standard"),
  context_tier: z.string().optional().default("standard"),
  input_price_per_1m_tokens: z.coerce.number().nonnegative(),
  cached_input_price_per_1m_tokens: z.coerce.number().nonnegative().nullable().optional(),
  cache_write_price_per_1m_tokens: z.coerce.number().nonnegative().nullable().optional(),
  output_price_per_1m_tokens: z.coerce.number().nonnegative(),
  pricing_unit: z.string().min(1).default("USD per 1M tokens"),
  source_url: z.string().url().default("https://developers.openai.com/api/docs/pricing"),
});

export type OpenAIPricingRecord = z.infer<typeof OpenAIPricingRecordSchema>;

/**
 * Safely parse a single OpenAI pricing record.
 */
export function parseOpenAIPricingRecord(raw: unknown, index?: number): OpenAIPricingRecord {
  const result = OpenAIPricingRecordSchema.safeParse(raw);
  if (!result.success) {
    const errorMessages = result.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join(", ");
    const prefix = typeof index === "number" ? `Record at index ${index}` : "Record";
    throw new BrightDataParseError(
      `${prefix} failed schema validation: ${errorMessages}`,
      raw,
      result.error.issues
    );
  }
  return result.data;
}

/**
 * Safely parse an array of OpenAI pricing records.
 */
export function parseOpenAIPricingRecords(rawList: unknown): OpenAIPricingRecord[] {
  if (!Array.isArray(rawList)) {
    throw new BrightDataParseError("Expected an array of records from collector output", rawList);
  }

  return rawList.map((item, index) => parseOpenAIPricingRecord(item, index));
}
