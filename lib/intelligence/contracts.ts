import { z } from "zod";

export const TemporalChangeTypeSchema = z.enum([
  "price_increased",
  "price_decreased",
  "model_added",
  "model_removed",
  "lifecycle_transition",
  "deprecation_scheduled",
  "retirement_scheduled",
  "retirement_not_before_scheduled",
  "replacement_recommended",
  "metadata_changed",
]);

export type TemporalChangeType = z.infer<typeof TemporalChangeTypeSchema>;

export const EvidenceCategorySchema = z.enum([
  "pricing",
  "lifecycle",
  "catalog",
  "deprecations",
  "retirements",
  "replacements",
  "metadata",
]);

export type EvidenceCategory = z.infer<typeof EvidenceCategorySchema>;

export const AuthorityLevelSchema = z.enum([
  "authoritative",
  "verified_scrape",
  "inferred",
]);

export type AuthorityLevel = z.infer<typeof AuthorityLevelSchema>;

export const PriceDeltaSchema = z.object({
  previousPrice: z.number().nullable(),
  currentPrice: z.number().nullable(),
  absoluteChange: z.number().nullable(),
  percentChange: z.number().nullable(),
  unit: z.string().default("USD per 1M tokens"),
  field: z.string(),
});

export type PriceDelta = z.infer<typeof PriceDeltaSchema>;

export const SourceProvenanceSchema = z.object({
  url: z.string(),
  collectorId: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
});

export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;

export const ExecutionProvenanceSchema = z.object({
  runId: z.string().nullable().optional(),
  externalRunId: z.string().nullable().optional(),
  previousSnapshotId: z.string().nullable().optional(),
  currentSnapshotId: z.string().nullable().optional(),
  previousLifecycleSnapshotId: z.string().nullable().optional(),
  currentLifecycleSnapshotId: z.string().nullable().optional(),
});

export type ExecutionProvenance = z.infer<typeof ExecutionProvenanceSchema>;

export const TemporalEvidenceSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  providerName: z.string().min(1),
  model: z.string().min(1),
  displayName: z.string().nullable().optional(),
  changeType: TemporalChangeTypeSchema,
  category: EvidenceCategorySchema,
  field: z.string().nullable().optional(),
  pricingMode: z.string().nullable().optional(),
  contextTier: z.string().nullable().optional(),
  previousValue: z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.unknown())]),
  currentValue: z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.unknown())]),
  priceDelta: PriceDeltaSchema.nullable().optional(),
  observedAt: z.string().datetime({ offset: true }),
  source: SourceProvenanceSchema,
  provenance: ExecutionProvenanceSchema,
  authority: AuthorityLevelSchema,
  confidence: z.number().min(0).max(1),
  significanceScore: z.number().min(0).max(100),
  summary: z.string().min(1),
  isDemo: z.boolean().default(false),
});

export type TemporalEvidence = z.infer<typeof TemporalEvidenceSchema>;

export const RelativeDateRangeSchema = z.enum([
  "24h",
  "7d",
  "14d",
  "30d",
  "60d",
  "90d",
  "180d",
  "ytd",
  "all",
]);

export type RelativeDateRange = z.infer<typeof RelativeDateRangeSchema>;

export const TemporalQuerySchema = z.object({
  provider: z.union([z.string(), z.array(z.string())]).optional(),
  model: z.union([z.string(), z.array(z.string())]).optional(),
  family: z.string().optional(),
  range: RelativeDateRangeSchema.optional().default("30d"),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  categories: z.array(EvidenceCategorySchema).optional(),
  types: z.array(TemporalChangeTypeSchema).optional(),
  significantOnly: z.boolean().optional().default(false),
  minSignificance: z.number().min(0).max(100).optional(),
  limit: z.number().int().positive().max(1000).optional().default(100),
  offset: z.number().int().nonnegative().optional().default(0),
  sort: z.enum(["desc", "asc"]).optional().default("desc"),
  demo: z.boolean().optional().default(false),
  includeSummary: z.boolean().optional().default(true),
  referenceDate: z.string().datetime({ offset: true }).optional(),
});

export type TemporalQueryInput = z.input<typeof TemporalQuerySchema>;
export type TemporalQuery = TemporalQueryInput;
export type ParsedTemporalQuery = z.infer<typeof TemporalQuerySchema>;

export const EvidenceMetricsSchema = z.object({
  totalEvents: z.number(),
  priceIncreases: z.number(),
  priceDecreases: z.number(),
  modelsAdded: z.number(),
  modelsRemoved: z.number(),
  lifecycleTransitions: z.number(),
  deprecationsScheduled: z.number(),
  retirementsScheduled: z.number(),
  replacementsAnnounced: z.number(),
  byProvider: z.record(z.string(), z.object({
    providerName: z.string(),
    total: z.number(),
    priceChanges: z.number(),
    lifecycleChanges: z.number(),
    additions: z.number(),
    removals: z.number(),
  })),
  byCategory: z.record(z.string(), z.number()),
});

export type EvidenceMetrics = z.infer<typeof EvidenceMetricsSchema>;

export const TimelineBucketSchema = z.object({
  date: z.string(),
  count: z.number(),
  events: z.array(TemporalEvidenceSchema),
});

export type TimelineBucket = z.infer<typeof TimelineBucketSchema>;

export const EvidenceBundleSchema = z.object({
  query: TemporalQuerySchema,
  generatedAt: z.string().datetime({ offset: true }),
  totalEvents: z.number(),
  events: z.array(TemporalEvidenceSchema),
  metrics: EvidenceMetricsSchema,
  timeline: z.array(TimelineBucketSchema),
  deltaSummary: z.array(z.string()),
  narrativeSummary: z.string().nullable().optional(),
  isDemoData: z.boolean(),
});

export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

export const ProviderStatsSchema = z.object({
  providerSlug: z.string(),
  providerName: z.string(),
  totalEvents: z.number(),
  priceChanges: z.object({
    reductions: z.number(),
    increases: z.number(),
    avgReductionPercent: z.number().nullable(),
  }),
  launches: z.array(z.string()),
  deprecations: z.array(z.string()),
  retirements: z.array(z.string()),
  replacements: z.array(z.string()),
  stabilityScore: z.number(),
});

export type ProviderStats = z.infer<typeof ProviderStatsSchema>;

export const ProviderComparisonResultSchema = z.object({
  range: z.string(),
  timeframe: z.object({
    since: z.string(),
    until: z.string(),
  }),
  providers: z.record(z.string(), ProviderStatsSchema),
  comparisonHighlights: z.array(z.string()),
  isDemoData: z.boolean(),
});

export type ProviderComparisonResult = z.infer<typeof ProviderComparisonResultSchema>;

export const EcosystemSignificanceItemSchema = TemporalEvidenceSchema.extend({
  impactReason: z.string(),
});

export type EcosystemSignificanceItem = z.infer<typeof EcosystemSignificanceItemSchema>;

export const EcosystemSignificanceSummarySchema = z.object({
  range: z.string(),
  timeframe: z.object({
    since: z.string(),
    until: z.string(),
  }),
  topChanges: z.array(EcosystemSignificanceItemSchema),
  headline: z.string(),
  isDemoData: z.boolean(),
});

export type EcosystemSignificanceSummary = z.infer<typeof EcosystemSignificanceSummarySchema>;
