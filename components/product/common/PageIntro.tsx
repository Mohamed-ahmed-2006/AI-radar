import type { ReactNode } from "react";

/** Shared page heading, matching the dashboard's intro block. */
export function PageIntro({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="radar-page-intro">
      <div className="min-w-0">
        <h1 className="radar-page-title">{title}</h1>
        <p className="radar-page-description">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
