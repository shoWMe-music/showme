# Style conformance sweep — 2026-08-26

A codebase-wide pass over `apps/web/src` and `apps/marketing/src` against
**`design-system/STYLE-GUIDE.md`**, run as a sweep rather than screen by screen.
Conformance only: no behaviour was changed, nothing that already conformed was
restyled, and where ten places wanted the same value the fix was a token
reference rather than ten edits.

**Gates:** `pnpm turbo run typecheck` **14/14** · `pnpm biome check` clean on every
file this pass touched (one pre-existing failure elsewhere — see *Blocked*) ·
`apps/api` **`vitest run` 784/784 across 49 files** (the bar was 770; the extra 14
came from other agents' work, nothing regressed).

**Verified in the browser, both themes** (screenshots in `.playwright-mcp/sweep-*.png`):
Tasks, Calendar, Team, Event → Messages, the create-event wizard, the notification
panel, and the public event RSVP page.

---

## The one-line summary

The token change that made light `--elevated` `#FFFFFF` fixed the *panels*, but it
also **silently switched off every small shape and every hover that was painted
with `--elevated`** — 54 of them. A toggle track, a progress trough, a segmented
control, a selected conversation, a hovered menu row: all of them were painting
white on white in light mode. That is the bulk of what this pass repaired.

---

## Rule 1 — hard-coded colour where a token exists

### 1a. Token names that were never defined anywhere (worst class)

Six `var(--…)` names are referenced in app code and **defined nowhere** — not in
`tokens.css`, not in any component. Every one silently fell through to a literal,
or to nothing.

| Name | Where | What it actually did | Fixed to |
|---|---|---|---|
| `--color-bg` | `auth/AuthScreen.tsx:54`, `auth/OnboardingFlow.tsx:259` | painted the literal `#17110f` — **the sign-in and onboarding screens ignored the theme entirely** | `var(--bg)` |
| `--color-brand` | `AuthScreen.tsx:111`, `OnboardingFlow.tsx:265` | literal `#ee5746` | `var(--brand-red)` |
| `--color-danger` | `AuthScreen.tsx:84`, `OnboardingFlow.tsx:457` | literal `#ee5746` | `var(--brand-red)` |
| `--danger` | `app.css` ×2, `CalendarItemCreateModal.tsx:91`, `VatSettingsCard.tsx:97`, `MarkUnavailableModal.tsx:30`, `RiderUploadModal.tsx:109` | literal `#EE5746` | `var(--brand-red)` |
| `--text-muted` | `app.css` ×3 | **no fallback given, so the declaration was invalid and the text inherited `--text`** | `var(--muted)` |
| `--radius-lg` | `marketing/styles/cookie-consent.css:24` | fell through to `24px` | literal kept, see *Missing tokens* |

Dead *fallbacks* on tokens that do exist were also removed (`var(--brand-gold, #ffc266)`,
`var(--ink-200, #e6d9cb)`, `var(--ink-100, #f5ede2)`, `var(--brand-red-glow, #ff7a68)` in
`cookie-consent.css`; `var(--ease-out, cubic-bezier(…))` ×2 in `app.css`) — a fallback
next to a live token can only drift away from it.

### 1b. Brand literals in CSS values → the primitives

`#EE5746` → `var(--brand-red)`, `#F4A046` → `var(--brand-amber)`, and the app's
signature `linear-gradient(135deg,#EE5746,#F4A046)` → the same gradient in tokens.
Applied at 30 sites across `eventUi.tsx`, `Events.tsx`, `Calendar.tsx`,
`NewEventWizard.tsx`, `EventExtraTabs.tsx`, `EventCrewPanel.tsx`,
`CalendarWeekGrid.tsx`, `CalendarMonthGrid.tsx`, `CalendarFilterChip.tsx`,
`CalendarDayAgenda.tsx`, `ExternalCalendarCard.tsx`, `EventScheduleCard.tsx`,
`RidersDocumentsCard.tsx`, `MyCalendarsCard.tsx`, `Integrations.tsx`,
`TeamInviteMemberModal.tsx`, `VenueNotesField.tsx`, `EventPublishPanel.tsx`,
`BudgetPlanner.tsx`, `HoldPlacement.tsx`.

Also tokenised:

- `rgba(238,87,70,.05)` (the calendar's "today" tint, duplicated in three files) →
  `color-mix(in srgb, var(--brand-red) 5%, transparent)`.
- `rgba(244,160,70,.12)` → `color-mix(… var(--brand-amber) 12% …)`.
- `rgba(10,6,4,.55)` (the create-event scrim) → `color-mix(… var(--ink-1000) 55% …)`.
- `#B8A99B` → `var(--ink-300)`; `#f5ede2` → `var(--text)`; `#5a483c` → `var(--dim)`;
  `#0a0604` → `var(--ink-1000)` (`app.css` sidebar).
- `rgba(255,233,184,.07)` ×2, `rgba(255,255,255,0.08)`, `rgba(255,255,255,0.1)`,
  `rgba(18,10,7,.97)`, `rgba(255,233,184,.14)`, `rgba(255,233,184,.08)` → the
  `--border` / `--border-strong` / `--surface` / `--shape-fill` roles.
- Four hand-written box-shadows (`0 2px 8px rgba(0,0,0,.18)`, `0 30px 80px rgba(0,0,0,.4)`,
  `0 18px 44px rgba(0,0,0,.28)`, `0 1px 2px rgba(0,0,0,0.08)`, `0 24px 60px -20px rgba(0,0,0,.7)`,
  `0 24px 50px -20px rgba(0,0,0,.85)`) → `var(--shadow)` / `var(--shadow-lg)`.

### 1c. Literals deliberately left as literals

`tokens.css` states outright: *"Status colors (success green, etc.) are
intentionally NOT tokens — they stay hardcoded literals in components and canvas
scenes. Do not 'improve' the values."* Left alone accordingly:

- **Status swatch maps** — `Events.tsx` `EV_META`, `Calendar.tsx` legend + `ROOM_SWATCHES`,
  `eventUi.tsx` `STAGE_DEFS`, `useTaskBoard.ts` columns, `EventExtraTabs.tsx` history-kind map.
- **Paired semantic tones** where one half has no token, so tokenising the other
  half would break the pair: `KpiRow.tsx` `TONE_COLOR` (green/red/amber),
  `Projections.tsx` `POSITIVE`/`NEGATIVE`, `BudgetPlanner.tsx` Revenue `#6FC97A` /
  Costs `#EE5746`, `Contacts.tsx` copy-confirm green, `EventHospitalityCard.tsx`.
- **Chart / avatar palettes** — `budgetPlannerView.ts`, `BudgetBreakEvenChart.tsx`
  (SVG `fill`/`stroke` attributes), `Team.tsx` `GROUP_COLORS`/`PROFILE_COLORS`,
  `Dashboard.tsx` `dot=` props.
- **Values consumed by JS, not CSS** — anything fed to `hexAlpha()`/`hexA()`, which
  parses `#RRGGBB` and cannot take a `var()`.
- **The logo** — `AppShell.tsx`'s inline SVG mark is a fixed asset, not themed chrome.
- **`lib/shareExport.ts`** — a standalone printable HTML document with its own
  `<style>`; the app's tokens do not exist in the exported file.

---

## Rule 2 — panels still filled

`--elevated` was still the background at **54 sites**. Each was classified and
re-pointed. Both replacement tokens are byte-identical to `--elevated` in **dark**,
so dark mode is visually unchanged; light mode is where the repair lands.

| Kind | → | Sites |
|---|---|---|
| **Small shape** (toggle/segment track, progress trough, stepper dot, count tile, pill, chip, badge, avatar placeholder) | `var(--shape-fill)` | 24 |
| **Region a user reads content in** (nested panel, list row, quoted message, figure block, banner, file preview) | `var(--card)` | 18 |
| **A control** (textarea, currency field, filter input, icon button) | `var(--control-surface)` + `var(--control-border)` | 6 |
| **Hover ground** | see Rule 5 | 6 |

The `--shape-fill` group is the one that mattered: in light mode those 24 shapes
were painting `#FFFFFF` on a `#FFFFFF` card and had **disappeared** — the segmented
toggles on Events / Calendar / Audience / Team, the Tasks group pills and count
tiles, every progress trough, the stepper dots, the wizard's step numerals, the
selected day in Requests, the notification unread tint.

Two further fills that were never `--elevated` but still painted a ground:
`marketing/styles/profile.css` `.pill` used `var(--border)` (a *rule* colour) as a
fill → `--shape-fill`; and `OnboardingFlow.tsx`'s progress trough used
`rgba(255,255,255,0.08)` → `--shape-fill`.

**Also deleted: ~100 lines of dead CSS.** The whole `.notifications*` block in
`apps/web/src/app.css` is unreferenced — `NotificationBell.module.css` replaced it
and no component uses any of those twelve class names (verified by grep, each = 0
references). It was the *only* place `--danger` and `--text-muted` appeared in CSS,
which is exactly why nobody had noticed they don't exist.

---

## Rule 3 — controls without the height token

`--control-height` was referenced in **two** files in `apps/web/src` before this
pass. Fixed:

- **`Calendar.tsx` `filterInputStyle()`** — padding, no `min-height`. Measured **34px**
  next to a 40px date field on the same toolbar row. Now 40.
- **`Calendar.tsx` `filterChipStyle()`** — the "Rooms" / "Status" menu triggers, which
  are a select by another name, measured **35px** on that same row. Now 40. The whole
  toolbar row is now 40/40/40/40/40 (measured live).
- **`NewEventWizard.tsx` `bigField`** — spread `fieldStyle` (which carries the token)
  then overrode `padding` to `11px 14px`: 11 + 11 + 18 + 2 = **42**, which *overshoots*
  the 40px floor, so the token never bound and every text field in the wizard sat 2px
  above the `Currency` select beside it. Trimmed to `10px 14px`; the step now measures
  40 across. (Same trade, same reason, as the note already in `availability.css`.)
- **`NewEventWizard.tsx`** — the two hand-rolled `€`-prefix currency fields had no
  height at all; given `min-height: var(--control-height)`.
- **`marketing/styles/event.css` `.field__control`** — the RSVP form was the
  availability form's twin and had drifted off every fix that page carries: no
  `min-height`, no `line-height`, `--border` instead of `--control-border`. Brought
  into line (padding 11→10 so the token binds).
- **`app.css` `.topbar__theme`** — `width: 40px; height: 40px` → the token.

---

## Rule 4 — fields that will not line up

**Found the same shape the marketing site had, on the public event page.**
`apps/marketing/src/styles/event.css` `.field` is `display: grid` and was **missing
`align-content: start`** — the fix `availability.css` already carries with a written
rationale. `event-rsvp.ts` builds `.rsvp__row` from `nameField` (no hint) beside
`emailField` (**with** a hint), which is precisely the pair that triggers it.

Measured live on `/event.html`, control `top` in px:

```
without align-content: start →  name 629, email 616   (13px drift)
with    align-content: start →  name 616, email 616
```

Fixed. `apps/web` does not have this shape: the design system's `TextField`/`Select`
wrapper is `display: block`, so a grid row of them cannot stretch the control.

---

## Rule 5 — hover filling a ground / hover that demotes

**Filling a ground.** Eight hovers painted `--elevated`, i.e. **nothing at all in
light mode**. `tokens.css` names "an option under the cursor" as exactly what
`--shape-fill` is for, and the design system's own `Select` uses it for option
hover, so menu rows / list rows / table rows follow that: `CalendarCreatePopover`,
`EventRowMenu`, `Team.tsx` row menu, `PerformerSearch` results,
`InvoiceLedgerTable` rows, `Events.tsx` list rows, `Dashboard.tsx`
`.dash-attn-row` / `.dash-recent-row`, `NotificationBell.module.css` `.rowLinked`.

**`MessageSurface.module.css` — the clearest §2 breach.** `.threadRow` already
carries a `1px solid transparent` border for exactly this purpose, yet hover
painted a `color-mix(--elevated)` ground and **selection** used `--elevated` +
`--border-strong` — so in light mode *neither* state showed. Now hover promotes
the row's own hairline to `--hover-border` and selection takes it the rest of the
way to `var(--brand-red)` over `--shape-fill`. Hover and selection no longer
collide, and both are legible in both themes (screenshot: `sweep-messages-*.png`).

**Hovers that demoted** (rest on the coral `--control-border`, hover to a neutral
brown — the control looks like it switched off when you approach it):

- `TimePickerControl.module.css` `.stepper:hover` `--border-strong` → `--hover-border`.
- `marketing` `.theme-toggle:hover` (three files) and `.request__cancel:hover` → `--hover-border`.

**Focus that demoted** — `marketing` `.field__control:focus-visible` set
`border-color: var(--border-strong)` on both the availability and event pages, so
landing in a field walked its edge *away* from the brand. Now `var(--brand-red)`,
per §2's "focus → full-strength `--brand-red`". (The `outline: 2px solid var(--focus)`
stays as the second, non-colour signal.)

**Hover indistinguishable from selection** — `availability.css`
`.dates__item--action:hover` and `[aria-pressed="true"]` both landed on
`var(--accent)`, border *and* text. Hover now stops one step short at
`--hover-border`; the pressed state keeps the accent.

---

## Rule 6 — raw transition literals

Every one is now a duration token, so `prefers-reduced-motion` reaches it. Was:
`.15s` ×5, `.16s` ×3, `0.15s ease` ×5, `.18s` ×4, `0.2s`/`.2s` ×6.

- paint-only (colour, border, background, a menu under its trigger) → `--duration-quick`
- something moves (lift, chevron rotate) → `--duration-base`
- **`NewEventWizard`'s `MiniToggle`** took `--duration-base` for *both* its track repaint
  and its knob travel, per §4's "when one control does both, the whole thing takes the
  movement duration so the parts land together".

Files: `InvoiceLedgerTable.tsx`, `NotificationBell.module.css`,
`TimePickerControl.module.css`, `NewEventWizard.tsx`, `DatePickerField.module.css`,
`TaskBoard.tsx`, `VenueNotesField.tsx`, `Dashboard.tsx`, `Events.tsx`,
`marketing/styles/nav.css`, `marketing/styles/availability.css`.

---

## Rule 7 — dead affordances

**Nothing found to report.** Swept three ways: every `<button>` whose opening tag
carries no `onClick`/`onMouseDown`/`type="submit"` (6 hits, all false positives —
the string `<button` inside a doc comment); every design-system control rendered
without a handler (9 hits, all false positives from generic type parameters); and
every "coming soon / stub / not wired / TODO" marker.

The markers that do exist are all **honest**: the topbar search is `disabled` and
its placeholder says "coming soon"; `ProFilingExportModal` labels its unbuilt half
"Coming later / Not available" and disables it; `RequestCard`'s draft-event pill and
`EventRowMenu`'s entries are `disabled={!handler}` and carry the refusal as visible
text; `EventCrewPanel` and `EventHospitalityCard` both carry comments explaining that
a card of dead fields was deliberately *not* built. This rule appears to have been
taken seriously already.

---

## Blocked — violations in files another agent holds

Read-only for this pass. Each is a real violation; routing needed.

| File | Line | Violation |
|---|---|---|
| `apps/web/src/components/EventDetailsTab.tsx` | 200 | `background: "var(--elevated)"` — a filled panel (Rule 2) |
| ″ | 164, 280, 495 | `iconColor="#EE5746"` ×2, `iconColor="#F4A046"` → `var(--brand-red)` / `var(--brand-amber)` |
| ″ | 662–663, 667 | the amber callout: `color-mix(… #F4A046 …)` ×2 and `color: "#c8842f"` |
| `apps/web/src/components/EventInlineField.module.css` | 106 | `.trigger:hover` fills a ground with `color-mix(… var(--elevated) 55% …)` — invisible in light mode, and Rule 5 wants the edge. The rule's *other* two signals (border-bottom → `--control-border`, label → `--text`) are correct and carry it; only the fill is wrong. |
| ″ | 280 | `color: #c8842f` (no token — see below) |
| `apps/web/src/components/EventInlineInformation.tsx` | 411–412, 416 | the same amber callout, third copy |
| `apps/web/src/components/ShareExportModal.tsx` | 376 | recipient chip `background: "var(--elevated)"` → `var(--shape-fill)` (it is a pill, a shape) |
| `apps/web/src/routes/ShareViewer.tsx` | 99 | Failed `pnpm biome check` (formatter, long `KeyValueRow` line) mid-sweep and was the only thing keeping the repo-wide gate red. Its owner fixed it before this pass finished — noted only so the transient red is accounted for. No style violations of its own. |

### `design-system/**` (out of territory, read-only)

The system tells components not to write literals while writing ~25 of them itself.
Not urgent — they are all the same two brand values — but they are why the app keeps
copying them:

- `#EE5746` at rest/focus/active in `Input`, `TextField`, `Select` (×2), `Card`,
  `Tabs` (×3), `SidebarItem` (×2), `Toast`, `SelectCard`, `Stepper` (×2), `ListRow`,
  `TodoItem`, `Toggle`, `ProgressBar`, `Chip`.
- `#fff` on a brand fill in `Tabs`, `SidebarItem`, `Toast`, `Stepper`, `Toggle`.
- `Modal.module.css` `.scrim { background: rgba(10, 6, 4, .6) }`.
- **`DataTable.module.css:42` `.clickable:hover { background: var(--hover-surface) }`** —
  `--hover-surface` is `transparent` in light, so **a clickable table row has no hover
  feedback at all in light mode**. The row has no border to promote either. Worth a
  decision: either give it `--shape-fill` (the "option under the cursor" reading this
  sweep applied to the app's own row hovers) or give the row an edge to promote.

---

## Missing tokens — literals with genuinely nowhere to go

Not invented. Each is used more than once, which is the argument for adding it.

| Value | Meaning | Sites |
|---|---|---|
| `#fff` | text/knob **on a brand fill** | ~16 in `apps/web/src` + 5 in the design system. There is no "on-brand" foreground token; `--paper` (`#FAF3E7`) is not white. |
| `#c8842f` / `#C97F2E` | amber text legible **on the amber wash** (`--brand-amber` itself fails contrast there) | `EventPublishPanel.tsx:249`, `BudgetPlanner.tsx:583`, `HoldPlacement.tsx:200`, + 2 blocked files |
| `#5aa568` | the same idea in green | `NewEventWizard.tsx:1192` |
| `#6FC97A` | success / revenue / positive | ~20 sites. `tokens.css` says status colours stay literals — but it is the single most-repeated literal in the app, so the decision is worth re-confirming rather than inherited. |
| `#140D09` | the top stop of the always-dark sidebar gradient | `app.css:41`. `--ink-1000` covers the bottom stop; there is no ramp entry between `--ink-950` and `--ink-1000`. |
| a radius scale | `--radius-lg` is referenced but undefined | `cookie-consent.css:24`; radii are hand-written everywhere (8/10/11/12/13/14/16/18/22/24). |
| a `--danger` role | error text | 6 sites now on `var(--brand-red)`. Note `#EE5746` on white is ~3.5:1 — **short of 4.5:1 for 12–13px error text**. `--accent` (light: `--brand-red-deep`) exists precisely for this and would be the right value. |

---

## Judged conformant — what a naive scan would flag

- **`eventUi.tsx` `fieldStyle`** looks like the "local `fieldStyle`" §6 forbids. It is
  the documented exception: a combobox wrapping a bare `<input>` cannot *be* a
  `TextField`, and it reads `--control-surface`, `--control-border`,
  `--control-height` and `--control-line-height` from the system, which is what §6
  asks of a component that cannot be composed. Its consumers (`EventVenuePicker`,
  `PerformerSearch`, `EventExtraTabs`, `NewEventWizard`) all inherit the height token.
- **`app.css` `.sidebar`'s `rgba(255, 233, 184, …)` pair.** These are *token
  definitions*, not values: the sidebar is ink-dark in both themes and pins the role
  tokens to their dark values so `[data-theme=light]` cannot flip the design system's
  `SidebarItem` labels dark-on-dark. There is no way to reference the dark values once
  light has overridden them.
- **`marketing/styles/nav.css` `visibility: hidden` + `transition: visibility`.**
  §4 forbids "`visibility: hidden` on an *entering* panel". `visibility` is a discrete
  property: it flips to `visible` immediately on open and only delays on close. The
  panel is clickable the instant it starts arriving, so motion never gates input here.
- **`TimePickerControl.module.css` `.box` at ~32px** rather than `--control-height`.
  §3's escape hatch is "if a control needs to be shorter it is a different control and
  it says so **by name**" — this one does, it lives inside a popover beside 26px
  steppers, and forcing 40px would resize that popover for no conformance gain.
  Its border was still moved to `--control-border` and its transitions to tokens.
- **The `--card`-on-`--card` nesting** this pass introduced (18 sites). In light both
  are `#FFFFFF`, so it is white-on-white separated by the border that was already
  there — §1 exactly. `Card.module.css` already drops the shadow between two white
  surfaces. In dark, `--card` is a translucent gradient, so a nested one darkens
  slightly and keeps the depth `--elevated` used to give.
- **`RiderUploadModal`'s `<input type="file">`** carries no height token: it is the
  browser's native file control, not a field the design system dresses.

---

## Known residue

**`input[type="date"]` is 42px, not 40.** Measured in the create-event wizard:
`min-height: 40px`, `line-height: 18px`, `padding: 10px` — but Chromium's date editor
ignores `line-height` and renders a ~20px line box, so `10 + 20 + 10 + 2 = 42`. No
component-level fix exists short of a hard `height`, which §3 forbids and which would
also break the deliberately-shorter inline editors (`EventInlineField`, currently held
by another agent). **This belongs in the design system's shared field CSS** — one
`height: var(--control-height)` on the date variant, decided once — and is the last
place where two controls on one row do not agree.
