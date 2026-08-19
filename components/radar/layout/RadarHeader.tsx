"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MockDataBadge } from "./MockDataBadge";
import { RadarMark } from "./RadarMark";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/models", label: "Models" },
  { href: "/changes", label: "Changes" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/sources", label: "Sources" },
  { href: "/my-stack", label: "My Stack" },
] as const;

/** Hash entries always target the dashboard, so they are never "the page". */
function isRouteActive(pathname: string, href: string): boolean {
  if (href.includes("#")) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function RadarHeader({ isMock }: { isMock: boolean }) {
  const pathname = usePathname();

  return (
    <header className="radar-header">
      <div className="radar-header-inner">
        <Link href="/" className="radar-brand" aria-label="AI Radar home">
          <RadarMark className="h-7 w-7 text-radar-signal shrink-0" />
          <div className="flex flex-col leading-none">
            <span className="radar-brand-name">AI Radar</span>
            <span className="radar-brand-tag">Ecosystem Intelligence</span>
          </div>
        </Link>

        <nav className="radar-nav" aria-label="Main navigation">
          <ul className="flex items-center gap-1 flex-nowrap">
            {navItems.map((item) => {
              const isActive = isRouteActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`radar-nav-link ${isActive ? "radar-nav-link-active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="radar-header-meta">
          <MockDataBadge isMock={isMock} />
        </div>
      </div>
    </header>
  );
}
