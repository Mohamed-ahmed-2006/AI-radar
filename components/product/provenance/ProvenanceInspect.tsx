"use client";

import { useState } from "react";

import type { ProvenanceView } from "../../../lib/product/provenance";
import { Drawer } from "../ui/Overlay";
import { ProvenanceDetails } from "./ProvenanceDetails";
import { TrustBadge } from "./TrustBadge";

/**
 * Compact trust chips plus a control that opens forensic provenance in the
 * Evidence drawer. Used wherever expanding the record in place would break
 * layout — notably comparison table cells.
 */
export function ProvenanceInspect({
  provenance,
  subject,
  compact = false,
  label = "Where did this come from?",
}: {
  provenance: ProvenanceView;
  subject: string;
  compact?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={compact ? "radar-compare-provenance" : "radar-provenance-trigger"}>
      <TrustBadge trust={provenance.trust} />
      <button
        type="button"
        className="radar-provenance-open"
        onClick={() => setOpen(true)}
      >
        {label}
        <span className="sr-only"> for {subject}</span>
      </button>
      <Drawer
        open={open}
        title={subject}
        kicker="Evidence / provenance"
        onClose={() => setOpen(false)}
      >
        <ProvenanceDetails provenance={provenance} />
      </Drawer>
    </div>
  );
}
