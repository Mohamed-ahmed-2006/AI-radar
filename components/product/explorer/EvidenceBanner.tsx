import type { EvidenceQuality } from "../../../lib/product/explorer";

/** Catalog-level stale / degraded banner. Hidden when evidence is current. */
export function EvidenceBanner({
  quality,
  note,
}: {
  quality: EvidenceQuality;
  note: string | null;
}) {
  if (quality === "current" || !note) return null;

  return (
    <p
      className={`radar-evidence-banner radar-evidence-banner-${quality}`}
      role="status"
    >
      <span className="radar-evidence-banner-tag">{quality}</span>
      <span>{note}</span>
    </p>
  );
}
