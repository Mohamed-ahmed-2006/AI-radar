/**
 * Server-side entry point for the Source Health screen.
 *
 * Live data comes from the same read model that backs `GET /api/sentinel/health`
 * — called directly here because a server component self-fetching its own route
 * would only add a network hop. Demo mode runs the backend's deterministic
 * in-memory hero simulation, which touches neither Supabase nor Bright Data.
 */

import type { SentinelView } from "../../components/radar/sentinel/types";
import {
  buildSentinelViewFromDemo,
  buildSentinelViewFromReadModel,
} from "../../components/radar/sentinel/view-model";
import { runSentinelDemoSimulation } from "./demo-simulator";
import { getSentinelDashboardReadModel } from "./read-model";

/**
 * Demo mode is opt-in and explicit. Missing Supabase configuration must not
 * silently substitute a fabricated recovery incident for live telemetry.
 */
export function isSentinelDemoMode(): boolean {
  return process.env.SENTINEL_DEMO_MODE === "1";
}

export async function getSentinelView(): Promise<SentinelView> {
  if (typeof window !== "undefined") {
    throw new Error("getSentinelView must only run on the server");
  }
  if (isSentinelDemoMode()) {
    return buildSentinelViewFromDemo(await runSentinelDemoSimulation());
  }
  return buildSentinelViewFromReadModel(await getSentinelDashboardReadModel());
}
