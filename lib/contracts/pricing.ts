import { z } from "zod";

const providerPattern = /^[\p{L}\p{N}][\p{L}\p{N} .&'()+_-]*$/u;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/;
const tierPattern = /^[a-z0-9][a-z0-9_-]*$/;
const collectorPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const httpUrlSchema = z
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Must be an HTTP or HTTPS URL");

const priceSchema = z
  .number()
  .refine(Number.isFinite, "Price must be finite")
  .nonnegative("Price cannot be negative");

const optionalRawPriceSchema = priceSchema.nullish();

/** Stable, human-readable provider identity as published by the source. */
export const ProviderIdentitySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(providerPattern, "Invalid provider identity")
  .refine((value) => value === value.trim(), "Invalid provider identity");

export const ModelIdentifierSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(modelPattern, "Invalid model identifier");

/** Extensible slug rather than an OpenAI-specific enum. */
export const PricingModeSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(tierPattern, "Invalid pricing mode");

/** Extensible slug for context-window or other provider-defined tiers. */
export const ContextTierSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(tierPattern, "Invalid context tier");

export const SourceUrlSchema = httpUrlSchema;

export const CollectionMetadataSchema = z.object({
  collectorId: z
    .string()
    .min(1)
    .max(200)
    .regex(collectorPattern, "Invalid collector identifier")
    .nullable(),
  collectedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const PricingProvenanceSchema = CollectionMetadataSchema.extend({
  sourceUrl: SourceUrlSchema,
});

/** The transport shape emitted by the Bright Data pricing collector. */
export const RawBrightDataPricingRecordSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional(),
  provider: ProviderIdentitySchema,
  model_name: ModelIdentifierSchema,
  pricing_mode: PricingModeSchema,
  context_tier: ContextTierSchema,
  input_price_per_1m_tokens: optionalRawPriceSchema,
  cached_input_price_per_1m_tokens: optionalRawPriceSchema,
  cache_write_price_per_1m_tokens: optionalRawPriceSchema,
  output_price_per_1m_tokens: optionalRawPriceSchema,
  pricing_unit: z.string().min(1).max(100),
  source_url: SourceUrlSchema,
});

export const NormalizedPricingRecordSchema = z.object({
  provider: ProviderIdentitySchema,
  modelName: ModelIdentifierSchema,
  pricingMode: PricingModeSchema,
  contextTier: ContextTierSchema,
  inputPricePer1MTokens: priceSchema.nullable(),
  cachedInputPricePer1MTokens: priceSchema.nullable(),
  cacheWritePricePer1MTokens: priceSchema.nullable(),
  outputPricePer1MTokens: priceSchema.nullable(),
  pricingUnit: z.string().min(1).max(100),
  provenance: PricingProvenanceSchema,
});

export const NormalizedPricingSnapshotSchema = z
  .array(NormalizedPricingRecordSchema)
  .superRefine((records, context) => {
    const identities = new Set<string>();

    records.forEach((record, index) => {
      const identity = pricingRecordIdentity(record);
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate pricing record identity",
          path: [index],
        });
      }
      identities.add(identity);
    });
  });

export type ProviderIdentity = z.infer<typeof ProviderIdentitySchema>;
export type PricingMode = z.infer<typeof PricingModeSchema>;
export type ContextTier = z.infer<typeof ContextTierSchema>;
export type CollectionMetadata = z.infer<typeof CollectionMetadataSchema>;
export type PricingProvenance = z.infer<typeof PricingProvenanceSchema>;
export type RawBrightDataPricingRecord = z.infer<
  typeof RawBrightDataPricingRecordSchema
>;
export type NormalizedPricingRecord = z.infer<
  typeof NormalizedPricingRecordSchema
>;

export type NormalizePricingOptions = Partial<CollectionMetadata>;

export function normalizeBrightDataPricingRecord(
  input: unknown,
  collection: NormalizePricingOptions = {},
): NormalizedPricingRecord {
  const raw = RawBrightDataPricingRecordSchema.parse(input);

  return NormalizedPricingRecordSchema.parse({
    provider: raw.provider,
    modelName: raw.model_name,
    pricingMode: raw.pricing_mode,
    contextTier: raw.context_tier,
    inputPricePer1MTokens: raw.input_price_per_1m_tokens ?? null,
    cachedInputPricePer1MTokens:
      raw.cached_input_price_per_1m_tokens ?? null,
    cacheWritePricePer1MTokens: raw.cache_write_price_per_1m_tokens ?? null,
    outputPricePer1MTokens: raw.output_price_per_1m_tokens ?? null,
    pricingUnit: raw.pricing_unit,
    provenance: {
      sourceUrl: raw.source_url,
      collectorId: collection.collectorId ?? null,
      collectedAt: collection.collectedAt ?? null,
    },
  });
}

export function pricingRecordIdentity(
  record: Pick<
    NormalizedPricingRecord,
    "provider" | "modelName" | "pricingMode" | "contextTier"
  >,
): string {
  return JSON.stringify([
    record.provider,
    record.modelName,
    record.pricingMode,
    record.contextTier,
  ]);
}
