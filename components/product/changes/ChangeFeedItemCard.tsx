import { Badge } from "../../radar/ui/Badge";
import { formatAbsoluteTime, formatRelativeTime } from "../../radar/utils";
import {
  type ChangeFeedItem,
  type ChangeTone,
  significanceTierLabel,
} from "../../../lib/product/change-feed";
import { modelDetailHref } from "../../../lib/product/explorer";
import { ProvenanceDisclosure } from "../provenance/ProvenanceDisclosure";
import { WatchButton } from "../watchlist/WatchButton";
import { BeforeAfter } from "./BeforeAfter";
import Link from "next/link";

const TONE_VARIANT: Record<ChangeTone, "success" | "critical" | "warning" | "info" | "muted"> = {
  positive: "success",
  negative: "critical",
  warning: "warning",
  info: "info",
  neutral: "muted",
};

interface ChangeFeedItemCardProps {
  item: ChangeFeedItem;
  watched?: boolean;
  /** Omitted where the watch control does not belong, such as in print views. */
  onToggleWatch?: () => void;
  watchDisabled?: boolean;
}

/**
 * One ecosystem change: who changed what, from what to what, when, how much it
 * matters, and the record proving it.
 */
export function ChangeFeedItemCard({
  item,
  watched = false,
  onToggleWatch,
  watchDisabled = false,
}: ChangeFeedItemCardProps) {
  return (
    <li
      className={`radar-change-item ${watched ? "radar-change-item-watched" : ""}`}
      aria-labelledby={`change-${item.id}-summary`}
    >
      <div className="radar-change-item-head">
        <Badge variant={TONE_VARIANT[item.tone]}>{item.changeTypeLabel}</Badge>
        <Badge variant="muted">{item.categoryLabel}</Badge>
        {watched && <Badge variant="success">In My Stack</Badge>}
        {item.isDemo && <Badge variant="warning">Demo</Badge>}
        <time
          dateTime={item.observedAt}
          title={formatAbsoluteTime(item.observedAt)}
          className="radar-change-item-time"
        >
          {formatRelativeTime(item.observedAt)}
        </time>
      </div>

      <p className="radar-change-item-model">
        <span className="text-radar-text-secondary">{item.providerName}</span>
        <span aria-hidden="true"> · </span>
        <Link href={modelDetailHref(item.modelKey)} className="radar-explorer-model-link font-mono">
          {item.modelLabel}
        </Link>
      </p>

      <p id={`change-${item.id}-summary`} className="radar-change-item-summary">
        {item.summary}
      </p>

      <BeforeAfter
        before={item.before}
        after={item.after}
        delta={item.delta}
        direction={item.direction}
        field={item.field}
      />

      <div className="radar-change-item-foot">
        <span className="radar-change-item-significance">
          {significanceTierLabel(item.significanceTier)}
          <span aria-hidden="true"> · </span>
          <span className="tabular-nums">{item.significanceScore}</span>
          <span className="sr-only"> significance score out of 100</span>
        </span>
        <span className="radar-page-intro-links">
          {item.sourceId && (
            <Link
              href={`/sources/${encodeURIComponent(item.sourceId)}`}
              className="radar-inline-link"
            >
              Source
            </Link>
          )}
          <Link href="/source-health" className="radar-inline-link">
            Source Health
          </Link>
        </span>
        {onToggleWatch && (
          <WatchButton
            watched={watched}
            modelLabel={item.modelLabel}
            onToggle={onToggleWatch}
            disabled={watchDisabled}
          />
        )}
      </div>

      <ProvenanceDisclosure
        provenance={item.provenance}
        subject={`${item.providerName} ${item.modelLabel} ${item.changeTypeLabel.toLowerCase()}`}
      />
    </li>
  );
}
