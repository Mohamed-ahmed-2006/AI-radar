import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  status?: "neutral" | "positive" | "warning" | "negative";
}

const valueColors = {
  neutral: "text-radar-text-primary",
  positive: "text-radar-signal",
  warning: "text-radar-warn",
  negative: "text-radar-danger",
};

export function StatCard({ label, value, hint, status = "neutral" }: StatCardProps) {
  return (
    <div className="radar-stat-card">
      <dt className="radar-stat-label">{label}</dt>
      <dd className={`radar-stat-value ${valueColors[status]}`}>{value}</dd>
      {hint && <dd className="radar-stat-hint">{hint}</dd>}
    </div>
  );
}
