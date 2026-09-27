# QA sweep — 2026-09-27, run 5

The second sweep of the day. Run 4 (`docs/qa-sweep-2026-09-27-run4.md`) found eight majors; this run
re-checks every one of its actionable findings, walks the seven things that landed since, and sweeps
the rest of the app.

## 1. What was driven

**Stack under test.** The local `pnpm dev` stack, already running and freshly seeded when the sweep
started (5 seeded events, 6 profiles, no leftovers from run 4).

| | |
|---|---|
| Commit at start | `d0d4c96` on `main`, clean tree |
| Commit at finish | `f06c728` on `main` — two **docs-only** commits landed mid-sweep (`0b265cd`, `f06c728`: decisions #25.6 and a handoff). No application code changed. |
| API process | started **23:06:48**, HEAD at that moment was `d0d4c96` (committed 23:02:57). It was **not** restarted. `pnpm dev` runs the API under plain `tsx` with no watch, so **every API answer below came from `d0d4c96`** — which is the same application code as `f06c728`. |
| Postgres | `docker exec -i showme-e2e-postgres psql -U postgres -d showme` (there is no `psql` on this host's PATH) |

**Seats.** Only the **Chrome DevTools MCP** browser was available this run (no Playwright MCP tool in
this session), so the two-people-at-once requirement was met a different way: `new_page` with
`isolatedContext` gives genuinely separate browser contexts with their own IndexedDB. **Five
independent signed-in seats ran side by side** and none logged another out:

| seat | account | profile |
|---|---|---|
| `seat-operator` | `operator@` | The Lantern Hall |
| `seat-performer` | `performer.a@` | Marlo Vance |
| `seat-share` → then `professional@` | crew | Priya Sound |
| `seat-cohost` | `co.host@` | Northlight Presents |
| `seat-agent` | `agent@` | Astra Booking Agency |

`performer.b@` was driven **through the API only** (`api-as.mjs`), never in a browser.

**Screens reached in a browser:** Dashboard, Calendar (month, day popover, unavailability marking,
`?date=`), Events (list, chips, row menus, Place-a-hold), Event workspace (Event Details, Budget
Planner, Deals, Team/Crew, Setlist, Settlement, Messages, Collaborators, To Do, Event History),
Settlement workspace (Overview, Deal structure, Financials, Settlement, Payout), Settlements, Tasks,
Team, Contacts, Audience, Reports, Projections, Invoices, Setlists, Profiles, Settings (General,
Security), Requests (incoming + outgoing), the invitation landing, and the share viewer.

**Screenshots:** `docs/screenshots/qa-2026-09-27-run5/`.

---

## 2. Findings

### QA5-1 — MAJOR — The operator's settlement understates what they owe by the co-host's whole share, and explains the gap with a cause that is not the cause

**Account:** operator (`operator@`, host) · **Route:** `/events/$id/settlement` → Overview and Payout ·
also `GET /api/v1/events/:id/settlements`

**What I did.** Built a clean co-promotion end to end: created `QA5 Collaborator Invite Probe`
(25 Nov 2026, The Lantern Hall), invited `performer.a@` through Collaborators, added `co.host@` as a
co-host, entered a VIP tier (40 × SEK 2,000 = SEK 80,000) and a SEK 10,000 production cost, drafted
and confirmed a guarantee-vs-door deal (SEK 30,000 floor / 70% of the adjusted net), set
**Production costs split 70 / 30**, then ran and finalized the settlement.

**Expected.** The operator is the party who pays everyone out. The screen that tells them what they
owe must include every transfer they owe. The arithmetic itself is right — Postgres and the API agree:

```
name                 | entitlement | collected | held    | net
The Lantern Hall     | 1680000     | 8000000   | 8000000 | -6320000
Marlo Vance          | 5600000     | 0         | 0       |  5600000
Northlight Presents  |  720000     | 0         | 0       |   720000
Astra Booking Agency |       0     | 0         | 0       |        0
Σ net = 0
```

70% × 24,000 = 16,800 and 30% × 24,000 = 7,200. Hand-checked; the split is correct.

**Actual — three wrong statements on one operator's screen.**

1. **Payout tab → "Total Payouts":** `Marlo Vance payout SEK 56,000` / **`Total payable SEK 56,000`**.
   Two inches below it, the same card lists the transfers:
   `The Lantern Hall → Marlo Vance SEK 56,000` and `The Lantern Hall → Northlight Presents SEK 7,200`.
   The operator owes **63,200**, which is also what their own "Net" on the same card says
   (`−SEK 63,200`). Three figures on one card and the headline one is wrong.
2. **Overview tab → "ENTITLEMENT BY PARTY"** lists Marlo (56,000, 76.9%) and The Lantern Hall
   (16,800, 23.1%) and nothing else, then explains the shortfall:
   > "The entitlements below come to SEK 72,800, less than the adjusted net: **each line also carries
   > the cash that party collected and the deductions taken off them.** The percentages are shares of
   > the entitlements."

   Nobody collected the missing 7,200 and there are no deductions on this settlement (`deductibles: 0`
   on every row). The gap is a withheld party, and the sentence names a different reason.
3. **"WHO OWES WHOM"** lists two parties while the transfer list underneath it names three.

**Cause.** `GET /events/:id/settlements` scopes the party list through `partiesVisibleTo`
(`apps/api/src/routes/settlement.ts:1133`), which is emergent from being a party to a **deal**. A
co-operator is a party to no deal, and the code says so deliberately: *"NOT co-operators … Worth
knowing when reading a co-host's screen: the residual it is owed is half of a number it cannot see the
whole of."* The **transfers** are scoped separately (`isMyEnd`) and do reach the host, so the API hands
this caller both halves; the screen totals only one of them.

**Evidence.**
- `docs/screenshots/qa-2026-09-27-run5/15-total-payable-vs-transfers.png` (Payout card, "Total payable
  SEK 56,000" above transfers of 56,000 + 7,200)
- `docs/screenshots/qa-2026-09-27-run5/17-desktop-settlement-cohost-missing.png` (same at 1430 px — not
  a narrow-viewport artefact)
- `node .claude/skills/verify-e2e/api-as.mjs operator GET /events/ad9b57c1…/settlements …a1` returns
  **2** settlements and **3** transfers, one of them `→ cf76d087… (Northlight) 720000`.
- `select sum((computed->>'net')::numeric) from settlements where event_id='ad9b57c1…'` → **0**.

**Scope.** Any event with a co-host who carries a share. Reproduces on both tabs, at both viewport
widths, after a hard reload. The co-host's own screen is correct — they see their 7,200 and
`ladder: null`.

**The fix, for the report and not for me to make:** the two party totals ("Total payable", "the
entitlements below come to …") should be computed from the transfers and settlements the caller can
actually see *together*, or the sentence should say what is true — that a party's figures are withheld.

---

### QA5-2 — MAJOR — A cancelled show goes on asking people to accept the booking

**Accounts:** agent (`agent@`) in a browser, `performer.b@` at the API · **Route:** `/events`, and
`GET /api/v1/me/event-invitations`

**What I did.** Created `QA5 Cancellation Notice Probe` (20 Nov 2026) with Marlo Vance and Neon Tide on
the bill, then cancelled it with a reason. Signed into `/events` as `agent@` afterwards.

**Expected.** A cancellation is the end of the night — it takes the public page dark, it notifies
every party with the reason, and the delete ladder treats it as the step that told them. An invitation
to stand on it is an invitation to nothing.

**Actual.** The Events screen shows, pinned above the list:

> **You have an invitation**
> QA5 Cancellation Notice Probe — Fri, 20 Nov 2026 · The Lantern Hall · from The Lantern Hall
> **[Decline] [Accept]**

with no mention anywhere that the show is cancelled. The API agrees:

```
GET /me/event-invitations  (agent)      → QA5 Cancellation Notice Probe | status: invited | requestStatus: pending
GET /me/event-invitations  (performerB) → QA5 Cancellation Notice Probe | status: invited | requestStatus: pending
select title,status from events where id='66c9b2de…' → QA5 Cancellation Notice Probe | cancelled
```

**Evidence.** `docs/screenshots/qa-2026-09-27-run5/16-agent-invited-to-cancelled-show.png`, the two
API reads above, and the SQL.

**Scope.** Both non-actor parties with an open invitation. This is the same shape as run 4's QA4-16 (a
cancelled show still asking three people to agree a new date) at a second surface: **cancelling closes
nothing that is still open on the event.**

---

### QA5-3 — MAJOR (but already a *recorded open call*) — A co-host can still rename the host's show, and the whole bill is told

**Account:** coHost (`co.host@`, Northlight Presents) acting on `Marlo Vance — Album Release`, whose
`host_profile_id` is The Lantern Hall · **Route:** `PATCH /api/v1/events/:id`

```
PATCH /events/…e1 {"title":"QA5 coHost rename probe"}   as …a6  →  200
select title from events where id='…e1'                          →  QA5 coHost rename probe
```

and the rename notice then went to **all five** other parties *including the host*:
`"Marlo Vance — Album Release" was renamed — The name changed. It is now "QA5 coHost rename probe".`
(I restored the title immediately; the restore sent a second notice to everyone.)

**Expected.** `lib/event-delete.ts` states the boundary in its own words: *"A co-promoter holds
`operator_full` and therefore `event.delete`, but the show is not theirs to end."* Renaming somebody
else's show is a lesser version of the same thing, and the date move is already protected correctly
(a `PATCH` of `eventDate` becomes an `event.change_requested` — re-verified in run 4).

**Status, and why this is not filed as new.** `docs/decisions.md` **#25.6** (committed at 00:04
tonight, *during* this sweep) records *"A co-host may still CANCEL the host's show"* as a call taken
in code, not yet Ran's or Daniel's, with the recommendation **to overrule it and require the host
profile, mirroring delete.** That row covers cancel. **It does not mention rename**, which travels
through the same `PATCH` and would be closed by the same change. Filed here so the rename half is not
lost when the cancel half is decided.

---

### QA5-4 — MAJOR — "Place a hold" cannot attach a hold to a venue, so it never joins the venue's hold queue — and the dialog says so while offering no way out

**Account:** operator · **Route:** `/events` → **Place a hold**

**What I did.** Placed `QA5 Second Hold on 3 Dec` at "The Lantern Hall" on **3 Dec 2026** — the same
room, the same night as the seeded `Nordic Synth Showcase` hold.

**Expected.** Hold ranking is per venue, per date. The whole feature depends on a hold knowing which
venue it is a claim on.

**Actual.** The dialog's VENUE field is a **plain text box** — no picker, no suggestion list, no
`list`/`aria-autocomplete` attribute, and typing "Lan" produces no options. So the hold is created with
`venue_profile_id = NULL`:

```
title                    | status  | event_date | venue_profile_id | venue_name       | hold_rank
Nordic Synth Showcase    | on_hold | 2026-12-03 | …a1              | The Lantern Hall | 1
QA5 Second Hold on 3 Dec | on_hold | 2026-12-03 | (null)           | The Lantern Hall | (null)
```

The dialog **knows** and says so out loud, in step 1, under HOLD PRIORITY:

> "No hold is competing for this date yet, so this is the 1st hold.
> **One other hold on this date is attached to a venue, and queues separately.**"

…and then offers no control that would attach this one. The event workspace's Venue field *does* have
a picker (**MY PLACES**), which is the workaround run 4 found for the creation wizard (QA4-14); this is
the same gap at a second, more consequential entry point.

**The second-order fault.** Once the venue is attached by hand, the two holds **both render as "1st"**
— `hold_rank NULL` is read as rank 1 everywhere by design, so the pool shows a tie:

```
GET /events/82f53883…/hold  (operator)
  pool: [ Nordic Synth Showcase   holdRank 1 ,
          QA5 Second Hold on 3 Dec holdRank 1 (isSelf) ]
```

and the newer hold's **"Promote to 1st" button is disabled** (`canPromoteToFirst = (holdRank ?? 1) !== 1`
— `hooks/useEventHold.ts:170`), so the tie cannot be broken from the screen that shows it. The rank
route itself is fine: `POST /events/82f53883…/hold/rank {"holdRank":1}` returned 200 and pushed Nordic
Synth to rank 2.

**Evidence.** `docs/screenshots/qa-2026-09-27-run5/12-two-first-holds.png`; the SQL above; the API
reads above.

---

### QA5-5 — MINOR — The "what changed" notice never says who changed it, although the name travels all the way to the browser

**Accounts:** operator changes; performerA reads · **Route:** the bell, `/` and everywhere

**What I did.** As `operator@`, changed the capacity of `Marlo Vance — Album Release` from 400 to 420
on Event Details, with `performer.a@` signed in to a second browser with the bell panel open.

**The arriving half is excellent** and this finding is only about the last sentence of it. The
notification landed **in realtime** — the bell went 2 → 3 and the row appeared marked "just now" with
no reload — and a later multi-field patch produced exactly one notice naming all three fields and no
values:

```
"Marlo Vance — Album Release" was updated | The notes, the doors time and the capacity changed.
   metadata {"fields":["notes","doorTime","capacity"]}   → 5 recipients, actor excluded
```

**Expected.** The brief, and ClickUp `86cbcftg3`'s own line: *"the system should always notify the
users of any change — where it happened **and by who**."*

**Actual.** The bell renders the title and the body and nothing else. The actor is present at every
other layer:

```
select actor_display from notifications where type='event.updated'
  → The Lantern Hall (operator)

GET /api/v1/notifications (performerA)
  "actorDisplay": "The Lantern Hall (operator)"
```

`grep -rn actorDisplay apps/web/src` has exactly **one** hit — `EventExtraTabs.tsx:349`, the Event
History tab. `NotificationBell.tsx:141–144` prints `notification.title` and `notification.body`, and
that is all.

**Evidence.** `docs/screenshots/qa-2026-09-27-run5/07-performer-bell-updated.png` — "The capacity
changed.", no name.

---

### QA5-6 — MINOR — Auto logout signs you out without a word

**Account:** operator · **Route:** Settings → Security, then any screen

The feature itself is **built and correct** (see *What passed*). This is about the moment it fires: I
set `showme.security.lastActivityAt` three hours back with the limit at 15 minutes and reloaded, and
landed on:

> **Welcome back** — Sign in to your shoWMe account.

`hooks/useIdleLogout.ts` calls `void signOut()` with no message, and `AuthProvider` has no reason to
carry. Somebody returning to a laptop cannot tell a timeout from an expired token, a revoked session,
or a bug — and the setting they would need to change is on the other side of the sign-in they were just
asked for. One line of copy on the sign-in screen closes it.

---

### QA5-7 — MINOR — "BREAK-EVEN TICKETS 0" when the line never crosses (run 4's QA4-10, unchanged)

**Account:** operator · **Route:** `/events/$id?tab=budget`

On `Marlo Vance — Album Release`: revenue SEK 83,000, total costs SEK 84,245, and the KPI reads
**`BREAK-EVEN TICKETS 0`** directly above a chart captioned *"Revenue never passes total cost inside
420 capacity."* "0" reads as *you break even before selling a ticket*, which is the opposite.

**The arithmetic is right whenever a crossing exists** — hand-checked three times this run:

| event | terms | shown | by hand |
|---|---|---|---|
| QA5 probe, no fixed cost | 70% door vs SEK 30,000 floor, SEK 2,000 tickets, 1.5% fees | 16 | `2000n = 30000 + 30n → n = 15.2 → 16` ✓ |
| QA5 probe, + SEK 10,000 production | same | 21 | at n=21: 42,000 vs 10,000+30,000+630 = 40,630 ✓; at n=20: 40,000 vs 40,600 ✗ |
| Album Release | 100% door split | **0** | never crosses — the KPI should say so |

---

### QA5-8 — MINOR — A finalized settlement with no captured lines still asks how it wants its figures entered (run 4's QA4-12, half fixed)

**Account:** operator · **Route:** `/events/e2e…e2/settlement` → Financials

**The fixed half.** Pressing **Start from the Budget Planner** on the finalized `Spring Warmup`
settlement now raises a toast carrying the server's own sentence verbatim:

> "This settlement is finalized — its figures are locked to the snapshot. Transfers can still be marked
> paid; the figures cannot be recomputed."

Run 4's complaint was that the screen said nothing at all. It now does.

**The unfixed half.** The chooser is still offered. Its condition is *"no settlement lines captured"*,
not *"not finalized"* — `Spring Warmup` is `status = finalized` with **0** rows in `settlement_lines`,
so it asks; the QA5 probe is finalized with 1 row, so it does not and shows a `Locked` badge instead.
The status is knowable, so the finalized settlement should show the locked view either way.

---

### QA5-9 — MINOR — Clicking a workspace tab never writes `?tab=` to the URL (run 4's QA4-13, unchanged)

**Account:** all · **Route:** `/events/$eventId`

```
open /events/…e1            → /events/e2e00000-0000-4000-8000-0000000000e1
click Deals                 → /events/e2e00000-0000-4000-8000-0000000000e1
click Budget Planner        → /events/e2e00000-0000-4000-8000-0000000000e1
click Messages              → /events/e2e00000-0000-4000-8000-0000000000e1
```

Reloading while Messages is selected lands on **Event Details** (`aria-selected` on Event Details after
the reload). `history.back()` from the third tab leaves the event entirely and returns to the previous
page. The **read** path works — `?tab=budget` and `?tab=messages` typed by hand open the right panel
every time, and `?budgetScope=mine` *is* written by the scope chooser — so only the write is missing.

---

### QA5-10 — MINOR — `/audience` renders in full for the two kinds the navigation deliberately withholds it from

**Accounts:** teamAndCrew (`professional@`), agent (`agent@`) · **Route:** `/audience`

`shell/navigation.ts:138` gates Audience to `["operator", "performer"]`, with the reasoning written out
against story.md: a crew member *"has no fanbase in shoWMe"*, and for the agent *"the fanbase is the
act's, not the agency's."* Both sidebars honour it — neither kind is offered the entry.

Typing the URL renders the whole screen anyway: *"CRM · Audience · 0 contacts across ticket buyers,
newsletter and socials. No audience yet — Fans appear here once they RSVP or buy tickets."*

The app already has the right pattern for exactly this and uses it three times: `/reports`, `/projections`
and `/setlists` each answer a kind that may not have them with a boundary sentence (*"The filing belongs
to the operator"*, *"Projections belong to the venue's books"*, *"A setlist belongs to the act"*).
`routes/Audience.tsx` has no such guard. Nothing leaks today (the screen is empty for everyone —
`audience_rsvps` has no read endpoint yet), which is why this is minor rather than major.

---

### QA5-11 — MINOR — A represented act cannot see the booking request their agent sent in their name

**Accounts:** performerA (`performer.a@`), agent (`agent@`) · **Route:** `/requests` → Outgoing

The seed holds a request sent by Astra **on behalf of** Marlo Vance:

```
artist_name | wanted_date | sender_profile_id | on_behalf_of_profile_id | target_profile_id
Marlo Vance | 2026-12-09  | …a5 (Astra)       | …a2 (Marlo)             | …a1 (The Lantern Hall)
```

```
GET /booking-requests?direction=outgoing  as performerA → [("Marlo Vance","2026-11-19")]   ← only her own
GET /booking-requests?direction=outgoing  as agent      → [("Marlo Vance","2026-12-09")]
GET /booking-requests                     as performerA → []
```

Confirmed in the browser: the performer's Outgoing tab shows one card (19 Nov) and no trace of the
9 Dec pitch. `docs/decisions.md` #14 moves the *business actions* to the agent and leaves the act its
view floor; an offer made in the act's name, carrying the act's name and a fee range, is the thing a
view floor is for. Filed as minor because the act loses no authority — only sight.

---

### QA5-12 — MINOR — "Load starting point" on a schedule that already has ten rows silently makes twenty

**Account:** operator · **Route:** `/events/$id?tab=details` → Event Schedule

Loaded the saved template onto `Open Mic Wednesdays` (10 rows, correct), then pressed **Load starting
point** on the same card. Result: **20 rows**, every label duplicated, no warning and no confirmation —
`useScheduleTemplates.ts` `applyDrafts` appends unconditionally. The toast is honest ("Added 10 items
from the starting point") and the rows sort correctly by time, so this is a usability trap rather than
a data fault; removing ten rows took ten clicks.

*(This one ate a probe of mine — see §5.)*

---

### QA5-13 — MINOR — Ticket-tier fields save on blur, so the screen can show figures Postgres does not have

**Account:** operator · **Route:** `/events/$id?tab=details` → Ticket Information

Adding a tier writes an empty row immediately (`{"id":"tier-…","est":0,"max":0,"name":"","price":0}`);
each field is then persisted when it loses focus. With the cursor still in the last field the screen's
own total read **"50 max · 40 est."** while `events.extras.ticketTiers` held `est: 0`; a reload took the
screen back to zero. Blurring saved it.

The blur-save itself is a normal pattern. What makes it worth a line is that the **summary updates from
local state**, so the gap between the screen and the record is visible and reads like a saved figure.

---

### QA5-14 — MINOR — The Settlements dashboard counts one settlement twice and calls the operator's retained residual a "payout" (run 4's QA4-17, unchanged)

**Accounts:** operator, performerA · **Routes:** `/`, `/settlements`

- `OUTSTANDING SEK 44,700` and `FINALIZED SEK 20,700` — `Spring Warmup`'s 20,700 is inside both, with
  nothing saying the tiles overlap.
- The list column is **YOUR PAYOUT**; for the operator it holds `SEK 24,000` and `SEK 20,700`, which are
  the residuals they *retain* while paying 56,000 and 46,500 out.
- **"Top venues by revenue — No revenue yet. Revenue by venue appears here once your events start
  settling."** sits beside `Recent settlements: Spring Warmup · Finalized SEK 20,700`. Two finalized
  settlements now exist and the panel is still empty.

---

### QA5-15 — NOTE — Realtime: messages arrive, budgets still do not (run 4's QA4-19, re-confirmed with two live browsers)

**Accounts:** operator (seat 1) and coHost (seat 4), both with `/events/…e1?tab=budget` open.

**Messages pass.** A message posted by the operator appeared in `performer.a@`'s open Messages tab with
no reload, within ~2 s, and moved that browser's bell. Thread scoping is correct at the same time — the
performer's thread list shows `Everyone` and `Marlo Vance` only, never `Operators only`, `Neon Tide` or
`Priya Sound`.

**Budgets do not.** With the co-host watching the shared ledger, the operator changed
`Sound & production` from SEK 12,000 to SEK 22,000:

```
after 6 s   co-host screen: Sound & production 12000, TOTAL COSTS (PARTIAL) SEK 34,245
Postgres:   select amount from budget_lines where label like 'Sound%' → 2200000
after reload co-host screen: 22000, TOTAL COSTS (PARTIAL) SEK 44,245
```

This is the documented shape (`useRealtimeStream.ts` invalidates notifications, and for
`event.message_posted` the message and thread queries — nothing else) and it is the worse of the two
possible failures: **no frame is published for a budget edit at all**, so there is nothing for the
client to miss.

---

### QA5-16 — NOTE — Confirmed gaps, stated plainly

- **No booking request carries a venue.** All six seeded rows have `venue_profile_id = NULL` and
  `stage_id = NULL`, so a double-booking warning on the Requests screen remains structurally impossible
  and none is shown. Unchanged from run 4.
- **decisions #25.1's "Accept request" is still not built.** The cards offer
  *Create Draft · Make Offer · Decline · Block · Archive*.
- **`apps/marketing` is not started by `pnpm dev`.** It was already up on `localhost:5173` from an
  earlier session; a sweep on a clean machine would not reach the public pages at all. Every
  `/profile/<slug>` and `/event/<id>` link the app renders points at that port.
- **Audience has no import or export**, and no read endpoint.
- **The event-creation wizard and Place-a-hold both have plain-text venue fields** (QA4-14 / QA5-4);
  the event workspace's Venue field is the only place a `venue_profile_id` can be set.
- **Mobile could not be checked at 390 px** — see §4.

---

### QA5-17 — COSMETIC — Small things, all observed

- **`GET /favicon.ico` → 404 on every page load**, in every seat. `apps/web/public` holds only `fonts`
  and `index.html` declares no `<link rel="icon">`. This is the *only* console error any seat produced
  across the whole run.
- **"Northlight Presents's share of what the event carries"** — double possessive on the cost-split
  field's accessible label (and, in the same card, "The Lantern Hall's share", which is right).
- **"Your own line. The other parties' figures on this event aren't shared with you."** is printed at
  the foot of the **host operator's** own Payout tab, under a transfer list naming two other parties.
- **The settlement Overview's "Event details" card leaves a grey empty half-cell** where a sixth value
  would go — 5 values in a 3×2 grid. Seen at 490 px (`14-mobile-settlement.png`); the grid reflows at
  desktop width, so this may be narrow-viewport-only.
- **A `<input type="number">` keeps a typed leading zero** — filling the estimated-sales field left
  `040` on screen (parsed as 40 and stored as 40).

---

## 3. What passed — named, because it is the other half of the result

### The run-4 re-checks, one by one

| run 4 finding | verdict now |
|---|---|
| **QA4-1** delete refusal names the settlement *before* suggesting a cancellation | **FIXED.** `DELETE /events/…e2` (Spring Warmup: concluded, settled, invoiced, one other party) → `409 "…has a settlement on it, which is the financial record of the night … That cannot be thrown away. Leave the show archived."` The money clauses now run first, and `lib/event-delete.ts` says why. |
| **QA4-3** rider preview broken in local dev (two signers) | **FIXED, end to end.** `POST /files/upload-url` 201 → `PUT` 200 → `POST /profiles/:id/riders` 201 → `POST /events/:id/riders` 201 → `GET …/preview-url` 200 → **redeeming that URL returns 200 `application/pdf` with the exact bytes uploaded.** Then opened in a browser as `performer.a@`: the modal renders the PDF. `09-performer-rider-preview-real.png`. The dialog's file-size label is right too (603 B, not "1 KB" — QA4-6's blemish is gone). |
| **QA4-4** operator's document invisible to the acts | **FIXED, and scoped correctly.** Rider lists per kind: operator and coHost see all three; **performerA** sees `Tech Rider 2026` + the house document; **performerB** sees `Hospitality Notes` + the house document; **agent** sees their act's rider + the house document; **crew** sees the house document. Neither act sees the other's. Preview URLs redeem for performerA, crew and agent; `performerA → performerB's own rider` → **404 "Rider not found"**. |
| **QA4-5** co-host's planner drew a break-even it said it was leaving out | **FIXED.** The co-host's shared ledger shows `TOTAL REVENUE / TICKET REVENUE / TOTAL COSTS (PARTIAL) / TICKETS PLANNED / REVENUE PER GUEST` — no PROFIT, no MARGIN, **no BREAK-EVEN KPI and no chart** — under the sentence that promises exactly that. `11-cohost-budget-no-breakeven.png`. |
| **QA4-7** Collaborators invite skipped the agent | **FIXED, both halves.** Inviting `performer.a@` as Performer through Collaborators and accepting from the other browser produced: `Marlo Vance performer {"delegatedToAgentProfileId":"…a5"}` **and** `Astra Booking Agency agent`, plus a notification to the agency naming the act: *"Marlo Vance is on 'QA5 Collaborator Invite Probe' — You were added to the show as Marlo Vance's agent, so their deal and their settlement are yours to handle."* The `POST /events` wizard path does the same. |
| **QA4-8** share of a cancelled show read as live; share withheld the venue document | **FIXED, both.** A share of the cancelled `Winter Gala` opens with *"This show has been cancelled. The details below are what was planned — the night is not going ahead. Ask the operator if you need to know why."* (`10-share-cancelled.png`). A share of the Album Release with *Riders & documents* ticked lists `Tech Rider 2026` **and both Lantern Hall house documents** — and not Neon Tide's Hospitality Notes. |
| **QA4-9** row menu offered what the reader could not do | **FIXED.** As `performer.a@`: `Album Release → [Settlement, Archive]`, `Spring Warmup → [Unpublish, Settlement, Archive]`. No Cancel, no Delete. The difference between the two rows is correct and checkable: Marlo is **delegated** on the Album Release (`details.delegatedToAgentProfileId`) so holds no `event.publish` there, and is not delegated on Spring Warmup so holds it. Capability reads on the Album Release agree exactly: agent `publish` / no edit / no delete; crew none; performerB `publish` only; coHost publish + edit + delete. |
| **QA4-12** silent 409 on a finalized settlement | **half fixed** — see QA5-8. |
| **QA4-2** co-host may cancel the host's show | **still true**, now a recorded open call — see QA5-3. |
| **QA4-10 / QA4-13 / QA4-17 / QA4-19** | **still true** — QA5-7, QA5-9, QA5-14, QA5-15. |

### The seven things that landed since run 4

1. **The row menu and the manager's ⋮ — PASS.** Every combination checked against `events.published`
   and `events.status` in Postgres:

   | row (operator) | menu |
   |---|---|
   | Winter Gala (cancelled, unpublished) | Settlement · Archive · Delete permanently… |
   | Nordic Synth (on_hold, unpublished) | Settlement · Cancel show… · Archive |
   | Open Mic (draft, unpublished) | Settlement · Cancel show… · Archive |
   | Spring Warmup (concluded, **published**) | **Unpublish** · Settlement · Cancel show… · Archive |
   | Album Release (confirmed, published) | **Unpublish** · Settlement · Cancel show… · Archive |

   No publish entry on any show that is neither confirmed nor already published; delete only once
   cancelled or archived. The manager's ⋮ draws the same menu **plus "Share event link"** — and on an
   unpublished show that entry's hint changes to *"Copies the address the public page WILL have — it is
   not up yet."* The Event Details panel's own Publish button is correctly **disabled** on an on-hold
   show, with the reason above it.

2. **The calendar day popover — PASS.** On the hold (Nordic Synth, 3 Dec): `ON HOLD` pill, name, Date
   `Thu, 3 Dec 2026`, `Venue: The Lantern Hall · Stockholm`, `Status: On hold`, and a **HOLD SETTINGS**
   block with `Queue position #1` and `Auto-promote: On — moves up if a hold above it falls`, then
   *Open event* (`04-calendar-hold-popover.png`). On the confirmed show: `CONFIRMED` pill, name, Date,
   **`Performer: Marlo Vance + Neon Tide`**, Venue · City, Status, **Unpublish**, *Open event*. Pressing
   Unpublish from the popover really works — `events.published` went `t → f`, `activity_log` gained
   `event.unpublished` by `…a1`, five parties got `event.unpublished` notifications, and the popover's
   own button flipped to `Publish` without a reload. (Nordic Synth's popover correctly omits Performer —
   it has none — and offers no publish action.) A task chip's popover shows `TASK` + *"Calendar item —
   not linked to an event."*

3. **Auto logout — PASS.** Settings → Security shows **SIGN ME OUT WHEN IDLE / After 1 hour** with
   *"Typing, clicking and scrolling all count as activity. This is set for this device — your other
   browsers and your phone keep their own setting."* The picker offers exactly six: *After 15 minutes ·
   After 30 minutes · After 1 hour · After 4 hours · After 8 hours · Never — stay signed in.* Changing
   it writes `showme.security.idleLogoutMinutes = "15"` (and `"off"` for Never) and survives a reload,
   with `#security` restoring the tab. Forcing the idle case signed the seat out; signing back in landed
   on `/settings#security` with a fresh activity stamp — the stale-stamp trap the code's own comment
   describes does not reproduce. (Only the silence is a finding — QA5-6.)

4. **Schedule templates — PASS, in full.** "Load starting point" on the Album Release (doors 19:00,
   stage 20:00, end 23:00, curfew 23:30) added exactly ten rows, all persisted:

   ```
   Get in 14:00 · Load in 14:30 · Line Check 15:30 · Sound Check 16:00 · Dinner 17:30
   Doors Open 19:00 · Show Time 20:00 · End Time 23:00 · Curfew 23:30 · Closing time 15 Oct 01:00
   ```

   The event's own four times are used where it has them, and only `Closing time` carries the **+1 day**
   pill. On `Open Mic Wednesdays` (doors 18:00, stage 19:00, no end, no curfew) the same button produced
   `Get in 13:00 · Load in 13:30 · Line Check 14:30 …` — the ladder is relative to that event's doors,
   which is right. **Save as template** stored clock times and a day offset, not absolute datetimes:

   ```
   templates: QA5 Lantern standard run of show | schedule | profile …a1
     {"items":[{"time":"14:00","label":"Get in","category":"crew","dayOffset":0}, … ,
               {"time":"01:00","label":"Closing time","category":"crew","dayOffset":1}]}
   ```

   Loading it onto a **different** event held every clock time and re-dated the roll-over correctly:
   `2026-10-04T14:00 … 2026-10-05T01:00`, 10 rows in `schedule_items`. Removing rows works.

5. **Faces as doors — PASS.** Event Details → PERFORMERS: `Marlo Vance — public profile` →
   `http://localhost:5173/profile/e2e-marlo-vance`, `Neon Tide — public profile` →
   `/profile/e2e-neon-tide`. Team/Crew card: `Priya Sound — public profile` → `/profile/e2e-priya-sound`.
   `GET /public/profiles/e2e-priya-sound` and `…/e2e-marlo-vance` both 200 with real data, and Marlo's
   carries the published show in `upcomingShows` with Neon Tide in the lineup.

6. **What-changed notices — PASS** except for the actor's name (QA5-5). One notice per save, to everyone
   on the bill minus the actor, field **names** and never values — with the title as the single
   exception (*"It is now …"*). And **a pure cancellation produces no duplicate "updated" notice**:
   cancelling a 4-party event wrote three `event.cancelled` rows carrying the reason as the body and
   **zero** `event.updated`. *(This probe was built specifically so it could fail — the bill had three
   non-actor parties on it. See §5.)*

7. **Settlement dates link to the event manager — PASS**, on both surfaces. In the workspace:
   `25 Nov 2026 → /events/ad9b57c1…`, `aria-label="Open the event manager for 25 Nov 2026"`. On
   `/settlements`: the title links to `…/settlement` and the date to `/events/<id>`.

### The money spine, hand-checked

- **Ran's 2026-09-21 DRAFT-deal spec holds.** A guarantee-vs-door deal saved as *"Draft — not sent,
  0 of 2 signed"* put `Performer fee SEK 56,000` on the planner at once, captioned *"Read from the deal
  'QA5 Guarantee vs door · **the 70% door share beats the guarantee**' — still an offer, nobody has
  confirmed it. Nothing is stored on the budget: change the terms and this moves with it."*
- **It moves with attendance, and flips its own sentence.** Dropping the tier quantity 40 → 10 moved
  revenue 80,000 → 20,000 and the fee 56,000 → **30,000**, with the caption flipping to *"the guarantee
  beats the 70% door share."* `max(guarantee, 70% of net)`, live, from a draft.
- **Confirmation freezes the terms at the server**, not only on screen:
  `PATCH /deals/… {"guaranteeAmount":"9900000"}` → `409 "These terms are frozen — guaranteeAmount cannot
  change on a confirmed agreement. Reopen it for renegotiation first: POST /deals/…/reopen"`, with
  `confirmed_snapshot` written. The planner's caption changes to *"…the settlement takes this figure
  from the deal — change it there."*
- **The delegated act cannot sign and the agent can.** `POST /deals/…/confirm` as `performer.a@` →
  `403 "Missing capability: agreement.confirm"`, and her Deals tab shows the deal with **no** Confirm
  button and *"The other parties' lines on this deal aren't shared with you."* The same call as
  `agent@` → 200, and the event advanced `suggested → confirmed` on the second signature.
- **`extras.ticketTiers.price` is in MAJOR units and is read as such — the trap run 4 never reached.**
  A tier typed as `VIP / 2000 / 50 max / 40 est` stored `{"price":2000,"max":50,"est":40}`, seeded the
  planner as **SEK 80,000** (40 × SEK 2,000), and **"Start from the Budget Planner" imported it to the
  settlement as `VIP — 40 x SEK 2,000 = SEK 80,000`**. A SEK 2,000 ticket settles at SEK 2,000.
- **Every derived figure checked by hand, against what was on screen at the time it was read.**
  Before the production cost: total costs 57,200 = 56,000 + 1.5%×80,000 ✓; profit 22,800 ✓;
  margin 22,800/80,000 = **28.5%** ✓; revenue/guest 80,000/40 = **2,000** ✓; cost/guest 57,200/40 =
  **1,430** ✓. After adding SEK 10,000 of production: the fee re-derives off the lower adjusted net
  (70% × 70,000 = 49,000), total costs 49,000 + 10,000 + 1,200 = **60,200** ✓, profit **19,800** ✓.
  On the Album Release: margin −1,245/83,000 = **−1.5%** ✓; PRO estimate 6% × 83,000 = **4,980** ✓; the
  co-host's `TOTAL COSTS (PARTIAL) 34,245` = 12,000 + 9,000 + 8,500 + 3,500 + 1.5%×83,000 ✓.
- **`Σ net = 0` on both settlements run this sweep**, checked in SQL, including the one with a 70/30
  operator cost split and a private agent commission on it.
- **The agent's commission is private and correct.** 10% of the act's **gross** deal income
  (5,600 of 56,000) settles as a `representation_id`-scoped settlement and a single transfer
  `Marlo Vance → Astra Booking`, outside the event's `Σ net = 0`. Who sees it:

  ```
  operator   transfers [56,000 event]                        commissions []
  performerA transfers [56,000 event, 5,600 COMMISSION]      commissions [1]
  agent      transfers [5,600 COMMISSION]                    commissions [1]
  coHost     404 on the whole read (not a party to it)
  ```

  Exactly story.md: *"the operator deals with the agent as the negotiator but never sees the cut."*
- **Per-party settlement scoping.** operator → 2 rows + ladder; performerA → her own row only;
  agent → her row + its own zero row; coHost (floor permissions only) → **their own 7,200 line, their own
  transfer, and `ladder: null`.**

### Co-promotion (area 4b), driven in a browser as `coHost`

- **The scope chooser is offered** — `Shared ledger` / `My budget` — and only where there is a co-host:
  the QA5 probe grew the chooser the moment `co.host@` joined it, and had none before.
- **Two books, correctly separated in Postgres.** `budgets` for the Album Release holds one `shared`
  row and **two** `private` rows, one owned by each operator, each empty. The `operatorCostSplit` landed
  on the **shared** row only, as basis points keyed by participant id.
- **The split's arithmetic is right and `Σ net` survives it.** 70/30 of a 24,000 residual → 16,800 /
  7,200 in `settlements.computed`, a transfer for the co-host's share, and `sum(net) = 0`.
- **A split that does not add to 100 is caught and explained honestly**, not silently normalised:
  > "These add up to 150%, not 100. The shares still divide the remainder in that ratio, so the
  > settlement balances — but it is probably not what you meant."
- The co-host's view of the money is where QA5-1 lives — but the fault is on the **host's** screen, not
  theirs.

### Everything else that was walked and was correct

- **Every sidebar destination rendered with real data for all five kinds driven in a browser**, and the
  nav sets differ correctly: operator gets Performance Reports · Audience · Financial Projections and no
  Setlists; performer gets Setlists and no Reports/Projections; crew and agent get neither Setlists,
  Reports, Projections nor Audience. Visiting a withheld screen by URL gives a boundary sentence for
  `/reports`, `/projections` and `/setlists` (only `/audience` does not — QA5-10).
- **Zero console errors across the entire run except the `/favicon.ico` 404.** Zero non-2xx application
  requests in any seat — 54 XHR/fetch calls in the operator's full sidebar walk, all 200.
- **Realtime message delivery across two genuinely independent browser contexts** — no reload, ~2 s.
- **Calendar.** `?date=2026-12-03` and `?date=2026-10-14` both land on the right month with the day
  circled. Marking 10 Nov unavailable wrote `profile_unavailability(2026-11-10 → 2026-11-10)`; unmarking
  it removed the row; the day's accessible name tracks the state (`Select 2026-11-10 — unavailable`).
- **Event To Do.** Typing a task and pressing Enter created it (`tasks.event_id = …e1`), the counter went
  `1 active → 2 active`, and `performer.a@`'s `GET /tasks` stayed empty.
- **Contacts → Export CSV works** (run 4 could not read it). Captured the blob before download:
  `contacts-2026-09-27.csv`, 1,186 bytes, header
  `Name,Type,Contact person,Email,Phone,IBAN,Bank,VAT ID,Address,Notes`, five rows, correctly quoted
  addresses.
- **The invitation round trip**, in two browsers: invite → landing page naming the inviter, the event,
  the role and the addressed email → **Accept** → *"You are in — … The Lantern Hall (operator) has been
  told you accepted"* → `invitation.accepted` in the inviter's notifications.
- **The share gate.** No anonymous links; the viewer demands the address and a six-digit code; `share_otps`
  stores a salted SHA-256 with a 10-minute TTL and an attempt counter. (I recovered codes by brute-forcing
  the hash out of Postgres to finish the tests — 10⁶ candidates, ~1 s.)
- **Refresh survival.** The schedule rows, the saved template, the ticket tier, the budget line, the cost
  split, the rider, the new task and the idle-logout preference all survived a hard reload.

---

## 4. Not reached, and why

- **Mobile at ~390 px.** This browser clamps its window at **500 px** — `resize_page(390)` and even
  `resize_page(200)` both left `document.documentElement.clientWidth = 490`. Everything below is
  therefore a **490 px** observation, not a 390 px one, and I am not claiming the phone width was
  checked. At 490 px, looked at rather than measured: Events, Calendar, Settlements, Tasks, Contacts and
  the Budget Planner all fit and stack sensibly; the settlement workspace's **tab strip** is the only
  element extending past the viewport, and it is a horizontal scroller by design. Screenshots
  `13-mobile-budget.png`, `14-mobile-settlement.png`.
- **`pnpm test:e2e` and every vitest suite** — out of scope by instruction. **No baseline was taken and
  none is claimed.**
- **`pnpm jobs:run`** was not run, so nothing time-based converged: expired offers, venue handoffs, due
  representation terminations, FX refresh.
- **`performer.b@` was never given a browser seat** — only API reads.
- **Not driven at all:** the Google OAuth callback; Setlists authoring; calendar Week/Day views;
  calendar ICS import and export; Contacts **Import** CSV; Audience import/export (no controls exist);
  invoice creation; performance-report filing; profile editing and image upload; RSVP capture;
  Settings tabs other than General and Security; the Event History tab's filters; settlement **comments,
  send-for-review, approvals and the Full settlement access grant** (decisions #24); deductions with
  "Paid by"; advances rendered as "paid in advance by X to Y"; the #24 waterfall order on a settlement
  built specifically to exercise it; bonus ladders (#25.5); hold **confirm/decline** and auto-promotion
  on decline; display-currency conversion on a settled amount (run 4 covered it and it passed).
- **Contacts Import CSV** and **the settlement CSV/PDF exports** were seen as buttons and not pressed.

---

## 5. Probes that lied — and what the re-run showed

1. **"The schedule list is not sorted by time."** After the duplicate load I read
   `Get in, Load in, Get in, Line Check, …` and started writing an ordering bug. The API showed the
   second `Get in` at **14:00** and the first at **13:00**: the template's clock times and the starting
   point's doors-relative times are genuinely different times, correctly interleaved. **No finding.**
2. **"The rider preview is still broken — Failed to load PDF document."** True on screen, and entirely
   my fault: the file I uploaded was 75 bytes of hand-written non-PDF. The preview URL had already
   returned 200 with the right `content-type` and the right bytes. Re-run with a **real** 603-byte PDF:
   the page renders in the modal. The app was fine; my fixture was not. The same probe did prove the
   modal now has no *silent* failure — Chrome's own viewer reports the error, where run 4 saw an
   infinite spinner.
3. **"Marking a night unavailable saves nothing."** Clicking the day cell and "Done marking" from a
   script produced **zero** network requests and zero rows. Re-run with real CDP clicks through the
   `click` tool: one row in `profile_unavailability`, and unmarking removed it. My synthetic click never
   reached the drag-select handler. **The feature works.**
4. **"The ticket tier loses everything you type."** First run, scripted input: screen said
   "50 max · 40 est.", Postgres said all zeros, reload wiped it. Re-run with real typing: name, price and
   max persisted per field on blur; only the last field (still focused) was missing, and blurring saved
   it. Downgraded from a data-loss major to QA5-13.
5. **"Promote to 1st does nothing."** Clicking it on the tied hold changed no row. The button is
   **disabled** — `canPromoteToFirst = (holdRank ?? 1) !== 1` — because the hold already believes it is
   first. Not a broken handler; it is the tie itself that has no exit, which is what QA5-4 says.
6. **The operator cost-split probe was vacuous the first time.** I set 70/30 on the Album Release and the
   recompute changed nothing — because that event's deal takes **100%** of the adjusted net, so the
   residual the split divides is **zero**. A probe that cannot fail. Re-run on an event with a real
   residual (24,000): 16,800 / 7,200, `Σ net = 0`, and it is that re-run which surfaced **QA5-1**.
7. **`POST /settlement/compute {"seedFrom":"budget"}` on an already-seeded settlement returns 200 and
   re-seeds nothing.** I nearly read that as a silent failure. It is the documented design — the
   settlement keeps its own copy of the financials from the first run — and the Financials tab says so
   in as many words. **No finding**, recorded because the 200 is misleading on its own.
8. **My first run-through of the sidebar used `history.pushState` + a synthetic `popstate`** rather than
   clicking the nav. It renders the right route and is fine for a smoke pass, but it does **not** prove
   the nav buttons work. The nav entries were separately clicked in the operator seat; for the other four
   kinds, the *route* was walked and the *sidebar list* was read, which is what §3 claims and no more.

---

## 6. State left behind

The seed was mutated and should be reseeded before anything here is re-quoted.

- **New events:** `QA5 Cancellation Notice Probe` (cancelled, 4 parties, open invitations),
  `QA5 Collaborator Invite Probe` (confirmed, 25 Nov, co-hosted, **finalized settlement**, VIP tier,
  confirmed guarantee-vs-door deal, 70/30 cost split), `QA5 Second Hold on 3 Dec` (on hold, rank NULL,
  venue attached by hand, pushed Nordic Synth Showcase to rank 2).
- **`Marlo Vance — Album Release`:** capacity 400 → 420 → 400; doors 19:00 → 18:30; notes replaced with
  *"QA5 combined change probe"*; `Sound & production` 12,000 → 22,000; two new operator riders
  (`The Lantern Hall — House Rules (QA5)`, `Lantern Hall house rules (QA5, real PDF)`); ten schedule
  rows; an operator cost split 70/30; a **computed (open) settlement** with 6 rows; an active share link
  to `performer.a@`; unpublished and re-published once.
- **`Open Mic Wednesdays`:** ten schedule rows from the saved template.
- **`Winter Gala`:** an active share link to `performer.a@`.
- **New rows elsewhere:** one schedule template (`QA5 Lantern standard run of show`), one event task
  (`QA5 to-do probe — chase the door float`), one orphan library rider from a failed first upload
  (`fe37488c…`, no event instance), two `share_otps` consumed, ~30 notifications.
- **Notifications were NOT cleaned up** — five parties hold `event.updated` notices from probe edits, and
  three hold a cancellation whose reason names this sweep.

Nothing under `apps/`, `packages/`, `infra/`, a migration, a test or a config was edited. Nothing was
written to ClickUp. The only paths I wrote are this file and
`docs/screenshots/qa-2026-09-27-run5/`.
