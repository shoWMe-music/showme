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
