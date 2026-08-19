import { Badge } from "../../radar/ui/Badge";
import { Panel } from "../../radar/ui/Panel";
import type { SourceIdentity } from "../../../lib/product/source-detail";

interface Fact {
  id: string;
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
}

function identityFacts(identity: SourceIdentity): Fact[] {
  const facts: Fact[] = [
    { id: "provider", label: "Provider", value: identity.providerName },
    { id: "category", label: "Category", value: identity.category },
  ];
  if (identity.collectorId) {
    facts.push({
      id: "collector",
      label: "Bright Data Collector ID",
      value: identity.collectorId,
      mono: true,
    });
  }
  if (identity.sourceUrl) {
    facts.push({
      id: "url",
      label: "Source URL",
      value: identity.sourceUrl,
      href: identity.sourceUrl,
    });
  }
  facts.push({ id: "source-id", label: "Source ID", value: identity.sourceId, mono: true });
  return facts;
}

/** Who this source is and what collects it. */
export function SourceIdentityPanel({ identity }: { identity: SourceIdentity }) {
  const facts = identityFacts(identity);

  return (
    <Panel
      id="source-identity"
      title="Source identity"
      subtitle="What this source is and how it is collected"
      action={
        identity.isActive === null ? undefined : (
          <Badge variant={identity.isActive ? "success" : "muted"}>
            {identity.isActive ? "Active" : "Inactive"}
          </Badge>
        )
      }
    >
      <dl className="radar-fact-grid">
        {facts.map((fact) => (
          <div key={fact.id} className="radar-fact">
            <dt className="radar-fact-label">{fact.label}</dt>
            <dd className={`radar-fact-value ${fact.mono ? "font-mono" : ""}`}>
              {fact.href ? (
                <a
                  href={fact.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-radar-info hover:underline break-all"
                >
                  {fact.value}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                fact.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
