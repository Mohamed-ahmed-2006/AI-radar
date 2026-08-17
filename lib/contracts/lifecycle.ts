import { z } from "zod";

import { ModelIdentifierSchema, SourceUrlSchema } from "./pricing";

const englishMonths = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const englishDatePattern = new RegExp(
  `^(${englishMonths.join("|")}) ([1-9]|[12]\\d|3[01]), (\\d{4})$`,
);

/** A complete English date exactly as Anthropic publishes it. */
export const CompleteEnglishDateSchema = z.string().superRefine((value, context) => {
  const match = englishDatePattern.exec(value);
  if (!match) {
    context.addIssue({ code: "custom", message: "Expected a complete English date" });
    return;
  }
  const month = englishMonths.indexOf(match[1] as (typeof englishMonths)[number]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    context.addIssue({ code: "custom", message: "Invalid calendar date" });
  }
});

export const RawAnthropicLifecycleStateSchema = z.enum([
  "Active",
  "Legacy",
  "Deprecated",
  "Retired",
]);

export const LifecycleStateSchema = z.enum([
  "active",
  "legacy",
  "deprecated",
  "retired",
]);

export const AnthropicApiModelIdSchema = ModelIdentifierSchema.regex(
  /^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "Invalid Anthropic API model ID",
);

export const RetirementTextSchema = z.string().superRefine((value, context) => {
  const dateText = value.startsWith("Not sooner than ")
    ? value.slice("Not sooner than ".length)
    : value;
  const result = CompleteEnglishDateSchema.safeParse(dateText);
  if (!result.success) {
    context.addIssue({
      code: "custom",
      message: "Expected a complete date or 'Not sooner than <complete date>'",
    });
  }
});

/** Strict transport contract for collector c_msxj0fk3153bu9oz7l. */
export const RawAnthropicLifecycleRecordSchema = z.object({
  product_page_url: SourceUrlSchema,
  input: z.record(z.string(), z.unknown()).optional(),
  api_model_name: AnthropicApiModelIdSchema,
  current_state: RawAnthropicLifecycleStateSchema,
  deprecated_date: CompleteEnglishDateSchema.nullish(),
  tentative_retirement_date: RetirementTextSchema.nullish(),
}).strict();

export const LifecycleProvenanceSchema = z.object({
  sourceUrl: SourceUrlSchema,
  collectorId: z.string().min(1).max(200).nullable(),
  externalRunId: z.string().min(1).max(500).nullable(),
  collectionRunId: z.string().min(1).max(500).nullable(),
});

export const NormalizedLifecycleRecordSchema = z.object({
  provider: z.literal("Anthropic"),
  apiModelId: AnthropicApiModelIdSchema,
  lifecycleState: LifecycleStateSchema,
  deprecatedDate: z.iso.date().nullable(),
  retirementDate: z.iso.date().nullable(),
  retirementNotBeforeDate: z.iso.date().nullable(),
  provenance: LifecycleProvenanceSchema,
  observedAt: z.iso.datetime({ offset: true }),
}).refine(
  (record) => record.retirementDate === null || record.retirementNotBeforeDate === null,
  "Retirement cannot be both exact and not-before",
);

export const NormalizedLifecycleSnapshotSchema = z
  .array(NormalizedLifecycleRecordSchema)
  .superRefine((records, context) => {
    const identities = new Set<string>();
    records.forEach((record, index) => {
      const identity = lifecycleRecordIdentity(record);
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate lifecycle record identity",
          path: [index],
        });
      }
      identities.add(identity);
    });
  });

export type RawAnthropicLifecycleRecord = z.infer<
  typeof RawAnthropicLifecycleRecordSchema
>;
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;
export type NormalizedLifecycleRecord = z.infer<
  typeof NormalizedLifecycleRecordSchema
>;

export interface NormalizeAnthropicLifecycleOptions {
  observedAt: string;
  collectorId?: string | null;
  externalRunId?: string | null;
  collectionRunId?: string | null;
}

/** Parses without locale, timezone, or runtime-dependent Date string behavior. */
export function parseCompleteEnglishDate(value: string): string {
  const parsed = CompleteEnglishDateSchema.parse(value);
  const match = englishDatePattern.exec(parsed);
  if (!match) throw new Error("Validated English date did not match");
  const month = englishMonths.indexOf(match[1] as (typeof englishMonths)[number]) + 1;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
}

export function normalizeAnthropicLifecycleRecord(
  input: unknown,
  options: NormalizeAnthropicLifecycleOptions,
): NormalizedLifecycleRecord {
  const raw = RawAnthropicLifecycleRecordSchema.parse(input);
  const retirementText = raw.tentative_retirement_date ?? null;
  const isNotBefore = retirementText?.startsWith("Not sooner than ") ?? false;
  const retirementDateText = retirementText
    ? retirementText.slice(isNotBefore ? "Not sooner than ".length : 0)
    : null;

  return NormalizedLifecycleRecordSchema.parse({
    provider: "Anthropic",
    apiModelId: raw.api_model_name,
    lifecycleState: raw.current_state.toLowerCase(),
    deprecatedDate: raw.deprecated_date
      ? parseCompleteEnglishDate(raw.deprecated_date)
      : null,
    retirementDate: retirementDateText && !isNotBefore
      ? parseCompleteEnglishDate(retirementDateText)
      : null,
    retirementNotBeforeDate: retirementDateText && isNotBefore
      ? parseCompleteEnglishDate(retirementDateText)
      : null,
    provenance: {
      sourceUrl: raw.product_page_url,
      collectorId: options.collectorId ?? null,
      externalRunId: options.externalRunId ?? null,
      collectionRunId: options.collectionRunId ?? null,
    },
    observedAt: options.observedAt,
  });
}

export function lifecycleRecordIdentity(
  record: Pick<NormalizedLifecycleRecord, "provider" | "apiModelId">,
): string {
  return JSON.stringify([record.provider, record.apiModelId]);
}
