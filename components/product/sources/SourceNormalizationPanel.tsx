import { Panel } from "../../radar/ui/Panel";
import type {
  SectionState,
  SourceNormalizationExplainer,
} from "../../../lib/product/source-detail";
import { UnavailableNote } from "../common/UnavailableNote";

/**
 * How a raw collector payload becomes a trusted, normalized record.
 *
 * The stages describe the pipeline this source actually travels; the figure
 * beside each stage is only shown when the backend reported one.
 */
export function SourceNormalizationPanel({
  normalization,
}: {
  normalization: SectionState<SourceNormalizationExplainer>;
}) {
  return (
    <Panel
      id="source-normalization"
      title="Raw to normalized"
      subtitle={
        normalization.available && normalization.data.contractName
          ? `Produces ${normalization.data.contractName}`
          : "How this source's payload becomes trusted data"
      }
    >
      {!normalization.available ? (
        <UnavailableNote reason={normalization.reason} />
      ) : (
        <ol className="radar-pipeline" aria-label="Raw to normalized pipeline stages">
          {normalization.data.stages.map((stage, index) => (
            <li key={stage.id} className="radar-pipeline-step">
              <span className="radar-pipeline-index" aria-hidden="true">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="radar-pipeline-label">
                  {stage.label}
                  {stage.detail && (
                    <span className="radar-pipeline-detail"> · {stage.detail}</span>
                  )}
                </p>
                <p className="radar-pipeline-description">{stage.description}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
