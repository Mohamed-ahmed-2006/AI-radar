import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { HealingBrightDataPanel } from "../../components/product/healing-demo/HealingBrightDataPanel";
import { HealingDemoControls } from "../../components/product/healing-demo/HealingDemoControls";
import { HealingDemoKindBanner } from "../../components/product/healing-demo/HealingDemoKindBanner";
import { HealingDemoLinks } from "../../components/product/healing-demo/HealingDemoLinks";
import { HealingDemoPhaseHero } from "../../components/product/healing-demo/HealingDemoPhaseHero";
import { HealingDemoView } from "../../components/product/healing-demo/HealingDemoView";
import { HealingTrustComparison } from "../../components/product/healing-demo/HealingTrustComparison";
import { SourceDetail } from "../../components/product/sources/SourceDetail";
import { RecoveryTimeline } from "../../components/radar/sentinel/RecoveryTimeline";
import { SourceHealthDashboard } from "../../components/radar/sentinel/SourceHealthDashboard";
import {
  HEALING_DEMO_UNAVAILABLE_TITLE,
  timelineToSentinelStages,
  unavailableHealingDemoReadModel,
} from "../../lib/product/healing-demo";
import { fixtureHealingDemoReadModel } from "../../lib/product/healing-demo-fixture";
import { buildSourceDetailFromSentinel } from "../../lib/product/sentinel-source-detail";
import { sentinelView } from "./support/fixtures";

function renderPhase(phase: Parameters<typeof fixtureHealingDemoReadModel>[0]) {
  return renderToStaticMarkup(
    <HealingDemoView initial={fixtureHealingDemoReadModel(phase)} />,
  );
}

test("healthy state shows the large HEALTHY phase and last-known-good", () => {
  const html = renderPhase("healthy");
  assert.match(html, />HEALTHY</);
  assert.match(html, /Trusted current is last-known-good/);
  assert.match(html, /Last-known-good/);
  assert.match(html, /Bright Data Scraper Studio/);
  assert.match(html, /SourcePulse/);
  assert.match(html, /Sentinel/);
});

test("failure state spells BREAK in text, not only by colour", () => {
  const html = renderPhase("break");
  assert.match(html, />BREAK</);
  assert.match(html, /Extraction failed/);
  assert.match(html, /sr-only"> — failed/);
});

test("detected and quarantined states keep last-known-good unchanged", () => {
  const detected = renderPhase("detected");
  assert.match(detected, />DETECTED</);
  assert.match(detected, /RECORD_COUNT_COLLAPSE/);

  const quarantined = renderPhase("quarantined");
  assert.match(quarantined, />QUARANTINED</);
  assert.match(quarantined, /Latest attempt/);
  assert.match(quarantined, /Invalid \/ Quarantined/);
  assert.match(quarantined, /Trusted current/);
  assert.match(quarantined, /Last-known-good · Unchanged/);
  assert.match(quarantined, /18/);
  assert.match(quarantined, /3 records/);
});

test("healing and preview-waiting expose Bright Data without secrets", () => {
  const healing = renderPhase("healing");
  assert.match(healing, />HEALING</);
  assert.match(healing, /Scraper Studio/);
  assert.match(healing, /c_healing_demo_studio/);
  assert.match(healing, /Heal \/ refactor requested/);
  assert.doesNotMatch(healing, /api[_-]?key/i);
  assert.doesNotMatch(healing, /Bearer /i);

  const waiting = renderPhase("preview_waiting");
  assert.match(waiting, />PREVIEW</);
  assert.match(waiting, /Waiting for a Bright Data preview/);
});

test("preview failed blocks approval; preview validated enables it", () => {
  const failedModel = fixtureHealingDemoReadModel("preview_failed");
  const failed = renderToStaticMarkup(
    <HealingDemoControls model={failedModel} pendingAction={null} error={null} onAction={() => undefined} />,
  );
  assert.match(failed, /Approve validated preview/);
  assert.match(failed, /Available only after a valid preview/);
  assert.ok(!failedModel.allowedActions.includes("approve_preview"));
  const failedApprove = failed.match(
    /<button[^>]*>Approve validated preview/,
  )?.[0];
  assert.ok(failedApprove);
  assert.match(failedApprove, /\sdisabled/);

  const validModel = fixtureHealingDemoReadModel("preview_validated");
  const valid = renderToStaticMarkup(
    <HealingDemoControls model={validModel} pendingAction={null} error={null} onAction={() => undefined} />,
  );
  assert.match(valid, /Approve validated preview/);
  assert.ok(validModel.allowedActions.includes("approve_preview"));
  const validApprove = valid.match(
    /<button[^>]*>Approve validated preview/,
  )?.[0];
  assert.ok(validApprove);
  assert.doesNotMatch(validApprove, /\sdisabled/);
});

test("rerun and recovered show the new trusted current", () => {
  const rerun = renderPhase("rerun");
  assert.match(rerun, />RERUN</);

  const recovered = renderPhase("recovered");
  assert.match(recovered, />RECOVERED</);
  assert.match(recovered, /New trusted current/);
  assert.match(recovered, /Validated/);
  assert.match(recovered, /radar-recovery-sweep/);
});

test("LKG comparison uses Sentinel snapshot cards", () => {
  const quarantined = renderToStaticMarkup(
    <HealingTrustComparison model={fixtureHealingDemoReadModel("quarantined")} />,
  );
  assert.match(quarantined, /Latest attempt/);
  assert.match(quarantined, /Invalid \/ Quarantined/);
  assert.match(quarantined, /Trusted current/);
  assert.match(quarantined, /Last-known-good/);

  const recovered = renderToStaticMarkup(
    <HealingTrustComparison model={fixtureHealingDemoReadModel("recovered")} />,
  );
  assert.match(recovered, /New trusted current/);
  assert.match(recovered, /Validated/);
});

test("real vs fixture labels never impersonate each other", () => {
  const real = renderToStaticMarkup(
    <HealingDemoKindBanner kind="real_bright_data_demo" kindLabel="Real Bright Data demo" />,
  );
  assert.match(real, /Real Bright Data demo/);
  assert.match(real, /not the in-memory Sentinel demo/);
  assert.doesNotMatch(real, /Demo data/);
  assert.doesNotMatch(real, /MOCK DATA/);

  const fixture = renderToStaticMarkup(
    <HealingDemoKindBanner kind="fixture" kindLabel="Fixture / tests only" />,
  );
  assert.match(fixture, /Fixture \/ tests only/);
  assert.match(fixture, /Never installed as the production default/);
});

test("unavailable backend shows the exact fail-closed title and no fake timeline", () => {
  const html = renderToStaticMarkup(
    <HealingDemoView initial={unavailableHealingDemoReadModel()} />,
  );
  assert.match(html, new RegExp(HEALING_DEMO_UNAVAILABLE_TITLE));
  assert.doesNotMatch(html, /aria-label="SourcePulse recovery timeline"/);
  assert.doesNotMatch(html, />RECOVERED</);
  assert.doesNotMatch(html, /MOCK DATA/);
  assert.match(html, /role="status"/);
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /role="alert"/);
});

test("controls are buttons with an allowlisted vocabulary and no free-text targeting", () => {
  const html = renderToStaticMarkup(
    <HealingDemoControls
      model={fixtureHealingDemoReadModel("healthy")}
      pendingAction={null}
      error={null}
      onAction={() => undefined}
    />,
  );
  assert.match(html, /Reset demo/);
  assert.match(html, /Establish healthy baseline/);
  assert.match(html, /Trigger controlled failure/);
  assert.match(html, /Run broken collector/);
  assert.match(html, /Start healing/);
  assert.match(html, /Rerun \/ Recover/);
  assert.match(html, /Isolated demo source only/);
  assert.doesNotMatch(html, /<input/);
  assert.doesNotMatch(html, /<textarea/);
  assert.doesNotMatch(html, /name="collector/i);
  assert.doesNotMatch(html, /name="sourceUrl/i);
  assert.match(html, /role="group" aria-label="Healing demo actions"/);
});

test("recovery timeline reuses Sentinel rail semantics including duration", () => {
  const model = fixtureHealingDemoReadModel("quarantined");
  const html = renderToStaticMarkup(
    <RecoveryTimeline
      stages={timelineToSentinelStages(model.timeline)}
      wide
      label="SourcePulse recovery timeline"
    />,
  );
  assert.match(html, /aria-label="SourcePulse recovery timeline"/);
  assert.match(html, /Healthy baseline/);
  assert.match(html, /Candidate quarantined/);
  assert.match(html, /sr-only"> — /);
  assert.match(html, / · \d+s/);
});

test("live phase updates are announced and status is not colour-only", () => {
  const html = renderPhase("healing");
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /role="status"/);
  assert.match(html, />HEALING</);
  assert.match(html, /Healing/);
});

test("Bright Data panel names collector, studio, preview, approval and rerun", () => {
  const html = renderToStaticMarkup(
    <HealingBrightDataPanel model={fixtureHealingDemoReadModel("preview_validated")} />,
  );
  assert.match(html, /Bright Data Scraper Studio/);
  assert.match(html, /Collector ID/);
  assert.match(html, /c_healing_demo_studio/);
  assert.match(html, /Preview/);
  assert.match(html, /Approval/);
  assert.match(html, /Rerun/);
});

test("phase hero keeps SourcePulse / Sentinel identity readable at demo size", () => {
  const html = renderToStaticMarkup(
    <HealingDemoPhaseHero model={fixtureHealingDemoReadModel("quarantined")} />,
  );
  assert.match(html, /SourcePulse · Sentinel/);
  assert.match(html, />QUARANTINED</);
});

test("demo cross-links Source Health, Source Detail and provenance", () => {
  const html = renderToStaticMarkup(
    <HealingDemoLinks model={fixtureHealingDemoReadModel("recovered")} />,
  );
  assert.match(html, /href="\/source-health"/);
  assert.match(html, /href="\/sources\/src-healing-demo-isolated"/);
  assert.match(html, /#source-provenance/);
  assert.match(html, /#source-incidents/);
});

test("Source Health and Source Detail point at the real healing demo", () => {
  const health = renderToStaticMarkup(
    <SourceHealthDashboard view={null} error="offline" />,
  );
  assert.match(health, /href="\/demo\/healing"/);
  assert.match(health, /Real Bright Data healing demo/);

  const detail = buildSourceDetailFromSentinel(sentinelView(), "src-openai-pricing");
  assert.ok(detail);
  const detailHtml = renderToStaticMarkup(<SourceDetail detail={detail} />);
  assert.match(detailHtml, /href="\/demo\/healing"/);
  assert.match(detailHtml, /Real healing demo/);
});
