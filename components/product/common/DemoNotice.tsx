import type { ReactNode } from "react";

/**
 * Says out loud that what is on screen is the seeded demo dataset, not observed
 * production telemetry. Rendered wherever demo data can reach the UI so demo
 * evidence is never mistakable for a real ecosystem event.
 */
export function DemoNotice({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <aside className="radar-demo-notice" role="note" aria-label="Demo data notice">
      <span className="radar-demo-notice-tag">Demo data</span>
      <div className="min-w-0">
        <p className="radar-demo-notice-title">{title}</p>
        {children && <p className="radar-demo-notice-body">{children}</p>}
      </div>
    </aside>
  );
}
