# The settlement design — where it lives, and where we deliberately differ

Ran sent two documents on **2026-09-10** (ClickUp [123qy9rnwud](https://app.clickup.com/t/123qy9rnwud)).
They arrived in `~/Downloads`, which is not version controlled, so they now live in
the repo:

| file | what it is | size |
|---|---|---|
| `claude-prototype/ran-2026-09-10/budget-planner.html` | the **rendered** Budget Planner prototype — serve it and read computed styles | 1.4 MB |
| `claude-prototype/ran-2026-09-10/deal-logic.html` | **"Budget Planner, Settlement & Deal Logic"** — a written spec, eight sections | 12 KB |

The Budget Planner half is built and shipped — scoring in
[design-spec-budget-planner-2026-09-13.md](./design-spec-budget-planner-2026-09-13.md).
**The settlement half is not built**, and this file is what a settlements session
needs before it starts.

> **There is no separate rendered settlement prototype.** An earlier note in this
> repo said "`Settlement.html` has never been rendered"; there is no such file.
> What exists is this spec's settlement sections plus the **Settlements screen in
> the All View prototype** (`claude-prototype/claude-download-2026-07-19/Prototype/shoWMe All View.dc.html`),
> which the `claude-design` skill explains how to open. Render that before
> scoping a screen.

```bash
cd claude-prototype/ran-2026-09-10 && python3 -m http.server 8903
# deal-logic.html is readable as text; budget-planner.html must be rendered
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

| the spec says | we do | why |
|---|---|---|
| door split is a % of **adjusted net** (§3) | door split is a % of **gross ticket revenue** | decisions.md **#23.1**. A performer's share of the door must not shrink because the operator entered another cost — the base is the door, and costs are a separate mechanism |
| **venue rental off the top**, before splits (§3) | off-the-top rentals **retired** in `reconcile.ts` | a rental is a cost like any other, with a bearer. Off-the-top made it invisible in the cost breakdown while silently moving every split |
| bonus threshold measured against adjusted net (§3, implied) | threshold measures **gross revenue** | decisions.md **#23.3** |
| *"promoter is NOT residual"* (§7) | the operators **do** take the residual, divided by `operatorCostSplit` | `reconcile.ts` computes `residual = pool − dealBaseSum − slicesOffPooledRevenue`. `operatorResidualShare` is now set from the shared budget's planning assumptions — before 2026-09-14 nothing set it and every co-promotion split the remainder equally |

**The deductions-vs-revenue-share distinction (#23.2) is also ours, not the
spec's**: a deduction is a cost somebody bears and changes the totals; a revenue
share moves money between parties and changes nobody's total. The spec's §3 folds
both into "deductions".

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
