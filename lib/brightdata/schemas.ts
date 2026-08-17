import { BrightDataParseError } from "./errors";
import {
  RawBrightDataPricingRecordSchema,
  type RawBrightDataPricingRecord,
} from "../contracts";

/**
 * Compatibility export for callers that previously imported this from the
 * Bright Data adapter. The schema is deliberately owned by `lib/contracts`.
 */
export const OpenAIPricingRecordSchema = RawBrightDataPricingRecordSchema;
export type OpenAIPricingRecord = RawBrightDataPricingRecord;

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
 * Safely parse an array of OpenAI pricing records. The ingestion pipeline uses
 * `safeParse` per record so one malformed result does not discard valid ones.
 */
export function parseOpenAIPricingRecords(rawList: unknown): OpenAIPricingRecord[] {
  if (!Array.isArray(rawList)) {
    throw new BrightDataParseError("Expected an array of records from collector output", rawList);
  }

  return rawList.map((item, index) => parseOpenAIPricingRecord(item, index));
}
