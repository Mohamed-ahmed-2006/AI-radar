import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { CurrentSessionCard } from "../../components/product/healing-demo/CurrentSessionCard";
import { HealingDemoView } from "../../components/product/healing-demo/HealingDemoView";
import { RecoveryLayoutCompare } from "../../components/product/healing-demo/RecoveryLayoutCompare";
import { RecoveryProofReplay } from "../../components/product/healing-demo/RecoveryProofReplay";
import { RECOVERY_PROOF_THESIS } from "../../lib/product/healing-demo-proof-view";
import {
  fixtureHealingDemoReadModelWithProof,
  fixtureHistoricalRecoveryProof,
} from "../../lib/product/healing-demo-fixture";

test("historical proof is labeled as a replay and does not look like a live run", () => {
  const html = renderToStaticMarkup(
    <HealingDemoView initial={fixtureHealingDemoReadModelWithProof("healthy")} />,
  );

  assert.match(html, /Ready for demonstration/i);
  assert.match(html, /Clean · Not started/);
  assert.match(html, /Verified recovery proof/i);
  assert.match(html, />Recovered</i);
  assert.match(html, /Historical · already completed · read-only/);
  assert.match(html, /Replay proof/);
  assert.match(html, /Inspect evidence/);
  assert.match(html, /Run a new live demonstration/i);
  assert.match(html, /The provider page changed its HTML structure/);
  assert.match(html, /The source recovered/);
  assert.doesNotMatch(html, /Inspect recovery/);
  assert.doesNotMatch(html, /Verified live recovery/i);
  assert.doesNotMatch(html, /method="post"/i);
});

test("proof chips and Bright Data / Sentinel roles come from the recorded proof", () => {
  const html = renderToStaticMarkup(
    <RecoveryProofReplay proof={fixtureHistoricalRecoveryProof()} />,
  );

  assert.match(html, /LKG preserved/);
  assert.match(html, /Bad canonical writes/);
  assert.match(html, />0</);
  assert.match(html, /Same collector repaired/);
  assert.match(html, /Real Bright Data evidence/);
  assert.match(html, /Bright Data Scraper Studio/);
  assert.match(html, /Collects \+ repairs the source/);
  assert.match(html, /Sentinel/);
  assert.match(html, /Decides whether extracted data is trusted/);
  assert.match(html, new RegExp(RECOVERY_PROOF_THESIS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /Trusted baseline/);
  assert.match(html, /Website layout changed/);
  assert.match(html, /10 \/ 10 accepted/);
  assert.match(html, /ZERO_RECORDS/);
  assert.match(html, /Write blocked/);
});

test("healthy vs broken comparison uses the proof URLs and identical quote content", () => {
  const html = renderToStaticMarkup(
    <RecoveryLayoutCompare proof={fixtureHistoricalRecoveryProof()} />,
  );

  assert.match(html, /Same content\. Different DOM structure/);
  assert.match(html, /Before — expected page structure/);
  assert.match(html, /After — website changed/);
  assert.match(html, /demo-source\/healthy/);
  assert.match(html, /demo-source\/broken/);
  assert.match(html, /Collector extraction → 0 records/);
  assert.match(html, /The only thing we have to fear is fear itself/);
  assert.match(html, /<table/);
});

test("current session stays separate from historical recovery", () => {
  const html = renderToStaticMarkup(
    <CurrentSessionCard model={fixtureHealingDemoReadModelWithProof("healthy")} />,
  );

  assert.match(html, /Current session/);
  assert.match(html, /Ready for demonstration/i);
  assert.match(html, /Clean · Not started/);
  assert.doesNotMatch(html, /Verified recovery proof/i);
  assert.doesNotMatch(html, /Verified live recovery/i);
});

test("replay controls are buttons and never a mutation form", () => {
  const html = renderToStaticMarkup(
    <RecoveryProofReplay proof={fixtureHistoricalRecoveryProof()} />,
  );

  assert.match(html, /<button type="button"[^>]*>Replay proof/);
  assert.match(html, /<button type="button"[^>]*>Inspect evidence/);
  assert.match(html, /<button type="button"[^>]*>Skip to result/);
  assert.doesNotMatch(html, /\/api\/demo\/healing/);
});
