import type { ObservedBoolean } from "../../../lib/product/explorer";
import { capabilityTone } from "./format";

/**
 * Capability cell that never treats "not observed" as "unsupported".
 *
 * Colour is reinforcement only — the word is always present. Unknown uses
 * no cross mark.
 */
export function CapabilityStatus({
  value,
  compact = false,
}: {
  value: ObservedBoolean;
  compact?: boolean;
}) {
  const tone = capabilityTone(value);
  const text = compact ? value.label : value.description;

  return (
    <span className={`radar-capability radar-capability-${tone}${tone === "unknown" ? " radar-unknown-quiet" : ""}`}>
      <span className="radar-capability-mark" aria-hidden="true">
        {tone === "supported" ? "●" : tone === "unsupported" ? "○" : "–"}
      </span>
      <span className="radar-capability-label">{text}</span>
    </span>
  );
}
