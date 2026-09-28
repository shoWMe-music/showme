# Urgent board — run 7's product call and the first three minors (2026-09-28, part 14)

Part 13 closed QA7-3. This part carries **QA7-6** (a product call, not a defect), **QA7-9**,
**QA7-10**, and **QA7-28** — a defect found *while proving QA7-10*, one line above it on the
same screen.

Earlier parts: 7, 8 (09-27) · 9, 10, 11, 12, 13 (09-28). Handoff:
`docs/handoff-2026-09-28-urgent-board.md`.

---

## QA7-6 — an off-the-top rental the pool pays, not the party named as payer

**Which file settles it:** `packages/settlement/src/reconcile.ts` — and it does not need changing.

**Verdict: a product decision, recorded in `decisions.md` §25.6 rather than built.**

The sweep found that a rental taken off the top is borne by the POOL: with the act on 70% of the
adjusted net, the act pays SEK 700 of a SEK 1,000 rental and the party `deal_parties` names as the
payer bears SEK 150 of it. That reads wrong at a glance, and it is exactly what **#24.1** says to do
— percentages divide the **adjusted net**, and an off-the-top cost is what the adjustment *is*.

The conflict is only visible when the named payer is **itself a party on the event**. Then the
engine is charging one party through the pool that the same party is drawing from, and the payer's
own share of the rental comes back to them as 15% of the money they just spent.

*The decision it hides — recorded, with a recommendation:* when the payer is a party on the event,
settle the rental as a **transfer between payer and payee** and leave the pool alone; keep #24.1's
off-the-top behaviour when no party is the payer. That is #24.1's own logic applied consistently — a
cost the pool never saw should not adjust the net the pool divides. **Not built: Ran's call.**
`decisions.md` §25.6 now holds eight rows, and this is the only one of them with a recommendation
that changes money.

---

## QA7-9 — "Nobody has confirmed these terms yet", said over signatures

**Which file settles it:** `apps/web/src/components/useBudgetSeed.ts`.

**Verdict: real.** The split card's closing sentence was unconditional. Whatever the deal's parties
had actually done, every reader was told nobody had confirmed anything — on a deal where two of
three parties had signed, the screen contradicted the database.

**Scope:** the sentence only, and only when the deal is still unconfirmed. The card, the split
percentages and the deal figures are untouched.

*The decision it hides:* none. "Still moving" and "nobody signed" are different facts and the
sentence conflated them; there is no product call in saying which of the two is true.

### Built

`stillMovingBecause(deal)` — pure, exported, in the same file as the seed it serves. Three branches:
nobody signed, everybody signed (terms still move until the agreement freezes, so the sentence
survives without a count), and the partial case, which names the count. `DealParty` gained
`confirmedAt`, which the payload already carried.

Five tests, and **three mutations, all red**: drop the nobody-signed case, claim a count when all
have signed, assume everyone signed. 32 tests pass in that file.

### Proven on the running stack

Deal `…d1` set to `draft` / `sent` with one of three parties signed, stack rebooted, read as
`operator@`:

> 100% of the door. **1 of 3 parties have signed, so they can still move.**

Where it previously read *"Nobody has confirmed these terms yet, so they can still move."* over the
same row. The deal was restored to `confirmed` with all parties signed afterwards, and the advance
below was added on top of the restored state.

---

## QA7-10 — the advance the engine computed and no screen showed

**Which file settles it:** `apps/web/src/components/SettlementPartyCard.tsx`, with one field added in
`useEventSettlement.ts`.

**Verdict: real, and a missing renderer rather than missing logic.** The engine had the number
(`"prepaid": "500000"`), the label was already built (`prepaidLabelOf`), and
`packages/settlement/src/types.ts:160` states the rule — but no card drew it. A party's card showed an
entitlement of SEK 30,000 and the money actually moving was SEK 27,000, with nothing on the tab
accounting for the difference.

**Scope:** the party card only. `prepaidReducesPayout` on `SettlementParty` distinguishes money this
party RECEIVED in advance (their entitlement stands, the payout is smaller) from money they PAID out.

*The decision it hides:* where the line goes. It sits **below** the entitlement rules behind a 2px
rule, because the rules above sum to the entitlement and the advance explains the gap between that
and the payout. Folding it in with the rules would break the column's own sum.

### Proven on the running stack

`advance_amount = 500000` on deal `…d1`, recomputed, read as `operator@` on the Settlement tab:

| card | entitlement | advance line | transfer the engine wrote |
|---|---|---|---|
| The Lantern Hall (payer) | SEK 0 | *Paid in advance to Marlo Vance and Neon Tide* −SEK 5,000 | — |
| Marlo Vance | SEK 30,000 | *Paid in advance by The Lantern Hall* **− SEK 3,000** | SEK 27,000 |
| Neon Tide | SEK 20,000 | *Paid in advance by The Lantern Hall* **− SEK 2,000** | SEK 18,000 |

Both directions render, the payer's line is not marked as a reduction, and each act's card now
arrives at the figure the transfer carries. The 2px top border is on the row (measured in the DOM,
not assumed from the source).

---

## QA7-28 — "Your payout", over a number that is not the payout

Found while proving QA7-10, one line above the card that proved it. **Not in the sweep.**

**Which file settles it:** `apps/web/src/components/EventSettlementTab.tsx:44` —
`const headline = settlement.ownParty?.entitlement;` under the label `"Your payout"`.

**Verdict: real.** The 44px figure at the head of the Settlement tab is the reader's **entitlement**,
labelled as their **payout**. The two differ whenever anything sits between them — an advance, a
deduction, or cash the party is holding — which is the normal case, not an edge one. Measured on the
seed, as the operator, with QA7-10's advance in place:

| reader | headline says | the engine's transfers say |
|---|---|---|
| The Lantern Hall (operator) | **SEK 0** · "Your payout" | **owes SEK 45,000** (27,000 + 18,000) |
| Marlo Vance | **SEK 30,000** · "Your payout" | **receives SEK 27,000** |

The operator's case is the worse of the two: a party who owes forty-five thousand is shown a zero,
and the label tells them it is theirs. QA7-10 makes this *more* visible rather than less — the card
directly below now shows the −SEK 3,000 that the headline ignores, so the tab disagrees with itself
by one line.

**Scope:** the headline figure and its label. The party cards below are correct as they stand and do
not change — the card's big number is deliberately the entitlement, because the rules under it sum to
exactly that (QA7-10's own reasoning).

*The decision it hides:* what the top of a settlement tab is FOR. It is the one number a reader takes
away, so it should be **what moves**, not what was earned: `net`, labelled by its sign. `Σ net = 0`
makes the sign meaningful — positive is money coming to you, negative is money you owe — and
`ShareViewer.tsx:375` already has the vocabulary for both directions (*"You are owed"* / *"You owe"*),
so this reuses the app's existing words rather than inventing a third phrasing.

### Plan

A pure `settlementHeadline(net)` in `settlementDocument.ts` — the home of the tab's other pure rules
(`netToneOf`, `isWholeBoard`, `entitlementGapSentence`), and the file with its own suite. It returns
the label and the sign to render, on BigInt minor units rather than `Number` (`docs/money.md`: never
float, and `netToneOf` predates that rule in this file). Three branches: owed to you, owed by you,
and a settled zero — where "Your payout SEK 0" is truthful and needs no special wording.

The tab then renders `ownParty.net` under that label, and an unreconciled event keeps the existing
*"Not reconciled yet"*, which is a real "not yet" and not a zero.

### Built

Two pure rules, each in the file that already owns its kind of decision:

- `ownFigureLabel(netTone)` in `settlementDocument.ts` — the label follows the sign. It takes the
  tone rather than the amount so there is exactly one sign rule in that file (`netToneOf`), not two
  that can drift.
- `absoluteMinor(minorUnits)` in `lib/format.ts` — the magnitude, off the RAW minor units through
  `BigInt`. Never by slicing a character off a formatted amount: a locale may put the minus after the
  figure, inside the symbol, or use parentheses, so that trick is correct only until someone changes
  the locale.

`SettlementParty` gained `netAbsolute` beside `net`, and the tab renders it under the label.

**Eight tests, and four mutations, all red:** always a payout · a zero owes too · never strips the
sign · strips it through a float. The last one matters more than it looks: `Math.abs(Number(...))` is
green on every figure in the seed and only fails past 2^53, so the test that kills it is the one
asserting exactness at the ceiling.

**The mutation harness lied first, and this is worth recording.** Its first run reported all four
mutations GREEN — because the grep that pulls vitest's summary line matched nothing (the output is
ANSI-coloured), `$out` came back empty, and an empty string does not match `*failed*`, so every case
fell through to the "survived" branch. **A mutation harness that cannot find the result reports a
survivor, which is indistinguishable from a real one.** Fixed by stripping the colour, anchoring on
`^ *Tests +[0-9]`, and erroring out loudly when no summary line is found rather than deciding from
silence. This is the same shape as CLAUDE.md's `tail -3` lesson: the pipe, not the test, decided the
answer.

### Proven on the running stack

Both directions, both surfaces, with QA7-10's advance in place:

| screen · reader | before | after | the engine's own figure |
|---|---|---|---|
| Settlement tab · operator | SEK 0 · *Your payout* | **SEK 45,000 · You owe** | two transfers, 27,000 + 18,000 |
| Settlement tab · Marlo Vance | SEK 30,000 · *Your payout* | **SEK 27,000 · Your payout** | transfer of 27,000 |
| Settlements list · Marlo Vance | *YOUR PAYOUT* SEK 30,000 | **YOUR SHARE** SEK 30,000 | entitlement of 30,000 |

The performer's tab now reads down the page without contradicting itself: **SEK 27,000 · Your
payout**, then her card — SEK 30,000, *100% of the adjusted net — your 60% of the deal's SEK 50,000*,
*Paid in advance by The Lantern Hall* **− SEK 3,000**. The headline is the sum the card explains.
Party-scoping is unharmed: she sees her own card and nobody else's.

### The seed was put back

Both proofs needed the seed mutated — QA7-9 wanted an unconfirmed deal with a partial signature,
QA7-10 an advance — so `pnpm --filter @showme/db seed:e2e` was re-run rather than hand-reversed. That
surfaced a detail worth having: the pristine deal `…d1` is `confirmed` with a NULL
`confirmed_snapshot` and **b1 unsigned**, which is not what a hand-patch had restored it to. Hand-
reversing a fixture guesses at the original; re-seeding does not.

## Suites

biome **735** clean · `tsc` clean · web **443** (up from 435: 5 for `absoluteMinor`, 3 for
`ownFigureLabel`). API and e2e unrun in this part — both are due in the single pass with the stack
down, and nothing here touches the API.
