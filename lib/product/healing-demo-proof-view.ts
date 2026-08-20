/**
 * Presentation helpers for Claude's historical `recoveryProof`.
 *
 * These functions format fields the backend already reported. They do not
 * invent stages, timestamps, record counts, collector identity, or live
 * status. A chip or compact fact is omitted when the supporting field is
 * missing rather than filled with a placeholder claim.
 */

import type {
  HealingDemoReadModel,
  HealingDemoRecoveryProof,
  HealingDemoRecoveryStage,
  HealingDemoRecoveryStageId,
} from "./healing-demo";

export const RECOVERY_PROOF_TIMELINE_LABELS: Record<
  HealingDemoRecoveryStageId,
  string
> = {
  trusted_baseline: "Trusted baseline",
  source_layout_changed: "Website layout changed",
  invalid_extraction: "Invalid extraction",
  sentinel_detected: "Sentinel detected",
  quarantined: "Quarantined",
  last_known_good_preserved: "LKG preserved",
  bright_data_repair: "Bright Data repair",
  candidate_validated: "Candidate validated",
  approved: "Approved",
  recovery_rerun: "Rerun",
  recovered: "Recovered",
};

export const RECOVERY_PROOF_THESIS =
  "Bright Data repairs extraction. Sentinel decides whether repaired data may become truth.";

export interface RecoveryProofChip {
  id: string;
  label: string;
  value: string;
}

export function isCleanHealingDemoSession(model: HealingDemoReadModel): boolean {
  return model.phase === "healthy" && model.busy !== true;
}

export function evidenceValue(
  stage: HealingDemoRecoveryStage,
  label: string,
): string | null {
  const item = stage.evidence.find((entry) => entry.label === label);
  if (!item || item.value.trim() === "") return null;
  return item.value;
}

export function recoveryProofChips(
  proof: HealingDemoRecoveryProof,
): RecoveryProofChip[] {
  if (!proof.available) return [];
  const chips: RecoveryProofChip[] = [];
  const summary = proof.summary;
  if (summary?.lastKnownGoodPreserved && summary.baselineRecords != null) {
    chips.push({
      id: "lkg",
      label: "LKG preserved",
      value: String(summary.baselineRecords),
    });
  }
  if (summary?.zeroBadCanonicalWrites) {
    chips.push({
      id: "zero-writes",
      label: "Bad canonical writes",
      value: "0",
    });
  } else if (summary?.canonicalWritesFromInvalidRun != null) {
    chips.push({
      id: "invalid-writes",
      label: "Canonical writes from invalid run",
      value: String(summary.canonicalWritesFromInvalidRun),
    });
  }
  if (proof.collector?.sameCollectorConfirmed) {
    chips.push({
      id: "same-collector",
      label: "Same collector repaired",
      value: "Confirmed",
    });
  }
  if (summary?.recoveredRecords != null) {
    chips.push({
      id: "recovered-count",
      label: "Accepted recovered",
      value: String(summary.recoveredRecords),
    });
  }
  if (proof.isLiveEvidence) {
    chips.push({
      id: "live-evidence",
      label: "Real Bright Data evidence",
      value: "Live",
    });
  }
  return chips;
}

export function recoveryStageCompactFact(
  stage: HealingDemoRecoveryStage,
  proof?: HealingDemoRecoveryProof,
): string | null {
  switch (stage.id) {
    case "trusted_baseline": {
      const seen = evidenceValue(stage, "Records seen");
      const accepted = evidenceValue(stage, "Records accepted");
      if (seen && accepted) return `${accepted} / ${seen} accepted`;
      if (accepted) return `${accepted} accepted`;
      return null;
    }
    case "source_layout_changed":
      return "Same content. Different DOM structure.";
    case "invalid_extraction": {
      const seen = evidenceValue(stage, "Records seen");
      const accepted = evidenceValue(stage, "Records accepted");
      if (seen) return `${seen} records`;
      if (accepted) return `${accepted} accepted`;
      return null;
    }
    case "sentinel_detected":
      return evidenceValue(stage, "Reason codes");
    case "quarantined": {
      const writes = evidenceValue(stage, "Canonical writes from this run");
      if (writes === "0") return "Write blocked";
      if (writes) return `${writes} canonical writes`;
      return null;
    }
    case "last_known_good_preserved": {
      const atIncident = evidenceValue(stage, "Records at incident time");
      const today = evidenceValue(stage, "Canonical rows today");
      if (atIncident) return `${atIncident} trusted records still served`;
      if (today) return `${today} canonical rows still held`;
      return null;
    }
    case "bright_data_repair":
      if (proof?.collector?.sameCollectorConfirmed) return "Same collector refactored";
      return evidenceValue(stage, "Collector") ? "Collector refactored" : null;
    case "candidate_validated": {
      const verdict = evidenceValue(stage, "Contract verdict");
      if (verdict === "passed") return "Passed contract";
      if (verdict === "failed") return "Failed contract";
      return verdict;
    }
    case "approved":
      return evidenceValue(stage, "Attempt status") === "approved"
        ? "Approved"
        : evidenceValue(stage, "Incident status") === "resolved"
          ? "Incident resolved"
          : null;
    case "recovery_rerun": {
      const accepted = evidenceValue(stage, "Records accepted");
      const seen = evidenceValue(stage, "Records seen");
      if (seen && accepted) return `${accepted} / ${seen} accepted`;
      if (accepted) return `${accepted} accepted`;
      return null;
    }
    case "recovered": {
      const rows = evidenceValue(stage, "Canonical rows from the recovery run");
      const accepted = proof?.summary?.recoveredRecords;
      if (accepted != null && rows) return `${accepted} / ${rows} accepted`;
      if (accepted != null) return `${accepted} accepted`;
      if (rows) return `${rows} accepted`;
      return evidenceValue(stage, "Final incident status") === "resolved"
        ? "Recovered"
        : null;
    }
    default:
      return null;
  }
}

export function recoveryFinalStateLabel(
  proof: HealingDemoRecoveryProof,
): string | null {
  if (!proof.available || !proof.summary) return null;
  return proof.summary.finalState === "recovered"
    ? "Recovered"
    : "Approved · awaiting rerun";
}
