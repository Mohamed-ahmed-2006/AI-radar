export default function HealingDemoLoading() {
  return (
    <div className="radar-healing-demo" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading real healing demo…</span>
      <div className="radar-healing-hero animate-pulse">
        <div className="h-3 w-40 rounded bg-radar-surface-raised" />
        <div className="h-12 w-2/3 rounded bg-radar-surface-raised" />
        <div className="h-4 w-1/2 rounded bg-radar-surface-raised" />
      </div>
    </div>
  );
}
