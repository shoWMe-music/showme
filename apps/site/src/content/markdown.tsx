import type { ReactNode } from "react";

// Matches a `**bold**` run (group 1) or an `*italic*` run (group 2). The inner
// classes exclude `*` so runs stay non-greedy and don't swallow adjacent marks.
const INLINE_MARKDOWN = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;

/**
 * Render the minimal inline-markdown subset the content contract allows —
 * `**bold**` → `<strong>`, `*italic*` → `<em>` — as React nodes. Plain text is
 * returned verbatim. SAFE by construction: text is split and wrapped, never
 * injected as HTML (no `dangerouslySetInnerHTML`).
 */
export function renderInlineMarkdown(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  INLINE_MARKDOWN.lastIndex = 0;
  let match = INLINE_MARKDOWN.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(<strong key={key++}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      nodes.push(<em key={key++}>{match[2]}</em>);
    }
    lastIndex = match.index + match[0].length;
    match = INLINE_MARKDOWN.exec(text);
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
