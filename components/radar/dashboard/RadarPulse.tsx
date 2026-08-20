import type { EcosystemSummary } from "../types";

export function RadarPulse({
  modelCount,
  status,
}: {
  modelCount: number;
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
        <span className="tabular-nums font-semibold text-radar-text-primary">{modelCount}</span>
        <span>canonical models under observation</span>
      </p>
    </div>
  );
}
