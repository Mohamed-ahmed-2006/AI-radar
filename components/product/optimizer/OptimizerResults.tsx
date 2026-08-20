"use client";

import { useState } from "react";
import Link from "next/link";

import {
  compareEligibleHref,
  type OptimizerModelResult,
  type OptimizerReadModel,
} from "../../../lib/product/optimizer";
import { compareHref, modelDetailHref } from "../../../lib/product/explorer";
import { EmptyState } from "../../radar/ui/DataState";
import { Panel } from "../../radar/ui/Panel";
import { CapabilityStatus } from "../explorer/CapabilityStatus";
import { formatObservedTokens } from "../explorer/format";
import { Drawer } from "../ui/Overlay";
import { OptimizerModelCard } from "./OptimizerModelCard";

const PROMINENT_AFTER_WINNER = 6;

function RankRow({
  result,
  onInspect,
}: {
  result: OptimizerModelResult;
  onInspect: (result: OptimizerModelResult) => void;
}) {
  return (
    <tr className="radar-table-row">
      <td className="radar-table-cell tabular-nums text-radar-text-muted">
        {result.rank ?? "—"}
      </td>
      <td className="radar-table-cell">
        <Link
          href={modelDetailHref(result.identity.canonicalId)}
          className="radar-explorer-model-link"
        >
          {result.identity.displayName}
        </Link>
        <p className="text-[10px] text-radar-text-muted">{result.identity.providerName}</p>
      </td>
      <td className="radar-table-cell tabular-nums">{result.estimatedMonthlyCostLabel}</td>
      <td className="radar-table-cell font-mono text-xs">
        {formatObservedTokens(result.contextWindow)}
      </td>
      <td className="radar-table-cell">
        <CapabilityStatus value={result.toolCalling} compact />
      </td>
      <td className="radar-table-cell">{result.eligibilityLabel}</td>
      <td className="radar-table-cell text-right">
        <button type="button" className="radar-inline-link" onClick={() => onInspect(result)}>
          Inspect
        </button>
      </td>
    </tr>
  );
}

export function OptimizerResults({ result }: { result: OptimizerReadModel }) {
  const [inspected, setInspected] = useState<OptimizerModelResult | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);
  const [showOther, setShowOther] = useState(false);

  const compareHrefValue = compareEligibleHref(result.ranked);
  const hasModels = result.ranked.length > 0 || result.other.length > 0;

  if (!hasModels) {
    return (
      <EmptyState
        title="No models were returned"
        description={
          result.emptyReason ??
          "The optimizer adapter returned an empty set for these constraints."
        }
      />
    );
  }

  const winner = result.bestFit;
  const rest = winner
    ? result.ranked.filter(
        (model) => model.identity.canonicalId !== winner.identity.canonicalId,
      )
    : result.ranked;
  const prominent = rest.slice(0, PROMINENT_AFTER_WINNER);
  const leftover = rest.slice(PROMINENT_AFTER_WINNER);
  const visibleRest = showRemaining ? rest : prominent;

  return (
    <div className="radar-surface-stack">
      {winner && (
        <Panel
          id="optimizer-best-fit"
          title="Best fit"
          subtitle="Adapter-ranked eligible model. The UI does not calculate this ranking."
          action={
            result.ranked.length > 1 ? (
              <Link href={compareHrefValue} className="radar-compare-go">
                Compare eligible
              </Link>
            ) : (
              <Link href="/models" className="radar-inline-link">
                Browse models
              </Link>
            )
          }
        >
          <div className="radar-winner-spotlight">
            <p className="radar-optimizer-rank">Rank {winner.rank ?? 1}</p>
            <h3 className="radar-winner-name">
              <Link
                href={modelDetailHref(winner.identity.canonicalId)}
                className="radar-explorer-model-link"
              >
                {winner.identity.displayName}
              </Link>
            </h3>
            <p className="radar-winner-cost">
              {winner.estimatedMonthlyCostLabel}
              {winner.estimatedMonthlyCost !== null ? " / month" : ""}
            </p>
            {winner.requirementChecks.some((check) => check.status === "pass") && (
              <ul className="radar-winner-matches">
                {winner.requirementChecks
                  .filter((check) => check.status === "pass")
                  .slice(0, 4)
                  .map((check) => (
                    <li key={check.id}>{check.label}</li>
                  ))}
              </ul>
            )}
            <div className="radar-winner-actions">
              <button
                type="button"
                className="radar-secondary-button"
                onClick={() => setInspected(winner)}
              >
                Inspect decision
              </button>
              {winner.eligibility === "eligible" && (
                <Link
                  href={compareHref([winner.identity.canonicalId])}
                  className="radar-inline-link"
                >
                  Compare
                </Link>
              )}
            </div>
          </div>
        </Panel>
      )}

      {rest.length > 0 && (
        <Panel
          id="optimizer-ranked"
          title="Ranked eligible models"
          subtitle={`${result.ranked.length} eligible · costs supplied by the adapter`}
        >
          <ol className="sr-only" aria-label="Ranked eligible models">
            {result.ranked.map((model) => (
              <li key={model.identity.canonicalId} value={model.rank ?? undefined}>
                {model.identity.displayName}
              </li>
            ))}
          </ol>
          <div className="radar-table-scroll">
            <table className="radar-table w-full" aria-label="Eligible ranking table">
              <thead>
                <tr>
                  <th scope="col" className="radar-table-head text-left">Rank</th>
                  <th scope="col" className="radar-table-head text-left">Model</th>
                  <th scope="col" className="radar-table-head text-left">Cost</th>
                  <th scope="col" className="radar-table-head text-left">Context</th>
                  <th scope="col" className="radar-table-head text-left">Tools</th>
                  <th scope="col" className="radar-table-head text-left">Match</th>
                  <th scope="col" className="radar-table-head text-right">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {visibleRest.map((model) => (
                  <RankRow
                    key={model.identity.canonicalId}
                    result={model}
                    onInspect={setInspected}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {leftover.length > 0 && (
            <button
              type="button"
              className="radar-inline-link mt-3"
              onClick={() => setShowRemaining((open) => !open)}
            >
              {showRemaining
                ? "Show fewer"
                : `Show remaining ${leftover.length}`}
            </button>
          )}
        </Panel>
      )}

      {result.other.length > 0 && (
        <details
          className="radar-panel"
          open={showOther}
          onToggle={(event) =>
            setShowOther((event.target as HTMLDetailsElement).open)
          }
        >
          <summary className="radar-panel-header cursor-pointer">
            <div>
              <h2 className="radar-panel-title">Not ranked</h2>
              <p className="radar-panel-subtitle">
                {result.other.length} excluded, unknown evidence, or unavailable pricing — not treated as unsupported
              </p>
            </div>
          </summary>
          <div className="radar-panel-body">
            {showOther && (
            <ul className="radar-optimizer-other-list" aria-label="Models not ranked">
              {result.other.map((model) => (
                <li key={model.identity.canonicalId}>
                  <OptimizerModelCard result={model} />
                </li>
              ))}
            </ul>
            )}
          </div>
        </details>
      )}

      {inspected && (
        <Drawer
          open
          title={inspected.identity.displayName}
          kicker="Decision detail"
          onClose={() => setInspected(null)}
        >
          <OptimizerModelCard result={inspected} featured={inspected === winner} />
        </Drawer>
      )}
    </div>
  );
}
