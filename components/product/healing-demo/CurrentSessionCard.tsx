import type { HealingDemoReadModel } from "../../../lib/product/healing-demo";
import { isCleanHealingDemoSession } from "../../../lib/product/healing-demo-proof-view";

/**
 * The live demonstration's parked phase — never mixed with historical proof.
 */
export function CurrentSessionCard({ model }: { model: HealingDemoReadModel }) {
  const clean = isCleanHealingDemoSession(model);

  return (
    <section className="radar-healing-session" aria-labelledby="healing-current-session">
      <p className="radar-healing-kicker">Current session</p>
      <p id="healing-current-session" className="radar-healing-session-title">
        {clean ? "Ready for demonstration" : (model.phaseLabel ?? "In progress")}
      </p>
      <p className="radar-healing-session-copy">
        {clean
          ? "Clean · Not started"
          : model.busy
            ? "Live demonstration in progress. Historical proof below is a replay, not this run."
            : `Live phase: ${model.phaseLabel ?? "unknown"}. Historical proof is separate.`}
      </p>
    </section>
  );
}
