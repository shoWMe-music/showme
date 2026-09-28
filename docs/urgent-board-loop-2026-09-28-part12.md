# Urgent board loop — 2026-09-28, part 12

Continues `-part11.md`. Run 7's remaining majors, planned before building.

**Docker recovered here.** Its engine had stopped while the Desktop app stayed alive, so the socket
existed and answered nothing — `docker ps` hung for 90s instead of failing, `docker desktop status`
said *"Could not retrieve status"*, and `docker desktop stop` failed with *"processes still running …
context deadline exceeded"*. A force-quit of the `com.docker.*` processes plus `open -a Docker` fixed
it. **Worth knowing: Docker Desktop's helper processes being alive is not evidence the engine is.**

---

## The plan for `QA7-4` and `QA7-5`, which are one thread

The sweep filed them separately and they meet in the middle: `POST /offers` already accepts
`venueProfileId` and `stageId`, so the composer QA7-5 asks for is also a producer of the column
QA7-4's warning reads.

| | Verdict | The file that settles it |
|---|---|---|
| **QA7-4** | **real, and BOTH ends are wrong** — a reader that asks for a column nothing fills, and a producer that could fill it | `routes/Requests.tsx` (the read) + `apps/marketing/src/availability-request.ts` (the write) |
| **QA7-5** | **a mechanism with no caller — the shape this board keeps producing** | a new composer in `apps/web`, calling the generated `usePostApiV1Offers` |

### `QA7-4` — the rule works and is never asked

`useRequestClashes` filters to `request.status === "pending" && request.venueProfileId &&
request.wantedDate`, and **every row in the table has `venue_profile_id` NULL** — every seeded one and
every one the ordinary public form makes. The hook, the route (`GET /events/date-conflicts`), the
message and migration `0047`'s column are all built and correct. Only the producer was never updated
with them, which is the same shape as `123qy9rpqp0` and #25.1's own complaint.

**Two fixes, and the report names the first itself:**

1. **The read.** *"on a request addressed to a venue, `targetProfileId` IS the venue — the hook could
   ask with that and be right for the common case."* So the venue to check against is
   `venueProfileId ?? targetProfileId`, which makes **every existing row work**, seeded rows included,
   with no migration and no backfill. Without a room the check is whole-venue, which is the right
   answer for a request that named no room.
2. **The write.** `availability-request.ts` sends the pair only when a room was picked —
   `...(stageId ? { venueProfileId: target.id, stageId } : {})` — which happens on the
   shared-availability page and never on the ordinary profile form, whose room select defaults to
   "any". The venue is known in both cases; only the room is conditional.

*The decision it hides:* whether "any room" should warn at all. It should — #25.1's reasoning is that
the operator needs to see the clash, and the message already says *"You can book it anyway"*, so the
warning informs rather than blocks.

### `QA7-5` — sending an offer is first-class everywhere except the app

`POST /offers` resolves the acting profile, is entitlement-gated (a `free_artist` is capped at 50
performer-offers a month), accepts a fee range, a pitch, music and video links, an agent's
`onBehalfOfProfileId` (#14) and the venue/room pair — and **`grep -rn "usePostApiV1Offers"
apps/web/src` returns nothing.** The generated hook exists and has never been called.

So a signed-in act's only route to a venue is to leave the app, find that venue's public page and
fill in a stranger's form, which writes `source: public_form`, `sender_profile_id: null`, no fee range
and no agency attribution. The Outgoing tab renders seeded `performer_offer` rows **no user of this
build can produce**, and the free-tier offer cap is unreachable code.

**Scope, and what this is NOT.** A composer on the Requests screen's Outgoing tab — the place that
already lists what it would produce — calling the existing hook. Not a new route, not a new table, not
a new entitlement: all three exist and are tested at the API. The one thing that needs care is the
agent's case, because #14 makes `onBehalfOfProfileId` meaningful only for an `agent`-kind profile with
an ACTIVE representation, and the route answers 400 rather than dropping it silently — so the composer
must offer the act picker to an agent and not to anybody else.

*The decision it hides:* none that is new. #4's cap and #14's representation rule both already decide
what this screen may send; it is the screen catching up with them.

### Order

`QA7-4` first, because it is two small changes in two files and it makes the seeded data exercise a
rule that has never run in the product. Then `QA7-5`, whose composer fills the same column for offers
and is the larger piece.
