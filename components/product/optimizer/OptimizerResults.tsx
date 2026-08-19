import Link from "next/link";

import {
  compareEligibleHref,
  type AppliedConstraint,
  type OptimizerReadModel,
} from "../../../lib/product/optimizer";
import { EmptyState } from "../../radar/ui/DataState";
import { Panel } from "../../radar/ui/Panel";
import { OptimizerModelCard } from "./OptimizerModelCard";

function AppliedConstraints({
  constraints,
}: {
  constraints: readonly AppliedConstraint[];
}) {
  if (constraints.length === 0) return null;

  return (
    <section aria-labelledby="optimizer-constraints-heading">
      <h2 id="optimizer-constraints-heading" className="radar-subheading">
        Applied constraints
      </h2>
      <dl className="radar-constraint-list">
        {constraints.map((constraint) => (
          <div key={constraint.id} className="radar-constraint">
            <dt>{constraint.label}</dt>
            <dd>{constraint.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function OptimizerResults({ result }: { result: OptimizerReadModel }) {
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

  return (
    <div className="radar-surface-stack">
      <AppliedConstraints constraints={result.appliedConstraints} />

      {result.bestFit && (
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
          <OptimizerModelCard result={result.bestFit} featured />
        </Panel>
      )}

      {result.ranked.length > 0 && (
        <Panel
          id="optimizer-ranked"
          title="Ranked eligible models"
          subtitle={`${result.ranked.length} eligible · costs supplied by the adapter`}
        >
          <ol className="radar-optimizer-rank-list" aria-label="Ranked eligible models">
            {result.ranked.map((model) => (
              <li key={model.identity.canonicalId} value={model.rank ?? undefined}>
                <OptimizerModelCard result={model} />
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {result.other.length > 0 && (
        <Panel
          id="optimizer-other"
          title="Not ranked"
          subtitle="Excluded, unknown evidence, or unavailable pricing — not treated as unsupported"
        >
          <ul className="radar-optimizer-other-list" aria-label="Models not ranked">
            {result.other.map((model) => (
              <li key={model.identity.canonicalId}>
                <OptimizerModelCard result={model} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
