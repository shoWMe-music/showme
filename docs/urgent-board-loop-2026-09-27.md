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