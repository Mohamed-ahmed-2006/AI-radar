import type { NormalizedCatalogRecord } from "../contracts";

/**
 * An API model id is lowercase, carries no whitespace, and contains at least
 * one separator: `gemini-3.7-flash`, `veo-3.1-fast-generate-preview`,
 * `imagen-4.0-generate-001`. A bare word such as `imagen` is a family or page
 * name, not something callable, so it never qualifies.
 */
const API_MODEL_ID = /^[a-z0-9]+(?:[.\-_][a-z0-9]+)+$/;

/**
 * Some provider pages document a whole family in one place and publish every
 * member's code in a single "Model code" row, space separated. That string is
 * an enumeration, not an identifier, and must never become a canonical API
 * model id.
 *
 * Returns the enumerated ids when the source unambiguously lists several real
 * ids, and null when it does not. Null is the safe answer: a value that is a
 * single token, or that contains anything not shaped like an API model id, or
 * that repeats an id, is left exactly as the source published it rather than
 * guessed at.
 */
export function splitEnumeratedApiModelIds(value: string): string[] | null {
  const tokens = value.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  if (!tokens.every((token) => API_MODEL_ID.test(token))) return null;
  if (new Set(tokens).size !== tokens.length) return null;
  return tokens;
}

/**
 * Expands a family page's enumerated codes into one observation per real API
 * model id.
 *
 * The capability evidence is copied to each id because the page publishes one
 * property table that it applies to every code it lists; nothing per-model is
 * invented, and no id is inferred from prose. `rawEvidence` is left untouched,
 * so each observation still carries the original space-joined string exactly
 * as the source published it.
 */
export function expandEnumeratedCatalogIdentities(
  records: readonly NormalizedCatalogRecord[],
): NormalizedCatalogRecord[] {
  const expanded: NormalizedCatalogRecord[] = [];
  for (const record of records) {
    const ids = splitEnumeratedApiModelIds(record.apiModelId);
    if (!ids) {
      expanded.push(record);
      continue;
    }
    for (const apiModelId of ids) {
      expanded.push({ ...record, apiModelId });
    }
  }
  return expanded;
}

/** The last path segment of a model detail page URL, or null. */
export function catalogPageSlug(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  try {
    const segments = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * True when a record was extracted from the page that is named after the id it
 * published. A page whose own URL disagrees with its Model code row is not
 * trustworthy evidence for that id.
 */
function pageAgreesWithPublishedId(record: NormalizedCatalogRecord): boolean {
  const slug = catalogPageSlug(record.provenance.sourceUrl);
  return slug !== null && slug === record.apiModelId;
}

/**
 * True when every record in a same-identity group observed the same capability
 * evidence, meaning the source simply emitted one model more than once.
 */
function capabilityEvidenceMatches(group: readonly NormalizedCatalogRecord[]): boolean {
  const fingerprint = (record: NormalizedCatalogRecord) =>
    JSON.stringify([
      record.displayName,
      record.modelFamily,
      record.modelStage,
      record.contextWindow,
      record.maxOutputTokens,
      record.supportsVision,
      record.supportsToolCalling,
      record.inputModalities,
      record.outputModalities,
      record.supportedFeatures,
    ]);
  const [first, ...rest] = group;
  const expected = fingerprint(first);
  return rest.every((record) => fingerprint(record) === expected);
}

export interface CatalogIdentityConflict {
  apiModelId: string;
  reason: "identity_conflict";
  detail: string;
  record: NormalizedCatalogRecord;
}

export interface CatalogIdentityResolution {
  accepted: NormalizedCatalogRecord[];
  conflicts: CatalogIdentityConflict[];
}

/**
 * Resolves one batch of observations down to at most one per API model id.
 *
 * Repeated emissions of a single model collapse. A genuine collision — two
 * observations sharing an id while carrying different capability evidence — is
 * two different models wearing one identifier, and is decided by provenance
 * rather than arrival order: when exactly one of them came from the page named
 * after that id, that page is the trustworthy evidence and the others are
 * conflicts. When provenance cannot settle it, none of them is written.
 *
 * A conflicted observation is never re-keyed onto its own page slug. Slugs name
 * pages, not models — Google serves the Imagen family from `/models/imagen`,
 * which is not a callable id — so minting an id from one would be a guess. The
 * conflict is preserved instead, with its raw evidence intact.
 */
export function resolveCatalogIdentities(
  records: readonly NormalizedCatalogRecord[],
): CatalogIdentityResolution {
  const groups = new Map<string, NormalizedCatalogRecord[]>();
  for (const record of records) {
    const existing = groups.get(record.apiModelId);
    if (existing) existing.push(record);
    else groups.set(record.apiModelId, [record]);
  }

  const accepted: NormalizedCatalogRecord[] = [];
  const conflicts: CatalogIdentityConflict[] = [];

  for (const [apiModelId, group] of groups) {
    if (group.length === 1 || capabilityEvidenceMatches(group)) {
      accepted.push(group[group.length - 1]);
      continue;
    }

    const selfConsistent = group.filter(pageAgreesWithPublishedId);
    if (selfConsistent.length === 1) {
      const trusted = selfConsistent[0];
      accepted.push(trusted);
      for (const record of group) {
        if (record === trusted) continue;
        conflicts.push({
          apiModelId,
          reason: "identity_conflict",
          detail:
            `${record.provenance.sourceUrl ?? "unknown page"} published the id of ` +
            `${trusted.provenance.sourceUrl ?? "another page"}; its own capability ` +
            `evidence cannot be attributed to a model id`,
          record,
        });
      }
      continue;
    }

    for (const record of group) {
      conflicts.push({
        apiModelId,
        reason: "identity_conflict",
        detail:
          `${group.length} pages published different capability evidence for this id ` +
          `and provenance does not identify a trustworthy one`,
        record,
      });
    }
  }

  return { accepted, conflicts };
}
