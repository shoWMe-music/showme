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
