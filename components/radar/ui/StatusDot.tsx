import type { HealthStatus } from "../types";
import { healthStatusLabel } from "../utils";

const statusColors: Record<HealthStatus, string> = {
  healthy: "bg-radar-signal",
  operational: "bg-radar-info",
  degraded: "bg-radar-warn",
  down: "bg-radar-danger",
  unknown: "bg-radar-muted",
};

interface StatusDotProps {
  status: HealthStatus;
  label?: string;
  pulse?: boolean;
  size?: "sm" | "md";
  /**
   * Set when something adjacent already names the state — a Sentinel badge,
   * for instance. The dot then adds no text of its own, so the state cannot be
   * announced twice, and cannot be announced in two different vocabularies:
   * this dot speaks the health-dot vocabulary ("Healthy") while a Sentinel
   * badge beside it may correctly read "Recovered".
   */
  decorative?: boolean;
}

export function StatusDot({
  status,
  label,
  pulse = false,
  size = "sm",
  decorative = false,
}: StatusDotProps) {
  const sizeClass = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  const ariaLabel = label ?? healthStatusLabel(status);

  return (
    <span
      className="inline-flex items-center gap-1.5"
      role={decorative ? undefined : "status"}
    >
      <span
        className={`inline-block rounded-full ${sizeClass} ${statusColors[status]} ${pulse && status === "healthy" ? "animate-radar-pulse" : ""}`}
        aria-hidden="true"
      />
      {label ? (
        // The visible label already reads the state out. Emitting the same
        // words again as screen-reader-only text made the state appear twice
        // in the accessibility tree and in any text extraction of the page.
        <span className="text-xs text-radar-text-secondary">{label}</span>
      ) : (
        !decorative && <span className="sr-only">{ariaLabel}</span>
      )}
    </span>
  );
}
