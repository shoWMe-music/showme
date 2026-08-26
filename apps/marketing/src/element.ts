/**
 * The one DOM helper the public pages share.
 *
 * It exists as its own module so `availability.ts` and `availability-request.ts`
 * can both use it without one importing the other — the request panel is a leaf
 * of the availability page, and a helper living in the page would make that
 * dependency circular.
 */

/**
 * Build an element and set its text with `textContent`, never `innerHTML`.
 *
 * That is the whole point of the helper on these pages: every string that reaches
 * them came out of a URL a stranger wrote or out of a form a stranger filled in,
 * so there is deliberately no code path here that can interpret one as markup.
 */
export function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
