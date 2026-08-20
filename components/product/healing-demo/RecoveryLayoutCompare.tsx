import Link from "next/link";

import { DEMO_FIXTURE_QUOTES } from "../../../lib/demo-healing/fixture-page";
import type { HealingDemoRecoveryProof } from "../../../lib/product/healing-demo";

const PREVIEW_QUOTES = DEMO_FIXTURE_QUOTES.slice(0, 3);

/**
 * Compact before/after of the public demo source pages. Content is identical;
 * only DOM structure changes. Shown only when the proof supplies both URLs.
 */
export function RecoveryLayoutCompare({
  proof,
}: {
  proof: HealingDemoRecoveryProof;
}) {
  const healthyUrl = proof.source?.healthyUrl;
  const brokenUrl = proof.source?.brokenUrl;
  if (!healthyUrl || !brokenUrl) return null;

  const extracted = proof.summary?.failedRecords;

  return (
    <section className="radar-proof-layout" aria-labelledby="proof-layout-heading">
      <header className="radar-proof-layout-head">
        <h3 id="proof-layout-heading" className="radar-proof-layout-title">
          Website layout changed
        </h3>
        <p className="radar-proof-layout-note">Same content. Different DOM structure.</p>
      </header>

      <div className="radar-proof-layout-grid">
        <article className="radar-proof-layout-pane">
          <p className="radar-healing-kicker">Before — expected page structure</p>
          <div className="radar-proof-quotes" aria-hidden="true">
            {PREVIEW_QUOTES.map((quote) => (
              <p key={quote.quoteText} className="radar-proof-quote-card">
                <span className="radar-proof-quote-text">{quote.quoteText}</span>
                <small>{quote.author}</small>
              </p>
            ))}
          </div>
          <Link href={healthyUrl} className="radar-inline-link" target="_blank" rel="noreferrer">
            Open healthy layout
          </Link>
        </article>

        <article className="radar-proof-layout-pane">
          <p className="radar-healing-kicker">After — website changed</p>
          <table className="radar-proof-quote-table" aria-hidden="true">
            <tbody>
              {PREVIEW_QUOTES.map((quote) => (
                <tr key={quote.quoteText}>
                  <td>
                    {quote.quoteText}
                    <br />
                    by {quote.author}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link href={brokenUrl} className="radar-inline-link" target="_blank" rel="noreferrer">
            Open changed layout
          </Link>
        </article>
      </div>

      {extracted != null && (
        <p className="radar-proof-extract" role="status">
          Collector extraction → {extracted} records
        </p>
      )}
    </section>
  );
}
