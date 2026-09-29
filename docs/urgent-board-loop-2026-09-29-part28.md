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

---

## 3. Run 11's cosmetics — one cluster, because three of them are the same mistake

**Which files settle them:** `EventDetailsTab.tsx`, `Settings.tsx`, `packages/shared/src/deal-terms.ts`.

### The three, and what they share

| Row | Actual | The shape |
|---|---|---|
| Guest List | *"**1** tickets"* | A count with no plural rule |
| Settings → Billing | *"Active **Free_operator** · Source **manual**"* | A hand-rolled `titleCase` where `humanizeEnumValue` exists |
| Edit figures | `20000.00` where the New-deal dialog takes `20000` | A draft pre-filled to the minor unit |

The middle one is the familiar gate — *"nothing hand-rolls what the design system has"*.
`Settings.tsx` has a local `titleCase` that capitalises and does **not** replace underscores, which
is precisely `humanizeEnumValue`'s first half and nothing else; `source` went through neither. Same
dedup as QA10-13's `Requests.tsx`.

### The third one has a test whose NAME is the argument for changing it

`dealDraftFrom` pre-fills the editor from stored minor units via `minorToDecimalString`, which always
emits the full fraction — so a SEK 20,000 guarantee arrives as `20000.00`. The sweep called SEK a
currency with no decimals; it is not, and `20000.00` is exact. What makes it wrong is the screen
beside it: the New-deal dialog takes `20000`, so one dialog echoes what you typed and the other adds
two zeros.

And the test that pins it is titled **"brings the money back in MAJOR units, as somebody would have
typed it"** — asserting `"3000.00"`. Nobody types `3000.00` for a round amount. **The name is a
claim about the code and the assertion contradicts it**, which is the trap this loop has now hit
four times from the other direction. A zero fraction is trimmed; a real one is not, and the test
says both.

**The decision it hides: does trimming lose precision anywhere?** No — it is the DRAFT's pre-fill
only, the string a human is about to edit, and it round-trips through the same parser either way.
`minorToDecimalString` is untouched, because everything else that calls it is printing a figure
rather than seeding an input.

### And a dead ternary found on the way

`useEventSettlement.ts:1285` reads
`options?.participantIds?.length === 1 ? "Sent for review." : "Sent for review."` — **both arms
identical**. Whatever distinction was intended is not there, and a conditional that cannot branch is
a comment pretending to be code.

**Not in this cluster, and said rather than implied:** the narrow-width empty grid cells need a
layout change and a width I cannot reach (Chrome clamps at ~500px here, per the sweep's own §5), and
the 640-tickets-in-a-400-room row needs a new notice rather than a corrected one. Both stay open.

### What landed — all four read live in one `operator@` session

```
Settings → Billing   PLAN Active · Free operator · Source Manual      (was Free_operator / manual)
Guest List           1 ticket                                          (was "1 tickets"; empty reads "0 tickets")
Edit figures         20000                                             (was 20000.00)
```

The Guest List gave both branches on one screen: `0 tickets` before the guest was added and
`1 ticket` after, which is the positive-and-negative control this loop keeps asking for. `titleCase`
is deleted — it was `humanizeEnumValue`'s first half and nothing else, and `Source` went through
neither.

**Not fixed, and worth writing down rather than quietly doing:** there are **38** hand-rolled
`n === 1 ? … : …` pluralisations across `apps/web/src`. A `pluralise` helper is justified by the
review gate's own test (three or more real call sites), but converting thirty-eight strings inside a
cosmetic fix is a large mechanical diff over COPY, where a regression is invisible to every suite.
Left as a named follow-up rather than half-done.

**And the dead ternary is gone.** `useEventSettlement.ts` had
`length === 1 ? "Sent for review." : "Sent for review."`. Whatever distinction it meant is not in
the code, and both arms produced the same toast.

---

## 4. The invitation trio — one missing fact, three symptoms

**Which file settles them:** `apps/api/src/routes/participants.ts`, `GET /me/event-invitations`.

Three of run 11's MINORs are the same hole seen from three seats, and the third is a **ruling of
Daniel's that was implemented on one of its two surfaces**:

| Row | Who reads it | What is missing |
|---|---|---|
| QA11-12 | `agent@` | *"1 event invitation — QA11 Money Night · from The Lantern Hall"* — nothing says it is **Marlo Vance's** |
| QA11-13 | `performer.a@` | Marlo sees **nothing at all**; `GET /me/event-invitations` → `[]` |
| QA11-11 | `performer.a@` | An outgoing offer is headed by the reader, never the venue it went to |

**The verdict on QA11-13: §25.7.3 is done for booking requests and not for event invitations.**
Daniel ruled *"the act SEES; the **actions** stay with the agent, which is what #14 actually
moved"*. Marlo's Outgoing tab correctly shows the offer Astra sent *"via Astra Booking"* — the same
rule, the other surface, already right. Here the list filters on `answerableInvitations`, and the
comment above it states the pre-ruling behaviour as though it were the rule:

> *"A delegated act's invitation belongs to their agent, and **disappears from the act's own list**
> — their screens are read-only on it (decisions #14)."*

**Read-only and absent are different things, and §25.7.3 chose the first.** Instance twenty-six, and
the second of the "correct when written, then a ruling moved underneath it" variant.

**And QA11-12 falls out of the same fix.** The row that makes Marlo's invitation visible to Marlo is
the row that knows Astra answers for it; turning that around, the row on Astra's screen is the one
that knows it is Marlo's. One pair of fields — *is this mine to answer* and *whose is it* — closes
both, from opposite ends.

**The scope.** `GET /me/event-invitations` returns a delegated act's own invitation as well as the
agent's, with `answerableByYou` and the other party's name; the Requests card renders a
non-answerable one read-only, naming who is answering, and an answerable one naming the act it is
for. The **notification** for this event already says both — *"You were added to the show as Marlo
Vance's agent"* — so the wording has a precedent on the same event, and the card is the only place
it is missing.

**The decision it hides: does a read-only invitation let the act see MORE than before?** No. This
route is deliberately the thin slice — *"who is asking, which night, where"*, no budget, no deal, no
roster — and it stays that. What changes is whether the act can see that the night exists at all,
which is exactly what §25.7.3 ruled on.

**QA11-11 is a different shape and is NOT in this commit:** the API serves `targetProfileId` and no
name, so naming the recipient needs a join in `GET /booking-requests`. Same screen, different
change — recorded rather than bundled.

### What landed

`GET /me/event-invitations` returns everything the caller may SEE, with `answerableByYou` carrying
the half that is about acting and `delegateName` naming the other end. Read off the live API, the
same invitation from both seats:

```
agent       Nordic Synth Showcase | answerable True  | delegate Marlo Vance
performerA  Nordic Synth Showcase | answerable False | delegate Astra Booking Agency
```

And read live in the browser as **Marlo Vance**, on a night they previously could not see at all:

```
1 event invitation
Nordic Synth Showcase
Sat, 5 Dec 2026 · The Lantern Hall · from The Lantern Hall
Astra Booking Agency answers this for you
```

— with **no Accept or Decline anywhere on the page**. That is §25.7.3 exactly: the act sees, the
actions stay with the agent.

**The test that had to change said so itself.** *"sends a represented act's invitation to their
AGENT, not to the act"* asserted the act could not see the event, under a comment reading *"the
act's screens are **read-only** on it"*. Read-only and absent again — the reason and the assertion
had never agreed, and the ruling settled which one was right. Its name is still true and still
asserted; what changed is the second half. A control was added beside it for an UNrepresented act
(`answerableByYou: true`, `delegateName: null`), because without one the new assertions would pass
over a list that had simply stopped filtering.

The agent's own line — *"Answering for Marlo Vance"* — is the same expression's other branch and is
verified by the payload above rather than by a second seat switch. Said plainly.

---

## 5. QA11-11 — an outgoing offer never says who it went to

**Which files settle it:** `apps/api/src/routes/inbound.ts` (the name) and
`apps/web/src/routes/Requests.tsx` (`requesterName` / `toCardData`).

**What was measured.** `performer.a@` → Requests → **Outgoing**. Every card is headed **"Marlo
Vance"** — the reader themself — and expands to WANTED DATE / SOURCE / FEE / EMAIL / MESSAGE. The
venue it was sent to appears nowhere, under a tab whose own subtitle is *"Offers and requests you
have sent, and where they stand."*

**The verdict: the card names the act because it was written for the INBOX, and the outgoing tab
reuses it whole.** `requesterName` is `onBehalfOfName ?? artistName ?? contactName` — the right
answer for a venue reading its inbox and a tautology for a sender reading their own outbox. The API
gives it nothing else to use: `targetProfileId` is a uuid, and no name comes with it.

**The scope.** `GET /booking-requests` already joins `profiles` for `onBehalfOfName` and `stages`
for `stageName`, both in one pass and both for exactly this reason — *"a second round trip per row
would be absurd"*. A second aliased join on `profiles` for the target adds `targetName`, and the
card's heading asks which direction it is reading.

**The decision it hides: does naming the recipient disclose anything?** No — the sender chose them.
`targetProfileId` is already in the payload; this only stops the screen from making the reader look
it up. What stays scoped is the read receipt, which the route already withholds from a sender
(*"whether a venue has opened your offer is the venue's business"*) and which is untouched.

### What landed

`targetName` joins in the same pass as `onBehalfOfName` and `stageName`, and the card asks which
direction it is reading. Live, as `performer.a@` on the Outgoing tab — both cards, and the calendar
beside them:

```
TH  The Lantern Hall          TH  The Lantern Hall        REQUESTS BY DATE
    Pending                       Pending                   21 Nov 2026  The Lantern Hall
    Marlo Vance · 7m ago          via Astra Booking · 7m    11 Dec 2026  The Lantern Hall
```

Every one of those read **"Marlo Vance"** before — the reader's own name, three times on one screen.
The sub-line still says who sent it, which is the half that was always right.

Three mutations killed, and the middle one needed the lesson from two items ago: dropping the JOIN
fails an API test, but **the card's direction branch survived everything** — it is the fix, so
`requesterName` is exported and tested directly, and the two mutations that matter (never asking the
direction, and not preferring the target) now fail. Same move as `breakEvenKpi`, for the same
reason.

**Watch the fallback chain rather than the first branch:** `targetName` is null only if the profile
was deleted, and a card headed by the act beats one headed by nothing — so the outgoing chain falls
through to the incoming answer rather than to a blank. There is a test for that and one for the
no-name-at-all case in both directions.
