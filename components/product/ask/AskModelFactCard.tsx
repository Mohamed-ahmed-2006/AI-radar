"use client";

import Link from "next/link";
import { useState } from "react";


import {
  askModelFactHeadline,
  askModelFactStatusLabel,
  type AskModelFactView,
} from "../../../lib/product/ask";
import { formatAbsoluteTime } from "../../radar/utils";
import { ProvenanceDetails } from "../provenance/ProvenanceDetails";
import { TrustBadge } from "../provenance/TrustBadge";
import { Drawer } from "../ui/Overlay";
import { FreshnessStatus } from "../explorer/FreshnessStatus";
import type { FreshnessView } from "../../../lib/product/explorer";

export function AskModelFactCard({
  fact,
  freshness,
}: {
  fact: AskModelFactView;
  freshness: FreshnessView;
}) {
  const [inspecting, setInspecting] = useState(false);
  const headline = askModelFactHeadline(fact);
  const statusLabel = askModelFactStatusLabel(fact);
  const subject = fact.subject.replace(/^\w/, (letter) => letter.toUpperCase());

  return (
    <section
      className={`radar-ask-fact radar-ask-fact-${fact.status}`}
      aria-labelledby="ask-fact-heading"
    >
      <p className="radar-ask-fact-kicker">Model fact</p>
      <h2 id="ask-fact-heading" className="radar-ask-fact-model">
        {fact.modelHref ? (
          <Link href={fact.modelHref} className="radar-explorer-model-link">
            {fact.modelName}
          </Link>
        ) : (
          fact.modelName
        )}
      </h2>
      <p className="radar-ask-fact-provider">{fact.providerName}</p>

      <p className="radar-ask-fact-subject">{subject}</p>
      <p className={`radar-ask-fact-value radar-ask-fact-value-${fact.status}`}>
        {headline}
      </p>
      <p className="radar-ask-fact-status">
        <span className={`radar-ask-fact-chip radar-ask-fact-chip-${fact.status}`}>
          {statusLabel}
        </span>
      </p>

      {fact.status === "unsupported" && fact.statement && (
        <p className="radar-ask-fact-reason">
          Authoritative source enumerates what is supported: “{fact.statement}”
        </p>
      )}
      {fact.status === "unknown" && fact.reason && (
        <p className="radar-ask-fact-reason">{fact.reason}</p>
      )}

      <dl className="radar-ask-fact-meta">
        {fact.sourceLabel && (
          <div>
            <dt>Grounded from</dt>
            <dd>{fact.sourceLabel}</dd>
          </div>
        )}
        {fact.observedAt && (
          <div>
            <dt>Observed</dt>
            <dd>
              <time dateTime={fact.observedAt}>{formatAbsoluteTime(fact.observedAt)}</time>
            </dd>
          </div>
        )}
        <div>
          <dt>Freshness</dt>
          <dd>
            <FreshnessStatus freshness={freshness} />
          </dd>
        </div>
        {fact.provenance && (
          <div>
            <dt>Provenance</dt>
            <dd>
              <TrustBadge trust={fact.provenance.trust} />
            </dd>
          </div>
        )}
      </dl>

      {fact.provenance && (
        <button
          type="button"
          className="radar-inline-link"
          onClick={() => setInspecting(true)}
        >
          Inspect evidence
        </button>
      )}

      <Drawer
        open={inspecting}
        title={fact.modelName}
        kicker={`${subject} · evidence`}
        onClose={() => setInspecting(false)}
      >
        {fact.provenance ? (
          <ProvenanceDetails provenance={fact.provenance} />
        ) : (
          <p>No provenance record was attached to this fact.</p>
        )}
      </Drawer>
    </section>
  );
}
