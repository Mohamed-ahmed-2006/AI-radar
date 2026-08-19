import { formatAbsoluteTime } from "../../radar/utils";
import { Panel } from "../../radar/ui/Panel";
import type { HealingDemoReadModel } from "../../../lib/product/healing-demo";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="radar-healing-bd-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function humanize(value: string | boolean | null | undefined): string {
  if (value == null || value === "") return "Not reported";
  if (value === true) return "Yes";
  if (value === false) return "No";
  return value.replaceAll("_", " ");
}

export function HealingBrightDataPanel({ model }: { model: HealingDemoReadModel }) {
  const bright = model.brightData;

  return (
    <Panel
      id="healing-brightdata"
      title="Bright Data Scraper Studio"
      subtitle="Collector identity, heal/refactor, preview, approval and rerun"
    >
      {!bright ? (
        <p className="text-xs text-radar-text-muted">
          Bright Data status is not reported by the healing backend yet.
        </p>
      ) : (
        <dl className="radar-healing-bd">
          <Row label="Collector ID" value={bright.collectorId ?? "Not reported"} />
          <Row label="Studio" value={bright.studio} />
          <Row
            label="Heal / refactor requested"
            value={
              bright.healRequested
                ? bright.healRequestedAt
                  ? `Requested · ${formatAbsoluteTime(bright.healRequestedAt)}`
                  : "Requested"
                : "Not requested"
            }
          />
          <Row label="Preview" value={humanize(bright.previewState)} />
          <Row label="Approval" value={humanize(bright.approvalState)} />
          <Row label="Rerun" value={humanize(bright.rerunState)} />
          <Row
            label="Refactor job"
            value={bright.refactorJobId ? bright.refactorJobId : "None"}
          />
        </dl>
      )}
    </Panel>
  );
}
