import type { ReactNode } from "react";
import { RadarChrome } from "./RadarChrome";

interface RadarShellProps {
  children: ReactNode;
  isMock: boolean;
  footer?: ReactNode;
}

export function RadarShell({ children, isMock, footer }: RadarShellProps) {
  return (
    <div className="radar-shell min-h-full">
      <a href="#radar-main" className="radar-skip-link">
        Skip to content
      </a>
      <RadarChrome isMock={isMock}>
        <main id="radar-main" className="radar-main flex-1" tabIndex={-1}>
          {children}
        </main>
        {footer && <footer className="radar-footer">{footer}</footer>}
      </RadarChrome>
    </div>
  );
}
