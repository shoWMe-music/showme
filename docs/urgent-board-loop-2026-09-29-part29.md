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

---

## 6. QA11-? (run 11 §2, line 221) — the attention card, and the sources it never reads

**Which file settles it:** `apps/web/src/routes/Dashboard.tsx` — but only the CAP lives there. The
real content is a question about **which sources belong on the card at all**, and the card states its
own rule twenty lines above the bug:

> *"What is left in 'Needs attention' is what somebody ELSE is waiting on: an event awaiting a
> decision, a booking request nobody has answered. A task is your own work, which is a different
> kind of urgency."*

That sentence is the test every candidate source has to pass. It is also why tasks were removed from
this card in an earlier commit, so it is a rule the file has already been willing to act on.

### The four things the sweep reported, judged one at a time

| # | The sweep's claim | Verdict |
|---|---|---|
| 1 | The count is capped at five and says five when there are six | **Real.** `attentionShown.length` is the *shown* count, printed as though it were the total |
| 2 | The order is unstable between the first paint and later ones | **Real.** `attention` is in ARRIVAL order — events, then requests, then deals — so which item survives `slice(0, 5)` depends on which query resolved |
| 3 | It never reads pending invitations or settlements sent for review | **Real, and the biggest half** — three seats out of six read *"You're all caught up"* while holding something somebody was waiting on |
| 4 | It never reads date-change requests | **NOT A DEFECT — the feature does not exist.** Measured: no route, no enum member, no column, no screen |

On row 4, the evidence rather than the assertion:

```
$ grep -rn "reschedul|date-change" apps/web/src apps/api/src packages/db/src
apps/api/src/calendar.test.ts:141   "Meet promoter (rescheduled)"      ← a calendar-note title
packages/db/src/schema/content.ts:77  "a DST rule change or reschedule"  ← a comment
packages/db/src/schema/events.ts:37   "reschedule-safe"                  ← a comment
```

`bookingRequestStatus` is `pending | accepted | declined | flagged | archived | expired` — there is
no `countered`, and `inbound.ts:1921` says so in as many words (*"no `countered` status, no message
table on the request, and inventing one is a…"*). **A report can name a real symptom over the wrong
line — this is the fifth instance, and the first where the named source was imaginary.** Adding a
source for it would have meant building a feature to satisfy a QA row.

### The sources that DO pass the rule — and there are three, not two

The sweep named two inboxes as one. They are different tables and different routes:

1. **`GET /me/event-invitations`** — an `event_participants` row at `invited`, for
   `INVITABLE_ROLES` = performer · support · crew_lead · crew. Filter: `requestStatus === "pending"`
   **and** `answerableByYou` — the second half is §25.7.3's ruling, *the act SEES, the actions stay
   with the agent*, so a delegated act must not be told to answer something it cannot answer.
2. **`GET /me/invitations`** — an `invitations` row addressed to the caller's verified email. This is
   the route that covers **co_host**, which `INVITABLE_ROLES` deliberately excludes, and is therefore
   the one that answers the sweep's `co.host@` bullet. Carries the token, which is the only page with
   Accept and Decline on it.
3. **`GET /settlements`** where the status is in the review conversation and **the reader has not
   signed their own line**. All three pass: somebody sent figures and is waiting for an answer.

**The decision source 3 hides, and it is the one that could go wrong quietly.** `pending_review`
moves for EVERY party by default (`settlement.ts:2330` — `participantIds` is optional and a fan-out
is right for sending), *including the operator who pressed the button*. So a naive
`status === "pending_review"` would put "review your figures" on the sender's own card — the card
telling you that you are waiting on yourself, which is precisely the rule inverted. The honest
predicate is the one the event-scoped read already serves: **`approvedByYou`**. It is not on
`MySettlementsResponse` yet, so this item is an API change as well as a web one.

Keeping the operator's own UNSIGNED line on the card is correct and deliberate: a settlement cannot
finalize until its lines are signed, so everyone on the night is waiting on that signature too. What
must not happen is re-asking for a signature already given.

### The scope

- `apps/api/src/routes/settlement.ts` — `approvedByYou` on `MySettlementsResponse`, folded with the
  same *"approved once is approved"* rule as the event-scoped roster. `approvalRosterOf` takes a
  nullable `eventId` rather than growing a second copy of that fold — **a rule written twice is
  asking for one home**, and this stretch has already paid for that lesson once.
- `apps/web/src/components/attentionList.ts` — **new, and the point of the change.** The assembly
  moves out of the component: five typed inputs in, a ranked list and the TRUE total out. Ninety
  lines of product rules currently live inside a render function where nothing can test them, and
  every judgement above is a line in there.
- `apps/web/src/routes/Dashboard.tsx` — read the three sources, call the module, print the true
  total, show five, and say *"and N more"* below them. **No "show all" link**, because there is no
  screen that lists all of it and a dead affordance is worse than an honest sentence.
- **The rank:** soonest night first, undated last, tiebreak on the item id so the order is total and
  the cut is deterministic. Not category order — the night that is closest is the answer that is
  most overdue, and a rank that depends on which query resolved is the bug being fixed.
- **One more thing on the way:** the empty state still reads *"Pending events, new booking requests
  and open tasks surface here."* Tasks were removed from this card deliberately and the sentence was
  not. **A sentence untrue of its reader, instance eight** — and it is about to be untrue twice over.

### What landed, and the defect the fix carried

Read live as `operator@`:

```
BEFORE  "You have 5 things that need attention today."     (six qualified)
AFTER   "You have 6 things that need attention today. The 5 closest are below."
        Check your figures on Marlo Vance — Album Release · 16 Oct 2026   ← NEW SOURCE
        Reply to The Midnight Echo · Booking request · 6 Nov 2026
        Reply to Marlo Vance · Booking request · 21 Nov 2026
        Confirm Nordic Synth Showcase · On hold · 5 Dec 2026
        Check your figures on Nordic Synth Showcase · 5 Dec 2026
        and 1 more, further out
```

Ascending by date with no exceptions, and the 5 Dec tie broken on the id, so the cut is the same on
every paint. The on-hold event still carries **its own** status word rather than the bucket's.

Read live as `professional@`, the seat the sweep measured saying *"You're all caught up"*:

```
"You have 1 thing that needs attention today."
  Answer Nordic Synth Showcase · Invited on crew by The Lantern Hall · 5 Dec 2026   → /requests
```

### A FIX CARRIES ITS OWN NEXT DEFECT — the sixth this stretch, and again only the browser said so

The first version of that seat read **two** things: the invitation, and *"Check your figures on Marlo
Vance — Album Release · sign off when they match your books"*. Following it:

```
$ api-as.mjs professional POST /events/…e1/settlements/<sid>/confirm
403 { "code": "forbidden", "message": "Missing capability: settlement.confirm" }
```

`CREW_FLOOR` carries `settlement.view.own` and **deliberately not** `settlement.confirm`. So a crew
member is sent the *"Check your figures and sign off"* email by `POST …/settlement/status`, is served
their own figures, opens a settlement screen with no sign-off control, and is refused by the route.
The card had just become the fourth surface asking for a signature the third one forbids — the dead
affordance QA6-1 exists to forbid, reintroduced by a fix for a card that was too quiet.

The fix is not to widen the floor. `GET /settlements` now serves **`signableByYou`** beside
`approvedByYou` — the same pair the event-scoped read has always served, resolved through
`effectiveEventCapabilitiesForEvents`, one round trip for every night in the list — and the card
reads it. Whether crew *should* be able to sign is a product call, and it is now **§25.6's seventh
open row**, with the note that the asking and the ability have to agree whichever way it goes.

**The lesson under the lesson: I reasoned out three sources from the card's stated rule and got all
three right, and still shipped a defect, because "somebody is waiting on you" is not the same
question as "can you answer".** Membership and capability are two filters and the rule only names
one. That is what the browser was for.

### Mutations — five, all killed

| Mutation | Verdict |
|---|---|
| `approvedByYou: true` always | KILLED (3 tests) |
| the roster read as ANY signature this reader has given | KILLED — **and it SURVIVED first** |
| `signableByYou: true` always | KILLED |
| `signableByYou` asks `settlement.view.own` instead | KILLED |
| the cross-event approvals read narrowed back to one event | KILLED (2 tests) |

The second row is the item worth keeping. `GET /settlements` is reader-scoped, so on a **one-night**
fixture *"did I approve THIS row"* and *"have I approved ANYTHING"* are the same sentence and the
mutation passed — with a test I had written and commented as **"THE CONTROL"**. The control was
standing on a gap the scoping already closes. The case that makes the field mean anything needs one
reader holding **two** settlements: sign one, and the other must stay unsigned. `seedNightFor` was
split out of `seedCoPromotedNight` to make that seedable, and the mutation died.

**A TEST THAT PASSES BECAUSE THE CASE NEVER VARIES IS NOT COVERING THE LINE** — and a comment calling
it a control does not make it one.

### What moved

- `apps/api/src/routes/settlement.ts` — `approvedByYou` + `signableByYou` on `MySettlementsResponse`;
  `approvalRosterOf` takes a nullable `eventId` so the fold has one home.
- `apps/web/src/components/attentionList.ts` (new, 280 lines) + `.test.ts` (**20 tests**) — the whole
  membership rule, the rank, the cut and the sentence, out of the render function.
- `apps/web/src/routes/Dashboard.tsx` — **90 lines of product judgement deleted** from the component
  body; what is left is reading sources and turning a target into a navigation. `NEEDS_DECISION` and
  the local `AttentionItem` went with it — one home each.
- `.claude/skills/verify-e2e/api-as.mjs` — the six seats are now addressable by their **email local
  part** (`professional`, `co.host`) as well as the camelCase keys. Every doc and QA report names
  them the first way, and a probe typed from one died on `INVALID_EMAIL` twice today.
- `packages/db/src/seed-e2e.ts` — a `lint/style/useTemplate` error that `biome check .` had been
  carrying and no per-file `--write` ever saw. **Run the whole check, not the part you touched.**
- `docs/decisions.md` §25.6 — the crew sign-off row, and the counts above the table corrected.

### Not a defect, with the evidence

The sweep's fourth bullet — *"date-change requests waiting on your answer"* — names a feature that
does not exist. No route, no column, no enum member, no screen; `bookingRequestStatus` has no
`countered` and `inbound.ts:1921` says inventing one is out of scope. Adding a source for it would
have meant building a feature to satisfy a QA row. **Fifth instance of a report naming a real symptom
over the wrong line, and the first where the named source was imaginary.**
