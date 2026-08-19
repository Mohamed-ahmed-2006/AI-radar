import { formatAbsoluteTime, formatRelativeTime } from "../../radar/utils";
import type { FreshnessView } from "../../../lib/product/explorer";

/** Freshness with a word plus an optional timestamp — never colour alone. */
export function FreshnessStatus({ freshness }: { freshness: FreshnessView }) {
  return (
    <span
      className={`radar-freshness radar-freshness-${freshness.quality}`}
      title={freshness.description}
    >
      <span className="radar-freshness-label">{freshness.label}</span>
      {freshness.observedAt ? (
        <time
          dateTime={freshness.observedAt}
          className="radar-freshness-time"
          title={formatAbsoluteTime(freshness.observedAt)}
        >
          {formatRelativeTime(freshness.observedAt)}
        </time>
      ) : (
        <span className="radar-freshness-time">Not observed</span>
      )}
    </span>
  );
}
