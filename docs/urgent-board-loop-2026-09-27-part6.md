# Urgent board loop — 2026-09-27, part 6

Continues `docs/urgent-board-loop-2026-09-27-part5.md` (which holds the QA-sweep run 4
fixes). Same rules; read-only on ClickUp, nothing deployed.

## `86cbcn1je` — a face is a door wherever there is a page behind it

**Verdict: the ticket is an epic and the audit scoped it correctly.** `86cbcn1je`
("Booking: requests, offers & discovery") carries ten bullets. Four are ticked by Ran.
Three of the rest belong to other tickets and are already built or separately planned —
the venue+room autofill is `123qy9rpqp0` (built in item 1 of this loop), the double-booking
warning is `123qy9rprbx`, and the whole *"Accept request → draft event / Make offer inside
Deals"* rework is the request-to-event flow, which is not a small fix by any reading.

**The one small, unblocked bullet is this:** *"Profile avatars across the platform show
images but still don't link to the public profile pages."* `ProfileFace` was written for
exactly that and has **one** call site (`routes/EventDetail.tsx`); every other roster draws
a bare `Avatar`.

### Where it goes, and where it deliberately does not

`ProfileFace`'s own docstring carries the constraint that decides most of this: *"Never use
this inside an already-clickable row — a link within a link is not a thing."* So the sweep
of twenty files answers itself, and the answers are worth recording so the next pass does
not re-litigate them.

| Surface | Verdict |
|---|---|
| `EventDetailsTab` — the Performers card | **Door.** `performer.slug` is already in scope (`ProfileNameMenu` uses it) and the row is a plain div |
| `EventCrewPanel` — the crew row and the In-House card | **Door.** Needs `publicSlug` carried on `CrewMember`; it is on the roster the list is built from |
| `Events.tsx` — the headline act on a list row | **No.** The whole row is a click target that opens the event, and the face is an 18px `aria-hidden` decoration beside the name |
| `EventMessagesTab` — the thread rail | **No.** The row is a `<button>` that selects the thread |
| `GroupCard`, `AudienceCard`, `AppShell` | **No.** Each sits inside a button, and the last one is the reader's own face |
| `Team.tsx` | **No.** A team member is a USER, not a profile with a public page |
| `CommentThread`, `SettlementShares`, `SettlementViewingAs`, `WhoOwesWhomBoard`, `EventSettlement` | **No.** Initials only — no avatar and no slug on those payloads. Making them doors is an API change to the settlement serializers, not this bullet |
| `Contacts.tsx` | **No — and it is a different ticket.** `123qy9rngc8` asks for exactly this (*"any contact who is an active user … can be clicked to reach their public profile"*) and it needs a contact→profile join that does not exist |
| `Profiles.tsx`, `ProfilePublicPreview` | **No.** Both already carry an explicit "Open public page" affordance; a second door to the same page is noise |

### Scope

Two components, one interface field, no API change, no new copy. The slug is only ever
non-null for a PUBLISHED profile — the serializer decides that, not the caller — so an
unpublished act and an off-platform hand added by name both keep a plain face rather than
a link onto a 404.

**No decision hidden.** The rule was already written down; this applies it.

### Built

`ProfileFace` gained one prop and lost one assumption. It hardcoded a **50 % border radius
on the link wrapper**, which is right for the circle it was written beside and wrong for
the two rosters it was rolled out to — both draw SQUARE faces, so using it as-is would have
silently changed the design in order to add a link. `shape` now passes through to `Avatar`
and the wrapper computes the same radius `Avatar` computes for that shape, so the focus ring
and the hit area follow the picture instead of describing a circle around a square.

| Surface | What changed |
|---|---|
| `EventDetailsTab` Performers card | the face is a link; the same `slug` the name's menu already used, so the two cannot disagree about whether a page exists |
| `EventCrewPanel`, both places | `CrewMember` carries `publicSlug`, mapped from the roster in `EventDetail.tsx` — no API change, the field was already on the wire |

Proven live as `operator@` on the seeded album release:

```
Performers  link "Marlo Vance — public profile" → /profile/e2e-marlo-vance
Team/Crew   link "Priya Sound — public profile" → /profile/e2e-priya-sound
In-House    link "Priya Sound — public profile" → /profile/e2e-priya-sound
```

**And the negative case, on the running stack rather than in the component's logic:**
setting Neon Tide's profile to unpublished and reloading leaves their face a plain avatar
with no link at all (and their name stops being a menu, because `ProfileNameMenu` has
nothing to offer either). That is the whole reason the API sends a slug only for a published
profile — a link built from a slug alone would 404 for everyone who has not published.
Restored afterwards.

Suites: biome 718 · web 341 · e2e 112.

## `123qy9rnk3m` — auto logout

**Verdict: real, and the audit is right that nothing exists.** Ran's two lines are the whole
spec: *"Log out from the account If no activity for 1 hour (default)"* and *"Add to security
settings and allow changing the time or disabling auto log out."* Tagged `security`, and
duplicated on the old board as `86c9mhqu6`.

### Which files settle it

| File | What it holds |
|---|---|
| `apps/web/src/lib/idleLogout.ts` | **new** — the rule, the options, and the stored value. Pure, so it can be tested |
| `apps/web/src/lib/idleLogout.test.ts` | **new** |
| `apps/web/src/hooks/useIdleLogout.ts` | **new** — the listeners and the timer, in the shell |
| `apps/web/src/shell/AppShell.tsx` | one call |
| `apps/web/src/routes/Settings.tsx` | the Security panel row |

### The decision this hides: whose setting is it?

**Per DEVICE, in `localStorage`, and the row says so.** The alternative is an account-wide
column, which is a migration and an API surface — and this repo already carries three pending
migrations. More to the point, it would be inventing a policy: an account-wide idle timeout is
a statement about every browser the user ever signs in on, and `decisions.md` does not rule on
it. Per-device is also the honest reading of the thing being protected — an unattended screen —
and a user who wants it everywhere can say so once Ran decides. **Recorded here for him to
overrule**; moving it server-side later changes the storage line and nothing else.

### The four ways this goes wrong, and what answers each

1. **A sleeping laptop.** `setTimeout` is not a clock: a machine suspended for three hours
   fires it late or not at all. So the rule is a comparison of WALL-CLOCK timestamps, re-checked
   whenever the tab becomes visible or regains focus — a user coming back to a laptop that slept
   past the limit is signed out on the spot.
2. **Two tabs.** Last-activity is written to `localStorage`, so typing in one tab keeps the
   other alive. Without that, a background tab signs the user out from under the tab they are
   working in.
3. **A timer that cannot fire.** The countdown is a fallback, not the mechanism: the decision is
   always the timestamp comparison, so the worst a missed timer costs is lateness, never a
   missed logout.
4. **"Off" meaning zero.** The stored value is parsed through a whitelist of minute counts, and
   anything unrecognised — a hand-edited key, a value from a future version — falls back to the
   ONE-HOUR DEFAULT rather than to off. A security default must not be weakened by a typo.

### Built, and what proving it changed

Three files plus a settings row, and **two of the three interesting decisions came out of
driving it in a browser rather than out of writing it.**

**1. Mounting is not activity.** The first version seeded the in-memory stamp with
`Date.now()`, which won the `Math.max` against the real stamp in storage — so a laptop
that slept for three hours and restored its tabs, or any reload after an idle spell, came
back with a fresh clock and the session survived **exactly the situation the feature exists
to end**. The stamp now starts null; storage is authoritative at mount.

**2. Signing in has to stamp itself, and the hook cannot do it.** With (1) fixed, a
returning user was thrown straight back out by their own stale history: the stamp from two
hours ago was still in storage. The obvious fix — listen for activity whether or not
anybody is signed in — does not work, because the hook lives in the shell and **the shell
is not rendered on the sign-in screen**. So `recordSignInActivity()` is called by the
explicit sign-in actions in `AuthProvider`, and deliberately not by the silent session
restore beside them: a person pressing "Sign in" is present, a token refreshing itself on a
closed laptop is not.

**3. A guard that no test could fail on, deleted.** `isIdlePastLimit` had an explicit
future-stamp check. Mutating it away turned nothing red — because the subtraction already
handles it (`now − future` is negative, and a negative is never past the limit). A line
claiming to do something it does not is worse than no line; it is gone, with the reasoning
in its place. The same check in `millisecondsUntilIdle` is NOT redundant (it would return
more than the limit) and is pinned by its own test.

Proven live as `operator@`, all three states:

| | result |
|---|---|
| Security panel | **Sign me out when idle** offers 15 min · 30 min · 1 hour · 4 hours · 8 hours · Never, with "this device" said out loud |
| Choosing *Never* | stores `off`, read back as never |
| Limit 15 min, last activity 2 h ago, reload | **signed out on load** — the sleeping-laptop case |
| Signing in again over that same stale stamp | **stays signed in**, stamp reset to 0 min ago |

Suites: biome 721 · web **356** (15 new) · e2e 112.

## `123qy9rpvfq` — templates beyond `budget`, starting with the one Ran spelled out

**Verdict: real, and bigger than it reads.** Ran asks for three things: *"Templates saving
are missing from all sections of the event details tab"*, a schedule **"Load default
template"** with ten named rows, and *"Templates anywhere possible, and offer 'Starting
point' templates where possible."*

The audit's finding is the shape of it: `template_category` already has eight values
(`budget, deal, rider, terms, schedule, crew, settlement_overview, settlement_deal`), the
API stores, lists and gates them (`create_template` entitlement, `templates.manage` audit),
and **the web app has only ever written `category: "budget"`** — `useBudgetToolbar.ts` is
the single caller. So this is not a missing mechanism, it is a mechanism with one caller
out of eight.

**"All sections" is not one unit of work**, so this does the SCHEDULE completely — the one
section Ran specified down to the row names — and leaves the pattern for the rest. Doing one
section end to end (starting point, save, load) is worth more than half-doing five.

### Which files settle it

| File | What changes |
|---|---|
| `apps/api/src/lib/budget-template-payload.ts` | a `schedule` payload schema — today every non-budget category is waved through unvalidated |
| `apps/web/src/lib/scheduleTemplate.ts` | **new** — the starting point, and the payload both ways. Pure, tested |
| `apps/web/src/components/EventScheduleCard.tsx` | the three affordances |
| `apps/web/src/components/useEventScheduleEditor.ts` | apply many items at once |

### Two decisions, and the reasoning for each

**1. A saved schedule stores TIME OF DAY, not absolute instants and not offsets.** A run of
show reused on another night is useless as absolute dates, so those are out. Between clock
times and offsets-from-doors, clock times are what a venue actually has a routine about —
*"we always open at 19:00"* — and they need no anchor to apply. The payload is therefore
`{ label, category, time: "HH:MM", dayOffset: 0 | 1 }`.

**`dayOffset` is the part that is not obvious and is not optional.** A 01:00 curfew belongs
to the day AFTER the show, and a naive `HH:MM` would put it twelve hours before doors on the
same date — which is exactly the kind of silently-wrong time this card already draws a day
pill for. Storing the offset keeps a 01:00 curfew at 01:00 on the following morning when the
template lands on a different night.

**2. The starting point is anchored to the event's OWN times where it has them.** The event
row already carries `doorTime`, `startTime`, `endTime` and `curfew`, so Doors Open, Show
Time, End Time and Curfew take the real values rather than invented ones, and only the six
rows the event knows nothing about (get-in through dinner, closing time) come from offsets.
A starting point that contradicted the times already on the screen would be worse than none.

*(Reading Ran's list: **"Get it"** is taken as **"Get in"** — the load-in sequence is get in,
then load in, and "get it" is not a run-of-show row. Noted rather than silently corrected.)*

### Built — the schedule section, end to end

Three affordances on the Event Schedule card, and **no new server surface**:
`GET`/`POST /profiles/:id/templates`, the `create_template` entitlement and the
`templates.manage` audit were all already there, carrying one category out of eight.

| | |
|---|---|
| **Load starting point** | Ran's ten rows, anchored to the event's own times |
| **My templates** | lists this profile's `schedule` templates with the row count each will add |
| **Save as template** | names the run of show on screen and stores it |

**The API now validates `schedule` payloads** — until today every non-budget category was
waved through, and the loader turns these rows straight into `schedule_items` with no
second chance to notice a bad shape. `time` must be a 24-hour clock, `dayOffset` is capped
at 1, and the item list at 60. The other six categories still pass through, asserted as a
deliberate rule rather than an oversight: **a category earns a schema when a screen starts
reading it back.**

**Proven live, the whole round trip.** On *Marlo Vance — Album Release* (doors 19:00, show
20:00, end 23:00, curfew 23:30 in the database), "Load starting point" wrote ten rows:

```
Get in 14:00 · Load in 14:30 · Line Check 15:30 · Sound Check 16:00 · Dinner 17:30
Doors Open 19:00 · Show Time 20:00 · End Time 23:00 · Curfew 23:30
Closing time 01:00  (+1 day pill on the card)
```

The four the event states came from the event; the six it does not were derived from doors.
Saved as *"Club night — standard"*, the stored payload is clock times with `dayOffset: 1` on
Closing time alone — then applied to **Open Mic Wednesdays on 4 October**: every clock time
held and Closing time landed on **5 Oct 01:00**. The day offset survived the database and a
different night, which is the one thing a naive `HH:MM` would have lost.

Suites: biome 724 · api **1346** (4 new; `deals` and `off-platform` lost to the
Testcontainers flake, both green alone) · web **366** (10 new) · e2e 112.

**Also fixed on the way:** `seedUser` in `invitations.test.ts` took `"operator" |
"performer"` while yesterday's agent-assignment test passes `"agent"` — a type error that a
green `vitest` run cannot see, because the runner does not typecheck. Every package's
`tsc --noEmit` is clean now, which is the check that catches it.

## The calendar cluster — `123qy9rnk21` + what is left of `86cbcn189`

**Verdict on `86cbcn189`: mostly already done, and the audit's "remaining" list is now
shorter than it was this morning.** Checked bullet by bullet against the code:

| Bullet | State |
|---|---|
| v2 marking (X-cursor multi-select, "Done marking") | **done** (ticked by Ran) |
| "Jump to date" rework | **done** (ticked by Ran) |
| No modal after marking | **done** — `useMarkUnavailable.finishMarking` goes straight to the write, with the consequence (no `reason` input any more) stated in its own comment |
| Unavailability on the dates, not a side box | **done** — drawn on the grid |
| Remove "Archive" from the date box | **done** — the word does not appear in any calendar component |
| Venue first, then room / space | **done** — built as item 1 of this loop (`123qy9rpqp0`, `lib/calendarChoice.ts`) |
| Remove the four side-panel cards | **three of four done.** "From your calendar" stays, with the argument recorded in `Calendar.tsx`: it is not a read-out, it carries the only two controls an imported entry has anywhere (turn it into a show; decide whether it blocks public availability). Deleting it would delete two features rather than tidy a duplicate — **Ran's call, with that on the table** |
| Clicking a date jumps to it on the calendar | **done** — `DateText` links every date to `/calendar?date=` |
| **Clicking a date in a SETTLEMENT jumps to the event manager** | **open, and small** — see below |
| Calendar is view-only | **see the contradiction below** |

### The contradiction between the two tickets, and how it is resolved

`86cbcn189` says *"Calendar is view-only: no event edits from the calendar; send users to
the event manager."* `123qy9rnk21` — written **three days later** — asks the day popover for
quick actions including **Publish/Unpublish** and **Invite**, which are edits by any reading.
Two urgent tickets, opposite instructions, one popover.

**Taken as a refinement rather than a reversal:** "view-only" is about the event's FACTS —
its date, venue, room, status, the things the event workspace owns and the calendar used to
let you change in place. A named one-press act is not a field edit. So the popover gets the
details in full and the actions that are unambiguous, and **Ran gets told which two were
left and why** rather than having them guessed at:

- **View** — already there ("Open event").
- **Publish / Unpublish** — built. One press, its own capability (`event.publish`), routes
  that already exist, and it needs no fetch: `published` and `capabilities` are both on the
  events list the calendar already reads.
- **Print details** — NOT built. There is no print sheet for an event anywhere in the app;
  this is a feature with a design question in it, not a button.
- **Invite** — NOT built. The invite flow is a modal with its own state, its own permission
  set picker and its own credit gate; mounting it from a calendar popover is not a small fix,
  and it is the one action on his list that is unambiguously an "event edit" of the kind the
  other ticket rules out.

### `123qy9rnk21` — what the popover is missing, and where it comes from

Ran lists nine things; the popover shows four (name, date, performer, status pill). The rest
were never a fetch problem: **every missing field is already on the events list the calendar
draws from** (`venueName`, `venueLocation.city`, `holdRank`, `holdAutoPromote`, `published`,
and `capabilities` as of this afternoon). So the preview keeps its *"deliberately no fetch"*
property — the month grid draws dozens of chips and a request per click would be a storm —
and simply carries more of what it already had.

| File | What changes |
|---|---|
| `apps/web/src/components/CalendarEventChip.tsx` | `CalendarEvent` carries venue, city, hold and publish facts |
| `apps/web/src/routes/Calendar.tsx` | maps them from the list rows it already has |
| `apps/web/src/components/CalendarEntryPreview.tsx` | the rows, the hold section, the publish action |
| `apps/web/src/components/DateText.tsx` | an optional `eventId`, so a settlement's date goes to the event manager |

### Built

**The popover now carries seven of Ran's nine**, and every one came off the chip — no
fetch was added, because `venueName`, `venueLocation.city`, `holdRank`,
`holdAutoPromote`, `published` and `capabilities` are all columns of the events list the
calendar already drains.

Two judgements inside it:

- **Venue and city are ONE row** — *"The Lantern Hall · Stockholm"*. They answer the same
  question, and two labels in a 268px panel to say "where" would be padding. The city is
  dropped rather than shown empty for a venue that is free text with no profile behind it.
- **Status appears as a row only for a real EVENT.** The pill at the top is doing double
  duty: on a calendar item it says the KIND ("Appointment"), which is not a status at all.
  Spelling it out again only where the pill means something else keeps both readings honest.

**The publish action asks the three questions the API asks**, so it never offers a press it
knows will be refused (the QA4-9 lesson, applied before the fact): `event.publish` in the
reader's own capabilities, a real event, and either already published or `confirmed` — A-22
means only a confirmed show has a public page. The mutation lives in a hook at the leaf
rather than being drilled Calendar → grid → cell → chip → preview, and a mutation hook
issues no request until pressed, so the "no fetch" property holds.

**Hold settings are read-only**, on purpose: a queue position is the hold panel's to change,
and editing one from a calendar chip is precisely the in-place editing `86cbcn189` rules out.

Proven live as `operator@`:

| | |
|---|---|
| Album release popover | `CONFIRMED` · Date `Wed, 14 Oct 2026` · Performer `Marlo Vance + Neon Tide` · Venue `The Lantern Hall · Stockholm` · Status `Confirmed` · **Unpublish** · Open event |
| Pressing **Unpublish** | `published=false` in Postgres, and the agent, co-host and performer all told through the same notifier built for `123qy9rpe3q` |
| Nordic Synth Showcase (a hold) | `ON HOLD` · **HOLD SETTINGS** → Queue position `#1`, Auto-promote `On — moves up if a hold above it falls`, and **no publish button** (not confirmed, not published) |
| Spring Warmup settlement | both dates now read `Open the event manager for 20 May 2026` → `/events/<id>` |

Suites: biome 725 · web 366 · e2e 112.

**Left for Ran, deliberately, with the reasons above:** *Print details* and *Invite* from the
popover, and whether "From your calendar" should go from the rail. Three decisions, all of
them his, none of them guessed at.
