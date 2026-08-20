"use client";

import { useState, type ReactNode } from "react";
import { SegmentedTabs, TabPanel } from "../ui/SegmentedTabs";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "pricing", label: "Pricing" },
  { id: "capabilities", label: "Capabilities" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "evidence", label: "Evidence" },
] as const;

export function ModelDetailLayout({
  hero,
  overview,
  pricing,
  capabilities,
  lifecycle,
  evidence,
}: {
  hero: ReactNode;
  overview: ReactNode;
  pricing: ReactNode;
  capabilities: ReactNode;
  lifecycle: ReactNode;
  evidence: ReactNode;
}) {
  const [tab, setTab] = useState("overview");

  return (
    <div className="radar-surface-stack">
      {hero}
      <SegmentedTabs tabs={TABS} value={tab} onChange={setTab}>
        <TabPanel id="overview" active={tab === "overview"}>
          {overview}
        </TabPanel>
        <TabPanel id="pricing" active={tab === "pricing"}>
          {pricing}
        </TabPanel>
        <TabPanel id="capabilities" active={tab === "capabilities"}>
          {capabilities}
        </TabPanel>
        <TabPanel id="lifecycle" active={tab === "lifecycle"}>
          {lifecycle}
        </TabPanel>
        <TabPanel id="evidence" active={tab === "evidence"}>
          {evidence}
        </TabPanel>
      </SegmentedTabs>
    </div>
  );
}
