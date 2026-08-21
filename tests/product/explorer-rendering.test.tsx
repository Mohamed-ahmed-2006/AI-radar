/**
 * Markup-level checks for Model Explorer, Detail and Compare.
 *
 * These render presentational components to static HTML so unknown-vs-false
 * capability copy, filter control names, compare selection, provenance, and
 * empty/error/loading semantics are asserted rather than assumed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { CapabilityStatus } from "../../components/product/explorer/CapabilityStatus";
import { CompareBar } from "../../components/product/explorer/CompareBar";
import { EvidenceBanner } from "../../components/product/explorer/EvidenceBanner";
import { ModelCompareView } from "../../components/product/explorer/ModelCompareView";
import { ModelDetailView } from "../../components/product/explorer/ModelDetailView";
import { ModelExplorerCards } from "../../components/product/explorer/ModelExplorerCards";
import { ModelExplorerFilters } from "../../components/product/explorer/ModelExplorerFilters";
import { ModelExplorerTable } from "../../components/product/explorer/ModelExplorerTable";
import { ErrorState, LoadingState } from "../../components/radar/ui/DataState";
import { observedBoolean } from "../../lib/product/explorer";
import { DEFAULT_EXPLORER_FILTERS } from "../../lib/product/explorer";
import {
  compareColumn,
  compareReadModel,
  detailReadModel,
  explorerRow,
} from "./support/explorer-fixtures";

test("Explorer table renders as a labelled semantic table of models", () => {
  const html = renderToStaticMarkup(
    <ModelExplorerTable
      models={[explorerRow()]}
      selectedIds={[]}
      onToggle={() => undefined}
      compareLimitReached={false}
    />,
  );

  assert.match(html, /<table [^>]*aria-label="Model catalog"/);
  assert.match(html, /<th scope="col"[^>]*>Provider/);
  assert.match(html, /<th scope="col"[^>]*>Model/);
  assert.match(html, /<th scope="col"[^>]*>Input/);
  assert.match(html, /<th scope="col"[^>]*>Output/);
  assert.match(html, /<th scope="col"[^>]*>Context/);
  assert.match(html, /<th scope="col"[^>]*>Vision/);
  assert.match(html, /<th scope="col"[^>]*>Tool calling/);
  assert.match(html, /<th scope="col"[^>]*>Lifecycle/);
  assert.match(html, /<th scope="col"[^>]*>Freshness/);
  assert.match(html, /Anthropic/);
  assert.match(html, /Claude Sonnet 4\.5/);
});

test("Unknown capabilities render as Unknown / Not observed, never Unsupported, never a red X", () => {
  const unknown = renderToStaticMarkup(
    <CapabilityStatus value={observedBoolean(null)} />,
  );
  const missing = renderToStaticMarkup(
    <CapabilityStatus value={observedBoolean(undefined)} />,
  );
  const no = renderToStaticMarkup(
    <CapabilityStatus value={observedBoolean(false)} />,
  );
  const yes = renderToStaticMarkup(
    <CapabilityStatus value={observedBoolean(true)} />,
  );

  assert.match(unknown, /Unknown/);
  assert.match(unknown, /not observed/i);
  assert.match(unknown, /radar-capability-unknown/);
  assert.doesNotMatch(unknown, /Unsupported/);
  assert.doesNotMatch(unknown, /Not supported/);
  assert.doesNotMatch(unknown, />×</);
  assert.doesNotMatch(unknown, />x</i);
  assert.doesNotMatch(unknown, /radar-danger/);

  assert.match(missing, /Unknown/);
  assert.doesNotMatch(missing, /Unsupported/);

  assert.match(no, /Not supported/);
  assert.doesNotMatch(no, /Unknown/);
  assert.match(yes, /Supported/);
});

test("Explorer table shows Unknown for null vision and Not supported for false tools", () => {
  const html = renderToStaticMarkup(
    <ModelExplorerTable
      models={[
        explorerRow({
          vision: observedBoolean(null),
          toolCalling: observedBoolean(false),
        }),
      ]}
      selectedIds={[]}
      onToggle={() => undefined}
      compareLimitReached={false}
    />,
  );

  assert.match(html, /Unknown/);
  assert.match(html, /Not supported/);
  assert.doesNotMatch(html, /Unsupported/);
});

test("Filter controls expose labelled provider, price, context, vision, tools, active and lifecycle fields", () => {
  const html = renderToStaticMarkup(
    <ModelExplorerFilters
      filters={DEFAULT_EXPLORER_FILTERS}
      providerOptions={[{ value: "anthropic", label: "Anthropic", count: 2 }]}
      lifecycleOptions={[{ value: "active", label: "Active", count: 2 }]}
      onChange={() => undefined}
      matching={2}
      total={4}
    />,
  );

  assert.match(html, /aria-label="Model explorer filters"/);
  assert.match(html, /for="explorer-filter-provider"/);
  assert.match(html, /for="explorer-filter-max-input"/);
  assert.match(html, /for="explorer-filter-max-output"/);
  assert.match(html, /for="explorer-filter-min-context"/);
  assert.match(html, /for="explorer-filter-lifecycle"/);
  assert.match(html, /for="explorer-filter-vision"/);
  assert.match(html, /for="explorer-filter-tools"/);
  assert.match(html, /for="explorer-filter-active"/);
  assert.match(html, /Vision required/);
  assert.match(html, /Tool calling required/);
  assert.match(html, /Active only/);
  assert.match(html, /2 of 4 models/);
});

test("Compare selection is a labelled checkbox using the canonical id", () => {
  const html = renderToStaticMarkup(
    <ModelExplorerTable
      models={[explorerRow()]}
      selectedIds={["anthropic:claude-sonnet-4-5"]}
      onToggle={() => undefined}
      compareLimitReached={false}
    />,
  );

  assert.match(html, /type="checkbox"/);
  assert.match(html, /aria-label="Select Claude Sonnet 4\.5 for compare"/);
  assert.match(html, /checked/);
});

test("Compare bar encodes canonical ids in a shareable compare URL", () => {
  const html = renderToStaticMarkup(
    <CompareBar
      selectedIds={["anthropic:claude-sonnet-4-5", "openai:gpt-4o"]}
      labels={{
        "anthropic:claude-sonnet-4-5": "Claude Sonnet 4.5",
        "openai:gpt-4o": "GPT-4o",
      }}
      filters={DEFAULT_EXPLORER_FILTERS}
      onRemove={() => undefined}
      onClear={() => undefined}
    />,
  );

  assert.match(html, /aria-label="Compare selection"/);
  assert.match(html, /href="\/models\/compare\?ids=/);
  assert.match(html, /anthropic%3Aclaude-sonnet-4-5/);
  assert.match(html, /Compare selected/);
  assert.match(html, /2 of 5 selected/);
});

test("Every explorer row exposes provenance through the shared disclosure", () => {
  const html = renderToStaticMarkup(
    <ModelExplorerTable
      models={[explorerRow()]}
      selectedIds={[]}
      onToggle={() => undefined}
      compareLimitReached={false}
    />,
  );

  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.match(html, /Where did this come from\?/);
  assert.match(html, /Anthropic model catalog/);
});

test("Model detail marks unavailable sections instead of inventing values", () => {
  const html = renderToStaticMarkup(<ModelDetailView detail={detailReadModel()} />);

  assert.match(html, /Identity/);
  assert.match(html, /anthropic:claude-sonnet-4-5/);
  assert.match(html, /Capabilities/);
  assert.match(html, /Unknown/);
  assert.match(html, /not observed/i);
  assert.match(html, /Not available/);
  assert.match(html, /No replacement has been observed for this model/);
  assert.match(html, /No recent changes have been recorded for this model/);
  assert.match(html, /No capability history has been recorded for this model/);
  assert.doesNotMatch(html, /Unsupported/);
});

test("Empty, error and loading states announce themselves as status or alert", () => {
  const empty = renderToStaticMarkup(
    <ModelExplorerTable
      models={[]}
      selectedIds={[]}
      onToggle={() => undefined}
      compareLimitReached={false}
    />,
  );
  const loading = renderToStaticMarkup(<LoadingState title="Loading models…" />);
  const error = renderToStaticMarkup(
    <ErrorState
      title="The model catalog could not be read"
      description="The adapter failed."
    />,
  );
  const compareEmpty = renderToStaticMarkup(
    <ModelCompareView comparison={compareReadModel([], [])} />,
  );

  assert.match(empty, /role="status"/);
  assert.match(empty, /No models match these filters/);
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Loading models…/);
  assert.match(error, /role="alert"/);
  assert.match(error, /The model catalog could not be read/);
  assert.match(compareEmpty, /No models to compare/);
});

test("Compare table uses row headers and does not rank or name a winner", () => {
  const html = renderToStaticMarkup(
    <ModelCompareView
      comparison={compareReadModel(
        [compareColumn({ vision: observedBoolean(null) })],
        ["missing:model"],
      )}
    />,
  );

  assert.match(html, /<table [^>]*aria-label="Model comparison"/);
  assert.match(html, /<th scope="row"[^>]*>Input price/);
  assert.match(html, /<th scope="row"[^>]*>Output price/);
  assert.match(html, /<th scope="row"[^>]*>Context/);
  assert.match(html, /<th scope="row"[^>]*>Max output/);
  assert.match(html, /<th scope="row"[^>]*>Vision/);
  assert.match(html, /<th scope="row"[^>]*>Tools/);
  assert.match(html, /<th scope="row"[^>]*>Lifecycle/);
  assert.match(html, /<th scope="row"[^>]*>Freshness/);
  assert.match(html, /<th scope="row"[^>]*>Pricing source/);
  assert.match(html, /<th scope="row"[^>]*>Capability source/);
  assert.match(html, /<th scope="row"[^>]*>Lifecycle source/);
  // A domain with no observation says so rather than borrowing another source.
  assert.match(html, /Not observed/);
  assert.match(html, /Unknown/);
  assert.match(html, /does not rank/i);
  assert.doesNotMatch(html, /best model/i);
  assert.match(html, /missing:model/);
  assert.match(html, /Where did this come from\?/);
  assert.doesNotMatch(html, /radar-provenance-body/);
  assert.doesNotMatch(html, /radar-provenance-grid/);
});

test("Mobile cards use a labelled list with the same fields as the table", () => {
  const html = renderToStaticMarkup(
    <ModelExplorerCards
      models={[explorerRow({ vision: observedBoolean(null) })]}
      selectedIds={[]}
      onToggle={() => undefined}
      compareLimitReached={false}
    />,
  );

  assert.match(html, /<ul [^>]*aria-label="Model catalog"/);
  assert.match(html, /<dl/);
  assert.match(html, />Input</);
  assert.match(html, />Vision</);
  assert.match(html, /Unknown/);
  assert.match(html, /Where did this come from\?/);
  assert.match(html, /type="checkbox"/);
});

test("Stale evidence is announced in words, not only by colour", () => {
  const html = renderToStaticMarkup(
    <EvidenceBanner
      quality="stale"
      note="Some models below were last observed more than 48 hours ago."
    />,
  );

  assert.match(html, /role="status"/);
  assert.match(html, /stale/i);
  assert.match(html, /more than 48 hours ago/);
});
