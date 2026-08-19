import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryModelExplorerReadPort, compareModels } from "../../lib/explorer";
import {
  CLAUDE_3_OPUS,
  CLAUDE_SONNET_5,
  GEMINI_3_PRO,
  GEMINI_25_FLASH,
  GEMINI_25_FLASH_PREVIEW,
  GEMINI_IMAGEN,
  GPT_5,
  GROK_4,
  explorerData,
  now,
} from "./support/fixtures";

const port = () => new InMemoryModelExplorerReadPort(explorerData());

function rowOf(
  comparison: Awaited<ReturnType<typeof compareModels>>,
  field: string,
) {
  const row = comparison.rows.find((candidate) => candidate.field === field);
  assert.ok(row, `expected a ${field} row`);
  return row;
}

test("Compare: rows stay aligned with the requested models, in order", async () => {
  const comparison = await compareModels(
    [GPT_5.id, CLAUDE_SONNET_5.id, GROK_4.id],
    { port: port(), now },
  );

  assert.deepEqual(
    comparison.models.map((entry) => entry.canonicalModelId),
    [GPT_5.id, CLAUDE_SONNET_5.id, GROK_4.id],
  );
  for (const row of comparison.rows) {
    assert.equal(row.cells.length, 3, `${row.field} must have one cell per model`);
    assert.deepEqual(
      row.cells.map((cell) => cell.canonicalModelId),
      [GPT_5.id, CLAUDE_SONNET_5.id, GROK_4.id],
      `${row.field} cells must stay in requested order`,
    );
  }
  assert.deepEqual(comparison.unresolvedIds, []);
});

test("Compare: prices, context, output limits and modalities line up", async () => {
  const comparison = await compareModels(
    [GPT_5.id, CLAUDE_SONNET_5.id, GEMINI_25_FLASH.id],
    { port: port(), now },
  );

  assert.deepEqual(
    rowOf(comparison, "inputPricePer1MTokens").cells.map((cell) => cell.value),
    [1.25, 3, 0.3],
  );
  assert.deepEqual(
    rowOf(comparison, "outputPricePer1MTokens").cells.map((cell) => cell.value),
    [10, 15, 2.5],
  );
  assert.deepEqual(
    rowOf(comparison, "contextWindow").cells.map((cell) => cell.value),
    [400_000, 200_000, 1_000_000],
  );
  assert.deepEqual(
    rowOf(comparison, "maxOutputTokens").cells.map((cell) => cell.value),
    [128_000, 64_000, 65_536],
  );
  assert.deepEqual(
    rowOf(comparison, "inputModalities").cells.map((cell) => cell.value),
    [["text", "image"], ["text"], ["text", "image", "audio"]],
  );
  assert.deepEqual(
    rowOf(comparison, "currency").cells.map((cell) => cell.value),
    ["USD", "USD", "USD"],
  );
});

test("Compare: unknown is reported as unknown, never as a false or a zero", async () => {
  const comparison = await compareModels(
    [GPT_5.id, CLAUDE_SONNET_5.id, GROK_4.id, GEMINI_3_PRO.id],
    { port: port(), now },
  );

  const vision = rowOf(comparison, "supportsVision");
  assert.deepEqual(
    vision.cells.map((cell) => [cell.value, cell.known]),
    [
      [true, true],
      [null, false],
      [false, true],
      [null, false],
    ],
  );

  const price = rowOf(comparison, "inputPricePer1MTokens");
  assert.deepEqual(
    price.cells.map((cell) => [cell.value, cell.known]),
    [
      [1.25, true],
      [3, true],
      [null, false],
      [2, true],
    ],
  );

  const context = rowOf(comparison, "contextWindow");
  assert.equal(context.cells[3].value, null);
  assert.equal(context.cells[3].known, false);
});

test("Compare: lifecycle rows carry state, dates and replacement side by side", async () => {
  const comparison = await compareModels(
    [CLAUDE_3_OPUS.id, GEMINI_25_FLASH_PREVIEW.id, GPT_5.id],
    { port: port(), now },
  );

  assert.deepEqual(
    rowOf(comparison, "lifecycleState").cells.map((cell) => cell.value),
    ["deprecated", "deprecated", null],
  );
  assert.deepEqual(
    rowOf(comparison, "retirementDate").cells.map((cell) => cell.value),
    ["2026-03-01", null, null],
  );
  assert.deepEqual(
    rowOf(comparison, "retirementNotBeforeDate").cells.map((cell) => cell.value),
    [null, "2026-09-30", null],
  );
  assert.deepEqual(
    rowOf(comparison, "recommendedReplacement").cells.map((cell) => cell.value),
    ["claude-sonnet-5", "gemini-2.5-flash", null],
  );
});

test("Compare: freshness is a comparable field too", async () => {
  const comparison = await compareModels([GPT_5.id, GEMINI_3_PRO.id], {
    port: port(),
    now,
  });

  const freshness = rowOf(comparison, "lastVerifiedAt");
  assert.deepEqual(
    freshness.cells.map((cell) => cell.known),
    [true, true],
  );
  assert.equal(freshness.cells[0].value, "2026-08-19T11:15:00.000Z");
  assert.equal(freshness.cells[1].value, "2026-08-19T11:30:00.000Z");
});

test("Compare: every cell carries the provenance of its own evidence domain", async () => {
  const comparison = await compareModels([GPT_5.id, CLAUDE_3_OPUS.id], {
    port: port(),
    now,
  });

  const priceCell = rowOf(comparison, "inputPricePer1MTokens").cells[0];
  assert.equal(priceCell.provenance?.sourceKind, "pricing");
  assert.equal(priceCell.provenance?.snapshotId, "price-gpt5");

  const contextCell = rowOf(comparison, "contextWindow").cells[0];
  assert.equal(contextCell.provenance?.sourceKind, "models");
  assert.equal(contextCell.provenance?.snapshotId, "cap-gpt5");

  const lifecycleCell = rowOf(comparison, "lifecycleState").cells[1];
  assert.equal(lifecycleCell.provenance?.sourceKind, "lifecycle");
  assert.equal(lifecycleCell.provenance?.snapshotId, "life-opus3");

  // GPT-5 has no lifecycle evidence, so its lifecycle cells have no provenance.
  assert.equal(rowOf(comparison, "lifecycleState").cells[0].provenance, null);
});

test("Compare: no row declares a winner", async () => {
  const comparison = await compareModels([GPT_5.id, GEMINI_25_FLASH.id], {
    port: port(),
    now,
  });

  const serialized = JSON.stringify(comparison);
  for (const word of ["winner", "best", "recommended:", "score", "rank"]) {
    assert.ok(!serialized.toLowerCase().includes(word), `must not report a ${word}`);
  }
  assert.ok(
    comparison.rows.every((row) => row.cells.every((cell) => !("rank" in cell))),
    "cells carry values and provenance only",
  );
});

test("Compare: identity is the canonical id — duplicates collapse, unknown ids are reported", async () => {
  const comparison = await compareModels(
    [GPT_5.id, GPT_5.id, "model-missing", CLAUDE_SONNET_5.id],
    { port: port(), now },
  );

  assert.deepEqual(
    comparison.models.map((entry) => entry.canonicalModelId),
    [GPT_5.id, CLAUDE_SONNET_5.id],
  );
  assert.deepEqual(comparison.unresolvedIds, ["model-missing"]);
  for (const row of comparison.rows) {
    assert.equal(row.cells.length, 2);
  }
});

test("Compare: a conflicted identity compares as unknown, not as an arbitrary pick", async () => {
  const comparison = await compareModels([GEMINI_IMAGEN.id, GEMINI_25_FLASH.id], {
    port: port(),
    now,
  });

  const context = rowOf(comparison, "contextWindow");
  assert.deepEqual(
    context.cells.map((cell) => [cell.value, cell.known]),
    [
      [null, false],
      [1_000_000, true],
    ],
  );
  // Its lifecycle is untouched by the capability conflict.
  assert.equal(rowOf(comparison, "lifecycleState").cells[0].value, "active");
});

test("Compare: an empty request is answered with an empty comparison", async () => {
  const comparison = await compareModels([], { port: port(), now });

  assert.deepEqual(comparison.models, []);
  assert.deepEqual(comparison.rows, []);
  assert.deepEqual(comparison.unresolvedIds, []);
});
