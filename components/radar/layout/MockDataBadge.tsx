interface MockDataBadgeProps {
  isMock: boolean;
}

/** Visible only when the explicit fixture/fallback data contract is in use. */
export function MockDataBadge({ isMock }: MockDataBadgeProps) {
  if (!isMock) return null;

  return (
    <span className="radar-mock-badge" title="Data is from UI fixture, not live">
      MOCK DATA
    </span>
  );
}
