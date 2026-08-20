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
import { HealingStateMachine } from "./HealingStateMachine";
import { OperatorUnlock } from "./OperatorUnlock";
import { HealingTrustComparison } from "./HealingTrustComparison";

interface HealingDemoViewProps {
  initial: HealingDemoReadModel;
}

/**
 * A 401 from the action route is not a failure to report and forget: it means
 * the deployment is correctly keeping real Bright Data jobs closed, and an
 * operator can open a session. It is distinguished here so the view can offer
 * the unlock instead of a dead error.
 */
class HealingDemoLockedError extends Error {
  readonly unlockAvailable: boolean;
  constructor(message: string, unlockAvailable: boolean) {
    super(message);
    this.name = "HealingDemoLockedError";
    this.unlockAvailable = unlockAvailable;
  }
}

async function readHealingDemo(response: Response): Promise<HealingDemoReadModel> {
  const payload = (await response.json()) as HealingDemoReadModel & {
    error?: string;
    unlockAvailable?: boolean;
  };
  if (response.status === 401) {
    throw new HealingDemoLockedError(
      payload.error ?? "Healing demo controls require the operator credential",
      payload.unlockAvailable === true,
    );
  }
  if (!response.ok) {
    throw new Error(payload.error ?? HEALING_DEMO_UNAVAILABLE_TITLE);
  }
  return payload;
}

export function HealingDemoView({ initial }: HealingDemoViewProps) {
  const [model, setModel] = useState(initial);
  const [pendingAction, setPendingAction] = useState<HealingDemoAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
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
        setLocked(cause instanceof HealingDemoLockedError && cause.unlockAvailable);
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
      <HealingStateMachine model={model} />
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

      {locked && (
        <OperatorUnlock
          onUnlocked={() => {
            setLocked(false);
            setError(null);
          }}
        />
      )}

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
