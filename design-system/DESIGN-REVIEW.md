# shoWMe — design-logic review

A review of the **design** pulled from the Claude Design project (`004a889b…`):
the `shoWMe Design System` catalog, the shared `_work/theme.css` + `head-style.css`
tokens, and the four persona prototypes (Operator/All View, Performer, Crew,
Agent). Findings are checked against the product's own rules in
`docs/design-brief.md`, `docs/story.md`, and `docs/decisions.md` (#4, #14).

Each finding notes **severity**, the **evidence**, and whether this library
**already fixes it** or it needs a **product/design decision**.

Legend: 🔴 critical · 🟠 high · 🟡 medium · ⚪ low · ✅ fixed here · ⚠️ needs decision

| # | Finding | Severity | Status |
|---|---|---|---|
| A1 | Persona prototypes don't enforce the visibility **ceiling** | 🔴 | ⚠️ product |
| A2 | Agent view exceeds the represented-performer slice | 🟠 | ⚠️ product |
| A3 | Prototype asserts commission privacy while exposing event financials | 🟡 | ⚠️ product |
| B1 | Components hardcode hex → **light theme doesn't actually invert** | 🟠 | ✅ |
| B2 | Status hues collide with accent/muted meaning | 🟡 | ✅ partial + ⚠️ |
| B3 | Pale statuses fail contrast on light tint | 🟡 | ✅ |
| C1 | No visible focus states (token exists, unused) | 🟡 | ✅ |
| C2 | Status encoded by **color only** | 🟡 | ⚠️ |
| D1 | Two divergent token vocabularies (theme.css vs head-style.css) | 🟡 | ✅ unified |
| D2 | Documented radius scale ≠ values components use | ⚪ | ✅ |
| D3 | Avatar shape convention unstated (square vs circle) | ⚪ | ✅ prop |
| D4 | No generic success/warn/danger/info semantics | ⚪ | ⚠️ |
| D5 | Toast "Undo" uses destructive red | ⚪ | ⚠️ |

---

## A. Authorization & visibility — the product-critical ones

The whole product is *"you see only your slice"* (`design-brief.md` §3,
`story.md`). These findings are where the **design contradicts that rule**, so
they matter more than any visual nit.

### A1 🔴 The persona prototypes don't enforce the visibility ceiling
**Evidence.** The operator-only surfaces **Budget Planner**, **Total ticket
revenue**, **Top venues by revenue**, and **Process Payouts** appear with
*identical occurrence counts in all four persona files* — Operator, Performer,
Crew, **and** Agent. They were cloned from the operator app and the per-role
redaction was never applied.

**Why it's a flaw.** `design-brief.md` §3 makes the ceiling inviolable:
> Arm's-length parties (performer, rental venue, crew) can **never** be shown
> the budget/pool or other parties' financials — even if the operator wanted to.
> **No affordance should exist to expose it.**

`story.md` is even blunter: a performer sees their slice "never the event
budget/pool… even if an operator *wanted* to show them (an inviolable ceiling)."
A Performer prototype that renders a Budget Planner and total ticket revenue, and
a Crew ("schedule-only") prototype that does the same, directly violate the one
rule the product is built around.

**Risk.** These files are the **spec for the design pass and the build**. If they
show a performer the budget, whoever implements the performer screens will build
the leak. This is exactly the class of bug the PLAN.md authorization engine
exists to prevent — surfacing it in a mockup normalizes it.

**Recommendation (⚠️ product).** Redesign each non-operator persona's screens as a
**redacted view**, not a reskin of the operator app: remove Budget Planner,
pool/revenue analytics, and all-party payouts from Performer/Crew/Agent; keep
only floor + own-slice surfaces (own deal, own settlement, schedule, riders).
Treat the operator "All View" as the only full-financial persona.

### A2 🟠 The Agent view exceeds the represented-performer's slice
**Evidence.** The Agent prototype shows Budget Planner, ticket revenue, **Venue
Specs**, and **Top venues by revenue** analytics.

**Why it's a flaw.** Per `decisions.md` #14 and `design-brief.md` §3, an agent
acts *through* the performer: they see and edit the **performer's own** deal,
settlement, and schedule for in-region events, plus their **own** roster and
**private** commission. The scope ceiling is explicit: "agent controls in-region
events/deals/approvals only — never the performer's profile identity, billing, or
out-of-region events," and the operator's budget/pool is never a performer-side
surface. Event ticket revenue, venue financials, and cross-venue revenue
analytics are **operator** data the agent inherits no path to.

**Recommendation (⚠️ product).** The agent's financial surface is: (a) each
represented performer's **own settlement slice**, and (b) the **private
representation/commission statement**. Drop event-pool and venue-financial
screens from the agent shell.

### A3 🟡 The prototype states the privacy model while breaking it
**Evidence.** The Agent file carries the correct principle verbatim —
*"Commission is private between you and each performer — operators never see your
cut"* — on the same screens that render operator-grade event financials.

**Why it's a flaw.** It's internally contradictory: the copy teaches the
visibility model while the chrome violates it (A1/A2). A reviewer reading the
mock will trust the copy and miss the leak.

**Recommendation.** Once A1/A2 are fixed this resolves; keep the privacy note.

---

## B. Theming & tokens

### B1 🟠 Components hardcode hex → the light theme doesn't actually invert
**Evidence.** `theme.css` defines a complete **semantic** token set for both
`:root` (dark) and `[data-theme="light"]` (`--bg`, `--surface`, `--text`,
`--muted`, `--accent`, `--border`…). But the catalog components and every
prototype paint with **raw hex inline** — `color:#F5EDE2`, `#8C7A6C`,
`#FFC266`, `border:1px solid rgba(255,233,184,.09)` — not the tokens.

**Why it's a flaw.** The catalog claims *"ships dark by default and inverts
cleanly to light — the same tokens, remapped."* As authored it does **not**
invert: setting `data-theme="light"` remaps the variables, but since components
don't read them, text stays cream-on-light, borders keep their dark-mode alpha,
and surfaces stay dark. The theme system exists in the tokens and is unused by
the UI.

**✅ Fixed here.** Every component in this library paints exclusively via
semantic tokens (`var(--text)`, `var(--surface)`, `var(--accent)`,
`var(--status-*)`), so the toolbar dark/light toggle genuinely restyles them.

### B2 🟡 Status hues collide with accent and muted meaning
**Evidence.** From the Status palette: **On hold** `#FFC266` **is the accent/gold**;
**Pending** `#F4A046` is the Amber brand hue **and** the "Unverified" badge color;
**Draft** `#8C7A6C` **is `--muted`** (ordinary secondary text).

**Why it's a flaw.** A status system should be distinguishable from decorative
accent and from plain text. As-is, "on hold" is indistinguishable from any gold
accent, "pending" from "unverified," and a "draft" dot from ordinary muted UI.
Only Suggested (purple) and Task (blue) are collision-free.

**Status.** ✅ Promoted to real `--status-*` tokens here (so the collision is at
least *named* and centrally changeable). ⚠️ The underlying hue reuse is a
**design decision** — recommend shifting Hold off the accent gold (e.g. a
distinct ochre) and Draft off `--muted` (e.g. a desaturated slate) so state ≠
decoration.

### B3 🟡 Pale statuses fail contrast as text on a light tint
**Evidence.** Gold `#FFC266`, Cream, Concluded `#B8A99B`, Draft `#8C7A6C` used as
**text/dot color on a light tinted chip** fall below WCAG AA on the light `--bg`.

**✅ Fixed here.** Each status exposes a `--status-*-on` variant; in light mode
these darken (e.g. hold → `#8A5A12`, confirmed → `#2F7D3A`) so chip text clears
AA. Dark mode keeps the vivid hue.

---

## C. Accessibility

### C1 🟡 No visible focus state (the token exists, unused)
**Evidence.** `theme.css` defines `--focus`, but catalog buttons/chips/inputs
set only `cursor:pointer` — no `:focus-visible` ring. Keyboard users get no
indicator.

**✅ Fixed here.** Button, Chip, Input, SidebarItem, Toast action, and Modal
close all render a `0 0 0 3px var(--focus)` ring on `:focus-visible`.

### C2 🟡 Status is encoded by color alone
**Evidence.** Calendar cells, badges and list rows distinguish
confirmed/hold/pending/cancelled purely by dot/pill **hue** — which B2 shows are
already close to each other and to accent.

**Why it's a flaw.** ~8% of men can't reliably separate the green/amber/gold
cluster; combined with B2 this makes state genuinely ambiguous.

**Recommendation (⚠️).** Pair the hue with a text label (the `Badge` already
supports this) or a per-status glyph/shape on dense surfaces like the calendar.

---

## D. System consistency & hygiene

### D1 🟡 Two divergent token vocabularies
**Evidence.** `_work/theme.css` (the app: semantic `--bg/--surface/--accent`,
dark+light) and `_work/head-style.css` (the landing: `--ink-1000…--ink-50`,
`--brand-*`, `--radius-*`) are **different token systems**, with drift on the
same concept — e.g. light bg `#FBF6EE` (theme) vs `--ink-50 #FBF6EF`
(head-style); paper `#FAF3E7`. The product and the marketing site speak
different token languages.

**✅ Unified here** into one `tokens.css` (brand + ink ramp + semantic + status),
with the app's semantic layer as the source of truth. Recommend the landing page
adopt the same file.

### D2 ⚪ Documented radius scale ≠ what components use
**Evidence.** Catalog documents radius `sm/md/lg/xl = 8/14/24/40`, but components
use ad-hoc `9/10/11/12px`. The published scale isn't the one in use.
**✅** Library exposes `--radius-*` and uses them; component-local values are
deliberate (pills at 999px, inputs at 12px) and documented.

### D3 ⚪ Avatar shape convention is unstated
**Evidence.** Avatars are rounded-squares in the catalog/contact cards but a
**circle** for the signed-in user chip — no stated rule.
**✅** Encoded as a `shape` prop; recommended convention documented (square =
entity/brand, circle = person/user).

### D4 ⚪ No generic success / warning / danger / info semantics
**Evidence.** The palette is event-domain (confirmed/pending/hold…). There's no
neutral semantic layer for form validation, destructive confirms, or system
toasts.
**Recommendation (⚠️).** Alias them onto the status hues: confirmed→success,
cancelled→danger, pending→warning, task→info — so non-event UI has a vocabulary.

### D5 ⚪ Toast "Undo" uses destructive red
**Evidence.** The toast action button is always brand red; the sample action is
"Undo" — a *safe* revert that reads as destructive.
**Recommendation (⚠️).** Use red only for destructive actions; neutral/secondary
for reverts. (The `Toast` here keeps the source styling for fidelity; flagging
the pattern.)

---

## What's good (worth keeping)

- **Strong, coherent brand voice.** The warm near-black + stage-lit red/gold with
  four purposeful typefaces (display / serif accent / sans / mono) is distinctive
  and internally consistent across all five documents.
- **Mono for figures/IBANs/labels** is exactly right for a settlement product —
  tabular money and bank details read unambiguously.
- **The status *set* is well-chosen** (event lifecycle + task): the problem is hue
  assignment (B2), not the taxonomy.
- **Dark-first with a real light mapping** is the right call for a low-light,
  back-of-house events tool — it just needs to be wired to components (B1).
- **Collapsible icon rail** with `title` tooltips is a sound information-density
  choice for the operator's dense app.

## Bottom line

The **visual language is strong and ready to build on** — this library captures
it faithfully and fixes the *mechanical* gaps (theming wired to tokens, focus
rings, light-mode contrast, unified tokens). The **material risk is A1/A2**: the
persona prototypes reproduce operator financials for roles that must never see
them, contradicting the product's defining rule. That's a **product/design**
correction (redact each persona to its slice), not something a component library
can fix — and it should be resolved before these mocks drive the build.
