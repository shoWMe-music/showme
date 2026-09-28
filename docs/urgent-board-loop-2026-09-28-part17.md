# Urgent board — sweep run 8's majors (2026-09-28, part 17)

Run 8 reports **sixteen** findings and confirms all eleven run-7 fixes on the running app.
Two of its four majors are consequences of this loop's own work, so they go first.

Order for this part: **QA8-3**, then **QA8-4** — both are wrong NUMBERS on screens this loop
touched. Then run 7's four remaining cosmetics, which now have a stack to be proven against.
QA8-1 and QA8-2 are absent surfaces rather than wrong ones and are sized in part 18.

---

## QA8-3 — the break-even scan and the headline fee divide different bases

**Which file settles it:** `packages/shared/src/budget-planning.ts:466` — one term in `derivedAt`.

**Verdict: real, and it is the second half of QA7-1.** That fix moved the scan's base off
`decisions.md` #23.1's gross door and onto #24.1's adjusted net, which was right. Rebuilding the
adjusted net at each attendance, it subtracted **every** cost that is not the fee — including
`variableCostPerTicket`, the planner's payment-processing rate. The headline fee does not subtract
that, and the headline is the one that matches the engine.

**Why the headline is the correct one, read off the code rather than argued:** the fee the tiles
show is `plannedMinor`, which `useBudgetEditor` takes from `seedSource.performerFees` — the API's own
figure, computed from the deal and the event's budget LINES. Payment processing is not a line. It is
a planner rate, derived at render and never stored (`routes/budget.ts`: *"RATES, never amounts … The
money is derived from these rates by `computeBudgetProjection()` when the screen renders and is never
stored"*). So the settlement engine never deducts it before applying a split, and neither may the
planner — #24.1: *"the Budget Planner moves with the engine, in the same commit."*

**What the disagreement does, and why a 100% split makes it total.** With the split applied to a base
that has already had the processing fee taken out, the scan's costs collapse:

```
costs(N) = fixed + split×(revenue(N) − fixed − v·N) + v·N
         = revenue(N)                                    when split = 100%
```

— identically equal to its own revenue at every N where the share arm governs, so the loop's
`revenue − costs >= 0` is satisfied at the *first* such N and reports it as the crossing. That is the
130. Reality is `revenue(N) + v·N`, which exceeds revenue at every positive attendance: **on a 100%
split the night never breaks even**, and the card printed a number instead of saying so.

**Scope:** drop `variableCostPerTicket` from `costsBeforeTheFee` in `derivedAt` only. It stays in
`costsAt`, which is the break-even question rather than the split base — the processing fee is real
money and must still be covered. Nothing else moves: the tiles, the P&L and the settlement are
already consistent with each other and it is the scan that joins them.

**What the card will say afterwards, and that this is the right answer rather than a worse one.** On
the seeded 100% split the scan finds no crossing inside its bound, `breakEvenReachable` goes false,
and the chart says there is no break-even. That is the truth: an act taking 100% of revenue-less-fixed
costs leaves the operator paying the processing fee out of nothing. A card that says *"no break-even"*
over a −SEK 1,395 P&L agrees with itself; *"130"* did not.

*The decision it hides:* none — #24.1 settles which base wins, and `routes/budget.ts` settles that
processing is not a line. Worth noting for the record: this is the third time a *comment* carried the
weight here. QA7-1's own docstring already said the base is *"revenue less every cost that is NOT the
derived fee itself — `trulyFixedCosts` … and the per-ticket variable cost"*, which is a precise
description of the defect, written in the same commit that introduced it.

*Proof:* the scan is pure and has a suite. A test at the sweep's own figures (SEK 93,000 over 360
tickets, SEK 33,000 of costs, 1.5% processing, a 100% split) asserting no reachable break-even, plus
one on the GUARANTEE arm — where the base genuinely decides which arm governs — to show the fix does
not move the case QA7-1 was built for. Mutations must kill both.

---

## QA8-4 — an agent's headline is their commission, and it read SEK 0

**Which file settles it:** `apps/web/src/components/useEventSettlement.ts` (expose the figure) and
`EventSettlementTab.tsx:44` (read it).

**Verdict: real, and it is QA7-28's third seat.** QA7-28 made the headline *what moves* rather than
what was earned, and was verified for an operator (negative net) and a performer (positive net, less
an advance). The agent is the seat where `net` and "what I am owed" come apart **by construction**:
their commission is a representation-scoped settlement with a null `participantId`, so the event
breakdown carries `net 0` for them and is right to. Three other screens — the dashboard,
`/settlements`, and this workspace's own Total Payouts — say SEK 3,000, and a transfer row exists for
it.

**The figure is already in the hook.** `ownCommissionMinor` was built for this exact reason in an
earlier run (*"an agent owed SEK 3,581 read SEK 0 on every screen"*) and feeds `totalPayable`. The
Settlement tab simply reads `ownParty.netAbsolute` instead, so it is the one surface that never got
the correction.

**Scope:** the hook exposes one `ownFigure` — the reader's own net **plus** their own commission, with
its own tone and its magnitude already formatted — and the tab renders it under
`ownFigureLabel(ownFigure.tone)`. Two reasons for putting it in the hook rather than adding the two
numbers in the component: the component must not do money arithmetic (CLAUDE.md: components stay
dumb, and `docs/money.md` wants it on minor units), and `/settlements` already compensates the same
way server-side, so a third spelling of "what this night owes me" is what has gone wrong twice.

For an operator and a performer `ownCommissionMinor` is `0n` — `commissions` only carries rows naming
the reader as the agent — so their headlines cannot move, which is what §2 of the report verified and
what the tests must pin.

*The decision it hides:* none. #14 already makes an agent's money on a night their commission.

---

## QA8-3 and QA8-4 — built and proven

**QA8-3.** One term removed from `derivedAt`'s base. Before and after on the same screen, the
seeded Album Release as `operator@`:

| | before | after |
|---|---|---|
| TOTAL REVENUE | SEK 83,000 | unchanged |
| TOTAL COSTS | SEK 84,245 | unchanged |
| PROFIT / LOSS | −SEK 1,245 | unchanged |
| BREAK-EVEN TICKETS | **130** | **No break-even** |
| the chart caption | *"Revenue passes total cost at 130 tickets of 400 capacity."* | gone |

Measured by reverting the one line, reloading, reading, and restoring — not inferred. Worth noting
that the seeded 320-ticket sheet gave the **same 130** the sweep measured on its 360-ticket one:
on a 100% split the fabricated crossing is wherever the share arm first governs, and the planned
attendance has nothing to do with it. That is the mechanism confirming itself.

Three tests moved or were added, and **a test pinned the defect** — the third time this loop. The
share-arm case asserted **51** and listed *"dropping the processing fee 52"* among the WRONG
answers, 52 being the right one. Its derivation was internally consistent; its premise was not.
QA7-1's docstring also claimed the base *"cannot move the number"* on the share arm; it moves it by
a ticket, because the base changes the per-head coefficient (98.5 against 97). Both corrected in
place, because both are what made the term survive a run.

**QA8-4.** `ownFigure` on the hook — the reader's own net plus their own commission. Proven as
`agent@` on the Album Release: **SEK 3,000 · Your payout**, where it read SEK 0 against three other
screens saying 3,000.

---

## QA8-5 — the card's rows do not sum to its headline, and the comment says why they should

**Which files settle it:** `apps/web/src/components/settlementDocument.ts` (the rules builder) and
`SettlementPartyCard.tsx` (where the rows are drawn).

**Verdict: real, and the engine settles it in one line.** `reconcile.ts:348-369`:

```
entitlement = owed                       (the allocation alone)
held        = collected − paid + prepaid (cash)
net         = owed − held
```

So `collected` is **never** a component of the entitlement, and the card's headline is the
entitlement. The `collected` row was added by run 6's QA6-9 on the stated belief that *"the engine's
`entitlement` is `deal lines + revenue you collected − costs fronted for you`"* — which is not what
the engine does, and is the eighth instance this stretch of a comment asserting a rule the code does
not keep.

**Why QA6-9's arithmetic nevertheless worked, which is the interesting part.** `reconcile.ts:255`
credits a non-pooled line's collector with what they kept: `if (!pooled && line.collectedBy)
credit(line.collectedBy, line.amount − movedAway)`. So for a performer keeping their own merch line,
the amount lands in `entitlement` AND in `collected`, and the row appeared to make the column sum.
For an operator collecting **pooled** door revenue it does not: the cash is theirs to pay out, not
theirs to keep, and `collected` sits outside the allocation entirely. Hence SEK 20,700 over rows of
20,700 and 78,000. The row was right for one party kind by coincidence and wrong for the other by
construction.

**Scope — one rule for the whole card, rather than a patch per row.** Above the dividing line go the
things that sum to the **entitlement**: the deal lines, `commissionEarned`, `residual`, and
`deductibles` with its itemisation (those ARE inside the allocation —
`credit(participantId, -amount)` at `reconcile.ts:263`). Below it go the things that explain the gap
between the entitlement and what actually **moves**, which is exactly the place QA7-10 established
for the advance:

| row | direction, from `net = entitlement − collected + paid − prepaid` |
|---|---|
| money this party collected | reduces the payout — they already hold it |
| costs this party paid | increases it — they are owed it back |
| an advance received / paid | reduces / increases, as now |

`collected` and `paid` are already on `SettlementParty`; no new payload. The QA8-5 complaint that the
SEK 10,800 paid *"appears nowhere on the card"* is answered by the same change rather than a
separate one.

*What must not be lost:* QA6-9's real finding was that these sentences are **person-aware** — *"Plus
the money you collected"* had appeared on a performer's screen under the operator's name, once #24.2
put another party's card in front of a reader. The new builder carries the same `owner` argument and
the same three-way naming, and QA6-9's tests move with the row rather than being deleted with it.

*The decision it hides:* none. The engine's three lines settle which side of the divider each row
belongs on.

### QA8-5 — built, and proven against a figure the app computes twice

`payoutAdjustments` builds the rows under the divider; `collected` left the rules;
`prepaidReducesPayout` was deleted, being a second answer to a question the new builder
answers. Spring Warmup as `operator@` — the sweep's own example:

```
The Lantern Hall (you) · Operator                 SEK 20,700
  What is left after every other party is paid    SEK 20,700     ← sums to the headline
  ─────────────────────────────────────────────
  Less the money you collected on the night      − SEK 78,000
  Plus the costs you paid on the night             SEK 10,800

headline:  SEK 46,500 · You owe        20,700 − 78,000 + 10,800 = −46,500
```

The same workspace's **Payout tab** prints *"Collected SEK 78,000 · Paid SEK 10,800 · Net
−SEK 46,500"* from its own reading, so the card and the tab now agree exactly. Before, the card
showed SEK 20,700 over rows of 20,700 and 78,000 and never mentioned the 10,800 at all. Marlo
Vance's card is untouched (48,300 − 1,800 = 46,500), which is what run 8 asked for.

Also checked on the Album Release, where the operator's entitlement is zero: `SEK 0`, less
83,000 collected, plus 33,000 paid, under a headline of **SEK 50,000 · You owe**. Every figure
on the card is now checkable against the one above it.

Five mutations red, including one that makes every card say "you" — QA6-9's finding, asserted
on both builders now, because the pronoun rule applies wherever the sentence lives.

---

## Run 7's last cosmetics — closed

**QA7-25.** Three places, not one: the hint, the comment above it that would have restored it,
and the field **label**, which still read *"share of the pool"* while the hint below it had been
corrected to the adjusted net. Proven in the dialog: *"MARLO VANCE'S SHARE OF THE ADJUSTED NET
/ Of the adjusted net — revenue less deductions, and less anything taken off the top such as
the venue rental."*

**QA7-27.** `—`, and the modal titled just *"Invoice"*. Proven with a numberless bill: the
column reads `—` and the id stub `115a1026` appears nowhere on the page.

**QA7-26 — checked rather than built, then half-built.** The pairing is gone: QA7-3 stopped the
private book seeding itself, so it reads SEK 0 throughout and 0.0% contradicts nothing. But a
margin is profit over revenue, and over zero revenue there is no rate to state, so the strip
says `—`. Proven both ways on one screen — the empty private book reads **PROFIT MARGIN —**,
the shared ledger **−1.5%** against SEK 83,000 (and **No break-even**, which is QA8-3 holding
on the same strip).

That closes every actionable item from sweep run 7 except **QA7-18** and **QA7-24**.

The seed was restored afterwards (`seed:e2e`), which removed the numberless bill and the
wizard's test event.
