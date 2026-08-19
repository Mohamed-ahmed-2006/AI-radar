import { formatAbsoluteTime } from "../../radar/utils";
import type { HealingDemoReadModel } from "../../../lib/product/healing-demo";

function Fact({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: string;
  hint?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="radar-healing-fact">
      <dt className="radar-metric-label">{label}</dt>
      <dd className={`radar-healing-fact-value ${mono ? "font-mono" : ""}`}>{value}</dd>
      {hint ? <dd className="radar-healing-fact-hint">{hint}</dd> : null}
    </div>
  );
}

export function HealingDemoIdentityStrip({ model }: { model: HealingDemoReadModel }) {
  const identity = model.identity;
  const bright = model.brightData;

  return (
    <section aria-label="SourcePulse identity" className="radar-healing-identity">
      <dl className="radar-healing-facts">
        <Fact label="Product" value={identity?.product ?? "SourcePulse"} hint={identity?.guardian ?? "Sentinel"} />
        <Fact
          label="Source"
          value={identity?.sourceName ?? "Not reported"}
          hint={identity?.providerName ?? undefined}
        />
        <Fact
          label="Bright Data"
          value={bright?.studio ?? identity?.collectorLabel ?? "Scraper Studio"}
          hint={bright?.collectorId ?? "Collector ID not reported"}
          mono={Boolean(bright?.collectorId)}
        />
        <Fact
          label="Current state"
          value={model.phaseLabel ?? "Unavailable"}
          hint={model.sentinelStatus ? `Sentinel ${model.sentinelStatus.replaceAll("_", " ")}` : null}
        />
        <Fact
          label="Last-known-good"
          value={
            model.lastKnownGood?.recordCount != null
              ? `${model.lastKnownGood.recordCount} records`
              : "Not reported"
          }
          hint={
            model.lastKnownGood?.observedAt
              ? formatAbsoluteTime(model.lastKnownGood.observedAt)
              : model.lastKnownGood?.runId ?? null
          }
        />
        <Fact
          label="Current candidate"
          value={
            model.candidate?.recordCount != null
              ? `${model.candidate.recordCount} records`
              : "None"
          }
          hint={model.candidate?.label ?? null}
        />
      </dl>
      {identity?.isolationNote && (
        <p className="radar-healing-isolation">{identity.isolationNote}</p>
      )}
    </section>
  );
}
