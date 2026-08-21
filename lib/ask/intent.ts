/**
 * The query planner: natural language in, a closed typed intent out.
 *
 * This module is the only place where free text is read, and it is incapable
 * of answering anything. It produces a `QueryPlan` — a discriminated union of
 * intents the deterministic executor already knows how to run — and nothing
 * else. There is no SQL here, no query string assembled from user text, and no
 * field a question can populate that the schema does not already declare.
 *
 * That closure is the safety property. An interpretation layer can be wrong
 * about what a question meant; it cannot be wrong about a model fact, because
 * it never states one. Every number in a final answer comes from the executor
 * reading canonical evidence, and a question the planner cannot compile
 * becomes `unsupported` rather than a guess.
 *
 * The default interpreter is rule-based and therefore deterministic: the same
 * question always compiles to the same plan. `IntentInterpreter` exists so a
 * model-backed interpreter can be substituted later — but it would still emit
 * only a plan, still be validated against `QueryPlanSchema`, and still be
 * incapable of contributing a fact to the answer.
 */

import { z } from "zod";

import {
  EvidenceCategorySchema,
  RelativeDateRangeSchema,
} from "../intelligence/contracts";

// ---------------------------------------------------------------------------
// The typed intent vocabulary
// ---------------------------------------------------------------------------

export const IntentKindSchema = z.enum([
  "temporal_change_query",
  "model_fact_query",
  "model_filter_query",
  "workload_optimizer_query",
  "comparison_query",
  "unsupported",
]);

export type IntentKind = z.infer<typeof IntentKindSchema>;

export const WorkloadSchema = z.object({
  monthlyInputTokens: z.number().finite().nonnegative(),
  monthlyOutputTokens: z.number().finite().nonnegative(),
});

/** Constraints the executor may receive. Nothing outside this list is reachable. */
export const SelectionConstraintsSchema = z.object({
  providers: z.array(z.string().min(1)).default([]),
  minContextWindow: z.number().int().positive().nullable().default(null),
  minMaxOutputTokens: z.number().int().positive().nullable().default(null),
  visionRequired: z.boolean().default(false),
  toolCallingRequired: z.boolean().default(false),
  activeOnly: z.boolean().default(false),
  excludeProviders: z.array(z.string().min(1)).default([]),
  excludeModelIds: z.array(z.string().min(1)).default([]),
});

export type SelectionConstraints = z.infer<typeof SelectionConstraintsSchema>;

export const TemporalChangeIntentSchema = z.object({
  kind: z.literal("temporal_change_query"),
  provider: z.string().min(1).nullable().default(null),
  family: z.string().min(1).nullable().default(null),
  model: z.string().min(1).nullable().default(null),
  range: RelativeDateRangeSchema,
  categories: z.array(EvidenceCategorySchema).default([]),
});

export const ModelFilterIntentSchema = z.object({
  kind: z.literal("model_filter_query"),
  constraints: SelectionConstraintsSchema,
  /**
   * Present when the question asked for a single best row. Without a workload
   * the only defensible reading of "cheapest" is the published unit price, and
   * the answer says so rather than implying a bill.
   */
  superlative: z.enum(["cheapest_unit_price"]).nullable().default(null),
  limit: z.number().int().positive().max(100).default(25),
});

export const WorkloadOptimizerIntentSchema = z.object({
  kind: z.literal("workload_optimizer_query"),
  workload: WorkloadSchema,
  constraints: SelectionConstraintsSchema,
  priority: z
    .enum(["lowest_total_cost", "lowest_input_cost", "lowest_output_cost"])
    .default("lowest_total_cost"),
  limit: z.number().int().positive().max(100).default(10),
});

export const ComparisonIntentSchema = z.object({
  kind: z.literal("comparison_query"),
  workload: WorkloadSchema,
  constraints: SelectionConstraintsSchema,
  /** The providers to place side by side, in the order the question named them. */
  compareProviders: z.array(z.string().min(1)).min(2),
  priority: z
    .enum(["lowest_total_cost", "lowest_input_cost", "lowest_output_cost"])
    .default("lowest_total_cost"),
});

/**
 * The observed fields a `model_fact_query` may ask about.
 *
 * A closed list, and deliberately a short one. Every entry names a field the
 * canonical read model already publishes with its own provenance, so answering
 * one is a lookup rather than a generation. A question about anything outside
 * this list does not compile, which is what keeps Ask from drifting into a
 * chatbot that answers model trivia from pretrained memory.
 */
export const ModelFactFieldSchema = z.enum([
  "context_window",
  "max_output_tokens",
  "input_price",
  "output_price",
  "price",
  "vision",
  "tool_calling",
  "input_modality",
  "output_modality",
  "lifecycle",
]);

export type ModelFactField = z.infer<typeof ModelFactFieldSchema>;

export const ModelFactModalitySchema = z.enum(["text", "image", "audio", "video"]);
export type ModelFactModality = z.infer<typeof ModelFactModalitySchema>;

export const ModelFactIntentSchema = z.object({
  kind: z.literal("model_fact_query"),
  /**
   * The model phrase lifted from the question, verbatim. It is a *query*, not
   * an identity: the planner has no database and never decides which canonical
   * model this is. The executor resolves it, and fails closed when it resolves
   * to no model or to more than one.
   */
  modelQuery: z.string().min(1),
  field: ModelFactFieldSchema,
  /** Set only for `input_modality` / `output_modality`. */
  modality: ModelFactModalitySchema.nullable().default(null),
});

export const UnsupportedReasonSchema = z.enum([
  "no_recognized_intent",
  "missing_workload",
  "insufficient_constraints",
  /** The model phrase matched no canonical model AI Radar has observed. */
  "unresolved_model",
  /** The model phrase matched several canonical models. */
  "ambiguous_model",
]);

export type UnsupportedReason = z.infer<typeof UnsupportedReasonSchema>;

export const UnsupportedIntentSchema = z.object({
  kind: z.literal("unsupported"),
  reason: UnsupportedReasonSchema,
  detail: z.string().min(1),
  /** What the question would need to supply to become answerable. */
  missing: z.array(z.string().min(1)).default([]),
});

export const QueryIntentSchema = z.discriminatedUnion("kind", [
  TemporalChangeIntentSchema,
  ModelFactIntentSchema,
  ModelFilterIntentSchema,
  WorkloadOptimizerIntentSchema,
  ComparisonIntentSchema,
  UnsupportedIntentSchema,
]);

export type QueryIntent = z.infer<typeof QueryIntentSchema>;
export type ModelFactIntent = z.infer<typeof ModelFactIntentSchema>;
export type TemporalChangeIntent = z.infer<typeof TemporalChangeIntentSchema>;
export type ModelFilterIntent = z.infer<typeof ModelFilterIntentSchema>;
export type WorkloadOptimizerIntent = z.infer<typeof WorkloadOptimizerIntentSchema>;
export type ComparisonIntent = z.infer<typeof ComparisonIntentSchema>;
export type UnsupportedIntent = z.infer<typeof UnsupportedIntentSchema>;

/** Where a constraint came from: the question, the caller, or a stated default. */
export const ConstraintSourceSchema = z.enum(["question", "caller", "default"]);

export const ConstraintUsedSchema = z.object({
  field: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  source: ConstraintSourceSchema,
  /** The phrase in the question that produced it, when there was one. */
  evidence: z.string().nullable().default(null),
});

export type ConstraintUsed = z.infer<typeof ConstraintUsedSchema>;

export const QueryPlanSchema = z.object({
  question: z.string(),
  intent: QueryIntentSchema,
  constraints: z.array(ConstraintUsedSchema),
  /** Identifies the interpreter, so a stored answer can be re-derived. */
  interpreter: z.string().min(1),
  /** Recognised as meaningful but not compiled into any constraint. */
  unresolvedTerms: z.array(z.string()),
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;

// ---------------------------------------------------------------------------
// Lexical extraction
// ---------------------------------------------------------------------------

const UNIT_MULTIPLIERS: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };

function toQuantity(digits: string, unit: string | undefined): number | null {
  const cleaned = digits.replace(/[,_\s]/g, "");
  const base = Number(cleaned);
  if (!Number.isFinite(base)) return null;
  const multiplier = unit ? UNIT_MULTIPLIERS[unit.toLowerCase()] ?? 1 : 1;
  return Math.round(base * multiplier);
}

interface Extracted {
  value: number;
  evidence: string;
}

/** Runs patterns in order and returns the first quantity any of them yields. */
function firstQuantity(text: string, patterns: readonly RegExp[]): Extracted | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const value = toQuantity(match[1], match[2]);
    if (value === null || value <= 0) continue;
    return { value, evidence: match[0].trim() };
  }
  return null;
}

const NUM = String.raw`(\d[\d,._]*)\s*([kmb])?`;

const INPUT_TOKEN_PATTERNS = [
  new RegExp(String.raw`${NUM}\s*(?:input|in)\b(?:\s*tokens?)?`, "i"),
  new RegExp(String.raw`input(?:\s*tokens?)?\s*(?:of|:|=|is)?\s*${NUM}`, "i"),
];

const OUTPUT_TOKEN_PATTERNS = [
  new RegExp(String.raw`${NUM}\s*(?:output|out)\b(?:\s*tokens?)?`, "i"),
  new RegExp(String.raw`output(?:\s*tokens?)?\s*(?:of|:|=|is)?\s*${NUM}`, "i"),
];

const CONTEXT_PATTERNS = [
  new RegExp(
    String.raw`context(?:\s*window)?\s*(?:>=|≥|>|of|at\s+least|:|=)?\s*${NUM}`,
    "i",
  ),
  new RegExp(String.raw`${NUM}\s*\+?\s*(?:token\s*)?context`, "i"),
];

const MAX_OUTPUT_PATTERNS = [
  new RegExp(
    String.raw`max(?:imum)?\s*output(?:\s*tokens?)?\s*(?:>=|≥|>|of|at\s+least|:|=)?\s*${NUM}`,
    "i",
  ),
  new RegExp(String.raw`${NUM}\s*max(?:imum)?\s*output`, "i"),
];

interface ProviderAlias {
  slug: string;
  patterns: RegExp[];
}

/**
 * Provider recognition is a fixed table, not a lookup against user text. A
 * name AI Radar does not track is reported as unresolved rather than passed
 * through to a query.
 */
const PROVIDER_ALIASES: readonly ProviderAlias[] = [
  { slug: "openai", patterns: [/\bopenai\b/i, /\bgpt\b/i, /\bchatgpt\b/i] },
  { slug: "anthropic", patterns: [/\banthropic\b/i, /\bclaude\b/i] },
  { slug: "google", patterns: [/\bgoogle\b/i, /\bgemini\b/i] },
  { slug: "xai", patterns: [/\bxai\b/i, /\bx\.ai\b/i, /\bgrok\b/i] },
];

function detectProviders(text: string): Array<{ slug: string; evidence: string }> {
  const found: Array<{ slug: string; evidence: string }> = [];
  for (const alias of PROVIDER_ALIASES) {
    for (const pattern of alias.patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      found.push({ slug: alias.slug, evidence: match[0] });
      break;
    }
  }
  // Ordered by first mention, so a comparison reads in the question's order.
  return found.sort(
    (left, right) =>
      text.toLowerCase().indexOf(left.evidence.toLowerCase()) -
      text.toLowerCase().indexOf(right.evidence.toLowerCase()),
  );
}

const VISION_PATTERN = /\bvision\b|\bimage input\b|\bmultimodal\b/i;
const TOOL_PATTERN = /\btools?\b|\btool[-\s]?calling\b|\bfunction[-\s]?call/i;
const ACTIVE_PATTERN = /\bactive\b|\bnot deprecated\b|\bcurrently available\b|\bin production\b/i;
const CHEAPEST_PATTERN = /\bcheapest\b|\bleast expensive\b|\blowest[-\s]cost\b|\bcheaper\b/i;
const COMPARE_PATTERN = /\bcompare\b|\bcomparison\b|\bversus\b|\bvs\.?\b|\bside[-\s]by[-\s]side\b/i;
const COST_PATTERN = /\bcost\b|\bspend\b|\bbill\b|\bbudget\b|\bworkload\b|\bper month\b|\bmonthly\b/i;
const SELECTION_PATTERN =
  /\bwhich models?\b|\bwhat models?\b|\blist models?\b|\bmodels? (?:that|with|support)\b|\bsupport\b/i;

/**
 * A change verb, not merely a past tense. These are the words that make a
 * question about the timeline rather than about the current catalog, which is
 * what keeps "what changed this month" apart from "what is cheapest today".
 */
const TEMPORAL_CHANGE_PATTERN =
  /\bchang(?:e|ed|es|ing)\b|\bhappened\b|\bdeprecat\w*\b|\bretir\w*\b|\bannounc\w*\b|\breleas\w*\b|\blaunch\w*\b|\bnew models?\b|\bupdated?\b|\bshut ?down\b|\bend[- ]of[- ]life\b|\beol\b/i;

const TEMPORAL_WINDOW_PATTERN =
  /\bthis (?:week|month|year|quarter)\b|\blast (?:week|month|year|quarter|\d+ days?)\b|\bpast (?:week|month|year|quarter|\d+ days?)\b|\btoday\b|\brecently\b|\bsince\b|\byesterday\b|\b\d+\s*(?:d|days?|h|hours?)\b/i;

const INPUT_PRIORITY_PATTERN = /\binput (?:cost|price|spend)\b|\bcheapest input\b/i;
const OUTPUT_PRIORITY_PATTERN = /\boutput (?:cost|price|spend)\b|\bcheapest output\b/i;

// ---------------------------------------------------------------------------
// Temporal range and category parsing
// ---------------------------------------------------------------------------

type RelativeRange = z.infer<typeof RelativeDateRangeSchema>;

const RANGE_RULES: ReadonlyArray<{ range: RelativeRange; pattern: RegExp }> = [
  { range: "24h", pattern: /\btoday\b|\blast 24\b|\b24h\b|\bpast day\b/i },
  { range: "7d", pattern: /\bthis week\b|\blast 7\b|\b7d\b|\bpast week\b|\blast week\b/i },
  { range: "14d", pattern: /\b2 weeks\b|\b14d\b|\bfortnight\b/i },
  { range: "30d", pattern: /\bthis month\b|\blast 30\b|\b30d\b|\bpast month\b|\blast month\b|\brecently\b/i },
  { range: "60d", pattern: /\b60 days\b|\b2 months\b/i },
  { range: "90d", pattern: /\b90 days\b|\bquarter\b|\b3 months\b/i },
  { range: "180d", pattern: /\b180 days\b|\b6 months\b/i },
  { range: "ytd", pattern: /\bthis year\b|\byear to date\b|\bytd\b/i },
  { range: "all", pattern: /\ball time\b|\bever\b|\bfull history\b/i },
];

type EvidenceCategory = z.infer<typeof EvidenceCategorySchema>;

const CATEGORY_RULES: ReadonlyArray<{
  categories: EvidenceCategory[];
  pattern: RegExp;
}> = [
  { categories: ["pricing"], pattern: /\bpric\w*\b|\bcost\b|\brate\b|\bcheaper\b/i },
  {
    categories: ["deprecations", "retirements"],
    pattern: /\bdeprecat\w*\b|\bretir\w*\b|\bshut ?down\b|\bend[- ]of[- ]life\b|\beol\b/i,
  },
  { categories: ["catalog"], pattern: /\blaunch\w*\b|\bnew models?\b|\breleas\w*\b|\badded\b/i },
  { categories: ["replacements"], pattern: /\breplace\w*\b|\bmigrat\w*\b|\balternative\b/i },
];

const FAMILY_RULES: ReadonlyArray<{ family: string; pattern: RegExp }> = [
  { family: "claude", pattern: /\bclaude\b/i },
  { family: "gemini", pattern: /\bgemini\b/i },
  { family: "gpt", pattern: /\bgpt\b/i },
  { family: "grok", pattern: /\bgrok\b/i },
];

// ---------------------------------------------------------------------------
// Model-fact extraction
// ---------------------------------------------------------------------------

/**
 * Words a model name can begin with. Recognising a name lexically is not the
 * same as knowing a model: this list only decides *where a phrase starts*, and
 * every phrase it produces is handed to the executor to resolve against the
 * canonical catalog. `GPT-6` is extracted exactly as readily as `Claude Opus 5`
 * — and then fails to resolve, which is the point.
 */
const MODEL_NAME_HEAD =
  /^(?:claude|gpt|gemini|grok|imagen|veo|lyria|o[1-9]|codex|deep-research|antigravity)(?:[.\-_][a-z0-9.\-_]*)?$/i;

/**
 * Words that continue a model name once one has started. Restricting the
 * continuation is what stops "Claude this month" from being read as a model
 * called "Claude this month": a token that is not a version number or a known
 * name part ends the phrase.
 */
const MODEL_NAME_PART =
  /^(?:\d[\w.\-]*|opus|sonnet|haiku|fable|mythos|flash|pro|lite|mini|nano|turbo|ultra|image|audio|tts|live|embedding|robotics|realtime|native|computer|use|preview|exp|experimental|instruct|thinking|latest|max|codex|research)$/i;

/** Splits a question into tokens that keep the characters model ids use. */
function modelTokens(text: string): string[] {
  return text
    .split(/[^\w.\-']+/)
    .map((token) => token.replace(/'s$/i, "").replace(/^[-.]+|[-.]+$/g, ""))
    .filter(Boolean);
}

/**
 * The longest model-shaped phrase in the question, or null.
 *
 * Only the first phrase is returned. A question that names two models is a
 * comparison, and the routing above `model_fact_query` has already claimed it.
 */
export function extractModelPhrase(text: string): string | null {
  const tokens = modelTokens(text);
  for (let index = 0; index < tokens.length; index += 1) {
    if (!MODEL_NAME_HEAD.test(tokens[index])) continue;
    const phrase = [tokens[index]];
    let cursor = index + 1;
    while (cursor < tokens.length && MODEL_NAME_PART.test(tokens[cursor])) {
      phrase.push(tokens[cursor]);
      cursor += 1;
    }
    return phrase.join(" ");
  }
  return null;
}

/**
 * Which observed field the question is about.
 *
 * Ordered, and the order carries meaning. "video input" must be read as a
 * modality question before "input" can be read as a price question, and "max
 * output" must be read as a token limit before "output" can be read as either.
 * A question that matches nothing here is not a model-fact question at all.
 */
const MODEL_FACT_RULES: ReadonlyArray<{
  field: ModelFactField;
  pattern: RegExp;
  modality?: ModelFactModality;
}> = [
  { field: "input_modality", pattern: /\btext\s*(?:as\s*)?input\b/i, modality: "text" },
  { field: "input_modality", pattern: /\bimage\s*(?:as\s*)?input\b/i, modality: "image" },
  { field: "input_modality", pattern: /\baudio\s*(?:as\s*)?input\b/i, modality: "audio" },
  { field: "input_modality", pattern: /\bvideo\s*(?:as\s*)?input\b/i, modality: "video" },
  { field: "input_modality", pattern: /\binput\s*(?:modality|modalities)\b/i },
  { field: "output_modality", pattern: /\btext\s*output\b/i, modality: "text" },
  { field: "output_modality", pattern: /\bimage\s*output\b/i, modality: "image" },
  { field: "output_modality", pattern: /\baudio\s*output\b/i, modality: "audio" },
  { field: "output_modality", pattern: /\bvideo\s*output\b/i, modality: "video" },
  { field: "output_modality", pattern: /\boutput\s*(?:modality|modalities)\b/i },
  { field: "max_output_tokens", pattern: /\bmax(?:imum)?[-\s]*output\b/i },
  { field: "context_window", pattern: /\bcontext(?:\s*(?:window|length|size))?\b/i },
  { field: "input_price", pattern: /\binput\s*(?:price|cost|pricing|rate)\b/i },
  { field: "output_price", pattern: /\boutput\s*(?:price|cost|pricing|rate)\b/i },
  { field: "price", pattern: /\bcost\b|\bprice\b|\bpricing\b|\bhow much\b/i },
  { field: "vision", pattern: /\bvision\b/i },
  {
    field: "tool_calling",
    pattern: /\btool[-\s]?(?:calling|use)\b|\bfunction[-\s]?call\w*\b|\btools\b/i,
  },
  {
    field: "lifecycle",
    pattern:
      /\bdeprecat\w*\b|\bretir\w*\b|\blifecycle\b|\bend[- ]of[- ]life\b|\beol\b|\bstill (?:available|active|supported)\b/i,
  },
];

interface ModelFactSignal {
  field: ModelFactField;
  modality: ModelFactModality | null;
  evidence: string;
  /** Where the field phrase sits, so it can be kept out of the model phrase. */
  index: number;
  length: number;
}

export function extractModelFactField(text: string): ModelFactSignal | null {
  for (const rule of MODEL_FACT_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    return {
      field: rule.field,
      modality: rule.modality ?? null,
      evidence: match[0].trim(),
      index: match.index,
      length: match[0].length,
    };
  }
  return null;
}

/**
 * The model phrase, read from a question with the field phrase masked out.
 *
 * Masking is what keeps the two extractions from eating each other. "Claude
 * Sonnet 5's max output" contains `max`, which is a legitimate part of model
 * names such as `deep-research-max-preview-04-2026`; without masking the phrase
 * runs on into "Claude Sonnet 5 max" and resolves to nothing. Removing the span
 * the field already claimed leaves each extraction reading only its own half of
 * the question, whichever order they appear in.
 */
export function extractModelPhraseFor(text: string, field: ModelFactSignal): string | null {
  const masked =
    text.slice(0, field.index) +
    " ".repeat(field.length) +
    text.slice(field.index + field.length);
  return extractModelPhrase(masked);
}

const MODEL_RULES: ReadonlyArray<{ model: string; pattern: RegExp }> = [
  { model: "sonnet", pattern: /\bsonnet\b/i },
  { model: "opus", pattern: /\bopus\b/i },
  { model: "haiku", pattern: /\bhaiku\b/i },
  { model: "flash", pattern: /\bflash\b/i },
];

// ---------------------------------------------------------------------------
// The deterministic interpreter
// ---------------------------------------------------------------------------

export interface PlanOptions {
  /**
   * A workload the caller already holds — typically the one a previous
   * optimizer request used. It lets "compare … for this workload" resolve,
   * and it is recorded with source `caller` so the answer never implies the
   * question stated it.
   */
  workload?: { monthlyInputTokens: number; monthlyOutputTokens: number };
  interpreter?: IntentInterpreter;
}

export interface IntentInterpreter {
  id: string;
  interpret(question: string, options: PlanOptions): QueryPlan;
}

interface ConstraintCollector {
  used: ConstraintUsed[];
  add(
    field: string,
    value: ConstraintUsed["value"],
    source: ConstraintUsed["source"],
    evidence: string | null,
  ): void;
}

function collector(): ConstraintCollector {
  const used: ConstraintUsed[] = [];
  return {
    used,
    add(field, value, source, evidence) {
      used.push({ field, value, source, evidence });
    },
  };
}

function readSelectionConstraints(
  question: string,
  found: ConstraintCollector,
  providers: ReadonlyArray<{ slug: string; evidence: string }>,
): SelectionConstraints {
  const context = firstQuantity(question, CONTEXT_PATTERNS);
  const maxOutput = firstQuantity(question, MAX_OUTPUT_PATTERNS);
  const vision = VISION_PATTERN.exec(question);
  const tools = TOOL_PATTERN.exec(question);
  const active = ACTIVE_PATTERN.exec(question);

  if (providers.length > 0) {
    found.add(
      "providers",
      providers.map((provider) => provider.slug),
      "question",
      providers.map((provider) => provider.evidence).join(", "),
    );
  }
  if (context) found.add("minContextWindow", context.value, "question", context.evidence);
  if (maxOutput) {
    found.add("minMaxOutputTokens", maxOutput.value, "question", maxOutput.evidence);
  }
  if (vision) found.add("visionRequired", true, "question", vision[0]);
  if (tools) found.add("toolCallingRequired", true, "question", tools[0]);
  if (active) found.add("activeOnly", true, "question", active[0]);

  return SelectionConstraintsSchema.parse({
    providers: providers.map((provider) => provider.slug),
    minContextWindow: context?.value ?? null,
    minMaxOutputTokens: maxOutput?.value ?? null,
    visionRequired: vision !== null,
    toolCallingRequired: tools !== null,
    activeOnly: active !== null,
  });
}

function readPriority(
  question: string,
  found: ConstraintCollector,
): "lowest_total_cost" | "lowest_input_cost" | "lowest_output_cost" {
  const input = INPUT_PRIORITY_PATTERN.exec(question);
  if (input) {
    found.add("priority", "lowest_input_cost", "question", input[0]);
    return "lowest_input_cost";
  }
  const output = OUTPUT_PRIORITY_PATTERN.exec(question);
  if (output) {
    found.add("priority", "lowest_output_cost", "question", output[0]);
    return "lowest_output_cost";
  }
  found.add("priority", "lowest_total_cost", "default", null);
  return "lowest_total_cost";
}

function readTemporalIntent(
  question: string,
  found: ConstraintCollector,
  providers: ReadonlyArray<{ slug: string; evidence: string }>,
): TemporalChangeIntent {
  let range: RelativeRange = "30d";
  let rangeEvidence: string | null = null;
  for (const rule of RANGE_RULES) {
    const match = rule.pattern.exec(question);
    if (!match) continue;
    range = rule.range;
    rangeEvidence = match[0];
    break;
  }
  found.add("range", range, rangeEvidence ? "question" : "default", rangeEvidence);

  const categories: EvidenceCategory[] = [];
  for (const rule of CATEGORY_RULES) {
    const match = rule.pattern.exec(question);
    if (!match) continue;
    for (const category of rule.categories) {
      if (!categories.includes(category)) categories.push(category);
    }
    found.add("categories", rule.categories, "question", match[0]);
  }

  const provider = providers[0]?.slug ?? null;
  if (provider) found.add("provider", provider, "question", providers[0].evidence);

  const family = FAMILY_RULES.find((rule) => rule.pattern.test(question))?.family ?? null;
  if (family) found.add("family", family, "question", family);

  const model = MODEL_RULES.find((rule) => rule.pattern.test(question))?.model ?? null;
  if (model) found.add("model", model, "question", model);

  return TemporalChangeIntentSchema.parse({
    kind: "temporal_change_query",
    provider,
    family,
    model,
    range,
    categories,
  });
}

/**
 * Compiles a question into a plan.
 *
 * Routing is ordered rather than scored, and the order encodes what a reader
 * would consider the more specific reading:
 *
 *   1. a stated workload with a comparison verb is a provider comparison
 *   2. a stated workload alone is an optimizer run
 *   3. a change verb or a bare time window is a temporal question
 *   4. a selection phrase is a catalog filter
 *   5. anything else is unsupported, and says what it could not read
 *
 * Step 3 sits above step 4 on purpose: "what models were deprecated this
 * month" names models but asks about the timeline, and answering it from the
 * current catalog would silently drop the "this month" the reader cared about.
 */
function interpretDeterministically(question: string, options: PlanOptions): QueryPlan {
  const text = question.trim();
  const found = collector();
  const unresolved: string[] = [];

  const providers = detectProviders(text);
  const input = firstQuantity(text, INPUT_TOKEN_PATTERNS);
  const output = firstQuantity(text, OUTPUT_TOKEN_PATTERNS);
  const wantsCost = CHEAPEST_PATTERN.test(text) || COST_PATTERN.test(text);
  const wantsComparison = COMPARE_PATTERN.test(text);

  const statedWorkload =
    (input || output) && wantsCost
      ? {
          monthlyInputTokens: input?.value ?? 0,
          monthlyOutputTokens: output?.value ?? 0,
        }
      : null;
  const workload = statedWorkload ?? options.workload ?? null;

  if (workload) {
    if (input) found.add("monthlyInputTokens", input.value, "question", input.evidence);
    else if (statedWorkload) found.add("monthlyInputTokens", 0, "default", null);
    else found.add("monthlyInputTokens", workload.monthlyInputTokens, "caller", null);

    if (output) found.add("monthlyOutputTokens", output.value, "question", output.evidence);
    else if (statedWorkload) found.add("monthlyOutputTokens", 0, "default", null);
    else found.add("monthlyOutputTokens", workload.monthlyOutputTokens, "caller", null);
  }

  const plan = (intent: QueryIntent): QueryPlan =>
    QueryPlanSchema.parse({
      question,
      intent,
      constraints: found.used,
      interpreter: DETERMINISTIC_INTERPRETER_ID,
      unresolvedTerms: unresolved,
    });

  if (wantsComparison && (wantsCost || workload)) {
    // A named monthly volume is preferred. Without one, ranking uses 1M input
    // and 1M output tokens so published unit prices stay comparable, and the
    // default is recorded rather than implied to have come from the question.
    const UNIT_COMPARISON_TOKENS = 1_000_000;
    const comparisonWorkload = workload ?? {
      monthlyInputTokens: UNIT_COMPARISON_TOKENS,
      monthlyOutputTokens: UNIT_COMPARISON_TOKENS,
    };
    if (!workload) {
      found.add(
        "monthlyInputTokens",
        UNIT_COMPARISON_TOKENS,
        "default",
        "1M tokens (unit-price comparison)",
      );
      found.add(
        "monthlyOutputTokens",
        UNIT_COMPARISON_TOKENS,
        "default",
        "1M tokens (unit-price comparison)",
      );
    }
    const constraints = readSelectionConstraints(text, found, providers);
    const priority = readPriority(text, found);
    if (providers.length < 2) {
      return plan({
        kind: "unsupported",
        reason: "insufficient_constraints",
        detail:
          "A provider comparison needs at least two providers AI Radar tracks. " +
          "Name them explicitly, for example OpenAI, Anthropic and Gemini.",
        missing: ["compareProviders"],
      });
    }
    // The comparison ranks across every named provider at once, so the
    // provider constraint is the union rather than a filter to one.
    return plan(
      ComparisonIntentSchema.parse({
        kind: "comparison_query",
        workload: comparisonWorkload,
        constraints: { ...constraints, providers: providers.map((p) => p.slug) },
        compareProviders: providers.map((provider) => provider.slug),
        priority,
      }),
    );
  }

  if (statedWorkload) {
    const constraints = readSelectionConstraints(text, found, providers);
    const priority = readPriority(text, found);
    return plan(
      WorkloadOptimizerIntentSchema.parse({
        kind: "workload_optimizer_query",
        workload: statedWorkload,
        constraints,
        priority,
      }),
    );
  }

  // A question that names one model and asks about one observed field of it is
  // a lookup, and it sits above the catalog filter for the same reason the
  // temporal branch does: answering "does Claude Opus 5 support video input"
  // with a filtered list of every Anthropic model drops the model the reader
  // asked about. It sits *below* the temporal, workload and comparison
  // branches because each of those is a more specific reading — a change verb,
  // a stated volume, or a second model — that a single-model lookup would
  // discard.
  const factField = extractModelFactField(text);
  const modelPhrase = factField ? extractModelPhraseFor(text, factField) : null;

  // "Is Claude Opus 5 deprecated?" asks what that model's state is now.
  // "What was deprecated this month?" asks what the timeline did. Both contain
  // a lifecycle verb, so the verb cannot separate them — a named model and the
  // absence of a time window can. The override is confined to the lifecycle
  // field and to phrases that actually name a model rather than a family, so
  // "which Claude models were deprecated" stays a timeline question.
  const namesOneModel = (modelPhrase?.split(" ").length ?? 0) >= 2;
  const lifecycleStateQuestion =
    factField?.field === "lifecycle" &&
    namesOneModel &&
    !TEMPORAL_WINDOW_PATTERN.test(text);

  if (
    factField &&
    modelPhrase &&
    providers.length <= 1 &&
    !wantsComparison &&
    !CHEAPEST_PATTERN.test(text) &&
    !TEMPORAL_WINDOW_PATTERN.test(text) &&
    (!TEMPORAL_CHANGE_PATTERN.test(text) || lifecycleStateQuestion)
  ) {
    found.add("model", modelPhrase, "question", modelPhrase);
    found.add("field", factField.field, "question", factField.evidence);
    if (factField.modality) {
      found.add("modality", factField.modality, "question", factField.evidence);
    }
    return plan(
      ModelFactIntentSchema.parse({
        kind: "model_fact_query",
        modelQuery: modelPhrase,
        field: factField.field,
        modality: factField.modality,
      }),
    );
  }

  const selectionSignal =
    CHEAPEST_PATTERN.test(text) ||
    SELECTION_PATTERN.test(text) ||
    VISION_PATTERN.test(text) ||
    CONTEXT_PATTERNS.some((pattern) => pattern.test(text)) ||
    (wantsComparison && providers.length >= 2);

  if (TEMPORAL_CHANGE_PATTERN.test(text) || TEMPORAL_WINDOW_PATTERN.test(text)) {
    return plan(readTemporalIntent(text, found, providers));
  }

  if (selectionSignal) {
    const constraints = readSelectionConstraints(text, found, providers);
    const cheapest = CHEAPEST_PATTERN.exec(text);
    if (cheapest) {
      found.add("superlative", "cheapest_unit_price", "question", cheapest[0]);
    }
    return plan(
      ModelFilterIntentSchema.parse({
        kind: "model_filter_query",
        constraints,
        superlative: cheapest ? "cheapest_unit_price" : null,
      }),
    );
  }

  return plan({
    kind: "unsupported",
    reason: "no_recognized_intent",
    detail:
      "AI Radar answers questions about model changes over time and about choosing " +
      "a model from collected pricing, capability and lifecycle evidence. This " +
      "question does not compile into either, and AI Radar will not answer it from " +
      "anything other than collected evidence.",
    missing: [],
  });
}

export const DETERMINISTIC_INTERPRETER_ID = "deterministic-rules@1";

export const deterministicIntentInterpreter: IntentInterpreter = {
  id: DETERMINISTIC_INTERPRETER_ID,
  interpret: interpretDeterministically,
};

/**
 * Plans a question.
 *
 * The result is validated against `QueryPlanSchema` even when it came from the
 * built-in interpreter. That is not belt and braces: it is the contract a
 * substituted interpreter has to satisfy, and validating both paths the same
 * way is what makes the substitution safe.
 */
export function planQuery(question: string, options: PlanOptions = {}): QueryPlan {
  const interpreter = options.interpreter ?? deterministicIntentInterpreter;
  return QueryPlanSchema.parse(interpreter.interpret(question, options));
}
