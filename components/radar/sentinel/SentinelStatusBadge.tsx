import type { ComponentProps } from "react";

import { Badge } from "../ui/Badge";
import type { SentinelStatus } from "./types";
import { sentinelStatusLabel } from "./utils";

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

const statusVariant: Record<SentinelStatus, BadgeVariant> = {
  healthy: "success",
  recovered: "success",
  healing: "info",
  degraded: "warning",
  quarantined: "critical",
  needs_review: "critical",
};

const statusDot: Record<SentinelStatus, string> = {
  healthy: "bg-radar-signal",
  recovered: "bg-radar-signal",
  healing: "bg-radar-info",
  degraded: "bg-radar-warn",
  quarantined: "bg-radar-danger",
  needs_review: "bg-radar-danger",
};

interface SentinelStatusBadgeProps {
  status: SentinelStatus;
  /** `lg` is for the incident spotlight, where the verdict is the headline. */
  size?: "sm" | "lg";
}

export function SentinelStatusBadge({
  status,
  size = "sm",
}: SentinelStatusBadgeProps) {
  const sizeClass =
    size === "lg" ? "px-2 py-1 text-[11px] tracking-[0.12em] gap-1.5" : "gap-1";
  const dotSize = size === "lg" ? "h-1.5 w-1.5" : "h-1 w-1";

  return (
    <Badge variant={statusVariant[status]} className={sizeClass}>
      <span
        className={`inline-block rounded-full ${dotSize} ${statusDot[status]} ${
          status === "healing" ? "animate-radar-pulse" : ""
        }`}
        aria-hidden="true"
      />
      {sentinelStatusLabel(status)}
    </Badge>
  );
}
