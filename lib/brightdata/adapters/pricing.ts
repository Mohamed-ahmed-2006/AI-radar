type TransportRecord = Record<string, unknown>;

function isTransportRecord(value: unknown): value is TransportRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withSourceDefaults(raw: unknown, sourceUrl: string): unknown {
  if (!isTransportRecord(raw)) return raw;
  return {
    ...raw,
    source_url: raw.source_url ?? sourceUrl,
    pricing_unit: raw.pricing_unit ?? "USD per 1M tokens",
  };
}

/** Repairs Anthropic's documented unit spelling and trailing source annotations. */
export function adaptAnthropicPricingRecord(raw: unknown, sourceUrl: string): unknown {
  const record = withSourceDefaults(raw, sourceUrl);
  if (!isTransportRecord(record)) return record;
  const modelName = typeof record.model_name === "string"
    ? record.model_name.replace(/\s+\([^)]*\)\s*$/, "").trim()
    : record.model_name;
  return {
    ...record,
    model_name: modelName,
    pricing_unit: record.pricing_unit === "per_1m_tokens"
      ? "USD per 1M tokens"
      : record.pricing_unit,
  };
}

/** Gemini rows are already canonical apart from collector provenance defaults. */
export function adaptGeminiPricingRecord(raw: unknown, sourceUrl: string): unknown {
  return withSourceDefaults(raw, sourceUrl);
}

/** xAI rows are already canonical apart from collector provenance defaults. */
export function adaptXaiPricingRecord(raw: unknown, sourceUrl: string): unknown {
  return withSourceDefaults(raw, sourceUrl);
}

/** OpenAI uses the canonical record shape directly. */
export function adaptOpenAiPricingRecord(raw: unknown, sourceUrl: string): unknown {
  return withSourceDefaults(raw, sourceUrl);
}
