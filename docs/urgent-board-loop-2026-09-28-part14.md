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

---

## Run 7's minors, cluster A — the four cheapest

Planned together because they are four small truths on two screens, and three of them share a file.

### QA7-13 + QA7-19 + QA7-14 — the Bills & Invoices ledger

**Which files settle them:** `apps/web/src/components/invoiceDocument.ts` (the pure rules),
`apps/web/src/routes/Invoices.tsx` (the tiles), `apps/web/src/components/InvoiceLedgerTable.tsx`
(one header).

**QA7-13 — verdict: real, and worse than filed.** A `draft` bill was counted in OUTSTANDING
(PAYABLE) *"Bills you owe"* and a `draft` invoice in RECEIVABLE (SENT) *"Invoices you've issued"*,
beside a Status of **Draft** and an **Issue** button. The tile subtitles state the rule the totals
break. The sweep noted OVERDUE got it right — it did not: `isInvoiceOverdue` excludes only `paid` and
`void`, so **a draft with a past due date is counted as overdue too**. The sweep's drafts simply had no
due date yet, which is why the third tile looked innocent. One rule, three call sites.

*Scope:* `countsAsMoneyOwed(invoice)` — of the five states (`draft`, `sent`, `paid`, `overdue`,
`void`), money is still moving on `sent` and `overdue` only. The three tiles consult it; the rows
themselves are untouched, since a draft still belongs in the ledger it was typed into.

*The decision it hides:* none. Both tiles carry their own subtitle, and each states the rule.

**QA7-19 — verdict: real, and a half-fixed defect rather than a new one.** A performer's tiles read a
bare `0`. The currency is taken from the ledger's own rows, and an empty ledger has none — which was a
deliberate fix (run 3: the fallback was `EUR`, so an all-SEK performer read `€0`, and "a number under
the wrong symbol is worse than a number under none"). Correct, and it stopped one step short: a
profile's currency is knowable without any invoices at all. `decisions.md` **#17** — currency is a
per-country fact — and `currencyForCountry` already returns `null` rather than guessing.

*Scope:* the tiles fall back to the profile's own country currency, through the `useGetApiV1Profiles`
hook the New Event wizard already uses for exactly this. `currencyForCountry`, **not**
`defaultCurrencyForCountry`: the latter falls back to EUR, which would re-introduce the run-3 defect.
No country, no currency, and the bare figure stands — which is then the truthful answer.

**QA7-14 — verdict: real, one word.** The Sent tab's first column is headed **VENDOR** over the
customers who were billed. The table renders one header list for both directions; the New invoice
dialog already gets it right (**BILL TO** / **FROM**).

*Scope:* the table learns which direction it is showing and heads that column **Bill to** on the
issued side. **Deliberately not extracted into a pure rule with a test** — it is one ternary with one
call site, and CLAUDE.md's own bar says a helper with one call site is worse than the lines it
replaced. The DOM reading is the evidence.

### QA7-8 — the settlement's party chooser overflows at 390px

**Which file settles it:** `apps/web/src/components/SettlementCurationCard.tsx:62`.

**Verdict: real, and the cause is not the missing wrap the finding assumed.** The chooser row already
has `flexWrap: "wrap"`. It also has **`flexShrink: 0`**, which is the whole defect: a flex item that
refuses to shrink takes its max-content width — all four buttons on one line, 426px — and keeps it
even once the outer row has wrapped it onto a line of its own. `flex-wrap` on the inside never gets a
chance, because the box is never narrowed.

*Scope:* that one item. It regains the default shrink and loses its min-content floor (`minWidth: 0`),
which is the same fix and the same reason as the `minmax(0, Nfr)` note 30 lines above it in
`InvoiceLedgerTable` — remove the floor, do not buy pixels. The chips still sit beside the title on a
wide screen, because the title's `flex: 1 1 280px` basis is what puts them there.

*The decision it hides:* none. `docs/decisions.md` has no rule about breakpoints; CLAUDE.md's
"Green is not the same as correct" section already records that `scrollWidth <= clientWidth` is the
measure, and a 79px page overflow fails it.

### Built, and proven on the running stack

**QA7-13.** `countsAsMoneyOwed` — a deny-list of `draft | paid | void`. The three tiles consult it;
`isInvoiceOverdue` now opens with it, which is what closes the second half. **12 tests** (a new
`invoiceDocument.test.ts` — the file had none), **four mutations all red**: a draft is money after all
· only sent counts · paid still counts · overdue drops the state guard. Every date fixture is
relative to `now`, because a fixture pinned to a calendar date inside a now-relative window is a
scheduled failure and this repo has already had one go red at midnight.

Proven with a draft bill of SEK 1,234 dated **20 days in the past** — the shape that exercises both
halves at once — and a draft invoice of SEK 5,000, both created as `operator@`:

| tile | with the drafts, before | with the drafts, now | the ledger's non-draft rows |
|---|---|---|---|
| OUTSTANDING (PAYABLE) | SEK 10,234 | **SEK 9,000** | one `overdue` received bill, 900,000 |
| OVERDUE | SEK 10,234 | **SEK 9,000** | the same bill, due 12 Jun |
| RECEIVABLE (SENT) | SEK 55,000 | **SEK 50,000** | one `sent` invoice, 5,000,000 |

Both drafts are still listed in the table, badged **Draft** with **Issue** beside them — the fix
removes them from the totals, not from the ledger they were typed into.

**QA7-19.** Proven as `performer.a@`: **SEK 0 · SEK 0 · SEK 0** where all three read a bare `0`.

Worth recording, because the first attempt did not work and the reason is the interesting part: the
seeded performer's profile has **no location at all**, so `currencyForCountry` returned null and the
tiles stayed bare. The currency that fixes it is the one on `GET /me` — the account's own chosen
currency (`SEK`), which the New invoice dialog *in this same file* already treats as authoritative for
exactly this purpose. So the fallback chain is ledger → profile country → account currency → nothing,
and the whole chain is **gated on `invoices.length === 0`**. That gate is the safety argument: on an
empty ledger every figure is exactly zero, so naming it in the reader's own currency is cosmetic by
construction. One row, and the rows decide again — because labelling real money with a preference is
the run-3 defect in the other direction.

**QA7-14.** Proven on both tabs: **BILL TO** now heads the Sent tab's first column, over *QA7-13
Draft Customer*, *Astra Booking Agency (for Marlo Vance)* and *Söder Live*; the Received tab still
reads **VENDOR**, over the vendors. The row component's props were narrowed to exclude `direction` —
a row names its counterparty from the invoice's own field, so the header's business is not the row's.

**QA7-8.** The sweep's own probe — an iframe at 390px — on the Album Release's settlement workspace,
which carries the same four chooser parties the finding reported (Marlo Vance, Neon Tide, Priya Sound,
Astra Booking Agency):

| measure | before | now |
|---|---|---|
| page `scrollWidth` vs `clientWidth` | 465 vs 386 — **79px of page overflow** | **380 vs 380** |
| the chooser row | one line, 426px wide | **two lines**, right edge 341 inside 390 |
| computed `flex-shrink` / `min-width` | `0` / `auto` | **`1` / `0px`** |
| what one line would need | — | 432px, against a 390px viewport |

And the design intent, measured at 1280px rather than assumed: the chips sit **on one line, to the
right of the title, on the same top edge** (628 for both), with no overflow. The elements still
reaching past the viewport at 390px are the tab strip and the status rail, each inside its own
scroller — which the sweep itself called deliberate.

### One alarm that was wrong, and why it is worth writing down

Re-seeding left a settlement row on the Album Release with a **NULL `participant_id`**, which reads as
a row no reader can ever be scoped to — against PLAN.md's *"one settlement per participant"*. It is
not a defect: `packages/db/src/schema/settlement.ts:192` carries
`CHECK (num_nonnulls(participant_id, representation_id) = 1)`, so a settlement is scoped to a
participant **or** a representation, and this row is the seed's `albumRepresentation` — an agent's
private commission, correctly invisible to the operator. The schema answered it in one line. Checking
the constraint before filing cost a minute; filing it would have cost a reader an hour.
