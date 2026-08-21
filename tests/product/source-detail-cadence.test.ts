/**
 * Source Detail must publish the cadence the fleet schedules a source at, not
 * the staleness budget its health contract tolerates.
 *
 * Production showed the Google Gemini model catalog with an expected interval of
 * 1440m. The catalog cadence is 720m; 1440 is `sourceFreshness.maxStalenessMinutes`
 * from the Sentinel contract, which answers a different question — how old an
 * observation may get before it stops being trusted. Publishing it as the
 * expected interval made the screen understate the source's freshness pressure
 * by half and disagree with the dashboard's own freshness panel.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { CADENCE_DEFAULTS } from "../../lib/orchestration/cadence";
import { buildSourceDetailFromReadModel } from "../../lib/product/source-detail-read-model";
import { createCatalogSourceHealthContract } from "../../lib/sentinel";
import { InMemorySourceReadPort } from "../../lib/sources/in-memory-port";
import { getSourceDetail } from "../../lib/sources/read-model";
import {
  NOW,
  PRICING_SOURCE,
  healthySourceData,
} from "../sources/support/fixtures";

async function detailFor(sourceId: string, data = healthySourceData()) {
  const port = new InMemorySourceReadPort(data);
  const detail = await getSourceDetail(sourceId, { port, now: () => NOW });
  assert.ok(detail, "fixture source should resolve");
  return buildSourceDetailFromReadModel(detail);
}

test("Source Detail publishes the scheduled cadence, not the contract's staleness budget", async () => {
  const detail = await detailFor(PRICING_SOURCE.id);

  assert.equal(detail.identity.category, "pricing");
  assert.equal(detail.freshness.expectedIntervalMinutes, CADENCE_DEFAULTS.pricing);

  // The two numbers are genuinely different, which is why publishing the wrong
  // one was invisible: both are plausible-looking minute counts.
  const contract = createCatalogSourceHealthContract("openai", PRICING_SOURCE.id);
  assert.notEqual(
    contract.sourceFreshness.maxStalenessMinutes,
    CADENCE_DEFAULTS.pricing,
  );
});

test("catalog cadence is 720m, which is what a catalog source must report", () => {
  assert.equal(CADENCE_DEFAULTS.catalog, 720);
  // The staleness budget every catalog contract carries, for contrast.
  assert.equal(
    createCatalogSourceHealthContract("gemini", "catalog-gemini").sourceFreshness
      .maxStalenessMinutes,
    1440,
  );
});
