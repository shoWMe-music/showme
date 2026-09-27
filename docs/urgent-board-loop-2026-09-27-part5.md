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
