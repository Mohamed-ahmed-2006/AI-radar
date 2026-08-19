/**
 * The single decision point for whether fabricated temporal evidence may be
 * served.
 *
 * The demo corpus in `demo-evidence.ts` is realistic on purpose: real model
 * names, real source URLs, plausible prices. That is what makes it useful for a
 * recorded walkthrough and exactly what makes it dangerous in production. A
 * caller adding `?demo=true` to a public URL must not be able to make the
 * deployment answer questions about the AI ecosystem with invented numbers.
 *
 * So requesting the demo corpus is necessary but not sufficient: the
 * deployment must also have opted in server-side with
 * `AI_RADAR_DEMO_EVIDENCE=1`. A production deployment leaves that unset, and
 * every intelligence surface then reads live evidence or reports emptiness.
 * Explicit demo builds keep the mode; there is no path by which production
 * silently substitutes it.
 */

export const DEMO_EVIDENCE_ENV = "AI_RADAR_DEMO_EVIDENCE";

/** Whether this deployment permits the demo corpus at all. */
export function isDemoEvidenceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DEMO_EVIDENCE_ENV] === "1";
}

/**
 * Resolves a requested demo flag against the deployment's opt-in.
 *
 * `requested` is whatever the caller asked for; the result is what may actually
 * be served. Absent the server-side opt-in the answer is always false.
 */
export function resolveDemoEvidence(
  requested: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return requested === true && isDemoEvidenceEnabled(env);
}
