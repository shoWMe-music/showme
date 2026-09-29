# Urgent board loop — part 30 (2026-09-30)

Part 29 closed at 396 lines with run 11 fully shut: five MAJORs, fourteen MINORs, four COSMETICs,
and a full pass green with the stack down in one go (biome 746 · shared 343 · auth 36 · settlement
74 · db 25 · web 566 · API 1460 · e2e 116 including `tests/motion.spec.ts`).

**qa-sweep run 12 came back NOT clean** — `docs/qa-sweep-2026-09-29-run12.md`, 620 lines against
`2a4b624`, all six seats driven in a real browser. **BLOCKER 0 · MAJOR 1 · MINOR 6 · COSMETIC 4.**

All twelve re-checks hold, including the two hardest to prove: the attention card's count, order and
cut were **stable across a cold reload sampled every 40 ms** — one distinct state ever rendered —
and the quiet SSE nudge was proved with two independent seats, `co.host@`'s open Settlement page
moving SEK 7,500 → 4,500 → 7,500 with no reload while the bell stayed at "4 unread".

**Three of the eleven findings are in code I shipped in part 29's last tick.** That is the honest
headline of this report: the card was committed minutes before the sweep started and is the
least-proven thing in the app, exactly as run 12 was told.

## 0. Before anything — the seed would not restore, and the reason is worth keeping

`seed:e2e` is documented as safe on a running stack. It is not safe after a session has *created*
rows: it failed **four times in a row**, each on a different foreign key, because every row the sweep
made holds a reference the seed's own delete order cannot cut.

```
deal_parties_participant_id_event_participants_id_fk   ← QA12 seal probe's parties
budget_lines_paid_by_event_participants_id_fk          ← a "Marketing cost" line
shares_owner_profile_id_profiles_id_fk                 ← one share row
…and then audit_log, permission_sets, profile_*        ← 55 rows across six tables
```

The general cleanup is "delete every row whose id is not `e2e%`, repeatedly until a pass deletes
nothing" — two passes settled it. **And the first attempt reported `pass 1 deleted 0` while doing
nothing at all**, because `docker exec -i` inside a `while read` loop **consumes the loop's own
stdin**. The table list was eaten by psql. `< /dev/null` on the `docker exec` fixes it.

**A HARNESS THAT CANNOT MEASURE MUST FAIL LOUDLY** — this is the same lesson as the ANSI-coloured
vitest summary, one layer further out: a loop that silently processes zero items reports success.
The tell was that `shares` still held its row after a "successful" sweep.

---

## 1. [MAJOR] The sealed-terms ruling on its OTHER surfaces

**Which file settles it:** none of the three the sweep names. `packages/shared/src/deal-terms.ts`
already holds the rule, and `useEventAgreements.ts:179` already asks it. **The defect is that three
surfaces compute the predicate themselves instead of asking.**

**What was measured.** A two-party guarantee, `sent`, with **one** of two signatures on it. The
server seals it — `PATCH /deals/:did {"agreementBodyText":…}` answers **409** — and the card reads:

> **Terms live until every party signs**

directly above a live **Write terms** button, whose dialog repeats the superseded rule *"frozen into
the signed record once everyone has confirmed"*. Pressing Save produces the 409 as a toast.

**The verdict: this is A RULING IMPLEMENTED ON ONE OF ITS TWO SURFACES — second instance, and the
first where the ruling was mine from eight days ago.** Part 29's own commit message said the seal
moved to the first signature; `routes/deals.ts` says in its own comment *"`termsAreSealed` is asked
by the Deals tab too, so the screen cannot offer an edit the route will refuse."* **That sentence is
a comment that states a rule, and it is a test that never ran — instance twenty-eight.**

**The three lines, and what each one is:**

| Line | What it does | Why it is wrong |
|---|---|---|
| `DealAgreementCard.tsx:110` | `frozen = agreementStatus === "confirmed" \|\| "signed"` | drives the caption at `:331` **and** `DealTermsBlock`'s own `frozen` at `:342` — two wrong answers from one wrong predicate |
| `EventAgreementTab.tsx:225-229` | `canEditTerms` off the status | the editor itself; its comment states the superseded rule verbatim |
| `routes/deals.ts:1134` | `termsFrozen` = the status transition | so Event History prints *"Terms frozen at this confirmation"* against the **last** signature, two signatures after the terms actually sealed |

**The scope, and the shape of the fix.** Not three fixes — **one**, applied where the answer already
exists. `dealActionsFor` in `useEventAgreements.ts` computes `sealed` and hands out `canReopen`,
`canReviseTerms` and `canDelete` from it; it gains **`canEditTerms`**, and the tab reads that instead
of deriving its own. `DealAgreementCard` takes `termsAreSealed(deal, parties)` — it already receives
both arguments. `routes/deals.ts` computes `termsFrozen` from the PRE-transaction `parties` it
already has in hand: **this signature sealed the terms if no signatory carried a `confirmedAt`
before it.**

**The decision it hides:** none, and that is the point. The ruling was taken in part 29 §3 and the
seal already moved at the server; these are three readers of a settled rule. Which is why the fix is
to delete the private copies rather than to update them.

**A caption that becomes reachable.** `DealAgreementCard:319` already carries
*"Terms frozen — N of M parties signed"* — correct language for exactly this state, written for the
redaction case and currently unreachable on a partly-signed deal because `frozen` is false. Fixing
the predicate is what turns it on.

### What landed, read live on a deal that is `sent` with 1 of 3 signed

```
BEFORE  "Terms live until every party signs"   + a live [Write terms]  → Save = 409
AFTER   "Terms frozen — 1 of 3 parties signed" + [Confirm your line] [Reopen] [Cancel agreement]
```

`hasWriteTerms: false`, `liveCaption: false`, and the caption that had been written for this exact
state and was unreachable is now the one on screen. **Reopen** sits beside it — which is what turns
the 409's own instruction (*"reopen it for renegotiation first"*) into something the reader can press
instead of a sentence about an HTTP route.

Event History, same night, both halves:

```
A party confirmed the agreement · 1 of 3 parties confirmed · Terms frozen at this confirmation
A party confirmed the agreement · 2 of 3 parties confirmed
```

and in the activity rows behind it:

```
 deal.confirmed       | 3 of 3 | froze=false
 deal.party_confirmed | 2 of 3 | froze=false
 deal.party_confirmed | 1 of 3 | froze=TRUE     ← was the 3-of-3 row before this change
```

### A SECOND DEFECT, found while writing the test rather than reported: an observer's stamp sealed the terms

The first version of the test named *"an OBSERVER's timestamp does not seal the terms"* and gave the
observer `confirmedAt: null` — **it did not test its own name, and passed.** Given a real timestamp it
failed, because `termsAreSealed` read *every* party's `confirmedAt`:

```ts
return parties.some((party) => party.confirmedAt != null);   // observers included
```

`POST /deals/:did/confirm` stamps every line the caller stands behind and does **not** filter
observers, so an observer who pressed confirm sealed the figures for every party — while
`allSignatoriesConfirmed`, reading the same row, correctly ignored it and left the agreement `sent`.
**One stamped row, two predicates, opposite answers.** Everything else that counts signatures already
said `roleInDeal !== "observer"`: `/deals/awaiting-signature`, `allSignatoriesConfirmed`, the activity
rollup. This was the one that did not, and it is the gate on editing a night's money.

Fixed in `@showme/shared` so both `termsAreSealed` and `sealedTermsReason` share one `isSignatoryParty`
— and the API's `termsFrozen` now asks that same function **twice**, for the pre- and post-state, rather
than keeping the hand-rolled copy I had written an hour earlier:

```ts
const termsFrozen = !termsAreSealed(deal, parties) && termsAreSealed(current, fresh);
```

That copy had *already* disagreed with `termsAreSealed` about observers. **A RULE WRITTEN TWICE WILL
DISAGREE WITH ITSELF, and the second copy was mine, written in the same hour as the fix.**

### Mutations — six, all killed

| Mutation | Verdict |
|---|---|
| the seal never fires (the run-11 regression) | KILLED (3) |
| the seal counts observers again | KILLED (1) |
| the observer rule inverted | KILLED (3) |
| the terms editor back on the STATUS — the exact defect | KILLED (3) |
| the terms editor asks `canManage` instead of `canCompose` | KILLED (1) |
| `termsFrozen` back on the status transition | KILLED (1) |

### What moved

- `packages/shared/src/deal-terms.ts` — `isSignatoryParty`; `termsAreSealed` and `sealedTermsReason`
  both read it. One home, and the observer defect closed at the root.
- `apps/web/src/components/useEventAgreements.ts` — `canEditTerms` joins `canReopen`,
  `canReviseTerms` and `canDelete` on the `DealActions` object, off the `sealed` already computed
  there. The seal is now asked **once per deal** and every control on the card agrees about it.
- `apps/web/src/components/EventAgreementTab.tsx` — **eight lines deleted**, including the comment
  stating the superseded rule. It reads the hook's answer.
- `apps/web/src/components/DealAgreementCard.tsx` — `frozen` asks `termsAreSealed`; the
  `canEditTerms` **prop is gone**, because the card already receives `actions`.
- `apps/api/src/routes/deals.ts` — `termsFrozen` asks the shared function for both states.
- `apps/api/src/activity.test.ts` — **the assertion that pinned the old rule is flipped.** It read
  `termsFrozen: false` on signature one and `true` on signature two, under the comment *"that nothing
  froze yet"*. A test whose stated REASON has been superseded is the shape that hid an unsignable
  agreement once already (CLAUDE.md, `authorize.test.ts`).

Suites: biome 746 · shared 344 · web 574 · API `deals`+`activity`+`deal-confirmation` 95.
