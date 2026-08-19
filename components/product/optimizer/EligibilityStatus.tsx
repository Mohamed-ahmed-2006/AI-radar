import {
  optimizerEligibilityLabel,
  type OptimizerEligibility,
} from "../../../lib/product/optimizer";

/**
 * Eligibility is always a word. Colour is reinforcement only — unknown
 * evidence never reads as unsupported, and a red tone never stands in for
 * "Excluded".
 */
export function EligibilityStatus({
  eligibility,
  label,
}: {
  eligibility: OptimizerEligibility;
  label?: string;
}) {
  const text = label ?? optimizerEligibilityLabel(eligibility);
  const mark =
    eligibility === "eligible" ? "●" : eligibility === "excluded" ? "○" : "–";

  return (
    <span className={`radar-eligibility radar-eligibility-${eligibility}`}>
      <span className="radar-eligibility-mark" aria-hidden="true">
        {mark}
      </span>
      <span className="radar-eligibility-label">{text}</span>
    </span>
  );
}
