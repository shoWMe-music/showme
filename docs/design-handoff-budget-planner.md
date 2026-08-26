# Budget Planner — design handoff (transcribed)

**Source:** Claude Design project `004a889b-f032-4801-8c67-df58241e9227`,
file `Prototype/shoWMe Budget Planner Handoff.dc.html` (v1 · August 2026).
Figures reference `Prototype/assets/budget-{head,results,revcost,bars,pro,chart}.png`.

This is transcribed from the designer's own handoff document, not derived by
reading the prototype. It is quoted closely because CLAUDE.md's rule — build from
the rendered prototype, never from a second-hand description — exists precisely
because a paraphrase drifted once already. Where this document and the July
prototype copy in `claude-prototype/` disagree, **this is newer**.

The handoff also exists for the whole logged-in app:
`Prototype/shoWMe Logged-in UI Handoff.dc.html`, still unread at time of writing.

---

## Scope, in the designer's words

> The planner is a *forecast*, not a ledger. It never moves money and never feeds
> Settlement — Settlement reconciles actuals from its own inputs.

The permanent banner is load-bearing, not decoration: *"This is an estimate only
and should be reviewed before final decisions."*

Visibility: **the whole screen is operator-only.** Performers and crew never see a
budget, not even inside a shared event — "there is no redacted variant to design".

---

## 1 · The input object

One object per event. **Nothing here is computed; nothing computed is persisted.**

| Field | Shape | Seeded from |
|---|---|---|
| `ticketTypes[]` | `{ name, price, qty }` — addable, removable, **never empty** (removing the last row re-seeds a blank one) | one "General Admission" row at **80% of capacity** |
| `capacity` | int — drives bar revenue and per-guest metrics | **venue capacity** |
| `avgBar` | money — average bar / F&B spend per guest | 0 |
| `otherRev` | money — merch, sponsorship, grants | 0 |
| `performerFee, production, staff, marketing, venueCost, otherCost` | money ×6 — **fixed labels, fixed order** | **deal guarantee → performerFee; venue rental → venueCost; event production cost → production** |
| `ppFeePct, ppFeeFlat` | percent of ticket revenue + flat per ticket | **1.5% + 0** |
| `customRev[], customCost[]` | `{ name, type, amount }` — operator-defined, **added through a small modal**, removable inline | empty |

Every numeric field passes through a coerce-to-number helper: blank, non-numeric
and `NaN` all read as **0**, so a half-typed field never breaks the sheet. (This
is about *parsing*, not display — an untouched field still renders empty.)

---

## 2 · The math

One pure function, no side effects, no persistence, no async.

```
ticketRev        ≔ Σ (price × qty)                       over ticketTypes
soldTickets      ≔ Σ qty                                 over ticketTypes
barRev           ≔ avgBar × capacity
customRevTotal   ≔ Σ amount                              over customRev
customCostTotal  ≔ Σ amount                              over customCost

totalRev         ≔ ticketRev + barRev + otherRev + customRevTotal

ppFees           ≔ ticketRev × ppFeePct/100 + ppFeeFlat × soldTickets
fixedCost        ≔ performerFee + production + staff + marketing
                 + venueCost + otherCost + customCostTotal
totalCost        ≔ fixedCost + ppFees

profit           ≔ totalRev − totalCost
margin           ≔ totalRev > 0 ? profit / totalRev × 100 : 0

avgTicket        ≔ soldTickets > 0 ? ticketRev / soldTickets : 0
breakEven        ≔ avgTicket > 0
                 ? ceil((totalCost − barRev − otherRev) / avgTicket)
                 : 0                                     clamped to ≥ 0

revPerGuest      ≔ totalRev  / max(capacity, 1)
costPerGuest     ≔ totalCost / max(capacity, 1)
```

Three choices the handoff flags as deliberate, and asks us to confirm:

1. **Break-even nets non-ticket revenue off cost** rather than treating it as a
   second revenue line — bar and other revenue reduce the tickets you must sell,
   they don't scale with them.
2. **Bar revenue is modelled off capacity, not tickets sold**, so it does not move
   with attendance. "A sold-tickets basis would be the more honest forecast."
3. **Custom revenue is excluded from break-even** — the handoff calls this
   "an inconsistency, not a decision", i.e. it wants fixing.

---

## 3 · Screen layout

All cards `16px` radius on `--card`, one hairline border, one soft shadow,
`16px` gap between blocks.

1. **Estimate banner** — accent-tinted strip, info glyph, 12.5px muted text.
2. **Action row** — Load Template · Save as Template · CSV · PDF · Share.
   Outlined 9px-radius buttons, 12.5px. ***All five are stubs in the prototype.***
3. **KPI strip** — 4 equal columns, each tinted at 10% of its own hue: Total
   Revenue (green), Total Costs (red), Profit / Loss (green or red **by sign**,
   signed format), Break-even Tickets (amber). Value 24px, display weight 600.
4. **Revenue / Costs** — two columns `1fr 1fr`, top-aligned. Left card headed
   green, right headed red.
5. **Results** — full-width card, **4-column grid of 7 flat inset tiles** (so the
   last row is short by design): total revenue, total costs, profit/loss,
   break-even ticket count, profit margin % (1 decimal), revenue per guest,
   cost per guest.
6. **Break-even Analysis** — full-width chart card.
7. **Revenue Sources / Cost Breakdown** — two columns of horizontal bars.
8. **PRO fee estimate** — **half-width card paired with an empty column**, 28px
   figure, "Estimate only" pill, caption "≈ 6% of ticket revenue".

### Revenue card

Mono uppercase eyebrow "Ticket revenue", then one row per tier: name input
(flex), € price input (92px, right-aligned mono), qty input (74px, right-aligned
mono), trash button — background-free, border-free, muted glyph. A hairline
totals row shows **Total ticket revenue** in green mono. Below it a dashed
"+ Add ticket type", then three label-and-field rows (Capacity, Average bar spend
per guest, Other revenue) with a hairline **Bar revenue** readout *between the
second and third*. Custom revenue lines render as the same label/field row **plus
a type pill and an × remove**; a dashed "+ Add Field" closes the card.

### Costs card

Six identical label-and-€-field rows in fixed order (Performer fee, Production,
Staff, Marketing, Venue, Other), fields 140px. Then a hairline-separated
**Payment processing fees** group: a % field, a "+", a € field, and the caption
"/ ticket". Custom cost lines and the dashed "+ Add Field" follow.

### Bar lists

Each row is a label, a mono `amount · pct` pair, and a 7px pill track.
**The percentage is share of total; the bar width is share of the largest line** —
so the biggest line always fills the track. **Zero-value lines are dropped
entirely**; when nothing remains the card shows a centred "No revenue data yet" /
"No cost data yet". Revenue slices: ticket sales, bar / F&B, other. Cost slices:
the six fixed fields plus **Processing**, which appears here despite having no
input row of its own.

---

## 4 · Break-even chart

A **460×180 SVG stretched to full width** (`preserveAspectRatio="none"`, 190px
tall), 8px side and 10px vertical padding. X is tickets sold, 0 → capacity;
Y is money, 0 → **110%** of the greater of revenue-at-capacity and total cost.

- **Revenue** — solid 2.5px green line from `(0, nonTicketRev)` to
  `(cap, avgTicket×cap + nonTicketRev)`, where `nonTicketRev = barRev + otherRev`.
- **Total cost** — flat 2px red dashed line (`5 4`) at `totalCost`.
- **Crossing** — `(totalCost − nonTicketRev) / avgTicket`, clamped to `[0, cap]`.
  Vertical hairline plus a 4.5px amber dot ringed in the card colour; the green
  area left of it is filled at 12%.
- **Axis strip** below: `0` · amber "Break-even ≈ N tickets" · "N cap", then a
  two-swatch legend.

Fallbacks: capacity falls back to sold tickets, then to **1000**; average ticket
price falls back to **the first tier's price** when nothing is sold. Non-finite
results resolve to 0.

---

## 5 · Tokens

No new tokens. Shell set (`--card --elevated --border --border-strong --text
--muted --dim --shadow --accent`) plus fixed semantic hues that **do not flip with
the theme**:

```
#6FC97A revenue / positive   #EE5746 cost / negative   #F4A046 break-even & bar
#6FA8E0 other   #B58BE0 marketing   #8C7A6C other cost   #E6D9CB processing
```

**Numbers are always mono**, right-aligned in inputs and in every readout. Money
renders as `€` + thousands-grouped integer — **rounded, never with decimals**;
profit/loss uses a signed variant with the minus **before** the symbol. Inputs are
9px radius on `--elevated`, 13px text, no focus ring beyond the border.

---

## 6 · Mapping onto the Postgres model

| Prototype | Becomes |
|---|---|
| one budget per event | `budgets(scope shared\|private, owner_profile_id)` — co-operators share one, each operator may keep a private one |
| ticket tiers, bar, other, custom revenue | `budget_lines(kind='revenue', collected_by)` |
| six fixed cost fields + custom costs | `budget_lines(kind='cost', paid_by, payee_participant_id, cost_split, deal_id)` — labels stop being an enum |
| **performer fee as a cost field** | **a deal *entitlement*, not a budget line** — assign the line to the deal via `deal_id` so it is never double-counted |
| everything in € | per-line currency, converted to `events.base_currency` at a locked FX rate before summing |
| "profit" | the operator's **residual** in settlement (pool − Σ other entitlements). The planner keeps calling it profit; Settlement owns the real figure |
| Load / Save Template | `templates(category='budget', payload jsonb)`, profile-scoped |

---

## 7 · Open decisions (the designer's, still open)

1. **Is the PRO estimate a cost?** Today it is a 6%-of-ticket-revenue display
   figure excluded from total costs — so profit ignores a real expense. Either
   fold it in as a cost line or keep it advisory and say so on the card.
2. **Does bar revenue scale with attendance?** Capacity basis overstates it for
   any show that doesn't sell out. Recommendation: switch to sold tickets, keep
   capacity for the per-guest metrics.
3. **Forecast vs actuals.** Nothing carries a planned figure into Settlement.
   Decide whether the planner seeds settlement lines, sits beside them as a
   variance column, or stays fully separate.
4. **Fixed cost fields, or free lines?** The schema wants arbitrary labelled
   lines; the six fixed rows are what make the sheet fast to fill. Likely answer:
   keep the six as a default template, everything else a line.
5. **Rounding.** Display rounds to whole units per figure, so column sums can be a
   unit off. Store minor units, round only at render.
