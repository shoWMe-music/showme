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
- **B — an availability share is a `shares` row.** `POST /profiles/:id/availability-share`
  writes `{ target_kind: "profile_availability", target_id: profileId, payload: snapshot,
  access: "public" }` and returns the token; `GET /shares/:token` already reads by token
  and serves `payload`. The link becomes `/a/<token>`. Closes `123qy9rpqn0`. *API +
  web + marketing.*
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
