/**
 * Model-fact resolution and lookup: the deterministic half of `MODEL_FACT`.
 *
 * The planner produces a *phrase* and a *field*. Neither is a fact. This module
 * turns the phrase into exactly one canonical model or into nothing, then reads
 * the requested field off that model's current trusted evidence.
 *
 * Three rules govern everything here.
 *
 *   * Identity is resolved, never assumed. A phrase that matches no observed
 *     model, or more than one, produces no answer at all. "What does GPT-6
 *     cost?" fails closed for exactly this reason, and it will keep failing
 *     closed until a collector observes a model called GPT-6.
 *   * Unknown is not Unsupported. A null context window means nobody published
 *     one. It never becomes a zero, and it never becomes "no".
 *   * Unsupported requires a positive statement. The only way a missing
 *     modality becomes "unsupported" is when the source published a sentence
 *     enumerating the supported ones. That sentence is returned with the answer
 *     so a reader can check the reasoning rather than trust it.
 *
 * Nothing in this file consults a language model, and nothing in it knows a
 * model fact of its own.
 */

import type { ModelExplorerEntry } from "../explorer";
import type { ProvenanceView } from "../product/provenance";
import type { ModelFactField, ModelFactModality } from "./intent";

/** How a phrase matched, so an answer can say why this model was chosen. */
export type ModelFactMatchKind = "exact" | "prefix";

export interface ResolvedModelFact {
  entry: ModelExplorerEntry;
  matchKind: ModelFactMatchKind;
  /** The candidate key that matched, exactly as the catalog publishes it. */
  matchedOn: string;
}

export type ModelIdentityResolution =
  | { status: "resolved"; resolved: ResolvedModelFact }
  | { status: "unresolved" }
  | { status: "ambiguous"; candidates: string[] };

/**
 * Folds a model reference to a comparable key.
 *
 * `Claude Opus 5`, `claude-opus-5` and `Claude  Opus  5` are the same reference
 * written three ways, and a reader who types any of them means the same model.
 * Everything else — case, separators, the dot in `4.5` — is presentation.
 */
export function normalizeModelKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Every published name a canonical model can legitimately be called by. */
function candidateKeys(entry: ModelExplorerEntry): string[] {
  const keys = new Set<string>();
  for (const value of [entry.modelName, entry.displayName, entry.apiModelId]) {
    if (!value) continue;
    const key = normalizeModelKey(value);
    if (key) keys.add(key);
  }
  return [...keys];
}

function labelOf(entry: ModelExplorerEntry): string {
  return entry.displayName ?? entry.modelName;
}

/**
 * Resolves a model phrase against the canonical catalog.
 *
 * Exact matches are considered first and alone: when a phrase names a model
 * outright, a prefix that also happens to start with it is irrelevant. Only if
 * nothing matched exactly does the prefix tier run, which is what lets
 * `Claude Haiku 4.5` reach the pinned id `claude-haiku-4-5-20251001` without
 * letting `Claude` reach every Claude model.
 *
 * Either tier resolving to more than one canonical model is ambiguity, and
 * ambiguity is not broken by ordering — the caller is told which models
 * matched and answers nothing.
 */
export function resolveModelIdentity(
  entries: readonly ModelExplorerEntry[],
  query: string,
): ModelIdentityResolution {
  const wanted = normalizeModelKey(query);
  if (!wanted) return { status: "unresolved" };

  const tiers: ReadonlyArray<{
    kind: ModelFactMatchKind;
    matches: (key: string) => boolean;
  }> = [
    { kind: "exact", matches: (key) => key === wanted },
    { kind: "prefix", matches: (key) => key.startsWith(`${wanted}-`) },
  ];

  for (const tier of tiers) {
    const hits: ResolvedModelFact[] = [];
    for (const entry of entries) {
      const matched = candidateKeys(entry).find(tier.matches);
      if (matched) hits.push({ entry, matchKind: tier.kind, matchedOn: matched });
    }

    const distinct = new Map<string, ResolvedModelFact>();
    for (const hit of hits) {
      if (!distinct.has(hit.entry.canonicalModelId)) {
        distinct.set(hit.entry.canonicalModelId, hit);
      }
    }

    if (distinct.size === 1) {
      return { status: "resolved", resolved: [...distinct.values()][0] };
    }
    if (distinct.size > 1) {
      return {
        status: "ambiguous",
        candidates: [...distinct.values()].map((hit) => labelOf(hit.entry)),
      };
    }
  }

  return { status: "unresolved" };
}

// ---------------------------------------------------------------------------
// Field lookup
// ---------------------------------------------------------------------------

export type ModelFactValue =
  | {
      status: "observed";
      /** Rendered exactly as the answer will state it. */
      display: string;
      /** The raw observation, for the structured result and for tests. */
      value: number | boolean | string | string[];
    }
  | {
      status: "unsupported";
      display: string;
      /** The source sentence that makes this an absence rather than a silence. */
      statement: string;
    }
  | { status: "unknown"; reason: string };

export interface ModelFactLookup {
  field: ModelFactField;
  fieldLabel: string;
  /**
   * What the answer is about, in the sentence's own words: "context window",
   * "video input", "lifecycle state".
   *
   * Kept apart from `fieldLabel` because a modality question is about one
   * modality, not about the whole list — and because a value like "supported"
   * only makes sense once something has been named to be supported.
   */
  subject: string;
  modality: ModelFactModality | null;
  value: ModelFactValue;
  /** Provenance for the evidence domain the field was read from. */
  provenance: ProvenanceView | null;
  observedAt: string | null;
}

/**
 * Every numeric figure this lookup is allowed to have put in its sentence.
 *
 * The groundedness check compares the published text against this list, so a
 * price or a token count that did not come from the observation cannot survive
 * into an answer.
 */
export function modelFactAmounts(lookup: ModelFactLookup): number[] {
  if (lookup.value.status !== "observed") return [];
  const { value } = lookup.value;
  if (typeof value === "number") return [value];
  const amounts: number[] = [];
  for (const match of lookup.value.display.matchAll(/(\d+(?:\.\d+)?)/g)) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) amounts.push(parsed);
  }
  return amounts;
}

export const MODEL_FACT_FIELD_LABELS: Record<ModelFactField, string> = {
  context_window: "Context window",
  max_output_tokens: "Max output",
  input_price: "Input price",
  output_price: "Output price",
  price: "Price",
  vision: "Vision",
  tool_calling: "Tool calling",
  input_modality: "Input modalities",
  output_modality: "Output modalities",
  lifecycle: "Lifecycle",
};

/**
 * What the sentence names before it states the value.
 *
 * A modality question is about one modality, so it says "video input", not
 * "input modalities" — asking about video and being told the input modalities
 * are unsupported would be a different, wrong claim.
 */
export function modelFactSubject(
  field: ModelFactField,
  modality: ModelFactModality | null,
): string {
  if (modality && field === "input_modality") return `${modality} input`;
  if (modality && field === "output_modality") return `${modality} output`;
  if (field === "lifecycle") return "lifecycle state";
  return MODEL_FACT_FIELD_LABELS[field].toLowerCase();
}

function tokens(value: number): string {
  return `${value.toLocaleString("en-US")} tokens`;
}

function money(value: number, currency: string | null): string {
  return `$${value.toFixed(2)} per 1M ${currency && currency !== "USD" ? `${currency} ` : ""}tokens`;
}

const CONFLICTED =
  "Several API model ids currently claim this model while publishing different " +
  "capability evidence, so the capability evidence is withheld rather than resolved " +
  "by arrival order.";

function unknown(reason: string): ModelFactValue {
  return { status: "unknown", reason };
}

/**
 * Reads one modality question off the model's evidence.
 *
 * The three answers are genuinely different claims and are kept apart:
 *   * the modality is in the observed list — supported;
 *   * it is absent and the source enumerated what is supported — unsupported,
 *     with the enumerating sentence attached;
 *   * it is absent and the source enumerated nothing — unknown.
 */
function modalityFact(
  entry: ModelExplorerEntry,
  direction: "input" | "output",
  modality: ModelFactModality | null,
): ModelFactValue {
  const capabilities = entry.capabilities;
  if (capabilities.conflicted) return unknown(CONFLICTED);

  const observed =
    direction === "input" ? capabilities.inputModalities : capabilities.outputModalities;

  if (modality === null) {
    if (observed.length === 0) {
      return unknown(
        `No ${direction} modalities have been observed for ${labelOf(entry)} from a trusted source.`,
      );
    }
    return { status: "observed", display: observed.join(", "), value: [...observed] };
  }

  if (observed.includes(modality)) {
    return { status: "observed", display: "supported", value: true };
  }

  const statement = capabilities.modalityStatement;
  if (statement && observed.length > 0) {
    return {
      status: "unsupported",
      display: "not supported",
      statement,
    };
  }

  return unknown(
    observed.length === 0
      ? `No ${direction} modalities have been observed for ${labelOf(entry)}, so whether it accepts ` +
        `${modality} ${direction} is unknown rather than unsupported.`
      : `The observed ${direction} modalities for ${labelOf(entry)} (${observed.join(", ")}) are not ` +
        `published as an exhaustive list, so ${modality} ${direction} is unknown rather than unsupported.`,
  );
}

function booleanFact(
  entry: ModelExplorerEntry,
  observed: boolean | null,
  supported: string,
  unsupportedText: string,
  unknownText: string,
): ModelFactValue {
  if (entry.capabilities.conflicted) return unknown(CONFLICTED);
  if (observed === true) return { status: "observed", display: supported, value: true };
  if (observed === false) return { status: "observed", display: unsupportedText, value: false };
  return unknown(unknownText);
}

/**
 * Reads the requested field off one resolved model.
 *
 * Every branch either returns a value that came from a stored observation or
 * returns `unknown` with the reason. There is no default, no fallback and no
 * inference from a neighbouring field.
 */
export function lookupModelFact(
  entry: ModelExplorerEntry,
  field: ModelFactField,
  modality: ModelFactModality | null,
): ModelFactLookup {
  const label = labelOf(entry);
  const capability = {
    provenance: entry.provenance.capability,
    observedAt: entry.capabilities.observedAt,
  };
  const pricing = {
    provenance: entry.provenance.pricing,
    observedAt: entry.pricing.observedAt,
  };
  const lifecycle = {
    provenance: entry.provenance.lifecycle,
    observedAt: entry.lifecycle.observedAt,
  };

  const base = {
    field,
    fieldLabel: MODEL_FACT_FIELD_LABELS[field],
    subject: modelFactSubject(field, modality),
    modality,
  };
  const tier = entry.pricing.primary;

  switch (field) {
    case "context_window": {
      if (entry.capabilities.conflicted) {
        return { ...base, value: unknown(CONFLICTED), ...capability };
      }
      const value = entry.capabilities.contextWindow;
      return {
        ...base,
        ...capability,
        value:
          value === null
            ? unknown(`No context window has been observed for ${label} from a trusted source.`)
            : { status: "observed", display: tokens(value), value },
      };
    }
    case "max_output_tokens": {
      if (entry.capabilities.conflicted) {
        return { ...base, value: unknown(CONFLICTED), ...capability };
      }
      const value = entry.capabilities.maxOutputTokens;
      return {
        ...base,
        ...capability,
        value:
          value === null
            ? unknown(`No max output limit has been observed for ${label} from a trusted source.`)
            : { status: "observed", display: tokens(value), value },
      };
    }
    case "input_price": {
      const value = tier?.inputPricePer1MTokens ?? null;
      return {
        ...base,
        ...pricing,
        value:
          value === null
            ? unknown(`No published input price has been observed for ${label}.`)
            : { status: "observed", display: money(value, tier?.currency ?? null), value },
      };
    }
    case "output_price": {
      const value = tier?.outputPricePer1MTokens ?? null;
      return {
        ...base,
        ...pricing,
        value:
          value === null
            ? unknown(`No published output price has been observed for ${label}.`)
            : { status: "observed", display: money(value, tier?.currency ?? null), value },
      };
    }
    case "price": {
      const input = tier?.inputPricePer1MTokens ?? null;
      const output = tier?.outputPricePer1MTokens ?? null;
      if (input === null && output === null) {
        return {
          ...base,
          ...pricing,
          value: unknown(`No published price has been observed for ${label}.`),
        };
      }
      const parts: string[] = [];
      if (input !== null) parts.push(`${money(input, tier?.currency ?? null)} input`);
      if (output !== null) parts.push(`${money(output, tier?.currency ?? null)} output`);
      return {
        ...base,
        ...pricing,
        value: { status: "observed", display: parts.join(", "), value: parts },
      };
    }
    case "vision":
      return {
        ...base,
        ...capability,
        value: booleanFact(
          entry,
          entry.capabilities.supportsVision,
          "supported",
          "not supported",
          `Whether ${label} supports vision has not been observed from a trusted source.`,
        ),
      };
    case "tool_calling":
      return {
        ...base,
        ...capability,
        value: booleanFact(
          entry,
          entry.capabilities.supportsToolCalling,
          "supported",
          "not supported",
          `Whether ${label} supports tool calling has not been observed from a trusted source. ` +
            "AI Radar will not infer it from the pages it does collect.",
        ),
      };
    case "input_modality":
      return { ...base, ...capability, value: modalityFact(entry, "input", modality) };
    case "output_modality":
      return { ...base, ...capability, value: modalityFact(entry, "output", modality) };
    case "lifecycle": {
      const state = entry.lifecycle.state;
      return {
        ...base,
        ...lifecycle,
        value:
          state === null
            ? unknown(`No lifecycle state has been observed for ${label} from an authoritative source.`)
            : { status: "observed", display: state, value: state },
      };
    }
  }
}

/**
 * The published sentence for one lookup.
 *
 * Assembled from the lookup and nothing else, so every clause in it is a
 * restatement of a stored observation.
 */
export function modelFactAnswer(entry: ModelExplorerEntry, lookup: ModelFactLookup): string {
  const label = labelOf(entry);
  const provider = entry.provider.name;

  switch (lookup.value.status) {
    case "observed":
      return `${label} (${provider}): ${lookup.subject} is ${lookup.value.display}.`;
    case "unsupported":
      return (
        `${label} (${provider}): ${lookup.subject} is ${lookup.value.display}. The source enumerates what is ` +
        `supported — "${lookup.value.statement}" — so this is an observed absence, not a gap ` +
        "in AI Radar's evidence."
      );
    case "unknown":
      return `${label} (${provider}): unknown. ${lookup.value.reason}`;
  }
}
