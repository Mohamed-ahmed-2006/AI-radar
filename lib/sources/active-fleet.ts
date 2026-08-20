/**
 * Active-source semantics, in one place.
 *
 * A `sources` row is never deleted: a demo source that has been superseded, or
 * a collector that has been retired, keeps its runs, incidents and healing
 * attempts so the history stays inspectable. `is_active` is what separates the
 * fleet that is *currently collected* from the rows that only carry history.
 *
 * Every read model that answers "what is the fleet" — the dashboard, the source
 * directory and the Sentinel fleet view — filters through here, so the three
 * screens cannot disagree about how many sources there are or what state they
 * are in. A detail page addressed by id deliberately does not filter: asking
 * for a superseded source by name is asking for its history.
 */

import { DEMO_PROVIDER_SLUG } from "../demo-healing/source";

/** Any row carrying the view's `is_active` column. */
export interface ActivatableSourceRow {
  is_active: boolean;
}

export function isActiveSourceRow(row: ActivatableSourceRow): boolean {
  return row.is_active === true;
}

export function activeSourceRows<T extends ActivatableSourceRow>(
  rows: readonly T[],
): T[] {
  return rows.filter(isActiveSourceRow);
}

/**
 * The self-healing demonstration runs against its own provider and its own
 * source. It is a real collection source and belongs in the source directory
 * and the fleet counts — but it is not part of the AI ecosystem being tracked,
 * so a deliberately broken demo collector must never be reported as the AI
 * provider ecosystem being down.
 */
export function isDemoProviderSlug(slug: string | null | undefined): boolean {
  return slug === DEMO_PROVIDER_SLUG;
}
