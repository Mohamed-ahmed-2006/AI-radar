import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RadarDashboard } from "../../components/radar/dashboard/RadarDashboard";
import { RecentChangesFeed } from "../../components/radar/dashboard/RecentChangesFeed";
import { MOCK_RADAR_DATA } from "../../components/radar/fixtures/mock-radar-data";
import type { RadarDashboardData } from "../../components/radar/types";
import { EvidenceState } from "../../components/radar/ui/DataState";
import { ChangeFeedItemCard } from "../../components/product/changes/ChangeFeedItemCard";
import { AskResult } from "../../components/product/ask/AskResult";
import { ModelDetailView } from "../../components/product/explorer/ModelDetailView";
import { createFixtureAskAdapter } from "../../lib/product/ask-fixture";
import { changeFeedItem } from "./support/fixtures";
import { detailReadModel } from "./support/explorer-fixtures";

function dashboardData(
  overrides: Partial<RadarDashboardData> = {},
): RadarDashboardData {
  return {
    ...MOCK_RADAR_DATA,
    ...overrides,
    ecosystem: { ...MOCK_RADAR_DATA.ecosystem, ...overrides.ecosystem },
    sentinel: { ...MOCK_RADAR_DATA.sentinel, ...overrides.sentinel },
  };
}

test("Dashboard command center exposes live-looking stats without inventing Sentinel zeros", () => {
  const html = renderToStaticMarkup(
    createElement(RadarDashboard, { data: dashboardData() }),
  );

  assert.match(html, /Intelligence Console/);
  assert.match(html, /Canonical models/);
  assert.match(html, /Monitored sources/);
  assert.match(html, /Lifecycle \(7d\)/);
  assert.match(html, /Source health counts are not available/);
  assert.match(html, /Fixture dashboard is not connected to live Sentinel/);
  assert.match(html, /Explore Models/);
  assert.match(html, /Optimize Stack/);
  assert.match(html, /Ask AI Radar/);
  assert.match(html, /Real Healing Demo/);
  assert.match(html, /Judge path/);
  assert.doesNotMatch(html, /Quarantined/);
});

test("Unavailable dashboard keeps command center but does not render fixture catalog rows", () => {
  const html = renderToStaticMarkup(
    createElement(RadarDashboard, {
      data: {
        ...MOCK_RADAR_DATA,
        isMock: false,
        unavailableReason: "Live catalog is not configured.",
        models: MOCK_RADAR_DATA.models,
        changes: MOCK_RADAR_DATA.changes,
      },
    }),
  );

  assert.match(html, /Intelligence Console/);
  assert.match(html, /Live dashboard data is not available/);
  assert.match(html, /Ask AI Radar/);
  assert.doesNotMatch(html, /gpt-5\.6-luna/);
  assert.doesNotMatch(html, /Canonical models/);
});

test("Dashboard Sentinel glance uses recovered/degraded/quarantined counts only when available", () => {
  const html = renderToStaticMarkup(
    createElement(RadarDashboard, {
      data: dashboardData({
        sentinel: {
          available: true,
          unavailableReason: null,
          isDemo: false,
          totalSources: 4,
          healthy: 2,
          degraded: 1,
          quarantined: 1,
          recovered: 0,
          healing: 0,
          needsReview: 0,
        },
      }),
    }),
  );

  assert.match(html, /Source health/);
  assert.match(html, /Degraded/);
  assert.match(html, /Quarantined/);
  assert.match(html, /Recovered/);
  assert.doesNotMatch(html, /Source health counts are not available/);
});

test("Unknown evidence and unsupported questions use distinct status treatments", () => {
  const unknown = renderToStaticMarkup(
    <EvidenceState
      tone="unknown"
      title="Vision has not been observed"
      description="Unknown is not the same as unsupported."
    />,
  );
  const unsupported = renderToStaticMarkup(
    <EvidenceState
      tone="unsupported"
      title="This question is unsupported"
      description="Outside grounded temporal and decision questions."
    />,
  );

  assert.match(unknown, /radar-evidence-state-unknown/);
  assert.match(unknown, />Unknown</);
  assert.match(unknown, /role="status"/);
  assert.doesNotMatch(unknown, /Unsupported/);
  assert.match(unsupported, /radar-evidence-state-unsupported/);
  assert.match(unsupported, />Unsupported</);
  assert.match(unsupported, /role="alert"/);
  assert.doesNotMatch(unsupported, /radar-evidence-state-unknown/);
});

test("Dashboard change rows link to model, source and the change feed", () => {
  const html = renderToStaticMarkup(
    <RecentChangesFeed
      changes={[
        {
          id: "chg-live",
          type: "price_change",
          provider: "Anthropic",
          model: "Claude Sonnet 4.5",
          modelCanonicalId: "anthropic:claude-sonnet-4-5",
          summary: "Output price moved",
          detectedAt: "2026-08-19T12:00:00.000Z",
          sourceId: "src-anthropic-pricing",
          severity: "info",
        },
      ]}
    />,
  );

  assert.match(html, /href="\/changes"/);
  assert.match(html, /href="\/models\/anthropic%3Aclaude-sonnet-4-5"/);
  assert.match(html, /href="\/sources\/src-anthropic-pricing"/);
  assert.match(html, /Where did this come from|Provenance/);
});

test("Change feed items link to model detail and source detail without inventing ids", () => {
  const withSource = renderToStaticMarkup(
    <ChangeFeedItemCard item={changeFeedItem()} />,
  );
  const withoutSource = renderToStaticMarkup(
    <ChangeFeedItemCard item={changeFeedItem({ sourceId: null })} />,
  );

  assert.match(withSource, /href="\/models\/anthropic%3Aclaude-3-5-sonnet-20241022"/);
  assert.match(withSource, /href="\/sources\/src-anthropic-pricing"/);
  assert.match(withSource, /Where did this come from\?/);
  assert.doesNotMatch(withoutSource, /href="\/sources\//);
});

test("Ask unsupported answers stay distinct from unknown missing evidence", async () => {
  const unsupported = await createFixtureAskAdapter().ask("Write a poem about GPUs");
  const html = renderToStaticMarkup(<AskResult result={unsupported} />);

  assert.match(html, /This question is unsupported/);
  assert.match(html, /radar-evidence-state-unsupported/);
  assert.doesNotMatch(html, /radar-evidence-state-unknown/);
});

test("Model detail offers My Stack, Compare and Optimizer without leaving provenance", () => {
  const html = renderToStaticMarkup(<ModelDetailView detail={detailReadModel()} />);

  assert.match(html, /Add to My Stack/);
  assert.match(html, /href="\/models\/compare\?ids=/);
  assert.match(html, /href="\/optimizer"/);
  assert.match(html, /href="\/my-stack"/);
  assert.match(html, /Where did this come from\?/);
});
