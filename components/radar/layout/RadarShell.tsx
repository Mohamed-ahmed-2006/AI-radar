import type { ReactNode } from "react";
import { RadarHeader } from "./RadarHeader";

interface RadarShellProps {
  children: ReactNode;
  footer?: ReactNode;
}

export function RadarShell({ children, footer }: RadarShellProps) {
  return (
    <div className="radar-shell min-h-full flex flex-col">
      <RadarHeader />
      <main className="radar-main flex-1">{children}</main>
      {footer && <footer className="radar-footer">{footer}</footer>}
    </div>
  );
}
