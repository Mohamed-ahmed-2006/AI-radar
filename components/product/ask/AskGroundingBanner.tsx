import { ASK_GROUNDING_STATEMENT } from "../../../lib/product/ask";

/** Always-visible disclosure that this answer is grounded, not remembered. */
export function AskGroundingBanner({
  statement = ASK_GROUNDING_STATEMENT,
}: {
  statement?: string;
}) {
  return (
    <p className="radar-ask-grounding" role="status">
      <span className="radar-evidence-banner-tag">Grounded</span>
      <span>{statement}</span>
    </p>
  );
}
