"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MockDataBadge } from "./MockDataBadge";
import { RadarMark } from "./RadarMark";
import {
  ASK_NAV,
  RADAR_PRIMARY_NAV,
  RADAR_SECONDARY_NAV,
  isRouteActive,
} from "./nav";

export function RadarHeader({ isMock }: { isMock: boolean }) {
  const pathname = usePathname();
  const askActive = isRouteActive(pathname, ASK_NAV.href);

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
            {RADAR_PRIMARY_NAV.map((item) => {
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
          <Link
            href={ASK_NAV.href}
            className={`radar-ask-nav ${askActive ? "radar-ask-nav-active" : ""}`}
            aria-current={askActive ? "page" : undefined}
          >
            {ASK_NAV.label}
          </Link>
          <MockDataBadge isMock={isMock} />
        </div>
      </div>

      <nav className="radar-secondary-nav" aria-label="Product tools">
        <ul className="radar-secondary-nav-list">
          {RADAR_SECONDARY_NAV.map((item) => {
            const isActive = isRouteActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`radar-secondary-link ${isActive ? "radar-secondary-link-active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
