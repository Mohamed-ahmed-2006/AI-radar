import type { SentinelReasonCode } from "./types";

/**
 * Display copy for the backend's reason codes. The code itself is always shown
 * alongside the prose, so an unmapped future code still renders usefully.
 */
const REASON_CODE_COPY: Record<
  SentinelReasonCode,
  { title: string; description: string }
> = {
  SCHEMA_VALIDATION_FAILURE: {
    title: "Schema validation failure",
    description:
      "Records did not match the source contract, so the run could not be trusted as a whole.",
  },
  RECORD_COUNT_COLLAPSE: {
    title: "Record count collapse",
    description:
      "Far fewer records arrived than the last-known-good run — the signature of a broken selector rather than a real change.",
  },
  RECORD_COUNT_SPIKE: {
    title: "Record count spike",
    description:
      "Many more records arrived than expected, suggesting duplicated or mis-scoped extraction.",
  },
  ZERO_RECORDS: {
    title: "Zero records returned",
    description: "The collector completed but produced nothing to validate.",
  },
  DUPLICATE_IDENTIFIERS: {
    title: "Duplicate identifiers",
    description:
      "The same record identity appeared more than once. Conflicting rows are refused; trusted distinct records continue to be admitted.",
  },
  ILLEGAL_ENUM_VALUE: {
    title: "Illegal enum value",
    description:
      "A field carried a value outside its allowed domain, such as an unknown lifecycle state.",
  },
  ALL_PRICES_NULL: {
    title: "All prices null",
    description:
      "Every priced field extracted as null. A uniform null across all models is a scrape failure, not a price change.",
  },
  SEMANTIC_INVARIANT_VIOLATION: {
    title: "Semantic invariant violation",
    description:
      "The batch broke a domain rule the data must always satisfy, such as a monotonic lifecycle transition.",
  },
  CAPABILITY_TOKEN_LIMITS_MISSING: {
    title: "Capability token limits missing",
    description:
      "Every record in the batch lost its context window or max output figure at once. A source that publishes those limits per model cannot drop all of them in one run, so the batch is treated as an extraction fault rather than a capability change.",
  },
  STALE_SOURCE: {
    title: "Stale source",
    description:
      "The source has not produced a successful run within its expected freshness window.",
  },
  COLLECTOR_EXECUTION_FAILURE: {
    title: "Collector execution failure",
    description: "The collector itself failed before returning a payload.",
  },
};

export function reasonCodeTitle(code: SentinelReasonCode): string {
  return REASON_CODE_COPY[code]?.title ?? code.replaceAll("_", " ").toLowerCase();
}

export function reasonCodeDescription(code: SentinelReasonCode): string | null {
  return REASON_CODE_COPY[code]?.description ?? null;
}
