# Urgent board loop — 2026-09-29, part 29

Part 28 closed at 339 lines with eight of run 11's MINORs and all four COSMETICs. Six MINORs remain.

---

## 1. QA11-9 — Projections and the Budget Planner disagree by SEK 80,000

**Which file settles it:** `apps/web/src/routes/Projections.tsx` — **not**
`apps/web/src/lib/eventProjection.ts`, and the difference is the whole verdict.

**What was measured.** A tier typed on Event Details (`General Admission · SEK 250 · est 320`,
stored in `events.extras.ticketTiers`) gives the Budget Planner **TOTAL REVENUE SEK 163,000** and
Financial Projections **SEK 83,000** for the same night. No `budget_lines` row is ever written for
the tier; Projections reads stored lines only. The settlement DOES pick tiers up
(`seedTicketTiersIntoBudget`), so Projections is the odd one out — and its own arithmetic is right
for the lines it can see, hand-checked by the sweep.

**The verdict: the number cannot be made right by a third copy of the merge rule, and there are
already two.** A tier only becomes revenue if no line already states it, and that rule is written

- in the web, `mergeTicketTierSeeds` (`useBudgetEditor.ts:184`), and
- in the API, `seedTicketTiersIntoBudget`'s `alreadyStated` (`settlement-lines.ts:215-260`),

each with a comment saying it must agree with the other. It has three cases — match by tier id,
match by lowercased name, and `statesItsOwnDoor`, where a hand-typed door row suppresses the event's
tiers entirely. That third case exists because getting it wrong **showed SEK 57,000 on a SEK 25,000
night**. Reimplementing it a third time, on a money screen, is how that returns.

**So this part does the half that cannot be wrong, and names the half that needs doing properly.**
Projections says what its figures do not include — which is what the sweep's own "Expected" offers
as the alternative, and what that screen already does twice (for deals it cannot read, and for
events with no budget). A third sentence is idiomatic there rather than novel.

**The follow-up, with its shape, so it is a task and not a wish:** move the merge rule into
`@showme/shared` as one function over minor units, have `mergeTicketTierSeeds`,
`seedTicketTiersIntoBudget` and Projections all ask it, and serve `ticketTiers` on the events list
so Projections has the input. That is a refactor of two pieces of working money code plus a payload
change — worth doing deliberately, not as the tail of a cosmetics pass.

**The decision it hides: should a tier on Event Details write a budget line when it is typed?**
That would make all three agree at the source and is tempting — and it is a product call, not a bug
fix: it would mean Event Details writes into the planner's ledger, which is the coupling
`mergeTicketTierSeeds` exists to avoid. Recorded, not taken.

### What landed — and the second half of the same room

Both screens now say what they are, read live with the sweep's own tier in place:

```
Budget Planner   TOTAL REVENUE SEK 163,000
                 640 tickets planned across all types — more than the room's 400 capacity
Projections      Marlo Vance — Album Release   SEK 83,000
                 "…A ticket tier entered on Event Details is not a budget line either, so it is
                  not added here until the planner or the settlement writes it in — and the
                  planner, which reads those tiers directly, will show more."
```

A reader on either screen can now tell which number is theirs and why, in the direction it differs.

## 2. QA11-14 — 640 tickets planned in a 400-capacity room

Taken in the same commit because it is the same sheet and the same cause: **tiers on Event Details
ADD rows to whatever the planner already holds**, so two plausible sets of numbers make one
impossible one. `grep -rn "exceeds capacity\|over capacity"` across `apps/web/src` and
`packages/shared/src` returned nothing — the planner had no concept of the room being full, while a
`Venue capacity 400` field sat two rows below the count and the chart beneath was captioned *"inside
400 capacity"*. Every per-guest figure divided by 640.

Said **on the subtitle that already states the count**, not as a new banner: the reader is looking at
that figure when they need to know, and on a sheet this tall a notice elsewhere is one they scroll
past. Five tests — over, under, exactly full (`>` not `>=`: selling the room is the plan working),
capacity unset (zero means nobody has said how big the room is, which is most draft sheets, and a
warning there teaches the reader to ignore it), and the singular.

**The browser caught my own fixture error on the way:** the first `ticketTiers` I wrote by hand used
the planner's field names (`unitAmount`/`maxQuantity`/`estimatedSales`) and the stored shape is
`price`/`max`/`est`, so the event answered **500** and the screen read *"Couldn't load this event"*.
Worth recording because the DB took the write happily — `extras` is `jsonb` and validates on the way
OUT, so a hand-written fixture can be malformed in a way only a page load reveals.

---

## 3. QA11-15 — "All rooms" lists a sold Friday as free

**Which file settles it:** `apps/web/src/hooks/useAvailabilityShare.ts` — the chip labels, and the
clipboard text built from them.

**What was measured.** Calendar → Check & Share Availability, venue The Lantern Hall, room **All
rooms**: the list offers **Fri, 16 Oct 2026** as a bare chip — the night of the confirmed Album
Release — and **Copy dates** copies that union. Technically true (the 80-cap Back Room is free) and
unusable: a promoter pasted those dates is being told a 400-cap Friday is open. Selecting **Main
Room** correctly drops it.

**The verdict: the data is already right and the SENTENCE is a union.** The snapshot carries
`rooms[]`, room-scoped and correct — `rooms[Main Room].availableDates` excludes 16 Oct and
`rooms[Back Room]` includes it — beside a flat `availableDates` that does not. The same hook
computes both, three lines apart. The flat one feeds the chips and the clipboard, and a union across
rooms is only meaningful if you say which room.

**The scope.** When the whole venue is selected and more than one room is in play, a chip names the
rooms free that night; a night when **every** room is free stays a bare chip, because naming all of
them is noise on the ordinary case. The clipboard follows, which is where the harm actually
happened. A room-scoped share is untouched — it has one room and already says so in its heading.

**The decision it hides: should the flat `availableDates` in the SNAPSHOT stop being a union?** No,
and not from here. It is what links minted before `rooms` existed carry, and the public page reads
it as the fallback for exactly those — changing its meaning would silently re-interpret every link
already in somebody's inbox. The chips are this screen's own rendering; the payload is a contract.

### What landed

Read live, the sweep's own night in a list of fifty-odd:

```
Thu, 15 Oct 2026
Fri, 16 Oct 2026 — Back Room      ← the sold 400-cap Friday, naming the only room that is free
Sat, 17 Oct 2026
```

Every other chip is bare, which is the point: the qualifier means something because it is rare.
**Copy dates** joins these same labels, so the text pasted to a promoter carries the room too —
which is where the harm actually was.

**And a surviving mutation deleted a line rather than adding a test.** The early-out was
`!wholeVenue || rooms.length < 2`, and removing the second half broke nothing. It is genuinely
redundant: a date only reaches this list because some room is free, so with one room that room is
all of them, and the all-rooms-free test below already returns a bare chip. **A surviving mutation
is a question, and this time the answer was "that clause is a second way of saying the same
thing"** — a second thing to keep true. The test for the one-room case stays, because the case is
worth pinning even though the code no longer has a branch of its own for it.

---

## 4. QA11-16 — a teammate with an account is named by their email

**Which file settles it:** `apps/api/src/routes/groups.ts` — and the comment in `Team.tsx` is the
finding in one sentence.

**What was measured.** Team lists **"PR / Professional / On shoWMe / professional@e2e.showme.test"**
for a person Contacts, two menu items away, calls **"Priya Sound"**. The row itself prints *"On
shoWMe"*, which it can only know from `group_members.user_id`.

**The verdict: the name exists and the payload does not carry it, and the fallback says so
out loud.** `Team.tsx`'s helper is introduced by

> *"No display-name field exists on a group member — derive a human label from the email local-part
> rather than surfacing a raw address as the name."*

**True of the payload and false of the data.** `serializeGroup` returns `id · userId · email ·
roleLabel` and never joins `users`, whose `name` column is right there and is what every other
screen reads. Instance twenty-seven, and the third this stretch of the same specific shape: a name
the API HAS and does not serve, with the screen doing its best with what it was given
(`targetName` on an outgoing offer, `delegateName` on an invitation, and now this).

**The scope.** A left join on `users` in `loadGroupDetail`, `name` on the member, and `Team.tsx`
preferring it. The email fallback STAYS — a group member invited by address has no account and no
name, which is the case that helper was written for and is still right for.

---

## 5. QA11-10 — one editing session, six identical bells

**Which file settles it:** `packages/db/src/notify.ts` — and the decision is which notifications may
collapse, not how to collapse them.

**What was measured.** `operator@` adds a guest and then a ticket tier to the Album Release. The
co-host's bell receives **six** `event.updated` rows, all reading *"'Marlo Vance — Album Release' was
updated / The ticket and guest details changed."*, three of them within **92 ms**:

```
23:50:44.086 · 23:50:20.548 · 23:50:20.504 · 23:50:20.456 · 23:50:14.149 · 23:50:03.707
```

Every one is an autosave inside one edit. There is no coalescing window anywhere in the app.

**The verdict, and the decision it hides is the whole item: WHICH notices may collapse?** Not all of
them. "A deal was sent" twice is two facts; "the ticket and guest details changed" twice is one
statement made twice. The property that separates them is already on the row — **an UNREAD
notification with the same `type`, the same `eventId` and the same `body` says nothing the reader
has not already been told.** Two genuinely different facts differ in the body, and once a notice has
been READ a new one is new news.

So: opt-in at the call site, `coalesceWithin`, and `event.updated` is the caller that takes it. A
blanket change to every notification in the app is exactly the sort of wide behaviour change that
should be asked for rather than inherited — the bell is where this product tells people their money
moved.

**The window is thirty minutes.** Long enough to cover an editing session (the sweep's spanned forty
seconds, but a planner session is minutes), short enough that a change the next morning is its own
notice. It bumps the existing row's timestamp rather than inserting, so the feed keeps saying *when
the details last changed*, which is the useful fact.

### What landed — both, read live

```
Team          PE · Priya Sound (FOH engineer) · On shoWMe · professional@e2e.showme.test
              (was "PR · Professional")

Six PATCHes to one event, as operator@, read as the co-host:
  type          | body                  | count
  event.updated | The capacity changed. |   1        (was six rows, one per autosave)
```

Three mutations killed on the coalescing: ignoring the read state, dropping the body from the key,
and collapsing for callers that never asked. That last one is the decision, so it has the test that
fails loudest — eight of them — because a mechanism that quietly decided "a deal was sent" twice is
one fact would be a worse bug than the one it fixes.

**Both of these are the same shape as the two before them:** a name the API has and does not serve
(`users.name`, one join), and a screen doing its best with what it was given. `Team.tsx`'s fallback
even said so — *"No display-name field exists on a group member"* — true of the payload, false of
the data. The email-derived label stays for the member invited by address who has no account, which
is the case it was written for.
