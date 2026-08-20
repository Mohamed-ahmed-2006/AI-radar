import type { ReactNode } from "react";

function inlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`b-${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        nodes.push(
          <a
            key={`a-${key++}`}
            href={link[2]}
            className="radar-inline-link"
            {...(link[2].startsWith("http")
              ? { target: "_blank", rel: "noreferrer" }
              : {})}
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(
        <code key={`c-${key++}`} className="font-mono text-[0.8em]">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}/.test(line);
}

function parseTable(lines: string[]): ReactNode {
  const rows = lines
    .map((line) =>
      line
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((row) => row.some((cell) => cell.length > 0));
  if (rows.length === 0) return null;
  const [header, maybeSep, ...rest] = rows;
  const body = isTableSeparator(maybeSep?.join(" ") ?? "") ? rest : [maybeSep, ...rest].filter(Boolean);

  return (
    <table>
      <thead>
        <tr>
          {header.map((cell) => (
            <th key={cell}>{inlineMarkdown(cell)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, index) => (
          <tr key={`${row[0]}-${index}`}>
            {row.map((cell, cellIndex) => (
              <td key={`${cell}-${cellIndex}`}>{inlineMarkdown(cell)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Renders grounded answer text. Markdown markers are interpreted rather than
 * shown as literals. Plain answers stay a single paragraph.
 */
export function GroundedProse({ text }: { text: string }) {
  const hasMarkup = /(^|\n)\s*#{1,6}\s|(^|\n)\s*[-*]\s|\*\*|`|\||\[[^\]]+\]\([^)]+\)/.test(text);
  if (!hasMarkup) {
    return <p className="radar-ask-answer">{text}</p>;
  }

  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (/^\s*#{1,6}\s/.test(line)) {
      const depth = Math.min(line.trim().match(/^#+/)?.[0].length ?? 3, 4);
      const Tag = (depth === 1 ? "h1" : depth === 2 ? "h2" : depth === 3 ? "h3" : "h4") as
        | "h1"
        | "h2"
        | "h3"
        | "h4";
      blocks.push(
        <Tag key={`h-${index}`}>{inlineMarkdown(line.replace(/^\s*#{1,6}\s+/, ""))}</Tag>,
      );
      index += 1;
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const tableLines = [line];
      index += 1;
      while (index < lines.length && lines[index].includes("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push(<div key={`t-${index}`}>{parseTable(tableLines)}</div>);
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{inlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !/^\s*#{1,6}\s/.test(lines[index]) &&
      !/^\s*[-*]\s/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }

  return <div className="radar-ask-answer radar-prose">{blocks}</div>;
}
