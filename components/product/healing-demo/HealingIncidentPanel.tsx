import { AnomalyReason } from "../../radar/sentinel/AnomalyReason";
import { Panel } from "../../radar/ui/Panel";
import type { HealingDemoReadModel } from "../../../lib/product/healing-demo";

function Note({ title, body }: { title: string; body: string | null | undefined }) {
  if (!body) return null;
  return (
    <div className="radar-healing-note">
      <p className="radar-healing-note-title">{title}</p>
      <p className="radar-healing-note-body">{body}</p>
    </div>
  );
}

export function HealingIncidentPanel({ model }: { model: HealingDemoReadModel }) {
  return (
    <Panel
      id="healing-incident"
      title="Incident, quarantine and healing"
      subtitle="What Sentinel held, and what Bright Data was asked to repair"
    >
      <div className="radar-surface-stack-tight">
        <AnomalyReason
          incident={model.incident}
          emptyMessage="No Sentinel incident is open for the isolated demo source."
        />
        <Note title="Quarantine" body={model.quarantine?.summary} />
        <Note title="Healing attempt" body={model.healing?.summary} />
        <Note title="Preview" body={model.preview?.summary} />
        <Note title="Validation" body={model.validation?.summary} />
        <Note title="Approval" body={model.approval?.summary} />
        <Note title="Rerun" body={model.rerun?.summary} />
        <Note title="Recovery" body={model.recovery?.summary} />
      </div>
    </Panel>
  );
}
