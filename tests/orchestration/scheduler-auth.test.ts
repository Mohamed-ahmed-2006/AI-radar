import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryOrchestrationRepository,
  SCHEDULER_TICK,
  authorizeSchedulerRequest,
  handleSchedulerRequest,
} from "../../lib/orchestration";
import { InMemorySentinelRepository } from "../../lib/sentinel";
import { harnessSource, healthyRecordsFor } from "./support/fixtures";
import { collectorPayload } from "./support/pipeline-doubles";

const CRON_SECRET = "cron-secret-value";
const INGEST_SECRET = "ingest-secret-value";

function withSecrets<T>(
  values: { cron?: string; ingest?: string },
  run: () => Promise<T> | T,
): Promise<T> | T {
  const previousCron = process.env.CRON_SECRET;
  const previousIngest = process.env.AI_RADAR_INGEST_SECRET;
  const restore = () => {
    if (previousCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCron;
    if (previousIngest === undefined) delete process.env.AI_RADAR_INGEST_SECRET;
    else process.env.AI_RADAR_INGEST_SECRET = previousIngest;
  };
  if (values.cron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = values.cron;
  if (values.ingest === undefined) delete process.env.AI_RADAR_INGEST_SECRET;
  else process.env.AI_RADAR_INGEST_SECRET = values.ingest;
  try {
    const result = run();
    return result instanceof Promise ? result.finally(restore) : (restore(), result);
  } catch (error) {
    restore();
    throw error;
  }
}

function schedulerRequest(headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request(`http://localhost${SCHEDULER_TICK.path}`, { method, headers });
}

function collectingSource() {
  const harness = harnessSource("openai-pricing", async () =>
    collectorPayload(healthyRecordsFor("openai-pricing"), {
      collectorId: "c_test",
      runId: "bright-auth",
    }),
  );
  return harness;
}

test("an unauthenticated scheduler call is rejected and collects nothing", async () => {
  await withSecrets({ cron: CRON_SECRET, ingest: INGEST_SECRET }, async () => {
    const harness = collectingSource();
    const response = await handleSchedulerRequest(schedulerRequest(), {
      sources: [harness.source],
      repository: new InMemoryOrchestrationRepository(),
      sentinelRepository: new InMemorySentinelRepository(),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { success: false, error: "unauthorized" });
    assert.equal(harness.collectCalls, 0, "an unauthorized call never reaches a collector");
  });
});

test("a wrong secret is rejected in either header", async () => {
  await withSecrets({ cron: CRON_SECRET, ingest: INGEST_SECRET }, async () => {
    const rejected: Record<string, string>[] = [
      { authorization: "Bearer not-the-secret" },
      { "x-ai-radar-ingest-secret": "not-the-secret" },
      { authorization: `Basic ${CRON_SECRET}` },
      { authorization: "Bearer" },
    ];
    for (const headers of rejected) {
      const harness = collectingSource();
      const response = await handleSchedulerRequest(schedulerRequest(headers), {
        sources: [harness.source],
        repository: new InMemoryOrchestrationRepository(),
        sentinelRepository: new InMemorySentinelRepository(),
      });
      assert.equal(response.status, 401, `rejected: ${JSON.stringify(headers)}`);
      assert.equal(harness.collectCalls, 0);
    }
  });
});

test("the endpoint fails closed when no secret is configured", async () => {
  await withSecrets({}, async () => {
    const decision = authorizeSchedulerRequest(
      schedulerRequest({ authorization: "Bearer anything" }),
    );
    assert.equal(decision.authorized, false);
    assert.equal(decision.authorized === false && decision.reason, "not_configured");

    const harness = collectingSource();
    const response = await handleSchedulerRequest(schedulerRequest(), {
      sources: [harness.source],
      repository: new InMemoryOrchestrationRepository(),
      sentinelRepository: new InMemorySentinelRepository(),
    });
    assert.equal(response.status, 401);
    assert.equal(harness.collectCalls, 0);
  });
});

test("Vercel Cron's bearer secret authorizes the tick", async () => {
  await withSecrets({ cron: CRON_SECRET }, async () => {
    const harness = collectingSource();
    const response = await handleSchedulerRequest(
      schedulerRequest({ authorization: `Bearer ${CRON_SECRET}`, "x-vercel-cron": "1" }),
      {
        sources: [harness.source],
        repository: new InMemoryOrchestrationRepository(),
        sentinelRepository: new InMemorySentinelRepository(),
        sleep: async () => {},
        autoHealOverride: false,
      },
    );

    const body = (await response.json()) as {
      success: boolean;
      principal: string;
      status: string;
      summary: { succeeded: number };
    };
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.principal, "vercel-cron");
    assert.equal(body.status, "completed");
    assert.equal(body.summary.succeeded, 1);
    assert.equal(harness.collectCalls, 1);
  });
});

test("the existing ingest secret authorizes an operator-triggered run", async () => {
  await withSecrets({ ingest: INGEST_SECRET }, async () => {
    const harness = collectingSource();
    const response = await handleSchedulerRequest(
      schedulerRequest({ "x-ai-radar-ingest-secret": INGEST_SECRET }, "POST"),
      {
        sources: [harness.source],
        repository: new InMemoryOrchestrationRepository(),
        sentinelRepository: new InMemorySentinelRepository(),
        sleep: async () => {},
        autoHealOverride: false,
      },
    );

    const body = (await response.json()) as { principal: string; trigger: string };
    assert.equal(response.status, 200);
    assert.equal(body.principal, "ingest-secret");
    assert.equal(body.trigger, "manual");
    assert.equal(harness.collectCalls, 1);
  });
});

test("the scheduler response never echoes a secret or a collector id", async () => {
  await withSecrets({ cron: CRON_SECRET, ingest: INGEST_SECRET }, async () => {
    const harness = collectingSource();
    const authorized = await handleSchedulerRequest(
      schedulerRequest({ authorization: `Bearer ${CRON_SECRET}` }),
      {
        sources: [harness.source],
        repository: new InMemoryOrchestrationRepository(),
        sentinelRepository: new InMemorySentinelRepository(),
        sleep: async () => {},
        autoHealOverride: false,
      },
    );
    const unauthorized = await handleSchedulerRequest(schedulerRequest(), {
      sources: [harness.source],
      repository: new InMemoryOrchestrationRepository(),
      sentinelRepository: new InMemorySentinelRepository(),
    });

    for (const response of [authorized, unauthorized]) {
      const text = await response.text();
      assert.ok(!text.includes(CRON_SECRET), "no cron secret in the body");
      assert.ok(!text.includes(INGEST_SECRET), "no ingest secret in the body");
      assert.ok(!text.includes(harness.source.collectorId), "no Bright Data collector id");
      assert.ok(!text.toLowerCase().includes("brightdata_api_key"));
    }
  });
});

test("an unknown source key is a client error, not a silent full-fleet run", async () => {
  await withSecrets({ cron: CRON_SECRET }, async () => {
    const harness = collectingSource();
    const response = await handleSchedulerRequest(
      new Request(`http://localhost${SCHEDULER_TICK.path}?source=mistral-pricing`, {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
      {
        sources: [harness.source],
        repository: new InMemoryOrchestrationRepository(),
        sentinelRepository: new InMemorySentinelRepository(),
      },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "unknown_source",
      sources: ["mistral-pricing"],
    });
    assert.equal(harness.collectCalls, 0);
  });
});
