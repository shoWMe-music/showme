# Urgent board loop — 2026-09-27, part 8

Continues `-part7.md`. Same standing instruction; same rules — plan in this doc before
building, prove it on the running stack, run the suites, commit naming the ticket. Nothing
deployed, nothing written to ClickUp.

---

## QA sweep run 5 — `QA5-4`, and a correction to the sweep

**Verdict: half of it does not reproduce, and the half that does is worse than the report
says.** Not on the board.

### The correction first

The sweep's headline is that the **Place a hold** dialog's VENUE field is *"a plain text box
— no picker, no suggestion list… typing 'Lan' produces no options"*, so the hold is created
with `venue_profile_id = NULL`. **Driven again in the browser, it has one.** `Place a hold`
opens `NewEventWizard` in hold mode, which renders `EventVenuePicker`; clicking the field and
typing `Lan` offers **MY PLACES → The Lantern Hall · Stockholm**, choosing it links the
profile (the field grows an *Unlink The Lantern Hall* control and the venue's carry-over
line appears), and the hold then lands with the profile set:

```
title                        status   event_date  venue_profile_id  venue_name        hold_rank
Nordic Synth Showcase        on_hold  2026-12-04  …a1               The Lantern Hall  1
QA5-4 Second Hold on 4 Dec   on_hold  2026-12-04  …a1               The Lantern Hall  2
```

The dialog's own HOLD PRIORITY card reads **"2nd hold — 1 hold is already competing for this
date"** rather than the *"attached to a venue, and queues separately"* line the sweep quoted.
The picker is in the tree as of `5610067` (02:25 today, the QA4-14 fix); run 5 either drove a
stale bundle or typed the name without opening the popover. **Recorded rather than rebuilt:
there is nothing here to fix.**

### The half that does reproduce, and it is reachable without any of that

Typing a venue name and NOT picking a profile is a supported path — `EventVenuePicker`'s own
docstring says so, *"plenty of rooms are not on shoWMe, and a booking must never wait for one
to sign up"*. A hold placed that way is in **no queue at all**, because the pool is keyed on
the venue PROFILE. So its placement sees no competitors and writes no rank — correct, by the
design `HoldPlacement.tsx` states out loud:

> *"A lone first hold needs no rank write: `hold_rank` is nullable and every reader treats
> NULL as rank 1… Calling the rank route here would write nothing while still filing a
> `hold.ranked` line for a move that never happened."*

Attach the venue afterwards — from the workspace's Venue field, which has always had a picker
— and that NULL walks into a queue that already has a first. Measured on the running stack
before the fix:

```
GET /events/115c4f49…/hold   (operator)
  holdRank: null
  pool: [ Nordic Synth Showcase        holdRank 1 ,
          QA5-4 Typed Venue Hold       holdRank 1  (isSelf) ,
          QA5-4 Second Hold on 4 Dec   holdRank 2 ]
```

Two firsts, and **neither can be promoted**: `canPromoteToFirst` is `(holdRank ?? 1) !== 1`
(`hooks/useEventHold.ts:170`), so the button is disabled on both rows reading 1st. The tie is
unbreakable from the only screen that shows it.

### Scope

**The rule:** a hold that enters a contested queue with no rank of its own **joins at the
back**. One pure function, `rankForHoldJoiningQueue` in `@showme/shared` (beside the rank
arithmetic it belongs with), and one database half, `apps/api/src/lib/hold-queue.ts`, called
from the events PATCH inside the same transaction as the edit that moved the hold —
`touchesHoldQueue` gates it on `status`, `venueProfileId`, `stageId` or `eventDate` having
changed.

### The two decisions it hides

1. **The back, not the front.** The hold was being *displayed* as first by a fallback; it had
   never held a position. The back is also exactly where the placement wizard already puts a
   new hold (its rank select defaults to the last option), so this makes the server agree
   with the client rather than inventing a third behaviour.
2. **Only this event's row is written.** A queue spans operators — one room on one night is
   one queue, and two operators courting it are in it together — so renumbering the others
   would be writing rows this caller has no authority over. Keeping the write to one row
   leaves the rank route the only place that moves anybody else, where the capability check
   for it already lives.

A lone hold still keeps `NULL`, deliberately: the invariant this restores is **at most one
NULL per queue**, not "no NULLs".

### Mutation-tested, and three of nine survived the first pass

| Mutated | First pass | What it took |
|---|---|---|
| the call site in `events.ts` | red (3 tests) | — |
| `ne(events.id, event.id)` | red (4) | — |
| `eq(events.eventDate, …)` in the key | **green** | a hold on a different night at the same venue |
| `eq(events.status, "on_hold")` in the key | **green** | a **cancelled** hold that kept `hold_rank 4` — the confirm cascade writes `cancelled` and leaves the rank, so a dead 4th sits on the date forever and would have sent the next pencil to 5th |
| `eq(events.venueProfileId, …)` in the key | **green** | another venue's night on the same date |
| `isNull(events.stageId)` in the key | **green** | a pencil in a named room beside one on the whole venue |
| the own-host rule for a typed venue | **green** | a stranger's typed-in venue name on the same night |
| `lastRank + 1` → `lastRank` | red (3, in shared) | — |
| the empty-queue and already-ranked rules | red (1 and 2, in shared) | — |

Five survivors, all of them a queue-key clause that every existing test happened to satisfy —
the same failure as QA5-1's two survivors and worth the same sentence: **a test that passes
because the case never varies is not covering the line.** Two short-circuits in
`hold-queue.ts` are left uncovered on purpose and say so in a comment: a hold that already
has a rank and a dateless hold are both answered `null` by the pure function or by SQL
anyway, so the guards only save a query.

### Proven on the running stack

Same scenario as the report, rebuilt after a restart — a hold created with `venueName` only,
put on hold, then handed the venue profile:

```
before attaching the venue   holdRank null   pool [ (QA5-4 Typed Venue Hold, 1) ]
after  attaching the venue   holdRank 2      pool [ (Nordic Synth Showcase, 1),
                                                    (QA5-4 Typed Venue Hold, 2) ]
```

And in the browser, the hold panel on that event:

```
HOLDS ON THIS DATE
  1st  Nordic Synth Showcase
  2nd  QA5-4 Typed Venue Hold   This event
  2nd hold · [Promote to 1st]  ← enabled
```

Screenshot: `docs/screenshots/qa-2026-09-27-run5/qa5-4-queue-takes-a-number.png`.
