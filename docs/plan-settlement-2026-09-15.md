# Plan — building the settlement surface from Ran's 2026-09-10 design

Written 2026-09-15, after rendering the design rather than reading about it.
Ground truth: `claude-prototype/ran-2026-09-10/settlement.html` and the tab
screenshots in `renders/`. What the design says, and the three places it
disagrees with itself or with us, is in
[design-settlement-2026-09-10.md](./design-settlement-2026-09-10.md).

## 0. What changed today

`Settlement.html` **exists**. It was attached to ClickUp `123qy9rnwud` alongside
the two files that reached `~/Downloads`, plus two screenshots of the
Send-for-review modal. Two earlier handoffs stated flatly that there was no such
file; both have been corrected. The lesson is cheap and worth keeping: **a
ticket's attachment list is part of the ticket.**

## 1. The two decisions that shaped this plan — both answered 2026-09-15

**D1 — "Full settlement access" — DECIDED 2026-09-15: build the toggle, and the
rule moves.** The send modal offers *"Let recipients see all parties' financial
details."* `story.md:44` says a performer sees "only their own slice — never the
event budget/pool … **even if an operator wanted to show them**", and
`POOL_CAPABILITIES` in `packages/auth` is that sentence compiled. The owner's
call is that the operator may grant it. So:

- `story.md:44` is amended and the reversal recorded in `decisions.md` as its own
  entry, saying plainly that it overrides the earlier line — the boundary was
  called inviolable, and a change of that size must not be discoverable only by
  reading a diff.
- The grant is **stored, per settlement, per recipient, and audited** — never a
  request flag. The API decides what a caller may see from the stored grant, the
  same way `includePool` works today; a client asking nicely changes nothing.
- It is a grant of the **pool ladder and the other parties' figures on this one
  settlement**. It is not `budget.view`, and it does not reach the Budget Planner,
  other events, or anything `POOL_CAPABILITIES` guards elsewhere.
- Default **off**, as the design draws it. Curation still only narrows; this is
  the one thing that widens, and it is explicit, per send, and visible in the
  audit trail.

**D2 — the waterfall — DECIDED 2026-09-15: adopt the design's.** The Overview
waterfall is what we build, and the engine moves to match it:

```
Gross revenue        every revenue line, whoever collected it
  − Deductions       fees, tax, refunds, production, costs
= Net revenue
  − Venue rental     OFF THE TOP, before any split
= Adjusted net       ← what every percentage is a percentage of
      → performer entitlement   per deal type, guarantee as the floor
      → promoter / venue        their percentages of the same adjusted net
```

This **reverses decisions.md #23.1 and the off-the-top retirement**, both settled
on 2026-09-13, and needs its own dated `decisions.md` entry saying so — the same
discipline as D1. The concern that produced #23.1 (an operator entering one more
cost silently shrinks the act's fee) was raised again on 2026-09-15 and the
owner's answer stands: the design's order is the one the industry reads.

Three things that fall out of it, none of them optional:

- **#23.3 does NOT reverse.** The prose of §3 implies a bonus threshold measures
  adjusted net, but the spec's own §7 code reads
  `if (totalRevenue >= d.bonusThreshold)` — gross revenue, which is exactly
  #23.3. The code wins over the implication; `bases.grossRevenue` stays as it is.
- **The residual stays, and it is what conserves.** §7's code gives each party an
  independent share and comments *"promoter is NOT residual"*, while §2's prose
  says *"the operator absorbs the shortfall"* below the guarantee crossover. Both
  cannot hold: when a guarantee floor binds, independent shares sum past the
  adjusted net and something has to give. We take the **prose** — `residual =
  pool − Σ entitlements`, allocated across operators by `operatorCostSplit` — which
  is both what the engine already does and the only reading that keeps
  `Σ net = 0`. On a clean night where the percentages total 100 the residual lands
  at zero and the operator's take equals its stated share, which is what the
  design's own Overview shows.
- **The planner moves with it.** `useBudgetSeed.ts` builds `EntitlementBases`
  itself (`{ doorBase: door.ticketRevenue, grossRevenue: door.totalRevenue }`) and
  calls the same `dealEntitlement`. If only the settlement changes base, the
  forecast and the settlement will report different fees for the same deal. Both
  call sites change in the same commit as the engine, or neither does.

## 2. What is already there

Not much of this is a rebuild. Against the design, the following already exist and
work: the 7-status stepper and its enum; per-line comments (`settlement_comments.
settlement_line_id`); per-party **Send for review** and the `participantIds`
argument on `PATCH /events/:id/settlement/status`; approvals with a `n/m` card;
`Add revision` / `Mark finalized` / `Flag a dispute`; the settlement's own copy of
the budget (`settlement_lines`) with planned-vs-actual; the pool redaction in
`serializeSettlement`.

Genuinely missing: **curation**, **viewing-as**, the **send modal**, the
**Deal structure** and **Collaborators** tabs, the Overview waterfall and
proportion bar, the Financials entry-method chooser and ticketing sync card, and
the locked Payout state.

## 3. Build order

### Phase 0 — the engine, first, because everything downstream reads it

The waterfall is not a drawing job; it is the numbers the screens then render.
Doing it first means Phases A–E are built once against the figures they will ship
with.

- **`PoolLadder` gains the real rows** — `grossRevenue`, `deductions`,
  `netRevenue`, `rental`, `adjustedNet`. `offTheTop` starts carrying the rental
  again instead of the `0n` it has been hard-coded to since #23.1, and
  `splitPool` becomes `adjustedNet` rather than a copy of `pool`.
- **`EntitlementBases.doorBase` becomes the adjusted net** (`reconcile.ts:63`),
  and with it `EntitlementBasis.base` on the `door_split` and `guarantee_vs_door`
  arms. The redaction in `serialize/settlement.ts` that strips `base` from a party
  row still applies and matters more, not less — `base` is now the whole night's
  net, not just the door.
- **Rentals move money off the top again.** `deal-order.ts` already runs them
  first; `reconcile.ts:155` is the comment explaining why that pass deliberately
  changes nothing. Re-enabling is a small diff — the mechanism was left standing.
- **Stored shapes.** `snapshot.ts`'s `SerializedLadder`, the two generated
  api-client ladder models, and `settlementDocument.ts`'s `doorBase` caption.
  Snapshots written before today keep the old shape, so readers tolerate the
  missing rows the way `ladderOf` already tolerates a missing ladder.
- **What has to be re-proved:** `reconcile.test.ts` (1 301 lines, every figure in
  it computed off the old base), the API's `settlement.test.ts`, the Budget
  Planner's break-even chart and derived performer fee — shipped 2026-09-14 — and
  the e2e budget specs. Expect the planner's break-even ticket count to move; that
  is the change working, not a regression.
- **One piece of luck:** production holds **zero** `settlement_lines`, so no
  settled money is being restated. This reversal is free in the only way that
  counts, and it will not be free again once a real event is settled.

### Phase A — the tabs that need no new storage
Six tabs, in the design's order: Overview · Deal structure · Financials ·
Settlement · Collaborators · Payout. Today's `Comments` tab folds into the
Settlement tab's right rail, where the design puts it.

- **Overview** — *Event details* grid; the waterfall card, five rows, each
  captioned as the design captions it (`paid off the top`, `what percentages
  divide`); *Total
  settlement* with the `balances ✓` chip (we already assert `Σ net = 0` — this is
  that fact, drawn), the stacked proportion bar and entitlement-by-party with
  percentages.
- **Deal structure** — read-only. Deal type, guarantee, revenue split, production
  cost split, rental, the one-sentence statement of which arm won, and *Ticket
  revenue split*. This reverses ClickUp `86cbaxvb9` **only as far as the design
  does**: it is a read-only account of what the agreement paid, not a second place
  to author a deal. Authoring stays on the event's Deals tab.
- **Collaborators** — *Each party's position* plus the existing delivery card,
  retitled *Send settlement per collaborator*.
- **Payout** — the locked state: lock, the status sentence, a disabled
  **Process Payout**.

### Phase B — Financials
Entry-method chooser (**Start from Budget Planner** / **Start fresh**) — we
already copy the budget on first run, so this is the choice made explicit and a
"copy nothing" path. *Ticket sales* card with tier rows and the mismatch warning
("planner tiers total X, the settlement's gross ticket figure is Y") with a
**Use planner** action. `Sync from Ticketing Company` wires to the existing
`ticketingSource` / `providerRef` columns, or is drawn disabled and honest if no
provider is connected. Add `+ Add deduction` beside the existing add-line buttons.

### Phase C — curation (the one real subsystem)
- **Storage.** A `hidden_from` jsonb on `settlement_lines`, holding participant
  ids — the same shape and the same reasoning as `revenue_shares`: read with its
  line, never queried across. **Per participant, not per role**, because two
  performers on one bill must not share a curation; the design's role tabs are UI
  sugar over the participants holding that role. Hand-written migration `0039`
  (`drizzle-kit generate` is still blocked at 0006/0007 and 0008/0009).
- **Serializer.** Curation only ever **narrows**. A hidden line is *absent*, not
  masked. The event's totals stay governed by `POOL_CAPABILITIES` regardless of
  what is curated — the prototype's own performer view shows *Total revenue*,
  *Adjusted net* and the venue's payout after hiding six lines, and shipping that
  would leak the pool by derivation.
- **API.** `PATCH /events/:id/settlement/lines/:lid` gains `hiddenFrom`;
  `settlement.edit` to write, and the read path filters per caller.
- **UI.** The *Curate what each collaborator sees* card: role tabs, two lists,
  chips moving on click (drag is a nicety, click is the contract).
- **Viewing as.** A select that re-renders the page through a chosen party's
  serializer output — served by the API, not simulated in the browser, or it
  proves nothing about what they can actually see.

### Phase D — the review loop
The **Send Settlement for Review** modal: *All collaborators* / *One by one*, a
recipient select, and the **Full settlement access** toggle if and only if D1 says
so. The collaborator review view gets the design's banner with **Request changes**
(→ `comments_received`) and **Approve settlement**. *Revision history* renders from
the audit rows we already write.

### Phase E — prove it
`settlement.test.ts` for the curation rules, including the derived-totals leak.
Playwright for the operator→performer→approve loop. Then the screenshot compare
the `claude-design` skill demands — ours beside `renders/`, named differences.
And the thing that matters most: **production holds zero `settlement_lines`**, so
none of this has ever run on a real event. Settling one real show is the
acceptance test.

## 4. Owed regardless

The `ticket-to-commit` write-backs for the budget planner work and for this
session are still owed on `86cbcn1ue` (status: `re-do`) and `123qy9rnwud`. Ran's
standing note on `86cbcn1ue` — *"the language across the new design is super
confusing … we need to redo this together"* — is subtask `123qy9rng6d`, a
terminology session, still in backlog. Vocabulary decided there overrides every
caption this plan draws.
