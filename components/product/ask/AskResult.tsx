import Link from "next/link";

import type { AskReadModel } from "../../../lib/product/ask";
import { formatAbsoluteTime } from "../../radar/utils";
import { EmptyState } from "../../radar/ui/DataState";
import { Panel } from "../../radar/ui/Panel";
import { FreshnessStatus } from "../explorer/FreshnessStatus";
import { ProvenanceDisclosure } from "../provenance/ProvenanceDisclosure";
import { AskGroundingBanner } from "./AskGroundingBanner";

function intentClass(intent: AskReadModel["intent"]): string {
  return `radar-ask-intent radar-ask-intent-${intent}`;
}

export function AskResult({ result }: { result: AskReadModel }) {
  if (result.intent === "empty") {
    return (
      <EmptyState
        title="Ask a grounded question"
        description="Temporal questions about observed changes, or decision questions about eligible models. AI Radar will not answer from model memory."
      />
    );
  }

  return (
    <article className="radar-ask-result" aria-labelledby="ask-result-heading">
      <AskGroundingBanner statement={result.groundingStatement} />

      <Panel
        id="ask-answer"
        title="Grounded answer"
        subtitle={`${result.intentLabel} query`}
        action={<FreshnessStatus freshness={result.freshness} />}
      >
        <p className="radar-ask-question">
          <span className="radar-subheading">Your question</span>
          <span id="ask-result-heading">{result.question}</span>
        </p>

        <p className={intentClass(result.intent)}>
          Interpreted as {result.intentLabel}
        </p>

        {result.interpretedConstraints.length > 0 && (
          <section aria-labelledby="ask-constraints-heading">
            <h3 id="ask-constraints-heading" className="radar-subheading">
              Interpreted constraints
            </h3>
            <dl className="radar-constraint-list">
              {result.interpretedConstraints.map((constraint) => (
                <div key={constraint.id} className="radar-constraint">
                  <dt>{constraint.label}</dt>
                  <dd>{constraint.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <p className="radar-ask-answer">{result.answer}</p>

        {result.unsupportedReason && (
          <p className="radar-ask-unsupported" role="status">
            {result.unsupportedReason}
          </p>
        )}

        {result.missingData && (
          <p className="radar-ask-missing" role="note">
            Missing data: {result.missingData}
          </p>
        )}

        {result.observedAt && (
          <p className="radar-ask-observed">
            Observed{" "}
            <time dateTime={result.observedAt}>
              {formatAbsoluteTime(result.observedAt)}
            </time>
          </p>
        )}

        {result.provenance && (
          <ProvenanceDisclosure
            provenance={result.provenance}
            subject="this answer"
          />
        )}
      </Panel>

      {result.calculations.length > 0 && (
        <Panel
          id="ask-calculations"
          title="Calculations"
          subtitle="Supplied by the adapter. The UI does not calculate these figures."
        >
          <ul className="radar-ask-calc-list" aria-label="Adapter calculations">
            {result.calculations.map((calculation) => (
              <li key={calculation.label} className="radar-ask-calc">
                <p className="radar-ask-calc-label">{calculation.label}</p>
                {calculation.expression && (
                  <p className="radar-ask-calc-expression">{calculation.expression}</p>
                )}
                <p className="radar-ask-calc-result">{calculation.result}</p>
                {calculation.note && (
                  <p className="radar-ask-calc-note">{calculation.note}</p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {result.evidence.length > 0 && (
        <Panel
          id="ask-evidence"
          title="Structured evidence"
          subtitle="Each row traces back to an observed model, change or source"
        >
          <ul className="radar-ask-evidence-list" aria-label="Grounded evidence">
            {result.evidence.map((item) => (
              <li key={item.id} className={`radar-ask-evidence radar-ask-evidence-${item.kind}`}>
                <p className="radar-ask-evidence-kind">{item.kind}</p>
                <h3 className="radar-ask-evidence-title">
                  {item.href ? (
                    <Link href={item.href} className="radar-explorer-model-link">
                      {item.title}
                    </Link>
                  ) : (
                    item.title
                  )}
                </h3>
                <p className="radar-ask-evidence-summary">{item.summary}</p>
                {item.observedAt && (
                  <p className="radar-ask-observed">
                    Observed{" "}
                    <time dateTime={item.observedAt}>
                      {formatAbsoluteTime(item.observedAt)}
                    </time>
                  </p>
                )}
                <div className="radar-optimizer-card-links">
                  {item.modelCanonicalId && (
                    <Link
                      href={`/models/${encodeURIComponent(item.modelCanonicalId)}`}
                      className="radar-inline-link"
                    >
                      Model detail
                    </Link>
                  )}
                  {item.sourceId && (
                    <Link
                      href={`/sources/${encodeURIComponent(item.sourceId)}`}
                      className="radar-inline-link"
                    >
                      Source
                    </Link>
                  )}
                  {item.kind === "change" && (
                    <Link href="/changes" className="radar-inline-link">
                      Changes
                    </Link>
                  )}
                  {item.href && item.kind === "note" && (
                    <Link href={item.href} className="radar-inline-link">
                      Open related view
                    </Link>
                  )}
                </div>
                {item.provenance && (
                  <ProvenanceDisclosure
                    provenance={item.provenance}
                    subject={item.title}
                  />
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </article>
  );
}
