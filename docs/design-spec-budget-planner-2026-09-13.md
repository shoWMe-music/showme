# Budget Planner — the measured spec, and what moved

**Phase 2 of the budget plan.** This is the build target for Phase 3, and the table
the final comparison is scored against.

Source: `Budget Planner.html`, attached by Ran to ClickUp
[123qy9rnwud](https://app.clickup.com/t/123qy9rnwud) on 2026-09-10. It supersedes
`docs/design-handoff-budget-planner.md`, which the current 975-line
`BudgetPlanner.tsx` was built from.

> **Every number below was read off the rendered page**, not off a screenshot and
> not off the source. The file is a self-contained bundle, so the prototype was
> served and its computed styles walked — which is why this document can state
> `14px` rather than "rounded corners". `claude-design`'s rule still holds for the
> `.dc.html` prototypes it was written for; this one can be measured because it
> runs standalone.

---

## The rule that governs the port

**Layout exactly. Colour and type from our tokens. Data from the real API.**

The prototype's `:root` is our design system — same token names, same values:

| | prototype | ours |
|---|---|---|
| `--font-display` | `"Clash Display", "Inter Tight", sans-serif` | identical |
| `--font-sans` / `--serif` / `--mono` | Inter Tight / Instrument Serif / JetBrains Mono | identical |
| `--bg` / `--surface` / `--elevated` | `#0A0604` / `#18100C` / `#221812` | `--ink-1000/900/800`, same hex |
| `--text` / `--dim` | `#F5EDE2` / `#5A483C` | `--ink-100` / `--ink-500`, same |
| `--border` | `rgba(255,233,184,.09)` | identical |
| `--accent` | `#FFC266` | `--brand-gold`, same |

**One exception, and copying it would be a regression.** The prototype's `--muted`
is `#8C7A6C`; ours is `#978578`. `tokens.css:29-39` records why: `#8C7A6C` on
`--ink-800` measures **4.24:1**, under the 4.5:1 that 13.5px body text needs, and
it was reported as *"dropdown text unreadable"* — on
[86cbcn1ue](https://app.clickup.com/t/86cbcn1ue), **by Ran**. We added `--ink-350`
at 4.92:1. Use ours.

**Demo data never ships.** Nils Frahm, Funkhaus, €92,160 are the prototype's
fixtures. Wire the real API; use an honest empty state where the data does not
exist yet.

**And do not port its logic.** Its break-even is the defect this session spent its
first half fixing (908 tickets where its own figures give 855), and its
`{{ }}` interpolation silently blanks any text inside an `<svg>`. Layout only.

---

## Measured spec

### Page

| | |
|---|---|
| Card | `14px` radius, `1px` border at `rgba(90,72,60,.14)`, white surface, no padding on the shell |
| Card width | full — **not** the two-column `1fr 1fr` the old handoff specifies |
| Title | `Budget Planner`, Clash Display **24px/600**, `-0.48px` tracking |

### Typography, by role

| Role | Face | Size | Weight | Tracking |
|---|---|---|---|---|
| Card heading (`Revenue`, `Costs`, `Results`) | Clash Display | 17px | 600 | normal |
| Section eyebrow (`OTHER REVENUE`) | JetBrains Mono | 10px | 600 | 1.4px |
| Sub-eyebrow (`TOTAL TICKETS REVENUE`) | JetBrains Mono | 9.5px | 600 | 1.235px |
| **Table column header** | JetBrains Mono | **9px** | **400** | 0.9px |
| KPI label | JetBrains Mono | 10px | 600 | 1.3px |

Column headers are the lightest type on the screen — 9px regular. They are meant
to recede; the values are the content.

### Controls

| | size | padding | radius | fill |
|---|---|---|---|---|
| Input | h `29px` | `6px 9px` | `9px` | `#FFF9EF` |
| Select | h `29px` | `6px 34px 6px 9px` | `9px` | `#FFF9EF` |
| `+ Add …` | h `30px` | `6px 12px` | `9px` | transparent, `rgba(90,72,60,.26)` border |

Inputs are **29px**, noticeably tighter than our current fields. This is most of
what "too spacious" meant in the meeting.

### The ticket table

```
grid-template-columns: 439px  96px  78px  308px  100px  34px
                       ─────  ────  ────  ─────  ─────  ────
                       type   price qty   collected-by total ×
row height 44px · gap 7px · padding 6px
```

`Collected by` is a **new column** and it is load-bearing: it is what makes the
bar the venue's and the merch the act's (decisions #23.1), which the engine now
implements.

### Card order, top to bottom

1. Title + estimate banner
2. Toolbar — Load Template · Save as Template · CSV · PDF · Share
3. **KPI strip — 5 tiles**: Total revenue · Ticket revenue · Total costs · Profit/loss · Break-even tickets
4. **Revenue** — ticket table → totals band → *How ticket revenue splits* → capacity → other-revenue table
5. **Costs** — production-split toggle → cost table → payment processing
6. **Revenue shares & deductions**
7. **Results** — 9 tiles (3×3) → break-even chart → two donuts
8. **PRO fee estimate** — full width

---

## What moved since `design-handoff-budget-planner.md`

This is the Phase 3 work-list. Everything not named here is already right.

### Structural

| | was | is |
|---|---|---|
| Revenue / Costs | two columns, `1fr 1fr` | **full-width, stacked** |
| Card radius | 16px | **14px** |
| KPI strip | 4 tiles | **5** (adds Ticket revenue) |
| Results grid | 7 tiles, 4 columns | **9 tiles, 3×3** (adds Ticket revenue, Tickets planned) |
| Revenue Sources / Cost Breakdown | horizontal bar lists | **donut charts with legend** |
| PRO card | half width beside an empty column | **full width** |

### New, and the reason each exists

- **Tables instead of label-and-field rows.** The old handoff describes "one row
  per tier: name input, price input, qty input"; the new design gives them
  top-level columns. *This is the meeting's headline request* — "a simplified
  table structure, remove excessive spacing".
- **`Collected by` on every revenue row.** The mechanism behind #23.1.
- **"How ticket revenue splits"** — a per-party bar showing each share with the
  deal-type badge and a plain-English basis line. **Derived from the deal, never
  editable** (#23.2: the ticket split must not get a second writable home).
- **Performer fee as a derived, read-only row** labelled *"Auto · From deal"*.
  Already built behind the screen — `useBudgetSeed` now derives it through the
  settlement engine (`a702629`, `ddc087b`).
- **Production-costs-split toggle** for co-promotions. Maps onto the existing
  `budget_lines.cost_split`.
- **Revenue shares card.** Backed by `budget_lines.revenue_shares`, shipped in
  `5f8c67c` with migration 0038.

### One naming correction to make while porting

Ran's card is titled **"Revenue shares & deductions"** and holds only revenue
shares; deductions already live in the Costs card as its `Settlement` column
("Operators carry it" / "Covered by Funkhaus"). decisions.md #23.2 settles this:
they are two mechanisms, and the conflation is what made the cost/deduction UI
confusing in the first place.

**Build the card as "Revenue shares".**

---

## How Phase 3 is scored

Not by eye. Serve the prototype, render our screen, walk both DOMs and diff the
computed styles element by element — a table of mismatches with numbers.

That gate exists because the eyeball version failed twice: six screens were built
as the wrong feature entirely from a written description, and a settlement screen
was reported as matching when the owner's reply was *"You think they look the
same? To me the prototype is very different."*


---

## Scored, 2026-09-14 — the measured after-state

Both pages served and their computed styles walked, per the gate above. Numbers
are `getComputedStyle` / `getBoundingClientRect` at a 1440px viewport.

| | prototype | ours, before | ours, after |
|---|---|---|---|
| Page title | Clash 24/600/-0.48 | ✓ | ✓ |
| Card heading | Clash 17/600 | ✓ | ✓ |
| Card radius | 14px | ✓ | ✓ |
| Column header | mono 9/400/0.9 | ✓ | ✓ |
| Section eyebrow | mono 10/600/1.4 | 11/400/0.88 | **10/600/1.4** |
| **Field height** | **29px** | 40.5px | **29px** |
| Field padding / radius / text | 6px 9px · 9px · 12.5 | 10px 15px · 12px · 13.5 | **matched** |
| Table row / header | 44 / 27 | 30 (+6 gap) / 16 | **42 / 25.9** |
| KPI tile padding | 10px 14px | 18px 20px | 10px 13px |
| KPI label | mono 10/600/1.3 | 11/400/1.32 | **matched** |
| KPI figure | **Inter Tight** 19/600 | Clash 21.8/600 | **matched** |
| Results tile padding | 9px 11px | 18px 20px | 10px 13px |
| Results figure | **Inter Tight** 15/600 | Clash **29.8**/600 | **matched** |
| Results / KPI grid | one slab, 1px rules | 9 cards, 14px gaps | **one slab, 1px rules** |

Page height fell from 4,016px to 3,777px on the same data.

### How the field density is implemented

`.density-compact` in `design-system/src/styles/tokens.css` remaps `--control-*`;
every field component reads those tokens, so one class moves all of them and a
component added later is dense for free. It is gated to `pointer: fine` — the
44px touch target is an accessibility floor and a dense table is not a reason to
drop through it.

Two pixels of the old 31px came from Chrome's UA `padding: 1px 2px` on a bare
`<input>`, and one more from a 16px chevron setting the Select's height in a
15px line box. Both are fixed at the component, not papered over with a height.

### Deliberate differences, and why each stays

- **Five cost columns to his three.** Ours carries `paid_by`, the bearing rule
  and the deal link (tickets W1/W2, 86cbaxvf5). His model has one Settlement
  select, so it needs one column.
- **"Revenue shares", not "Revenue shares & deductions"** — decisions.md #23.2.
- **A money scale on the break-even chart, which his does not draw.** His y-axis
  labels are `{{ }}` interpolations inside an `<svg>`, which Claude Design's
  `sc-interp` renders as a `<span>` in the SVG namespace — they have never
  appeared on screen. The intent is in his markup; only the rendering is missing.
- **Our `--muted`.** His `#8C7A6C` measures 4.24:1 on `--ink-800` and is the
  contrast failure Ran himself reported on `86cbcn1ue`.
- **Tile padding 10px 13px against his 10px 14px / 9px 11px.** One compact tile
  rather than two that differ by a pixel or two.


---

## Second pass, 2026-09-14 — the text diff

The first pass scored geometry and never compared the WORDS. Both pages' visible
text was extracted and diffed, which found nine renamed labels and five things
we simply did not have. All are now closed except the two at the bottom.

### Structure, which the geometry pass also missed

The prototype has **three** sections — Revenue, Costs, Results — and the third is
1,035px tall because it CONTAINS the chart, both donuts and the PRO estimate. We
had four sibling cards, which says these are four unrelated panels that happen to
be adjacent. They are not: each is the same arithmetic from a different angle.
`Break-even analysis` and `Where the money comes from and goes` are **eyebrows**
inside that card, not card headings — the chart is drawn bare while the donuts
and the PRO estimate keep their own borders.

### The tone vocabulary

| | prototype | ours, before |
|---|---|---|
| revenue | green `#6FC97A` | green |
| ticket revenue | blue `#6FA8E0` | blue |
| **cost** | **amber `#F4A046`** | **red** |
| profit / loss | green, by sign | green/red |
| **counts and rates** | **plain** | break-even was amber |

Red is reserved for a figure that is actually bad. A cost is not bad — it is what
a show costs — and painting it like a loss meant a profitable event showed two
red figures out of five. The nine Results figures were entirely untoned; they now
follow the same rule as the strip.

### Still different, and why — both are model, not markup

- **`Basis` on an other-revenue row is a word, not a select.** The prototype lets
  you switch Bar between "per guest" and flat. Ours cannot: `averageBarSpend` and
  `averageMerchSpend` are per-head by construction and other revenue is flat, so
  the basis is a fact about the row rather than a choice. Making it switchable is
  an engine change that moves settlement math, not a UI port.
- **A cost's name is not editable inline.** The prototype treats every cost as a
  free-text row. Ours are a fixed taxonomy (`STANDARD_COST_HEADINGS`), and the
  heading IS the identity that matches a stored line to its row — rename it and
  the row loses its line. The taxonomy is also what drives the "+ Production
  cost / + Staff cost" buttons and the seeding of the performer fee and venue
  cost from deals. Custom rows do carry their own names; they are edited in a
  modal rather than in place.

Two prototype affordances are covered elsewhere in our shell rather than missing:
its toolbar **Share** button (our event header has Share & Export) and its page
subtitle **"Nils Frahm · Funkhaus · Berlin"** (our event header carries the
lineup, venue and date directly above the tab).
