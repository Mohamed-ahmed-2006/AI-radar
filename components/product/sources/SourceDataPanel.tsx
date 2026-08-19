import { Panel } from "../../radar/ui/Panel";
import { formatAbsoluteTime } from "../../radar/utils";
import type {
  SectionState,
  SourceObservedData,
  SourceSnapshotRef,
} from "../../../lib/product/source-detail";
import { UnavailableNote } from "../common/UnavailableNote";

function count(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

/**
 * Observed versus trusted volume, and the last-known-good snapshot that keeps
 * serving when a run cannot be trusted.
 */
export function SourceDataPanel({
  observedData,
  lastKnownGood,
}: {
  observedData: SectionState<SourceObservedData>;
  lastKnownGood: SectionState<SourceSnapshotRef>;
}) {
  return (
    <Panel
      id="source-data"
      title="Observed and trusted data"
      subtitle="What arrived, what was trusted, and what is being served"
    >
      <div className="radar-surface-stack-tight">
        {!observedData.available ? (
          <UnavailableNote reason={observedData.reason} />
        ) : (
          <dl className="radar-metric-row">
            <div className="radar-metric">
              <dt className="radar-metric-label">Observed</dt>
              <dd className="radar-metric-value">{count(observedData.data.observedRecords)}</dd>
            </div>
            <div className="radar-metric">
              <dt className="radar-metric-label">Trusted</dt>
              <dd className="radar-metric-value">{count(observedData.data.trustedRecords)}</dd>
            </div>
            <div className="radar-metric">
              <dt className="radar-metric-label">Rejected</dt>
              <dd className="radar-metric-value">{count(observedData.data.rejectedRecords)}</dd>
            </div>
          </dl>
        )}

        <div>
          <h3 className="radar-subheading">Last-known-good state</h3>
          {!lastKnownGood.available ? (
            <UnavailableNote reason={lastKnownGood.reason} />
          ) : (
            <dl className="radar-fact-grid">
              <div className="radar-fact">
                <dt className="radar-fact-label">Records held</dt>
                <dd className="radar-fact-value">{count(lastKnownGood.data.recordCount)}</dd>
              </div>
              <div className="radar-fact">
                <dt className="radar-fact-label">Observed</dt>
                <dd className="radar-fact-value">
                  {lastKnownGood.data.observedAt ? (
                    <time dateTime={lastKnownGood.data.observedAt}>
                      {formatAbsoluteTime(lastKnownGood.data.observedAt)}
                    </time>
                  ) : (
                    "not recorded"
                  )}
                </dd>
              </div>
              {lastKnownGood.data.runId && (
                <div className="radar-fact">
                  <dt className="radar-fact-label">Run</dt>
                  <dd className="radar-fact-value font-mono">{lastKnownGood.data.runId}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </div>
    </Panel>
  );
}
