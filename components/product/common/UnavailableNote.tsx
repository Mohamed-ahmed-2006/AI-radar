/**
 * The explicit "we do not have this" state.
 *
 * Used instead of a blank panel or a plausible-looking zero, so a reader can
 * tell "nothing happened" apart from "this backend cannot answer yet".
 */
export function UnavailableNote({ reason }: { reason: string }) {
  return (
    <p className="radar-unavailable" role="note">
      <span className="radar-unavailable-tag">Not available</span>
      <span>{reason}</span>
    </p>
  );
}
