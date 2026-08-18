import type { ChangeDirection } from "../../../lib/product/change-feed";

const DIRECTION_CLASS: Record<ChangeDirection, string> = {
  increase: "radar-delta-up",
  decrease: "radar-delta-down",
  none: "",
};

const DIRECTION_GLYPH: Record<ChangeDirection, string> = {
  increase: "▲",
  decrease: "▼",
  none: "",
};

const DIRECTION_WORD: Record<ChangeDirection, string> = {
  increase: "increase",
  decrease: "decrease",
  none: "",
};

/**
 * The before → after pair for a change, when the backend recorded both sides.
 *
 * Direction is carried by the word in the screen-reader text as well as the
 * arrow and colour, so the movement is never conveyed by colour alone.
 */
export function BeforeAfter({
  before,
  after,
  delta,
  direction,
  field,
}: {
  before: string | null;
  after: string | null;
  delta: string | null;
  direction: ChangeDirection;
  field?: string | null;
}) {
  if (before === null && after === null) return null;

  return (
    <dl className="radar-delta" aria-label={field ? `${field} before and after` : "Before and after"}>
      <div className="radar-delta-side">
        <dt className="radar-delta-label">Before</dt>
        <dd className="radar-delta-value">{before ?? "not recorded"}</dd>
      </div>
      <span className="radar-delta-arrow" aria-hidden="true">
        →
      </span>
      <div className="radar-delta-side">
        <dt className="radar-delta-label">After</dt>
        <dd className="radar-delta-value">{after ?? "not recorded"}</dd>
      </div>
      {delta && (
        <div className="radar-delta-side">
          <dt className="radar-delta-label">Change</dt>
          <dd className={`radar-delta-value ${DIRECTION_CLASS[direction]}`}>
            {direction !== "none" && (
              <span aria-hidden="true">{DIRECTION_GLYPH[direction]} </span>
            )}
            {delta}
            {direction !== "none" && (
              <span className="sr-only"> {DIRECTION_WORD[direction]}</span>
            )}
          </dd>
        </div>
      )}
    </dl>
  );
}
