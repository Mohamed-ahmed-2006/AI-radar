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

type CatalogStatus = "ready" | "loading" | "error";

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

    fetch(`/api/models${filterQuery}`, { signal: controller.signal })
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
        matching={catalog.totalMatching}
        total={catalog.totalUnfiltered}
        busy={status === "loading"}
      />

      <CompareBar
        selectedIds={selectedIds}
        labels={labels}
        filters={filters}
        onRemove={onToggle}
        onClear={() => setSelectedIds([])}
      />

      <Panel
        id="model-catalog"
        title="Model catalog"
        subtitle={`${catalog.totalMatching} model${catalog.totalMatching === 1 ? "" : "s"} · prices per 1M tokens`}
      >
        {status === "loading" ? (
          <LoadingState title="Loading models…" />
        ) : status === "error" ? (
          <ErrorState
            title="The model catalog could not be read"
            description={error ?? undefined}
          />
        ) : (
          <>
            <div className="radar-explorer-desktop">
              <ModelExplorerTable
                models={catalog.models}
                selectedIds={selectedIds}
                onToggle={onToggle}
                compareLimitReached={compareLimitReached}
              />
            </div>
            <div className="radar-explorer-mobile">
              <ModelExplorerCards
                models={catalog.models}
                selectedIds={selectedIds}
                onToggle={onToggle}
                compareLimitReached={compareLimitReached}
              />
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
