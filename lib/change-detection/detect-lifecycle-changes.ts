import { z } from "zod";

import {
  LifecycleStateSchema,
  LifecycleProviderSchema,
  NormalizedLifecycleSnapshotSchema,
  SourceUrlSchema,
  lifecycleRecordIdentity,
  type LifecycleState,
  type NormalizedLifecycleRecord,
} from "../contracts";

export const LifecycleChangeFieldSchema = z.enum([
  "lifecycleState",
  "deprecatedDate",
  "retirementDate",
  "retirementNotBeforeDate",
  "recommendedReplacement",
]);

const lifecycleValueSchema = z.union([
  LifecycleStateSchema,
  z.iso.date(),
  z.string().min(1).max(200),
  z.null(),
]);

export const LifecycleChangeEventSchema = z.object({
  type: z.literal("lifecycle_changed"),
  provider: LifecycleProviderSchema,
  apiModelId: z.string().min(1),
  field: LifecycleChangeFieldSchema,
  oldValue: lifecycleValueSchema,
  newValue: lifecycleValueSchema,
  source: z.object({
    previous: SourceUrlSchema,
    current: SourceUrlSchema,
  }),
});

export type LifecycleChangeField = z.infer<typeof LifecycleChangeFieldSchema>;
export type LifecycleChangeEvent = z.infer<typeof LifecycleChangeEventSchema>;

const fields = [
  "lifecycleState",
  "deprecatedDate",
  "retirementDate",
  "retirementNotBeforeDate",
  "recommendedReplacement",
] as const satisfies readonly LifecycleChangeField[];

function currentFieldIsAuthoritative(
  record: NormalizedLifecycleRecord,
  field: LifecycleChangeField,
): boolean {
  if (field === "lifecycleState") return record.lifecycleState !== null;
  if (field === "deprecatedDate") return record.deprecatedDate !== null;
  if (field === "retirementDate") return record.retirementDate !== null;
  if (field === "retirementNotBeforeDate") {
    return record.retirementNotBeforeObservation === "date" ||
      record.retirementNotBeforeObservation === "explicitly_unannounced";
  }
  return record.recommendedReplacementObserved;
}

/**
 * Compares explicit lifecycle observations only. First observations and rows
 * missing from a later run do not imply a lifecycle transition.
 */
export function detectLifecycleChanges(
  previousInput: readonly NormalizedLifecycleRecord[],
  currentInput: readonly NormalizedLifecycleRecord[],
): LifecycleChangeEvent[] {
  const previous = NormalizedLifecycleSnapshotSchema.parse(previousInput);
  const current = NormalizedLifecycleSnapshotSchema.parse(currentInput);
  const previousByIdentity = new Map(
    previous.map((record) => [lifecycleRecordIdentity(record), record]),
  );
  const currentByIdentity = new Map(
    current.map((record) => [lifecycleRecordIdentity(record), record]),
  );
  const events: LifecycleChangeEvent[] = [];

  for (const [identity, currentRecord] of [...currentByIdentity.entries()].sort()) {
    const previousRecord = previousByIdentity.get(identity);
    if (!previousRecord) continue;
    for (const field of fields) {
      if (!currentFieldIsAuthoritative(currentRecord, field)) continue;
      const oldValue = previousRecord[field] as LifecycleState | string | null;
      const newValue = currentRecord[field] as LifecycleState | string | null;
      if (oldValue === newValue) continue;
      events.push(LifecycleChangeEventSchema.parse({
        type: "lifecycle_changed",
        provider: currentRecord.provider,
        apiModelId: currentRecord.apiModelId,
        field,
        oldValue,
        newValue,
        source: {
          previous: previousRecord.provenance.sourceUrl,
          current: currentRecord.provenance.sourceUrl,
        },
      }));
    }
  }

  return events;
}
