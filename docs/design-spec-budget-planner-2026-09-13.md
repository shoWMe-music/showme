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
