import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { DecisionActions } from "../../components/radar/dashboard/DecisionActions";
import { ASK_NAV, RADAR_PRIMARY_NAV, isRouteActive } from "../../components/radar/layout/nav";
import { OptimizerResults } from "../../components/product/optimizer/OptimizerResults";
import { AskResult } from "../../components/product/ask/AskResult";
import { PageIntro } from "../../components/product/common/PageIntro";
import { DEFAULT_OPTIMIZER_INPUT, appliedConstraintsFromInput } from "../../lib/product/optimizer";
import { fixtureOptimizerModels } from "../../lib/product/optimizer-fixture";
import { createFixtureAskAdapter } from "../../lib/product/ask-fixture";

test("Primary navigation includes Optimizer without crowding Ask into the text list", () => {
  const hrefs = RADAR_PRIMARY_NAV.map((item) => item.href);
  const labels = RADAR_PRIMARY_NAV.map((item) => item.label);

  assert.ok(hrefs.includes("/optimizer"));
  assert.ok(labels.includes("Optimizer"));
  assert.ok(hrefs.includes("/models"));
  assert.ok(hrefs.includes("/changes"));
  assert.ok(hrefs.includes("/my-stack"));
  assert.ok(hrefs.includes("/sources"));
  assert.equal(ASK_NAV.href, "/ask");
  assert.equal(ASK_NAV.label, "Ask");
  assert.equal(RADAR_PRIMARY_NAV.length, 6);
});

test("Optimizer route is treated as the current page, Ask is a distinct action", () => {
  assert.equal(isRouteActive("/optimizer", "/optimizer"), true);
  assert.equal(isRouteActive("/optimizer/unused", "/optimizer"), true);
  assert.equal(isRouteActive("/models", "/optimizer"), false);
  assert.equal(isRouteActive("/ask", "/ask"), true);
  assert.equal(isRouteActive("/", "/"), true);
  assert.equal(isRouteActive("/models", "/"), false);
});

test("Dashboard decision actions link to Optimizer and Ask", () => {
  const html = renderToStaticMarkup(<DecisionActions />);

  assert.match(html, /aria-label="Decision intelligence"/);
  assert.match(html, /href="\/optimizer"/);
  assert.match(html, /Find the best-fit model/);
  assert.match(html, /href="\/ask"/);
  assert.match(html, /Ask from live evidence/);
  assert.match(html, /not model memory/);
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

test("Ask decision evidence can hand off to Optimizer and model detail", async () => {
  const result = await createFixtureAskAdapter().ask(
    "Compare eligible Anthropic and OpenAI options.",
  );
  const html = renderToStaticMarkup(<AskResult result={result} />);

  assert.match(html, /href="\/models\/anthropic%3Aclaude-sonnet-4-5"/);
  assert.match(html, /href="\/models\/compare\?ids=/);
});
