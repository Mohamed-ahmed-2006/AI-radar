import type {
  ChangeEvent,
  MetadataField,
  NormalizedPricingRecord,
  PriceField,
} from "../contracts";
import {
  ChangeEventSchema,
  NormalizedPricingSnapshotSchema,
  pricingRecordIdentity,
} from "../contracts";

const priceFields = [
  "inputPricePer1MTokens",
  "cachedInputPricePer1MTokens",
  "cacheWritePricePer1MTokens",
  "outputPricePer1MTokens",
] as const satisfies readonly PriceField[];

const eventOrder: Record<ChangeEvent["type"], number> = {
  model_removed: 0,
  model_added: 1,
  price_decreased: 2,
  price_increased: 3,
  metadata_changed: 4,
};

function identityFields(record: NormalizedPricingRecord) {
  return {
    provider: record.provider,
    modelName: record.modelName,
    pricingMode: record.pricingMode,
    contextTier: record.contextTier,
  };
}

function sourceFields(
  previous: NormalizedPricingRecord | undefined,
  current: NormalizedPricingRecord | undefined,
) {
  return {
    previous: previous?.provenance.sourceUrl ?? null,
    current: current?.provenance.sourceUrl ?? null,
  };
}

function metadataEvent(
  previous: NormalizedPricingRecord,
  current: NormalizedPricingRecord,
  field: MetadataField,
  oldValue: string | number | null,
  newValue: string | number | null,
): ChangeEvent {
  return {
    type: "metadata_changed",
    ...identityFields(current),
    field,
    oldValue,
    newValue,
    source: sourceFields(previous, current),
  };
}

function modelIdentity(record: Pick<NormalizedPricingRecord, "provider" | "modelName">): string {
  return JSON.stringify([record.provider, record.modelName]);
}

/**
 * A first/last pricing observation is a model-level lifecycle event, even if
 * the source publishes it in several context tiers. Adding/removing one tier
 * while another remains is still a tier-scoped pricing identity event.
 */
function collapseModelLifecycleEvents(
  events: readonly ChangeEvent[],
  previous: readonly NormalizedPricingRecord[],
  current: readonly NormalizedPricingRecord[],
): ChangeEvent[] {
  const previousModels = new Set(previous.map(modelIdentity));
  const currentModels = new Set(current.map(modelIdentity));
  const emittedModelEvents = new Set<string>();

  return events.filter((event) => {
    const identity = modelIdentity(event);
    const isWholeModelAddition = event.type === "model_added" && !previousModels.has(identity);
    const isWholeModelRemoval = event.type === "model_removed" && !currentModels.has(identity);
    if (!isWholeModelAddition && !isWholeModelRemoval) return true;

    const key = `${event.type}:${identity}`;
    if (emittedModelEvents.has(key)) return false;
    emittedModelEvents.add(key);
    return true;
  });
}

/**
 * Compares two complete pricing snapshots. The result has stable ordering and
 * intentionally contains no generated IDs or timestamps.
 */
export function detectPricingChanges(
  previousInput: readonly NormalizedPricingRecord[],
  currentInput: readonly NormalizedPricingRecord[],
): ChangeEvent[] {
  const previous = NormalizedPricingSnapshotSchema.parse(previousInput);
  const current = NormalizedPricingSnapshotSchema.parse(currentInput);
  const previousByIdentity = new Map(
    previous.map((record) => [pricingRecordIdentity(record), record]),
  );
  const currentByIdentity = new Map(
    current.map((record) => [pricingRecordIdentity(record), record]),
  );
  const identities = [...new Set([
    ...previousByIdentity.keys(),
    ...currentByIdentity.keys(),
  ])].sort();
  const events: ChangeEvent[] = [];

  for (const identity of identities) {
    const oldRecord = previousByIdentity.get(identity);
    const newRecord = currentByIdentity.get(identity);

    if (!oldRecord && newRecord) {
      events.push({
        type: "model_added",
        ...identityFields(newRecord),
        source: sourceFields(undefined, newRecord),
        record: newRecord,
      });
      continue;
    }

    if (oldRecord && !newRecord) {
      events.push({
        type: "model_removed",
        ...identityFields(oldRecord),
        source: sourceFields(oldRecord, undefined),
        record: oldRecord,
      });
      continue;
    }

    if (!oldRecord || !newRecord) continue;

    for (const field of priceFields) {
      const oldValue = oldRecord[field];
      const newValue = newRecord[field];
      if (oldValue === newValue) continue;

      if (oldValue !== null && newValue !== null) {
        events.push({
          type: newValue > oldValue ? "price_increased" : "price_decreased",
          ...identityFields(newRecord),
          field,
          oldValue,
          newValue,
          source: sourceFields(oldRecord, newRecord),
        });
      } else {
        events.push(
          metadataEvent(oldRecord, newRecord, field, oldValue, newValue),
        );
      }
    }

    if (oldRecord.pricingUnit !== newRecord.pricingUnit) {
      events.push(
        metadataEvent(
          oldRecord,
          newRecord,
          "pricingUnit",
          oldRecord.pricingUnit,
          newRecord.pricingUnit,
        ),
      );
    }

    if (oldRecord.provenance.sourceUrl !== newRecord.provenance.sourceUrl) {
      events.push(
        metadataEvent(
          oldRecord,
          newRecord,
          "sourceUrl",
          oldRecord.provenance.sourceUrl,
          newRecord.provenance.sourceUrl,
        ),
      );
    }
  }

  return collapseModelLifecycleEvents(events, previous, current)
    .map((event) => ChangeEventSchema.parse(event))
    .sort((left, right) => {
      const leftIdentity = pricingRecordIdentity(left);
      const rightIdentity = pricingRecordIdentity(right);
      const identityComparison =
        leftIdentity === rightIdentity
          ? 0
          : leftIdentity < rightIdentity
            ? -1
            : 1;
      if (identityComparison !== 0) return identityComparison;

      const typeComparison = eventOrder[left.type] - eventOrder[right.type];
      if (typeComparison !== 0) return typeComparison;

      const leftField = "field" in left ? left.field : "";
      const rightField = "field" in right ? right.field : "";
      if (leftField === rightField) return 0;
      return leftField < rightField ? -1 : 1;
    });
}
