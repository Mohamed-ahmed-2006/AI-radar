/**
 * Bright Data Ingestion Errors
 */

export class BrightDataError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code = "BRIGHTDATA_ERROR", details?: unknown) {
    super(message);
    this.name = "BrightDataError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BrightDataConfigError extends BrightDataError {
  constructor(message: string, details?: unknown) {
    super(message, "BRIGHTDATA_CONFIG_ERROR", details);
    this.name = "BrightDataConfigError";
  }
}

export class BrightDataAuthError extends BrightDataError {
  public readonly statusCode: number;

  constructor(message = "Bright Data authentication failed: invalid or missing API token", statusCode = 401, details?: unknown) {
    super(message, "BRIGHTDATA_AUTH_ERROR", details);
    this.name = "BrightDataAuthError";
    this.statusCode = statusCode;
  }
}

export class BrightDataRateLimitError extends BrightDataError {
  public readonly retryAfterMs?: number;

  constructor(message = "Bright Data rate limit exceeded", retryAfterMs?: number, details?: unknown) {
    super(message, "BRIGHTDATA_RATE_LIMIT_ERROR", details);
    this.name = "BrightDataRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class BrightDataTimeoutError extends BrightDataError {
  public readonly timeoutMs: number;
  public readonly runId?: string;

  constructor(message: string, timeoutMs: number, runId?: string, details?: unknown) {
    super(message, "BRIGHTDATA_TIMEOUT_ERROR", details);
    this.name = "BrightDataTimeoutError";
    this.timeoutMs = timeoutMs;
    this.runId = runId;
  }
}

export class BrightDataCollectorError extends BrightDataError {
  public readonly statusCode?: number;
  public readonly collectorId?: string;
  public readonly runId?: string;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      collectorId?: string;
      runId?: string;
      details?: unknown;
    }
  ) {
    super(message, "BRIGHTDATA_COLLECTOR_ERROR", options?.details);
    this.name = "BrightDataCollectorError";
    this.statusCode = options?.statusCode;
    this.collectorId = options?.collectorId;
    this.runId = options?.runId;
  }
}

export class BrightDataParseError extends BrightDataError {
  public readonly rawPayload?: unknown;

  constructor(message: string, rawPayload?: unknown, details?: unknown) {
    super(message, "BRIGHTDATA_PARSE_ERROR", details);
    this.name = "BrightDataParseError";
    this.rawPayload = rawPayload;
  }
}
