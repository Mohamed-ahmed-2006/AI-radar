"use client";

import { useState, type ReactNode } from "react";
import { SegmentedTabs, TabPanel } from "../ui/SegmentedTabs";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "runs", label: "Runs" },
  { id: "incidents", label: "Incidents" },
  { id: "healing", label: "Healing" },
  { id: "evidence", label: "Evidence" },
] as const;

export function SourceDetailLayout({
  hero,
  overview,
  runs,
  incidents,
  healing,
  evidence,
}: {
  hero: ReactNode;
  overview: ReactNode;
  runs: ReactNode;
  incidents: ReactNode;
  healing: ReactNode;
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
        <TabPanel id="runs" active={tab === "runs"}>
          {runs}
        </TabPanel>
        <TabPanel id="incidents" active={tab === "incidents"}>
          {incidents}
        </TabPanel>
        <TabPanel id="healing" active={tab === "healing"}>
          {healing}
        </TabPanel>
        <TabPanel id="evidence" active={tab === "evidence"}>
          {evidence}
        </TabPanel>
      </SegmentedTabs>
    </div>
  );
}
