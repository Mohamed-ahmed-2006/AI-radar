import {
  createSupabaseServerClient,
  getCapabilityHistory,
  getLatestCapabilitySnapshots,
  getLatestLifecycleSnapshots,
  getLatestPricingSnapshots,
  getRecentChangeEvents,
  type CapabilitySnapshotRow,
  type ChangeEventRow,
  type LatestLifecycleSnapshotRow,
  type LatestPricingSnapshotRow,
  type SupabaseServerClient,
} from "../supabase";


export interface ModelCapabilityView {
  modelId: string;
  modelName: string;
  displayName: string | null;
  provider: string;
  providerSlug: string;
  isActive: boolean;
  lifecycleState: string | null;
  apiModelId: string | null;
  modelFamily: string | null;
  modelStage: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean | null;
  supportsToolCalling: boolean | null;
  inputModalities: string[];
  outputModalities: string[];
  supportedFeatures: string[];
  sourceUrl: string | null;
  observedAt: string | null;
}

export interface ModelCapabilityFilters {
  providerSlug?: string;
  supportsVision?: boolean;
  supportsToolCalling?: boolean;
  minContextWindow?: number;
  inputModality?: string;
  outputModality?: string;
  modelFamily?: string;
  modelStage?: string;
  search?: string;
}

export interface ModelDetailView {
  model: ModelCapabilityView;
  pricing: LatestPricingSnapshotRow[];
  lifecycle: LatestLifecycleSnapshotRow | null;
  capabilityHistory: CapabilitySnapshotRow[];
  recentChangeEvents: ChangeEventRow[];
}

/**
 * Returns all canonical models with projected capabilities, lifecycle state,
 * and provenance.
 */
export async function getCanonicalModelsWithCapabilities(
  options: {
    client?: SupabaseServerClient;
    filters?: ModelCapabilityFilters;
  } = {},
): Promise<ModelCapabilityView[]> {
  const db = options.client ?? createSupabaseServerClient();
  const filters = options.filters ?? {};

  const [capabilities, lifecycle] = await Promise.all([
    getLatestCapabilitySnapshots(db, {
      providerSlug: filters.providerSlug,
    }),
    getLatestLifecycleSnapshots(db, {
      providerSlug: filters.providerSlug,
    }),
  ]);

  const lifecycleByModelId = new Map<string, LatestLifecycleSnapshotRow>();
  for (const l of lifecycle) {
    lifecycleByModelId.set(l.model_id, l);
  }

  let views: ModelCapabilityView[] = capabilities.map((cs) => {
    const l = lifecycleByModelId.get(cs.model_id);
    return {
      modelId: cs.model_id,
      modelName: cs.model_name,
      displayName: cs.display_name ?? cs.model_name,
      provider: cs.provider_name,
      providerSlug: cs.provider_slug,
      isActive: l?.projected_lifecycle_state !== "retired",
      lifecycleState: l?.projected_lifecycle_state ?? null,
      apiModelId: cs.api_model_id,
      modelFamily: cs.model_family,
      modelStage: cs.model_stage,
      contextWindow: cs.context_window,
      maxOutputTokens: cs.max_output_tokens,
      supportsVision: cs.supports_vision,
      supportsToolCalling: cs.supports_tool_calling,
      inputModalities: cs.input_modalities ?? [],
      outputModalities: cs.output_modalities ?? [],
      supportedFeatures: cs.supported_features ?? [],
      sourceUrl: cs.source_url,
      observedAt: cs.observed_at,
    };
  });

  if (filters.supportsVision !== undefined) {
    views = views.filter((v) => v.supportsVision === filters.supportsVision);
  }
  if (filters.supportsToolCalling !== undefined) {
    views = views.filter(
      (v) => v.supportsToolCalling === filters.supportsToolCalling,
    );
  }
  if (filters.minContextWindow !== undefined) {
    views = views.filter(
      (v) => v.contextWindow !== null && v.contextWindow >= filters.minContextWindow!,
    );
  }
  if (filters.inputModality) {
    const target = filters.inputModality.toLowerCase();
    views = views.filter((v) =>
      v.inputModalities.some((m) => m.toLowerCase() === target),
    );
  }
  if (filters.outputModality) {
    const target = filters.outputModality.toLowerCase();
    views = views.filter((v) =>
      v.outputModalities.some((m) => m.toLowerCase() === target),
    );
  }
  if (filters.modelFamily) {
    const target = filters.modelFamily.toLowerCase();
    views = views.filter(
      (v) => v.modelFamily && v.modelFamily.toLowerCase().includes(target),
    );
  }
  if (filters.modelStage) {
    const target = filters.modelStage.toLowerCase();
    views = views.filter(
      (v) => v.modelStage && v.modelStage.toLowerCase() === target,
    );
  }
  if (filters.search) {
    const query = filters.search.toLowerCase();
    views = views.filter(
      (v) =>
        v.modelName.toLowerCase().includes(query) ||
        (v.displayName && v.displayName.toLowerCase().includes(query)) ||
        (v.apiModelId && v.apiModelId.toLowerCase().includes(query)),
    );
  }

  return views;
}

/**
 * Returns detail for an individual model with its capability history, pricing,
 * lifecycle state, and recent change events.
 */
export async function getModelDetailWithCapabilities(
  modelId: string,
  client?: SupabaseServerClient,
): Promise<ModelDetailView | null> {
  const db = client ?? createSupabaseServerClient();

  const [allModels, pricing, lifecycleList, history, events] = await Promise.all([
    getCanonicalModelsWithCapabilities({ client: db }),
    getLatestPricingSnapshots(db, { modelIds: [modelId] }),
    getLatestLifecycleSnapshots(db),
    getCapabilityHistory(db, modelId),
    getRecentChangeEvents(db, { modelId, limit: 20 }),
  ]);

  const model = allModels.find((m) => m.modelId === modelId);
  if (!model) return null;

  const lifecycle = lifecycleList.find((l) => l.model_id === modelId) ?? null;

  return {
    model,
    pricing,
    lifecycle,
    capabilityHistory: history,
    recentChangeEvents: events,
  };
}
