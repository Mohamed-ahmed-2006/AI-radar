import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  id,
}: PanelProps) {
  return (
    <section
      id={id}
      className={`radar-panel flex flex-col ${className}`}
      aria-labelledby={id ? `${id}-heading` : undefined}
    >
      <header className="radar-panel-header">
        <div className="min-w-0">
          <h2 id={id ? `${id}-heading` : undefined} className="radar-panel-title">
            {title}
          </h2>
          {subtitle && <p className="radar-panel-subtitle">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="radar-panel-body flex-1 min-h-0">{children}</div>
    </section>
  );
}
