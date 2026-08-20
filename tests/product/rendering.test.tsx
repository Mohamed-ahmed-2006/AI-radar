/**
 * Markup-level checks for the product surfaces.
 *
 * These render the presentational components to static HTML so the semantics a
 * screen reader depends on — list structure, definition lists, `<time>`,
 * accessible names, and status words next to every coloured indicator — are
 * asserted rather than assumed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { ChangeFeedList } from "../../components/product/changes/ChangeFeedList";
import { ProvenanceDetails } from "../../components/product/provenance/ProvenanceDetails";
import { ProvenanceDisclosure } from "../../components/product/provenance/ProvenanceDisclosure";
import { SourceDataPanel } from "../../components/product/sources/SourceDataPanel";
import { SourceHealthSummary } from "../../components/product/sources/SourceHealthSummary";
import { SourceRunHistoryPanel } from "../../components/product/sources/SourceRunHistoryPanel";
import { provenanceFromSource } from "../../lib/product/provenance";
import { unavailable } from "../../lib/product/source-detail";
import { changeFeedItem } from "./support/fixtures";

test("Change feed renders as a labelled ordered list of changes", () => {
  const html = renderToStaticMarkup(
    <ChangeFeedList items={[changeFeedItem()]} label="Ecosystem change feed" />,
  );

  assert.match(html, /<ol [^>]*aria-label="Ecosystem change feed"/);
  assert.match(html, /<li /);
  assert.match(html, /Price decrease/);
  assert.match(html, /Claude 3\.5 Sonnet/);
  assert.match(html, /Cached input pricing fell/);
});

test("Change feed item shows provider, before → after, and an observed timestamp", () => {
  const html = renderToStaticMarkup(
    <ChangeFeedList items={[changeFeedItem()]} label="Feed" />,
  );

  assert.match(html, /Anthropic/);
  assert.match(html, /Before/);
  assert.match(html, /\$3\.00/);
  assert.match(html, /After/);
  assert.match(html, /\$0\.30/);
  // Case-insensitive: the static renderer emits the JSX prop name verbatim.
  assert.match(html, /<time datetime="2026-08-11T09:15:00\.000Z"/i);
});

test("Change direction is stated in words, not by colour alone", () => {
  const html = renderToStaticMarkup(
    <ChangeFeedList items={[changeFeedItem()]} label="Feed" />,
  );

  assert.match(html, /−90\.0%/);
  assert.match(html, /decrease<\/span>/, "the direction must also be readable as text");
});

test("Change feed exposes a provenance affordance on every item", () => {
  const html = renderToStaticMarkup(
    <ChangeFeedList items={[changeFeedItem()]} label="Feed" />,
  );

  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.match(html, /Where did this come from\?/);
  assert.match(html, /Official source/);
});

test("Watched changes are marked in text, not only by their accent", () => {
  const item = changeFeedItem();
  const html = renderToStaticMarkup(
    <ChangeFeedList items={[item]} label="Feed" watchedKeys={[item.modelKey]} />,
  );

  assert.match(html, /In My Stack/);
  assert.match(html, /radar-change-item-watched/);
});

test("Demo evidence is labelled on the item itself", () => {
  const html = renderToStaticMarkup(
    <ChangeFeedList
      items={[changeFeedItem({ isDemo: true })]}
      label="Feed"
    />,
  );

  assert.match(html, />Demo</);
});

test("Live evidence carries no demo label", () => {
  const html = renderToStaticMarkup(
    <ChangeFeedList items={[changeFeedItem({ isDemo: false })]} label="Feed" />,
  );

  assert.doesNotMatch(html, />Demo</);
});

test("An empty change feed announces itself as a status", () => {
  const html = renderToStaticMarkup(
    <ChangeFeedList
      items={[]}
      label="Feed"
      emptyTitle="No changes in this window"
      emptyDescription="Widen the time range."
    />,
  );

  assert.match(html, /role="status"/);
  assert.match(html, /No changes in this window/);
  assert.match(html, /Widen the time range\./);
  assert.doesNotMatch(html, /<ol /);
});

test("Provenance renders as a definition list of the facts that are known", () => {
  const html = renderToStaticMarkup(
    <ProvenanceDetails
      provenance={provenanceFromSource({
        sourceLabel: "OpenAI API pricing",
        sourceUrl: "https://openai.com/api/pricing",
        collectorId: "c_abc123",
        observedAt: "2026-08-17T09:00:00.000Z",
        runId: "run-9f3",
        validation: { label: "Healthy", status: "passing" },
      })}
    />,
  );

  assert.match(html, /<dl/);
  assert.match(html, /<dt[^>]*>Official source<\/dt>/);
  assert.match(html, /<dt[^>]*>Source URL<\/dt>/);
  assert.match(html, /<dt[^>]*>Observed<\/dt>/);
  assert.match(html, /<dt[^>]*>Collector ID<\/dt>/);
  assert.match(html, /<dt[^>]*>Validation<\/dt>/);
  assert.match(html, /<dt[^>]*>Run<\/dt>/);
  assert.match(html, /c_abc123/);
  assert.match(html, /href="https:\/\/openai\.com\/api\/pricing"/);
  assert.match(html, /opens in a new tab/);
});

test("Provenance omits rows for facts the backend did not report", () => {
  const html = renderToStaticMarkup(
    <ProvenanceDetails provenance={provenanceFromSource({ sourceLabel: "Unnamed source" })} />,
  );

  assert.doesNotMatch(html, /Collector ID/);
  assert.doesNotMatch(html, /Source URL/);
  assert.doesNotMatch(html, /Observed</);
});

test("Provenance disclosure is a keyboard-operable details element with the trust level", () => {
  const html = renderToStaticMarkup(
    <ProvenanceDisclosure
      provenance={provenanceFromSource({
        sourceLabel: "OpenAI API pricing",
        authority: "verified_scrape",
      })}
      subject="OpenAI pricing change"
    />,
  );

  assert.match(html, /^<details/);
  assert.match(html, /<summary/);
  assert.match(html, /Verified scrape/);
  assert.match(html, /for OpenAI pricing change/);
});

test("Demo provenance is labelled inside the inspector too", () => {
  const html = renderToStaticMarkup(
    <ProvenanceDetails
      provenance={provenanceFromSource({ sourceLabel: "Seeded source", isDemo: true })}
    />,
  );

  assert.match(html, /Demo evidence/);
});

test("Source health states the status in words beside the indicator", () => {
  const html = renderToStaticMarkup(
    <SourceHealthSummary
      health={{
        status: "quarantined",
        statusLabel: "Quarantined",
        health: "down",
        recordCount: 12,
        openIncident: null,
      }}
      recovery={{ resolvedIncidents: 0, healingAttempts: 0, lastRecoveredAt: null }}
      freshness={{
        lastRunAt: "2026-08-17T09:00:00.000Z",
        lastSuccessAt: null,
        stalenessMinutes: 120,
        expectedIntervalMinutes: null,
      }}
    />,
  );

  assert.match(html, /Quarantined/);
  assert.match(html, /<dl/);
  assert.match(html, /Last success/);
  assert.match(html, /No successful run recorded/);
  assert.match(html, /Not declared/, "an undeclared interval must say so");
  assert.match(html, /2h/);
});

test("Source health reports a healthy source without inventing a missing figure", () => {
  const html = renderToStaticMarkup(
    <SourceHealthSummary
      health={{
        status: "healthy",
        statusLabel: "Healthy",
        health: "healthy",
        recordCount: null,
        openIncident: null,
      }}
      recovery={{ resolvedIncidents: 0, healingAttempts: 0, lastRecoveredAt: null }}
      freshness={{
        lastRunAt: null,
        lastSuccessAt: null,
        stalenessMinutes: null,
        expectedIntervalMinutes: null,
      }}
    />,
  );

  assert.match(html, /Healthy/);
  assert.match(html, /Not reported/);
  assert.match(html, /never/);
  assert.match(html, /unknown/);
});

test("An unavailable section renders an explicit note with its reason", () => {
  const html = renderToStaticMarkup(
    <SourceRunHistoryPanel
      runHistory={unavailable("The current backend exposes only the latest run.")}
    />,
  );

  assert.match(html, /Not available/);
  assert.match(html, /The current backend exposes only the latest run\./);
  assert.doesNotMatch(html, /<ol /);
});

test("Run history renders each run's seen, accepted and rejected counts", () => {
  const html = renderToStaticMarkup(
    <SourceRunHistoryPanel
      runHistory={{
        available: true,
        data: [
          {
            id: "run-9f3",
            status: "partial",
            startedAt: "2026-08-17T08:59:00.000Z",
            completedAt: "2026-08-17T09:00:00.000Z",
            recordsSeen: 13,
            recordsAccepted: 12,
            recordsRejected: 1,
            errorMessage: null,
          },
        ],
      }}
    />,
  );

  assert.match(html, /<ol [^>]*aria-label="Collection runs, newest first"/);
  assert.match(html, /Partial/);
  assert.match(html, /Seen/);
  assert.match(html, /Accepted/);
  assert.match(html, /Rejected/);
  assert.match(html, /run-9f3/);
});

test("Observed data and last-known-good each fall back to their own unavailable note", () => {
  const html = renderToStaticMarkup(
    <SourceDataPanel
      observedData={unavailable("No collection run has reported record counts.")}
      lastKnownGood={unavailable("No last-known-good snapshot has been recorded.")}
    />,
  );

  assert.match(html, /No collection run has reported record counts\./);
  assert.match(html, /No last-known-good snapshot has been recorded\./);
  assert.match(html, /Last-known-good state/);
});
