import Link from "next/link";
import { PRODUCT_TOUR } from "../layout/nav";

export const COMMAND_CENTER_ACTIONS = [
  {
    href: "/models",
    kicker: "StackPulse",
    title: "Explore Models",
    copy: "Browse observed pricing, capabilities, lifecycle and freshness.",
    featured: false,
  },
  {
    href: "/models/compare",
    kicker: "StackPulse",
    title: "Compare",
    copy: "Align canonical models side by side. This view does not rank.",
    featured: false,
  },
  {
    href: "/optimizer",
    kicker: "Stack Optimizer",
    title: "Optimize Stack",
    copy: "Rank eligible models for a workload. Unknown stays unknown.",
    featured: true,
  },
  {
    href: "/ask",
    kicker: "Natural-language intelligence",
    title: "Ask AI Radar",
    copy: "Temporal and decision questions from trusted observations — not model memory.",
    featured: true,
    ask: true,
  },
  {
    href: "/changes",
    kicker: "Temporal",
    title: "View Changes",
    copy: "Price, lifecycle and deprecation movement with provenance.",
    featured: false,
  },
  {
    href: "/source-health",
    kicker: "SourcePulse",
    title: "Source Health",
    copy: "Sentinel fleet status: degraded, quarantined, recovered.",
    featured: false,
  },
  {
    href: "/demo/healing",
    kicker: "SourcePulse",
    title: "Real Healing Demo",
    copy: "Judge-facing Bright Data recovery. Live proof is never faked.",
    featured: false,
  },
] as const;

export function ProductTour() {
  return (
    <details className="radar-product-tour">
      <summary className="radar-product-tour-summary">Judge path</summary>
      <nav className="radar-product-tour-body" aria-label="Product tour">
        <ol className="radar-product-tour-list">
          {PRODUCT_TOUR.map((step, index) => (
            <li key={step.href} className="radar-product-tour-step">
              {index > 0 && (
                <span className="radar-product-tour-arrow" aria-hidden="true">
                  →
                </span>
              )}
              <Link href={step.href} className="radar-product-tour-link">
                {step.label}
              </Link>
            </li>
          ))}
        </ol>
      </nav>
    </details>
  );
}

/**
 * Dashboard entry points for every already-shipped product surface.
 * Featured cards stay Optimizer and Ask; the rest are compact command links.
 */
export function DecisionActions() {
  const featured = COMMAND_CENTER_ACTIONS.filter((action) => action.featured);
  const rest = COMMAND_CENTER_ACTIONS.filter((action) => !action.featured);

  return (
    <section className="radar-command-center" aria-label="Command center">
      <div className="radar-decision-actions">
        {featured.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={`radar-decision-card ${"ask" in action && action.ask ? "radar-decision-card-ask" : ""}`}
          >
            <p className="radar-subheading">{action.kicker}</p>
            <h2 className="radar-decision-card-title">{action.title}</h2>
            <p className="radar-decision-card-copy">{action.copy}</p>
          </Link>
        ))}
      </div>

      <ul className="radar-command-strip" aria-label="Product actions">
        {rest.map((action) => (
          <li key={action.href}>
            <Link href={action.href} className="radar-command-chip" title={action.copy}>
              <span className="radar-command-chip-title">{action.title}</span>
              <span className="radar-command-chip-copy">{action.copy}</span>
            </Link>
          </li>
        ))}
      </ul>

      <ProductTour />
    </section>
  );
}
