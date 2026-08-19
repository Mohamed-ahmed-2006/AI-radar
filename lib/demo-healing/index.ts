/**
 * Sentinel self-healing demonstration harness.
 *
 * A dedicated demo source, isolated from every production collector, that
 * exercises the real failure → quarantine → Bright Data heal → preview →
 * validate → approve → re-run → recovery path end to end.
 */

export * from "./source";
export * from "./contract";
export * from "./healer";
export * from "./persistence";
export * from "./repository";
export * from "./orchestrator";
export * from "./read-model";
export * from "./handler";
