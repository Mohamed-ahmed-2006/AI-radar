"use client";

/**
 * Adds or removes one canonical model from My Stack.
 *
 * State is announced in the label and in `aria-pressed`, so the control never
 * relies on its fill colour to say whether the model is being watched.
 */
export function WatchButton({
  watched,
  modelLabel,
  onToggle,
  disabled = false,
  size = "sm",
}: {
  watched: boolean;
  /** Named in the accessible label so a long list stays unambiguous. */
  modelLabel: string;
  onToggle: () => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={watched}
      className={`radar-watch-button ${watched ? "radar-watch-button-on" : ""} ${
        size === "md" ? "radar-watch-button-md" : ""
      }`}
    >
      <span aria-hidden="true">{watched ? "★" : "☆"}</span>
      <span>{watched ? "In My Stack" : "Add to My Stack"}</span>
      <span className="sr-only">: {modelLabel}</span>
    </button>
  );
}
