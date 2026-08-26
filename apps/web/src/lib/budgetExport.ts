/**
 * Handing the operator the budget as a file.
 *
 * The CSV itself is built by `budgetToCsv` in `@showme/shared` — pure, unit
 * tested, and framework-agnostic per CLAUDE.md. All that lives here is the one
 * thing that cannot: the DOM. Same shape as `proFilingExport.ts`, which
 * established the pattern (a Blob + an object URL, revoked immediately after the
 * click, rather than a `data:` href that a long file can overflow).
 */

/** A filename that survives every filesystem — no slashes, colons or spaces. */
export function budgetFileName(eventTitle: string, extension: string): string {
  const slug = eventTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "budget"}-budget.${extension}`;
}

/** Save a text file to the operator's machine. */
export function downloadTextFile(fileName: string, contents: string, mediaType: string): void {
  const blob = new Blob([contents], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * The PDF button.
 *
 * `window.print()` and not a generated document, because that is what "export a
 * PDF" already means in this app — the Agreement tab's Export PDF and the event
 * header's Share & Export both do exactly this (`routes/EventDetail.tsx`). Every
 * browser's print dialog offers "Save as PDF", so the operator gets a real file;
 * shipping a second, different mechanism for the same verb on one screen would be
 * the inconsistency, and no PDF library exists anywhere in the repo to make it
 * with. If generated PDFs arrive later they should replace all three at once.
 */
export function printBudget(): void {
  window.print();
}
