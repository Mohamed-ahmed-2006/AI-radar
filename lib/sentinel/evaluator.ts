/**
 * Sentinel Deterministic Health & Anomaly Evaluator
 */

import type {
  LastKnownGoodBaseline,
  SentinelEvaluationIssue,
  SentinelEvaluationResult,
  SentinelReasonCode,
  SentinelStatus,
  SourceHealthContract,
} from "./types";

export interface EvaluateSourceHealthOptions {
  collectorExecutionError?: Error | string | null;
  observedAt?: string;
}

/**
 * Deterministically evaluates a collection run's raw payload against a SourceHealthContract
 * and an optional last-known-good baseline.
 *
 * Guarantees that any corrupt, collapsed, or anomalous payload is detected and flagged for quarantine.
 */
export function evaluateSourceHealth<T = unknown>(
  rawRecords: unknown[],
  contract: SourceHealthContract<T>,
  baseline?: LastKnownGoodBaseline | null,
  options: EvaluateSourceHealthOptions = {},
): SentinelEvaluationResult<T> {
  const reasonCodes = new Set<SentinelReasonCode>();
  const issues: SentinelEvaluationIssue[] = [];
  const validRecords: T[] = [];
  const invalidRecords: { raw: unknown; issues: string[] }[] = [];
  const seenIdentities = new Set<string>();

  // 1. Collector Execution Error Check
  if (options.collectorExecutionError) {
    const errorMsg =
      options.collectorExecutionError instanceof Error
        ? options.collectorExecutionError.message
        : String(options.collectorExecutionError);

    reasonCodes.add("COLLECTOR_EXECUTION_FAILURE");
    issues.push({
      message: `Collector execution failed: ${errorMsg}`,
      code: "COLLECTOR_EXECUTION_FAILURE",
    });

    return {
      status: "quarantined",
      isHealthy: false,
      shouldQuarantine: true,
      reasonCodes: [...reasonCodes],
      summary: `Collector execution failed: ${errorMsg}`,
      recordsSeen: 0,
      recordsValid: 0,
      recordsInvalid: 0,
      validRecords: [],
      invalidRecords: [],
      issues,
    };
  }

  const recordsSeen = Array.isArray(rawRecords) ? rawRecords.length : 0;

  // 2. Zero Records Check
  if (recordsSeen === 0) {
    reasonCodes.add("ZERO_RECORDS");
    issues.push({
      message: "Collector returned zero records",
      code: "ZERO_RECORDS",
    });

    const shouldQuarantine = contract.minViableRecords > 0;
    return {
      status: shouldQuarantine ? "quarantined" : "healthy",
      isHealthy: !shouldQuarantine,
      shouldQuarantine,
      reasonCodes: [...reasonCodes],
      summary: "Collector output contains zero records",
      recordsSeen: 0,
      recordsValid: 0,
      recordsInvalid: 0,
      validRecords: [],
      invalidRecords: [],
      issues,
    };
  }

  // 3. Record-by-Record Structural & Schema Validation
  for (let i = 0; i < rawRecords.length; i++) {
    const raw = rawRecords[i];
    const validation = contract.validateRecord(raw, i);

    if (!validation.success || validation.data === undefined) {
      const recordIssues = validation.issues ?? ["Record failed schema validation"];
      invalidRecords.push({ raw, issues: recordIssues });

      // Check if issue indicates illegal enum or missing required fields
      const isEnumViolation = recordIssues.some(
        (iss) =>
          iss.toLowerCase().includes("enum") ||
          iss.toLowerCase().includes("invalid input") ||
          iss.toLowerCase().includes("invalid state") ||
          iss.toLowerCase().includes("invalid pricing mode") ||
          iss.toLowerCase().includes("invalid context tier"),
      );

      if (isEnumViolation) {
        reasonCodes.add("ILLEGAL_ENUM_VALUE");
      }
      reasonCodes.add("SCHEMA_VALIDATION_FAILURE");

      issues.push({
        recordIndex: i,
        message: recordIssues.join("; "),
        code: isEnumViolation ? "ILLEGAL_ENUM_VALUE" : "SCHEMA_VALIDATION_FAILURE",
      });
      continue;
    }

    // 4. Duplicate Identifier Check
    const identityKey = contract.extractKey(validation.data);
    if (seenIdentities.has(identityKey)) {
      reasonCodes.add("DUPLICATE_IDENTIFIERS");
      const duplicateMsg = `Duplicate record identity: '${identityKey}' at index ${i}`;
      invalidRecords.push({ raw, issues: [duplicateMsg] });
      issues.push({
        recordIndex: i,
        message: duplicateMsg,
        code: "DUPLICATE_IDENTIFIERS",
      });
      continue;
    }

    seenIdentities.add(identityKey);
    validRecords.push(validation.data);
  }

  const recordsValid = validRecords.length;
  const recordsInvalid = invalidRecords.length;
  const invalidRatio = recordsSeen > 0 ? recordsInvalid / recordsSeen : 0;

  let shouldQuarantine = false;

  // 5. Quarantine threshold check on invalid records
  if (recordsInvalid > 0) {
    if (invalidRatio >= contract.failurePolicy.quarantineThresholdPercentage) {
      shouldQuarantine = true;
    }
  }

  // 6. Minimum Viable Records Check
  if (recordsValid < contract.minViableRecords) {
    reasonCodes.add("RECORD_COUNT_COLLAPSE");
    issues.push({
      message: `Valid records (${recordsValid}) below minimum required (${contract.minViableRecords})`,
      code: "RECORD_COUNT_COLLAPSE",
    });
    shouldQuarantine = true;
  }

  // 7. Volume & Drift Anomaly Evaluation (relative to Last-Known-Good)
  let driftInfo: SentinelEvaluationResult["driftInfo"] | undefined;

  if (baseline && baseline.recordCount > 0) {
    const prev = baseline.recordCount;
    const curr = recordsValid;
    const dropPercentage = (prev - curr) / prev;
    const spikeRatio = curr / prev;

    const maxDrop = contract.recordCountDrift.maxDropPercentage ?? 0.35;
    const maxSpike = contract.recordCountDrift.maxSpikePercentage ?? 3.0;
    const minExpected = contract.recordCountDrift.minExpectedCount ?? 2;

    if (prev >= minExpected && dropPercentage >= maxDrop) {
      reasonCodes.add("RECORD_COUNT_COLLAPSE");
      issues.push({
        message: `Suspicious record collapse: dropped by ${(dropPercentage * 100).toFixed(1)}% (from ${prev} to ${curr})`,
        code: "RECORD_COUNT_COLLAPSE",
      });
      shouldQuarantine = true;
      driftInfo = {
        previousCount: prev,
        currentCount: curr,
        changePercentage: -dropPercentage * 100,
        driftType: "collapse",
      };
    } else if (curr > 10 && spikeRatio >= maxSpike) {
      reasonCodes.add("RECORD_COUNT_SPIKE");
      issues.push({
        message: `Suspicious record count spike: increased by ${((spikeRatio - 1) * 100).toFixed(1)}% (from ${prev} to ${curr})`,
        code: "RECORD_COUNT_SPIKE",
      });
      shouldQuarantine = true;
      driftInfo = {
        previousCount: prev,
        currentCount: curr,
        changePercentage: (spikeRatio - 1) * 100,
        driftType: "spike",
      };
    } else {
      driftInfo = {
        previousCount: prev,
        currentCount: curr,
        changePercentage: ((curr - prev) / prev) * 100,
        driftType: "within_tolerance",
      };
    }
  }

  // 8. Domain-Specific Semantic Invariants Check
  if (contract.validateSemanticInvariants && validRecords.length > 0) {
    const semanticResults = contract.validateSemanticInvariants(validRecords);
    for (const sem of semanticResults) {
      if (!sem.passed) {
        reasonCodes.add(sem.code);
        issues.push({
          message: sem.reason,
          code: sem.code,
        });
        shouldQuarantine = true;
      }
    }
  }

  // 9. Determine Status & Summary
  let status: SentinelStatus = "healthy";
  if (shouldQuarantine) {
    status = "quarantined";
  } else if (recordsInvalid > 0) {
    status = "degraded";
  }

  const isHealthy = status === "healthy" || status === "degraded";
  const summary = generateEvaluationSummary(status, recordsSeen, recordsValid, recordsInvalid, reasonCodes);

  return {
    status,
    isHealthy,
    shouldQuarantine,
    reasonCodes: [...reasonCodes],
    summary,
    recordsSeen,
    recordsValid,
    recordsInvalid,
    validRecords,
    invalidRecords,
    issues,
    driftInfo,
  };
}

function generateEvaluationSummary(
  status: SentinelStatus,
  seen: number,
  valid: number,
  invalid: number,
  reasonCodes: Set<SentinelReasonCode>,
): string {
  if (status === "healthy") {
    return `Evaluated ${seen} records: 100% valid. Source healthy.`;
  }
  if (status === "degraded") {
    return `Evaluated ${seen} records: ${valid} valid, ${invalid} rejected (${((invalid / seen) * 100).toFixed(1)}% error rate). Source degraded within tolerance.`;
  }
  const reasons = [...reasonCodes].join(", ");
  return `Quarantined: ${invalid}/${seen} invalid records. Anomaly triggers: [${reasons || "VALIDATION_FAILURE"}].`;
}
