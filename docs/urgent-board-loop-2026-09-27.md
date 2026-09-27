# Urgent board — the build loop, 2026-09-27

Working state for the `/loop` pass that follows
`docs/clickup-urgent-audit-2026-09-27.md` (the verdicts) and `decisions.md` #25 (the
five calls that unblocked it). **Do not re-derive the audit** — it is current, and its
corrections sections record two things it got wrong.

**Rules:** plan each item HERE before building it (which file settles it, the verdict,
the scope, the decision it hides) → build → prove on the running stack → biome + web +
API + e2e → commit naming the ticket. After each cluster, run the `qa-sweep` agent and
fold its findings in. No deploy. No ClickUp writes.

**Order:** (1) `123qy9rpqp0` + `123qy9rpqn0` · (2) the outbound invite chain ·
(3) the bonus ladder · (4) the fourteen small fixes, cheapest first.

**Unblocked mid-loop:** `/design-login` now works, so `86cbcn1q4`, `86cbcn1rr` and
`86c9mq7q9` are no longer skipped — they join the order after (3), as one design pass,
with the prototype rendered and never described.

---

## Item 1 — `123qy9rpqp0` availability & requests, and `123qy9rpqn0` short links

**Verdict: real, and one mechanism.** Two urgent tickets that pull in opposite
directions (shorter link vs a link carrying more) and resolve the same way —
`decisions.md` #25.4. Ran's own §2 confirms the room-scoped availability MATH is
already right: *"Big Room selected: 5 Dec correctly left out. All rooms: included."*
Nothing here touches that logic. What is missing is everywhere the answer travels.

**What settles it, file by file:**

| Question | File |
|---|---|
| Does a request carry a venue and a room? | `packages/db/src/schema/inbound.ts` — **no.** `booking_requests` has `wantedDate`, `additionalDates`, no venue, no room |
| Does the public form accept them? | `apps/api/src/routes/inbound.ts:156` `CreatePublicRequestBody` — **no** |
| Does the conversion carry them onto the event? | `inbound.ts:1538-1555` — derives `venueProfileId` from the target's `type === "venue"` and **never sets `stageId`** |
| Where does the link get built? | `apps/web/src/lib/availabilityShareLink.ts` — whole snapshot in the URL fragment |
| Can a share hold it instead? | `packages/db/src/schema/sharing.ts:26-46` — **yes, with no migration.** `shares` already has `payload jsonb`, a nullable `event_id`, `target_kind`, `target_id`, `access` and `expires_at` |
| The chooser Ran describes | `apps/web/src/components/AvailabilityShareModal.tsx:101` — one `Calendar` select, venues and rooms mixed |

**The decision each piece hides:**

- **A** hides *who may claim a room.* A public form that accepts a `stageId` lets a
  stranger name any room in the database. The room must be validated as belonging to
  the target profile, and the request stores it only then — otherwise a request would
  assert a fact about somebody's building.
- **B** hides the privacy trade #25.4 already took: the dates leave the URL and land in
  `shares.payload`. Recorded there; not re-litigated here.
- **D** hides *what "free" means to a stranger.* The page must not enumerate a venue's
  rooms — Ran asks only for the free ones on the chosen date, each with its capacity.
  That is the same rule `GET /profiles/:id/stages` enforces (a venue's geography is not
  public), so the free-room list is derived per date, not served as a catalogue.

**Scope, as four commits:**

- **A — `booking_requests` carries a venue and a room.** Migration adding
  `venue_profile_id` + `stage_id` (both nullable — a performer's public page has no
  venue). `CreatePublicRequestBody` and the authenticated offer body accept them; the
  room is refused unless it belongs to the named venue, and the venue unless it is the
  target profile or one of its venues. `draft-event` passes both onto the event it
  creates, which also fixes the room never being stamped. *API + migration + tests.*
- **B — an availability share is a `shares` row.** Split in two once the code was read:
  - **B1 (API).** `POST /profiles/:id/availability-share` writes
    `{ event_id: null, target_kind: "profile_availability", target_id: profileId,
    payload: snapshot, capabilities: [], access: "public" }` and returns a token.
    `GET /public/availability/:token` serves it back. **Two corrections to the sketch:**
    `GET /shares/:token` does *not* serve `payload` — it returns
    `{ targetKind, targetId, capabilities }` — and `createShareWithRecipients` demands a
    non-null `eventId` plus an event capability for its audit row, so an availability
    share writes its own row rather than borrowing that helper. The liveness rule
    (missing / revoked / expired → 404) moves to `lib/share-token.ts` so both routes
    share one definition instead of two.
  - **B2 (web + marketing).** The modal creates the link instead of computing it, and
    the public page reads a token **and still reads the legacy fragment** — links
    already sitting in somebody's inbox must keep working. Needs a hosting rewrite for
    `/a/<token>`.
  - **Token length is a judgement, recorded:** Ran's example is `showme.music/a/x7k2`.
    Four characters is enumerable, and an availability snapshot is a venue's free
    nights — low sensitivity, but nothing anyone should be able to sweep. 9 random
    bytes base64url = **12 characters, 72 bits**: short enough to read as a link, far
    past guessing. (Event shares use 24 bytes → 48 hex chars, which is what Ran is
    complaining about at the other end of the scale.)
  - **No expiry**, deliberately: a link never died before and the modal's own promise is
    *"reflects availability as of when it was generated"*. Adding a lifetime is a
    product change nobody asked for; the column is there the day it is wanted.
- **C — Venue, then Room.** Two selects in `AvailabilityShareModal`: venue (or "All
  venues"), then only that venue's rooms (or "All rooms/spaces"). Closed state reads
  "The test venue · All rooms". *Web only.*
- **D — the shared page answers per date.** With a token the page can ask the server
  which rooms are free on a chosen date; it shows *"Small Room (200 cap) is the only
  available room for this date"*, offers a pick when several are free, never offers a
  booked one, and autofills venue + room into the request form. *Marketing + API.*

**Order matters:** A first (it is the foundation §3 and the double-booking check both
need), then B (D has nowhere to put room data without it), then C and D.

---

## Log

**A — `booking_requests` carries a venue and a room.** Migration `0047`, hand-written in
the house style (the snapshots under `migrations/meta` stopped being maintained at 0012,
so `drizzle-kit generate` errors on a parent-snapshot collision and is not the path
here; 47 of 47 migrations are hand-written and only `_journal.json` is kept up).
`placeOfRequest` is the one rule, on both write paths: a room needs its venue, the venue
must be the profile being asked, and the room must belong to it. `draft-event` now
carries both onto the event — `events.stage_id` has pointed at `stages` since migration
0000 and this conversion never set it, so every drafted event arrived roomless even when
the ask had been specific. The inbox joins `stages` for the name in the same pass it
already joins for `onBehalfOfName`.

Proven live, all five cases: the venue's own room → 201 and the inbox reads "Main Room";
a room with no venue → 400; somebody else's venue → 400; no place at all → 201 (the
commonest case and a real state); and "Accept request" produced an event stamped Main
Room, 2027-03-05. Mutation-checked: bypassing the ownership read turns the refusal into
a 201. Suites: biome 702 · api 1297 · web 309 · db 25 · e2e 112.

**Found on the way:** `draft-event` refuses with a 400 when it cannot derive a currency
(no country on the profile's primary location). Correct, and worth knowing — it is the
first thing to check when a conversion fails in a fixture.

**B1 — the availability share is a `shares` row with a short token.**
`POST /profiles/:id/availability-share` (member action, `ANY_ROLE`, insert + audit in one
transaction) and `GET /public/availability/:token` (anonymous). The liveness rule moved to
`lib/share-token.ts` so `shares.ts` and `public.ts` cannot drift on what "still good"
means, and `calendarDate` moved to `lib/calendar-date.ts` for the same reason — a second
copy that accepts 30 February is a data bug nobody sees until something is denominated
against it.

Two properties held deliberately: the profile's **name is resolved live** and the
snapshot cannot override it (a hand-edited link must not put one venue's name above
another's free nights — the property the old fragment had), and a token pointing at
anything that is not an availability snapshot is a **404**, which is what stops this
being a back door onto an event share's payload. Both mutation-checked: dropping the
target-kind guard turns that 404 into a 200 serving the other share's blob.

Proven live: `POST` → `MAYGpMPsNvbf`, a **35-character** link where the shape it replaces
was **215 characters for only three dates** (Ran's real links carry a month, hence ~700);
anonymous read returns "The Lantern Hall · Main Room · 3 dates"; a bogus token 404s.
Suites: biome 704 · api 1304 (settlement.test.ts re-run alone after the port flake) ·
e2e 112.

**Still to come on this ticket:** B2 (the modal creates the link; the marketing page reads
a token *and* still reads the legacy fragment, since links already sent must keep
working; needs a hosting rewrite for `/a/<token>`), then C and D.

**B2a — the public page reads a token, and still reads the old links.** `/a/<token>` via a
Firebase Hosting rewrite, the same shape `/profile/<slug>` and `/event/<id>` already use —
the page reads the last segment itself and accepts `?a=<token>` too. **The legacy fragment
still renders**, because every availability link sent before today is a fragment sitting in
somebody's inbox; a token wins when both are present.

Three things came out of doing it:

1. **The readers could not be tested at all.** `availability.ts` boots itself at module
   scope, so importing it runs the page. They moved to `availabilitySnapshot.ts` (no side
   effects, `readShareToken(url: URL)` instead of reaching for `window`), which is what
   made a test possible.
2. **`apps/marketing` had no unit runner** — the same gap `apps/web` had until ticket
   `86cbazcf3`, and the same argument: its only tests were Playwright specs, so a pure
   function had nowhere to be asserted. Added, with 11 tests over both doors. The one that
   matters is *the two doors agree*: fragment and object must read to the same snapshot, or
   one of them renders a page the other would refuse. Mutation-checked — loosening the
   date filter or accepting truthy flags turns two of them red.
3. **`pnpm dev` blocked the marketing origin.** `app.ts`'s own default CORS list has always
   had `localhost:5173`; the dev stack narrowed it to the web app, so the first check of a
   public page against a local API is a CORS wall rather than an answer. Fixed in
   `scripts/dev-emulator.mjs`.

Proven live, both doors: `?a=uudgaGsyRi3v` renders "The Lantern Hall is free on these
dates · Thu Dec 03/10/17 · Main Room", name resolved by the API; and a legacy fragment
renders its own snapshot unchanged. Suites: biome 707 · marketing 11 (new) · web 309 ·
e2e 112.

**Still to come on this ticket:** B2b (the modal creating the link instead of computing
it), then C (Venue-then-Room) and D (which rooms are free per date).

**B2b — the modal mints the link instead of computing it. `123qy9rpqn0` is closed.**
The snapshot stays live with the controls; the LINK is minted when the operator asks for
one. Minting on every keystroke would write a share row for every state the form passed
through on the way to the one they meant, so the button is the trigger: *Create link* →
mint → copy, and *Copy* thereafter.

**The correctness detail is the staleness rule.** Changing anything — the window, a
weekday, which states count as busy — empties the field and the button says *Create link*
again, because the token now points at a snapshot that is no longer on screen and a copied
stale link is worse than no link: nothing about it looks wrong. Proven in the browser:
toggling **Mon** cleared `.../a/CuGoKoMECRgL` and reset the button.

**Deleted rather than deprecated:** `buildAvailabilityShareLink` and
`publicAvailabilityUrl` have no callers now, and a builder nobody calls is an invitation to
mint a 700-character link again. Its test went with it — the fragment FORMAT is asserted
where it has to keep working, on the marketing reader. The `AvailabilitySnapshot` type
stays, and the module now describes a shape rather than building a URL.

Proven live: the modal's field starts empty with "Create a link to share these dates",
one press produced `/a/CuGoKoMECRgL`, and the clipboard write happens in the press's own
gesture chain (an `await` in between is what Safari refuses). Suites: biome clean · web 303
· api 1304 (shares.test.ts re-run alone after the port flake) · e2e 112.

**Item 1 status:** A, B1, B2a, B2b done — `123qy9rpqn0` is closed and `123qy9rpqp0` §3 is
done. **C** (Venue-then-Room chooser) and **D** (which rooms are free per date) remain.
**C — plan, written before building.** Verdict: **real, and web only.** Today one `Select`
labelled "Calendar" carries venues *and* rooms in a single flat list: venue names as
disabled headings, rooms indented under them with two non-breaking spaces
(`useCalendarSources.ts:200-228`). It works, and it is exactly what Ran is objecting to —
an indent is not a hierarchy you can operate.

**Two selects, one piece of state.** `calendar` stays a single `CalendarSource.value`
(`profileId:room` — *"parsed nowhere, compared everywhere"*). The venue select's option
values are each profile's **whole-calendar** entry, so picking a venue simply *is*
`setCalendar("<profile>:whole-venue")` and both selects write through the same setter.
There is no second piece of state to keep in step — the rule the grid's own room select
already follows (`useCalendarVenueFilter` reads and writes `hiddenRooms` rather than
owning a copy of the answer).

**The decision C hides: there is no "All venues" here.** The grid filter has one and
should — a filter narrows a view. This select names the **subject** of a share: one
`profileSlug` in the snapshot, one `POST /profiles/:id/availability-share`. "All venues"
would have to either share nothing or silently pick one, so the first row is a venue, not
an "all".

**Derivation goes in `lib/calendarChoice.ts`** — pure and tested, rather than inside the
hook: `useAvailabilityShare` is already 345 lines, and which rooms may be chosen is a
rule, not state.

**What this deletes:** `useCalendarSources.options` and `.find`. `options` had exactly one
caller (this modal) and `find` had none, so the heading-and-indent builder goes with the
list it built.

**The disabled room select says why, every time** (the pattern the grid established): a
non-venue profile → "One schedule"; a venue with no rooms recorded → "No rooms recorded";
a venue with exactly one room → that room's name, because "All rooms" and "Main Room" are
the same set and offering both is furniture.

**One label format.** `fullLabel` becomes `Venue · Room` / `Venue · All rooms`; it was two
em-dashed formats, which made the modal's own heading read *"Available dates — The Lantern
Hall — all rooms"*. Ran's wording is "The test venue · All rooms".

**Re-checked and deliberately left alone:** `docs/codebase-reuse-audit.md` **R5** — this
hook's private clipboard helper. The recorded reason still holds: adopting
`useCopyToClipboard` changes the toast wording, which is a user-visible change nobody
asked for, and C is not the commit to smuggle it into.

**C — venue, then room. Built.** Two selects where there was one mixed list, over the one
`calendar` value: the venue rows ARE each profile's whole-calendar entry, so both controls
write through `setCalendar` and there is no second state to fall out of step. The rule —
which rooms may be offered, and what the room select says when it cannot offer any — is in
`lib/calendarChoice.ts` with eight tests; mutation-checked three ways (an "All venues" row
→ 3 red; offering a lone room as a choice → 1 red; the venue select following the room
instead of the venue → 1 red).

Proven live on the stack. As the operator: **Calendar** "The Lantern Hall", **Room /
stage** "All rooms", the room list offering *only* that venue's `All rooms · Back Room ·
Main Room`, and picking **Back Room** leaves the venue select reading "The Lantern Hall"
while the heading becomes *"Available dates — The Lantern Hall · Back Room"*. As
performer.a: **Marlo Vance**, room select **disabled** reading "One schedule". At 360px
the pair fits the same two-column row as From/To
(`docs/screenshots/urgent-loop-2026-09-27/c-venue-then-room-360.png`).

**Deleted with it:** `useCalendarSources.options` and `.find` — the heading-and-indent
builder had exactly one caller and `find` had none. `CalendarSourcesView` is now
`{ sources }`.

**Found on the way — and it was mine.** `biome check .` was **not** clean at `92e5108`:
the staleness `useEffect` I added there trips `useExhaustiveDependencies` (its only
dependency is one it never reads), and my "biome clean" line for that commit was wrong —
I had linted the paths I edited, not the repo. Fixed properly rather than suppressed: the
link is now stored **with the snapshot it was minted from** and read back only while that
is still the snapshot on screen, so going stale is a comparison during render instead of
an effect that has to fire. Same behaviour, no effect, no ignore comment. Repo-wide biome
is clean at 708 files.

Suites: biome 708 clean · web 311 (8 new) · api 1304 (`shares.test.ts` re-run alone after
the port flake) · e2e 112.

**D — plan, written before building.** *"Which rooms are free on this date?"* — the last
piece of `123qy9rpqp0`, and the only one that reaches the API again.

**The decision D hides, and how it is taken.** The page could answer this two ways:

1. **A live public route** — `GET /public/availability/:token/rooms?date=…`, computed on
   demand. Freshest, and it would never offer a room booked since the link was sent.
2. **The snapshot carries it** — the sharer's app already computes free nights per room
   (`occupiedDates`), so the share row can hold them.

**Taken: (2), the snapshot.** Three reasons, in order of weight. It keeps the promise the
link already makes and the modal already prints — *"reflects availability as of when it
was generated"*; (1) would quietly turn a snapshot into a live feed, which is a different
product. It keeps the sharer in control of exactly what leaves: a live per-date route can
be **swept** by a stranger with a token until it has enumerated the roster, which is the
thing `GET /profiles/:id/stages` exists to prevent. And it keeps one rule in one place —
the page can never name a room the modal's own list did not, because both come from the
same `occupiedDates` call. The cost is honest and stated: a room booked after the link was
sent is still offered, exactly as a *date* booked after the link was sent already is. The
receiving end is where that is caught (the double-booking check, `123qy9rprbx` §2).

**Two commits.**

- **D1 — the snapshot carries rooms.** `AvailabilitySnapshotBody` gains an optional
  `rooms: [{ id, name, capacity, availableDates }]`, bounded like everything else beside
  it (≤ 50 rooms, name ≤ 120, ≤ 550 dates each). `GET /public/availability/:token` already
  serves the payload as `z.record(z.unknown())`, so nothing there strips it. Web computes
  the per-room lists in the **same memo** as the top-level one, so the union it already
  shows and the per-room breakdown cannot disagree; `CalendarSource` gains `capacity`,
  which `useCalendarSources` already fetches and drops. *API + web.*
- **D2 — the page answers per date, and the ask carries the room.** Clicking a date names
  the rooms free that night — *"Small Room (200 cap) is the only available room for this
  date"* when there is one, a pick when there are several, never a booked one. The chosen
  room rides into the existing public form as `venueProfileId` + `stageId`, which
  `POST /booking-requests` has accepted since **A** and validates with `placeOfRequest` —
  so a hand-edited room id is refused rather than believed. *Marketing.*

**Room ids in a public payload** are fine and worth saying why: an id is an opaque handle
to something the sharer chose to publish, and A's validator already refuses a room that
does not belong to the venue being asked. Nothing is taken on trust because it arrived.

**D1 — the snapshot carries the rooms. Built.** `AvailabilitySnapshotBody` takes an
optional `rooms: [{ id, name, capacity, availableDates }]`, bounded like everything else
on that blob (≤ 50 rooms, ≤ 550 dates each), and the public read already served the
payload whole. `CalendarSource` now keeps the `capacity` it had been fetching and
dropping since the room list was built.

**The invariant, and why it is one memo.** The modal's own list and the per-room lists are
computed in a single pass through one new pure function (`lib/availabilityWindow.ts`), so
*the union of the rooms is exactly the list on screen* — by construction, not by two
pieces of code agreeing. If they ever drifted, a recipient would click a date the page
offered and be told no room is free on it. That property is the first test in
`availabilityWindow.test.ts` (9 tests; mutation-checked — dropping the profile-wide block
turns one red, and removing `rooms` from the API body turns two API tests red because Zod
strips what it does not declare, which is the failure that reads exactly like a frontend
bug).

Proven live, end to end on seeded data: one press minted `/a/OQebqH5VdI5P`, and the stored
payload holds **Back Room (cap 80) free 31 nights** and **Main Room (cap 400) free 30** —
different lists, because Main Room has a show — with `union of rooms === availableDates`
**true**. The stranger's door returns both rooms with "The Lantern Hall" resolved live.

**Stale prose fixed on the way:** `lib/availabilityShareLink.ts` still explained at length
why the snapshot travels in the URL fragment and why the public page "should not get" a
room id. Both were overtaken — by `123qy9rpqn0` and by this ticket — and a file that
argues for the design it no longer has is how the next reader inherits a wrong
conclusion. It now states the snapshot-not-live-feed decision, and why an id the API
validates on arrival (`placeOfRequest`) grants its holder nothing.

Suites: biome 710 clean · web 320 (9 new) · api 1306 (`participants.test.ts` re-run alone
after the port flake) · e2e 112.

**D2 — plan.** The page has the room data now; this is what the visitor sees. Clicking a
date already opens the ask panel bound to that night, so the room belongs **in the panel**
rather than as a step before it — it is part of the ask, and putting it there costs no
extra click when only one room is free.

- **One room free** → a statement, not a question: *"Main Room (400 cap) is the only room
  free on this date."* It rides into the request. There is no ambiguity to make the
  visitor resolve, and the sentence is on screen if they disagree in their message.
- **Several free** → a select, defaulting to **"Any room — they'll decide"**. Not
  defaulting to a named room: pre-picking one puts words in a stranger's mouth, and the
  operator chooses the room on accept anyway. Each option carries its capacity, which is
  the fact that decides whether a show fits.
- **No room data** (a legacy fragment link, or a profile that is not a venue) → no room UI
  at all, exactly the page it is today.
- **A booked room is never offered**, by construction: the list is the rooms whose OWN
  free nights contain that date.
- `venueProfileId` + `stageId` are sent **together or not at all** — the API refuses a
  room with no venue ("A room needs the venue it is in"), and refuses a room that is not
  in that venue, so a hand-edited payload is answered by `placeOfRequest` rather than by
  this page's trust.

**D2 — the page answers per date, and the ask carries the room. Item 1 is done.**
Clicking a date hands the panel the rooms whose OWN free nights contain it, so a room
already sold that night is never offered — not filtered out, never constructed.

Proven live, the whole chain in one pass: minted `/a/E_qlKNkuoLC0` as the operator →
clicked **Wed · Oct 14**, the night Main Room is confirmed, and the panel said *"Back Room
(80 cap) is the only room free on this date."* → clicked **Thu · Oct 15**, both free, and
got the chooser with *Any room — they'll decide* selected → picked **Main Room (400 cap)**
and sent → the row landed with `venue_profile_id` = The Lantern Hall and `stage_id` = Main
Room → **the operator's inbox card reads "ROOM · Main Room"**. Suites: biome 710 · web 320
· marketing 16 (5 new, mutation-checked two ways) · api 1306 (`profiles.test.ts` re-run
alone after the port flake) · e2e 112.

**Two things I got wrong earlier, found by doing this:**

1. **`/a/<token>` 404'd on a laptop.** B2a added the rewrite to `firebase.json` and not to
   `apps/marketing/vite.config.ts`, whose entire reason for existing is *"a link that
   works on the deployed site 404s on a laptop — and the address a developer tests is not
   the address the world gets."* I tested `?a=<token>` that day and never followed the
   address the app actually mints. Fixed, and the plugin now carries three prefixes.
2. **The inbox card never showed the room.** My **A** entry above says *"the inbox reads
   'Main Room'"* — that was the API response carrying `stageName`, not the card, which
   renders Wanted date / Source / Fee / Email and nothing else. The chain ended one step
   short of the person who decides. `RequestCard` now has a Room cell, fed from the API's
   own `stageName` rather than by fetching a roster the inbox has no business holding.
