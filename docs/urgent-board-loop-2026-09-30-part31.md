# Urgent board loop — part 31 (2026-09-30)

Part 30 closed at 385 lines with five of run 12's eleven findings shut: the MAJOR (`7dc1f3d` — the
terms seal at the first signature on all four surfaces, plus an observer's timestamp no longer
sealing a night's figures), the deals-data pair (`76e657b`), and the attention card's two
(`4740791`). Six left.

## 1. [MINOR] An invitation sent TO you, listed under "Outgoing Requests" — run 12 §2 line 198

**Which file settles it:** `apps/web/src/routes/Requests.tsx` — and NOT at line 609 where the sweep
points, which is the render. The render is the symptom; the two `useMemo`s above it are the cause.

**What was measured**, as `performer.a@` on `/requests` → **Outgoing**:

> OUTBOUND / Outgoing Requests / Offers and requests **you have sent**, and where they stand.
> …
> **1 event invitation**
> **Nordic Synth Showcase** — Sat, 5 Dec 2026 · The Lantern Hall · from The Lantern Hall
> *Astra Booking Agency answers this for you*

The tab's own subtitle says what belongs on it. An invitation the Lantern Hall sent *to* Marlo is not
something Marlo sent, and it is already on Incoming, correctly, with Accept and Decline.

**The verdict — and gating the render would carry its own next defect.** Two lists feed that card,
`visibleInvitations` and `addressedHere`, and **the empty-state condition twenty lines below reads
both of them**:

```tsx
{visible.length === 0 && visibleInvitations.length === 0 && addressedHere.length === 0 ? (
```

Gate only the render at `:609` and the Outgoing tab with no sent offers shows **neither the
invitations card nor the "nothing here" card** — a blank panel, because the empty state still counts
invitations it is no longer drawing. **A FIX CARRIES ITS OWN NEXT DEFECT, eighth time this stretch**,
and this one is visible from the source without running anything.

So the gate goes in the two `useMemo`s, where the filters already live (`filter`, `selectedDay`). One
clause each, and every reader downstream — the card, its heading count, and the empty state — agrees
by construction.

**Why not hide the Outgoing tab for performers instead?** Because a performer genuinely has outgoing
offers: `canSendOffer` is `!isOperator && kind !== "team_and_crew"`, and the tab is where they see
what they pitched. The tab is right; only the invitations belong to the other side of it.

**The decision it hides: none.** `direction` already means "requests targeting me" versus "offers I
have sent" (the comment at `:311` says exactly that), and an invitation is unambiguously the first.
Operators never reach this at all — they are forced to `incoming` at `:346`.

### What landed, read live as `performer.a@` (Marlo Vance)

```
Incoming Requests  → "1 event invitation · Nordic Synth Showcase"   ✓ still there
Outgoing Requests  → Marlo's own two pending offers to The Lantern Hall
                     no invitation card, and NOT a blank panel
```

The blank-panel risk was real and was avoided by gating the derivation rather than the render: the
empty-state condition twenty lines below the card counts both invitation lists, so a render-only gate
would have shown neither the card nor the "nothing here" placeholder.

### The rules moved out of the render, and a mutation deleted one of them

`apps/web/src/components/inboxInvitations.ts` — `participationInvitationsInView` and
`addressedInvitationsInView`, with 9 tests. Both were `useMemo` filters inside `Requests.tsx` where
nothing could test them, and one had been missing its `direction` clause for as long as the card
existed.

Seven mutations, all killed:

| Mutation | Verdict |
|---|---|
| the direction gate removed from participations — the defect | KILLED (2) |
| the direction gate removed from addressed invitations | KILLED (2) |
| direction inverted | KILLED (7) |
| the status chip no longer narrows | KILLED (2) |
| addressed invitations shown under every chip | KILLED (1) |
| the day rail ignored | KILLED (2) |
| an undated row passes the day rail | KILLED (1) |

**An eighth mutation survived and cost a line: `if (view.filter === unreadFilter) return false`.** It
can never be the deciding test — `requestStatus` is a closed set (pending · accepted · declined ·
expired · cancelled) and the unread bucket's name is in none of it, so the status match below already
excludes the whole bucket. **THIRD instance of a surviving mutation meaning "this line is redundant"
rather than "this line is untested"** (`rooms.length < 2` and the on-behalf-of conditional were the
first two). The clause went, and the `unreadFilter` parameter it needed went with it — a narrower
signature as well as one fewer branch.

The product reasoning was worth keeping and is now a comment on the clause that actually does the
work, with a test asserting the exclusion over **every** status the enum has: *"it happens to miss"*
and *"it cannot match"* are different claims, and only the second is safe to build on.

Suites: biome 748 files · web 585 (was 576).

---

## 2. [MINOR] Projections shows a co-promoter the whole night's margin — run 12 §2 line 248

**Which file settles it:** `apps/web/src/lib/eventProjection.ts` for the rule, `Projections.tsx` for
the sentence. Not new arithmetic — the sweep is explicit that the sum is right.

**What was measured**, as `co.host@` (Northlight Presents), whose entitlement on that night was
**SEK 7,500**:

> PROJECTED REVENUE **SEK 83,000** · PROJECTED COSTS **SEK 33,000** ·
> **REVENUE − COSTS SEK 50,000** — *60% of revenue, before deals* · AVG PER EVENT **SEK 50,000**

**The verdict.** The label was already fixed once for a neighbouring reason — it says *"Revenue −
costs"*, not *"Net Profit"*, and its comment records the SEK 50,000-over-a-SEK-1,245-loss case. But
that fix was about **the deals**, and the paragraph beneath still only explains the deals. There are
**two** reasons the figure is not the reader's, and only one of them is written down:

1. the deals have not paid out yet — said, at length
2. **the reader is not the only operator on the night** — not said at all

The Budget Planner already draws this second line and says so out loud (*"N of this event's deals are
not shown to you… Profit, margin and break-even are left out rather than calculated without them"*),
which is the precedent the sweep is pointing at. Projections is the same figure on the same ledger one
screen over.

**The decision this hides, and it is why the answer is a caption and not a redaction.** The planner
*withholds* profit and margin from a reader who cannot see every deal. Projections could do the same —
but the two screens are not asking the same question. The planner answers *"what does this night
leave me"*, which is unanswerable without the deals. Projections answers *"what is the shape of my
pipeline"*, and revenue-minus-costs over a portfolio is a real answer to that whichever operator is
reading it — the totals are the ledgers' own and the reader is entitled to them
(`budget.view` gated them already). **Withholding here would remove the screen's only figure to fix a
sentence.** So: say whose money it is, and how many of the nights in view are shared.

**The rule, and it is a rule rather than a string:** an event is **co-promoted from the reader's point
of view** when its `hostProfileId` is not one of the reader's own profiles. `hostProfileId` is already
on the events list, the reader's profiles are already in the session, and no request is added.

A performer never reaches this: `budget.view` is a pool capability refused to them, so
`GET /events/:id/budgets` gives them nothing and every tile reads `—`. The caption is therefore an
operator's sentence, which is the only reader it can be about.

**The scope.** `coPromotedCount(events, myProfileIds)` in `lib/eventProjection.ts` with tests, and one
conditional line under the existing paragraph naming the count. The tiles, the labels and the
arithmetic are untouched.

### What landed, read live on `co.host@` (Northlight Presents)

```
PROJECTED REVENUE  SEK 83,000   1 event budgeted
PROJECTED COSTS    SEK 33,000   All-in
REVENUE − COSTS    SEK 50,000   60% of revenue, before deals
AVG PER EVENT      SEK 50,000   Per show, before deals

Every figure here comes from the event's shared ledger. What the deals pay the acts is not a
budget line, so it is not subtracted … [unchanged]

This night is run with another operator, so the ledger — and this figure — covers the whole
night rather than your share of it. What you are owed is on the event's settlement.   ← NEW
```

Every tile, label and figure is untouched, which is the point: the sweep is explicit that the
arithmetic is right and the missing thing is the sentence.

**The singular branch is the one that fired**, because this reader has one budgeted night in view —
*"This night is"*, not *"All 1 of these nights are"*, which is the obvious wrong answer and has its
own test.

### Mutations — six, all killed

| Mutation | Verdict |
|---|---|
| nothing is ever co-promoted — the defect | KILLED (3) |
| the host test inverted (the reader's OWN nights counted) | KILLED (3) |
| a missing `hostProfileId` counted as somebody else's | KILLED (1) |
| the note never shown | KILLED (4) |
| the note shown when nothing is shared | KILLED (1) |
| the all-shared wording collapsed into the partial one | KILLED (1) |

The third is the one worth naming: `!mine.has(event.hostProfileId ?? "")` looks equivalent and is
not — it counts a night whose host the payload did not carry as somebody else's, putting the caveat
on every row of a narrower response. **AN ABSENT THING IS THE WEAKEST EVIDENCE THERE IS**, and here
it would have produced a confident sentence about a split nobody had established.

Suites: biome 748 files · web 595 (was 585).
