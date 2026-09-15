# The settlement design — where it lives, and where we deliberately differ

Ran sent **five files** on **2026-09-10** (ClickUp [123qy9rnwud](https://app.clickup.com/t/123qy9rnwud)).
Two of them landed in `~/Downloads`, which is not version controlled; the other three
were only ever attachments on the ticket. All of them now live in the repo:

| file | what it is | size |
|---|---|---|
| `claude-prototype/ran-2026-09-10/budget-planner.html` | the **rendered** Budget Planner prototype — serve it and read computed styles | 1.4 MB |
| `claude-prototype/ran-2026-09-10/deal-logic.html` | **"Budget Planner, Settlement & Deal Logic"** — a written spec, eight sections | 12 KB |
| `claude-prototype/ran-2026-09-10/settlement.html` | the **rendered Settlement prototype** — six tabs, curation, approvals | 1.1 MB |
| `claude-prototype/ran-2026-09-10/send-for-review-1.png`, `-2.png` | the **Send Settlement for Review** modal, both states | 160 KB |
| `claude-prototype/ran-2026-09-10/renders/` | full-page screenshots of every tab, taken 2026-09-15 | — |

The Budget Planner half is built and shipped — scoring in
[design-spec-budget-planner-2026-09-13.md](./design-spec-budget-planner-2026-09-13.md).
**The settlement half is not built**, and this file is what a settlements session
needs before it starts.

> **Correction, 2026-09-15 — there IS a rendered settlement prototype, and this
> file used to deny it.** `Settlement.html` (1.1 MB) was attached to ClickUp
> [123qy9rnwud](https://app.clickup.com/t/123qy9rnwud) in the same comment as the
> other two files, along with two screenshots of the **Send Settlement for Review**
> modal. Nobody had downloaded it, so a check of `~/Downloads` and of the repo both
> came back empty and the absence was written down as a fact. **The attachment list
> on the ticket is part of the ticket** — read it before concluding a design does
> not exist. All three files now live in `claude-prototype/ran-2026-09-10/`.
>
> The Settlements screen in the All View prototype
> (`claude-prototype/claude-download-2026-07-19/Prototype/shoWMe All View.dc.html`)
> is the older, list-level design and is still worth opening for the index screen.

```bash
cd claude-prototype/ran-2026-09-10 && python3 -m http.server 8903
# deal-logic.html is readable as text; budget-planner.html and settlement.html
# must be RENDERED — they are bundled runtime apps, and file:// is blocked.
# settlement.html opens on its Settlement tab; the other five are nav clicks,
# and "Viewing as" is a <select> that switches the page into a party's view.
```

---

## What the spec says about settlement

**§3 Waterfall order**

```
gross revenue      tickets + door + additional + custom revenue
− deductions       ticketing fees, tax, refunds, production, additional/custom costs
= net revenue
− venue rental     "taken off the top, before splits"
= adjusted net     "the pool the splits apply to"
→ performer entitlement   per deal type, guarantee as floor, plus bonus once its threshold is met
→ venue and promoter      their split percentages of the adjusted net
```

**§5 Visibility rules** — operators see everything; a performer sees own deal
terms and entitlement, ticket revenue, merch and bar shares *if in the deal*; a
venue sees own deal and rental, ticket and bar revenue. Curation is **per role
and per line, including custom lines**, and a hidden line is *absent* rather than
masked — "the existence of, say, a venue's own cost is not the performer's
business."

**§6 Approval and comments** — every line carries its own comment thread,
attributed with name, role and time. Settlements are **sent for review per
collaborator**, each receiving only their curated view, each recording its own
approval; a request for changes moves the settlement back to `comments_received`.

**§7** carries a reference `compute()` implementation, whose own comment reads
*"party splits are independent, promoter is NOT residual."*

---

## Where we already differ, and why — READ THIS BEFORE IMPLEMENTING §3 OR §7

Three of the spec's settlement rules were reviewed on 2026-09-13 and
**deliberately not adopted**. They are settled in [decisions.md](./decisions.md)
#23. Implementing the spec literally would undo that work.

> **Superseded in part, 2026-09-15.** The owner reviewed the two rows below —
> the door base and the off-the-top rental — and chose **the design's waterfall**.
> #23.1 and the off-the-top retirement are being reversed; see
> [plan-settlement-2026-09-15.md](./plan-settlement-2026-09-15.md) §1 D2 and
> Phase 0. The two rows are kept here because the reasoning that produced them is
> still the reasoning anyone will hit when they read `reconcile.ts`. The other two
> rows — #23.3 and the residual — **stand**.

| the spec says | we do | why |
|---|---|---|
| ~~door split is a % of **adjusted net** (§3)~~ **REVERSED 2026-09-15 — the design's rule wins** | ~~door split is a % of **gross ticket revenue**~~ | decisions.md **#23.1**. A performer's share of the door must not shrink because the operator entered another cost — the base is the door, and costs are a separate mechanism |
| ~~**venue rental off the top**, before splits (§3)~~ **REINSTATED 2026-09-15** | ~~off-the-top rentals **retired** in `reconcile.ts`~~ | a rental is a cost like any other, with a bearer. Off-the-top made it invisible in the cost breakdown while silently moving every split |
| bonus threshold measured against adjusted net (§3, implied) | threshold measures **gross revenue** | decisions.md **#23.3** — and the spec's own §7 code agrees: `if (totalRevenue >= d.bonusThreshold)`. The implication in the prose loses to the code beside it. **Stands after 2026-09-15.** |
| *"promoter is NOT residual"* (§7) | the operators **do** take the residual, divided by `operatorCostSplit` | `reconcile.ts` computes `residual = pool − dealBaseSum − slicesOffPooledRevenue`. `operatorResidualShare` is now set from the shared budget's planning assumptions — before 2026-09-14 nothing set it and every co-promotion split the remainder equally |

**The deductions-vs-revenue-share distinction (#23.2) is also ours, not the
spec's**: a deduction is a cost somebody bears and changes the totals; a revenue
share moves money between parties and changes nobody's total. The spec's §3 folds
both into "deductions".

## What the RENDERED settlement prototype shows

Screenshots of every tab are in `claude-prototype/ran-2026-09-10/renders/`. Read
those, not this list — this is only an index so you know what to look for.

**One page, six tabs**: Overview · Deal structure · Financials · Settlement ·
Collaborators · Payout. Header is `SETTLEMENT` eyebrow, `Performer / Venue` title,
`venue · city · date`, and on the right a status pill, a currency select and
**Report to PRO**.

| tab | what is on it |
|---|---|
| **Overview** | *Event details* (id, performer, venue, operator, ticketing, capacity); *Financial overview* — the five-row waterfall, each row captioned (`paid off the top`, `what percentages divide`); *Total settlement* with a `balances ✓` chip, a stacked proportion bar and entitlement-by-party with percentages |
| **Deal structure** | *The deal* — one sentence stating which arm won and the arithmetic, the same proportion bar, then a grid: deal type, artist guarantee, revenue split (A/P/V), production cost split, venue rental. Then *Ticket revenue split* — "box office only, before costs and rental" |
| **Financials** | *How do you want to enter financials?* — **Start from Budget Planner** (recommended) vs **Start fresh · manual entry**; *Ticket sales* with **Sync from Ticketing Company**, tier rows (price / sold / gross) and a warning when the tiers and the gross ticket figure disagree, offering **Use planner**; *Planned vs actual*; *Revenue & deductions* — every line editable, `+ Add revenue line` / `+ Add cost line` / `+ Add deduction` |
| **Settlement** | the 7-step stepper (Open → Pending review → Comments received → Revised → Finalized → Partly paid → Paid); a **VIEWING AS** card whose select switches the whole page into a party's view; Add revision / Mark finalized / Flag dispute; **Curate what each collaborator sees**; read-only *Revenue & deductions* with a comment bubble per line; a card per party stating the rule that fired; *Comments*; *Revision history*; *Approval Status* (`0/3`); *Total Payouts* |
| **Collaborators** | *Each party's position* (bar per party) and *Send settlement per collaborator* with a per-row **Send** and a sent/not-sent stamp |
| **Payout** | locked until finalized — a lock icon, "This settlement is Pending review", disabled **Process Payout** |

**The curation control** is a card with a tab per role (Performer / Venue /
Promoter) and two lists — `✓ INCLUDED IN THEIR SETTLEMENT` and
`⊘ HIDDEN FROM THEM` — chips moving between them by click or drag, under the
sentence *"Only you see every figure by default."*

**The send modal** (`send-for-review-*.png`): **All collaborators** / **One by
one**, a recipient select when one-by-one, and a **Full settlement access** toggle
— *"Let recipients see all parties' financial details"*, default off.

### Three things to notice before building from it

1. **The prototype contradicts itself on the door base.** Deal structure computes
   `70% of €76,800 = €53,760` — a share of **ticket revenue**, which is our
   #23.1. Overview and Settlement compute `70% of €72,500 = €50,750` — a share of
   **adjusted net**, which is the rule we rejected. Both figures are on screen at
   once, in the same document, for the same deal. The layout is the deliverable
   here; the arithmetic is settled in decisions.md #23.
2. **"Full settlement access" is a direct conflict with story.md:44.** That line
   says a performer sees "only their own slice — never the event budget/pool …
   *even if an operator wanted to show them*", and `POOL_CAPABILITIES` in
   `packages/auth` is that sentence as code. The toggle is exactly an operator
   wanting to show them. It cannot be built without changing the rule, and the
   rule is the product owner's.
3. **The collaborator view in the prototype leaks.** Switch "Viewing as" to
   Performer: the curation correctly drops six of the eight lines, and then the
   page still shows *Total revenue*, *Total deductions*, *Venue rental*,
   *Adjusted net* and a *Total Payouts* card naming the venue's payout. Curation
   per line does not by itself make a view safe — the totals are derived from the
   lines it hid.

## What is genuinely unbuilt

- **§5 visibility curation** — per-role, per-line. Nothing like it exists. The
  `serialize(capabilities)` layer hides fields by capability, not per line, and
  there is no per-line visibility column anywhere.
- **§6 per-collaborator review** — per-line comments DO exist (migration `0036`,
  "a comment can name the figure it is about"). Sending a **curated** settlement
  per collaborator, each with its own approval and a `comments_received` return
  path, does not.
- **§4's hover readout** on the break-even chart — our chart plots both lines,
  shades profit and loss between them and marks the crossing, but has no hover.
  Note the spec's own §4 describes the cost line as stepping up under guarantee
  vs door, which is the defect we fixed on 2026-09-13: the prototype's *code*
  treated the performer fee as fixed and reported 908 tickets where its own
  figures give 855.

## And the thing to check first

**Production holds zero `settlement_lines`** (read 2026-09-14). Everything known
about this surface comes from `settlement.test.ts`, `settlement-seed.test.ts` and
the seeded e2e event — see
[handoff-2026-09-14-settlement-surface.md](./handoff-2026-09-14-settlement-surface.md).
