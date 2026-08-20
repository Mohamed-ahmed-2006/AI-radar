export function DashboardThesis() {
  return (
    <section className="radar-thesis" aria-label="How AI Radar works">
      <p className="radar-thesis-headline">
        AI Radar turns unstable AI-provider websites into trusted, auditable
        intelligence.
      </p>
      <ol className="radar-thesis-pipe">
        <li>Official provider websites</li>
        <li>Bright Data Scraper Studio</li>
        <li>Sentinel</li>
        <li>Explorer / Optimizer / Grounded Ask</li>
      </ol>
      <dl className="radar-thesis-roles">
        <div className="radar-thesis-role">
          <dt>Bright Data</dt>
          <dd>Collect + repair</dd>
        </div>
        <div className="radar-thesis-role">
          <dt>Sentinel</dt>
          <dd>Validate · Quarantine · LKG</dd>
        </div>
        <div className="radar-thesis-role">
          <dt>Decisions</dt>
          <dd>Compare · Optimize · Ask</dd>
        </div>
      </dl>
    </section>
  );
}
