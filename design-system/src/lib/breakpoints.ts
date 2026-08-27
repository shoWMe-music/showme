/**
 * The breakpoint scale, in JS — the mirror of the `--breakpoint-*` tokens in
 * `styles/tokens.css`, where the two numbers are explained in full.
 *
 * It exists because a custom property cannot be read from a media query
 * condition (`@media (max-width: var(--breakpoint-tablet))` is invalid CSS and
 * silently never matches), so the numbers have to be repeated somewhere. This is
 * that somewhere for the half of the system that decides in JS — the shell asks
 * "is the sidebar a drawer right now?" before it renders a drawer's worth of
 * dialog semantics, and no amount of CSS answers that question to React.
 *
 * Values, not a hook, on purpose. A `useMediaQuery` here would be a second
 * `useReducedMotion` with a cache map bolted on, and exactly one caller
 * (`apps/web/src/shell/useMobileNavigation.ts`). When there is a third, lift it.
 */
export const BREAKPOINTS = {
  /** ≤560px — the density step. Chrome gives up what it can afford to. */
  phone: 560,
  /** ≤860px — the structural step. The sidebar becomes an off-canvas drawer. */
  tablet: 860,
} as const;

/** A `matchMedia` string for "at or below this breakpoint", so no caller has to
 * remember whether the bound is inclusive. It is: the CSS says `max-width:
 * 860px` and this says the same, so the two never disagree by one pixel. */
export function atMost(breakpoint: number): string {
  return `(max-width: ${breakpoint}px)`;
}
