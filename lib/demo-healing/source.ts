/**
 * The dedicated Sentinel self-healing demo source.
 *
 * This is deliberately its own provider, its own `sources` row and its own
 * Bright Data collector. No production pricing, lifecycle or catalog collector
 * is ever targeted by the demo harness — the allowlist below has exactly one
 * member and nothing in the request path can widen it.
 *
 * The demo scrapes `quotes.toscrape.com`, a public sandbox published for
 * scraper testing. It carries no private or personal data, and it exposes the
 * same records under two genuinely different DOM layouts:
 *
 *   * `/`          — the layout the collector template was generated against
 *   * `/tableful/` — identical records rendered as a `<table>`
 *
 * Pointing the collector at the second layout invalidates the extraction
 * template's selectors, so the failure is produced by real scraper behaviour
 * rather than by a flag we flip in the database.
 */

export const DEMO_SOURCE_KEY = "sentinel-demo-quotes" as const;
export type DemoSourceKey = typeof DEMO_SOURCE_KEY;

export const DEMO_PROVIDER_SLUG = "sentinel-demo" as const;
export const DEMO_PROVIDER_NAME = "Sentinel Demo" as const;
export const DEMO_PROVIDER_HOMEPAGE = "https://quotes.toscrape.com" as const;
export const DEMO_SOURCE_LABEL = "Sentinel self-healing demo source" as const;

/** Which DOM layout the demo source is currently pointed at. */
export type DemoLayout = "healthy" | "broken";

export interface DemoLayoutDefinition {
  layout: DemoLayout;
  url: string;
  /** Shown to judges; explains what the layout does to the collector. */
  description: string;
}

const DEFAULT_HEALTHY_URL = "https://quotes.toscrape.com/";
const DEFAULT_BROKEN_URL = "https://quotes.toscrape.com/tableful/";

/**
 * Only these two URLs can ever be handed to the demo collector. A caller
 * supplies a layout name, never a URL, so no request can steer the collector
 * at an arbitrary target.
 */
export function resolveDemoLayouts(
  env: NodeJS.ProcessEnv = process.env,
): Record<DemoLayout, DemoLayoutDefinition> {
  const base = env.AI_RADAR_DEMO_SOURCE_BASE_URL?.trim();
  if (base) {
    const root = base.replace(/\/+$/, "");
    return {
      healthy: {
        layout: "healthy",
        url: `${root}/demo-source/healthy`,
        description: "Self-hosted demo page in the layout the collector was built against.",
      },
      broken: {
        layout: "broken",
        url: `${root}/demo-source/broken`,
        description: "Self-hosted demo page re-rendered as a table, invalidating the collector selectors.",
      },
    };
  }
  return {
    healthy: {
      layout: "healthy",
      url: (env.AI_RADAR_DEMO_HEALTHY_URL ?? DEFAULT_HEALTHY_URL).trim(),
      description: "Public sandbox page in the layout the collector template was generated against.",
    },
    broken: {
      layout: "broken",
      url: (env.AI_RADAR_DEMO_BROKEN_URL ?? DEFAULT_BROKEN_URL).trim(),
      description: "Same records rendered as a table, which invalidates the collector's selectors.",
    },
  };
}

export interface DemoSourceConfiguration {
  sourceKey: DemoSourceKey;
  providerSlug: typeof DEMO_PROVIDER_SLUG;
  providerName: typeof DEMO_PROVIDER_NAME;
  providerHomepageUrl: string;
  label: string;
  /** Server-only. Never rendered into a public payload. */
  collectorId: string;
  layouts: Record<DemoLayout, DemoLayoutDefinition>;
  /** Canonical source_url the `sources` row is keyed by. */
  canonicalSourceUrl: string;
}

/** Raised when the demo harness is asked to run without a configured collector. */
export class DemoSourceNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoSourceNotConfiguredError";
  }
}

export function resolveDemoSourceConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): DemoSourceConfiguration {
  const collectorId = env.BRIGHTDATA_DEMO_COLLECTOR_ID?.trim();
  if (!collectorId) {
    throw new DemoSourceNotConfiguredError(
      "BRIGHTDATA_DEMO_COLLECTOR_ID is not set. The self-healing demo refuses to run "
        + "rather than fall back to a production collector.",
    );
  }
  const layouts = resolveDemoLayouts(env);
  return {
    sourceKey: DEMO_SOURCE_KEY,
    providerSlug: DEMO_PROVIDER_SLUG,
    providerName: DEMO_PROVIDER_NAME,
    providerHomepageUrl: DEMO_PROVIDER_HOMEPAGE,
    label: DEMO_SOURCE_LABEL,
    collectorId,
    layouts,
    canonicalSourceUrl: layouts.healthy.url,
  };
}

export function isDemoSourceKey(value: unknown): value is DemoSourceKey {
  return value === DEMO_SOURCE_KEY;
}

/**
 * The allowlist gate. Every mutating demo action funnels through this, so a
 * client-supplied source or collector id can never reach Bright Data.
 */
export function assertDemoSourceKey(value: unknown): DemoSourceKey {
  if (!isDemoSourceKey(value)) {
    throw new DemoSourceNotConfiguredError(
      `Refusing to operate on '${String(value)}': the healing demo is restricted to ${DEMO_SOURCE_KEY}.`,
    );
  }
  return value;
}

export function isDemoLayout(value: unknown): value is DemoLayout {
  return value === "healthy" || value === "broken";
}

/**
 * The defect-inducing prompt used by the contingency break.
 *
 * This asks Bright Data to install a template that genuinely fails to extract
 * the records — it is a real Scraper Studio refactor producing a real
 * extraction defect, not a marker we set. It exists so the demonstration still
 * works if the public sandbox page is unreachable and no self-hosted layout is
 * configured. The layout switch is the preferred mechanism: it is instant,
 * deterministic and reversible without spending an AI-Flow job.
 */
export const DEMO_TEMPLATE_BREAK_PROMPT =
  "Change the extraction so it no longer targets the individual quote blocks. "
  + "Instead of one record per quote, return a single record whose quote_text is "
  + "taken from the page header element and whose author is taken from the same "
  + "header element, with an empty tags array. Do not read the quote containers "
  + "at all.";

/**
 * Restores the demo collector's extraction after a contingency break.
 *
 * Used by `reset` when the failure was produced by breaking the template
 * rather than by switching layouts, so the demonstration is genuinely
 * repeatable instead of leaving a defective collector behind.
 */
export const DEMO_TEMPLATE_RESTORE_PROMPT =
  "Restore extraction of the individual quote blocks on the listing page. "
  + "Return one record per quote with exactly these fields: quote_text (the "
  + "quotation text only), author (the name shown after by), and tags (an array "
  + "of that quote's tag keywords). Do not follow author links or emit page "
  + "headers as records.";
