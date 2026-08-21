import { z } from "zod";

import {
  CollectionMetadataSchema,
  ModelIdentifierSchema,
  ProviderIdentitySchema,
  SourceUrlSchema,
} from "./pricing";

/**
 * Standard modalities across all providers.
 */
export const ModalitySchema = z.enum(["text", "image", "audio", "video"]);
export type Modality = z.infer<typeof ModalitySchema>;

/**
 * Three-state observation representation.
 * Explicitly supported: true
 * Explicitly unsupported: false
 * Unobserved / Unknown: null (unknown is NOT false!)
 */
export const ThreeStateBooleanSchema = z.boolean().nullable();
export type ThreeStateBoolean = z.infer<typeof ThreeStateBooleanSchema>;

export const CatalogProviderSlugSchema = z.enum(["openai", "anthropic", "gemini", "xai"]);
export type CatalogProviderSlug = z.infer<typeof CatalogProviderSlugSchema>;

export const CatalogProviderNameSchema = z.enum(["OpenAI", "Anthropic", "Google", "xAI"]);
export type CatalogProviderName = z.infer<typeof CatalogProviderNameSchema>;

export const CatalogProvenanceSchema = CollectionMetadataSchema.extend({
  sourceUrl: SourceUrlSchema,
});
export type CatalogProvenance = z.infer<typeof CatalogProvenanceSchema>;

/**
 * A token count written in the shorthand provider tables actually use:
 * `1M tokens`, `128k tokens`, `200k`. The magnitude suffix is the only thing
 * allowed after the digits, optionally followed by the word "token"/"tokens".
 *
 * Anything else — `approx 128k`, `up to 2 million`, `~555k words` — fails the
 * anchors and is rejected, because a hedge is not a published number.
 */
const SHORTHAND_TOKEN_COUNT = /^(\d+(?:\.\d+)?)\s*([km])\s*(?:tokens?)?$/i;

/** A plain integer, optionally thousands-separated and suffixed with "tokens". */
const EXACT_TOKEN_COUNT = /^(\d+)\s*(?:tokens?)?$/i;

const SHORTHAND_MULTIPLIERS: Record<string, number> = { k: 1_000, m: 1_000_000 };

/**
 * Icon-font glyphs and invisible formatting characters that documentation pages
 * carry inside their own text nodes.
 *
 * Anthropic's comparison table publishes its context window as `1M tokens`
 * followed by U+E08F — the Private Use Area code point its icon font renders as
 * the tooltip marker. It is not a character in any alphabet, it means nothing
 * outside that font, and `trim()` does not remove it, so the cell arrives as
 * `"1M tokens "` and fails every anchor a number parser can set.
 *
 * Stripping is confined to code points that cannot carry textual content: the
 * three Private Use ranges, zero-width joiners and marks, the bidi controls, and
 * the byte-order mark. Nothing a reader could see is removed, and the verbatim
 * string is preserved in raw evidence either way.
 */
const NON_TEXTUAL_CODE_POINTS = new RegExp(
  "[" +
    "\u200B-\u200F" + // zero-width space/joiners and the LTR/RTL marks
    "\u2028\u2029" + // line and paragraph separators
    "\u202A-\u202E" + // bidi embedding and override controls
    "\u2060-\u2064" + // word joiner and invisible operators
    "\u206A-\u206F" + // deprecated formatting controls
    "\uE000-\uF8FF" + // Private Use Area: the icon-font glyphs
    "\uFEFF" + // byte-order mark
    "]" +
    "|[\u{F0000}-\u{FFFFD}]" + // Supplementary Private Use Area-A
    "|[\u{100000}-\u{10FFFD}]", // Supplementary Private Use Area-B
  "gu",
);

/**
 * A scraped string reduced to the characters that actually say something.
 *
 * Exported because the fault it fixes is not specific to token counts: any
 * value lifted from a documentation table can pick up the page's icon glyphs.
 */
export function stripNonTextualCharacters(value: string): string {
  return value.replace(NON_TEXTUAL_CODE_POINTS, "").trim();
}

/**
 * Exact numeric normalization for token counts (context window, max output tokens).
 *
 * "Exact" means the source stated a definite figure, not that it spelled every
 * digit. Anthropic's comparison table publishes `1M tokens` and `128k tokens`;
 * OpenAI's publishes `128,000`. Both are exact statements of the same kind of
 * fact, and reading only the second is how a documented limit turns into "not
 * observed" on a model page.
 *
 * What stays rejected is vagueness: hedging words, ranges, unit words other
 * than tokens, and any shorthand that does not resolve to a whole number of
 * tokens. The verbatim string is always preserved in raw evidence, so a reader
 * can still see exactly what the source said.
 */
export function normalizeExactTokenCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value > 0) return value;
    return null;
  }
  if (typeof value !== "string") return null;

  const trimmed = stripNonTextualCharacters(value).replace(/,/g, "");
  if (!trimmed) return null;

  const exact = EXACT_TOKEN_COUNT.exec(trimmed);
  if (exact) {
    const parsed = Number(exact[1]);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  const shorthand = SHORTHAND_TOKEN_COUNT.exec(trimmed);
  if (shorthand) {
    const scaled =
      Number(shorthand[1]) * SHORTHAND_MULTIPLIERS[shorthand[2].toLowerCase()];
    // A shorthand that does not land on a whole token — "1.2345k" — is not a
    // count the source actually published, so it is refused rather than rounded.
    return Number.isSafeInteger(scaled) && scaled > 0 ? scaled : null;
  }

  return null;
}

export function normalizeModalities(
  modalities: readonly string[] | string | null | undefined,
): Modality[] {
  if (!modalities) return [];
  const list = Array.isArray(modalities)
    ? modalities
    : typeof modalities === "string"
      ? modalities.split(/[,;\s]+/)
      : [];
  const normalizedSet = new Set<Modality>();
  for (const m of list) {
    if (typeof m !== "string") continue;
    const lower = stripNonTextualCharacters(m).toLowerCase();
    if (lower === "text") normalizedSet.add("text");
    else if (lower === "image" || lower === "vision") normalizedSet.add("image");
    else if (lower === "audio" || lower === "voice" || lower === "speech") normalizedSet.add("audio");
    else if (lower === "video") normalizedSet.add("video");
  }
  return Array.from(normalizedSet);
}

/**
 * Raw-evidence key a collector uses to publish the source's own sentence about
 * which modalities a model supports — for example Anthropic's "All current
 * Claude models support text and image input, text output, multilingual
 * capabilities, and vision."
 *
 * The key carries a specific meaning, and it is the only thing in AI Radar that
 * can turn a missing modality into an answer. An observed modality list is
 * normally an open set: `image` not appearing means nobody said whether image
 * is supported. When the source published a sentence that *enumerates* what is
 * supported, the same list becomes a closed set, and a modality outside it is
 * unsupported *according to that sentence* — quoted back with the answer so a
 * reader can judge the claim for themselves.
 *
 * Collectors must only populate this when the page really does enumerate. A
 * page that merely mentions modalities in passing leaves it absent, and absence
 * keeps the safe reading: Unknown.
 */
export const MODALITY_ENUMERATION_STATEMENT_KEY = "capability_statement";

/**
 * The enumerating statement a record's raw evidence carries, or null when the
 * source published none and the modality lists stay open.
 */
export function readModalityEnumerationStatement(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>)[MODALITY_ENUMERATION_STATEMENT_KEY];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}


// ---------------------------------------------------------------------------
// Raw Transport Schemas
// ---------------------------------------------------------------------------

/**
 * Raw OpenAI catalog record as extracted from official models documentation.
 */
export const RawOpenAiCatalogRecordSchema = z.object({
  model_id: ModelIdentifierSchema,
  display_name: z.string().min(1).max(200).nullish(),
  description: z.string().nullish(),
  input_modalities: z.array(z.string()).nullish(),
  output_modalities: z.array(z.string()).nullish(),
  context_window_raw: z.union([z.number(), z.string()]).nullish(),
  max_output_tokens_raw: z.union([z.number(), z.string()]).nullish(),
  supports_vision: z.boolean().nullish(),
  supports_function_calling: z.boolean().nullish(),
  supported_features: z.array(z.string()).nullish(),
  default_snapshot: z.string().nullish(),
  /** Verbatim source sentence enumerating supported modalities, when published. */
  capability_statement: z.string().min(1).max(1000).nullish(),
  source_url: SourceUrlSchema.optional(),
  input: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type RawOpenAiCatalogRecord = z.infer<typeof RawOpenAiCatalogRecordSchema>;

/**
 * Raw Anthropic catalog record as extracted from official models documentation.
 */
export const RawAnthropicCatalogRecordSchema = z.object({
  api_model_id: ModelIdentifierSchema,
  display_name: z.string().min(1).max(200).nullish(),
  model_family: z.string().nullish(),
  context_window_raw: z.union([z.number(), z.string()]).nullish(),
  max_output_tokens_raw: z.union([z.number(), z.string()]).nullish(),
  supports_vision: z.boolean().nullish(),
  supports_tool_use: z.boolean().nullish(),
  input_modalities: z.array(z.string()).nullish(),
  output_modalities: z.array(z.string()).nullish(),
  /** Verbatim source sentence enumerating supported modalities, when published. */
  capability_statement: z.string().min(1).max(1000).nullish(),
  source_url: SourceUrlSchema.optional(),
  input: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type RawAnthropicCatalogRecord = z.infer<typeof RawAnthropicCatalogRecordSchema>;

/**
 * Raw Gemini catalog record as extracted from official models documentation.
 */
export const RawGeminiCatalogRecordSchema = z.object({
  model_id: ModelIdentifierSchema,
  display_name: z.string().min(1).max(200).nullish(),
  description: z.string().nullish(),
  model_group: z.string().nullish(),
  input_modalities: z.array(z.string()).nullish(),
  output_modalities: z.array(z.string()).nullish(),
  context_window_raw: z.union([z.number(), z.string()]).nullish(),
  max_output_tokens_raw: z.union([z.number(), z.string()]).nullish(),
  supports_vision: z.boolean().nullish(),
  supports_function_calling: z.boolean().nullish(),
  supported_features: z.array(z.string()).nullish(),
  /** Verbatim source sentence enumerating supported modalities, when published. */
  capability_statement: z.string().min(1).max(1000).nullish(),
  source_url: SourceUrlSchema.optional(),
  input: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type RawGeminiCatalogRecord = z.infer<typeof RawGeminiCatalogRecordSchema>;

/**
 * Raw xAI catalog record as extracted from official models documentation.
 */
export const RawXaiCatalogRecordSchema = z.object({
  name: ModelIdentifierSchema,
  version: z.string().nullish(),
  input_modalities: z.array(z.string()).nullish(),
  output_modalities: z.array(z.string()).nullish(),
  max_prompt_length: z.union([z.number(), z.string()]).nullish(),
  aliases: z.array(z.string()).nullish(),
  features: z.object({
    functionCalling: z.boolean().optional(),
    structuredOutputs: z.boolean().optional(),
    reasoning: z.boolean().optional(),
  }).nullish(),
  /** Verbatim source sentence enumerating supported modalities, when published. */
  capability_statement: z.string().min(1).max(1000).nullish(),
  source_url: SourceUrlSchema.optional(),
  input: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type RawXaiCatalogRecord = z.infer<typeof RawXaiCatalogRecordSchema>;

// ---------------------------------------------------------------------------
// Normalized Canonical Record
// ---------------------------------------------------------------------------

export const NormalizedCatalogRecordSchema = z.object({
  provider: ProviderIdentitySchema,
  providerSlug: CatalogProviderSlugSchema,
  apiModelId: ModelIdentifierSchema,
  displayName: z.string().min(1).max(200).nullable(),
  modelFamily: z.string().min(1).max(100).nullable(),
  modelStage: z.string().min(1).max(50).nullable(),
  contextWindow: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  supportsVision: ThreeStateBooleanSchema,
  supportsToolCalling: ThreeStateBooleanSchema,
  inputModalities: z.array(ModalitySchema),
  outputModalities: z.array(ModalitySchema),
  supportedFeatures: z.array(z.string()),
  rawEvidence: z.record(z.string(), z.unknown()),
  provenance: CatalogProvenanceSchema,
});
export type NormalizedCatalogRecord = z.infer<typeof NormalizedCatalogRecordSchema>;

export function catalogRecordIdentity(record: {
  provider: string;
  apiModelId: string;
}): string {
  return `${record.provider.trim().toLowerCase()}::${record.apiModelId.trim().toLowerCase()}`;
}
