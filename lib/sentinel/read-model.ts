/**
 * Sentinel Dashboard Read-Model Assembler
 */

import {
  createSentinelRepository,
  type SentinelRepository,
} from "./repository";
import type {
  SentinelDashboardReadModel,
  SentinelIncidentStatus,
  SentinelReasonCode,
  SentinelSeverity,
  SentinelStatus,
} from "./types";

export async function getSentinelDashboardReadModel(
  repository?: SentinelRepository,
): Promise<SentinelDashboardReadModel> {
  const repo = repository ?? createSentinelRepository();
  const [sourcesHealth, recentIncidents, recentHealing] = await Promise.all([
    repo.getSentinelSourceHealth(),
    repo.listRecentIncidents(20),
    repo.listRecentHealingAttempts(20),
  ]);

  const now = Date.now();

  const sources = sourcesHealth.map((s) => {
    const lastRunAt = s.last_run_completed_at ?? s.last_run_started_at;
    const stalenessMinutes = lastRunAt
      ? Math.max(0, Math.floor((now - Date.parse(lastRunAt)) / 60_000))
      : null;

    const activeIncident = s.active_incident_id
      ? {
          id: s.active_incident_id,
          status: s.active_incident_status as SentinelIncidentStatus,
          severity: (s.active_incident_severity ?? "warning") as SentinelSeverity,
          reasonCodes: (s.active_reason_codes ?? []) as SentinelReasonCode[],
          healingAttemptCount: s.healing_attempt_count ?? 0,
          createdAt: s.last_run_started_at ?? new Date().toISOString(),
        }
      : null;

    return {
      sourceId: s.source_id,
      providerId: s.provider_id,
      providerName: s.provider_name,
      providerSlug: s.provider_slug,
      kind: s.kind,
      collectorId: s.collector_id,
      sourceUrl: s.source_url,
      label: s.label,
      status: s.sentinel_health_status as SentinelStatus,
      lastRunId: s.last_run_id,
      lastRunStatus: s.last_run_status,
      lastRunAt,
      currentRecordCount: s.last_run_records_accepted ?? 0,
      lastKnownGoodCount: s.last_known_good_count ?? null,
      lastKnownGoodAt: s.last_known_good_at ?? null,
      activeIncident,
      stalenessMinutes,
    };
  });

  const activeIncidents = recentIncidents
    .filter((inc) => inc.status === "open" || inc.status === "healing" || inc.status === "needs_review")
    .map((inc) => ({
      id: inc.id,
      sourceId: inc.source_id,
      providerName:
        sourcesHealth.find((s) => s.provider_id === inc.provider_id)?.provider_name ??
        inc.provider_id,
      status: inc.status,
      severity: inc.severity,
      reasonCodes: inc.reason_codes,
      summary: inc.summary,
      recordsSeen: inc.records_seen,
      recordsValid: inc.records_valid,
      recordsInvalid: inc.records_invalid,
      lastKnownGoodCount: inc.last_known_good_count,
      healingAttemptCount: inc.healing_attempt_count,
      createdAt: inc.created_at,
    }));

  const recentHealingAttempts = recentHealing.map((h) => ({
    id: h.id,
    incidentId: h.incident_id,
    sourceId: h.source_id,
    collectorId: h.collector_id,
    attemptNumber: h.attempt_number,
    prompt: h.prompt,
    status: h.status,
    candidatePassedValidation: h.candidate_passed_validation,
    startedAt: h.started_at,
    completedAt: h.completed_at,
  }));

  const summary = {
    totalSources: sources.length,
    healthySources: sources.filter((s) => s.status === "healthy" || s.status === "recovered").length,
    degradedSources: sources.filter((s) => s.status === "degraded").length,
    quarantinedSources: sources.filter((s) => s.status === "quarantined").length,
    healingSources: sources.filter((s) => s.status === "healing").length,
    needsReviewSources: sources.filter((s) => s.status === "needs_review").length,
    openIncidents: activeIncidents.length,
  };

  return {
    sources,
    activeIncidents,
    recentHealingAttempts,
    summary,
  };
}
