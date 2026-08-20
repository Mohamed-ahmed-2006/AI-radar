"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { ASK_NAV, isRouteActive } from "./nav";
import { pageContext, SIDEBAR_GROUPS } from "./chrome";
import { CommandPalette } from "./CommandPalette";
import { MockDataBadge } from "./MockDataBadge";
import { RadarMark } from "./RadarMark";

function NavIcon({ href }: { href: string }) {
  const common = {
    viewBox: "0 0 16 16",
    fill: "none",
    className: "radar-sidebar-link-icon",
    "aria-hidden": true as const,
  };
  switch (href) {
    case "/":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
        </svg>
      );
    case "/models":
      return (
        <svg {...common}>
          <rect x="2" y="3" width="12" height="3" rx="1" stroke="currentColor" />
          <rect x="2" y="8" width="12" height="3" rx="1" stroke="currentColor" />
        </svg>
      );
    case "/models/compare":
      return (
        <svg {...common}>
          <path d="M4 3v10M12 3v10M4 8h8" stroke="currentColor" />
        </svg>
      );
    case "/optimizer":
      return (
        <svg {...common}>
          <path d="M3 12l4-8 3 5 3-3" stroke="currentColor" />
        </svg>
      );
    case "/changes":
      return (
        <svg {...common}>
          <path d="M3 12c2-6 8-6 10 0" stroke="currentColor" />
          <circle cx="8" cy="6" r="1.5" fill="currentColor" />
        </svg>
      );
    case "/my-stack":
      return (
        <svg {...common}>
          <path d="M3 12l5-9 5 9H3z" stroke="currentColor" />
        </svg>
      );
    case "/sources":
      return (
        <svg {...common}>
          <circle cx="5" cy="8" r="2" stroke="currentColor" />
          <circle cx="11" cy="5" r="2" stroke="currentColor" />
          <circle cx="11" cy="11" r="2" stroke="currentColor" />
        </svg>
      );
    case "/source-health":
      return (
        <svg {...common}>
          <path d="M2 9h3l2-4 3 8 2-4h2" stroke="currentColor" />
        </svg>
      );
    case "/demo/healing":
      return (
        <svg {...common}>
          <path d="M8 2v12M4 6h8M4 10h8" stroke="currentColor" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2" fill="currentColor" />
        </svg>
      );
  }
}

function SidebarBody({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const askActive = isRouteActive(pathname, ASK_NAV.href);

  return (
    <>
      <Link href="/" className="radar-sidebar-brand" aria-label="AI Radar home" onClick={onNavigate}>
        <RadarMark className="h-7 w-7 text-radar-signal shrink-0" />
        <div className="flex flex-col leading-none">
          <span className="radar-brand-name">AI Radar</span>
          <span className="radar-brand-tag">Ecosystem Intelligence</span>
        </div>
      </Link>

      <nav className="radar-sidebar-nav" aria-label="Main navigation">
        <Link
          href={ASK_NAV.href}
          className={`radar-sidebar-ask ${askActive ? "radar-sidebar-ask-active" : ""}`}
          aria-current={askActive ? "page" : undefined}
          onClick={onNavigate}
        >
          {ASK_NAV.label} AI Radar
        </Link>
        {SIDEBAR_GROUPS.map((group) => (
          <div key={group.label} className="radar-nav-group">
            <p className="radar-nav-group-label">{group.label}</p>
            {group.items.map((item) => {
              const active = isRouteActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`radar-sidebar-link ${active ? "radar-sidebar-link-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <NavIcon href={item.href} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </>
  );
}

export function RadarChrome({
  isMock,
  children,
}: {
  isMock: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const context = pageContext(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <aside className="radar-sidebar">
        <SidebarBody pathname={pathname} />
        <div className="radar-sidebar-foot">
          <button
            type="button"
            className="radar-k-trigger"
            onClick={() => setPaletteOpen(true)}
          >
            Search
            <span className="radar-kbd">⌘K</span>
          </button>
          <MockDataBadge isMock={isMock} />
        </div>
      </aside>

      {mobileOpen && (
        <div className="radar-mobile-nav" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="radar-overlay"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <div className="radar-mobile-nav-panel">
            <SidebarBody pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            <div className="radar-sidebar-foot">
              <button
                type="button"
                className="radar-k-trigger"
                onClick={() => {
                  setMobileOpen(false);
                  setPaletteOpen(true);
                }}
              >
                Search
                <span className="radar-kbd">⌘K</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <div className="radar-workspace">
        <header className="radar-topbar">
          <button
            type="button"
            className="radar-menu-button"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            ☰
          </button>
          <div className="min-w-0">
            <p className="radar-topbar-title">{context.title}</p>
          </div>
          <p className="radar-topbar-status">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-radar-signal" aria-hidden="true" />
            {context.status}
          </p>
          <div className="radar-topbar-actions">
            <button
              type="button"
              className="radar-k-trigger"
              style={{ width: "auto" }}
              onClick={() => setPaletteOpen(true)}
            >
              Go to
              <span className="radar-kbd">⌘K</span>
            </button>
            <MockDataBadge isMock={isMock} />
          </div>
        </header>
        {children}
      </div>
    </>
  );
}
