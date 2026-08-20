"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { COMMAND_PALETTE_ROUTES } from "../../radar/layout/chrome";

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <CommandPaletteDialog onClose={onClose} />;
}

function CommandPaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return COMMAND_PALETTE_ROUTES;
    return COMMAND_PALETTE_ROUTES.filter(
      (route) =>
        route.label.toLowerCase().includes(needle) ||
        route.href.toLowerCase().includes(needle) ||
        route.group.toLowerCase().includes(needle),
    );
  }, [query]);

  const selectedIndex = Math.min(selected, Math.max(matches.length - 1, 0));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div className="radar-overlay" onClick={onClose}>
      <div className="radar-command">
        <div
          className="radar-command-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            className="radar-command-input"
            value={query}
            autoFocus
            placeholder="Go to a surface…"
            aria-label="Search routes"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((index) => Math.min(index + 1, matches.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((index) => Math.max(index - 1, 0));
              }
              if (event.key === "Enter" && matches[selectedIndex]) {
                event.preventDefault();
                go(matches[selectedIndex].href);
              }
            }}
          />
          {matches.length === 0 ? (
            <p className="radar-command-empty">No matching routes.</p>
          ) : (
            <ul className="radar-command-list" role="listbox" aria-label="Routes">
              {matches.map((route, index) => (
                <li key={route.href}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === selectedIndex}
                    className="radar-command-item"
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => go(route.href)}
                  >
                    <span>{route.label}</span>
                    <span className="radar-sidebar-hint">{route.group}</span>
                    <span className="radar-kbd">{route.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
