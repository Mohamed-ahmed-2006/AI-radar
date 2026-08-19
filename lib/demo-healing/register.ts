/**
 * Installs the real healing backend behind the SourcePulse demo UI.
 *
 * Importing this module registers the port. It constructs nothing: the
 * orchestrator, the Supabase client and the Bright Data client are all built
 * per request, so importing this on a page that never opens the demo costs
 * nothing and cannot fail at boot.
 *
 * If the demo is unconfigured — no dedicated collector, no Supabase credential
 * — the port throws when used and the adapter reports "unavailable". It never
 * falls back to a fixture or to the in-memory Sentinel simulation.
 *
 * Server-only.
 */

import { registerHealingDemoBackend } from "../healing-demo/backend";
import { createHealingDemoPort } from "./ui-port";

registerHealingDemoBackend(createHealingDemoPort());
