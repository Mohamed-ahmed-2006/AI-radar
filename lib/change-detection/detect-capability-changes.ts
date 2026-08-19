import { z } from "zod";

import {
  NormalizedCatalogRecordSchema,
  ProviderIdentitySchema,
  SourceUrlSchema,
  catalogRecordIdentity,
  type NormalizedCatalogRecord,
} from "../contracts";

export const CapabilityChangeFieldSchema = z.enum([
  "contextWindow",
  "maxOutputTokens",
  "supportsVision",
  "supportsToolCalling",
  "inputModalities",
  "outputModalities",
  "displayName",
  "modelFamily",
  "modelStage",
]);
export type CapabilityChangeField = z.infer<typeof CapabilityChangeFieldSchema>;

const capabilityValueSchema = z.union([
  z.number().int().positive(),
  z.boolean(),
  z.array(z.string()),
  z.string(),
  z.null(),
]);

export const CapabilityChangeEventSchema = z.object({
  type: z.literal("capability_changed"),
  provider: ProviderIdentitySchema,
  apiModelId: z.string().min(1),
  field: CapabilityChangeFieldSchema,
  oldValue: capabilityValueSchema,
  newValue: capabilityValueSchema,
  source: z.object({
    previous: SourceUrlSchema,
    current: SourceUrlSchema,
  }),
});
export type CapabilityChangeEvent = z.infer<typeof CapabilityChangeEventSchema>;

const fields = [
  "contextWindow",
  "maxOutputTokens",
  "supportsVision",
  "supportsToolCalling",
  "inputModalities",
  "outputModalities",
  "displayName",
  "modelFamily",
  "modelStage",
] as const satisfies readonly CapabilityChangeField[];

function arraysEqual(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * Compares authoritative capability snapshots.
 * Models disappearing from a later collection run DO NOT emit removal events
 * or mutate previously recorded capabilities.
 */
export function detectCapabilityChanges(
  previousInput: readonly NormalizedCatalogRecord[],
  currentInput: readonly NormalizedCatalogRecord[],
): CapabilityChangeEvent[] {
  const previous = z.array(NormalizedCatalogRecordSchema).parse(previousInput);
  const current = z.array(NormalizedCatalogRecordSchema).parse(currentInput);

  const previousByIdentity = new Map(
    previous.map((record) => [catalogRecordIdentity(record), record]),
  );
  const currentByIdentity = new Map(
    current.map((record) => [catalogRecordIdentity(record), record]),
  );

  const events: CapabilityChangeEvent[] = [];

  for (const [identity, currentRecord] of [...currentByIdentity.entries()].sort()) {
    const previousRecord = previousByIdentity.get(identity);
    if (!previousRecord) continue;

    for (const field of fields) {
      const oldValue = previousRecord[field];
      const newValue = currentRecord[field];

      if (field === "inputModalities" || field === "outputModalities") {
        if (arraysEqual(oldValue as string[], newValue as string[])) continue;
      } else {
        if (oldValue === newValue) continue;
      }

      // If both are unobserved (null), no event
      if (oldValue === null && newValue === null) continue;

      events.push(
        CapabilityChangeEventSchema.parse({
          type: "capability_changed",
          provider: currentRecord.provider,
          apiModelId: currentRecord.apiModelId,
          field,
          oldValue,
          newValue,
          source: {
            previous: previousRecord.provenance.sourceUrl,
            current: currentRecord.provenance.sourceUrl,
          },
        }),
      );
    }
  }

  return events;
}
