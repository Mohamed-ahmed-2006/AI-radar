import test from "node:test";
import assert from "node:assert/strict";
import {
  BrightDataClient,
  BrightDataConfigError,
  BrightDataAuthError,
  BrightDataRateLimitError,
  BrightDataTimeoutError,
  BrightDataCollectorError,
} from "../../lib/brightdata/index";

test("BrightDataClient throws BrightDataConfigError when API key is missing", async () => {
  const client = new BrightDataClient({ apiKey: "" });
  await assert.rejects(
    () => client.triggerCollector("c_test_collector"),
    (err: unknown) => {
      assert(err instanceof BrightDataConfigError);
      assert.match(err.message, /Bright Data API key is missing/);
      return true;
    }
  );
});

test("triggerCollector issues POST to /dca/trigger with correct parameters", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedHeaders: HeadersInit | undefined;
  let capturedBody = "";

  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrl = input.toString();
    capturedMethod = init?.method || "";
    capturedHeaders = init?.headers;
    capturedBody = init?.body ? init.body.toString() : "";

    return new Response(JSON.stringify({ collection_id: "j_test_run_123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const client = new BrightDataClient({
    apiKey: "test-token-123",
    fetchFn: mockFetch,
  });

  const res = await client.triggerCollector({
    collectorId: "c_test_collector",
    inputs: [{ url: "https://example.com/pricing" }],
  });

  assert.equal(res.runId, "j_test_run_123");
  assert.equal(capturedUrl, "https://api.brightdata.com/dca/trigger?collector=c_test_collector");
  assert.equal(capturedMethod, "POST");
  assert.equal((capturedHeaders as Record<string, string>)["Authorization"], "Bearer test-token-123");
  assert.deepEqual(JSON.parse(capturedBody), [{ url: "https://example.com/pricing" }]);
});

test("triggerCollector handles 401 Unauthorized", async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response("Unauthorized", { status: 401 });
  };

  const client = new BrightDataClient({
    apiKey: "bad-token",
    fetchFn: mockFetch,
  });

  await assert.rejects(
    () => client.triggerCollector("c_test_collector"),
    (err: unknown) => {
      assert(err instanceof BrightDataAuthError);
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test("triggerCollector handles 429 Rate Limit", async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": "5" },
    });
  };

  const client = new BrightDataClient({
    apiKey: "test-token",
    fetchFn: mockFetch,
  });

  await assert.rejects(
    () => client.triggerCollector("c_test_collector"),
    (err: unknown) => {
      assert(err instanceof BrightDataRateLimitError);
      assert.equal(err.retryAfterMs, 5000);
      return true;
    }
  );
});

test("pollDataset successfully waits for building status and returns records", async () => {
  let callCount = 0;
  const mockFetch: typeof fetch = async () => {
    callCount += 1;
    if (callCount < 3) {
      return new Response(
        JSON.stringify({ status: "building", message: "Snapshot is building" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify([{ item: 1 }, { item: 2 }]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const client = new BrightDataClient({
    apiKey: "test-token",
    fetchFn: mockFetch,
  });

  const progressEvents: unknown[] = [];
  const records = await client.pollDataset("j_test_run", {
    pollIntervalMs: 10,
    pollTimeoutMs: 1000,
    onProgress: (p) => progressEvents.push(p),
  });

  assert.equal(callCount, 3);
  assert.equal(records.length, 2);
  assert.equal(progressEvents.length, 2);
});

test("pollDataset throws BrightDataTimeoutError when exceeding timeout", async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({ status: "building" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const client = new BrightDataClient({
    apiKey: "test-token",
    fetchFn: mockFetch,
  });

  await assert.rejects(
    () =>
      client.pollDataset("j_timeout_run", {
        pollIntervalMs: 20,
        pollTimeoutMs: 50,
      }),
    (err: unknown) => {
      assert(err instanceof BrightDataTimeoutError);
      assert.equal(err.runId, "j_timeout_run");
      return true;
    }
  );
});

test("pollDataset throws BrightDataCollectorError when collector returns failed status", async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({ status: "failed", message: "Scraper crashed on target" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const client = new BrightDataClient({
    apiKey: "test-token",
    fetchFn: mockFetch,
  });

  await assert.rejects(
    () => client.pollDataset("j_failed_run", { pollIntervalMs: 10, pollTimeoutMs: 500 }),
    (err: unknown) => {
      assert(err instanceof BrightDataCollectorError);
      assert.match(err.message, /Scraper crashed on target/);
      return true;
    }
  );
});

test("runCollector executes end-to-end and returns complete metadata", async () => {
  const mockFetch: typeof fetch = async (input) => {
    const url = input.toString();
    if (url.includes("/dca/trigger")) {
      return new Response(JSON.stringify({ collection_id: "j_e2e_run" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/dca/dataset")) {
      return new Response(
        JSON.stringify([
          { name: "item-1", score: 10 },
          { name: "item-2", score: 20 },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("Not found", { status: 404 });
  };

  const client = new BrightDataClient({
    apiKey: "test-token",
    fetchFn: mockFetch,
  });

  const result = await client.runCollector({
    collectorId: "c_e2e_collector",
    parser: (raw) => ({ ...(raw as object), parsed: true }),
    pollIntervalMs: 10,
    pollTimeoutMs: 1000,
  });

  assert.equal(result.success, true);
  assert.equal(result.data.length, 2);
  assert.equal((result.data[0] as { parsed: boolean }).parsed, true);
  assert.equal(result.metadata.collectorId, "c_e2e_collector");
  assert.equal(result.metadata.runId, "j_e2e_run");
  assert.equal(result.metadata.status, "success");
  assert.equal(result.metadata.resultCount, 2);
  assert(result.metadata.durationMs >= 0);
  assert(result.metadata.startedAt.length > 0);
  assert(result.metadata.completedAt.length > 0);
});

test("runCollector captures failure in metadata without throwing unhandled rejection", async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({ error: "Invalid collector ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  };

  const client = new BrightDataClient({
    apiKey: "test-token",
    fetchFn: mockFetch,
  });

  const result = await client.runCollector({
    collectorId: "c_invalid_collector",
  });

  assert.equal(result.success, false);
  assert.equal(result.data.length, 0);
  assert.equal(result.metadata.status, "failed");
  assert.match(result.metadata.error || "", /Invalid collector ID/);
  assert(result.error instanceof BrightDataCollectorError);
});
