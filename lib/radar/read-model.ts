import type {
  ChangeEvent as DashboardChangeEvent,
  HealthStatus,
  ModelPricing,
  RadarDashboardData,
} from "@/components/radar/types";
import {
  createSupabaseServerClient,
  getLatestPricingSnapshots,
  getRecentChangeEvents,
  getSourceHealth,
} from "../supabase";

function sourceStatus(status: "running" | "succeeded" | "partial" | "failed" | null): HealthStatus {
  if (status === "succeeded") return "healthy";
  if (status === "partial") return "degraded";
  if (status === "failed") return "down";
  return "unknown";
}

function aggregateStatus(statuses: readonly HealthStatus[]): HealthStatus {
  if (statuses.includes("down")) return "down";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.includes("healthy")) return "healthy";
  return "unknown";
}

function dashboardChangeType(type: string): DashboardChangeEvent["type"] {
  if (type === "model_added") return "model_launch";
  if (type === "model_removed") return "model_removal";
  if (type === "price_increased" || type === "price_decreased") return "price_change";
  return "schema_update";
}

function eventSeverity(type: string): DashboardChangeEvent["severity"] {
  if (type === "model_removed" || type === "price_increased") return "warning";
  return "info";
}

/** Assembles the server-side dashboard contract directly from Supabase reads. */
export async function getLiveRadarDashboardData(): Promise<RadarDashboardData> {
  if (typeof window !== "undefined") {
    throw new Error("getLiveRadarDashboardData must only run on the server");
  }
  const db = createSupabaseServerClient();
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const [snapshots, sourceHealth, recentEvents, recentEvents24h, priceEvents7d] = await Promise.all([
    getLatestPricingSnapshots(db),
    getSourceHealth(db),
    getRecentChangeEvents(db, { limit: 100 }),
    getRecentChangeEvents(db, { since: oneDayAgo, limit: 500 }),
    getRecentChangeEvents(db, {
      since: sevenDaysAgo,
      changeTypes: ["price_increased", "price_decreased"],
      limit: 500,
    }),
  ]);
  const providerNameById = new Map<string, string>();
  const modelsByKey = new Map<string, ModelPricing>();

  for (const snapshot of snapshots) {
    providerNameById.set(snapshot.provider_id, snapshot.provider_name);
    const key = `${snapshot.provider_id}:${snapshot.model_id}`;
    const model = modelsByKey.get(key) ?? {
      id: snapshot.model_id,
      provider: snapshot.provider_name,
      name: snapshot.model_name,
      slug: snapshot.model_name,
      status: "active" as const,
      contextWindow: null,
      lastVerifiedAt: snapshot.observed_at,
      rates: [],
    };
    model.rates.push({
      tier: snapshot.context_tier,
      inputPerMillion: snapshot.input_price_per_1m_tokens,
      cachedInputPerMillion: snapshot.cached_input_price_per_1m_tokens,
      outputPerMillion: snapshot.output_price_per_1m_tokens,
    });
    if (snapshot.observed_at > model.lastVerifiedAt) model.lastVerifiedAt = snapshot.observed_at;
    modelsByKey.set(key, model);
  }

  const providerSources = new Map<string, typeof sourceHealth>();
  for (const health of sourceHealth) {
    const entries = providerSources.get(health.provider_id) ?? [];
    entries.push(health);
    providerSources.set(health.provider_id, entries);
  }
  const providers = [...providerSources.entries()].map(([providerId, sources]) => {
    const statuses = sources.map((source) => sourceStatus(source.last_run_status));
    const lastCollectionAt = sources
      .map((source) => source.last_run_completed_at)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;
    return {
      id: providerId,
      name: providerNameById.get(providerId) ?? providerId,
      status: aggregateStatus(statuses),
      modelsTracked: [...modelsByKey.values()].filter((model) => model.id &&
        snapshots.some((snapshot) => snapshot.model_id === model.id && snapshot.provider_id === providerId)).length,
      lastCollectionAt,
      collectorId: sources.map((source) => source.collector_id).filter(Boolean).join(", ") || "—",
      errorRate24h: null,
      latencyP95Ms: null,
    };
  });

  const changes: DashboardChangeEvent[] = recentEvents.map((event) => ({
    id: event.id,
    type: dashboardChangeType(event.change_type),
    provider: providerNameById.get(event.provider_id) ?? event.provider_id,
    model: snapshots.find((snapshot) => snapshot.model_id === event.model_id)?.model_name,
    summary: event.summary ?? event.change_type.replaceAll("_", " "),
    detail: event.field_name
      ? `${event.field_name}: ${JSON.stringify(event.old_value)} → ${JSON.stringify(event.new_value)}`
      : undefined,
    detectedAt: event.detected_at,
    sourceId: event.source_id ?? "—",
    severity: eventSeverity(event.change_type),
  }));
  const sources = sourceHealth.map((source) => {
    const lastSuccessAt = source.last_run_status === "succeeded" ? source.last_run_completed_at : null;
    const reference = lastSuccessAt ?? source.last_run_started_at;
    return {
      id: source.source_id,
      label: source.source_url,
      provider: providerNameById.get(source.provider_id) ?? source.provider_id,
      collectorType: source.collector_id ? "Bright Data Scraper Studio" : "Unspecified collector",
      lastSuccessAt,
      lastAttemptAt: source.last_run_started_at,
      status: sourceStatus(source.last_run_status),
      stalenessMinutes: reference ? Math.max(0, Math.floor((now - Date.parse(reference)) / 60_000)) : null,
      expectedIntervalMinutes: null,
    };
  });
  const lastGlobalRefreshAt = sourceHealth
    .map((source) => source.last_run_completed_at)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? "";

  return {
    isMock: false,
    fixtureVersion: "live-supabase",
    ecosystem: {
      status: aggregateStatus(sources.map((source) => source.status)),
      modelsTracked: modelsByKey.size,
      providersTracked: providers.length,
      changesLast24h: recentEvents24h.length,
      priceChangesLast7d: priceEvents7d.length,
      activeAlerts: sourceHealth.filter((source) => source.last_run_status === "failed").length,
      lastGlobalRefreshAt,
    },
    changes,
    models: [...modelsByKey.values()].sort((left, right) => left.slug.localeCompare(right.slug)),
    providers,
    sources,
    provenance: sourceHealth.map((source) => ({
      sourceId: source.source_id,
      label: source.source_url,
      url: source.source_url,
      collector: source.collector_id ?? "—",
      datasetVersion: source.last_run_id ?? "—",
      scrapedAt: source.last_run_completed_at,
    })),
  };
}
