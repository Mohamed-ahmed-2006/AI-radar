import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemoryModelExplorerReadPort,
  getModelExplorer,
  matchesExplorerFilters,
  type ModelExplorerEntry,
  type ModelExplorerFilters,
} from "../../lib/explorer";
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

async function idsMatching(filters: ModelExplorerFilters): Promise<string[]> {
  const result = await getModelExplorer({ port: port(), now, filters });
  return result.entries.map((entry) => entry.canonicalModelId).sort();
}

async function entryFor(canonicalModelId: string): Promise<ModelExplorerEntry> {
  const result = await getModelExplorer({ port: port(), now });
  const entry = result.entries.find(
    (candidate) => candidate.canonicalModelId === canonicalModelId,
  );
  assert.ok(entry, `expected an entry for ${canonicalModelId}`);
  return entry;
}

test("Filters: provider selects by slug and accepts several", async () => {
  assert.deepEqual(await idsMatching({ providers: ["openai"] }), [GPT_5.id]);
  assert.deepEqual(
    await idsMatching({ providers: ["openai", "xai"] }),
    [GPT_5.id, GROK_4.id].sort(),
  );
  assert.deepEqual(
    await idsMatching({ providers: ["OpenAI"] }),
    [GPT_5.id],
    "slug matching is case-insensitive",
  );
  assert.deepEqual(await idsMatching({ providers: [] }), (await idsMatching({})).sort());
});

test("Filters: a price ceiling never admits a model whose price is unobserved", async () => {
  const affordable = await idsMatching({ maxInputPrice: 2 });

  assert.deepEqual(
    affordable,
    [GPT_5.id, GEMINI_3_PRO.id, GEMINI_25_FLASH.id, GEMINI_25_FLASH_PREVIEW.id].sort(),
  );
  // Grok 4 has no price at all, so it cannot be "under" any ceiling.
  assert.ok(!affordable.includes(GROK_4.id));

  assert.deepEqual(
    await idsMatching({ maxOutputPrice: 10 }),
    [GPT_5.id, GEMINI_25_FLASH.id, GEMINI_25_FLASH_PREVIEW.id].sort(),
  );
  // The ceiling is inclusive.
  assert.ok((await idsMatching({ maxInputPrice: 1.25 })).includes(GPT_5.id));
});

test("Filters: a context floor never admits an unobserved context window", async () => {
  const large = await idsMatching({ minContextWindow: 200_000 });

  assert.deepEqual(
    large,
    [GPT_5.id, CLAUDE_SONNET_5.id, GROK_4.id, GEMINI_25_FLASH.id].sort(),
  );
  assert.ok(!large.includes(GEMINI_3_PRO.id), "no catalog evidence is not a large context");
  assert.ok(!large.includes(GEMINI_IMAGEN.id), "withheld evidence never clears a floor");

  assert.deepEqual(
    await idsMatching({ minMaxOutputTokens: 64_000 }),
    [GPT_5.id, CLAUDE_SONNET_5.id, GEMINI_25_FLASH.id].sort(),
  );
});

test("Filters: visionRequired=true admits only an explicit true", async () => {
  const vision = await idsMatching({ visionRequired: true });

  assert.deepEqual(vision, [GPT_5.id, GEMINI_25_FLASH.id].sort());
  // false does not qualify
  assert.equal((await entryFor(GROK_4.id)).capabilities.supportsVision, false);
  assert.ok(!vision.includes(GROK_4.id));
  // null does not qualify
  assert.equal((await entryFor(CLAUDE_SONNET_5.id)).capabilities.supportsVision, null);
  assert.ok(!vision.includes(CLAUDE_SONNET_5.id));
});

test("Filters: toolCallingRequired=true admits only an explicit true", async () => {
  const tools = await idsMatching({ toolCallingRequired: true });

  assert.deepEqual(tools, [GPT_5.id, CLAUDE_SONNET_5.id, GROK_4.id, GEMINI_25_FLASH.id].sort());
  assert.equal(
    (await entryFor(GEMINI_25_FLASH_PREVIEW.id)).capabilities.supportsToolCalling,
    null,
  );
  assert.ok(!tools.includes(GEMINI_25_FLASH_PREVIEW.id));
});

test("Filters: a required=false flag is not a constraint", async () => {
  const unfiltered = await idsMatching({});

  assert.deepEqual(await idsMatching({ visionRequired: false }), unfiltered);
  assert.deepEqual(await idsMatching({ toolCallingRequired: false }), unfiltered);
});

test("Filters: activeOnly drops what is observed to be past end of life", async () => {
  const active = await idsMatching({ activeOnly: true });

  assert.ok(!active.includes(CLAUDE_3_OPUS.id), "deprecated is excluded");
  assert.ok(!active.includes(GEMINI_25_FLASH_PREVIEW.id), "deprecated preview is excluded");
  // A model nobody publishes lifecycle for is not thereby retired.
  assert.equal((await entryFor(GPT_5.id)).lifecycle.state, null);
  assert.ok(active.includes(GPT_5.id));
  assert.ok(active.includes(GROK_4.id));
  assert.deepEqual(
    active,
    [GPT_5.id, CLAUDE_SONNET_5.id, GROK_4.id, GEMINI_3_PRO.id, GEMINI_25_FLASH.id, GEMINI_IMAGEN.id].sort(),
  );
});

test("Filters: an explicit lifecycle state never matches an unobserved one", async () => {
  assert.deepEqual(
    await idsMatching({ lifecycleStates: ["active"] }),
    [CLAUDE_SONNET_5.id, GEMINI_25_FLASH.id, GEMINI_IMAGEN.id].sort(),
  );
  assert.deepEqual(
    await idsMatching({ lifecycleStates: ["deprecated", "retired"] }),
    [CLAUDE_3_OPUS.id, GEMINI_25_FLASH_PREVIEW.id].sort(),
  );
  // GPT-5's state is unknown, so no state filter selects it.
  for (const state of ["active", "legacy", "deprecated", "retired"] as const) {
    assert.ok(!(await idsMatching({ lifecycleStates: [state] })).includes(GPT_5.id));
  }
});

test("Filters: family and stage select on published catalog values only", async () => {
  assert.deepEqual(
    await idsMatching({ families: ["gemini-2.5-flash"] }),
    [GEMINI_25_FLASH.id, GEMINI_25_FLASH_PREVIEW.id].sort(),
  );
  assert.deepEqual(
    await idsMatching({ families: ["gemini-2.5-flash"], stages: ["preview"] }),
    [GEMINI_25_FLASH_PREVIEW.id],
  );
  assert.deepEqual(
    await idsMatching({ stages: ["stable"] }),
    [GPT_5.id, CLAUDE_SONNET_5.id, GROK_4.id, GEMINI_25_FLASH.id].sort(),
  );
  // A model with no family evidence never matches a family filter.
  assert.ok(!(await idsMatching({ families: ["gemini-3-pro"] })).includes(GEMINI_3_PRO.id));
});

test("Filters: modality filters require every requested modality", async () => {
  assert.deepEqual(
    await idsMatching({ inputModalities: ["image"] }),
    [GPT_5.id, GEMINI_25_FLASH.id].sort(),
  );
  assert.deepEqual(
    await idsMatching({ inputModalities: ["text", "image", "audio"] }),
    [GEMINI_25_FLASH.id],
  );
  assert.deepEqual(
    await idsMatching({ outputModalities: ["image"] }),
    [],
    "the conflicted Imagen evidence is withheld, so it cannot match",
  );
});

test("Filters: search covers canonical name, display name and API id", async () => {
  assert.deepEqual(await idsMatching({ search: "sonnet" }), [CLAUDE_SONNET_5.id]);
  assert.deepEqual(await idsMatching({ search: "GPT-5" }), [GPT_5.id]);
  assert.deepEqual(await idsMatching({ search: "opus-20240229" }), [CLAUDE_3_OPUS.id]);
  assert.deepEqual(await idsMatching({ search: "nothing-like-this" }), []);
});

test("Filters: combined constraints are intersected, not merged", async () => {
  assert.deepEqual(
    await idsMatching({
      providers: ["openai", "gemini", "anthropic"],
      maxInputPrice: 3,
      minContextWindow: 200_000,
      toolCallingRequired: true,
      activeOnly: true,
    }),
    [GPT_5.id, CLAUDE_SONNET_5.id, GEMINI_25_FLASH.id].sort(),
  );

  assert.deepEqual(
    await idsMatching({ visionRequired: true, maxInputPrice: 0.5 }),
    [GEMINI_25_FLASH.id],
  );
});

test("Filters: the predicate is pure and order-independent", async () => {
  const result = await getModelExplorer({ port: port(), now });
  const filters: ModelExplorerFilters = {
    visionRequired: true,
    minContextWindow: 100_000,
    activeOnly: true,
  };

  const direct = result.entries.filter((entry) => matchesExplorerFilters(entry, filters));
  const reversed = [...result.entries]
    .reverse()
    .filter((entry) => matchesExplorerFilters(entry, filters));

  assert.deepEqual(
    direct.map((entry) => entry.canonicalModelId).sort(),
    reversed.map((entry) => entry.canonicalModelId).sort(),
  );
  assert.deepEqual(direct.map((entry) => entry.canonicalModelId).sort(), [
    GEMINI_25_FLASH.id,
    GPT_5.id,
  ].sort());
});
