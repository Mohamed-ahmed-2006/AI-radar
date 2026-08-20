import { GroundedProse } from "../ui/GroundedProse";

const PREVIEW_ITEMS = 3;

function listItems(markdown: string): string[] {
  return markdown.split(/\r?\n/).filter((line) => /^\s*[-*]\s/.test(line));
}

function previewMarkdown(chunk: string): { visible: string; hidden: string; total: number } {
  const lines = chunk.split(/\r?\n/);
  const before: string[] = [];
  const items: string[] = [];
  const after: string[] = [];
  let seenItem = false;
  for (const line of lines) {
    if (/^\s*[-*]\s/.test(line)) {
      seenItem = true;
      items.push(line);
      continue;
    }
    if (!seenItem) before.push(line);
    else after.push(line);
  }
  const total = items.length;
  if (total <= PREVIEW_ITEMS) {
    return { visible: chunk, hidden: "", total };
  }
  return {
    visible: [...before, ...items.slice(0, PREVIEW_ITEMS)].join("\n"),
    hidden: [...items.slice(PREVIEW_ITEMS), ...after].join("\n"),
    total,
  };
}

/**
 * Presentation-only compression for long temporal answers.
 * The executor text is unchanged; long event lists stay in the document
 * behind a native disclosure so nothing is dropped.
 */
export function AskAnswerProse({
  text,
  intent,
}: {
  text: string;
  intent: string;
}) {
  if (intent !== "temporal") {
    return <GroundedProse text={text} />;
  }

  const chunks = text
    .split(/(?=^#{2,4} )/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length <= 1) {
    const items = listItems(text);
    if (items.length <= PREVIEW_ITEMS) {
      return <GroundedProse text={text} />;
    }
  }

  if (chunks.length === 0) {
    return <GroundedProse text={text} />;
  }

  return (
    <div className="radar-ask-answer-stack">
      {chunks.map((chunk, index) => {
        const isLead = index === 0 && /^#{1,3} /.test(chunk);
        const isProvenance = /^#{2,4} Grounded Evidence/i.test(chunk);
        const preview = previewMarkdown(chunk);
        const collapse =
          preview.hidden.length > 0 &&
          !isProvenance &&
          !(isLead && chunks.length > 1);
        if (!collapse) {
          return <GroundedProse key={`ask-prose-${index}`} text={chunk} />;
        }
        return (
          <div key={`ask-prose-${index}`}>
            <GroundedProse text={preview.visible} />
            <details className="radar-ask-more-events">
              <summary className="radar-inline-link cursor-pointer">
                Show all {preview.total} events
              </summary>
              <div className="radar-ask-more-events-body">
                <GroundedProse text={preview.hidden} />
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
}
