import { notFound } from "next/navigation";

import { DEMO_FIXTURE_QUOTES } from "@/lib/demo-healing/fixture-page";

export const dynamic = "force-static";

/**
 * The self-hosted demo source page.
 *
 * Two renderings of one identical record set. `healthy` is the structure the
 * demo collector's extraction template was generated against; `broken` is the
 * same data as a table, which invalidates those selectors.
 *
 * This page exists so the demonstration does not depend on a third party's
 * markup staying still. It is only used when `AI_RADAR_DEMO_SOURCE_BASE_URL`
 * points at a publicly reachable deployment of this app; otherwise the harness
 * targets a public scraping sandbox instead.
 *
 * It renders fixed public-domain quotations and reads nothing — no query
 * parameter reaches the markup, so there is nothing here to inject into.
 */
export function generateStaticParams() {
  return [{ layout: "healthy" }, { layout: "broken" }];
}

export default async function DemoSourcePage({
  params,
}: {
  params: Promise<{ layout: string }>;
}) {
  const { layout } = await params;
  if (layout !== "healthy" && layout !== "broken") notFound();

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 900 }}>
      <h1>Quotes</h1>
      {layout === "healthy" ? (
        <div className="quotes">
          {DEMO_FIXTURE_QUOTES.map((quote) => (
            <div className="quote" key={quote.quoteText}>
              <span className="text">{quote.quoteText}</span>
              <span>
                {" by "}
                <small className="author">{quote.author}</small>
              </span>
              <div className="tags">
                {quote.tags.map((tag) => (
                  <a className="tag" key={tag} href={`/demo-source/healthy#${tag}`}>
                    {tag}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table>
          <tbody>
            {DEMO_FIXTURE_QUOTES.map((quote) => (
              <tr key={quote.quoteText}>
                <td>
                  {quote.quoteText}
                  <br />
                  {`by ${quote.author}`}
                  <br />
                  {`Tags: ${quote.tags.join(" ")}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
