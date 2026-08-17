import type { ReactNode } from "react";

type BadgeVariant = "default" | "info" | "warning" | "critical" | "success" | "muted";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-radar-surface-raised text-radar-text-secondary border-radar-border",
  info: "bg-radar-info/10 text-radar-info border-radar-info/20",
  warning: "bg-radar-warn/10 text-radar-warn border-radar-warn/20",
  critical: "bg-radar-danger/10 text-radar-danger border-radar-danger/20",
  success: "bg-radar-signal/10 text-radar-signal border-radar-signal/20",
  muted: "bg-radar-surface text-radar-text-muted border-radar-border-subtle",
};

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide border ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
