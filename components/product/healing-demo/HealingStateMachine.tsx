import type { HealingDemoReadModel } from "../../../lib/product/healing-demo";

const MACHINE = [
  { id: "healthy", label: "Healthy" },
  { id: "break", label: "Failure" },
  { id: "detected", label: "Sentinel detects" },
  { id: "quarantined", label: "Quarantine" },
  { id: "lkg", label: "LKG" },
  { id: "healing", label: "Repair" },
  { id: "preview_validated", label: "Validation" },
  { id: "approved", label: "Approval" },
  { id: "recovered", label: "Recovered" },
] as const;

function nodeStatus(
  id: (typeof MACHINE)[number]["id"],
  phase: HealingDemoReadModel["phase"],
  busy: boolean,
): "pending" | "active" | "done" | "failed" {
  if (!phase) return "pending";
  if (phase === "healthy" && !busy) return "pending";
  const order = [
    "healthy",
    "break",
    "detected",
    "quarantined",
    "healing",
    "preview_waiting",
    "preview_failed",
    "preview_validated",
    "approved",
    "rerun",
    "recovered",
  ];
  const mapped =
    id === "lkg"
      ? "quarantined"
      : id;
  const current = order.indexOf(phase);
  const node = order.indexOf(mapped);
  if (phase === "preview_failed" && (id === "healing" || id === "preview_validated")) {
    return "failed";
  }
  if (phase === mapped || (id === "lkg" && (phase === "quarantined" || phase === "healing" || phase === "preview_waiting" || phase === "preview_failed" || phase === "preview_validated" || phase === "approved" || phase === "rerun"))) {
    if (id === "lkg") return phase === "recovered" ? "done" : "active";
    return "active";
  }
  if (current > node) return "done";
  return "pending";
}

export function HealingStateMachine({ model }: { model: HealingDemoReadModel }) {
  return (
    <ol className="radar-state-machine" aria-label="Healing state machine">
      {MACHINE.map((node) => {
        const status = nodeStatus(node.id, model.phase, model.busy);
        return (
          <li
            key={node.id}
            className={`radar-state-node radar-state-node-${status}`}
          >
            <p className="radar-state-node-label">{node.label}</p>
          </li>
        );
      })}
    </ol>
  );
}
