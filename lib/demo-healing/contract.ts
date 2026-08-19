/**
 * Data contract and Sentinel health contract for the demo source.
 *
 * This is an ordinary source contract built with the same
 * `createSourceHealthContract` factory the production pricing, lifecycle and
 * catalog sources use. Nothing about it is demo-specific except the shape of
 * the records: it is evaluated by the same `evaluateSourceHealth` and enforced
 * by the same `evaluateSentinelGate`.
 */

import { z } from "zod";

import { createSourceHealthContract } from "../sentinel/contracts";
import type {
  SemanticInvariantCheckResult,
  SourceHealthContract,
} from "../sentinel/types";

/**
 * One quotation as the healthy collector template emits it.
 *
 * The fields are deliberately strict. A collector whose selectors have stopped
 * matching does not emit "slightly worse" records — it emits empty strings,
 * nulls, or whole chunks of table markup, and every one of those is rejected
 * here rather than absorbed.
 */
export const RawDemoQuoteRecordSchema = z
  .object({
    quote_text: z
      .string()
      .trim()
      .min(12, "quote_text is too short to be a real quotation")
      .max(1000, "quote_text is too long to be a single quotation")
      .refine(
        (value) => !/<\/?[a-z][\s\S]*>/i.test(value),
        "quote_text contains raw HTML markup, which means the selector matched a container",
      ),
    author: z
      .string()
      .trim()
      .min(3, "author is too short to be a real name")
      .max(120, "author is too long to be a name")
      .refine(
        (value) => !/<\/?[a-z][\s\S]*>/i.test(value),
        "author contains raw HTML markup",
      ),
    tags: z.array(z.string().trim().min(1)).default([]),
  })
  .passthrough();

export type RawDemoQuoteRecord = z.infer<typeof RawDemoQuoteRecordSchema>;

/**
 * Tolerates the field-name variants an AI-generated template legitimately
 * produces, without tolerating missing data. Renaming is normalisation;
 * absence is a contract failure.
 */
export function adaptDemoQuoteRecord(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
  };

  const tags = pick("tags", "tag_list", "keywords", "topics");
  return {
    ...record,
    quote_text: pick("quote_text", "quote", "text", "quotation", "content"),
    author: pick("author", "author_name", "attributed_to", "by"),
    tags: Array.isArray(tags)
      ? tags.map((tag) => String(tag))
      : typeof tags === "string"
        ? tags.split(",").map((tag) => tag.trim()).filter(Boolean)
        : [],
  };
}

/** Deterministic identity for a quotation. */
export function demoQuoteIdentity(record: RawDemoQuoteRecord): string {
  return `${record.author.toLowerCase()}::${record.quote_text.slice(0, 80).toLowerCase()}`;
}

export const DEMO_MIN_VIABLE_RECORDS = 5;

/**
 * Health contract for the demo source.
 *
 * `quarantineThresholdPercentage: 0` makes this a strict source: a single
 * malformed record refuses the whole payload. That is the correct posture for
 * a source whose only failure mode is "the template stopped matching", and it
 * makes the demo's quarantine decision unambiguous.
 */
export function createDemoSourceHealthContract(
  sourceId = "sentinel-demo-quotes",
): SourceHealthContract<RawDemoQuoteRecord> {
  return createSourceHealthContract<RawDemoQuoteRecord>({
    sourceId,
    sourceCategory: "other",
    authorityDomain: "catalog",
    isAuthoritative: false,
    requiredFields: ["quote_text", "author"],
    minViableRecords: DEMO_MIN_VIABLE_RECORDS,
    recordCountDrift: {
      minExpectedCount: DEMO_MIN_VIABLE_RECORDS,
      maxDropPercentage: 0.35,
      maxSpikePercentage: 3.0,
    },
    sourceFreshness: { maxStalenessMinutes: 1440 },
    failurePolicy: {
      maxHealingAttempts: 3,
      autoHeal: true,
      quarantineThresholdPercentage: 0,
    },
    extractKey: demoQuoteIdentity,
    validateRecord: (raw) => {
      try {
        const result = RawDemoQuoteRecordSchema.safeParse(adaptDemoQuoteRecord(raw));
        if (!result.success) {
          return {
            success: false,
            issues: result.error.issues.map(
              (issue) => `[${issue.path.join(".") || "root"}] ${issue.message}`,
            ),
          };
        }
        return { success: true, data: result.data };
      } catch (error) {
        return {
          success: false,
          issues: [error instanceof Error ? error.message : String(error)],
        };
      }
    },
    validateSemanticInvariants: (records): SemanticInvariantCheckResult[] => {
      const results: SemanticInvariantCheckResult[] = [];
      if (records.length === 0) return results;

      // A template that has lost its per-item selector commonly latches onto
      // one page-level node and repeats it. Distinct text proves it did not.
      const distinctText = new Set(records.map((record) => record.quote_text.trim()));
      if (distinctText.size === 1 && records.length > 1) {
        results.push({
          passed: false,
          code: "SEMANTIC_INVARIANT_VIOLATION",
          reason: `All ${records.length} extracted records share one identical quote_text, which means the item selector is matching a container rather than each quote.`,
        });
      }

      const distinctAuthors = new Set(records.map((record) => record.author.trim().toLowerCase()));
      if (distinctAuthors.size === 1 && records.length > 2) {
        results.push({
          passed: false,
          code: "SEMANTIC_INVARIANT_VIOLATION",
          reason: `All ${records.length} extracted records report the same author, which means the author selector is not scoped to each quote.`,
        });
      }

      return results;
    },
  });
}

/**
 * Contract used to judge a Bright Data healing *preview*.
 *
 * A preview is a small sample of what the repaired template would produce —
 * Bright Data returns a couple of records, and long values are elided for
 * display. Judging that sample against the full-run volume thresholds would
 * reject every candidate, including correct ones, for the wrong reason.
 *
 * So exactly one thing is relaxed: how many records constitute a viable batch.
 * The record schema, the identity extraction and the semantic invariants — the
 * checks that actually distinguish a repaired template from a broken one — are
 * the same objects the live contract uses.
 *
 * This is a pre-approval screen, not a substitute for the gate. The repaired
 * collector's full output still goes through `evaluateSentinelGate` on the
 * verifying re-run, with the volume rules in force.
 */
export function createDemoPreviewContract(
  sourceId = "sentinel-demo-quotes",
): SourceHealthContract<RawDemoQuoteRecord> {
  const live = createDemoSourceHealthContract(sourceId);
  return {
    ...live,
    minViableRecords: 1,
    recordCountDrift: {
      // A sample is not a collapse. Drift is judged on the re-run, not here.
      minExpectedCount: Number.MAX_SAFE_INTEGER,
      maxDropPercentage: 1,
      maxSpikePercentage: Number.MAX_SAFE_INTEGER,
    },
  };
}
