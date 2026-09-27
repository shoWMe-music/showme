# Urgent board loop — 2026-09-27, part 5

Continues `docs/urgent-board-loop-2026-09-27-part4.md` (which holds the plan for
`123qy9rpe3q` and the §7 verdicts). Same rules; read-only on ClickUp, nothing deployed.

## `123qy9rpe3q` — built, live proof pending the sweep

The plan is in part 4. What building it produced:

**`packages/auth/src/presets.ts`** — `event.publish` into the `performer` preset, with the
reasoning for preset-over-floor beside it. **`packages/db/src/seed-capabilities.ts`** — the
same, in the seeds' single copy. This is the first change since that copy was
de-duplicated an hour ago, and **the equality test did its job**: it is what reminds you
the seed exists at all.

**`apps/api/src/lib/event-publication.ts`** (new) — `notifyPublicationChanged`, called
from all THREE doors onto `events.published`:

| Door | Who uses it |
|---|---|
| `POST /events/:id/publish` | the panel's Publish, either side now |
| `POST /events/:id/unpublish` | **new** — gated on `event.publish`, not `event.edit` |
| `PATCH { published }` | every operator screen that already did it this way |

The new route is the load-bearing one. Unpublishing was a `PATCH` under `event.edit` — the
title, the date, the venue, the capacity — which a performer will never hold and must not.
Without it, granting `event.publish` would have let an act put its own show on the public
internet **and not be able to take it off again**. Same act, same capability, both
directions.

**The web half.** `useEventPublishing` calls the new route, and derives `otherSideNames`
from the roster the event screen already holds (publicly-facing roles, standing statuses,
minus the acting profile) so the panel can name whose profile the page also appears on.
`EventPublishPanel` renders Ran's sentence on the act of publishing — a line, not a dialog,
as he asked — and says **"They have been notified"** in the past tense, because by then the
notification is written. A show with nobody else billed falls back to a sentence that names
nobody rather than printing a stray "and".

**What the tests pin.** Six new, all green first run, each mutation-checked:

| Mutation | Red |
|---|---|
| `event.publish` out of the `performer` preset | 3 tests, the first with the 403 it used to answer |
| the PATCH transition notify removed | the third-door test |
| the `before.published` guard on unpublish dropped | the "already dark is not news" test |

The refusal test is the one that proves the preset-over-floor decision: a performer handed
`view_only` is refused 403, which could only be true if `event.publish` is absent from
`PERFORMER_FLOOR`.

**Not yet done, and why:** the live browser check and the commit. The `qa-sweep` agent is
driving the running stack right now, the API does not hot-reload, and a restart re-seeds
the database — it would destroy the sweep's session mid-run and invalidate its findings.
The proof (a performer publishing their own show, the operator's bell, the sentence naming
the venue) is the first thing after the sweep reports. Suites so far: biome 716 · api
`events-list` 78 (6 new) · web 330.

## What the sweep found in this loop's own work — run 4

`docs/qa-sweep-2026-09-27-run4.md`: **8 major · 8 minor · 1 note block · 1 cosmetic**, over
every screen and every seeded account kind. Two of the majors are defects in what this loop
shipped today, and they are the two fixed first.

### QA4-1 — the delete refusal recommended a broadcast that achieves nothing · **FIXED**

`decisions.md` #25.3 lets the other-party clause give way to a cancellation, so that
refusal now ends *"if the show is off, CANCEL it… a cancelled show can then be deleted"* —
true only when no money exists, and it was checked **before** the settlement and invoice
clauses, which never give way. On a concluded, settled, invoiced night with a performer on
it, the first refusal was therefore the conditional one. The sweep followed it: the show
was cancelled, the performer who played it in May and was paid got a bell saying the night
was off, and the delete was refused anyway.

The docstring already stated the correct rule and the code did not match it. Money first
now. Proven on the running stack against the same seeded show.

**The lesson, stated because it generalises:** a refusal is not a message, it is an
INSTRUCTION, and it is followed. Adding a "do X instead" to one clause changed what the
whole ordered list means, and nothing in the change touched the order.

### QA4-9 — the row menu offered what the API refuses · **FIXED**

A performer looking at a show they had merely played was offered **Cancel show…**, and on
a cancelled one **Delete permanently…**. The API refused every press, correctly and for
the right reason, so nothing was ever damaged — but the 403 a performer sees reads *"This
part of the event isn't shared with you"*, which is about sharing rather than about the
authority they lacked. My menu consulted `status` and `archived` and never a capability.

**The cause is the `venueName` trap this file already tells four times.** The list route
computes each row's capabilities (`eventCapabilities`, batched per page) and
`serializeEvent` returns them — and `ListEventResponse` never declared the field, so
Fastify stripped it out of every row. Declaring it costs one line and no query.

The rule moved into `apps/web/src/hooks/eventRowMenu.ts` — pure, React-free, tested,
following `unavailabilityRanges` and `calendarChoice`, because reaching it through the hook
drags `AuthProvider` → `initializeApp()` into the test run. Eight tests, mutation-checked.
`archive` deliberately needs no capability: it is written on the caller's own participant
row, hides the show from their lists alone, and `event.view` is the whole gate.

Proven live as `performer.a@`: the menu on *Spring Warmup* now reads **Archive** and
nothing else.

### The publish work changed a decision I had made an hour earlier

`123qy9rpe3q` gave `event.publish` to the `performer` preset with a comment arguing the
agent should NOT have it — *"announcing a show is promotion rather than business"*. Driving
it on the real seed showed the cost: a performer whose participation is **delegated** gets
`DELEGATED_PERFORMER_FLOOR` and no band at all (`authorize.ts`: `if (delegated) continue`),
so on the seeded album release neither Marlo Vance nor their agent could publish. The one
act in the seed with representation was the one act that could not do the thing the ticket
is about.

The existing taxonomy answers it the other way: delegation moves the BUSINESS action
capabilities to the agent and leaves the act its view floor plus artistic authorship, so
publishing is on the side that moves — and that is what representation means. The `agent`
preset carries it now, with a test asserting both halves (the agent can; the delegated act
cannot, which is delegation working).

Also corrected by driving it: the sentence first printed *"on Marlo Vance, Neon Tide and
Northlight Presents's"* — a possessive on the last name of a list, on a name already ending
in s. Ran's own phrasing has no possessive in it: *"and the {performer} profile"*.

### QA4-3 — rider preview was broken end to end in local dev · **FIXED**

Two independent storage signers. `app.ts` decorates ONE (*"One signer for the whole
app"*) and mounts its sink with `createFileRoutes(app.storageSigner)` — but registered
`riderRoutes`, whose default export wires itself to `defaultStorageSigner()`. In a
credential-less environment that is a fresh **loopback** signer holding its grants in its
own maps, so every rider download URL was minted by a signer the sink had never heard of:
`400 Invalid or expired download URL`, on a URL fetched and redeemed inside the same
second. One line — `createRiderRoutes(app.storageSigner)`.

**Why no test saw it, and what the new one does instead.** Under `NODE_ENV=test` the
default signer is the deterministic FAKE, which is **stateless** — so two of them agree,
exactly as two real GCS signers do in production. The divergence exists only where the
signer holds state, which is the laptop, which is where the feature gets verified. A
behavioural test cannot reach it. So the test in `app.test.ts` injects a signer with a
**fingerprint** and asserts the app's answer bears it; mutating the wiring back makes it
fail with a visibly foreign URL.

Proven live, the whole path: `upload-url` 201 → `PUT` 200 → library rider 201 → attach 201
→ `preview-url` 200 → redeem **200 with the bytes back**.

### QA4-4 and QA4-8 — the house documents nobody could read · **FIXED**

The operator could attach a document and no act could see it: `scopedEventRiders` gives a
performer their own participant row and nothing else. A rider owned by a participant in an
**operator role** is now a house document, visible to everyone standing on the event.

**This does not override decisions #12, it completes it.** #12's rule is that a rider is
the ACT's own artifact — one performer's hospitality rider is not another performer's
business — and that is asserted in the same test that adds the widening: each act sees the
house document and its own, never the other act's. What #12 did not consider is the class
of document whose only purpose is to be READ by the act, which is precisely what Ran named:
*"{Venue Name}: Technical info · Equipment list · Rules of Behavior"*.

**The product had already promised it twice.** `shareScope.ts` sells the riders checkbox as
*"Their own rider and the venue's house documents"*, and `share-document.ts` scoped for
house documents by looking for `owner_participant_id IS NULL` — **a row shape the attach
route never produces**, because it always stamps the attaching participant. So the promise
was false for every share ever created. Both surfaces now read the same real rule.

**The crew see them too, deliberately.** A schedule-only bartender holds no `rider.view`,
inherits no act's rider, and now sees the house document alone — and *"Rules of Behavior"*
is written for exactly them.

Proven live on all six seeded kinds, against the sweep's own table:

| | before (sweep) | after |
|---|---|---|
| operator / co-host | everything | unchanged |
| performerA | Tech Rider 2026 | **+ House Rules** |
| performerB | Hospitality Notes | **+ House Rules** |
| agent | Tech Rider 2026 | **+ House Rules** |
| crew (schedule-only) | nothing | **House Rules alone** |

Suites: biome 718 · api **1342** (4 new; `performance-reports` lost to the Testcontainers
flake and green alone) · web 338 · e2e 112.

### QA4-8, first half — a share of a cancelled show read as a live booking · **FIXED**

The viewer printed *"THE SHOW · Marlo Vance — Album Release · 14 Oct 2026 · Doors 19:00 ·
On stage 20:00"* with nothing anywhere saying the night was off, while its own footer
promises *"This page reads the event as it stands right now — it is not a copy."* The
public event page has always handled this (a cancelled event 404s from
`GET /public/events/:id`); a share is addressed to somebody ON the bill, so it says so
instead of vanishing.

The API already served `event.status` in the document — the viewer never read it. A banner
above the grid rather than a row inside it: a reader scanning a share for their set time
does not read every row, and this is the one fact that makes the rest of them moot.

**Proven live on one share page, both halves of QA4-8 at once.** A protected share of the
cancelled album release, opened as `performer.a@` through the real OTP: the card now leads
with *"This show has been cancelled. The details below are what was planned…"*, and after
attaching a house document as the operator, the same page — which reads live — lists
**Tech Rider 2026** *and* **The Lantern Hall — House Rules**, which is the sentence the
dialog has been selling all along.

## Still open from run 4, and why

| Finding | Why it is not fixed here |
|---|---|
| **QA4-2** (major) a co-host can rename and CANCEL the host's show | **A decision, not a defect.** `event-delete.ts` says *"the show is not theirs to end"* and the date move is already protected by a change request every party must answer — so the sweep's argument is strong. But a co-promoter legitimately calling off a night they co-produce would be blocked, and the mechanism that would fix it properly (a cancel REQUEST, like the date one) is a feature. Recommendation: require the host profile to cancel, mirroring delete. **Ran's call.** |
| **QA4-5** (major) the co-host's Budget Planner prints a break-even it promises to leave out | **FIXED** — see below. Deferring it to the vocabulary session was wrong: this is a figure being drawn, not a word being chosen. |
| **QA4-7** (major) an invite never attaches the act's agent, and the agent is never told | The outbound invite chain (item 2 of this loop). A real gap, separate from what was built today, and the biggest of the four left. |
| **QA4-10 … QA4-20** (minors + cosmetics) | Queued behind the remaining §2/§5 items. None blocks a journey; each is named in the sweep report with its route and account. |

**The seed after this iteration** is mutated again (the album release is cancelled and
carries an operator rider and a share link). A `pnpm dev` restart re-seeds; nothing should
be quoted from the running database without one.

### QA4-5 — the break-even the screen promised not to compute · **FIXED**

The co-promoter's Results panel says, in the app's own words, *"Profit, margin and
break-even are left out rather than calculated without it"* — and drew the break-even
chart immediately below that sentence, with a marked crossing point and the caption
*"Revenue passes total cost at 131 tickets of 400 capacity"*. The 131 came off
`TOTAL COSTS (PARTIAL)` SEK 34,770, which excludes the SEK 85,000 performer fee the
co-promoter is not a party to. The same night reads *"Revenue never passes total cost
inside 400 capacity"* on the host's screen.

**I deferred this one in the last iteration on the grounds that it lives in the surface
whose vocabulary session is owed. That was wrong**, and worth writing down: the
terminology session is about what figures are CALLED. This was a figure being computed
and shown after the screen had promised not to — a correctness bug with a
straightforward answer.

**The cause was two readings of one condition.** The KPI tiles were withheld off
`editor.hiddenDealCount > 0`, written inline; the note came from
`costsIncompleteNoteFor`, written separately; and the chart consulted neither. There is
now one `costsAreIncomplete`, both callers use it, and the test asserts the invariant
rather than either branch: **whenever the note is shown, break-even is withheld** — the
note *is* the explanation for the absence, so a chart under it is a contradiction and not
an oversight.

`breakEven` is null for that reader rather than a chart with its caption removed: the cost
LINE is what is wrong, so there is no honest version of the picture. The whole section
goes, because an empty "Break-even analysis" heading under that sentence would read as a
failure to render.

**Found while proving it:** the chart's `aria-label` was unconditional, so a night that
never breaks even announced itself to a screen reader as *"Revenue passes total cost at 0
tickets of 400 capacity"* while the caption underneath read *"never passes"*. The one
reader who cannot see the chart got the opposite of what it shows. Fixed in the same pass.

Proven live on the same event and the same two accounts the sweep used: as `co.host@` the
Results panel now goes straight from the note to the breakdowns with no chart; as
`operator@` the chart is still there, reading *"Revenue never passes total cost inside 400
capacity"* — and its image label now says the same thing. biome 718 · web 341 (3 new) ·
e2e 112.
