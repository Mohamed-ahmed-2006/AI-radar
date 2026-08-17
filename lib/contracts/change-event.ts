import { z } from "zod";

import {
  ContextTierSchema,
  ModelIdentifierSchema,
  NormalizedPricingRecordSchema,
  PricingModeSchema,
  ProviderIdentitySchema,
  SourceUrlSchema,
} from "./pricing";

export const PriceFieldSchema = z.enum([
  "inputPricePer1MTokens",
  "cachedInputPricePer1MTokens",
  "cacheWritePricePer1MTokens",
  "outputPricePer1MTokens",
]);

export const MetadataFieldSchema = z.enum([
  ...PriceFieldSchema.options,
  "pricingUnit",
  "sourceUrl",
]);

const eventIdentitySchema = z.object({
  provider: ProviderIdentitySchema,
  modelName: ModelIdentifierSchema,
  pricingMode: PricingModeSchema,
  contextTier: ContextTierSchema,
});

const changeSourceSchema = z.object({
  previous: SourceUrlSchema.nullable(),
  current: SourceUrlSchema.nullable(),
});

const addedEventSchema = eventIdentitySchema.extend({
  type: z.literal("model_added"),
  source: changeSourceSchema,
  record: NormalizedPricingRecordSchema,
});

const removedEventSchema = eventIdentitySchema.extend({
  type: z.literal("model_removed"),
  source: changeSourceSchema,
  record: NormalizedPricingRecordSchema,
});

const priceEventSchema = eventIdentitySchema.extend({
  type: z.enum(["price_increased", "price_decreased"]),
  field: PriceFieldSchema,
  oldValue: z.number().finite().nonnegative(),
  newValue: z.number().finite().nonnegative(),
  source: changeSourceSchema,
});

const metadataEventSchema = eventIdentitySchema.extend({
  type: z.literal("metadata_changed"),
  field: MetadataFieldSchema,
  oldValue: z.union([z.string(), z.number().finite().nonnegative(), z.null()]),
  newValue: z.union([z.string(), z.number().finite().nonnegative(), z.null()]),
  source: changeSourceSchema,
});

export const ChangeEventSchema = z.discriminatedUnion("type", [
  addedEventSchema,
  removedEventSchema,
  priceEventSchema,
  metadataEventSchema,
]);

export type PriceField = z.infer<typeof PriceFieldSchema>;
export type MetadataField = z.infer<typeof MetadataFieldSchema>;
export type ChangeEvent = z.infer<typeof ChangeEventSchema>;
