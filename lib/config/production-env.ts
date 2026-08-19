/**
 * The one production environment contract.
 *
 * Configuration for this deployment was previously described only by
 * `.env.example` and by whichever module happened to read a variable. That is
 * fine until a value is missing, at which point the failure surfaces as a
 * Bright Data 401 in a cron log rather than as "you did not set this".
 *
 * This module states, in one place, what each variable is for, which subsystem
 * stops working without it, and whether the deployment is allowed to boot
 * without it. Nothing here reads a secret's *value* into a result — only
 * whether it is present — so the report is safe to print in a build log.
 *
 * Severity is what makes it a contract rather than a list:
 *
 *   * `required`      — the product does not function. Fail the deploy.
 *   * `recommended`   — a named capability silently degrades or is closed.
 *   * `optional`      — behaviour is well-defined without it.
 */

export type EnvSeverity = "required" | "recommended" | "optional";

/**
 * Deliberately looser than `NodeJS.ProcessEnv`, which Next.js augments with a
 * required `NODE_ENV`. This module only ever asks whether a name has a value,
 * so a plain bag of names is the honest input type and lets a caller check a
 * hypothetical environment without inventing unrelated fields.
 */
export type EnvSource = Record<string, string | undefined>;

export interface EnvRequirement {
  name: string;
  severity: EnvSeverity;
  /** Subsystem that depends on it. */
  area: string;
  /** What breaks, stated concretely. */
  purpose: string;
  /** Other names accepted in its place. */
  alternatives?: readonly string[];
  /** True when omitting it is a deliberate, documented posture. */
  failsClosed?: boolean;
}

export const PRODUCTION_ENV_CONTRACT: readonly EnvRequirement[] = [
  // -- Supabase -------------------------------------------------------------
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    severity: "required",
    area: "Supabase",
    purpose:
      "Project URL for every read and write. Without it no page renders live data.",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    severity: "required",
    area: "Supabase",
    alternatives: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    purpose:
      "Anon key for the public read path. RLS is what makes it safe in the browser bundle.",
  },
  {
    name: "SUPABASE_SECRET_KEY",
    severity: "required",
    area: "Supabase",
    alternatives: ["SUPABASE_SERVICE_ROLE_KEY"],
    purpose:
      "Service-role key for ingestion writes. Server-only: `requireServiceRoleKey` refuses to run in the browser.",
  },

  // -- Operator credentials -------------------------------------------------
  {
    name: "AI_RADAR_INGEST_SECRET",
    severity: "required",
    area: "Ingest",
    failsClosed: true,
    purpose:
      "Authorizes the manual ingest routes. Absent, every /api/ingest/* route rejects with 401 — closed, not open.",
  },
  {
    name: "CRON_SECRET",
    severity: "required",
    area: "Scheduler",
    failsClosed: true,
    purpose:
      "Vercel Cron sends it as a bearer token to /api/cron/collect. Absent, scheduled collection never runs and the endpoint is unreachable.",
  },
  {
    name: "AI_RADAR_OPERATOR_KEY",
    severity: "recommended",
    area: "Operator controls",
    failsClosed: true,
    purpose:
      "Credential a judge or operator exchanges at /api/operator/session for a signed HttpOnly cookie, unlocking the healing demo controls in a browser. Falls back to CRON_SECRET / AI_RADAR_INGEST_SECRET; set it separately so demo access can be rotated without touching the scheduler.",
  },

  // -- Bright Data ----------------------------------------------------------
  {
    name: "BRIGHTDATA_API_KEY",
    severity: "required",
    area: "Bright Data",
    purpose:
      "Authenticates every collector trigger and every Scraper Studio refactor. No collection and no healing without it.",
  },
  {
    name: "BRIGHTDATA_DEMO_COLLECTOR_ID",
    severity: "recommended",
    area: "Healing demo",
    failsClosed: true,
    purpose:
      "The dedicated demo collector. Absent, the healing demo reports 'unavailable' and refuses to run rather than borrowing a production collector.",
  },
  {
    name: "AI_RADAR_DEMO_SOURCE_BASE_URL",
    severity: "optional",
    area: "Healing demo",
    purpose:
      "Serves both demo layouts from this deployment. Unset, the demo uses the public quotes.toscrape.com sandbox.",
  },

  // -- Explicit demo modes --------------------------------------------------
  {
    name: "SENTINEL_DEMO_MODE",
    severity: "optional",
    area: "Demo modes",
    purpose:
      "MUST be unset in production. Set to 1 only for local recordings: it makes /source-health render the in-memory simulation instead of live Sentinel telemetry, and exposes POST /api/sentinel/demo.",
  },
  {
    name: "AI_RADAR_DEMO_EVIDENCE",
    severity: "optional",
    area: "Demo modes",
    purpose:
      "MUST be unset in production. Set to 1 only for local recordings: it lets `?demo=true` serve the fabricated temporal-evidence corpus on the intelligence and Ask surfaces.",
  },
  {
    name: "AI_RADAR_HEALING_DEMO_OPEN_CONTROLS",
    severity: "optional",
    area: "Demo modes",
    purpose:
      "MUST be unset in production. Opens the mutating healing-demo actions to anonymous callers. The operator session is the supported mechanism; this exists only for throwaway deployments.",
  },
];

/** Names that must never be set on a public production deployment. */
export const PRODUCTION_FORBIDDEN_ENV: readonly string[] = [
  "SENTINEL_DEMO_MODE",
  "AI_RADAR_DEMO_EVIDENCE",
  "AI_RADAR_HEALING_DEMO_OPEN_CONTROLS",
];

function present(name: string, env: EnvSource): boolean {
  return Boolean(env[name]?.trim());
}

function satisfied(requirement: EnvRequirement, env: EnvSource): boolean {
  if (present(requirement.name, env)) return true;
  return (requirement.alternatives ?? []).some((alternative) => present(alternative, env));
}

export interface EnvContractReport {
  ok: boolean;
  missingRequired: EnvRequirement[];
  missingRecommended: EnvRequirement[];
  /** Demo switches that are set — each one weakens the production posture. */
  forbiddenSet: string[];
}

export function checkProductionEnv(
  env: EnvSource = process.env,
): EnvContractReport {
  const missingRequired: EnvRequirement[] = [];
  const missingRecommended: EnvRequirement[] = [];

  for (const requirement of PRODUCTION_ENV_CONTRACT) {
    if (requirement.severity === "optional") continue;
    if (satisfied(requirement, env)) continue;
    if (requirement.severity === "required") missingRequired.push(requirement);
    else missingRecommended.push(requirement);
  }

  const forbiddenSet = PRODUCTION_FORBIDDEN_ENV.filter((name) => present(name, env));

  return {
    ok: missingRequired.length === 0 && forbiddenSet.length === 0,
    missingRequired,
    missingRecommended,
    forbiddenSet,
  };
}

/**
 * Fails closed on a missing critical value.
 *
 * Intended for a deploy gate, not for module import: a page that throws at
 * import time is harder to diagnose than a build step that prints the list.
 */
export function assertProductionEnv(env: EnvSource = process.env): void {
  const report = checkProductionEnv(env);
  if (report.ok) return;
  const lines: string[] = [];
  if (report.missingRequired.length > 0) {
    lines.push("Missing required environment variables:");
    for (const requirement of report.missingRequired) {
      lines.push(`  - ${requirement.name} (${requirement.area}): ${requirement.purpose}`);
    }
  }
  if (report.forbiddenSet.length > 0) {
    lines.push("Demo switches must not be set on a production deployment:");
    for (const name of report.forbiddenSet) lines.push(`  - ${name}`);
  }
  throw new Error(lines.join("\n"));
}
