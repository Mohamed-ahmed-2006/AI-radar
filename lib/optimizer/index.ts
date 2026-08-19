/**
 * Stack Optimizer boundary: deterministic model selection for a stated
 * monthly workload.
 *
 * Everything exported here is a read. The optimizer never writes evidence and
 * never invents it: costs are arithmetic over canonical pricing, requirements
 * are checked against canonical capability and lifecycle evidence, and a model
 * missing the evidence a requirement depends on is excluded rather than
 * assumed. No language model participates in any calculation or ordering.
 */

export * from "./types";
export * from "./cost";
export * from "./requirements";
export * from "./rank";
export * from "./optimize";
export * from "./handler";
