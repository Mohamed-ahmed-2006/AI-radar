import {
  requirementCheckStatusLabel,
  type RequirementCheck,
} from "../../../lib/product/optimizer";

/** Backend-supplied requirement checks. Unknown is labelled Unknown, never Fail. */
export function RequirementChecks({
  checks,
  subject,
}: {
  checks: readonly RequirementCheck[];
  subject?: string;
}) {
  if (checks.length === 0) return null;

  return (
    <ul
      className="radar-requirement-list"
      aria-label={subject ? `Requirement checks for ${subject}` : "Requirement checks"}
    >
      {checks.map((check) => (
        <li key={check.id} className={`radar-requirement radar-requirement-${check.status}`}>
          <span className="radar-requirement-status">
            {requirementCheckStatusLabel(check.status)}
          </span>
          <span className="radar-requirement-copy">
            <span className="radar-requirement-label">{check.label}</span>
            <span className="radar-requirement-detail">{check.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
