/**
 * Output sanitizers for the public source-detail and provenance surfaces.
 *
 * Two things are being defended against here:
 *
 *   1. Operator text reaching the public payload verbatim. `error_message` and
 *      incident summaries are written by ingestion code and can echo collector
 *      output, upstream markup or a URL carrying a token. They are redacted and
 *      truncated before they are published.
 *   2. Unbounded values. Every public string is length-capped so one malformed
 *      upstream page cannot turn a detail response into a payload dump.
 *
 * Nothing here is a substitute for not reading a secret in the first place —
 * the read path uses the anon Supabase client, so quarantine payloads and
 * per-record validation traces are unreachable by construction. This is the
 * second line.
 */

const REDACTED = "[redacted]";

/** Patterns that look like credentials regardless of surrounding text. */
const SECRET_PATTERNS: readonly RegExp[] = [
  // key=value forms: api_key=..., token: ..., authorization: Bearer ...
  /\b(api[_-]?key|apikey|secret|token|password|passwd|authorization|auth|bearer|access[_-]?key|service[_-]?role|anon[_-]?key)\b\s*[:=]\s*\S+/gi,
  // Bare bearer credentials.
  /\bBearer\s+[A-Za-z0-9._\-]{8,}/gi,
  // Supabase / JWT style triples.
  /\beyJ[A-Za-z0-9._-]{10,}/g,
  // Long opaque tokens (Bright Data api keys, hex digests).
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
];

/** Collapses whitespace, strips secrets, and caps length. */
export function sanitizeText(
  value: string | null | undefined,
  maxLength = 240,
): string | null {
  if (value === null || value === undefined) return null;
  let text = String(value);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, REDACTED);
  }
  // Strip anything markup-shaped: collector errors sometimes carry a DOM slice.
  text = text.replace(/<[^>]*>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Returns a URL safe to publish: http(s) only, no embedded credentials, no
 * query string or fragment (either can carry a token or a session id).
 */
export function safeSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/**
 * Sanitized rendering of one raw collector value for the transformation view.
 * Objects and arrays are stringified rather than published structurally: the
 * point is to show the shape of the evidence, not to republish the payload.
 */
export function sanitizeRawValue(
  value: unknown,
  maxLength = 120,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return sanitizeText(value, maxLength);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return sanitizeText(JSON.stringify(value), maxLength);
  } catch {
    return null;
  }
}
