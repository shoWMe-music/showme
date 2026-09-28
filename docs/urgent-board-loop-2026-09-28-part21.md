# Urgent board — QA8-1's edit path, planned against the code (2026-09-28, part 21)

Written while **sweep run 9** drives the app, so this is reading and planning only. Part 19 sized
QA8-1 from the sweep's own suggestion; reading the two ends of it changes the shape, which is the
whole reason `ticket-to-commit` says to check the code before scoping from prose.

---

## The finding that changes the plan: **PATCH cannot change who is on a deal**

`UpdateDealBody` (`routes/deals.ts:210`) accepts `name`, `structure`, `currency`,
`guaranteeAmount`, `advanceAmount`, `splitBasisPoints`, `paymentTiming`, `commissionMode`,
`priority`, `terms`, `agreementBodyText`, `status` and `expectedVersion`. **There is no `parties`
field**, and the only `insert` into `deal_parties` in the whole file is the create path
(`deals.ts:573`); the two `update`s are the confirm stamp. So the party list is **write-once at
composition**.

That matters because the sweep's suggested fix — *"give `DealComposerModal` an optional `deal` and
open it from the card's header"* — would put the composer's **party editor** in front of the
operator, and the party editor is its central feature by design: *"a deal is an agreement between
1..N parties, not a performer's fee … the party list is a repeatable set of lines"*. Reopened as an
edit dialog it would offer add-a-party, remove-a-party and change-a-role controls whose changes the
API silently will not persist. **A form that accepts input it cannot save is worse than no form**,
and it is the same class of defect as the four sentences this stretch fixed for naming actions
nobody can take.

So the one-line fix is not one line, and not because of the front end.

## What the plan becomes

**Edit the MONEY, not the membership** — which is exactly and only what the spec asks for. Ran,
2026-09-21: *"Editing offered terms while pending should re-seed the budget, not hold a stale
figure."* The terms are the figures. Who is on the deal is a different question with its own
answer (below).

**Which file settles it:** `packages/shared/src/deal-terms.ts` for the one piece of real logic, and
`EventAgreementTab.tsx` for the control.

1. **`dealDraftFrom(deal)` — a pure function, and the only non-trivial part.** `useDealComposer`
   seeds from `emptyDealDraft(currency)`; editing needs the inverse, and it is exactly the place a
   money bug would hide: `guaranteeAmount` and `advanceAmount` are **minor units on the wire and
   major-unit strings in the draft**, and `splitBasisPoints` is an integer where the draft holds a
   typed percent. `docs/money.md` forbids doing that with a hard-coded ×100 — it goes through
   `currencyExponent`, the same way `majorToMinor` does on the way in. Round-trip is the test:
   `dealDraftFrom` then the existing submit mapper must reproduce the deal's own figures exactly,
   for each of the four structures and for a two-party split.
2. **`kindForStructure`** — the inverse of the existing `structureForKind`, so an edit opens on the
   right tab of the kind chooser. One mapping, and the two must stay mutually inverse: that is a
   property a test can state directly (`kindForStructure(structureForKind(k)) === k` for every
   kind), which is stronger than four examples.
3. **The party lines are shown READ-ONLY, with the reason on screen.** Not hidden: who is on the
   deal is the first thing an operator checks before changing what it pays, and a party list that
   vanishes in edit mode reads as data loss. A sentence — *"Parties are set when the deal is
   composed"* — says what is true, and §25.6's new row is where the question of changing it lives.
4. **`expectedVersion` reaches the dialog** (decisions #8), so a concurrent edit is a 409 and not a
   silent overwrite. The deal payload already carries `version`.
5. **The control opens only while `agreementStatus !== "confirmed"`**, mirroring the server: the
   PATCH already refuses a signed agreement's terms (`movedSignedTerms`, verified by run 7 as a
   409), so the button must not offer what the API will refuse — the rule this stretch applied five
   times.

## What this deliberately does not do

- **Change the party list.** That needs a `parties` field on the PATCH, and it carries a question
  nobody has answered: what happens to a line that has **already been signed** — its `confirmedAt`
  and its `version` — when the operator removes or re-roles it? Removing a signed party rewrites
  who agreed to what, which is the same objection §25.6's delete row makes. **Recommendation: a
  separate ticket, and only after the delete question is answered, because both are the same
  question about a signature's durability.**
- **Delete a deal.** §25.6 row nine, recommendation recorded, not mine to make.

## What it closes

Both false sentences. The card's *"Terms live until every party signs"* and the Budget Planner's
*"1 of 3 parties have signed, so they can still move"* — the second of which **this loop wrote** for
QA7-9, truthful about the data and false about the app. After this they are true of both.

---

## Built: the two pure functions (uncommitted, awaiting their caller)

`dealKindOf(type, structure)` and `dealDraftFrom(deal, fallbackCurrency)` in
`packages/shared/src/deal-terms.ts`, with **10 tests** (50 in that file) and **eight mutations, all
red**: money divided by a hard-coded hundred · an absent amount becoming a stated zero · shares
dropped on the way back · the split percent read as raw basis points · the ladder dropped · the
bonus dropped · the kind matched on shape alone · a shapeless deal not reading as `paper_only`.

Held back with QA7-18's API half for the same reason: the caller comes in the same ticket.

### The round trip earned its keep immediately — it caught three of my own inventions

Writing `createDealPayload(dealDraftFrom(deal))` and asserting the deal's own figures come back is
the whole test, and it failed three times before it passed, every time on something I had assumed
rather than read:

1. **A party's share is `{ splitBasisPoints }`, not `{ basisPoints }`.** My fixture invented the
   key; the code was right, because it goes through `shareBasisPointsOf`.
2. **`deals.terms` carries a flat `bonusThreshold` / `bonusAmount` pair, not a nested `bonus`
   object.** Here the **code** was wrong — it read a shape that does not exist and returned blanks,
   which would have silently dropped the bonus from every deal it edited. `DealTermsBody` in
   `routes/deals.ts` is the authority and says so in two lines.
3. **A replacement that does not match is a silent no-op.** My edit to one assertion never applied —
   biome had already reformatted the target onto one line — so the test kept reading a field that
   does not exist and reported `[undefined, undefined, undefined]`, and I spent a probe run looking
   for a defect in code that was correct all along. Every other edit in this stretch asserted
   `count == 1` on its anchor; this one did not, and that is the entire difference. **Assert the
   anchor matched, or the edit is a wish.**

Two of the three were mine and one was the code's, and the round-trip test is what separated them —
which is the argument for writing the inverse against the forward mapper rather than against a
description of it.

---

## Built, and proven against the spec's own sentence

One dialog serves both jobs, because every rule, problem and notice in the composer applies to a
stored deal read back through `dealDraftFrom`. What "editing" changes is which draft it opens on and
which mutation the submit calls.

- `useDealComposer` takes an optional `seed` and, when given one, opens on `dealDraftFrom(seed)` with
  the kind from `dealKindOf` and `nameEdited` already true — a deal that HAS a name must not have it
  overwritten by the party-name suggestion.
- `useEventAgreements.revise(dealId, draft, expectedVersion)` sends the figures through
  `PATCH /deals/:id`, carrying `expectedVersion` (decisions #8) so a concurrent edit is a 409 rather
  than a silent overwrite. `advanceAmount` and `terms` are always sent — `null` where absent —
  because *"I removed the advance"* and *"I emptied the ladder"* have to be expressible, and an
  omitted key would leave the old value standing.
- `canReviseTerms` on `DealActions`: `canManage && !frozen && not cancelled`. It mirrors the server
  rather than guessing — `PATCH` already refuses a signed agreement's terms (`movedSignedTerms`, 409)
  — which is the rule this stretch has now applied six times: never offer what the API will refuse.
- The party section is **read-only** when revising, every control `disabled`, with the reason on
  screen: *"Parties are set when the deal is composed."* Shown rather than hidden, because the party
  list is the first thing an operator checks before changing what a deal pays. The SHARE field is
  disabled with them — a share lives on `deal_parties`, so it travels with the list and the PATCH
  cannot carry it either.

### Proven on the running stack

The dialog, opened on the reopened seed deal (`sent`, nobody signed):

| | reading |
|---|---|
| title / submit | **"Edit the figures"** / **"Save the figures"** |
| NAME | pre-filled *"Album Release — Door Split"* |
| SHARE OF THE ADJUSTED NET (%) | pre-filled **100**, editable |
| the two party shares | pre-filled **60** and **40**, `disabled: true` |
| every party and role control | `disabled: true` |
| "Add a party" | **absent**, replaced by *"Parties are set when the deal is composed."* |

Then the two saves, and the second is the one that matters:

| | before | after |
|---|---|---|
| advance, set to 500 | `advanceAmount: null`, version 2 | **`"50000"`**, version **3**, split and status untouched |
| split, changed 100 → 70 | planner: *Performer fee **SEK 50,000** — "100% of the adjusted net"* | planner: *Performer fee **SEK 35,000** — "**70%** of the adjusted net"*, TOTAL COSTS SEK 69,245, P&L **+SEK 13,755** (was a loss) |

That second row is Ran's 2026-09-21 spec, quoted in the brief, finally true: *"Editing offered terms
while pending should re-seed the budget, not hold a stale figure."*

### One more found while proving it

The kind chooser's own description read *"A share of the pool — revenue less the costs paid to
outside suppliers"* — **#23.1's retired wording**, in `DEAL_KIND_OPTIONS`, rendered directly under
the chooser in this very dialog. The same correction QA7-25 made to the wizard's hint, one layer
deeper, and the tenth instance this stretch of copy stating a rule the code does not keep. Now *"A
share of the adjusted net — revenue less deductions and anything off the top."*
