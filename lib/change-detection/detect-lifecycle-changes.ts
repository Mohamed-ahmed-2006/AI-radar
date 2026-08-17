import { z } from "zod";

import {
  LifecycleStateSchema,
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
]);

const lifecycleValueSchema = z.union([LifecycleStateSchema, z.iso.date(), z.null()]);

export const LifecycleChangeEventSchema = z.object({
  type: z.literal("lifecycle_changed"),
  provider: z.literal("Anthropic"),
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
] as const satisfies readonly LifecycleChangeField[];

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
      const oldValue = previousRecord[field] as LifecycleState | string | null;
      const newValue = currentRecord[field] as LifecycleState | string | null;
      if (oldValue === newValue) continue;
      events.push(LifecycleChangeEventSchema.parse({
        type: "lifecycle_changed",
        provider: "Anthropic",
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
