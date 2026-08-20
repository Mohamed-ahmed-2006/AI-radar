import type { EcosystemSummary } from "../types";

/**
 * The hero read-out names both model counts.
 *
 * Showing only the priced total next to an Explorer listing a larger number
 * reads as though the product cannot count its own models. They are two
 * different questions, so both are stated.
 */
export function RadarPulse({
  pricedModels,
  modelIdentities,
  status,
}: {
  pricedModels: number;
  modelIdentities: number;
  status: EcosystemSummary["status"];
}) {
  return (
    <div className="radar-pulse-card">
      <div className="radar-pulse-stage" aria-hidden="true">
        <span className="radar-pulse-ring" />
        <span className="radar-pulse-ring" />
        <span className="radar-pulse-ring" />
        <span className="radar-pulse-sweep" />
      </div>
      <div className="radar-pulse-copy">
        <p className="radar-pulse-kicker">Ecosystem</p>
        <p className="radar-pulse-value capitalize">{status}</p>
      </div>
      <p className="radar-pulse-meta">
        <span className="tabular-nums font-semibold text-radar-text-primary">
          {pricedModels}
        </span>
        <span>models with canonical pricing</span>
        <span className="text-radar-text-muted">
          of {modelIdentities} tracked identities
        </span>
      </p>
    </div>
  );
}
