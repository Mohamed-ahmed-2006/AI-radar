"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MockDataBadge } from "./MockDataBadge";
import { RadarMark } from "./RadarMark";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "#changes", label: "Changes" },
  { href: "#pricing", label: "Pricing" },
  { href: "#sources", label: "Sources" },
];

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
          <ul className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : false;
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
