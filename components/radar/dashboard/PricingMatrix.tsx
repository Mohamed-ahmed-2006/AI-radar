import type { ModelPricing } from "../types";
import { Badge } from "../ui/Badge";
import { EmptyState, LoadingState } from "../ui/DataState";
import { Panel } from "../ui/Panel";
import Link from "next/link";
import {
  formatAbsoluteTime,
  formatContextWindow,
  formatCurrency,
} from "../utils";

interface PricingMatrixProps {
  models: ModelPricing[];
  loading?: boolean;
}

function RateCell({ value, label }: { value: number | null; label: string }) {
  return (
    <td className="radar-table-cell text-right tabular-nums">
      <span className="text-radar-text-primary">{value === null ? "—" : formatCurrency(value)}</span>
      <span className="sr-only"> per million tokens ({label})</span>
    </td>
  );
}

export function PricingMatrix({ models, loading }: PricingMatrixProps) {
  return (
    <Panel
      id="pricing"
      title="Model pricing matrix"
      subtitle="Per-million-token rates · standard, short, and long context tiers"
      action={
        <span className="radar-page-intro-links">
          <Link href="/models" className="radar-inline-link">
            Explore Models
          </Link>
          <Link href="/models/compare" className="radar-inline-link">
            Compare
          </Link>
        </span>
      }
    >
      {loading ? (
        <LoadingState title="Loading pricing data…" />
      ) : models.length === 0 ? (
        <EmptyState
          title="No models in matrix"
          description="Pricing data will appear once collectors verify provider rates."
        />
      ) : (
        <div className="radar-table-scroll">
          <table className="radar-table w-full" aria-label="Model pricing matrix">
            <thead>
              <tr>
                <th scope="col" className="radar-table-head text-left">
                  Model
                </th>
                <th scope="col" className="radar-table-head text-left">
                  Status
                </th>
                <th scope="col" className="radar-table-head text-right">
                  Context
                </th>
                <th scope="col" className="radar-table-head text-center" colSpan={3}>
                  Standard / short tier
                </th>
                <th scope="col" className="radar-table-head text-center" colSpan={3}>
                  Long tier
                </th>
                <th scope="col" className="radar-table-head text-right">
                  Verified
                </th>
              </tr>
              <tr className="radar-table-subhead">
                <th scope="col" colSpan={3} />
                <th scope="col" className="radar-table-subhead-cell">Input</th>
                <th scope="col" className="radar-table-subhead-cell">Cached</th>
                <th scope="col" className="radar-table-subhead-cell">Output</th>
                <th scope="col" className="radar-table-subhead-cell">Input</th>
                <th scope="col" className="radar-table-subhead-cell">Cached</th>
                <th scope="col" className="radar-table-subhead-cell">Output</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {models.map((model) => {
                const short = model.rates.find((r) => r.tier === "short") ??
                  model.rates.find((r) => r.tier === "standard");
                const long = model.rates.find((r) => r.tier === "long");
                const statusVariant =
                  model.status === "active"
                    ? "success"
                    : model.status === "deprecated"
                      ? "warning"
                      : "info";

                return (
                  <tr key={model.id} className="radar-table-row">
                    <td className="radar-table-cell">
                      <div>
                        <span className="font-mono text-sm text-radar-text-primary">
                          {model.slug}
                        </span>
                        <span className="block text-[10px] text-radar-text-muted">
                          {model.provider} · {model.name}
                        </span>
                      </div>
                    </td>
                    <td className="radar-table-cell">
                      <Badge variant={statusVariant}>{model.status}</Badge>
                    </td>
                    <td className="radar-table-cell text-right font-mono text-xs text-radar-text-secondary tabular-nums">
                      {model.contextWindow === null ? "—" : formatContextWindow(model.contextWindow)}
                    </td>
                    {short ? (
                      <>
                        <RateCell value={short.inputPerMillion} label="standard or short input" />
                        <RateCell
                          value={short.cachedInputPerMillion ?? null}
                          label="standard or short cached input"
                        />
                        <RateCell value={short.outputPerMillion} label="standard or short output" />
                      </>
                    ) : (
                      <td colSpan={3} className="radar-table-cell text-center text-radar-text-muted">
                        —
                      </td>
                    )}
                    {long ? (
                      <>
                        <RateCell value={long.inputPerMillion} label="long input" />
                        <RateCell
                          value={long.cachedInputPerMillion ?? null}
                          label="long cached input"
                        />
                        <RateCell value={long.outputPerMillion} label="long output" />
                      </>
                    ) : (
                      <td colSpan={3} className="radar-table-cell text-center text-radar-text-muted">
                        —
                      </td>
                    )}
                    <td className="radar-table-cell text-right text-[10px] text-radar-text-muted tabular-nums">
                      <time dateTime={model.lastVerifiedAt}>
                        {formatAbsoluteTime(model.lastVerifiedAt)}
                      </time>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
