/**
 * Deploy gate for the production environment contract.
 *
 *   npx tsx scripts/check-production-env.ts
 *
 * Exits non-zero when a required value is missing or a demo switch is set.
 * Prints names and reasons, never values.
 */

import {
  PRODUCTION_ENV_CONTRACT,
  checkProductionEnv,
} from "../lib/config/production-env";

const report = checkProductionEnv();

console.log("AI Radar — production environment contract\n");

for (const requirement of PRODUCTION_ENV_CONTRACT) {
  const names = [requirement.name, ...(requirement.alternatives ?? [])];
  const set = names.some((name) => Boolean(process.env[name]?.trim()));
  const mark = set ? "set " : requirement.severity === "optional" ? "unset" : "MISS ";
  console.log(`  [${mark}] ${requirement.severity.padEnd(11)} ${requirement.name}`);
}

if (report.missingRequired.length > 0) {
  console.error("\nMissing required:");
  for (const requirement of report.missingRequired) {
    console.error(`  - ${requirement.name} (${requirement.area}): ${requirement.purpose}`);
  }
}

if (report.missingRecommended.length > 0) {
  console.warn("\nMissing recommended (a capability is closed or degraded):");
  for (const requirement of report.missingRecommended) {
    console.warn(`  - ${requirement.name} (${requirement.area}): ${requirement.purpose}`);
  }
}

if (report.forbiddenSet.length > 0) {
  console.error("\nDemo switches set — remove before a public deployment:");
  for (const name of report.forbiddenSet) console.error(`  - ${name}`);
}

if (!report.ok) {
  console.error("\nFAIL: production environment contract not satisfied.");
  process.exit(1);
}

console.log("\nOK: production environment contract satisfied.");
