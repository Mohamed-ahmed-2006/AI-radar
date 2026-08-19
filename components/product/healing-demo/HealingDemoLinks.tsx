import Link from "next/link";

import type { HealingDemoReadModel } from "../../../lib/product/healing-demo";

export function HealingDemoLinks({ model }: { model: HealingDemoReadModel }) {
  return (
    <nav className="radar-healing-links" aria-label="Related reliability surfaces">
      <Link href={model.links.sourceHealthHref} className="radar-inline-link">
        Source Health
      </Link>
      {model.links.sourceDetailHref && (
        <Link href={model.links.sourceDetailHref} className="radar-inline-link">
          Source Detail
        </Link>
      )}
      {model.links.provenanceHref && (
        <Link href={model.links.provenanceHref} className="radar-inline-link">
          Provenance
        </Link>
      )}
      {model.links.sourceDetailHref && (
        <Link
          href={`${model.links.sourceDetailHref}#source-incidents`}
          className="radar-inline-link"
        >
          Incident and healing timeline
        </Link>
      )}
    </nav>
  );
}
