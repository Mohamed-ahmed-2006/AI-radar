"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  explorerHref,
  explorerSearchParams,
  MAX_COMPARE_MODELS,
  toggleCompareId,
  type ExplorerFilters,
  type ModelExplorerCatalog,
} from "../../../lib/product/explorer";
import { ErrorState, LoadingState } from "../../radar/ui/DataState";
import { Panel } from "../../radar/ui/Panel";
import { CompareBar } from "./CompareBar";
import { EvidenceBanner } from "./EvidenceBanner";
import { ModelExplorerCards } from "./ModelExplorerCards";
import { ModelExplorerFilters } from "./ModelExplorerFilters";
import { ModelExplorerTable } from "./ModelExplorerTable";
import { ModelQuickView } from "./ModelQuickView";

type CatalogStatus = "ready" | "loading" | "error";
type ViewMode = "table" | "cards";

interface ModelExplorerViewProps {
  initialCatalog: ModelExplorerCatalog;
  initialFilters: ExplorerFilters;
  initialCompareIds: string[];
}

export function ModelExplorerView({
  initialCatalog,
  initialFilters,
  initialCompareIds,
}: ModelExplorerViewProps) {
  const [filters, setFilters] = useState<ExplorerFilters>(initialFilters);
  const [catalog, setCatalog] = useState<ModelExplorerCatalog>(initialCatalog);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialCompareIds);
  const [status, setStatus] = useState<CatalogStatus>("ready");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("table");
  const [inspectId, setInspectId] = useState<string | null>(null);
  const isFirstRender = useRef(true);

  const filterQuery = (() => {
    const params = explorerSearchParams(filters).toString();
    return params ? `?${params}` : "";
  })();

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    setError(null);

    fetch(`/api/explorer${filterQuery}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as ModelExplorerCatalog & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "The model catalog could not be read.");
        }
        setCatalog(payload);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "The model catalog could not be read.",
        );
        setStatus("error");
      });

    return () => controller.abort();
  }, [filterQuery]);

  useEffect(() => {
    const href = explorerHref(filters, selectedIds);
    if (`${window.location.pathname}${window.location.search}` === href) return;
    window.history.replaceState(window.history.state, "", href);
  }, [filters, selectedIds]);

  const labels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const model of catalog.models) {
      map[model.identity.canonicalId] = model.identity.displayName;
    }
    return map;
  }, [catalog.models]);

  const visibleModels = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return catalog.models;
    return catalog.models.filter((model) => {
      const haystack = [
        model.identity.displayName,
        model.identity.providerName,
        model.identity.apiModelId ?? "",
        model.identity.canonicalId,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [catalog.models, search]);

  const inspected = visibleModels.find((model) => model.identity.canonicalId === inspectId) ?? null;

  const onToggle = useCallback((canonicalId: string) => {
    setSelectedIds((current) => toggleCompareId(current, canonicalId));
  }, []);

  const compareLimitReached = selectedIds.length >= MAX_COMPARE_MODELS;

  return (
    <div className="radar-surface-stack">
      <EvidenceBanner quality={catalog.evidenceQuality} note={catalog.evidenceNote} />

      <ModelExplorerFilters
        filters={filters}
        providerOptions={catalog.providerOptions}
        lifecycleOptions={catalog.lifecycleOptions}
        onChange={setFilters}
        matching={search.trim() ? visibleModels.length : catalog.totalMatching}
        total={catalog.totalUnfiltered}
        busy={status === "loading"}
        search={search}
        onSearchChange={setSearch}
      />

      <Panel
        id="model-catalog"
        title="Model catalog"
        subtitle={`${visibleModels.length} model${visibleModels.length === 1 ? "" : "s"} · prices per 1M tokens`}
        action={
          <div className="radar-tablist radar-view-toggle" role="group" aria-label="Catalog layout">
            <button
              type="button"
              className="radar-tab"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              Table
            </button>
            <button
              type="button"
              className="radar-tab"
              aria-pressed={view === "cards"}
              onClick={() => setView("cards")}
            >
              Cards
            </button>
          </div>
        }
      >
        {status === "loading" ? (
          <LoadingState title="Loading models…" />
        ) : status === "error" ? (
          <ErrorState
            title="The model catalog could not be read"
            description={error ?? undefined}
          />
        ) : view === "cards" ? (
          <ModelExplorerCards
            models={visibleModels}
            selectedIds={selectedIds}
            onToggle={onToggle}
            compareLimitReached={compareLimitReached}
            onInspect={setInspectId}
          />
        ) : (
          <>
            <div className="radar-explorer-desktop">
              <ModelExplorerTable
                models={visibleModels}
                selectedIds={selectedIds}
                onToggle={onToggle}
                compareLimitReached={compareLimitReached}
                onInspect={setInspectId}
              />
            </div>
            <div className="radar-explorer-mobile">
              <ModelExplorerCards
                models={visibleModels}
                selectedIds={selectedIds}
                onToggle={onToggle}
                compareLimitReached={compareLimitReached}
                onInspect={setInspectId}
              />
            </div>
          </>
        )}
      </Panel>

      <CompareBar
        selectedIds={selectedIds}
        labels={labels}
        filters={filters}
        onRemove={onToggle}
        onClear={() => setSelectedIds([])}
      />

      <ModelQuickView model={inspected} onClose={() => setInspectId(null)} />
    </div>
  );
}
