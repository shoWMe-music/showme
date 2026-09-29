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
