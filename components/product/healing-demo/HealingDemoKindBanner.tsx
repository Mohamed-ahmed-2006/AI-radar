import type { HealingDemoKind } from "../../../lib/product/healing-demo";

/**
 * Distinguishes the real Bright Data demo from the mock Sentinel simulation.
 * This banner is never the amber "Demo data" notice used by SENTINEL_DEMO_MODE.
 */
export function HealingDemoKindBanner({
  kind,
  kindLabel,
}: {
  kind: HealingDemoKind;
  kindLabel: string;
}) {
  if (kind === "unavailable") return null;

  const isReal = kind === "real_bright_data_demo";

  return (
    <aside
      className={isReal ? "radar-healing-kind radar-healing-kind-real" : "radar-healing-kind radar-healing-kind-fixture"}
      role="note"
      aria-label={isReal ? "Real Bright Data demo" : "Fixture healing demo"}
    >
      <span className="radar-healing-kind-tag">{kindLabel}</span>
      <p className="radar-healing-kind-copy">
        {isReal
          ? "Live SourcePulse recovery against a Bright Data Scraper Studio collector. This is not the in-memory Sentinel demo."
          : "Explicit test fixture. Never installed as the production default and never a silent fallback for a missing backend."}
      </p>
    </aside>
  );
}
