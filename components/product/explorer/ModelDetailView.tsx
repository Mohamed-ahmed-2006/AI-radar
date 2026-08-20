import type { ReactNode } from "react";
import Link from "next/link";

import { Badge } from "../../radar/ui/Badge";
import { Panel } from "../../radar/ui/Panel";
import { formatAbsoluteTime, formatRelativeTime } from "../../radar/utils";
import type {
  ModelDetailReadModel,
  SectionState,
} from "../../../lib/product/explorer";
import { compareHref } from "../../../lib/product/explorer";
import type { ProvenanceView } from "../../../lib/product/provenance";
import { UnavailableNote } from "../common/UnavailableNote";
import { ProvenanceDetails } from "../provenance/ProvenanceDetails";
import { ProvenanceDisclosure } from "../provenance/ProvenanceDisclosure";
import { ModelWatchControl } from "../watchlist/ModelWatchControl";
import { CapabilityStatus } from "./CapabilityStatus";
import { FreshnessStatus } from "./FreshnessStatus";
import { formatModalities, formatObservedPrice, formatObservedTokens } from "./format";

function Section<T>({
  state,
  children,
}: {
  state: SectionState<T>;
  children: (data: T) => ReactNode;
}) {
  if (!state.available) return <UnavailableNote reason={state.reason} />;
  return <>{children(state.data)}</>;
}

/**
 * Discloses the provenance of one evidence domain. A domain with no
 * observation says so, rather than borrowing another domain's source.
 */
function DomainProvenance({
  provenance,
  subject,
}: {
  provenance: ProvenanceView | null;
  subject: string;
}) {
  if (!provenance) {
    return (
      <p className="text-xs text-radar-text-muted">
        No {subject} source has been observed for this model.
      </p>
    );
  }
  return <ProvenanceDisclosure provenance={provenance} subject={subject} />;
}

function Fact({
  label,
  value,
  mono = false,
  empty = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  empty?: boolean;
}) {
  return (
    <div className="radar-fact">
      <dt className="radar-fact-label">{label}</dt>
      <dd className={`radar-fact-value ${mono ? "font-mono" : ""} ${empty ? "text-radar-text-muted" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function lifecycleVariant(
  state: string | null,
): "success" | "warning" | "muted" | "info" {
  if (state === "active") return "success";
  if (state === "deprecated" || state === "legacy") return "warning";
  if (state === "retired") return "muted";
  return "info";
}

export function ModelDetailView({ detail }: { detail: ModelDetailReadModel }) {
  const { identity } = detail;

  return (
    <div className="radar-surface-stack">
      <nav className="radar-workflow-links" aria-label="Model actions">
        <ModelWatchControl identity={identity} />
        <Link href={compareHref([identity.canonicalId])} className="radar-inline-link">
          Compare
        </Link>
        <Link href="/optimizer" className="radar-inline-link">
          Optimize Stack
        </Link>
        <Link href="/my-stack" className="radar-inline-link">
          My Stack
        </Link>
      </nav>

      <div className="radar-source-detail-grid">
        <div className="radar-surface-stack">
          <Panel
            id="model-identity"
            title="Identity"
            subtitle="Canonical model identity as observed"
            action={
              <Badge variant={lifecycleVariant(detail.lifecycle.available ? detail.lifecycle.data.state : null)}>
                {detail.lifecycle.available ? detail.lifecycle.data.label : "Unknown"}
              </Badge>
            }
          >
            <dl className="radar-fact-grid">
              <Fact label="Provider" value={identity.providerName} />
              <Fact label="Display name" value={identity.displayName} />
              <Fact
                label="API model id"
                value={identity.apiModelId ?? "Not observed"}
                mono
                empty={!identity.apiModelId}
              />
              <Fact label="Canonical id" value={identity.canonicalId} mono />
              <Fact
                label="Family"
                value={identity.modelFamily ?? "Not observed"}
                empty={!identity.modelFamily}
              />
              <Fact
                label="Stage"
                value={identity.modelStage ?? "Not observed"}
                empty={!identity.modelStage}
              />
            </dl>
            <div className="mt-3">
              <p className="radar-fact-label">Known API model ids</p>
              <Section state={detail.apiModelIds}>
                {(ids) => (
                  <ul className="radar-tag-list" aria-label="Known API model ids">
                    {ids.map((id) => (
                      <li key={id} className="radar-tag font-mono">
                        {id}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </Panel>

          <Panel id="model-pricing" title="Pricing" subtitle="USD per 1M tokens, as observed">
            <Section state={detail.pricing}>
              {(prices) => (
                <div className="overflow-x-auto">
                  <table className="radar-table w-full" aria-label="Observed pricing">
                    <thead>
                      <tr>
                        <th scope="col" className="radar-table-head text-left">Tier</th>
                        <th scope="col" className="radar-table-head text-left">Mode</th>
                        <th scope="col" className="radar-table-head text-right">Input</th>
                        <th scope="col" className="radar-table-head text-right">Cached</th>
                        <th scope="col" className="radar-table-head text-right">Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prices.map((price, index) => (
                        <tr
                          key={`${price.contextTier ?? "tier"}-${price.pricingMode ?? "mode"}-${index}`}
                          className="radar-table-row"
                        >
                          <td className="radar-table-cell">{price.contextTier ?? "Not observed"}</td>
                          <td className="radar-table-cell">{price.pricingMode ?? "Not observed"}</td>
                          <td className="radar-table-cell text-right tabular-nums">
                            {formatObservedPrice(price.inputPerMillion)}
                            {price.inputPerMillion === null && (
                              <span className="sr-only">Not observed</span>
                            )}
                          </td>
                          <td className="radar-table-cell text-right tabular-nums">
                            {formatObservedPrice(price.cachedInputPerMillion)}
                            {price.cachedInputPerMillion === null && (
                              <span className="sr-only">Not observed</span>
                            )}
                          </td>
                          <td className="radar-table-cell text-right tabular-nums">
                            {formatObservedPrice(price.outputPerMillion)}
                            {price.outputPerMillion === null && (
                              <span className="sr-only">Not observed</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <DomainProvenance
                    provenance={detail.provenanceByDomain.pricing}
                    subject="pricing"
                  />
                </div>
              )}
            </Section>
          </Panel>

          <Panel id="model-capabilities" title="Capabilities" subtitle="Observed features, not assumed ones">
            <Section state={detail.capabilities}>
              {(capabilities) => (
                <>
                  <dl className="radar-fact-grid">
                    <div className="radar-fact">
                      <dt className="radar-fact-label">Vision</dt>
                      <dd className="radar-fact-value">
                        <CapabilityStatus value={capabilities.vision} />
                      </dd>
                    </div>
                    <div className="radar-fact">
                      <dt className="radar-fact-label">Tool calling</dt>
                      <dd className="radar-fact-value">
                        <CapabilityStatus value={capabilities.toolCalling} />
                      </dd>
                    </div>
                    <Fact
                      label="Input modalities"
                      value={formatModalities(capabilities.inputModalities)}
                      empty={capabilities.inputModalities.length === 0}
                    />
                    <Fact
                      label="Output modalities"
                      value={formatModalities(capabilities.outputModalities)}
                      empty={capabilities.outputModalities.length === 0}
                    />
                    <Fact
                      label="Supported features"
                      value={formatModalities(capabilities.supportedFeatures)}
                      empty={capabilities.supportedFeatures.length === 0}
                    />
                  </dl>
                  <DomainProvenance
                    provenance={detail.provenanceByDomain.capability}
                    subject="capabilities"
                  />
                </>
              )}
            </Section>
          </Panel>

          <Panel id="model-limits" title="Context and output limits">
            <Section state={detail.limits}>
              {(limits) => (
                <dl className="radar-fact-grid">
                  <Fact
                    label="Context window"
                    value={
                      limits.contextWindow === null
                        ? "Not observed"
                        : formatObservedTokens(limits.contextWindow)
                    }
                    empty={limits.contextWindow === null}
                    mono
                  />
                  <Fact
                    label="Max output"
                    value={
                      limits.maxOutputTokens === null
                        ? "Not observed"
                        : formatObservedTokens(limits.maxOutputTokens)
                    }
                    empty={limits.maxOutputTokens === null}
                    mono
                  />
                </dl>
              )}
            </Section>
          </Panel>
        </div>

        <div className="radar-surface-stack">
          <Panel id="model-lifecycle" title="Lifecycle" subtitle="Projected state as observed">
            <Section state={detail.lifecycle}>
              {(lifecycle) => (
                <>
                  <dl className="radar-fact-grid">
                    <Fact label="State" value={lifecycle.label} />
                    <Fact
                      label="Active"
                      value={
                        lifecycle.isActive === null
                          ? "Unknown"
                          : lifecycle.isActive
                            ? "Yes"
                            : "No"
                      }
                    />
                    <Fact
                      label="Deprecated on"
                      value={lifecycle.deprecatedOn ?? "Not observed"}
                      empty={!lifecycle.deprecatedOn}
                    />
                    <Fact
                      label="Retirement date"
                      value={lifecycle.retirementDate ?? "Not observed"}
                      empty={!lifecycle.retirementDate}
                    />
                    <Fact
                      label="Retirement not before"
                      value={lifecycle.retirementNotBefore ?? "Not observed"}
                      empty={!lifecycle.retirementNotBefore}
                    />
                  </dl>
                  <DomainProvenance
                    provenance={detail.provenanceByDomain.lifecycle}
                    subject="lifecycle"
                  />
                </>
              )}
            </Section>
          </Panel>

          <Panel id="model-replacement" title="Replacement evidence">
            <Section state={detail.replacement}>
              {(replacement) => (
                <dl className="radar-fact-grid">
                  <Fact
                    label="Recommended replacement"
                    value={replacement.replacement ?? "Not observed"}
                    empty={!replacement.replacement}
                    mono
                  />
                  <Fact
                    label="Replacement model id"
                    value={replacement.replacementModelId ?? "Not observed"}
                    empty={!replacement.replacementModelId}
                    mono
                  />
                </dl>
              )}
            </Section>
          </Panel>

          <Panel id="model-freshness" title="Freshness">
            <FreshnessStatus freshness={detail.freshness} />
            <p className="text-xs text-radar-text-muted mt-2">{detail.freshness.description}</p>
            <ProvenanceDisclosure provenance={detail.provenance} subject="freshness" />
          </Panel>

          <Panel
            id="model-provenance"
            title="Provenance"
            subtitle="The record behind the values on this page"
          >
            <ProvenanceDetails provenance={detail.provenance} />
          </Panel>
        </div>
      </div>

      <details className="radar-panel">
        <summary className="radar-panel-header cursor-pointer">
          <div>
            <h2 className="radar-panel-title">History and evidence</h2>
            <p className="radar-panel-subtitle">Recent changes and observed history</p>
          </div>
        </summary>
        <div className="radar-panel-body radar-surface-stack">
            <Panel id="model-changes" title="Recent changes">
        <Section state={detail.recentChanges}>
          {(changes) => (
            <ol className="radar-run-list" aria-label="Recent model changes">
              {changes.map((change) => (
                <li key={change.id} className="radar-run-item">
                  <p className="font-medium text-sm">{change.changeTypeLabel}</p>
                  {change.summary && (
                    <p className="text-xs text-radar-text-secondary">{change.summary}</p>
                  )}
                  {change.field && (
                    <p className="text-[11px] text-radar-text-muted font-mono">{change.field}</p>
                  )}
                  {(change.before || change.after) && (
                    <p className="text-xs text-radar-text-secondary">
                      {change.before ?? "—"}
                      <span aria-hidden="true"> → </span>
                      {change.after ?? "—"}
                    </p>
                  )}
                  <time
                    dateTime={change.observedAt}
                    className="text-[10px] text-radar-text-muted"
                    title={formatAbsoluteTime(change.observedAt)}
                  >
                    {formatRelativeTime(change.observedAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </Panel>

      <Panel
        id="model-pricing-history"
        title="Pricing history"
        subtitle="Every price this model has been observed at, newest first"
      >
        <Section state={detail.pricingHistory}>
          {(history) => (
            <div className="overflow-x-auto">
              <table className="radar-table w-full" aria-label="Pricing history">
                <thead>
                  <tr>
                    <th scope="col" className="radar-table-head text-left">Observed</th>
                    <th scope="col" className="radar-table-head text-left">Tier</th>
                    <th scope="col" className="radar-table-head text-right">Input</th>
                    <th scope="col" className="radar-table-head text-right">Cached</th>
                    <th scope="col" className="radar-table-head text-right">Output</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item, index) => (
                    <tr
                      key={`${item.observedAt}-${item.pricingMode ?? "mode"}-${item.contextTier ?? "tier"}-${index}`}
                      className="radar-table-row"
                    >
                      <td className="radar-table-cell">
                        <time dateTime={item.observedAt}>
                          {formatAbsoluteTime(item.observedAt)}
                        </time>
                      </td>
                      <td className="radar-table-cell">
                        {item.contextTier ?? "Not observed"}
                      </td>
                      <td className="radar-table-cell text-right tabular-nums">
                        {formatObservedPrice(item.inputPerMillion)}
                      </td>
                      <td className="radar-table-cell text-right tabular-nums">
                        {formatObservedPrice(item.cachedInputPerMillion)}
                      </td>
                      <td className="radar-table-cell text-right tabular-nums">
                        {formatObservedPrice(item.outputPerMillion)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </Panel>

      <Panel
        id="model-lifecycle-history"
        title="Lifecycle history"
        subtitle="What the lifecycle source has published over time"
      >
        <Section state={detail.lifecycleHistory}>
          {(history) => (
            <div className="overflow-x-auto">
              <table className="radar-table w-full" aria-label="Lifecycle history">
                <thead>
                  <tr>
                    <th scope="col" className="radar-table-head text-left">Observed</th>
                    <th scope="col" className="radar-table-head text-left">State</th>
                    <th scope="col" className="radar-table-head text-left">Deprecated on</th>
                    <th scope="col" className="radar-table-head text-left">Retirement</th>
                    <th scope="col" className="radar-table-head text-left">Replacement</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item, index) => (
                    <tr
                      key={`${item.observedAt}-${item.apiModelId ?? "model"}-${index}`}
                      className="radar-table-row"
                    >
                      <td className="radar-table-cell">
                        <time dateTime={item.observedAt}>
                          {formatAbsoluteTime(item.observedAt)}
                        </time>
                      </td>
                      <td className="radar-table-cell">{item.label}</td>
                      <td className="radar-table-cell">
                        {item.deprecatedOn ?? "Not observed"}
                      </td>
                      <td className="radar-table-cell">
                        {item.retirementDate ??
                          (item.retirementNotBefore
                            ? `Not before ${item.retirementNotBefore}`
                            : "Not observed")}
                      </td>
                      <td className="radar-table-cell font-mono">
                        {item.recommendedReplacement ?? "Not observed"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </Panel>

      <Panel id="model-history" title="Capability history" subtitle="Historical observations the backend exposed">
        <Section state={detail.history}>
          {(history) => (
            <div className="overflow-x-auto">
              <table className="radar-table w-full" aria-label="Capability history">
                <thead>
                  <tr>
                    <th scope="col" className="radar-table-head text-left">Observed</th>
                    <th scope="col" className="radar-table-head text-right">Context</th>
                    <th scope="col" className="radar-table-head text-right">Max output</th>
                    <th scope="col" className="radar-table-head text-left">Vision</th>
                    <th scope="col" className="radar-table-head text-left">Tools</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.observedAt} className="radar-table-row">
                      <td className="radar-table-cell">
                        <time dateTime={item.observedAt}>{formatAbsoluteTime(item.observedAt)}</time>
                      </td>
                      <td className="radar-table-cell text-right tabular-nums">
                        {formatObservedTokens(item.contextWindow)}
                      </td>
                      <td className="radar-table-cell text-right tabular-nums">
                        {formatObservedTokens(item.maxOutputTokens)}
                      </td>
                      <td className="radar-table-cell">
                        <CapabilityStatus value={item.vision} compact />
                      </td>
                      <td className="radar-table-cell">
                        <CapabilityStatus value={item.toolCalling} compact />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </Panel>
        </div>
      </details>
    </div>
  );
}
