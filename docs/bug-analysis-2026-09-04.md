# The open bug list, analysed — 2026-09-04

> ### ✅ Wave 1 is BUILT — later the same day
> Six of the fixes below are implemented, tested and driven live: **A1** (settings
> currency/timezone), **A2** (the wizard's destroyed work), **A3** (My Calendars
> shown to performers), **A4** (the unmark reason prompt), **A5.1–2** (the
> double-booking warning) and **C4**'s message. Details in
> `docs/handoff-2026-09-04-wave-one.md`. Everything still marked as needing Ran's
> input below is genuinely waiting on him — the questions are on the tickets.
>
> **One new bug was found while doing it** and is NOT in the twenty:
> [123qy9rnjb8](https://app.clickup.com/t/123qy9rnjb8) — the event workspace's
> "Display currency" selector relabels money without converting it.

Every open task on Tech → General tagged `bug` or `needs fixing`, read against the
code rather than taken from the ticket. Twenty tickets. **Nine of them do not say
what they appear to say**, and the difference is worth more than the fixes.

> **Why the code and not the prose.** CLAUDE.md records that trusting a stale
> handoff cost a full session on 2026-08-27, and Ran's grouped lists were written
> on 2026-09-01 from notes taken earlier — several describe a state that had
> already been fixed when he wrote them. Every verdict below names the file that
> settles it.

---

## The five findings that change what to build

**1. A `low` priority ticket is the root cause of an `urgent` one.**
"Currency selector in the settlement is **Broken** — it says *No live rate for SEK
→ EUR*" ([86cbcn1ue](https://app.clickup.com/t/86cbcn1ue)). The selector is not
broken. It is correctly refusing to convert money it has no rate for
(`SettlementCurrencyPreview.tsx:129`). `exchange_rate_cache` is empty because
`EXCHANGE_RATE_API` was never bought — which is
[123qy9rng47](https://app.clickup.com/t/123qy9rng47), sitting at **low**. Buying
one key and running the job closes an urgent report.

**2. An urgent ticket is ~90% already shipped.**
"Core & backend gaps" ([86cbcn16j](https://app.clickup.com/t/86cbcn16j)) lists nine
things that "simply don't work". Eight of them ship today: contacts import/export,
calendar `.ics` import, notification preferences and five emitters, riders upload,
profile → event carry-over, deal → budget, file uploads (the bucket is set), and
access-giving (built yesterday). The ninth is Audience, which is its own ticket.

**3. Two urgent tickets are one missing mechanism.**
[123qy9rnf87](https://app.clickup.com/t/123qy9rnf87) ("event doesn't load") and
[86cbcehmp](https://app.clickup.com/t/86cbcehmp) ("invite logic") are the same
hole seen from both ends: **there is no accept-an-invitation flow.** Access is
granted the moment the invite is sent, and the notification leads nowhere because
there is nothing to land on. [86cbcftg3](https://app.clickup.com/t/86cbcftg3)
(date-change handshake) needs the same machinery. Three urgent tickets, one build.

**4. The hardest-sounding ticket is mostly built and untested.**
"Double booking" ([86cbceux0](https://app.clickup.com/t/86cbceux0)) asks for
room-scoped conflict detection. `@showme/shared`'s `occupiedDates` already
implements exactly the rule Ran describes — *"a date is unavailable for the room
that is actually booked, not for the venue"* — with its own test file. It is
simply never called on the write path.

**5. Holds ranking is finished. The ticket predates it.**
[86cbcn1mh](https://app.clickup.com/t/86cbcn1mh) asks for hold ranking and
numbering "(missing)". `hold_rank`, `computeRankShift`, `computeDeclinePromotion`,
`competingHoldIds` and six routes including `/hold/rank` and `/hold/auto-promote`
all exist. The behaviour Ran describes is `computeRankShift` line for line.

---

## Verdicts at a glance

| | Count | Tickets |
|---|---|---|
| **Real bug, cause found in the code** | 6 | fz0, fz1*, fyw, cgw46, cgjhw, ceux0 |
| **Already done — verify and close** | 3 | cn16j, cn1mh, and most of cn189 |
| **Mis-scoped — the real work is different** | 4 | cepjp, cf6gr, ng4z, cn1ue |
| **One build behind three tickets** | 3 | f87, cehmp, cftg3 |
| **Design work, blocked on the prototype** | 3 | cn1q4, cn1rr, mq7q9 |
| **Product decision needed first** | 1 | cn1hb (partly) |

\* fz1 is the one bug whose cause I could **not** pin from the code — see below.

---

# The tickets

## Group A — real bugs with an identified cause

### A1. Settings: currency and timezone don't save
[123qy9rnfz0](https://app.clickup.com/t/123qy9rnfz0) · urgent · `bug`

**Reported:** *"Currency and timezone settings dont save. Which means also that
the time and Currency around the platform is wrong."*

**What the code says — the write works; the READ does not exist.**
`PATCH /me` accepts and stores both (`routes/me.ts:22-26`, `users.currency`,
`users.timezone`). But `MeResponse` (`routes/me.ts:9-20`) returns only `userId`,
`isAdmin`, `actingProfileId` and `memberships`. So the form has nothing to
rehydrate from and starts blank every time. `Settings.tsx:158` says so in a
comment: *"Currency and timezone have no read value on /me, so they start unset."*
Saving works perfectly and looks exactly like failing.

**Ran's second sentence is a separate and bigger bug.** `users.currency` is read
by **nothing** in the codebase. Display currency is per-screen local state
(`EventDetail.tsx:109`, defaulting to the event's base currency), so even a saved
preference is never applied. `users.timezone` is read by exactly one route
(`routes/calendar.ts:1003`).

**Plan — three parts, in order:**
1. Add `currency` and `timezone` to `MeResponse` and seed the form from them. *(S —
   closes the reported symptom on its own.)*
2. Make `users.currency` the default display currency wherever a currency selector
   has local state. *(M)*
3. Decide what `timezone` governs beyond the calendar export — event times are
   deliberately zone-free wall clocks (decisions #10), so this must **not** shift
   a 19:00 doors time. *(Decision, then S.)*

---

### A2. Clicking outside the event-creation modal destroys everything
[123qy9rnfyw](https://app.clickup.com/t/123qy9rnfyw) · urgent

**Reported:** *"We had this issue before."* Wants Leave / Save Draft / Continue.

**What the code says — confirmed, and there are two of them.**
`NewEventWizard.tsx:723` puts `onMouseDown` on its own backdrop and calls
`close()`, which is `reset()` then `onClose()` — every field discarded, no
confirmation. Separately, the design system's `Modal` (`Modal.tsx:37`) closes on
scrim click **unconditionally, for every modal in the app**, so the collaborator
editor, the budget field modal and the rest have the same hazard.

**Plan:**
1. `NewEventWizard`: track dirtiness, and on a backdrop or Escape dismiss show the
   three-way confirm. *(S)*
2. **Save draft is a real feature, not a button.** The wizard writes nothing until
   submit; the event only exists at the end. A draft save means calling
   `POST /events` with whatever step 1 holds (the API already defaults new events
   to `draft`) and reopening onto that event. *(M)*
3. Design system: add an opt-in `dismissOnScrim={false}` to `Modal` and set it on
   the modals that hold unsaved input. Opt-in, not global — making every trivial
   modal ask twice is worse than the bug. *(S)*

---

### A3. Performers are shown venue Rooms UI
[86cbcgw46](https://app.clickup.com/t/86cbcgw46) · high

**Reported:** *"See comment. This is Venue UI. remove it."* — with a screenshot and
no other text.

**Found it by opening the screenshot.** It is the **My Calendars** card on the
Calendar page, rendered for a performer account with venue copy: *"A venue's rooms
are separate calendars — two rooms can hold two shows on the same night"* and a
**"+ Manage rooms"** link.

`MyCalendarsCard.tsx` takes `groups` and always renders the explainer and the
manage-rooms action. There is **no account-kind gate** — unlike every other Rooms
surface, which is correctly gated: `Profiles.tsx:343` uses `isPlaceProfile`, and
the Calendar's Rooms filter chip only appears when rooms exist.

**Plan:** gate the explainer and the "Manage rooms" action on whether any group is
a venue (`CalendarInventoryGroup` already carries `isVenue`). For a performer the
card should read as their own calendar, or not render at all. *(S)*

**Note the overlap:** [86cbcn189](https://app.clickup.com/t/86cbcn189) asks to
"remove the 3 unnecessary side-panel cards from the calendar page" — this is one
of the four. Confirm with Ran whether it goes rather than gets gated.

---

### A4. Unmarking unavailability uses the marking UI
[86cbcgjhw](https://app.clickup.com/t/86cbcgjhw) · high

**What the code says — the interaction is right; the *reason prompt* is the bug.**
`useMarkUnavailable.ts` implements the V2 behaviour Ran asked for and ticked off
himself: X-cursor, drag, shift-click, "Done marking". **A click toggles**, so
unmarking already works with no second control. What does not work: the reason
modal is asked once at the end for the whole selection — so freeing a night
prompts you to explain why you freed it.

**This is the same fix as the first bullet of [86cbcn189](https://app.clickup.com/t/86cbcn189)**
("no need for the model that comes after marking — a simple on/off would do").

**Plan:** skip the reason prompt when the selection only *removes* blocks; ask
only when at least one night is being blocked. *(S — one condition.)*

---

### A5. Double booking is never warned
[86cbceux0](https://app.clickup.com/t/86cbceux0) · urgent

**What the code says — the rule exists and is correct; nothing calls it.**
`packages/shared/src/room-availability.ts` states exactly Ran's rule, has a test
file, and is used in **three display surfaces only**: the availability share modal,
`calendarInventory`, and the room-delete note. `POST /events` and
`PATCH /events/:id` contain **no conflict check of any kind** — the only `conflict`
in `routes/events.ts` is an optimistic-locking version clash.

Ran's three bullets decompose cleanly:

| Bullet | State | Work |
|---|---|---|
| No double-booking warning | Rule built, unwired | Call `occupiedDates` on create/edit; **warn, never block** (he is explicit that multiple events per date must stay possible) |
| No warning on an "Unavailable" date | `profile_unavailability` is read on GET but not consulted on write | Same check, same warning |
| Events don't mark dates unavailable per room | `GET /profiles/:id/availability` returns manual blocks + busy times only; event occupancy is computed **client-side** for the share modal | Fold `occupiedDates` into the server's availability answer |

**One schema limit to decide.** `profile_unavailability` has **no `stage_id`**
(noted in `useMarkUnavailable.ts`), so a multi-room venue can only block the whole
building. Ran's "per venue and per room/space" needs a column. *(Migration + M.)*

**Plan:** S for the warning on create/edit (the rule is written and tested), M for
the server-side availability fold-in, M+migration for room-level blocks.

---

### A6. Profile edit doesn't show existing images
[123qy9rnfz1](https://app.clickup.com/t/123qy9rnfz1) · urgent · `bug`

**The one I could not settle from the code — say so rather than guess.**
The API path looks correct end to end: `loadProfileRelations`
(`routes/profiles.ts:589`) signs the avatar, banner **and** every gallery file,
and `serializeProfile:313-338` resolves each down the file-then-URL ladder. The
editor rehydrates from that on `id + updatedAt` (`Profiles.tsx:585-591`).

Ranked hypotheses to test live:
1. **Signed-URL expiry.** URLs live 15 minutes (`storage.ts:46`) and there is no
   global `staleTime`, so a page left open past that shows broken images. Most
   likely, and it would look exactly like "doesn't present the existing images".
2. The **gallery** rather than avatar/banner — a different code path
   (`profile_media`) with the same signing.
3. Environment: the deployed signer versus the loopback one.

**Plan:** reproduce in the running app first, then fix. **Do not scope this from
the ticket.** *(Reproduce, then likely S.)*

Its second half is unambiguous and separate: *"Preview mode should show the actual
new Public profile design (Desktop/Mobile)."* `ProfilePublicPreview` exists but
does not match the public page. That is design work — see Group E.

---

## Group B — already done; verify and close

### B1. Core & backend gaps
[86cbcn16j](https://app.clickup.com/t/86cbcn16j) · urgent → **should be `testing`**

Eight of nine ship today:

| Ran's item | Where it lives now |
|---|---|
| Import / export non-functional | Contacts CSV both ways ([86cbaxyud](https://app.clickup.com/t/86cbaxyud)), calendar `.ics` import ([86cbaxw5k](https://app.clickup.com/t/86cbaxw5k)) — both shipped |
| Access-giving non-functional | Built 2026-09-03 ([86cbaxvqk](https://app.clickup.com/t/86cbaxvqk)) |
| Email & notifications not connected | Preferences + five emitters shipped ([86cbaxvw8](https://app.clickup.com/t/86cbaxvw8)); Brevo is configured in production |
| File uploads missing | Bucket is set; the boot audit now proves it per deploy |
| Riders & documents upload | `useRiderUpload` shipped; the operator's disabled button was fixed 2026-09-03 |
| Data migration profile → event | Shipped ([86cbaxvku](https://app.clickup.com/t/86cbaxvku)) |
| Data migration between tabs | Deal → budget shipped ([86cbaxvf5](https://app.clickup.com/t/86cbaxvf5)) |
| Import / export in contacts | Shipped ([86cbaxyud](https://app.clickup.com/t/86cbaxyud)) |
| *Verify shared links share correct data* | **Genuinely open** — a verification task |

**Plan:** walk each with Ran in the running app, tick them off, and split the
share-link verification into its own task. **No building.** *(Verification session.)*

---

### B2. Holds
[86cbcn1mh](https://app.clickup.com/t/86cbcn1mh) · urgent → **verify and close**

The rename is ticked. "Add hold logic + numbering (missing)" is stale: the ranking
engine is complete (`packages/shared/src/holds.ts`, `events.hold_rank`, six routes,
`EventHoldPanel`), and [86cbaxumc](https://app.clickup.com/t/86cbaxumc) — *"rank is
set once at creation, then invisible and unmanageable"* — shipped. Ran's stated
rule (*"cancelling a hold upgrades the others, adding a higher rank downgrades
them"*) is `computeDeclinePromotion` and `computeRankShift`.

**Plan:** drive it as the operator, show him, close. If the UI does not surface
ranks clearly enough, that is a new and much smaller ticket. *(Verification.)*

---

### B3. Calendar
[86cbcn189](https://app.clickup.com/t/86cbcn189) · urgent → **mostly shipped**

Two items Ran already ticked. Of the eight remaining, five are shipped
(venue → room filter, jump-to-date, date links both ways, archive off the date box,
calendar read-only). Genuinely open:

- **The reason modal** after marking → same fix as A4.
- **The "Unavailable" side box.** It still exists (`Calendar.tsx:1030`) and the code
  argues for it: *"a block outside the visible month is otherwise invisible, and a
  rule you cannot see is a rule you re-break."* Ran wants it gone. **His call —
  but he should hear the argument.**
- **Remove 3 side-panel cards.** There are four: Status legend, Unavailable,
  External calendars, My Calendars. Needs him to name which three.

**Plan:** one fix (A4) plus two decisions. *(S + decisions.)*

---

## Group C — mis-scoped; the real work is different

### C1. Audience import/export
[86cbcepjp](https://app.clickup.com/t/86cbcepjp) · high

**The page has no data at all.** `Audience.tsx:26` is
`const CONTACTS: AudienceContact[] = []` with a comment: *"There is no operator
audience/RSVP read endpoint yet."* `audience_rsvps` exists as a table, one public
`POST /public/events/:id/rsvp` writes to it, and **nothing reads it**.

Import/export of an empty page nobody can populate is not the ask.

**Plan:**
1. `GET /profiles/:id/audience` (and/or per event), wired into the page. *(M)*
2. **Then** CSV import/export, reusing `ContactImportModal` and the contacts
   exporter wholesale. *(S once the data exists.)*

**Retitle the ticket** — "Audience is missing import export" will otherwise get
picked up as a small job by whoever takes it.

---

### C2. Genre / Style / Mood
[86cbcf6gr](https://app.clickup.com/t/86cbcf6gr) · urgent

**Reality:** genres exist as a free-text jsonb leaf (`profiles.details.genres`),
edited with a `TagInput`. Mood/Style does **not exist anywhere**. Genres are not on
events. The public page renders all of them uncapped (`marketing/src/profile.ts:637`),
so *"only some show"* needs a live reproduce — probably the in-app preview, not the
public page.

**This is a data-model ticket, not a UI one.** Ran wants a curated list, "Rock" and
"rock" deduplicated, colour-coded pills, and analytics later. CLAUDE.md's rule is
explicit: queried-across data is normalized, jsonb is for read-with-parent leaves.
A free jsonb array cannot be grouped, deduplicated or counted.

**Plan:**
1. **Decide the vocabulary first** — with Ran. Which genres ship as canonical, and
   what happens when someone types one that isn't. *(Decision — blocks everything.)*
2. `genres` / `moods` tables + join, migrating `details.genres` across. *(M + migration.)*
3. Attach to events; show top 3 genres and top 2 moods in event details. *(M)*
4. Colour tokens that cannot collide with the status palette — `STATUS_COLOR` is
   fixed and exact, so the genre palette must be picked against it. *(S)*

---

### C3. Showday status
[123qy9rng4z](https://app.clickup.com/t/123qy9rng4z) · urgent

**What the code says:** no `showday` anywhere; `event_status` is the seven values
it has always been. And — separately — **nothing ever moves a confirmed event to
`concluded`.** No reaper does it (`apps/jobs/src/reapers.ts` has five, none for
this), so every past show sits at `confirmed` forever.

**The re-scope:** showday is a **derived** state (the event date is today), not a
stored one. Adding it to the enum would put a value in the database that has to be
written and unwritten by a clock — the thing `archived_at` was deliberately *not*
made a status to avoid. And Ran's three variants — *concluded + not settled /
settled / finalized* — are already expressible: `settlements.status` carries
`open · pending_review · comments_received · revised · finalized · partly_paid ·
paid · dispute`. They are a display composition, not new statuses.

**Plan:**
1. Derive showday in the serializer from `event_date` and the event's timezone;
   render the glow off that. No migration. *(S)*
2. **A concluded reaper** — the genuinely missing piece, and the one with
   consequences for settlement. *(M — and it needs the scheduled job actually
   running in production, which is the Terraform work from 2026-09-03.)*
3. Compose the concluded + settlement-status label for display. *(S)*
4. Show-day notification — one emitter on the existing notification spine. *(S)*

---

### C4. Settlements & financials — the residue
[86cbcn1ue](https://app.clickup.com/t/86cbcn1ue) · urgent · `re-do`

Eight of nine done on `settlements-2026-09-02`. Three of the five unchecked lines
(collaborator details, ticketing info, deal type + fee in the Overview) are the
**W3/W4 tasks already `in review`** — [123qy9rng5y](https://app.clickup.com/t/123qy9rng5y)
and [123qy9rng64](https://app.clickup.com/t/123qy9rng64). What is left:

- **The currency selector.** Not broken — see finding 1. It refuses to convert
  without a rate, which is right for money. **Buy the ExchangeRate-API key**
  ([123qy9rng47](https://app.clickup.com/t/123qy9rng47), currently `low` — raise
  it), run the job, and soften the message so it reads as a missing rate rather
  than a broken control. *(Purchase + S.)*
- **The terminology session** ([123qy9rng6d](https://app.clickup.com/t/123qy9rng6d)).
  Ran: *"the terms used are just not the industry terms… We need to redo this
  together."* Deliberately untouched. **Book it.**

---

## Group D — one build behind three urgent tickets

### D1. The invitation-acceptance flow
[123qy9rnf87](https://app.clickup.com/t/123qy9rnf87) · [86cbcehmp](https://app.clickup.com/t/86cbcehmp) · [86cbcftg3](https://app.clickup.com/t/86cbcftg3) — all urgent

**The hole.** Ran, on cehmp: *"currently the invited party gets invited to an event
→ gets access to the event manager as a collaborator immediately → stays as
'Invited' in the collaborators tab."* On f87: *"the notification was received but
clicking it did not lead to the event or to the 'Accept' this invitation flow. (I
think the flow doesn't exist currently)."* **He is right.** Access is granted at
send time, so there is nothing to accept, and the notification has no destination.

This is not the account-level Team Access built on 2026-09-03. That was membership
of an *account*. This is participation in an *event*, and it is a different object.

**What must be built, in Ran's own order:**

1. **Inviting a performer moves the event `draft` → `suggested`.** Both paths: from
   the wizard and from Invite Collaborator.
2. **A suggested event arrives as an incoming *request*,** and shows as `suggested`
   on the performer's calendar. Note his warning: request-`pending` and
   event-`pending` are different things and must not be conflated in the UI.
3. **Accept → event becomes `pending`;** the request moves to an "Accepted" tab
   until it expires.
4. **Deal confirmed by all sides → `confirmed`.** This half exists
   (`agreement_status`, both confirm doors).
5. **Decline → the operator is notified,** and can edit the date, which re-issues
   the request. **Declining takes a note** ("date issue" vs "not interested").
6. **Then cftg3 falls out of the same machinery:** a date change on a suggested
   event re-issues the request; on pending/confirmed it raises a change request the
   other side confirms or declines, with notifications both ways. Ran extends this
   to venue and room changes too.

**What exists to build on — more than the tickets suggest.**

- `invitations` carries a full lifecycle already: `pending · accepted · declined ·
  revoked · expired · used`, with accept, decline, revoke and claim routes.
- `booking_requests` has a **complete surface**: list, detail, `counter-offer`,
  `flag-spam`, mark-read, and `draft-event` (which converts an approach into a
  real event, currency and all).
- `event_participants.status` already has `invited/accepted/declined/confirmed`.
- The Requests screen, the notification spine, and an Outgoing Requests page
  ([#6](https://app.clickup.com/t/86cb6305n)) which is `in review`.

**The precise gap.** `booking_requests` models the **inbound** direction — someone
approaches an operator, who triages and converts. Ran is describing the
**outbound** one: an operator invites a performer, and the performer must answer
before anything is granted. Same shape, opposite direction, and it does not exist:
`POST /events/:id/participants` writes a participant row with access attached, and
`POST /invitations` mints a token nobody is required to redeem before they are in.

So this is **not a from-scratch build** — it is the outbound twin of a flow that is
already modelled once, and the two should share a vocabulary rather than diverge.

`PATCH /events/:id` already writes an **activity** row on a date change
(`routes/events.ts:1212`) — it just notifies nobody and asks nobody.

**Plan:** this is the largest item on the board and should be scoped as its own
epic with the six steps above as subtasks. **L.** Take it in the order Ran wrote —
each step is independently shippable, and step 1 alone makes the status
progression honest.

---

## Group E — design work, blocked the same way

### E1. Performer profile & media — [86cbcn1q4](https://app.clickup.com/t/86cbcn1q4) · urgent
### E2. Venue profile (public + edit) — [86cbcn1rr](https://app.clickup.com/t/86cbcn1rr) · urgent
### E3. Event Details / Logistics — [86c9mq7q9](https://app.clickup.com/t/86c9mq7q9) · urgent

**Two of the twelve performer items are already done** and should be ticked before
anyone estimates the rest:

- *"Type should offer all performer types, not just music"* — it already does:
  comedian, theatre company, dance company, circus, magician, drag artist, spoken
  word, speaker (`packages/shared/src/venue.ts:136-152`).
- *"Add image preview + crop on upload"* — `ImageCropDialog` + `useImageCropper`
  exist and are wired into `ProfileImageField`.

**And one is already true server-side:** *"Setups must not appear on the public
profile"* — `serializePublicProfile` does not emit them. If Ran saw setups, he saw
the in-app **preview panel**, which is the same complaint as A6's second half.

**Two are deliberate decisions, not defects:**

- **"Map is missing"** (cn1rr). `marketing/src/profile.ts:1018` states the reason:
  *"There is no map: every tile provider is a third-party request on a page that
  makes none."* The public page makes zero third-party requests by design. A static
  map image or an "open in Maps" link keeps that property. **Ran's call.**
- **The "Assets" page** (cn1rr, last bullet) is a **new feature**, not a fix — a
  document library with "Add from assets". It should leave this ticket and become
  its own, and it overlaps with
  [123qy9rnfbe](https://app.clickup.com/t/123qy9rnfbe) (Poster → Promo material +
  Assets).

**The blocker on all three.** These are layout and visual-hierarchy changes —
pill grouping, photo aspect, video grids, public/private splits, the whole
Logistics section (which arrives with a full field spec and an interactive HTML
mockup). Per CLAUDE.md and the `claude-design` skill, the prototype must be
**rendered and looked at**, never rebuilt from a written description — *"that has
gone wrong twice"*. The handoff already lists the Events list as blocked on
`/design consent` for the same reason.

**Plan:** get design consent, render the prototype, and take E1–E3 as one design
pass rather than three. E3 is the most self-contained — it has a complete field
spec, so it is the right one to start with. *(L across the three.)*

---

## Group F — needs a product decision

### F1. In-app Tasks
[86cbcn1hb](https://app.clickup.com/t/86cbcn1hb) · high

Ran ticked "Tasks must be editable". Of the other three, **two are already built**:
`assigneeParticipantId` on the task routes ([86cbaxy05](https://app.clickup.com/t/86cbaxy05),
shipped) and reminders with a `task-reminders` job
([86cbaxxu1](https://app.clickup.com/t/86cbaxxu1), shipped — in-app half).

Genuinely open: *"Team groups only appear under 'All' view, but not on each venue
profile view."* Needs Ran to say what he expects a venue-scoped task view to show.
*(Decision, then S.)*

---

# Suggested order

**Wave 1 — a day, high visible return.** Six small fixes, each with a known cause,
plus the purchase that closes an urgent report.

| | Ticket | Why first |
|---|---|---|
| 1 | **Buy the ExchangeRate-API key** ([ng47](https://app.clickup.com/t/123qy9rng47)) | Closes the "broken" currency selector. Blocks nothing else, unblocks an urgent |
| 2 | `currency`/`timezone` on `GET /me` (A1.1) | The reported symptom, one schema field |
| 3 | Reason prompt on unmark only (A4) | Closes cgjhw and one cn189 bullet |
| 4 | Gate My Calendars for performers (A3) | One condition |
| 5 | Wizard dismiss confirm (A2.1) | Stops destroying work today |
| 6 | Double-booking warning on create/edit (A5.1) | The rule is written and tested |

**Wave 2 — verification, not building.** Sit with Ran and walk B1, B2, B3 in the
running app. Three urgent/high tickets close without a commit. Book the terminology
session (C4) in the same conversation, and settle the open decisions: the calendar
side box and which three cards go; the map; what a venue-scoped task view shows;
and the genre vocabulary.

**Wave 3 — the invitation epic (D1).** The largest and most valuable build. Three
urgent tickets, in Ran's six steps.

**Wave 4 — the re-scoped builds.** Audience read endpoint then import/export (C1);
the genre/mood data model once the vocabulary is agreed (C2); showday derivation
and the concluded reaper (C3).

**Wave 5 — the design pass (E1–E3),** after `/design consent`, with the prototype
rendered.

**Left open deliberately:** A6 (profile images) needs a live reproduce before it
can be planned honestly, and A5's room-level unavailability needs a migration
decision. Neither should be estimated from the ticket.

---

## Decisions needed from Ran

1. **Genre vocabulary** — the canonical list, and what happens on an unknown entry. *(Blocks C2 entirely.)*
2. **Calendar side box** — remove it, knowing a block outside the visible month becomes invisible?
3. **Which three side-panel cards** come off the calendar (there are four).
4. **The map** on public venue pages — accept a third-party tile request, or take a static image / "open in Maps"?
5. **Venue-scoped task view** — what should it show?
6. **Terminology session** ([W5](https://app.clickup.com/t/123qy9rng6d)) — book it; C4 and the settlement language wait on it.
7. **Room-level unavailability** — worth a migration now, or is whole-venue blocking enough for v1?
