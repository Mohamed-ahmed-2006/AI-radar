import type { ChangeType, HealthStatus } from "./types";

export function formatRelativeTime(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function formatAbsoluteTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

export function changeTypeLabel(type: ChangeType): string {
  const labels: Record<ChangeType, string> = {
    price_change: "Price change",
    model_launch: "Model launch",
    model_removal: "Model removal",
    deprecation: "Deprecation",
    source_refresh: "Source refresh",
    schema_update: "Schema update",
  };
  return labels[type];
}

export function healthStatusLabel(status: HealthStatus): string {
  const labels: Record<HealthStatus, string> = {
    healthy: "Healthy",
    degraded: "Degraded",
    down: "Down",
    unknown: "Unknown",
  };
  return labels[status];
}

export function stalenessPercent(
  stalenessMinutes: number | null,
  expectedIntervalMinutes: number | null,
): number {
  if (stalenessMinutes === null || expectedIntervalMinutes === null || expectedIntervalMinutes <= 0) return 0;
  return Math.min(100, Math.round((stalenessMinutes / expectedIntervalMinutes) * 100));
}
