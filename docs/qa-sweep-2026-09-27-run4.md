# QA sweep — 2026-09-27, run 4

**Stack under test:** local `pnpm dev`, already running and freshly seeded when the sweep started.
**Commit:** `4b06df1` on `main` (working tree clean). API process started 17:16:19, HEAD committed
17:15:53 — so the running API is **not** stale relative to the checkout (checked with `ps -eo lstart`,
because `pnpm dev` runs the API under plain `tsx` with no watch).

**Seats used**
- **Seat 1 — Playwright MCP**: `operator@` (The Lantern Hall) for most of the run, then `performer.a@`.
- **Seat 2 — Chrome DevTools MCP**: `co.host@` (Northlight Presents), then `professional@`.
- **API**: `.claude/skills/verify-e2e/api-as.mjs` for rule checks and for the account kinds that
  could not get a browser seat at the same time.
- **Postgres**: via `docker exec -i showme-e2e-postgres psql -U postgres -d showme` (there is no
  `psql` on this host's PATH).

Screenshots: `docs/screenshots/qa-2026-09-27-run4/`.

**One thing about reproducing this.** The working tree was clean at 17:19 when the sweep started and
was **not** clean when it finished at ~18:05 — somebody was editing application code alongside me
(`apps/api/src/routes/events.ts`, `apps/api/src/routes/events-list.ts`,
`packages/auth/src/presets.ts`, `apps/web/src/components/EventPublishPanel.tsx`, a new
`apps/api/src/lib/event-publication.ts`, regenerated api-client models). None of it is mine — the
only paths I wrote are this file and its screenshot folder. It does **not** invalidate anything
below: the API process has been up since 17:16:19 and `pnpm dev` runs it under plain `tsx` with no
watch, so every API answer in this report came from `4b06df1`, and Vite HMR only affected the web
half. But a reader re-running these probes now is running against different code, and should
`git stash` to `4b06df1` or expect divergence.

---

## Findings

(filled in per area below; most severe first within each area)

### QA4-1 — MAJOR — The delete refusal tells an operator to cancel a show that can never be deleted, and cancelling it is irreversible and notifies everybody

**Account:** operator (`operator@`) · **Route:** `DELETE /api/v1/events/:id`, reached from Events → row menu → "Delete permanently…"

**What I did** — on `Spring Warmup` (concluded, one performer on the bill, a finalized settlement and an
invoice), three steps:

```
STEP 1  DELETE /events/…e2
  409 conflict: "Spring Warmup" has 1 other party on it (Marlo Vance). … If the show is off,
  CANCEL it: that tells them why, and a cancelled show can then be deleted. …

STEP 2  PATCH /events/…e2 {"status":"cancelled","cancellationReason":"QA4: following the delete
        refusal's own advice"}
  200  — and `notifications` now holds  event.cancelled → e2e-performer-a

STEP 3  DELETE /events/…e2
  409 conflict: "Spring Warmup" has a settlement on it, which is the financial record of the
  night … That cannot be thrown away. Leave the show archived.
```

**Expected** — `apps/api/src/lib/event-delete.ts` states the rule itself: *"The order is deliberate:
the permanent facts are reported before the procedural one, **so nobody is ever told 'cancel it
first' about a show they will never be allowed to delete**."* The settlement (clause 4) and invoice
(clause 5) checks are ABSOLUTE; the other-party check (clause 2) gives way to a cancellation
(decisions #25.3). So on a show with money, the settlement clause must answer first.

**Actual** — clause 2 runs before clauses 4 and 5, so the first refusal is the *conditional* one and
it recommends a step that is irreversible, that broadcasts to every party, and that achieves
nothing. In step 2 the performer received a bell saying a show they played in May and were paid for
is cancelled. The show is now `cancelled` in Postgres and there is no undo in the UI (the status
field can be set back, but the notifications have been sent).

**Evidence** — the three calls above, `.claude/skills/verify-e2e/api-as.mjs`, verbatim. Postgres
after step 2: `select title,status from events where id='…e2'` → `Spring Warmup | cancelled`;
`select type,title,body,user_id from notifications where type='event.cancelled'` →
`event.cancelled | "Spring Warmup" was cancelled | QA4: following the delete refusal's own advice | e2e-performer-a`.

**Scope** — reproduces for any event carrying a settlement or an invoice AND another party. Same
route, same clause order, for every account kind that can reach delete (host operator only).

**The one-line fix, for the report and not for me to make:** move the `settlements` and `invoices`
checks (clauses 4 and 5) above the `others` and `signed` checks in `assertEventIsDeletable`.

---

### QA4-2 — MAJOR — A co-host can rename and CANCEL the host's show

**Account:** coHost (`co.host@`, Northlight Presents) acting on `Marlo Vance — Album Release`, whose
`host_profile_id` is The Lantern Hall · **Route:** `PATCH /api/v1/events/:id`

**What I did**, with `X-Profile-Id: …a6` (Northlight Presents):

| probe | result |
|---|---|
| `PATCH {"title":"QA4 coHost rename attempt"}` | **200 — saved.** `events.title` changed in Postgres |
| `PATCH {"eventDate":"2026-10-21"}` | 200, but correctly converted into an `event.change_requested` — the date did **not** move. ✅ |
| `PATCH {"status":"cancelled","cancellationReason":"QA4 probe"}` | **200 — the show is cancelled**, and `event.cancelled` went to performerA, performerB, the agent, the crew *and the host* |
| `DELETE /events/:id` | 403 — *"Only the profile operating this show can delete it."* ✅ |

**Expected** — `event-delete.ts` states the boundary in its own words: *"A co-promoter holds
`operator_full` and therefore `event.delete`, but **the show is not theirs to end**."* Cancelling a
confirmed show **is** ending it — it is the first rung of the delete ladder (#25.3), it takes the
public page dark, and it notifies every party. The date move is already protected by exactly the
right mechanism (a change request every party must answer); a rename and a cancellation are not.

**Actual** — the co-host renamed somebody else's show and called it off, unilaterally. The host only
learns from a bell.

**Evidence** — Postgres after the probes:
`events.title = 'QA4 coHost rename attempt'`, `events.status = 'cancelled'`;
`activity_log` shows `event.updated {"fields":["title"]}` and
`event.status_changed {"to":"cancelled","from":"confirmed","reason":"QA4 probe"}`, both with
`actor_profile_id = …a6`. Rendered in the browser on the Event History tab —
`docs/screenshots/qa-2026-09-27-run4/12-event-history-reason-and-cohost.png`.

**Scope** — the co-host holds `operator_full`; any operator-role collaborator with that preset can do
the same. I restored the title and status afterwards and deleted the probe notifications.

---

### QA4-3 — MAJOR — Rider preview is broken end to end in local dev: two independent storage signers

**Account:** operator (any) · **Route:** `GET /api/v1/events/:id/riders/:rid/preview-url` → the URL it returns

**What I did** — attached a rider as operator (see QA4-6), then opened it from the Riders & Documents
card. The modal shows a spinner that never resolves.

**Expected** — the issued signed URL is redeemable; in local dev the loopback signer's sink serves the
bytes back (`apps/api/src/lib/storage.ts` — *"upload → download returns what was uploaded"*).

**Actual** — every rider preview URL 400s immediately:

```
1192. [PUT]  /api/v1/files/local-object/ijyrXJXHHfZLZF8S9y0HHTupELgqkDmG  => 200 OK      (bytes stored)
1196. [GET]  /api/v1/events/…e1/riders/84a1…/preview-url                  => 200 OK
1197. [GET]  /api/v1/files/local-object/N8WgJqIpt1HnyHmYJd_J3dEIOdH_I4AD  => 400 Bad Request
      {"error":{"code":"bad_request","message":"Invalid or expired download URL"}}
```

Reproducible on a URL fetched and redeemed within the same second.

**Cause, read off the wiring** — `apps/api/src/app.ts:186` decorates ONE signer (*"One signer for the
whole app"*) and `:245` mounts its sink with `createFileRoutes(app.storageSigner)`. But `:228`
registers `riderRoutes`, and `apps/api/src/routes/riders.ts:545` is
`createRiderRoutes(defaultStorageSigner())(fastify)` — a **second** `createLoopbackStorageSigner`
with its own empty `grants`/`objects` maps. Rider download grants are therefore minted by a signer
the sink has never heard of. The same shape exists for `fileRoutes` at `routes/files.ts:409`, but
that default plugin is not the one registered.

**Scope** — local dev / any deployment without `FIREBASE_STORAGE_BUCKET`. With a real GCS bucket both
signers are stateless and agree, so production is unaffected — but it makes the rider feature
unverifiable on a laptop, which is where it is being verified.

**Secondary (MINOR):** the preview modal has no failure state. A 400 leaves it spinning forever with
no message — `docs/screenshots/qa-2026-09-27-run4/06-rider-preview-broken.png`.

---

### QA4-4 — MAJOR — The operator's own document is invisible to every act on the bill

**Accounts:** operator uploads; performerA / performerB / agent / crew read · **Route:**
`GET /api/v1/events/:id/riders`, and the Riders & Documents card on `/events/$id?tab=details`

**What I did** — attached `The Lantern Hall — House Rules (QA4)` as the operator (it lands owned by
the HOST participant `…b1`), then read the rider list as every account kind.

```
operator      Tech Rider 2026 | Hospitality Notes | The Lantern Hall — House Rules (QA4)
coHost        Tech Rider 2026 | Hospitality Notes | The Lantern Hall — House Rules (QA4)
performerA    Tech Rider 2026
performerB    Hospitality Notes
agent         Tech Rider 2026
teamAndCrew   (none)
```

Confirmed in a browser in the second seat: signed in as `performer.a@` on
`/events/…e1?tab=details`, the card lists **only "Tech Rider 2026"** —
`docs/screenshots/qa-2026-09-27-run4/10-performer-riders-missing-operator-doc.png`.

**Expected** — the half of ClickUp `123qy9rnk1u` that this capability change exists for is, quoting
the preset's own comment, *"the venue's own paperwork — `{Venue Name}: Technical info · Equipment
list · Rules of Behavior`"*. Those are documents whose only purpose is to be read by the act.

**Actual** — `scopedEventRiders` (`apps/api/src/routes/riders.ts`) gives a performer
`new Set([participant.id])` — their own participant row and nothing else — so a rider owned by the
host participant is filtered out for everyone except callers holding `budget.view` (i.e. operators).
The operator can now upload, and nobody it was written for can see it.

**Scope** — every non-operator role on every event. This is the open question the brief flagged; the
answer is that the delivery half is not built. Half a feature, and the half that ships looks like it
works.

---

### QA4-5 — MAJOR — The co-host's Budget Planner promises to leave break-even out and then prints it

**Account:** coHost (`co.host@`) · **Route:** `/events/e2e…e1?tab=budget` (Shared ledger)

**What I did** — opened the shared ledger as the co-promoter, who is deliberately not shown the act's
deal (decisions #25, *"A co-promoter does NOT see the act's fee automatically"*).

**Expected** — the screen's own sentence: *"One of this event's deals is not shown to you, so what the
night costs is higher than the total above. **Profit, margin and break-even are left out rather than
calculated without it.**"*

**Actual** — immediately below that sentence, the BREAK-EVEN ANALYSIS chart is drawn with a marked
crossing point and the caption **"Revenue passes total cost at 131 tickets of 400 capacity."** That
131 is computed from `TOTAL COSTS (PARTIAL) SEK 34,770`, which excludes the SEK 85,000 performer fee
— the same night reads as *"Revenue never passes total cost inside 400 capacity"* on the host's
screen. The co-promoter is handed a concrete, optimistic break-even the app has just said it would
not compute.

**Evidence** — `docs/screenshots/qa-2026-09-27-run4/09-cohost-breakeven-contradiction.png`.
`TOTAL COSTS (PARTIAL)` 34,770 = 12,000 + 9,000 + 8,500 + 3,500 + 1.5% of 118,000; the host's total
is 119,770 with the fee.

---

### QA4-6 — MINOR (and a PASS worth naming) — The operator rider upload works; the dialog's type list has nowhere to put a venue document

**Account:** operator · **Route:** `/events/$id?tab=details` → Riders & Documents → Upload

The whole upload really does land. Network: `POST /files/upload-url` 201 → `PUT <signed URL>` 200 →
`POST /profiles/…a1/riders` 201 → `POST /events/…e1/riders` 201, and the row appears without a reload.
Postgres:

```
files:  0afe4989… | profiles/e2e…a1/riders/04d7b4b6-…-lantern-hall-house-rules.pdf
                  | document | application/pdf | 61 bytes | owner …a1
riders: 8ee6d449… library  (owner_profile_id …a1, event_id NULL)
        84a1ffa0… instance (event …e1, owner_participant_id …b1 = the HOST participant)
```

The **minor** part: the dialog is titled "Attach a rider" and its Type list is `Tech rider ·
Hospitality rider · Stage plot · Input list` — four *artist* document types. A venue's house rules
had to be filed as a "Tech rider", and the card is called "Riders & **Documents**". The capability
was widened to operators without widening the vocabulary.

Two more small things on the same dialog:
- The file control is a **raw, unstyled `<input type="file">`** ("Choose file / No file chosen") in an
  otherwise fully designed modal — `docs/screenshots/qa-2026-09-27-run4/05-rider-upload-dialog.png`.
- A 61-byte file is rendered as **"1 KB"** in the dialog (the rider detail view gets it right: "61 B").

**Permission gating is correct**, checked against `GET /events/:id` capabilities rather than the button:
`rider.submit` is true for operator, coHost, performerA, performerB; **false for teamAndCrew** (no
Upload button — as required) and **false for the agent**. The agent one may be a gap: `RIDER_FILING_ROLES`
in `useRiderUpload.ts` lists `agent`, and the agent can *read* their act's rider, but holds no
`rider.submit` in any preset, so an agent cannot attach a rider for the act they represent.

---

### QA4-7 — MAJOR — Inviting an act through "Invite Collaborator" never attaches their agent, and the agent is never told on ANY path

**Accounts:** operator invites; agent (`agent@`, Astra Booking, represents Marlo Vance) is the party
that should hear · **Routes:** `POST /api/v1/invitations` + accept, versus `POST /api/v1/events`

`representations` holds one **active** row: Astra Booking → Marlo Vance, region `{SE}`, confirmed by
both sides, no termination. Both events below are at The Lantern Hall, Stockholm, `SE`.

**A / B, same act, same representation, two creation paths:**

| path | result in `event_participants` |
|---|---|
| **`POST /events` with the act in the bill** (the wizard) | `The Lantern Hall host` · `Marlo Vance performer` **+ `Astra Booking Agency agent`**, and Marlo's row carries `{"delegatedToAgentProfileId":"…a5"}`. Event advanced `draft → suggested`. |
| **Collaborators → Invite → Performer → accept** (`POST /invitations`, then accept) | `The Lantern Hall host` · `Marlo Vance performer` · `Northlight Presents co_host`. **No agent row. `details` is NULL — no delegation stamp.** |

**Cause** — `autoAssignAgentOnPerformerJoin` has exactly three call sites: `routes/events.ts:391`,
`routes/inbound.ts:791`, `routes/participants.ts:373`. `routes/invitations.ts:1029` inserts the
participant row directly and calls none of them. Commit `3cf3d17` established that day that
`POST /events/:id/participants` "*a route apps/web never calls*" — so the invitation path is one of
the two paths a real person takes, and it is the one that skips this.

**And the agent is never NOTIFIED on either path.** After the wizard-path creation the notifications
table holds `event.participant_added → e2e-performer-a` and nothing for `e2e-agent`, even though the
agent was attached to that same event in the same transaction:

```
event.participant_added | Added to "QA4 Agent Assignment Probe" | e2e-performer-a | 15:58:09
```

**Expected** — decisions #14 and the sweep brief: *"the agent must be told when their act is
invited, and must not be able to stand on an event the act never agreed to."* Half of that rule has
no mechanism at all.

**Scope** — reproduced on two freshly created events in this run. Any operator inviting a
represented act from the Collaborators tab gets a bill with no agent on it.

---

### QA4-8 — MAJOR — A share link for a CANCELLED show presents it as a live booking, and withholds the venue document the dialog promises

**Accounts:** operator shares; `performer.a@` opens · **Route:** `/shares/<token>` (the standalone viewer)

**What I did** — with `Marlo Vance — Album Release` **cancelled**, opened Share & Export, ticked
*Event details · Schedule · Riders & documents*, addressed it to `performer.a@e2e.showme.test`,
created the link, then opened it in the second browser and passed the emailed one-time code.

**Expected** — the viewer's own promise, printed on the page: *"This page reads the event as it
stands right now — it is not a copy"*; and the share dialog's own description of the riders option:
*"Their own rider **and the venue's house documents**. Never another act's."*

**Actual** — two things:
1. **No mention of the cancellation anywhere.** The page reads "THE SHOW · Marlo Vance — Album
   Release · 14 Oct 2026 · Doors 19:00 · On stage 20:00", exactly as it would for a live booking.
   Compare the **public** event page, which handles this correctly (a cancelled event 404s from
   `GET /public/events/:id` — verified).
2. **RIDERS & DOCUMENTS lists only "Tech Rider 2026"** — the act's own. `The Lantern Hall — House
   Rules (QA4)` is absent, so the sentence that sold the checkbox is not true. This is QA4-4
   reaching a second surface.

**Evidence** — `docs/screenshots/qa-2026-09-27-run4/22-share-viewer-cancelled-and-no-venue-doc.png`,
and `21-share-export.png` for the dialog copy. `events.status = 'cancelled'` in Postgres at the time
the page was rendered.

**Scope** — any share of a cancelled show. The OTP gate, the email masking and the token shape were
all correct (see *What passed*).

---

### QA4-9 — MINOR — Every account kind is offered "Cancel show…" and "Delete permanently…" on somebody else's show

**Accounts:** performerA, teamAndCrew (and, by construction, anyone on the bill) ·
**Route:** `/events` → the row's ⋮ menu

**What I did** — signed in as `performer.a@`, opened the row menu on `Spring Warmup` (host: The
Lantern Hall, a show the performer merely played):

```
Cancel show…   Marks it cancelled and tells everyone on the bill why. Nothing is deleted.
Archive        Hides it from your lists. Nobody else is affected.
```

and on the cancelled `Marlo Vance — Album Release`: `Archive` + `Delete permanently…`. As
`professional@` (crew): `Archive` + `Delete permanently…` on the operator's show.

Then I clicked it through: typed a reason, pressed "Cancel the show".

**Expected** — the menu offers what the caller may do. `useEventRowActions.tsx` gates the cancel
entry only on `event.status !== "cancelled"` and the delete entry only on `cancelled || archived` —
neither consults capabilities.

**Actual** — the buttons are offered and the API refuses, correctly and for the right reason:
`403 {"code":"forbidden","message":"Missing capability: event.edit"}` for the cancel, and
`Missing capability: event.delete` for the delete. Nothing was damaged (`Spring Warmup` stayed
`concluded`). **So the rule holds — this is a UI-only boundary leak** — but the toast a performer
gets when they press the button they were offered is *"This part of the event isn't shared with
you. Ask the host if you need it."*, which is about sharing and has nothing to do with the
authority they were actually refused.

**Evidence** — `docs/screenshots/qa-2026-09-27-run4/13-performer-offered-cancel-and-delete.png`;
the two `api-as.mjs` 403s above; Postgres unchanged.

---

### QA4-10 — MINOR — "BREAK-EVEN TICKETS 0" when break-even is unreachable

**Account:** operator (also seen on the co-host's screen) · **Route:** `/events/$id?tab=budget`

**What I did** — three states on two events:

| state | KPI | the chart under it |
|---|---|---|
| revenue 118,000, costs 119,770 (fee takes 100% of the adjusted net) | `BREAK-EVEN TICKETS 0` | "Revenue never passes total cost inside 400 capacity." |
| revenue SEK 0, a SEK 40,000 draft guarantee | `BREAK-EVEN TICKETS 0` | (unreachable) |
| revenue 64,000 (320 × SEK 200), costs 40,960 | `BREAK-EVEN TICKETS 204` | "Revenue passes total cost at 204 tickets of 400 capacity." ✅ |

**Expected** — when the line never crosses, the KPI should say so (an em dash, "not reachable"),
not "0". "0" reads as *you break even before selling a ticket*, which is the opposite of the truth,
and it contradicts the chart caption two inches below it.

**Actual** — `0`. The third row above shows the arithmetic is right when a crossing exists:
40,000 ÷ (200 − 1.5%×200) = 203.05 → 204. Hand-checked.

---

### QA4-11 — MINOR — A budget line's LABEL does not follow its quantity, and the settlement will print the stale one

**Account:** operator · **Route:** `/events/$id?tab=budget` → Ticket types → QTY

**What I did** — changed the Advance tier's quantity from 260 to 400 and reloaded.

**Actual** — the amount and the totals updated everywhere (SEK 65,000 → SEK 100,000; "460 tickets
planned"), but the row's own name is still `Advance ticket sales (260 @ 250 SEK)`. In Postgres:

```
label                                | amount   | details
Advance ticket sales (260 @ 250 SEK) | 10000000 | {"basis":"ticket_tier","quantity":400,"unitAmount":"25000"}
```

`260` and `quantity: 400` are in the same row. The label is what the settlement document and the
CSV export print, so the financial record will describe 260 tickets beside a figure for 400.

**Evidence** — the SQL above; visible in the browser at
`docs/screenshots/qa-2026-09-27-run4/17b-mobile-budget-tickets.png` (QTY 400 under a label saying 260).

---

### QA4-12 — MINOR — The settlement's Financials tab offers to re-seed a FINALIZED settlement, and says nothing when the server refuses

**Account:** operator · **Route:** `/events/e2e…e2/settlement` → Financials

**What I did** — on the **finalized** Spring Warmup settlement, the tab still asks *"How do you want
to enter financials?"* and offers **Start from the Budget Planner** / **Start fresh — type the real
figures**. I clicked the first.

**Actual** — `POST /events/…e2/settlement/compute` returns **409** with exactly the right reason:

```
"This settlement is finalized — its figures are locked to the snapshot. Transfers can still be
 marked paid; the figures cannot be recomputed."
```

**and the screen shows nothing at all** — no toast, no inline error, no change. The operator presses
the recommended button on a locked settlement and the app is silent. (The delete path *does* surface
its 409 as a toast, so the pattern exists — this one is missing it.)

The chooser being offered at all is the other half: the rule is knowable from the settlement's own
`status`, so a finalized settlement should not be asked how it wants its figures entered.

---

### QA4-13 — MINOR — The event workspace tab is not in the URL, so reload and Back both lose it

**Account:** all · **Route:** `/events/$eventId`

**What I did** — opened Spring Warmup, clicked **Deals**, then **Budget Planner**, logging
`location.pathname + location.search` after each.

```
/events/e2e00000-0000-4000-8000-0000000000e2
/events/e2e00000-0000-4000-8000-0000000000e2
/events/e2e00000-0000-4000-8000-0000000000e2
```

Reloading while Budget Planner is selected lands on **Event Details**.

**Expected** — `apps/web/src/router.tsx` builds the route specifically so that *"`?tab=` names ONE
PANEL of the event workspace, so a panel can be linked to from outside it"*, and the same route's
`?budgetScope=mine` **is** written to the URL by the scope chooser (verified — QA sweep run 3
fixed exactly this for the budget scope). The read path works: `?tab=budget` typed by hand opens the
planner every time. Only the write is missing.

**Actual** — the tab strip changes component state and never touches the URL, so the Back button
skips the entire tab history in one jump and no reader can copy a link to the panel they are on.

---

### QA4-14 — MINOR — The event creation wizard cannot link a venue profile, so a new show is silent about a night that is already booked

**Account:** operator · **Route:** Events → New event → step 1

**What I did** — created `QA4 Double Booking Probe` for **14 Oct 2026** at **The Lantern Hall** —
the same room, the same night as the then-confirmed `Marlo Vance — Album Release`. The wizard's
Venue field is a **plain text box** (placeholder "e.g. Funkhaus"); there is no picker and no
suggestion list. No warning appeared at any point in the wizard, and none on the workspace afterwards.

Postgres, straight after creation:

```
title                    | status | event_date | venue_profile_id | venue_name
QA4 Double Booking Probe | draft  | 2026-10-14 | (null)           | The Lantern Hall
```

I then opened Event Details and re-picked "The Lantern Hall" from the field's **MY PLACES**
list — which sets `venue_profile_id` — and the warning appeared immediately:

> Already on this night: "Marlo Vance — Album Release" in Main Room. This room is still free.

**Expected** — commit `c875e17` ("an event at rest says when its night is already booked") makes the
clash visible at rest; its own note says *"an event with no venue asks nothing at all"*. The wizard
is the only place a show is born, and it cannot give the event a venue.

**Actual** — every show created through the wizard starts with `venue_profile_id = NULL`, so the
double-booking check has nothing to compare until somebody happens to re-pick the venue by hand.
The detection itself is correct — it is the entry point that starves it.

**Related, and it PASSED:** once `venue_profile_id` is set and the event is `confirmed`, the night
drops out of Check & Share Availability — 14 Oct disappeared from the available list and from the
shared link. That rule holds.

---

### QA4-15 — MINOR — `POST /events/:id/participants` refuses a removed participant with the wrong reason

**Account:** operator · **Route:** `POST /api/v1/events/:id/participants`

Removing Marlo Vance from an event soft-deletes (`event_participants.status = 'removed'`), and the
unique index on `(event_id, profile_id)` survives. Re-adding through the API gives:

```
409 {"code":"conflict","message":"That profile is already a participant on this event"}
```

which is not what the row says and not what the Collaborators tab says (*"Nothing they did here is
deleted, and you can put them back"*).

**The UI is fine** — the row's ⋮ menu grows a **Restore** entry (*"Puts them back on this event as
accepted"*) and it works; I used it and the status went back to `accepted`. So this is the API's
message only, and it matters for the agent-native surface the platform is being built toward: a
caller told "already a participant" has no way to learn that the fix is Restore.

---

### QA4-16 — MINOR — A cancelled show still asks three people to agree a new date

**Accounts:** agent (`agent@`), performerA, coHost · **Route:** `/events/e2e…e1` (any tab)

`Marlo Vance — Album Release` is **cancelled**. Every party still sees, pinned above the workspace:

> A change to this booking is waiting on an answer — Date 14 Oct 2026 → 21 Oct 2026 — Waiting on 3
> people to answer. Nothing moves until everyone agrees.

and the agent is still offered **Confirm / Decline**. `event_change_requests` holds one row with
`status = 'pending'` against a cancelled event. Cancelling the show does not withdraw the open
change request.

---

### QA4-17 — MINOR — "Top venues by revenue" is empty on a dashboard that is showing revenue

**Accounts:** operator and performerA · **Route:** `/`

Both dashboards render `SETTLEMENTS · Finalized SEK 20,700` (operator) / `SEK 46,500` (performerA)
and `Recent settlements: Spring Warmup · Finalized`, while the panel beside it says **"No revenue
yet — Revenue by venue appears here once your events start settling."** An event *has* settled, and
its venue is The Lantern Hall.

On the same screens the four settlement tiles are not mutually exclusive — the operator's
`OUTSTANDING SEK 20,700` and `FINALIZED SEK 20,700` are the same settlement counted twice, with
nothing saying so; and the Settlements list labels the operator's column **YOUR PAYOUT SEK 20,700**
when the operator is the party paying SEK 46,500 out and keeping 20,700.

---

### QA4-18 — NOTE — Inviting a "Co-operator" with "Standard for the role" gives them no budget at all

**Account:** coHost, invited/edited onto `QA4 Double Booking Probe` as Co-operator · **Route:**
Collaborators → Edit → Role: Co-operator, Access: "Standard for the role"

After the save, `event_participants.permission_set_id` is **NULL** and the effective capabilities are
`event.view, schedule.view, deal.view.own, settlement.view.own` — no `budget.view`, no `event.edit`,
no `rider.submit`. Their workspace has **no Budget Planner tab** and no Upload button, after a hard
reload.

**This is deliberate and documented** — `packages/auth/src/presets.ts`: *"'Standard' deliberately
attaches NO permission set, resting the whole promise on this floor … The budget is NOT here."* So
it is not a bug. It is filed as a NOTE because the only way to give a co-promoter the shared ledger
(which `PLAN.md:215` says is the point of co-promotion) is the **"Full control — paid plans only"**
option, and the Access selector disappears entirely for the Crew / Crew lead / Performer roles. The
preset `view_only: ["event.view"]` exists in code and is not offered anywhere in the invite or edit
dialog, so a view-only reader cannot be created from the UI at all — which is why I could not test
the brief's "view-only reader should see no Upload button" other than through the capability
(`rider.submit` is absent from `view_only`, so the button would not render).

---

### QA4-19 — NOTE — Confirmed gaps, stated plainly rather than re-filed as bugs

- **Realtime: messages arrive, budgets do not.** With two independent browsers — operator in
  Playwright, co-host in Chrome DevTools — a message posted by the operator appeared in the other
  browser without a reload and moved its bell (`Notifications (2 unread)`), and a cancellation
  appeared as a live bell with the reason as the body. But changing `Sound & production` from SEK
  12,000 to SEK 22,000 on the shared ledger left the co-host's open Budget Planner showing **12,000
  and `TOTAL COSTS (PARTIAL) SEK 34,770`** indefinitely; a reload showed **22,000 / SEK 44,770**.
  This is the documented shape (`useRealtimeStream.ts` invalidates notifications and, for
  `event.message_posted`, messages and threads — nothing else) and it is **worse than "a frame that
  changes nothing"**: no frame is published for a budget edit at all.
- **No incoming request carries a venue or a room.** All six seeded `booking_requests` rows have
  `venue_profile_id = NULL` and `stage_id = NULL`, so the Requests screen cannot show a
  double-booking warning and does not. decisions #25.1 names this as the first piece of work.
- **decisions #25.1's "Accept request" is not built.** The Requests cards still offer *Create Draft ·
  Make Offer · Decline · Block · Archive*.
- **`apps/marketing` is not started by `pnpm dev`.** It was already running on `localhost:5173` from
  an earlier session; a sweep on a clean machine would not reach the public pages at all.
- **There is no saved display-currency and no date-format preference.** Settings → Appearance holds
  a theme switch and nothing else; Settings → General holds BASE CURRENCY and TIMEZONE, which are
  the organisation's, not the reader's. The per-screen "Preview in another currency" is correct and
  does not persist across a reload (checked: set GBP, reloaded, back to SEK with SEK 78,000
  unchanged).
- **Audience has no import or export.** The screen is an empty state with no controls
  (`audience_rsvps` is empty in the seed).
- **The agent cannot attach a rider.** `rider.submit` is false for the agent on every event I
  checked, while `RIDER_FILING_ROLES` in `useRiderUpload.ts` lists `agent` and the agent *can* read
  their act's rider. Possibly intended; recorded because the two halves disagree.

---

### QA4-20 — COSMETIC — Small things, all observed, none blocking

- **Card headings have no accessible name.** Every `<h3>` on the event workspace ("Event
  Information", "Poster", "Riders & Documents", …) renders visibly but exposes an empty accessible
  name to the a11y tree. Screen-reader users get an unlabelled heading on every card.
- **The Status dropdown stays open behind the cancel dialog** it raises
  (`docs/screenshots/qa-2026-09-27-run4/03-status-cancel-dialog.png`).
- **The venue field's helper tooltip covers the card's own content** — it renders over "Event
  Information" and the Event Name value while the field is focused
  (`08b-venue-picker-list.png`).
- **A draft event lights the "Suggested" pip** on the status stepper; there is no Draft step.
- **A 61-byte file is shown as "1 KB"** in the Attach-a-rider dialog (the rider detail gets it right:
  "61 B").
- **The rider's display name keeps the collision-avoidance UUID**:
  `04d7b4b6-dcbc-41cd-a56c-61819dc4b45f-lantern-hall-house-rules.pdf`.
- **`EventCancelModal`'s named-count copy is dead.** It can say "the 2 other parties on the bill are
  told why", but its only call site passes `otherParties: null` unconditionally
  (`useEventRowActions.tsx:343`), so every cancellation says the generic sentence. With 0 other
  parties it would read "the 0 other parties on the bill are told why" if the count were ever passed.
- **The Events list has no status column.** With the "All" chip selected a cancelled show sits beside
  a confirmed one and looks identical; the only column that could tell you is "Settlement", which
  answers a different question (`01-events-chips-operator.png`).
- **The crew's empty rider card says "Yours arrive here for you to read"** — for a crew member the
  card is permanently empty by design, so the sentence promises something that never happens.

---

## The three areas the brief singled out — verdicts

### 1. Cancel-with-reason and the delete ladder (decisions #25.3)

| requirement | verdict |
|---|---|
| Events row menu offers "Cancel show…" on any show not already cancelled | **PASS** — and it is offered to account kinds that cannot use it (QA4-9) |
| It asks for a reason, confirm disabled while blank | **PASS** — checked on both entry points |
| Cancelling notifies every other party with the reason as the body | **PASS** — `notifications` rows for performerA, performerB, the agent, the crew and the co-host, body = the reason verbatim; seen live in a second browser's bell (`11-performer-bell-cancel-reason.png`) |
| The reason is written into History as "Reason: …" | **PASS** — `activity_log.summary.reason`, rendered as `Reason: Storm damage to the roof — the room is closed for October.` |
| Once CANCELLED the menu offers "Delete permanently…", even if never archived | **PASS** — verified on `Nordic Synth Showcase` (cancelled from the row menu, never archived) and deleted through the UI; the event row, its budget, its budget lines and its task all went |
| …even with other parties or a signed agreement on it | **PASS in the guard** — `assertEventIsDeletable` skips clauses 2 and 3 when `cancelled` |
| A show with a settlement or an invoice still refuses with a 409 naming it | **PASS at the end of the ladder, FAILS at the start** — the 409 arrives and names the settlement, but only after the other-party clause has already sent the operator down an irreversible path (**QA4-1**) |
| The Status field on Event Information raises the same reason dialog, not a silent save | **PASS** — the field raises `EventCancelModal`, the confirm stays disabled while blank, "Keep it" reverts the field to Draft and writes nothing (`02`/`03`/`04-*.png`) |

### 2. The Events filter chips

**PASS, exactly as specified.** The row reads **All · Pending · Confirmed · On hold · Concluded ·
Cancelled · Draft · Archived** (`01-events-chips-operator.png`), and each chip asks the server for
its own statuses only — verified chip-by-chip against `GET /events`:

```
(none)                    Winter Gala[cancelled] | Nordic Synth[on_hold] | Album Release[confirmed] | Open Mic[draft] | Spring Warmup[concluded]
status=pending,suggested  (empty)
status=confirmed          Marlo Vance — Album Release [confirmed]
status=on_hold            Nordic Synth Showcase [on_hold]
status=concluded          Spring Warmup [concluded]
status=cancelled          Winter Gala [cancelled]
status=draft              Open Mic Wednesdays [draft]
archived=only             (empty)
```

The same eight chips render for performer, crew and agent accounts.

### 3. Riders & Documents as an OPERATOR

- **The upload is real and the bytes land.** Full four-leg round trip as `operator@`, all 2xx, rows
  in `files` / `riders` (library) / `riders` (instance owned by the HOST participant), and the row
  appears without a reload. Details and the two small blemishes in **QA4-6**.
- **What a PERFORMER sees of it: nothing.** Verified at the API for every account kind and in a
  browser as `performer.a@` — the card lists only their own Tech Rider. **QA4-4**. It is invisible
  through the share link too, where the dialog explicitly promises it. **QA4-8**.
- **A technical crew member sees NO Upload button — correct.** `professional@` (role `crew`) holds
  `rider.submit = false` on `GET /events/:id` and the card renders the explanatory note with no
  button. Re-checked as a `crew_lead` on a second event: no button. **A view-only reader could not
  be created from the UI** (QA4-18); the `view_only` preset carries `event.view` alone, so the
  button cannot render for one either.

---

## What passed — named, because it is the other half of the result

- **Settlement arithmetic, hand-checked on the Spring Warmup ladder.** `door = 70% × 6,900,000 =
  4,830,000` beats the `1,800,000` guarantee; `entitlement = 4,830,000 − 180,000 (Artist hotel) =
  4,650,000`; the operator's residual `6,900,000 − 4,830,000 = 2,070,000`; `held = collected
  7,800,000 − paid 1,080,000 = 6,720,000`; `net = 2,070,000 − 6,720,000 = −4,650,000`. **Σ net = 0.**
  The screen agrees: Gross 78,000 / Deductions 9,000 / Net 69,000 / Adjusted net 69,000, Marlo
  46,500 (69.2%), The Lantern Hall 20,700 (30.8%), with a sentence explaining why the entitlements
  (67,200) fall short of the adjusted net.
- **Per-party deal scoping.** operator sees all 3 party lines; performerA sees only `…b2` (60%);
  performerB only `…b3` (40%); the agent sees its act's line; crew and the co-host get
  `{"deals":[],"hiddenCount":1}`.
- **Per-party settlement scoping.** operator 2 rows, performerA 1 (her own), everyone else none.
- **Ran's 2026-09-21 spec — the fee appears from the DRAFT deal.** A guarantee saved as *"Draft —
  not sent, 0 of 2 signed"* immediately shows on the planner as `Performer fee SEK 40,000 — Read
  from the deal "QA4 Draft Guarantee" — still an offer, nobody has confirmed it. Nothing is stored
  on the budget: change the terms and this moves with it.`
- **The fee tracks quantity live and the planner's own arithmetic holds.** Advance qty 260 → 400
  moved revenue 83,000 → 118,000 and the fee 50,000 → 85,000 (= revenue − the 33,000 of sheet costs;
  the 1.5% processing estimate is deliberately outside the split base and outside the settlement,
  `useBudgetEditor.ts`). Payment processing 1.5% × 118,000 = 1,770 ✓; revenue/guest 118,000/460 =
  257 ✓; break-even 40,000 ÷ 197 = 204 ✓; Projections 196,000 − 43,800 = 152,200, ÷3 = 50,733 ✓.
- **Display currency never moves a settled amount.** SEK → EUR on a finalized settlement converts
  every figure with a `≈` and a banner (*"the settlement is denominated in SEK, and that is what is
  owed, recorded and paid"*), keeps `SETTLES IN SEK`, keeps the deal sentence in SEK ("beats the SEK
  18,000 guarantee"), and does not persist across a reload. Rate consistent across all five figures.
- **The two books are correctly separated.** Typing a revenue line into the co-host's **My budget**
  wrote it to `budgets(scope=private, owner_profile_id=…a6)`; the host's `GET /events/:id/budgets`
  returns the shared budget plus **their own** empty private book and never the co-host's line, and
  vice versa. `?budgetScope=mine` is in the URL, so the private book is linkable and survives reload.
- **The co-host's withheld figure is handled honestly almost everywhere** — `TOTAL COSTS (PARTIAL)`,
  no PROFIT/LOSS, no margin, and a sentence naming the withheld deal. (The break-even chart is the
  exception — QA4-5.)
- **A finalized settlement cannot be recomputed.** 409 with the right reason (QA4-12 is about the
  silence, not the rule).
- **Crew have no vote on the date.** `POST /events/:id/change-request/:crid/confirm` as
  `professional@` → **403 "This change is not yours to answer — the parties standing on this date
  decide it"**, and `POST /events/:id/change-request` → **403 "Only the venue and the acts on the
  bill can ask to move this booking"**. No response row written. They *do* see the banner, with no
  buttons. Exactly story.md's rule.
- **A co-host cannot move the date unilaterally** — the PATCH became an `event.change_requested`
  and the date did not move; and **cannot delete** the host's show (403, right reason).
- **A performer cannot touch the operator's poster** — "Replace" and "Remove" are rendered *disabled*
  with the sentence "Only the profile operating this show can change its poster."
- **The invitation round trip.** Invite → landing page with the recipient's email masked
  (`c•••@e•••.showme.test`) → sign in → Accept → "You are in" → Open the event, and the inviter got
  `invitation.accepted`. Role change (Crew lead → Co-operator) and Remove/Restore all worked from
  the Collaborators tab. `14-invitation-landing.png`.
- **Realtime for messages and cancellations, across two genuinely independent browsers.** See QA4-19.
- **A sold night stops being offered.** Confirming a show at The Lantern Hall on 14 Oct removed
  14 Oct from Check & Share Availability and from the token-backed shared link.
- **The availability link is a token, as decisions #25.4 asked.** `http://localhost:5173/a/MVdykMDHfJ4y`
  — 36 characters, no dates in the URL, no fragment. The recipient page shows free dates, the window,
  the rooms, "Counted as unavailable: confirmed events" and a snapshot date. No event titles, no money.
- **Share links are addressed and gated.** No anonymous links; the viewer demands the email and a
  six-digit code; `share_otps` stores a salted SHA-256 with a 10-minute TTL and an attempt counter.
  (I recovered a code by brute-forcing the hash from Postgres to finish the test — noted below.)
- **The public surfaces leak nothing and go dark on cue.** `GET /public/events/<cancelled id>` → 404
  for both cancelled events; the public profile renders with "No dates announced right now"; the
  public event page for a concluded show renders a past-show state. `19-public-profile.png`.
- **Mobile, ~390 px, looked at rather than measured.** Events (cards), the Budget Planner (every
  ticket row stacked with its own labels), the settlement workspace and the delete modal all fit;
  `document.documentElement.scrollWidth === clientWidth` on each, and the only element extending past
  the viewport is the workspace tab strip, which is a horizontal scroller by design.
  `15/16/17b/18-*.png`.
- **Refresh-survival.** The rider, the budget quantity, the private-book line, the collaborator role
  change and the cancellation all survived a hard reload.
- **Every sidebar destination rendered with real data for every kind I drove**, with no console
  errors on a clean load and no non-2xx beyond the three deliberate refusals above. Nav sets differ
  correctly by kind: the performer gets **Setlists** and no "New event"; the operator gets
  **Performance Reports · Financial Projections** and no Setlists (visiting `/setlists` by hand gives
  the boundary explanation *"A setlist belongs to the act"*, not a stub); crew gets neither, and no
  Budget Planner tab on the event.

---

## Not reached, and why

- **`pnpm test:e2e` and any vitest suite** — out of scope by instruction (it tears the stack down).
  No baseline was taken and none is claimed.
- **Contacts "Export CSV"** — clicking it closed the Playwright browser twice in a row, so I could
  not read the file. `exportContactsCsv(contacts)` is a client-side blob built from what the list
  returned, which cannot carry more than the caller may see. **UNCONFIRMED** as an app defect; most
  likely the automated browser's download handling. Import CSV was not driven at all.
- **Audience import/export** — no controls exist to drive (QA4-19).
- **Holds, hold ranking and promotion** — the "Place a hold" flow was seen on the Events toolbar and
  not opened. `pnpm jobs:run` was not run, so nothing time-based (expired offers, venue handoffs,
  due representation terminations, FX refresh) was converged.
- **Deductions with "Paid by", advances rendered as "paid in advance by X to Y", the #24 waterfall
  order on a live settlement, and settlement comments / approvals / review** — I checked the
  waterfall arithmetically against the stored `computed` blob and the Overview card, but did not
  create new deduction or advance lines and did not send a settlement for review. The co-host's view
  of "the host sends a settlement for review" is therefore **not** covered.
- **`planning_assumptions.operatorCostSplit`** — the "Production costs split" switch was located on
  both operators' planners and not toggled, so how the split lands per row and whether Σ net stays 0
  under it is unverified.
- **Bonus ladders (#25.5), ticket tiers seeded from `events.extras` into the planner, and "Start from
  the Budget Planner" importing them** — the seeded reference event carries its tiers as budget lines
  rather than in `extras.ticketTiers`, and the only settlement is finalized, so the import path was
  never exercisable. The `extras.ticketTiers.price` major-units trap was therefore **not** tested.
- **Invoices and Performance Reports beyond rendering** — no invoice created, no report filed.
- **Calendar import/export, unavailability marking, room/venue filters, Week/Day views** — the month
  view, `?date=` and the availability dialog were driven; these were not.
- **Google OAuth callback, Setlists authoring, Tasks create/assign/remind, Team staffing against
  availability, profile editing and image upload, RSVP capture.**
- **The `coHost` seat on the money spine of a *live* co-promotion** — the only co-hosted event was
  cancelled partway through the run by the co-host probe (QA4-2) and never had a settlement.

---

## Probes that lied — and what the re-run showed

1. **"The crew's vote is silently discarded."** `POST /events/:id/change-request/:crid/**accept**`
   returned 200-looking output and wrote no response row, which reads exactly like a vacuous success.
   It was a **400 validation error**: *"params/answer Invalid enum value. Expected 'confirm' |
   'decline', received 'accept'"* — my verb, not their bug. Re-run with `/confirm`: **403, "This
   change is not yours to answer — the parties standing on this date decide it"**, nothing written.
   The rule is enforced, and it is in *What passed*. This is why the brief says assert the message.
2. **"Deleting a settled event is refused for the wrong reason" — nearly filed against the wrong
   route.** My first `DELETE /events/…e2` came back **403 "Only the profile operating this show can
   delete it"**, which looked like a boundary bug. It was `api-as.mjs` called without an
   `actingProfileId`, so no `X-Profile-Id` header. Re-run with `…a1`: the real 409, which is QA4-1.
   Right status, wrong reason.
3. **"Re-adding a removed participant is impossible."** The API's 409 is real and its wording is
   wrong (QA4-15), but my conclusion was not: the Collaborators row grows a **Restore** action that
   works. Downgraded from major to minor after driving the UI.
4. **"The co-host's cost lines are hidden on the shared ledger."** I read `innerText` and saw four
   cost rows with no names or amounts. They are `<input value=…>`, which `innerText` does not
   return. Reading `input.value` showed all four, identical to the host's. No finding.
5. **"The poster crop dialog accepts a PDF."** True, but I produced it by assigning a `File` to the
   poster input from a script, bypassing the picker's `accept`. It degrades politely ("This browser
   can't open that picture to crop it — it will be uploaded as it is"). Not filed.
6. **184 × `Error: useAuth must be used within <AuthProvider>` in the console**, thrown from
   `AuthGate` (`main.tsx:74`), all carrying a Vite HMR re-transform token
   (`AuthProvider.tsx?t=1790524755060`). A clean reload of the same screen afterwards produced
   **zero** console errors. Recorded as **UNCONFIRMED** and most likely an HMR artifact of the dev
   server, not a defect — but it is in the log and someone will find it.

---

## State I left behind

The seed was mutated by this sweep and should be reseeded before anything is quoted from it:

- `Nordic Synth Showcase` — **cancelled, then permanently deleted** (with its budget, budget lines
  and one task).
- `Marlo Vance — Album Release` — **cancelled** ("Storm damage to the roof…"); its Advance ticket
  line is 400 @ 250 (was 260), `Sound & production` is 22,000 (was 12,000); it carries a new
  operator rider (`The Lantern Hall — House Rules (QA4)`), a pending date-change request to
  2026-10-21, a private budget for each operator, and an active share link to `performer.a@`.
- `Spring Warmup` — cancelled and set back to `concluded`; the cancellation notification to
  `performer.a@` was sent and was **not** withdrawn.
- Two new events: `QA4 Double Booking Probe` (confirmed, 14 Oct, The Lantern Hall, co-host +
  performerA on it) and `QA4 Agent Assignment Probe` (suggested, 5 Nov, with a draft guarantee deal
  and a SEK 200 ticket tier).
- The probe notifications from QA4-2 were deleted; everything else was left as it fell.

Nothing under `apps/`, `packages/`, `infra/`, a migration, a test or a config was edited. Nothing was
written to ClickUp.
