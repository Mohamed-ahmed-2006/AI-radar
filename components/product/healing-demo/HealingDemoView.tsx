"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { EvidenceState, LoadingState } from "../../radar/ui/DataState";
import { Panel } from "../../radar/ui/Panel";
import { RecoveryTimeline } from "../../radar/sentinel/RecoveryTimeline";
import {
  HEALING_DEMO_UNAVAILABLE_TITLE,
  isHealingDemoAction,
  timelineToSentinelStages,
  type HealingDemoAction,
  type HealingDemoReadModel,
} from "../../../lib/product/healing-demo";
import { HealingBrightDataPanel } from "./HealingBrightDataPanel";
import { HealingDemoControls } from "./HealingDemoControls";
import { HealingDemoIdentityStrip } from "./HealingDemoIdentityStrip";
import { HealingDemoKindBanner } from "./HealingDemoKindBanner";
import { HealingDemoLinks } from "./HealingDemoLinks";
import { HealingDemoPhaseHero } from "./HealingDemoPhaseHero";
import { HealingIncidentPanel } from "./HealingIncidentPanel";
import { HealingTrustComparison } from "./HealingTrustComparison";

interface HealingDemoViewProps {
  initial: HealingDemoReadModel;
}

async function readHealingDemo(response: Response): Promise<HealingDemoReadModel> {
  const payload = (await response.json()) as HealingDemoReadModel & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? HEALING_DEMO_UNAVAILABLE_TITLE);
  }
  return payload;
}

export function HealingDemoView({ initial }: HealingDemoViewProps) {
  const [model, setModel] = useState(initial);
  const [pendingAction, setPendingAction] = useState<HealingDemoAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const response = await fetch("/api/demo/healing", { cache: "no-store" });
    const next = await readHealingDemo(response);
    if (id !== requestId.current) return;
    setModel(next);
  }, []);

  useEffect(() => {
    if (!model.available || model.pollAfterMs == null) return;
    const timer = window.setTimeout(() => {
      refresh().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : HEALING_DEMO_UNAVAILABLE_TITLE);
      });
    }, model.pollAfterMs);
    return () => window.clearTimeout(timer);
  }, [model.available, model.pollAfterMs, model.generatedAt, refresh]);

  const runAction = useCallback((action: HealingDemoAction) => {
    if (!isHealingDemoAction(action)) return;
    if (!model.allowedActions.includes(action)) return;

    const id = ++requestId.current;
    setPendingAction(action);
    setError(null);
    setLoading(true);

    fetch("/api/demo/healing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    })
      .then(readHealingDemo)
      .then((next) => {
        if (id !== requestId.current) return;
        setModel(next);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setError(cause instanceof Error ? cause.message : HEALING_DEMO_UNAVAILABLE_TITLE);
      })
      .finally(() => {
        if (id !== requestId.current) return;
        setPendingAction(null);
        setLoading(false);
      });
  }, [model.allowedActions]);

  if (!model.available) {
    return (
      <div className="radar-healing-demo">
        <HealingDemoKindBanner kind={model.kind} kindLabel={model.kindLabel} />
        <EvidenceState
          tone="unavailable"
          title={model.unavailableTitle ?? HEALING_DEMO_UNAVAILABLE_TITLE}
          description={model.unavailableReason ?? undefined}
        />
        <HealingDemoLinks model={model} />
      </div>
    );
  }

  return (
    <div className="radar-healing-demo">
      <HealingDemoKindBanner kind={model.kind} kindLabel={model.kindLabel} />

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {model.phaseLabel ?? "Healing demo status unchanged"}
        {model.busy ? " · in progress" : ""}
      </div>

      <HealingDemoPhaseHero model={model} />
      <HealingDemoIdentityStrip model={model} />

      <Panel
        id="healing-timeline"
        title="Recovery timeline"
        subtitle="Healthy → break → detected → quarantined → healing → preview → approval → rerun → recovered"
      >
        <RecoveryTimeline
          stages={timelineToSentinelStages(model.timeline)}
          wide
          label="SourcePulse recovery timeline"
        />
      </Panel>

      <HealingTrustComparison model={model} />

      <div className="radar-healing-split">
        <HealingBrightDataPanel model={model} />
        <HealingIncidentPanel model={model} />
      </div>

      {loading && pendingAction === null ? (
        <LoadingState title="Reading real healing demo…" />
      ) : (
        <HealingDemoControls
          model={model}
          pendingAction={pendingAction}
          error={error}
          onAction={runAction}
        />
      )}

      <HealingDemoLinks model={model} />
    </div>
  );
}
