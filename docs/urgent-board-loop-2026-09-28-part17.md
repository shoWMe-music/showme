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
