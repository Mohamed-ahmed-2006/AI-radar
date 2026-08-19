import type { SentinelFleetSnapshot } from "../../components/radar/types";
import type { SentinelView } from "../../components/radar/sentinel/types";

export function unavailableSentinelSnapshot(
  reason: string,
  isDemo = false,
): SentinelFleetSnapshot {
  return {
    available: false,
    unavailableReason: reason,
    isDemo,
    totalSources: null,
    healthy: null,
    degraded: null,
    quarantined: null,
    recovered: null,
    healing: null,
    needsReview: null,
  };
}

export function sentinelSnapshotFromView(view: SentinelView): SentinelFleetSnapshot {
  const counts = view.summary.statusCounts;
  return {
    available: true,
    unavailableReason: null,
    isDemo: view.isDemo,
    totalSources: view.summary.totalSources,
    healthy: counts.healthy,
    degraded: counts.degraded,
    quarantined: counts.quarantined,
    recovered: counts.recovered,
    healing: counts.healing,
    needsReview: counts.needs_review,
  };
}
