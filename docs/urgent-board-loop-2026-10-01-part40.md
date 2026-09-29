# Urgent board loop — part 40 (2026-10-01)

Part 39 ends with runs 14 and 15 closed in full and the whole pass green (biome 757 · shared 354 ·
auth 41 · settlement 82 · db 25 · web 658 · **API 65 files / 1507 tests / 0 skipped** · **e2e 118**).

**QA sweep run 16: NOT CLEAN — 2 MAJOR, 8 MINOR, 6 COSMETIC, 3 NOTE**
(`docs/qa-sweep-2026-10-01-run16.md`, 871 lines). All six of the brief's re-checks on run 15's work
pass; the two MAJORs are new. One of them is **mine, from last tick**.

---

## MAJOR A — my own fix, in the seat it did not consider

### What I did, and what it cost

`5fd1826` changed the settlement stage rows from one-per-event to one-per-settlement. That was right
and it fixed run 15's MAJOR: a party-scoped kind needs a party-scoped subject, and four of six seats
could previously read none of their own settlement's history.

It also **multiplied the operator's own feed by the number of parties**, and the rail's query is
paged at 20 with no `limit` passed. On the six-party Album Release:

```
one press of "Send for review" → 6 × settlement.pending_review
one party comment              → 6 × settlement.comments_received + 1 × settlement.commented
one press of "Add revision"    → 6 × settlement.revised
                                 = 21 rows against a page of 20

operator's own feed:  pending_review 4 of 6 immediately
after ten more remarks:  pending_review ZERO — it falls off the page entirely
rail then reads:  ✓ Open · ② Pending review · ✓ Comments received · ✓ Revised · ● Finalized
```

An unlit stop between two ticked ones, on a settlement the operator sent for review itself. **This is
run 15's MAJOR in the mirror seat** — and my browser check passed because, having been burned the
other way the tick before, I checked the *party* seats.

The commit message even anticipated the objection and answered it wrongly: *"`from`/`to` travel so
those rows are distinguishable by their own transition"*. One press gives all six rows the **same**
`from`/`to`, and the detail renderer's whitelist prints neither — so the Revision history shows six
copies of one sentence, three times over.

### The verdict: change the READERS, not the writes again

I have re-targeted these rows twice. The third change must not be a third targeting, because the
write is now correct: **scoping** genuinely needs one row per settlement. What is wrong is that two
readers ask the wrong question of it.

- **The rail asks "which stages ever happened".** That is a question about SET MEMBERSHIP, and it is
  being answered by reading the newest page of a list — so the answer degrades as the event gets
  busier, which is the one failure mode `settlementDocument.ts` says out loud it exists to prevent:
  *"an unlit stop that did happen is a second way of being wrong."* A page cannot answer it at any
  limit, because 4 stage types × N parties + every remark grows without bound. `GET /activity` gains
  **`distinctTypes`**, which returns the newest row per type and nothing else — at most four rows for
  this caller, whatever the bill. That is the standing lesson again: when a list is asked two
  questions, add a route through it rather than widening the list.
- **The history asks "what happened, newest first".** Six identical lines is the right ROWS and the
  wrong rendering. They collapse to one line carrying the count — a display fold of rows that are
  literally the same sentence about the same act, which needs no product call because it invents no
  new claim. (It is NOT part 29 §5's notification-coalescing question: that was about suppressing a
  *notice*, this is about printing one timeline entry for one button press.)

### Scope

1. `GET /activity` gains `distinctTypes` (boolean), ANDed onto the existing visibility WHERE exactly
   as `typePrefix` is, and returning the newest row per `type`.
2. `SettlementRail` passes it. `RevisionHistory` does not — it wants the story, not the set.
3. The history folds consecutive same-`type` rows into one line with a count.

### The decision it hides — none
Every part is settled by a rule already written: the kind map says `settlement` is party-scoped, the
rail's own docstring says it must not understate, and a fold of identical lines makes no new claim.

---

## MAJOR B — "Flag a dispute" un-finalizes a locked settlement

### What is actually wrong, and what is deliberate

The allowance is old and deliberate (`94adc8f`): *"A DISPUTE may be raised over frozen figures — that
is precisely when a party most needs to say the number is wrong, and flagging it changes no money."*
That stands. **The defect is that it is implemented by overwriting the one column that records
finalization**, so everything hanging off that column falls over together:

- the finalize dialog's promise — *"cannot be un-finalized, not from this screen and not from the
  API"* — becomes false;
- the rail rewinds: Revised and Finalized become **unvisited future stops** on a settlement finalized
  minutes earlier;
- two contradictory pills render side by side: *"Disputed"* and *"Finalized — figures and rates
  locked"*;
- **`signableByYou` returns and the confirm route accepts a signature on frozen figures** — walking
  straight around `ca08a8e` and `3c65b41`, both of this week;
- and the two operators disagree about the same night, because only the disputing party's row moved.

Money is safe: `settlement_snapshots` still holds the finalized record for all seven rows. This is a
status-and-display fault.

### Which half is mine to take

The report gives two defensible answers, and **(a) — carry the objection in `settlement_approvals`
instead of in `status` — is already a §25.6 row awaiting Daniel** (the objection row from §25.8.2,
which proposes exactly that and shares a migration with the signature-clearing row). So the shape of
the eventual fix is not mine to choose.

What is ruling-independent is that **finalization must stop being a fact that a later status move can
erase.** Under either answer, a settlement that has been finalized has been finalized. The durable
record already exists and the report points at it: a `settlement_snapshots` row for the event.

So, and no further:

1. **The lock becomes durable.** The confirm route and both `signableByYou` reads treat "this event
   has a settlement snapshot" as locked, in addition to the row's current status. A signature on
   figures that were frozen is refused whatever happened to `status` afterwards. This is the half that
   touches consent, and it is why this cannot wait for the ruling.
2. **The rail's Finalized tick becomes evidence-based**, from `settlement.finalized` in the feed, the
   same way stages 1–3 already are. A dispute then cannot rewind past it, because the rail stops
   inferring history from the current status — which is precisely the lesson stage 1–3 were fixed on.
3. **One pill.** *"Finalized — figures and rates locked"* survives and carries the objection; two
   sentences that contradict each other never render together.

Deliberately NOT done: the dialog's promise is left alone. It is true under ruling (a) and false under
(b), and rewriting it now would be writing copy to match a defect that a pending decision may remove.
The §25.6 objection row gets this MAJOR's evidence instead.

---

## Both MAJORs built and proved

Eight mutations killed — three on `distinctTypes` (including **the dedupe running before the
visibility WHERE**, which would have leaked exactly one row of everything) and five on the durable
lock (including both directions: never remembered, and every night remembered).

### MAJOR A, live, on run 16's own data

```
the rail's own query, as operator on e1 (20-row page):
  paged:    commented 12 · revised 6 · finalized 1 · comments_received 1   cursor: yes
            → settlement.pending_review: ZERO. Exactly the symptom.
  as a set: one row of each of the five types                              cursor: null
```

In the browser, as `operator@` on the same event run 16 measured:

```
before:  ✓ Open · ② Pending review · ✓ Comments received · ✓ Revised · ● Finalized
after:   ✓ Open · ✓ Pending review · ✓ Comments received · ✓ Revised · ● Finalized
```

and the Revision history folds: *"Figures re-issued after review · 5 parties"* where six identical
lines stood.

### MAJOR B, live, on the row run 16 disputed

```
GET /events/…e1/settlements as performer.b
  wasFinalized: True          ← the fact `status` stopped recording
  dispute · signableByYou = False                (run 16 measured True)
POST /events/…e1/settlements/9c3b7582…/confirm
  409 "These figures are already final, so there is nothing left to sign.
       Signatures given before they were finalized still stand."    (run 16 got 200)
GET /settlements  →  dispute · signableByYou = False
```

and one pill instead of two contradictory ones:
**"Finalized — figures and rates locked, with an objection on record"**.

### The browser caught my own copy, for the sixth time

The fold's first version printed *"· N parties"* on every folded line. True of a status move — one
press moves one row per settlement — and **false of remarks**: ten comments by one person read
*"A remark was added to the review · 10 parties"*. The noun now comes from the type
(`repeatedActivityLabel`), with a bare multiplier as the default rather than a guessed noun, because a
type added later would otherwise inherit a claim nobody checked. Live: *"· 10 remarks"*.

---

## Five MINORs — two of them my own unfinished work

### M1 · "Send to <party>" on a finalized settlement — the same shape as last tick's Approve

`3c65b41` withdrew Approve on frozen figures this week and did not look one card along.
`SettlementDeliveryCard` drew **Send to <name>** for every party, and
`POST /settlement/status` answers *"This settlement is finalized; its figures can no longer be
re-issued"* every time. §25.7.2's standing rule again, tenth instance.

The ADDRESS half stays: an off-platform party can still be given an address after the freeze, because
the invitation is how they read the record rather than a request to re-issue it. The caption changes
with the button — *"Reached in the app. These figures are final, so there is nothing left to send
out."*

### M6 · the cancelled-night fix reached two of its four surfaces — also mine

Run 15's fix landed on the Requests inbox and the invitation landing page. Run 16 found the other two:
the **Dashboard attention card**, which sat *"Answer Winter Gala"* directly above a live invitation in
identical styling, and the **post-accept success state**, still reading *"You are in — Winter Gala is
on your shoWMe account now"* — the one screen the reader looks at after deciding, and the exact
sentence run 15 filed.

Both fixed. The success panel now heads *"Answer recorded"* and says the night was cancelled before
they answered, so nothing is booked by it today. Two mutations killed on the attention row, including
the suffix firing on every invitation.

**This is the fifth time in this stretch the browser has caught my fix being partial, and the second
time the miss was "another surface of the same sentence".** The prompt's own note says to check every
branch that renders; four surfaces of one fact is the same instruction one level up.

### M3 · nothing said who asked, or who declined

`proposed_by_profile_id` is written in the same transaction and no reader used it. The bell said
*"Somebody has asked to change the date"* with no `actorDisplay` — the only row in the list with no
*"by X"* line — and the in-event banner named the proposer in none of four seats.

All three now name the **profile**: a co-promoter asking to move a date is *Northlight Presents*
asking, which is what the other parties recognise, not the user who pressed the button. The decline
notice gains `actorDisplay` too, which `notifyBillChangeApplied` already sent on the confirm path — one
rule, and only one of its two halves had it.

### M4 · a disclosure caption false about the one field its rule exempts

*"…it is left out of what the performers, their agents and **the crew themselves** are sent"* — and
`serialize/participant.ts` deliberately sends `callTime` to the crew member, arguing it: *"withholding
the instruction to be in the building at 16:15 from the person being asked to turn up makes the
engagement unperformable."* `payNote` and `privateNote` are withheld, correctly.

An operator reads that caption before deciding what to type, so it now names the right fields: the
crew member sees **their own call time and task**, and never the pay or private notes.

### M2 · a date move waiting on your answer was on the bell and nowhere else

The Dashboard's own empty state promises *"Events awaiting a decision"*, and a pending move of a
confirmed, published, settled night — the most time-critical decision in the product — reached it in no
seat. An agent with the change request sitting in its bell read *"You're all caught up. Nothing needs
your attention today."*

`GET /events/change-requests/awaiting-answer`, the same shape `/deals/awaiting-signature` and
`/settlements/awaiting-signature` already have and added for the same reason. **Answerable only**: a
party with no vote already sees the banner on the event, and this list is "what is waiting on you".

Live, with a proposal from the co-host on e1:

```
operator     1  [Album Release · Northlight Presents]
agent        1  [Album Release · Northlight Presents]
performer.b  1  [Album Release · Northlight Presents]
co.host      0  []                                       ← the one who asked has nothing to answer
Dashboard (operator): "Answer the change to Marlo Vance — Album Release"
                      "Northlight Presents asked to change the date · 16 Oct 2026"
```

Three mutations killed, including the proposer never being named and every change reading as a date
move.

### M5 · the stale-consent badge fired on every party, every time

`c8f1446` built *"Signed off · Figures changed since"* so an operator can see whose consent is stale
before finalizing, and derived it from `updated_at > approved_at`. The **pool ladder is stored inside
every party's breakdown**, so a cost edit anywhere legitimately rewrites every row, moves every
`updated_at`, and lit the badge for everyone. Measured on Priya Sound: a flat SEK 4,000 guarantee,
entitlement and net unmoved by a minor unit, badge on.

One column was answering two questions — *"was this row rewritten"* and *"has what this party signed
changed"* — and the second is about consent. So the party's own money got its own clock:
**migration 0049**'s `figures_changed_at`, stamped only when `samePartyFigures` (the stored comparison
with the ladder taken out) says their entitlement, net or composition moved. `lines` stays in, for the
reason its sibling carries it: a guarantee moved so that it still loses to the door share leaves every
total identical and changes what the settlement SAYS to them.

Backfilled from `updated_at`, which reproduces today's behaviour exactly — deliberately the
over-warning direction, because silently un-warning a stale signature somebody may already have acted
on is the one irreversible mistake available here.

Three mutations killed, including leaving the ladder in and treating nothing as a move. And **one
existing assertion was flipped**, because a FIX superseded it: `settlement-own-read.test.ts` moved
`updated_at` by hand and expected the badge — which is exactly the defect. That half now asserts
silence, and a second half moves `figures_changed_at` and asserts the badge.
