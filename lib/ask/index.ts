/**
 * Ask AI Radar boundary: natural language in, a grounded answer out.
 *
 * The planner compiles a question into a closed typed intent. The executor
 * runs that intent against trusted evidence through the temporal engine, the
 * model explorer or the stack optimizer. No language model calculates a
 * price, ranks a model, or supplies a fact.
 */

export * from "./intent";
export * from "./types";
export * from "./groundedness";
export * from "./answer";
export * from "./execute";
export * from "./handler";
