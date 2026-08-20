"use client";

import type { ReactNode } from "react";

export interface SegmentedTab {
  id: string;
  label: string;
}

export function SegmentedTabs({
  tabs,
  value,
  onChange,
  children,
}: {
  tabs: readonly SegmentedTab[];
  value: string;
  onChange: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="radar-tabs">
      <div className="radar-tablist" role="tablist" aria-label="Sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            className="radar-tab"
            aria-selected={value === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

export function TabPanel({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={`panel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      hidden={!active}
      className="radar-tabpanel"
    >
      {children}
    </div>
  );
}
