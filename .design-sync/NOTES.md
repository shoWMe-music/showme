# design-sync notes — @showme/design-system → Claude Design

Storybook shape. Repo: pnpm workspace, `design-system/` package. Global name `ShowmeDesignSystem`.
Target project: **Organic** (`96aa0fe3-e434-48db-9e8d-f90f68bd6149`) — being re-branded to shoWMe with the
old Organic system preserved under `reference/organic/` (see the upload step). Rename to "shoWMe" is done
manually in the Claude Design UI (the sync tool can't rename projects).

## General fixes (apply on every sync — already in config)

- **[GENERAL] Provider** — `.storybook/preview.tsx` decorates stories with `withThemeByDataAttribute`
  (from `@storybook/addon-themes`). That addon can't bundle into the preview runtime (stubbed → "is not a
  function", every component render-errors). Fix: `cfg.provider = {component: "PreviewFrame"}`, a tiny dark
  padded frame added via `cfg.extraEntries: ["../.design-sync/preview-provider.tsx"]`. The DS tokens default
  to the **dark** theme at `:root` (no `[data-theme=dark]` selector exists — dark is the base), so the frame
  only supplies padding + `var(--bg)`/`var(--text)`/`var(--font-sans)`, matching how storybook frames stories.
- **[GENERAL] cssEntry** — `cfg.cssEntry = "dist/design-system.css"` (relative to the package dir). It's a
  **monolithic** compiled stylesheet: `:root` tokens + global body styles + every component's CSS-module rules
  with the same hashed class names the bundle JS references. Without it components ship unstyled ([CSS_PLACEHOLDER]).
- **[GENERAL] Fonts are CDN** — Clash Display (Fontshare) + Inter Tight / Instrument Serif / JetBrains Mono
  (Google). They're `<link>`s in `.storybook/preview-head.html`, auto-scraped into `styles.css` as
  `@import url(...)`. Validate prints **[FONT_REMOTE]** — expected/benign (the host serves them at runtime;
  Organic already proves CDN fonts render in Claude Design). Do NOT chase it as [FONT_MISSING].
- **titleMap nulls** — `Introduction`, `Colors`, `Radius&Elevation`, `Typography` are foundation/token
  *showcase* stories, not components. Excluded via `titleMap: {…: null}`.

## Per-component overrides

- **GRID_OVERFLOW → cardMode "column"** (render wider than a grid cell; column keeps every story full-width):
  Card, Input, KeyValueRow, ListRow, ProgressBar, SelectCard, Skeleton, StatCard, Stepper, Tabs, TextField,
  TodoItem, Toggle.
- **Toast** — `cardMode: "single"`, `primaryStory: "Default"` (overlay/portal via ToastProvider). Its
  **LiveToasts** story is skipped (`skip: ["molecules-toast--live-toasts"]`): interaction-driven (toasts only
  appear on button click) and errors on static render (`$$typeof` undefined). Default + With Icon are the real
  static visuals and both grade match.

## Re-sync risks (watch-list for the next run)

- **CDN fonts / [ASSETS_BLOCKED]** — every fan-out subagent's compare printed
  `[ASSETS_BLOCKED] api.fontshare.com` (Clash Display, the `--font-display` heading font). It's a **conservative
  flag**: chromium reports the async font fetch as blocked, but the font actually renders before capture — verified
  by re-capturing SectionHeader + StatCard (both Clash-Display-heavy: "Your roster,"/"Settings" headings, €48,200
  numerals) and confirming the display font renders **and matches** on both panels. Critically, reference AND
  preview AND the shipped design all load fonts through the **same** `styles.css`/preview-head `@import`, so their
  comparison is valid whether or not egress exists (identical fallback both sides). Google Fonts (Inter Tight /
  JetBrains Mono / Instrument Serif) always loaded. Next run: don't panic on `[ASSETS_BLOCKED] api.fontshare.com`;
  spot-check one display-font component with egress if you want reassurance.
- **PreviewFrame** — owned wrapper in `.design-sync/preview-provider.tsx`. If `preview.tsx`'s decorator
  changes (e.g. a real light/dark toggle matters for a story), revisit the frame; it hard-codes dark.
- **Toast LiveToasts skip** — if that story is later made static-renderable, remove the skip.
- Solo phase (Button, Toast, ContactCard, DataTable) all graded **match** with zero per-component fixes —
  the global config carries the whole roster.
