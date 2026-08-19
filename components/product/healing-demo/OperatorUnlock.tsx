"use client";

import { useState } from "react";

/**
 * Operator unlock for the healing demo controls.
 *
 * Shown only after the server has answered 401 and said an unlock is possible.
 * The credential is posted once to `/api/operator/session`, which replies with
 * a signed `HttpOnly` cookie; this component never stores it, never puts it in
 * a URL, and cannot read the cookie back. That is the whole point — it is what
 * lets a public deployment keep the mutating actions closed without relying on
 * `AI_RADAR_HEALING_DEMO_OPEN_CONTROLS`.
 */
interface OperatorUnlockProps {
  onUnlocked: () => void;
}

export function OperatorUnlock({ onUnlocked }: OperatorUnlockProps) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key.trim()) return;
    setStatus("working");
    try {
      const response = await fetch("/api/operator/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!response.ok) {
        setStatus("failed");
        return;
      }
      setKey("");
      setStatus("idle");
      onUnlocked();
    } catch {
      setStatus("failed");
    }
  }

  return (
    <form className="radar-healing-unlock" onSubmit={submit}>
      <label className="radar-healing-unlock-label" htmlFor="operator-key">
        Operator key
      </label>
      <p className="radar-healing-controls-copy">
        These steps run real Bright Data jobs, so they are closed to anonymous
        visitors. Unlocking opens a one-hour session in this browser only.
      </p>
      <div className="radar-healing-unlock-row">
        <input
          id="operator-key"
          className="radar-healing-unlock-input"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          disabled={status === "working"}
          aria-describedby={status === "failed" ? "operator-key-error" : undefined}
        />
        <button
          type="submit"
          className="radar-healing-action"
          disabled={status === "working" || key.trim().length === 0}
        >
          {status === "working" ? "Unlocking…" : "Unlock controls"}
        </button>
      </div>
      {status === "failed" && (
        <p id="operator-key-error" role="alert" className="radar-healing-unlock-error">
          That key was not accepted.
        </p>
      )}
    </form>
  );
}
