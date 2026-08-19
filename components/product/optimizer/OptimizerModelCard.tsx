import Link from "next/link";

import { compareHref, modelDetailHref } from "../../../lib/product/explorer";
import type { OptimizerModelResult } from "../../../lib/product/optimizer";
import { ProvenanceDisclosure } from "../provenance/ProvenanceDisclosure";
import { CapabilityStatus } from "../explorer/CapabilityStatus";
import { FreshnessStatus } from "../explorer/FreshnessStatus";
import { formatObservedPrice, formatObservedTokens } from "../explorer/format";
import { Badge } from "../../radar/ui/Badge";
import { EligibilityStatus } from "./EligibilityStatus";
import { RequirementChecks } from "./RequirementChecks";

function lifecycleVariant(
  state: string | null,
): "success" | "warning" | "muted" | "info" {
  if (state === "active") return "success";
  if (state === "deprecated" || state === "legacy") return "warning";
  if (state === "retired") return "muted";
  return "info";
}

export function OptimizerModelCard({
  result,
  featured = false,
}: {
  result: OptimizerModelResult;
  featured?: boolean;
}) {
  const { identity } = result;
  const headingId = `optimizer-model-${identity.canonicalId.replaceAll(":", "-")}`;

  return (
    <article
      className={`radar-optimizer-card ${featured ? "radar-optimizer-card-featured" : ""} radar-optimizer-card-${result.eligibility}`}
      aria-labelledby={headingId}
    >
      <header className="radar-optimizer-card-head">
        <div className="min-w-0">
          {featured && (
            <p className="radar-subheading">Best fit</p>
          )}
          {result.rank !== null && (
            <p className="radar-optimizer-rank">Rank {result.rank}</p>
          )}
          <h3 id={headingId} className="radar-optimizer-model-name">
            <Link
              href={modelDetailHref(identity.canonicalId)}
              className="radar-explorer-model-link"
            >
              <span>{identity.displayName}</span>
              <span className="sr-only">
                {" "}
                model detail for {identity.displayName}
              </span>
            </Link>
          </h3>
          <p className="radar-optimizer-provider">{identity.providerName}</p>
        </div>
        <EligibilityStatus
          eligibility={result.eligibility}
          label={result.eligibilityLabel}
        />
      </header>

      <dl className="radar-optimizer-facts">
        <div>
          <dt>Estimated monthly cost</dt>
          <dd>
            {result.estimatedMonthlyCostLabel}
            {result.estimatedMonthlyCost === null && (
              <span className="sr-only">
                {result.eligibility === "unavailable_pricing"
                  ? " Pricing has not been observed"
                  : " Cost is unknown because required evidence is missing"}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Input</dt>
          <dd>
            {formatObservedPrice(result.inputPrice)}
            {result.inputPrice === null && (
              <span className="sr-only">Not observed</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd>
            {formatObservedPrice(result.outputPrice)}
            {result.outputPrice === null && (
              <span className="sr-only">Not observed</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd>
            {formatObservedTokens(result.contextWindow)}
            {result.contextWindow === null && (
              <span className="sr-only">Not observed</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Max output</dt>
          <dd>
            {formatObservedTokens(result.maxOutputTokens)}
            {result.maxOutputTokens === null && (
              <span className="sr-only">Not observed</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Vision</dt>
          <dd>
            <CapabilityStatus value={result.vision} />
          </dd>
        </div>
        <div>
          <dt>Tool calling</dt>
          <dd>
            <CapabilityStatus value={result.toolCalling} />
          </dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>
            <Badge variant={lifecycleVariant(result.lifecycle.state)}>
              {result.lifecycle.label}
            </Badge>
          </dd>
        </div>
        <div>
          <dt>Freshness</dt>
          <dd>
            <FreshnessStatus freshness={result.freshness} />
          </dd>
        </div>
      </dl>

      {result.exclusionReason && (
        <p className="radar-optimizer-reason" role="note">
          {result.exclusionReason}
        </p>
      )}

      <RequirementChecks
        checks={result.requirementChecks}
        subject={identity.displayName}
      />

      <div className="radar-optimizer-card-links">
        <Link href={modelDetailHref(identity.canonicalId)} className="radar-inline-link">
          Model detail
        </Link>
        {result.eligibility === "eligible" && (
          <Link
            href={compareHref([identity.canonicalId])}
            className="radar-inline-link"
          >
            Compare
          </Link>
        )}
        <Link href="/my-stack" className="radar-inline-link">
          My Stack
        </Link>
        <Link href="/sources" className="radar-inline-link">
          Sources
        </Link>
      </div>

      <ProvenanceDisclosure
        provenance={result.provenance}
        subject={identity.displayName}
      />
    </article>
  );
}
