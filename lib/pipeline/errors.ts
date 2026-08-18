/**
 * Ingestion error types.
 *
 * These live in their own module so the Sentinel gate can raise a pipeline
 * error without importing the pipeline that imports the gate.
 */

export class PricingIngestionError extends Error {
  readonly collectionRunId?: string;
  readonly externalRunId?: string;

  constructor(message: string, ids: { collectionRunId?: string; externalRunId?: string } = {}) {
    super(message);
    this.name = "PricingIngestionError";
    this.collectionRunId = ids.collectionRunId;
    this.externalRunId = ids.externalRunId;
  }
}
