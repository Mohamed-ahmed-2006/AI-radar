import type { ProvenanceView } from "../../../lib/product/provenance";
import { ProvenanceDetails } from "./ProvenanceDetails";
import { TrustBadge } from "./TrustBadge";

/**
 * The provenance affordance every surface uses: a collapsed "Where did this
 * come from?" control that opens the full record in place.
 *
 * Built on `<details>`/`<summary>` so it is keyboard-operable, focusable and
 * expandable with no JavaScript — which also lets it live inside a server
 * component such as a feed row.
 */
export function ProvenanceDisclosure({
  provenance,
  label = "Where did this come from?",
  subject,
}: {
  provenance: ProvenanceView;
  label?: string;
  /** Names the value being inspected, for screen readers in a long list. */
  subject?: string;
}) {
  return (
    <details className="radar-provenance">
      <summary className="radar-provenance-summary">
        <span className="radar-provenance-summary-label">
          {label}
          {subject && <span className="sr-only"> for {subject}</span>}
        </span>
        <TrustBadge trust={provenance.trust} />
      </summary>
      <ProvenanceDetails provenance={provenance} />
    </details>
  );
}
