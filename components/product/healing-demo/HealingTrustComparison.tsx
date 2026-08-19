import { SentinelSnapshotCard } from "../../radar/sentinel/LastKnownGoodComparison";
import type { HealingDemoReadModel } from "../../../lib/product/healing-demo";

/**
 * The reliability guarantee: latest attempt vs last-known-good, using the
 * same snapshot cards as Source Health so judges see one visual system.
 */
export function HealingTrustComparison({ model }: { model: HealingDemoReadModel }) {
  if (model.comparisonMode === "none") return null;

  if (model.comparisonMode === "recovered") {
    return (
      <section className="radar-healing-trust" aria-labelledby="healing-trust-heading">
        <h2 id="healing-trust-heading" className="radar-subheading">
          Trusted current
        </h2>
        <div className="radar-healing-trust-grid">
          <div>
            <p className="radar-healing-trust-kicker radar-healing-trust-kicker-good">
              New trusted current
            </p>
            <p className="radar-healing-trust-state">Validated</p>
            <SentinelSnapshotCard
              snapshot={model.candidate ?? model.lastKnownGood}
              fallbackCaption="Validated snapshot"
              tone="good"
            />
          </div>
          {model.lastKnownGood && model.candidate && (
            <div>
              <p className="radar-healing-trust-kicker">Previous last-known-good</p>
              <p className="radar-healing-trust-state radar-healing-trust-state-muted">
                Superseded after recovery
              </p>
              <SentinelSnapshotCard
                snapshot={model.lastKnownGood}
                fallbackCaption="Previous last-known-good"
                tone="neutral"
              />
            </div>
          )}
        </div>
      </section>
    );
  }

  if (model.comparisonMode === "healthy") {
    return (
      <section className="radar-healing-trust" aria-labelledby="healing-trust-heading">
        <h2 id="healing-trust-heading" className="radar-subheading">
          Trusted current
        </h2>
        <div className="radar-healing-trust-grid radar-healing-trust-grid-single">
          <div>
            <p className="radar-healing-trust-kicker radar-healing-trust-kicker-good">
              Trusted current
            </p>
            <p className="radar-healing-trust-state">Last-known-good</p>
            <SentinelSnapshotCard
              snapshot={model.lastKnownGood}
              fallbackCaption="Last-known-good"
              tone="good"
            />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="radar-healing-trust" aria-labelledby="healing-trust-heading">
      <h2 id="healing-trust-heading" className="radar-subheading">
        Last-known-good guarantee
      </h2>
      <div className="radar-healing-trust-grid">
        <div>
          <p className="radar-healing-trust-kicker radar-healing-trust-kicker-bad">
            Latest attempt
          </p>
          <p className="radar-healing-trust-state">Invalid / Quarantined</p>
          <SentinelSnapshotCard
            snapshot={model.candidate}
            fallbackCaption="Invalid candidate"
            tone="bad"
          />
        </div>
        <div>
          <p className="radar-healing-trust-kicker radar-healing-trust-kicker-good">
            Trusted current
          </p>
          <p className="radar-healing-trust-state">Last-known-good · Unchanged</p>
          <SentinelSnapshotCard
            snapshot={model.lastKnownGood}
            fallbackCaption="Last-known-good"
            tone="good"
          />
        </div>
      </div>
    </section>
  );
}
