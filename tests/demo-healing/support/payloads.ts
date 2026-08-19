/**
 * Collector payloads used across the demo-healing tests.
 *
 * These are not arbitrary "good data / bad data" blobs. Each one is the shape a
 * real extraction template genuinely produces in the situation it is named
 * after, which is what makes the assertions about them mean something:
 *
 *   * `healthyPayload`   — the template matching the layout it was built for
 *   * `tableLayoutPayload` — the same template run against the table rendering:
 *     the item selector still matches rows, the field selectors match nothing,
 *     so every record comes back with empty strings
 *   * `containerLatchPayload` — the item selector collapsed onto one page-level
 *     node, so every record is an identical copy of the page heading
 *   * `markupLeakPayload` — the field selector matched a container, so raw HTML
 *     comes through instead of text
 */

import { DEMO_FIXTURE_QUOTES } from "../../../lib/demo-healing/fixture-page";

export interface ExtractedQuote {
  quote_text: string;
  author: string;
  tags: string[];
  // The contract's record type is a passthrough schema, so extracted records
  // carry whatever else the template emitted alongside the fields we require.
  [key: string]: unknown;
}

/** What the template emits when it is matching the layout it was built for. */
export function healthyPayload(): ExtractedQuote[] {
  return DEMO_FIXTURE_QUOTES.map((quote) => ({
    quote_text: quote.quoteText,
    author: quote.author,
    tags: [...quote.tags],
  }));
}

/**
 * A subset, for asserting drift behaviour against a full-size baseline.
 */
export function partialHealthyPayload(count: number): ExtractedQuote[] {
  return healthyPayload().slice(0, count);
}

/**
 * The same records under field names an AI-generated template legitimately
 * picks instead. The adapter should normalise these; the contract should not
 * care that they were renamed.
 */
export function renamedFieldPayload(): unknown[] {
  return DEMO_FIXTURE_QUOTES.map((quote) => ({
    text: quote.quoteText,
    author_name: quote.author,
    keywords: quote.tags.join(", "),
  }));
}

/**
 * The div-layout template pointed at the table rendering. The row selector
 * still finds rows; `.text` and `.author` find nothing inside them.
 */
export function tableLayoutPayload(): unknown[] {
  return DEMO_FIXTURE_QUOTES.map(() => ({
    quote_text: "",
    author: "",
    tags: [],
  }));
}

/** The template found nothing at all — the common total-miss case. */
export function emptyPayload(): unknown[] {
  return [];
}

/** Every record is the same page-level node, repeated. */
export function containerLatchPayload(count = 6): unknown[] {
  return Array.from({ length: count }, () => ({
    quote_text: "Quotes to Scrape — a public sandbox page for scraper testing",
    author: "Quotes to Scrape",
    tags: [],
  }));
}

/** The field selector matched a container, so markup leaked into the value. */
export function markupLeakPayload(): unknown[] {
  return DEMO_FIXTURE_QUOTES.map((quote) => ({
    quote_text: `<span class="text">${quote.quoteText}</span>`,
    author: quote.author,
    tags: [...quote.tags],
  }));
}

/**
 * A Bright Data preview: a couple of records, not a full run. Volume alone must
 * not condemn it, and its content must still be judged.
 */
export function goodPreview(): unknown[] {
  return healthyPayload().slice(0, 2);
}

/** A preview from a candidate that did not actually fix the extraction. */
export function badPreview(): unknown[] {
  return [
    { quote_text: "", author: "", tags: [] },
    { quote_text: "", author: "", tags: [] },
  ];
}
