"use client";

import Link from "next/link";

import { compareHref, modelDetailHref, type ModelExplorerRow } from "../../../lib/product/explorer";
import { Drawer } from "../ui/Overlay";
import { ProvenanceDetails } from "../provenance/ProvenanceDetails";
import { CapabilityStatus } from "./CapabilityStatus";
import { FreshnessStatus } from "./FreshnessStatus";
import { formatObservedPrice, formatObservedTokens } from "./format";
import { Badge } from "../../radar/ui/Badge";

function lifecycleVariant(
  state: string | null,
): "success" | "warning" | "muted" | "info" {
  if (state === "active") return "success";
  if (state === "deprecated" || state === "legacy") return "warning";
  if (state === "retired") return "muted";
  return "info";
}

export function ModelQuickView({
  model,
  onClose,
}: {
  model: ModelExplorerRow | null;
  onClose: () => void;
}) {
  if (!model) return null;
  const id = model.identity.canonicalId;

  return (
    <Drawer
      open
      title={model.identity.displayName}
      kicker={model.identity.providerName}
      onClose={onClose}
      footer={
        <>
          <Link href={compareHref([id])} className="radar-compare-go">
            Compare
          </Link>
          <Link href={modelDetailHref(id)} className="radar-secondary-button">
            Full details
          </Link>
        </>
      }
    >
      <dl className="radar-fact-grid">
        <div className="radar-fact">
          <dt className="radar-fact-label">Lifecycle</dt>
          <dd className="radar-fact-value">
            <Badge variant={lifecycleVariant(model.lifecycle.state)}>
              {model.lifecycle.label}
            </Badge>
          </dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Context</dt>
          <dd className="radar-fact-value font-mono">
            {formatObservedTokens(model.contextWindow)}
          </dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Input / 1M</dt>
          <dd className="radar-fact-value">{formatObservedPrice(model.inputPrice)}</dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Output / 1M</dt>
          <dd className="radar-fact-value">{formatObservedPrice(model.outputPrice)}</dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Vision</dt>
          <dd className="radar-fact-value">
            <CapabilityStatus value={model.vision} />
          </dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Tools</dt>
          <dd className="radar-fact-value">
            <CapabilityStatus value={model.toolCalling} />
          </dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Freshness</dt>
          <dd className="radar-fact-value">
            <FreshnessStatus freshness={model.freshness} />
          </dd>
        </div>
      </dl>
      <div className="mt-4">
        <p className="radar-subheading">Provenance</p>
        <ProvenanceDetails provenance={model.provenance} />
      </div>
    </Drawer>
  );
}
