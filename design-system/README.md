# @showme/design-system

The React component library for **shoWMe** — extracted from the product's
design system (`shoWMe Design System.dc.html`) and the persona prototypes
(Agent / Performer / Crew / Operator), which all share one identical component
vocabulary. It is **project-wide**, not agent-specific.

Scope: **tokens + common components + Storybook**. No screens are assembled here
(that was the agreed scope). See [`DESIGN-REVIEW.md`](./DESIGN-REVIEW.md) for the
audit of the source design's logic.

## Run

```bash
cd design-system
pnpm install     # or npm install
pnpm storybook   # → http://localhost:6006
```

## What's inside

**Foundations** (`src/styles/tokens.css`) — warm near-black neutral ramp, brand
red/gold/amber, an 8-hue status palette, four typefaces (Clash Display · Inter
Tight · Instrument Serif · JetBrains Mono), radius + elevation. Dark is the
default; **light remaps the same semantic tokens** (toggle in the toolbar).

**Components** (`src/components/*`) — each is a `.tsx` + CSS Module + `.stories.tsx`:

| Primitive | Composite |
|---|---|
| Button · Badge · Chip · Avatar · Input/SearchInput · Card · StatusDot · Tag · SectionHeader · StatCard · ProgressBar · Toast · ListRow · SidebarItem · KeyValueRow · EmptyState · Modal · Icon | ContactCard |

## Fidelity: exact copy of the source

This library is an **exact reproduction** of the downloaded design project
(`../claude-prototype/claude-download-2026-07-19/`), not an interpretation:

- **`tokens.css` is `_work/theme.css` verbatim** — the same dark-default +
  `[data-theme="light"]` semantic tokens the app uses. Components paint their
  semantic colors through these exact tokens, so dark is pixel-identical to the
  app and light themes exactly as the app does.
- **Status colors are the source literals** (`#6FC97A`, `#F4A046`, `#B58BE0`…
  with `.14` tint fills) — the source has *no* status tokens, so neither do we.
  See `components/status.ts`.
- **Exact dimensions**: paddings, radii (12px buttons, 999px pills/badges),
  font sizes and shadows are copied from the catalog + persona markup.
- **Buttons**: `primary`/`secondary`/`ghost` are the in-app/catalog inline
  buttons (12px); `cta` is the `.btn.btn--primary` pill (the "Propose
  representation" hero button).
- Full words, no abbreviations (matches the repo's naming rule).
- Import styles once via the package entry (`src/index.ts` pulls in the token +
  global CSS).

## Relationship to the rebuild

This maps to `packages/ui` in the PLAN.md monorepo (the presentational layer
shared by `apps/web` + `apps/ssr`). It is kept standalone for now so it doesn't
depend on the not-yet-scaffolded monorepo; move it under `packages/ui` when the
workspace is created.
