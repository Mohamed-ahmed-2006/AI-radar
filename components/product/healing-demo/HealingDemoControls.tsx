import {
  HEALING_DEMO_ACTIONS,
  healingDemoActionLabel,
  isDangerousHealingDemoAction,
  type HealingDemoAction,
  type HealingDemoReadModel,
} from "../../../lib/product/healing-demo";

interface HealingDemoControlsProps {
  model: HealingDemoReadModel;
  pendingAction: HealingDemoAction | null;
  error: string | null;
  onAction: (action: HealingDemoAction) => void;
}

export function HealingDemoControls({
  model,
  pendingAction,
  error,
  onAction,
}: HealingDemoControlsProps) {
  const allowed = new Set(model.allowedActions);
  const disabled = !model.available || model.busy || pendingAction !== null;

  return (
    <section className="radar-healing-controls" aria-labelledby="healing-controls-heading">
      <div className="radar-healing-controls-head">
        <h2 id="healing-controls-heading" className="radar-subheading">
          Isolated demo controls
        </h2>
        <p className="radar-healing-controls-copy">
          Allowlisted actions only. There is no URL, collector ID, or source input.
          Dangerous steps apply solely to the isolated SourcePulse demo source.
        </p>
      </div>

      <div className="radar-healing-control-grid" role="group" aria-label="Healing demo actions">
        {HEALING_DEMO_ACTIONS.map((action) => {
          const isAllowed = allowed.has(action);
          const isDanger = isDangerousHealingDemoAction(action);
          const isPending = pendingAction === action;

          return (
            <button
              key={action}
              type="button"
              className={
                isDanger ? "radar-healing-action radar-healing-action-danger" : "radar-healing-action"
              }
              disabled={disabled || !isAllowed}
              aria-disabled={disabled || !isAllowed}
              onClick={() => onAction(action)}
            >
              {isPending ? "Working…" : healingDemoActionLabel(action)}
              {isDanger && (
                <span className="radar-healing-action-note">Isolated demo source only</span>
              )}
              {action === "approve_preview" && (
                <span className="radar-healing-action-note">
                  Available only after a valid preview
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="radar-healing-control-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
