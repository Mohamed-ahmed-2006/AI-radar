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
 * Exact numeric normalization for token counts (context window, max output tokens).
 * Rejects vague strings, decimals, zero, or negative numbers.
 */
export function normalizeExactTokenCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value > 0) return value;
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Handle standard formatted integers with commas (e.g. "128,000" or "1,000,000")
    const cleaned = trimmed.replace(/,/g, "");
    if (/^\d+$/.test(cleaned)) {
      const parsed = Number(cleaned);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
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
    const lower = m.trim().toLowerCase();
    if (lower === "text") normalizedSet.add("text");
    else if (lower === "image" || lower === "vision") normalizedSet.add("image");
    else if (lower === "audio" || lower === "voice" || lower === "speech") normalizedSet.add("audio");
    else if (lower === "video") normalizedSet.add("video");
  }
  return Array.from(normalizedSet);
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
