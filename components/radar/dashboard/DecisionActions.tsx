import Link from "next/link";

/**
 * Dashboard entry points for the two decision-intelligence experiences.
 * Ask is a strong action here rather than another crowded header item.
 */
export function DecisionActions() {
  return (
    <section className="radar-decision-actions" aria-label="Decision intelligence">
      <Link href="/optimizer" className="radar-decision-card">
        <p className="radar-subheading">Stack Optimizer</p>
        <h2 className="radar-decision-card-title">Find the best-fit model</h2>
        <p className="radar-decision-card-copy">
          Rank eligible models for your workload. Unknown capabilities stay
          unknown — they are never treated as unsupported.
        </p>
      </Link>
      <Link href="/ask" className="radar-decision-card radar-decision-card-ask">
        <p className="radar-subheading">Ask AI Radar</p>
        <h2 className="radar-decision-card-title">Ask from live evidence</h2>
        <p className="radar-decision-card-copy">
          Temporal and decision questions, answered from trusted observations —
          not model memory.
        </p>
      </Link>
    </section>
  );
}
