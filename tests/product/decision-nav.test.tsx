import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { DecisionActions } from "../../components/radar/dashboard/DecisionActions";
import {
  ASK_NAV,
  PRODUCT_TOUR,
  RADAR_PRIMARY_NAV,
  RADAR_SECONDARY_NAV,
  isRouteActive,
} from "../../components/radar/layout/nav";
import { OptimizerResults } from "../../components/product/optimizer/OptimizerResults";
import { AskResult } from "../../components/product/ask/AskResult";
import { PageIntro } from "../../components/product/common/PageIntro";
import { DEFAULT_OPTIMIZER_INPUT, appliedConstraintsFromInput } from "../../lib/product/optimizer";
import { fixtureOptimizerModels } from "../../lib/product/optimizer-fixture";
import { createFixtureAskAdapter } from "../../lib/product/ask-fixture";

test("Primary navigation stays compact; tools live in secondary nav; Ask stays a distinct action", () => {
  const hrefs = RADAR_PRIMARY_NAV.map((item) => item.href);
  const secondary = RADAR_SECONDARY_NAV.map((item) => item.href);

  assert.deepEqual(hrefs, ["/", "/models", "/changes", "/my-stack", "/sources"]);
  assert.ok(secondary.includes("/models/compare"));
  assert.ok(secondary.includes("/optimizer"));
  assert.ok(secondary.includes("/source-health"));
  assert.ok(secondary.includes("/demo/healing"));
  assert.equal(ASK_NAV.href, "/ask");
  assert.equal(ASK_NAV.label, "Ask");
  assert.equal(RADAR_PRIMARY_NAV.length, 5);
  assert.equal(RADAR_SECONDARY_NAV.length, 4);
});

test("Models is current on detail, Compare is current only on the compare route", () => {
  assert.equal(isRouteActive("/models", "/models"), true);
  assert.equal(isRouteActive("/models/anthropic:claude", "/models"), true);
  assert.equal(isRouteActive("/models/compare", "/models"), false);
  assert.equal(isRouteActive("/models/compare", "/models/compare"), true);
  assert.equal(isRouteActive("/optimizer", "/optimizer"), true);
  assert.equal(isRouteActive("/ask", "/ask"), true);
  assert.equal(isRouteActive("/", "/"), true);
  assert.equal(isRouteActive("/models", "/"), false);
});

test("Dashboard command center links every major product action", () => {
  const html = renderToStaticMarkup(<DecisionActions />);

  assert.match(html, /aria-label="Command center"/);
  assert.match(html, /href="\/models"/);
  assert.match(html, /Explore Models/);
  assert.match(html, /href="\/models\/compare"/);
  assert.match(html, />Compare</);
  assert.match(html, /href="\/optimizer"/);
  assert.match(html, /Optimize Stack/);
  assert.match(html, /href="\/ask"/);
  assert.match(html, /Ask AI Radar/);
  assert.match(html, /not model memory/);
  assert.match(html, /href="\/changes"/);
  assert.match(html, /View Changes/);
  assert.match(html, /href="\/source-health"/);
  assert.match(html, /Source Health/);
  assert.match(html, /href="\/demo\/healing"/);
  assert.match(html, /Real Healing Demo/);
  assert.match(html, /aria-label="Product tour"/);
  for (const step of PRODUCT_TOUR) {
    assert.match(html, new RegExp(`href="${step.href.replaceAll("/", "\\/")}"`));
  }
});

test("Existing product intros can link into Optimizer and Ask", () => {
  const html = renderToStaticMarkup(
    <PageIntro
      title="Model explorer"
      description="Catalog"
      action={
        <span className="radar-page-intro-links">
          <a href="/optimizer">Find a best fit</a>
          <a href="/ask">Ask AI Radar</a>
        </span>
      }
    />,
  );

  assert.match(html, /href="\/optimizer"/);
  assert.match(html, /href="\/ask"/);
});

test("Optimizer results compare-eligible control uses canonical ids", () => {
  const models = fixtureOptimizerModels();
  const ranked = models.filter((model) => model.eligibility === "eligible");
  const html = renderToStaticMarkup(
    <OptimizerResults
      result={{
        input: DEFAULT_OPTIMIZER_INPUT,
        appliedConstraints: appliedConstraintsFromInput(DEFAULT_OPTIMIZER_INPUT),
        bestFit: ranked[0],
        ranked,
        other: models.filter((model) => model.eligibility !== "eligible"),
        providerOptions: [],
        generatedAt: "2026-08-19T12:00:00.000Z",
        isDemo: true,
        evidenceQuality: "current",
        evidenceNote: null,
        emptyReason: null,
      }}
    />,
  );

  assert.match(html, /href="\/models\/compare\?ids=/);
  assert.match(html, /Compare eligible/);
});

test("Ask decision evidence can hand off to Optimizer, models, changes and sources", async () => {
  const result = await createFixtureAskAdapter().ask(
    "Compare eligible Anthropic and OpenAI options.",
  );
  const html = renderToStaticMarkup(<AskResult result={result} />);

  assert.match(html, /href="\/models\/anthropic%3Aclaude-sonnet-4-5"/);
  assert.match(html, /href="\/models\/compare\?ids=/);
  assert.match(html, /href="\/optimizer"/);
  assert.match(html, /href="\/changes"/);
  assert.match(html, /href="\/sources"/);
  assert.match(html, /Open Optimizer/);
});
