"use client";

import { useEffect, useState } from "react";

import type {
  HealingDemoRecoveryProof,
  HealingDemoRecoveryStage,
} from "../../../lib/product/healing-demo";
import {
  RECOVERY_PROOF_EXPLAINER,
  RECOVERY_PROOF_THESIS,
  RECOVERY_PROOF_TIMELINE_LABELS,
  recoveryFinalStateLabel,
  recoveryProofChips,
  recoveryStageCompactFact,
} from "../../../lib/product/healing-demo-proof-view";
import { formatAbsoluteTime } from "../../radar/utils";
import { Drawer } from "../ui/Overlay";
import { RecoveryLayoutCompare } from "./RecoveryLayoutCompare";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}

function stageStatus(
  index: number,
  revealed: number,
  playing: boolean,
  total: number,
): "pending" | "active" | "done" {
  if (index >= revealed) return "pending";
  if (playing && revealed < total && index === revealed - 1) return "active";
  return "done";
}

/**
 * Historical recovery replay. Animates already-recorded stages in the UI.
 * Never calls a mutation API.
 */
export function RecoveryProofReplay({ proof }: { proof: HealingDemoRecoveryProof }) {
  const stages = proof.stages;
  const reducedMotion = usePrefersReducedMotion();
  const [revealed, setRevealed] = useState(stages.length);
  const [playing, setPlaying] = useState(false);
  const [inspecting, setInspecting] = useState<HealingDemoRecoveryStage | null>(null);

  useEffect(() => {
    if (!playing || reducedMotion || revealed >= stages.length) return;
    const timer = window.setTimeout(() => {
      setRevealed((current) => Math.min(current + 1, stages.length));
    }, 420);
    return () => window.clearTimeout(timer);
  }, [playing, revealed, reducedMotion, stages.length]);

  if (!proof.available) return null;

  const chips = recoveryProofChips(proof);
  const finalLabel = recoveryFinalStateLabel(proof);

  const replayProof = () => {
    if (reducedMotion) {
      setPlaying(false);
      setRevealed(stages.length);
      return;
    }
    setPlaying(true);
    setRevealed(0);
  };

  const skipToResult = () => {
    setPlaying(false);
    setRevealed(stages.length);
  };

  return (
    <section
      className={`radar-proof ${playing ? "radar-proof-playing" : ""}`}
      aria-labelledby="verified-recovery-heading"
    >
      <p className="radar-proof-historical" role="note">
        Historical · already completed · read-only
      </p>

      <header className="radar-proof-hero">
        <p className="radar-healing-kicker">Verified recovery proof</p>
        <h2 id="verified-recovery-heading" className="radar-proof-state">
          {finalLabel ?? "Recorded"}
        </h2>
        {proof.recoveredAt && (
          <p className="radar-proof-when">
            <time dateTime={proof.recoveredAt}>{formatAbsoluteTime(proof.recoveredAt)}</time>
          </p>
        )}
        <p className="radar-proof-note">{proof.note}</p>
      </header>

      <ol className="radar-proof-explainer" aria-label="What happened">
        {RECOVERY_PROOF_EXPLAINER.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      {chips.length > 0 && (
        <ul className="radar-proof-chips" aria-label="Verified recovery facts">
          {chips.map((chip) => (
            <li key={chip.id} className="radar-proof-chip">
              <span className="radar-proof-chip-label">{chip.label}</span>
              <span className="radar-proof-chip-value">{chip.value}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="radar-proof-roles">
        <article className="radar-proof-role radar-proof-role-bd">
          <p className="radar-healing-kicker">Bright Data Scraper Studio</p>
          <p className="radar-proof-role-title">Collects + repairs the source</p>
        </article>
        <article className="radar-proof-role">
          <p className="radar-healing-kicker">Sentinel</p>
          <p className="radar-proof-role-title">Decides whether extracted data is trusted</p>
        </article>
      </div>
      <p className="radar-proof-thesis">{RECOVERY_PROOF_THESIS}</p>

      <RecoveryLayoutCompare proof={proof} />

      {stages.length > 0 && (
        <div className="radar-proof-timeline-wrap">
          <div className="radar-proof-timeline-bar">
            <h3 className="radar-proof-timeline-title">Recorded recovery</h3>
            <div className="radar-proof-timeline-actions">
              <button
                type="button"
                className="radar-secondary-button"
                onClick={replayProof}
              >
                Replay proof
              </button>
              <button
                type="button"
                className="radar-secondary-button"
                onClick={() => {
                  const recovered =
                    stages.find((stage) => stage.id === "recovered") ?? stages.at(-1) ?? null;
                  if (recovered) setInspecting(recovered);
                }}
              >
                Inspect evidence
              </button>
              <button
                type="button"
                className="radar-secondary-button"
                onClick={skipToResult}
              >
                Skip to result
              </button>
            </div>
          </div>

          <ol className="radar-proof-timeline" aria-label="Historical recovery timeline">
            {stages.map((stage, index) => {
              const status = stageStatus(index, revealed, playing, stages.length);
              const compact = recoveryStageCompactFact(stage, proof);
              const recovered = stage.id === "recovered" && status === "done";
              return (
                <li
                  key={stage.id}
                  className={`radar-proof-node radar-proof-node-${status}${recovered ? " radar-proof-node-recovered" : ""}`}
                >
                  {index > 0 && (
                    <span
                      className={`radar-proof-connector radar-proof-connector-${status === "pending" ? "pending" : "done"}`}
                      aria-hidden="true"
                    />
                  )}
                  <button
                    type="button"
                    className="radar-proof-node-button"
                    aria-current={status === "active" ? "step" : undefined}
                    onClick={() => setInspecting(stage)}
                  >
                    <span className="radar-proof-node-label">
                      {RECOVERY_PROOF_TIMELINE_LABELS[stage.id]}
                    </span>
                    {compact && <span className="radar-proof-node-fact">{compact}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <Drawer
        open={inspecting !== null}
        title={inspecting ? RECOVERY_PROOF_TIMELINE_LABELS[inspecting.id] : "Stage"}
        kicker={inspecting?.kind === "context" ? "Published setup" : "Recorded evidence"}
        onClose={() => setInspecting(null)}
      >
        {inspecting && (
          <div className="radar-proof-inspect">
            <p className="radar-proof-inspect-summary">{inspecting.summary}</p>
            {inspecting.at && (
              <p>
                <span className="radar-subheading">Timestamp</span>
                <time dateTime={inspecting.at}>{formatAbsoluteTime(inspecting.at)}</time>
              </p>
            )}
            {inspecting.evidence.length > 0 && (
              <dl className="radar-healing-bd">
                {inspecting.evidence.map((item) => (
                  <div key={`${item.label}-${item.value}`} className="radar-healing-bd-row">
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </Drawer>
    </section>
  );
}
