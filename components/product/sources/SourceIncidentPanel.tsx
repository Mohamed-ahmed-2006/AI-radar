import { Panel } from "../../radar/ui/Panel";
import { AnomalyReason } from "../../radar/sentinel/AnomalyReason";
import { RecoveryTimeline } from "../../radar/sentinel/RecoveryTimeline";
import type { SentinelTimelineStage } from "../../radar/sentinel/types";
import type {
  SectionState,
  SourceIncidentRecord,
} from "../../../lib/product/source-detail";
import { UnavailableNote } from "../common/UnavailableNote";

/**
 * Why this source broke and what the healing loop did about it.
 *
 * Both halves reuse the Sentinel components already on the fleet dashboard, so
 * an incident reads identically wherever it is shown.
 */
export function SourceIncidentPanel({
  incidents,
  healingTimeline,
  sourceName,
}: {
  incidents: SectionState<SourceIncidentRecord[]>;
  healingTimeline: SectionState<SentinelTimelineStage[]>;
  sourceName: string;
}) {
  return (
    <Panel
      id="source-incidents"
      title="Incidents and healing"
      subtitle="Anomaly detection, quarantine and recovery for this source"
    >
      <div className="radar-surface-stack-tight">
        {!incidents.available ? (
          <UnavailableNote reason={incidents.reason} />
        ) : (
          <ul className="radar-incident-list" aria-label={`Incidents for ${sourceName}`}>
            {incidents.data.map((incident) => (
              <li key={incident.id}>
                <AnomalyReason incident={incident} />
              </li>
            ))}
          </ul>
        )}

        <div>
          <h3 className="radar-subheading">Timeline</h3>
          {!healingTimeline.available ? (
            <UnavailableNote reason={healingTimeline.reason} />
          ) : (
            <RecoveryTimeline
              stages={healingTimeline.data}
              label={`${sourceName} incident and healing timeline`}
            />
          )}
        </div>
      </div>
    </Panel>
  );
}
