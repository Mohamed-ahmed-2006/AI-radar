/**
 * Grounded Ask AI Radar result: what the UI (and tests) read after a question
 * has been planned and executed against trusted evidence.
 *
 * The interpretation layer never contributes a fact. Every number, model name
 * and date in `answerSummary` is supposed to appear in `structured` or
 * `calculations`, and `groundedness` is the check that they do. When they do
 * not, the executor replaces the summary with a fallback assembled only from
 * the structured result.
 */

import type { EvidenceBundle } from "../intelligence/contracts";
import type { ProvenanceView } from "../product/provenance";
import type {
  ProviderChoice,
  StackOptimizerResult,
} from "../optimizer";
import type {
  ConstraintUsed,
  IntentKind,
  QueryPlan,
  UnsupportedReason,
} from "./intent";

export interface AskCalculation {
  label: string;
  expression: string | null;
  result: string;
  note: string | null;
}

export interface AskEvidenceFreshness {
  oldestObservedAt: string | null;
  newestObservedAt: string | null;
  maxAgeMinutes: number | null;
}

export interface AskGroundedness {
  isGrounded: boolean;
  violations: string[];
  unsupportedPrices: string[];
  unsupportedDates: string[];
  groundedFactsCount: number;
  /** True when the published summary was replaced by a structured fallback. */
  sanitized: boolean;
}

export type StructuredAskResults =
  | { kind: "temporal_change_query"; bundle: EvidenceBundle }
  | {
      kind: "model_filter_query";
      /**
       * Set when the question asked for a cheapest row. Ranking then uses the
       * optimizer over a 1M/1M unit workload so published prices stay comparable
       * without inventing a monthly bill.
       */
      optimizer: StackOptimizerResult | null;
      unitPriceComparison: boolean;
      eligibleCount: number;
      totalConsidered: number;
    }
  | { kind: "workload_optimizer_query"; optimizer: StackOptimizerResult }
  | {
      kind: "comparison_query";
      optimizer: StackOptimizerResult;
      choices: ProviderChoice[];
    }
  | {
      kind: "unsupported";
      reason: UnsupportedReason;
      detail: string;
      missing: string[];
    };

export interface GroundedAskResult {
  question: string;
  interpretedIntent: IntentKind;
  plan: QueryPlan;
  constraints: ConstraintUsed[];
  answerSummary: string;
  structured: StructuredAskResults;
  calculations: AskCalculation[];
  evidenceFreshness: AskEvidenceFreshness;
  provenance: ProvenanceView[];
  missingEvidence: string[];
  unsupportedEvidence: string[];
  groundedness: AskGroundedness;
  generatedAt: string;
  /** Identifies the interpreter that compiled the question, for replay. */
  interpreter: string;
}
