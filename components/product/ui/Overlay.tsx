"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

function useEscape(onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}

function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const root = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = root.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const nodes = [
        ...root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => !node.hasAttribute("disabled"));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [active]);

  return ref;
}

export function Drawer({
  open,
  title,
  kicker,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  kicker?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const trap = useFocusTrap(open);
  useEscape(onClose, open);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="radar-overlay" onClick={onClose}>
      <aside
        ref={trap}
        className="radar-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="radar-drawer-header">
          <div>
            {kicker && <p className="radar-drawer-kicker">{kicker}</p>}
            <h2 id={titleId} className="radar-drawer-title">
              {title}
            </h2>
          </div>
          <button type="button" className="radar-icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="radar-drawer-body">{children}</div>
        {footer && <footer className="radar-drawer-foot">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const trap = useFocusTrap(open);
  useEscape(onClose, open);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const onDialogKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div className="radar-overlay" onClick={onClose}>
      <div className="radar-modal">
        <div
          ref={trap}
          className="radar-modal-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={onDialogKey}
        >
          <header className="radar-modal-header">
            <h2 id={titleId} className="radar-drawer-title">
              {title}
            </h2>
            <button type="button" className="radar-icon-button" onClick={onClose} aria-label="Close">
              ×
            </button>
          </header>
          <div className="radar-modal-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
