import { SentinelStatusBadge } from "../../radar/sentinel/SentinelStatusBadge";
import type {
  HealingDemoHistoryView,
  HealingDemoReadModel,
} from "../../../lib/product/healing-demo";
import { formatAbsoluteTime } from "../../radar/utils";

const PHASE_TONE: Record<string, string> = {
  healthy: "radar-healing-phase-healthy",
  recovered: "radar-healing-phase-healthy",
  break: "radar-healing-phase-break",
  detected: "radar-healing-phase-break",
  quarantined: "radar-healing-phase-quarantine",
  preview_failed: "radar-healing-phase-quarantine",
  healing: "radar-healing-phase-heal",
  preview_waiting: "radar-healing-phase-heal",
  preview_validated: "radar-healing-phase-heal",
  approved: "radar-healing-phase-heal",
  rerun: "radar-healing-phase-heal",
};

function storyLine(model: HealingDemoReadModel): string {
  switch (model.phase) {
    case "healthy":
      return "Trusted current is last-known-good. No candidate is held.";
    case "break":
      return "Extraction failed. Sentinel has not quarantined a candidate yet.";
    case "detected":
      return "Contract violation detected. Candidate is about to be held.";
    case "quarantined":
      return "Latest attempt is invalid. Last-known-good is unchanged.";
    case "healing":
      return "Bright Data Scraper Studio has been asked to heal the isolated collector.";
    case "preview_waiting":
      return "Waiting for a Bright Data preview. Trusted current is still last-known-good.";
    case "preview_failed":
      return "Preview failed validation. Approval is blocked. Last-known-good is unchanged.";
    case "preview_validated":
      return "Preview passed Sentinel validation. Approval is available.";
    case "approved":
      return "Validated preview approved. Ready to rerun the isolated collector.";
    case "rerun":
      return "Healed collector is rerunning. Last-known-good still served until acceptance.";
    case "recovered":
      return "New trusted current is the validated snapshot.";
    default:
      return "Waiting for the real healing backend.";
  }
}

/**
 * What this source has already done, read from its own incident and healing
 * rows. Rendered only when there is a completed recovery on file, so a demo
 * that has genuinely never run still says nothing.
 */
function HistoryLine({ history }: { history: HealingDemoHistoryView }) {
  if (!history.hasCompletedRecovery) return null;

  const facts = [
    `Last live recovery: RECOVERED${
      history.lastRecoveryAt ? ` · ${formatAbsoluteTime(history.lastRecoveryAt)}` : ""
    }`,
    history.lastKnownGoodCount !== null
      ? `LKG preserved: ${history.lastKnownGoodCount} records`
      : null,
    history.approvedHealingAttempts > 0
      ? `${history.approvedHealingAttempts} approved repair${
          history.approvedHealingAttempts === 1 ? "" : "s"
        }`
      : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <p className="radar-healing-history">
      <span className="radar-healing-history-badge">Ready for demonstration</span>
      <span className="radar-healing-history-facts">{facts.join(" · ")}</span>
    </p>
  );
}

export function HealingDemoPhaseHero({ model }: { model: HealingDemoReadModel }) {
  const phaseClass = model.phase ? PHASE_TONE[model.phase] : "radar-healing-phase-idle";
  const recovered = model.phase === "recovered";

  return (
    <section
      className={`radar-healing-hero ${phaseClass} ${recovered ? "radar-recovery-sweep" : ""}`}
      aria-labelledby="healing-demo-phase"
    >
      <p className="radar-healing-kicker">
        {model.identity?.product ?? "SourcePulse"} · {model.identity?.guardian ?? "Sentinel"}
      </p>
      <p id="healing-demo-phase" className="radar-healing-phase" role="status">
        {(model.phaseLabel ?? "Unavailable").toUpperCase()}
      </p>
      <p className="radar-healing-story">{storyLine(model)}</p>
      {model.history && <HistoryLine history={model.history} />}
      {model.sentinelStatus && (
        <p className="radar-healing-hero-badge">
          <SentinelStatusBadge status={model.sentinelStatus} size="lg" />
          <span className="sr-only">Sentinel status {model.sentinelStatus.replaceAll("_", " ")}</span>
        </p>
      )}
    </section>
  );
}
