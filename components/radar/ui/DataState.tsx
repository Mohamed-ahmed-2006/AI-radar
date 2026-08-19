import type { ReactNode } from "react";

interface DataStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: DataStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center"
      role="status"
    >
      {icon && (
        <div className="text-radar-text-muted mb-1" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-radar-text-secondary">{title}</p>
      {description && (
        <p className="text-xs text-radar-text-muted max-w-xs">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ title = "Loading data…" }: { title?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-10 px-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="radar-spinner" aria-hidden="true" />
      <p className="text-xs text-radar-text-muted">{title}</p>
    </div>
  );
}

export function ErrorState({ title, description }: DataStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center border border-radar-danger/20 rounded bg-radar-danger/5"
      role="alert"
    >
      <p className="text-sm font-medium text-radar-danger">{title}</p>
      {description && (
        <p className="text-xs text-radar-text-muted max-w-xs">{description}</p>
      )}
    </div>
  );
}

export type EvidenceTone =
  | "unavailable"
  | "stale"
  | "degraded"
  | "quarantined"
  | "recovered"
  | "unknown"
  | "unsupported";

const EVIDENCE_TONE_LABEL: Record<EvidenceTone, string> = {
  unavailable: "Unavailable",
  stale: "Stale",
  degraded: "Degraded",
  quarantined: "Quarantined",
  recovered: "Recovered",
  unknown: "Unknown",
  unsupported: "Unsupported",
};

/**
 * Shared status copy for product states. Unknown is muted and dashed — never
 * the same treatment as unsupported, false, or down.
 */
export function EvidenceState({
  tone,
  title,
  description,
  action,
}: {
  tone: EvidenceTone;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const polite = tone === "unknown" || tone === "unavailable" || tone === "recovered";
  return (
    <div
      className={`radar-evidence-state radar-evidence-state-${tone}`}
      role={polite ? "status" : "alert"}
    >
      <p className="radar-evidence-state-kicker">{EVIDENCE_TONE_LABEL[tone]}</p>
      <p className="radar-evidence-state-title">{title}</p>
      {description && <p className="radar-evidence-state-copy">{description}</p>}
      {action && <div className="radar-evidence-state-action">{action}</div>}
    </div>
  );
}
