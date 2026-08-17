import type { HealthStatus } from "../types";
import { healthStatusLabel } from "../utils";

const statusColors: Record<HealthStatus, string> = {
  healthy: "bg-radar-signal",
  degraded: "bg-radar-warn",
  down: "bg-radar-danger",
  unknown: "bg-radar-muted",
};

interface StatusDotProps {
  status: HealthStatus;
  label?: string;
  pulse?: boolean;
  size?: "sm" | "md";
}

export function StatusDot({
  status,
  label,
  pulse = false,
  size = "sm",
}: StatusDotProps) {
  const sizeClass = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  const ariaLabel = label ?? healthStatusLabel(status);

  return (
    <span className="inline-flex items-center gap-1.5" role="status">
      <span
        className={`inline-block rounded-full ${sizeClass} ${statusColors[status]} ${pulse && status === "healthy" ? "animate-radar-pulse" : ""}`}
        aria-hidden="true"
      />
      {label && (
        <span className="text-xs text-radar-text-secondary">{label}</span>
      )}
      <span className="sr-only">{ariaLabel}</span>
    </span>
  );
}
