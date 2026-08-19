import { Badge } from "../../radar/ui/Badge";
import {
  type ProvenanceTrust,
  provenanceTrustDescription,
  provenanceTrustLabel,
} from "../../../lib/product/provenance";

const VARIANTS: Record<
  ProvenanceTrust,
  "success" | "info" | "warning" | "muted"
> = {
  official: "success",
  verified: "info",
  inferred: "warning",
  unverified: "muted",
};

/**
 * Trust level as words, not colour alone: the label carries the meaning and the
 * variant only reinforces it.
 */
export function TrustBadge({
  trust,
  describe = false,
}: {
  trust: ProvenanceTrust;
  /** Adds the plain-language explanation for screen readers and tooltips. */
  describe?: boolean;
}) {
  const label = provenanceTrustLabel(trust);
  const description = provenanceTrustDescription(trust);

  return (
    <Badge variant={VARIANTS[trust]} className={describe ? "cursor-help" : ""}>
      <span title={describe ? description : undefined}>{label}</span>
      {describe && <span className="sr-only">. {description}</span>}
    </Badge>
  );
}
