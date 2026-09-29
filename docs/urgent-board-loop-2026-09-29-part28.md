# Urgent board loop — 2026-09-29, part 28

Part 27 closed all five of qa-sweep run 11's MAJORs and two of its MINORs, and reached 335 lines.
Eleven MINOR and four COSMETIC rows remain. This part starts with the one that is the same shape as
three of the MAJORs before it — **a sentence that is not true of whoever is reading it** — because
that shape is now at six instances and worth naming as a class rather than fixing one at a time.

---

## 1. QA11-16 — "As operator your share is retained", read by an operator holding nothing

**Which file settles it:** `apps/web/src/components/useEventSettlement.ts`, the `ownRetains`
predicate.

**What was measured.** `co.host@` with Full settlement access reads the Total Payouts panel:

> *"**As operator your share is retained**; below are the amounts payable to the other parties.
> Marlo Vance payout SEK 90,000. Total payable SEK 90,000."*

Northlight collected **SEK 0**, holds nothing, owes SEK 12,000 **in**, and is not paying Marlo
anything. Their own row is `held: "0", collected: "0", net: "-1200000"`.

**The verdict: a converse error, stated as a rule in the comment above the predicate.** It reads

> *"Whoever is HOLDING the night's money has a negative net — they are the one who pays everybody
> else, and their own share is retained rather than transferred."*

True, and the code tests the other direction: `parties.some(p => p.isYours && p.netTone ===
"negative")`. Holding implies a negative net; a negative net does not imply holding. A co-operator
who simply owes money in satisfies the predicate and gets the host's sentence. **Instance
twenty-five, and the first that is a converse error rather than a rule that went stale.**

**The scope.** `retained` requires the reader to actually hold cash — `collected > 0`, which is the
fact the sentence is about. That leaves the co-operator falling through to the next branch, and
**that one is not true of them either**: *"What this event pays out, including your own share"*,
when their own share is not in the list at all (they are a payer, not a payee). So the panel needs a
fourth case — the list is entirely other parties' money — and the four-way decision becomes a pure
function rather than a nested ternary in a component, which is what last tick's surviving mutation
taught.

**The decision it hides: is an operator who FRONTED the costs "retaining" anything?** No — they
collected nothing and are out of pocket, which is a different sentence again and not one the sweep
found on screen. `collected > 0` is deliberately the test rather than `paid === 0`, so that case
lands in the honest fallback instead of the wrong specific claim.

### What landed

`payoutsCaption` in `settlementDocument.ts` decides the panel's one sentence from four facts, and
the component takes the string. Read live as `co.host@` with Full settlement access, on a night
where they collected nothing and owe money in:

```
Total Payouts
What this event pays out to the other parties. Your own settlement is separate.
The Lantern Hall payout   SEK 60,000
Total payable             SEK 60,000
```

Both wrong sentences are gone — the retained claim and the "including your own share" one behind it.
Five tests, one per branch plus the fronted-costs operator who must NOT be told they retained
anything.

**AND THE FIX CRASHED THE SCREEN, which is the fourth time this stretch and the second caught in
the browser.** `ownHoldsCash` first read `party.collected`, which a `SettlementParty` carries
**already formatted** — so `BigInt("SEK 0")` took the whole settlement workspace down with
*"Something went wrong! Cannot convert SEK 0 to a BigInt"*. Every suite was green; tsc was happy,
because the field is typed `string | null` either way. It reads the minor units off `rows` now.
`docs/money.md`'s rule one layer along: **the browser never does arithmetic on formatted text** —
and the type system cannot tell the two strings apart, which is exactly why the browser check is
not optional.

Noticed in passing on the same screen, and correct: a losing night floors both performers at
`SEK 0` against a −SEK 80,000 adjusted net, and part 25's residual caption reads
*"The Lantern Hall's 25% of what is left after every other party is paid −SEK 20,000"* beside
*"Your 75% … −SEK 60,000"* — the possessive, the share and the sign all right in one line.

---

## 2. QA11-17 — "change it there", pointing at a door this loop shut

**Which files settle it:** `apps/web/src/components/useBudgetSeed.ts` (the fact) and
`BudgetPlanner.tsx`'s `ReadFromDealNote` (the sentence).

**What was measured.** On any confirmed deal, the planner's derived fee row reads:

> *"Read from the deal 'Marlo Vance · the guarantee beats the 70% door share'. Nothing is stored on
> the budget, so the settlement takes this figure from the deal — **change it there**."*

The API refuses precisely that: `movedSignedTerms` → 409 *"These terms are frozen … Reopen it for
renegotiation first"*. The screen sends the operator to a door that is shut.

**The verdict: true when written, and this loop is what falsified it — TWICE OVER.** The unsigned
branch of the same note is now wrong for a second reason the sweep could not have seen, because
QA11-1 landed after it ran:

- The note branches on `pending`, which is `deal.status !== "confirmed"`.
- The figures seal at the **first signature** (`termsAreSealed`, `657cb70`), which is a different
  boundary entirely.

So a deal that is still an offer with one party signed reads *"still an offer, nobody has confirmed
it. Nothing is stored on the budget: change the terms and this moves with it"* — and the API answers
409. **Both branches, one axis wrong.**

**The scope.** The note branches on **sealed** rather than on the deal's status, using the same
`termsAreSealed` the route and the Deals tab ask; `useBudgetSeed` already has each deal's parties
and their `confirmedAt` (it counts them for the "2 of 3 signed" line), so the fact costs nothing to
carry. Sealed gets a sentence that names the door that IS open — reopening, and what reopening
costs.

**The decision it hides: does the planner tell an operator that reopening tears up signatures?**
Yes. The Deals tab's own dialog says it, and a note that said only "reopen it" would send somebody
to a control whose consequence they learn from a modal. One clause, and it is the clause that makes
the advice actionable rather than a redirect.

### What landed

The note branches on **sealed** now, and reads live as `operator@` on the seeded confirmed deal:

> *"Read from the deal “Album Release — Door Split · 100% of the adjusted net”. Nothing is stored on
> the budget, so the settlement takes this figure from the deal — **and it is signed, so changing it
> means reopening the agreement for renegotiation, which clears every signature on it.**"*

`useBudgetSeed` carries `sealed` beside `pending` rather than replacing it, because **both are true
at once on the case that exposed this** — an offer nobody has confirmed, with one party signed — and
they mean different things. Three tests, one per state, and two mutations killed: nothing ever
sealed, and the signatures ignored in favour of the status alone.

**This is the fifth "a fix carries its own next defect" of the stretch, and the first where the
earlier fix was mine and the later defect was invisible until a sweep read the screen.** `657cb70`
moved the sealing boundary from "confirmed" to "first signature" and correctly updated the two
gates; it did not occur to me that a planner NOTE two screens away encoded the old boundary in
prose. A predicate has callers you can grep for. A sentence does not.
