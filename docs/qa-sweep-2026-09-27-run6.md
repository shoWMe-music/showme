# QA sweep — run 6 (driven 2026-09-28, filed under 2026-09-27's run series)

Run 5 (`docs/qa-sweep-2026-09-27-run5.md`) filed four majors and ten minors. Three fix commits
landed after it. This run re-checks all seven things named in the brief, then sweeps the app.

## 1. What was driven

**Stack under test.** The `pnpm dev` stack, already running and freshly seeded when this run
started (5 events, 6 profiles, no run-5 leftovers — verified in Postgres before the first probe).

| | |
|---|---|
| Commit at start | `967b6c8` on `main`, clean tree |
| Commit at finish | `77588ff` — one **docs-only** commit landed mid-sweep (a plan for run 5's nine minors). No application code changed, so nothing below is measured against different code than it started on. |
| API process | started **01:25:51**, after the last application commit `e4fcf19` (**01:24:43**). `967b6c8` is docs-only. **Every API answer below came from the code under test** — checked rather than assumed, because `pnpm dev` runs the API under plain `tsx` with no watch. |
| Web | Vite HMR, current |
| Postgres | `docker exec -i showme-e2e-postgres psql -U postgres -d showme` |

**Seats.** The Playwright MCP server was disconnected this session, so every browser step ran in
**Chrome DevTools MCP**, using `isolatedContext` to get genuinely separate browser profiles with
their own IndexedDB. **All six accounts got a browser seat** — six independent signed-in contexts ran
side by side and none logged another out, plus a seventh anonymous one for the public page:

| seat | account | profile |
|---|---|---|
| `seat-operator` | `operator@` | The Lantern Hall |
| `seat-agent` | `agent@` | Astra Booking Agency |
| `seat-cohost` | `co.host@` | Northlight Presents |
| `seat-performer` | `performer.a@` | Marlo Vance |
| `seat-performerB` | `performer.b@` | Neon Tide |
| `seat-crew` | `professional@` | Priya Sound |

**Screenshots:** `docs/screenshots/qa-2026-09-27-run6/`.

---

## 2. The seven checks from the brief — verdicts first

| # | Claim | Verdict |
|---|---|---|
| 1 | **QA5-5** — the bell renders `by <actor>` | **HOLDS** |
| 2 | **QA5-2a** — a cancelled show's invitation reports `cancelled`, absent from Pending, red badge + no buttons under All | **HOLDS** |
| 3 | **QA5-2b** — cancelling supersedes pending change requests; answered ones untouched | **HOLDS** |
| 4 | **QA5-1** — Total payable includes the co-host; the gap sentence names the withheld party; the caption reads "Some parties' figures…" | **HOLDS, all three** |
| 5 | **QA5-4** — a hold attached to a venue after placement joins at the back | **HOLDS** (with one leftover, `QA6-5`) |
| 6 | **QA5-4 correction** — Place a hold DOES offer a venue picker | **HOLDS** |
| 7 | run-5 minors not fixed | re-confirmed below; nothing re-filed as new |

### 1 — QA5-5, the bell says who

`coHost` patched `capacity` on `Marlo Vance — Album Release` through the API while `seat-operator`
had the bell open. Five `event.updated` rows were written with
`actor_display = 'Northlight Presents (co-promoter)'` (SQL), and the bell panel rendered:

```
"Marlo Vance — Album Release" was updated
just now
The capacity changed.
by Northlight Presents (co-promoter)
```

Evidence: `02-bell-by-actor.png`. **PASS.**

### 2 — QA5-2a, a cancelled show stops asking

Setup: `QA6 Hold via Dialog` (placed through the Place-a-hold dialog, 4 parties: host, Marlo Vance
accepted via her agent, Astra, and Neon Tide invited), then
`PATCH {"status":"cancelled","cancellationReason":"…"}`.

```
GET /me/event-invitations  agent      → status "accepted", requestStatus "cancelled"
GET /me/event-invitations  performerB → status "invited",  requestStatus "cancelled"
```

In `seat-agent`'s browser, `/requests` → **Pending**: *"No requests match this view."* → **All**:
`1 event invitation · QA6 Hold via Dialog · Cancelled · Fri, 18 Dec 2026 · The Lantern Hall`, with
**no Accept and no Decline**. The badge is red — computed style
`color rgb(238, 87, 70)`, `background rgba(238, 87, 70, 0.14)`. The pinned "You have an invitation"
card on `/events` is gone too. Evidence: `03-agent-requests-cancelled-badge.png`. **PASS.**

### 3 — QA5-2b, a cancellation closes the open question

Two change requests were built on that event on purpose, so the probe could fail: one **declined**
by the agent, one left **pending**. After the cancellation:

```
2efdaef0… | declined   | {"eventDate": "2026-12-19"}   ← untouched
e8bed01c… | superseded | {"eventDate": "2026-12-20"}   ← closed by the cancellation
```

and `GET /events/…/change-request` as the agent answers `{"request": null}`, so the Confirm/Decline
banner has nothing to draw. **PASS**, including the "leaves answered requests alone" half.

### 4 — QA5-1, the operator's payout total

Rebuilt from scratch: `QA6 Co-promotion Settlement` (25 Nov 2026), Northlight as co-host, Marlo
Vance represented by Astra, one VIP tier 40 × SEK 2,000, shared-budget
`operatorCostSplit {host: 7000, co-host: 3000}`, a confirmed guarantee-vs-door deal
(SEK 30,000 floor / 70% of the door), settlement computed from the Budget Planner and finalized —
all of it through the browser from "Start from the Budget Planner" onward.

Hand-checked arithmetic: 70% × 80,000 = 56,000 beats the 30,000 guarantee → residual
80,000 − 56,000 = **24,000** → 70/30 → **16,800 / 7,200**. Postgres agrees and `Σ net = 0` exactly.

All three of run 5's wrong statements are now right:

1. **Payout tab:** `Marlo Vance payout SEK 56,000` · `Northlight Presents payout SEK 7,200` ·
   **`Total payable SEK 63,200`** — and the operator's own Net on the same card is `−SEK 63,200`.
2. **Overview → ENTITLEMENT BY PARTY:** *"The entitlements below come to SEK 72,800, less than the
   adjusted net. **At least SEK 7,200 of it belongs to a party whose settlement is not shared with
   you; it is in Total Payouts as a transfer.** The percentages are shares of the entitlements
   shown."* No more blaming collections or deductions, and there are none here to blame.
3. **WHO OWES WHOM caption**, with two lines visible: *"Some parties' figures on this event aren't
   shared with you, so these lines don't sum to zero."*

And the conditional half is right too: on the **co-host's** own Payout tab, where exactly one line
is visible, it still reads *"Your own line. The other parties' figures on this event aren't shared
with you."* Evidence: `05-payout-total-includes-cohost.png`, the SQL above. **PASS.**

### 5 — QA5-4, a hold joining a queue takes a number

```
POST /events {venueName:"The Lantern Hall", eventDate:"2026-12-04"}   → venue_profile_id NULL
PATCH {"status":"on_hold"}                                            → hold_rank NULL   (correct: lone hold)
PATCH {"venueProfileId": <The Lantern Hall>}                          → hold_rank 2      (in Postgres)
GET /events/:id/hold → holdRank 2, pool [Nordic Synth 1, QA6 2 (isSelf)], canManageRank true
```

`canPromoteToFirst = (holdRank ?? 1) !== 1` is therefore true, so **Promote to 1st** is enabled.
**PASS.** Two leftovers are filed below as `QA6-5` (the PATCH response still echoes the old rank)
and `QA6-6` (the guard covers a NULL rank, not a duplicate one).

### 6 — QA5-4 correction, the venue picker on Place a hold

Driven with real CDP clicks. **Events → Place a hold → VENUE → type "Lan"** offers
**MY PLACES → The Lantern Hall · Stockholm**; choosing it linked the profile, replaced the field
with a chip plus an "Unlink The Lantern Hall" button, auto-filled CITY `Stockholm` and CAPACITY
`400`, revealed a **ROOM / STAGE** picker, and printed what the venue brings onto the event. With
the date set to a night already carrying three holds, HOLD PRIORITY read:

> **4th hold** — 3 holds are already competing for this date. Taking a rank pushes the ones at or
> below it down one.

Placing it wrote `hold_rank 4` against `venue_profile_id = <The Lantern Hall>`. Evidence:
`01-place-hold-venue-picker-4th.png`. **PASS — run 5's QA5-4 headline was wrong and the commit's
correction is right.**

### 7 — the run-5 minors, re-confirmed not re-filed

| run 5 | state now |
|---|---|
| **QA5-6** auto logout is silent | not re-driven this run (idle timer not forced) — no claim either way |
| **QA5-7** `BREAK-EVEN TICKETS 0` when the line never crosses | **unchanged**, and `77588ff` (landed mid-sweep) records the diagnosis: 0 is the engine's documented "no break-even", and the screen cannot tell that apart from "covered before the first ticket". See *What passed* for a break-even that IS right and hand-checked. |
| **QA5-8** finalized settlement with no lines still offers the chooser | **unchanged** |
| **QA5-9** clicking a tab never writes `?tab=` | **unchanged** and re-measured (three tab clicks wrote no history entry; **Back** left the event and returned to `/profiles`). `77588ff`, landed mid-sweep, records this as a *decision* rather than a defect — the workspace is one screen — so it is restated here as behaviour, not re-filed. |
| **QA5-10** `/audience` renders for crew and agent by URL | **unchanged** |
| **QA5-11** a represented act cannot see their agent's outgoing request | **unchanged** |
| **QA5-12** "Load starting point" duplicates a loaded schedule | not re-driven |
| **QA5-13** ticket-tier blur-save | not re-driven |
| **QA5-14** Settlements tiles double-count; "YOUR PAYOUT" names a retained residual; "Top venues by revenue" empty beside a finalized settlement | **unchanged, and now reproduced on a second account** — `co.host@`'s dashboard reads `Outstanding SEK 7,200` and `Finalized SEK 7,200` for the same one settlement, beside *"No revenue yet."* |
| **QA5-15** realtime: messages arrive, budgets do not | re-confirmed below |
| **QA5-17** `/favicon.ico` 404 | **unchanged**, still the only console error |

---

## 3. Findings

**Most severe first. The IDs are in the order they were found, so the index is the ranking.**

| severity | id | one line |
|---|---|---|
| **MAJOR** | **QA6-17** | Every invoice created in the app is stored in **EUR** on a SEK account |
| **MAJOR** | **QA6-1** | A co-promoter on default access cannot sign a deal they are a party to — and the event's settlement then cannot open |
| **MAJOR** | **QA6-3** | A realtime frame arrives and changes nothing: a crew member reads a date that already moved, under a banner asking for agreement already given |
| **MAJOR** | **QA6-2** | Capacity change → five bells. Date move → one bell, the proposer's |
| MINOR | QA6-4 | With the books opened, the entitlement gap is blamed on collections and deductions that are zero |
| MINOR | QA6-18 | The profile editor shows every social link as having no platform |
| MINOR | QA6-10 | The Events list never says what state an event is in |
| MINOR | QA6-11 | An empty private ledger asserts 328 tickets beside SEK 0, and disagrees with the shared ledger's 320 |
| MINOR | QA6-7 | A co-host added through the participants route is stranded at `invited` |
| MINOR | QA6-6 | Two holds can still hold the same rank in one queue |
| MINOR | QA6-9 | "the money **you** collected" printed under another party's card |
| MINOR | QA6-5 | The hold PATCH answers with the rank it had before |
| MINOR | QA6-12 | The Overview explains 20% of the operator's own number |
| MINOR | QA6-8 | Adding a participant answers with a nameless row |
| NOTE | QA6-19 | A fan's RSVP is written and no screen ever shows it |
| NOTE | QA6-16 | Re-confirmed from run 5, unchanged |
| COSMETIC | QA6-13, QA6-14, QA6-15, QA6-20 | API shape and copy nits |

### QA6-1 — MAJOR — A co-promoter invited the default way is a party to an agreement they cannot sign, and the settlement then refuses to open

**Accounts:** operator (`operator@`, host) and coHost (`co.host@`) · **Routes:** `POST /deals/:did/confirm`,
`POST /events/:id/settlement/compute`, `PATCH /events/:id/participants/:pid`

**Steps.**
1. As `operator`, create `QA6 Waterfall Probe` and add `co.host@` as `co_host` with **no permission
   set** — which is what the Collaborators modal's **"Standard for the role"** does, and it is the
   modal's default (`useEventCollaboratorInvite.ts`: `DEFAULT_ROLE = "co_host"`, `access = "standard"`).
2. Write the room rental between the two operators:
   `POST /events/:id/deals {type:"rental", structure:"rental", guaranteeAmount:"500000",
   parties:[{co_host, "payer"},{host, "payee"}]}` → **201**.
3. `POST /deals/:did/send` → 200. `POST /deals/:did/confirm` as `operator` → 200.
4. `POST /deals/:did/confirm` as `coHost` → **`403 {"code":"forbidden","message":"Missing capability:
   agreement.confirm"}`**
5. `POST /events/:id/settlement/compute` as `operator` → **`409 "This settlement cannot open until
   every agreement on the event is signed: \"QA6 Room rental\" (…) is waiting…"`**
6. The one in-product remedy — give them Full control — is refused:
   `PATCH /events/:id/participants/:pid {"permissionSetId":"…c1"}` →
   **`403 {"code":"entitlement_required","message":"Granting admin requires a paid plan"}`**,
   and Settings → Billing confirms the seeded operator is on **`Free_operator`**.

**Expected.** A named signatory on an agreement can sign it. `packages/auth/src/presets.ts` states
the rule for the identical case and fixed it there: *"an agreement only freezes once EVERY
non-observer party has signed, and a venue↔crew deal has exactly two … Without a way for the crew
side to sign, such a deal could be sent and could never reach `confirmed`: **a dead end**."*

**Actual.** `DEAL_SCOPED_CONFIRM_EVENT_ROLES` is `new Set(["crew", "crew_lead"])`
(`presets.ts:387`) and `OPERATOR_FLOOR` is `["event.view","schedule.view","deal.view.own",
"settlement.view.own"]` — no `agreement.confirm`. Measured capabilities for the co-host on that
event: `['deal.view.own','event.view','schedule.view','settlement.view.own']`. So a co-promoter on
Standard access is in exactly the dead end the crew fix names, and it takes the whole event's
settlement down with it.

**Evidence.** The four API calls and their bodies above; `select capabilities from permission_sets
where id='…c1'` shows `Operator — full` DOES carry `agreement.confirm`, so the boundary is precisely
"paid plan or nothing".

**Scope.** Any event where a co-host is a signatory on any deal — a room rental between two
operators is the textbook case — on any account that has not bought a plan. Recoverable only by
deleting the agreement (`DELETE /deals/:did` → 204, which is how this run got past it).

**The fix, for the report:** add `co_host` (and arguably `host`) to
`DEAL_SCOPED_CONFIRM_EVENT_ROLES`, for the same reason crew are in it. Standing behind a party line
on ONE agreement is what confers the right to sign that agreement.

---

### QA6-2 — MAJOR — Changing a show's capacity tells the whole bill; moving its date tells only the person who asked

**Accounts:** operator proposes; coHost, performerB and agent answer; crew (`professional@`) stands on it ·
**Route:** `PATCH /events/:id` → `POST /events/:id/change-request/:crid/confirm`

**Steps.** On `Marlo Vance — Album Release`: `PATCH {"eventDate":"2026-10-22"}` raised a proposal
(`required: 3`), then Northlight, Neon Tide and Astra each confirmed. The date applied:
`select event_date from events where id='…e1'` → **`2026-10-22`**, the request `confirmed`.

**Expected.** Ran on ClickUp `86cbcftg3`: *"the system should always notify the users of any change
— where it happened and by who."* A capacity change on the same event writes **five** `event.updated`
notifications (measured this run). Moving the night is the most consequential change there is, and
`lib/event-change-requests.ts` itself says the crew *"are still TOLD … their call time depends on
the night."*

**Actual.** Exactly **one** notification is written when the change lands:

```
select u.email,n.type,n.title from notifications n join users u on u.id=n.user_id
  where n.created_at > now() - interval '2 minutes'
→ operator@e2e.showme.test | event.change_confirmed | The date moved — Marlo Vance — Album Release
```

Nobody else. No `event.updated`, because the negotiated fields are stripped out of the ordinary
PATCH and applied by `answerChangeRequest` instead — and the only notifier on that path is a
function literally called **`notifyProposer`** (`event-change-requests.ts:660`), which sends to
`input.proposerProfileId` alone.

The same gap at the other end of the flow: `event.change_requested` when the proposal was **raised**
reached the agent, the co-host and performer B — and **not the crew member** and not the delegated
performer.

**The correction I owe this finding.** My first read was "nobody is told", and that is wrong — I
went looking in the Messages tab afterwards and found the announcement:

```
select sender_user_id, left(body,95) from event_messages where event_id='…e1' order by created_at
→ e2e-operator | Asked to change the date from 2026-10-15 to 2026-10-22. Waiting on the other side to confirm.
→ e2e-agent    | Confirmed the change to the date from 2026-10-15 to 2026-10-22. The event has been updated.
```

both `visibility: all`, and the **crew member does see both** in their Everyone thread (checked in
`seat-crew`). So the bill IS told — in a place they have to go and look. What is missing is the
**bell**: a posted message raises no notification (recorded as deliberate, `qa-sweep-open.md` r3:471),
and `notifyProposer` is the only notifier on the answer path. The finding is therefore the
**asymmetry**, and it survives the correction: changing the capacity moves five people's bells;
moving the night moves one — the bell of the person who already knew.

**Evidence.** The two SQL reads above; `sed -n '655,700p' apps/api/src/lib/event-change-requests.ts`.

**Scope.** Every date, venue or room move on any event at `pending`/`confirmed`/`on_hold` — i.e.
every negotiated change the mechanism exists for.

---

### QA6-3 — MAJOR — A frame arrives and changes nothing: the crew's screen shows a date that has already moved, under a banner asking for an agreement already given

**Accounts:** crew (`professional@`) watching in `seat-crew`; operator, coHost, performerB, agent acting ·
**Route:** `/events/$eventId`

This is the shape the brief asked to be distinguished from run 5's "no frame is published at all",
and it is the worse one — **the SSE frame does arrive**.

**Steps.** With the crew seat open on `Marlo Vance — Album Release` and never reloaded:

| moment | crew's screen | the server |
|---|---|---|
| proposal raised | banner *"Waiting on 3 people to answer"* | `required 3, confirmed 0` |
| co-host confirms (from `seat-cohost`) | still **"Waiting on 3"** after 10 s | `confirmed 1`; the agent seat's bell moved **12 → 13** in the same seconds |
| after a manual reload | "Waiting on **2**" | `confirmed 1` |
| performer B confirms, then the agent confirms — the change **applies** | still **"Waiting on 2 people to answer. Nothing moves until everyone agrees."** and `Date 15 Oct 2026` in the Event Information panel | `events.event_date = 2026-10-22`, request `confirmed`, `resolved_at` set |

**Expected.** `apps/web/src/hooks/useRealtimeStream.ts` invalidates the notifications query and, for
`event.message_posted`, the message and thread queries. Nothing invalidates the event or the
change-request query, so a published frame moves the bell and leaves the page asserting the
opposite of the truth.

**Actual.** Minutes after the night moved to 22 October, the crew member is looking at **15 October**
and a live call to agree a move that has already happened — and, per QA6-2, has had no notification
either.

**Evidence.** `docs/screenshots/qa-2026-09-27-run6/06-crew-stale-date-banner.png`, the table above,
and the SQL in QA6-2.

**Scope.** Every seat that is not the actor, on every event screen. Messages remain the one thing
that does update live (re-confirmed).

---

### QA6-4 — MINOR (money copy) — With the books opened, the entitlement gap is explained by collections and deductions that are zero on every row

**Account:** performerB (`performer.b@`) with **Full settlement access** granted ·
**Route:** `/events/$id/settlement` → Overview

**Steps.** On `QA6 Waterfall Probe`: gross 100,000, deductions 15,000, **venue rental 5,000 off the
top**, adjusted net 80,000. Entitlements: Neon Tide 40,000 + The Lantern Hall 25,000 + Northlight
20,000 = **85,000**. Sent for review to Neon Tide with the **Full settlement access** toggle on, so
no line is withheld from that reader.

**Expected.** The gap is `85,000 − 80,000 = 5,000`, which is **exactly** the rental settled off the
top — money that leaves net revenue before the adjusted net is struck, so it is in the entitlements
and not in the base.

**Actual.**

> "The entitlements below come to SEK 85,000, more than the adjusted net: **each line also carries
> the cash that party collected and the deductions taken off them.** The percentages are shares of
> the entitlements."

`select (computed->>'deductibles') from settlements where event_id='…'` → **`0`, `0`, `0`**. Nobody
has a deductible. This is run 5's QA5-1 complaint surviving in the other branch: the
`withheldTotalMinor > 0n` branch of `entitlementReconciliation`
(`useEventSettlement.ts:859–887`) was fixed and now names the withheld party correctly; the
fallback branch still asserts a cause the same screen's own data contradicts.

**Evidence.** The screen text above; the SQL; `apps/web/src/components/useEventSettlement.ts:886`.

**Scope.** Any settlement with an off-the-top rental where nothing is withheld from the reader —
which is precisely the case the Full-access toggle creates. **Fix:** when `ladder.offTheTop > 0`,
name it.

---

### QA6-5 — MINOR — The PATCH that puts a hold in a queue answers with the rank it had before

**Account:** operator · **Route:** `PATCH /events/:id`

`placeHoldInQueue(tx, after)` runs **after** `after` is captured and writes the rank with its own
`UPDATE`, without touching the object the route returns (`routes/events.ts:1568`,
`lib/hold-queue.ts:93`). So:

```
PATCH /events/12367dd6…  {"venueProfileId":"…a1"}   → 200, body "holdRank": null
select hold_rank from events where id='12367dd6…'   → 2
GET /events/12367dd6…/hold                          → holdRank 2
```

A client that renders the mutation response — rather than refetching — draws "1st hold" on a hold
that is second. The browser self-corrects on the next fetch, which is why this is minor and not the
defect QA5-4 was.

---

### QA6-6 — MINOR — The queue guard covers a missing rank, not a duplicate one: two holds can still both be 2nd

**Account:** operator · **Route:** `PATCH /events/:id` (moving a ranked hold to another night)

`placeHoldInQueue` short-circuits on `event.holdRank !== null`, so a hold that already has a number
carries it into whatever queue it lands in:

```
queue on 2026-12-11:  QA6 Queue B1 (NULL→1st)   QA6 Queue B2 (2)
PATCH QA6 Late Venue Hold {"eventDate":"2026-12-11"}   (it was rank 2 on 2026-12-04)

select title,hold_rank from events where event_date='2026-12-11'
→ QA6 Queue B1 | (null)        QA6 Queue B2 | 2        QA6 Late Venue Hold | 2

GET /events/…/hold  pool: [B1 1, B2 2, QA6 Late Venue Hold 2 (isSelf)]
```

Two holds reading **2nd**. Unlike run 5's tie this one is escapable — `canPromoteToFirst` is true for
both, and `POST /events/:id/hold/rank {"holdRank":1}` renumbered the queue to a clean 1 · 2 · 3 —
so it is a transient inconsistency rather than a trap. The invariant the fix restored ("at most one
NULL per queue") is not the same as "at most one hold per rank".

---

### QA6-7 — MINOR — A co-host added through the participants route is stranded at `invited` with no way to accept

**Accounts:** operator adds, coHost answers · **Routes:** `POST /events/:id/participants`,
`POST /events/:id/participation/accept`, `GET /me/event-invitations`

```
POST /events/:id/participants {"profileId":"…a6","role":"co_host"}  → 201, "status":"invited"
POST /events/:id/participation/accept   as coHost                    → 404 "Event not found"
GET  /events/:id                        as coHost                    → 404 "Event not found"
GET  /me/event-invitations              as coHost                    → []   (co_host is not in INVITABLE_ROLES)
```

`invited` grants no capabilities, the inbox deliberately excludes `co_host`
(`participants.ts`: *"The host and a co-host are running it — nobody invited them to it"*), and
`resolvePendingParticipation` filters to `INVITABLE_ROLES` — so the accept route cannot find the row
and answers 404. The co-host can neither see the event nor answer for it.

Recoverable by the host: `PATCH /events/:id/participants/:pid {"status":"accepted"}` → 200, after
which everything works. The app's own Collaborators modal uses the token-invitation path
(`POST /invitations`) and does not hit this, so the blast radius is API callers — which the
agent-native surface (decisions #16.14) is meant to be full of. **Fix:** either default a `co_host`
created through this route to `accepted`, or refuse the role here and say where it is done.

---

### QA6-8 — MINOR — Adding a participant answers with a nameless row

**Account:** operator · **Route:** `POST` and `PATCH /events/:id/participants[/:pid]`

```
POST /events/:id/participants {"profileId":"…a2","role":"performer"}
→ 201 {"profileId":"…a2", "name": null, "avatarUrl": null, "genres": [], "publicSlug": null, …}

GET /events/:id/participants
→ {"profileId":"…a2", "name":"Marlo Vance", "publicSlug":"e2e-marlo-vance", …}
```

The response schema declares the display fields and the write path never joins `profiles` to fill
them, so a screen that renders the mutation result shows a blank row until the list refetches. Same
on `PATCH`. Harmless where the client invalidates; a real blank where it does not.

---

### QA6-9 — MINOR — "Plus the money **you** collected on the night" is printed under another party's card

**Account:** performerB, reading a settlement they were granted full access to ·
**Route:** `/events/$id/settlement` → Settlement tab

On Neon Tide's screen, The Lantern Hall's card reads:

```
The Lantern Hall   Operator   SEK 25,000
  Rental of SEK 5,000, settled off the top       SEK 5,000
  What is left after every other party is paid   SEK 20,000
  Plus the money you collected on the night      SEK 100,000
```

The sentence is correct on the operator's own screen and is not person-aware, so the moment Full
settlement access (#24.2) puts another party's card in front of a reader, it tells that reader they
collected SEK 100,000 they never touched. The figures are right; the pronoun is not.

---

### QA6-10 — MINOR — The Events list never says what state an event is in, so a cancelled show is indistinguishable from a live one

**Accounts:** agent and operator · **Route:** `/events`

The list has columns `EVENT / ARTIST · VENUE · DATE · SETTLEMENT` and a status **filter** strip, but
no status on the row. As `agent@`, `QA6 Hold via Dialog` — cancelled minutes earlier, with the
cancellation reason stored — sits directly above `Marlo Vance — Album Release` in identical styling:

```
QA6 Hold via Dialog          Marlo Vance   The Lantern Hall SE   18 Dec 2026   Not started
Marlo Vance — Album Release  Marlo Vance   The Lantern Hall SE   15 Oct 2026   Not started
```

Pressing the **Cancelled** chip leaves exactly that first row, which is how the state was confirmed.
The **Board** view has columns `Pending · On hold · Confirmed · Concluded` only, so a cancelled show
vanishes from it entirely rather than being shown as cancelled.

**Evidence.** `docs/screenshots/qa-2026-09-27-run6/04-agent-events-cancelled-row.png`.
Worth reading beside the run-5 fix: the Requests inbox now carries a red **Cancelled** badge, and the
Events list — where the show itself is — carries nothing.

---

### QA6-11 — MINOR — An empty private ledger asserts a ticket count, and it disagrees with the shared one

**Account:** coHost (`co.host@`), with Full control on `Marlo Vance — Album Release` ·
**Route:** `/events/$id?tab=budget&budgetScope=mine`

| ledger | TICKETS PLANNED | TICKET REVENUE | rows in `budget_lines` |
|---|---|---|---|
| Shared | 320 | SEK 83,000 | 2 ticket rows (260 @ 250 + 60 @ 300) |
| **My budget** (private, Northlight's) | **328** | **SEK 0** | **none** |

328 is 80% of the event's 410 capacity — `SEEDED_TICKET_SHARE` in `useBudgetEditor.ts`, whose comment
says the row is *"Priced BLANK on purpose … a made-up price would put a revenue figure on the screen
that nobody chose."* The count is not blanked with it, so the private book states a head count of its
own that no line supports and that contradicts the shared ledger for the same night by 8 tickets.
Survives a hard reload. **Fix:** the draft row's quantity is as much a made-up figure as its price
would be, or the totals band should ignore an unsaved seed row.

---

### QA6-12 — MINOR — The Overview explains 20% of the operator's own number

**Account:** operator · **Route:** `/events/$id/settlement` → Overview

```
The Lantern Hall (you)   Operator
Rental of SEK 5,000, settled off the top        SEK 25,000     38.5%
```

The caption names only the rental; the 25,000 is the rental **plus** a SEK 20,000 residual. The
Settlement tab gets it right on the same data — it itemises both lines — so this is the Overview
summary picking the first reason and presenting it as the whole one.

---

### QA6-13 — COSMETIC — A caller who only wants to set the cost split must also restate the payment-processing assumption

**Route:** `PATCH /events/:id/budgets/:bid`

```
{"planningAssumptions":{"operatorCostSplit":{…}}}
→ 400 "body/planningAssumptions/paymentProcessing Required"
```

`operatorCostSplit` is `.nullish().default(null)` with a comment explaining that it is optional *"so
every caller written before this field keeps working"*; `paymentProcessing` beside it is `.nullable()`
without `.optional()`, so it is a required key. The web always sends both, so nothing is broken today.

---

### QA6-14 — COSMETIC — The event's permission-set list is seven rows, six of them called `operator_full`

`GET /events/:id/permission-sets` as operator returns `Operator — full` plus **six** rows literally
named `operator_full` — one auto-provisioned per event created this run. Nothing surfaces the list
in a picker today (the invite modal resolves one id by capability), so this is only a note about what
the route hands a future picker: internal snake_case names and one duplicate per event.

---

### QA6-15 — COSMETIC — "Send for review → One by one" offers to send the settlement to the sender

The recipient chooser lists `Northlight Presents (Co-operator)`, `Neon Tide (Performer)` and
**`The Lantern Hall (Operator)`** — the operator doing the sending, on their own settlement.

---

### QA6-16 — NOTE — Re-confirmed from run 5, unchanged, not re-filed

- **QA5-14**, now on a **second** account: `co.host@`'s dashboard shows `OUTSTANDING SEK 7,200` and
  `FINALIZED SEK 7,200` for the same single settlement, beside *"Top venues by revenue — No revenue
  yet."*
- **QA5-10**: `/audience` renders in full for `professional@` (crew) by URL, while the sidebar
  withholds it and `/reports`, `/projections`, `/setlists` all answer with a boundary sentence.
- **QA5-17**: `/favicon.ico` 404 on every page load, in every seat — still the only console error.
- **QA5-17**: the settlement Overview's "Event details" card still leaves empty grey cells at narrow
  width (`10-narrow-settlement-overview.png`).

---

### QA6-17 — MAJOR — Every invoice created in the app is denominated in EUR, on an account whose every other figure is SEK

**Account:** operator (`operator@`, base currency **SEK**) · **Route:** `/invoices` → **New invoice**

**Steps.** Opened **New invoice**, typed `QA6 Sound Rentals AB`, amount `2500`, due `2026-11-30`, and
pressed **Create invoice** without touching the CURRENCY field.

**Expected.** SEK. Settings → General reads `BASE CURRENCY SEK`; every event, deal, budget and
settlement on this account is SEK.

**Actual.**

```
select number,direction,issuer_ref,total,currency,state from invoices order by issued_at desc limit 1
→ (null) | received | QA6 Sound Rentals AB | 250000 | EUR | draft
```

A SEK 2,500 bill is stored as **€2,500**. Reopening the modal after a hard page reload shows the
CURRENCY field pre-filled **`EUR`** again, so it is not session state:

```ts
// apps/web/src/routes/Invoices.tsx:252
const [currency, setCurrency] = useState("EUR");
// …:280
currency: currency.trim().toUpperCase() || "EUR",
```

**What makes this worth a MAJOR rather than a default nobody minds.** The same file, 190 lines
above, already learned this exact lesson and wrote it down:

> `// apps/web/src/routes/Invoices.tsx:64`
> **NO INVOICES MEANS NO CURRENCY TO NAME — not EUR.** The fallback was `"EUR"`, so a performer whose
> events, deals and settlements are all SEK opened this screen and read `OUTSTANDING (PAYABLE) €0 …`
> while their own Settlements screen read SEK throughout (measured 2026-09-26). *Zero in the wrong
> currency is a statement about their money that happens to be false.*

The KPI tiles were fixed; the **create form twenty lines away still hard-codes EUR twice** — and
unlike the tiles, this one does not merely display the wrong symbol, it **stores** it.

**Evidence.** The SQL above; the two source lines; a reopened modal after a full reload showing
`{"ph":"", "val":"EUR"}` for the currency input.

**Scope.** Every invoice created through the UI by any account. **Fix:** default to the owning
profile's / account's base currency, and refuse rather than fall back when there is none.

---

### QA6-18 — MINOR — The profile editor shows every social link as having no platform

**Account:** performerA (`performer.a@`) · **Route:** `/profiles` → Edit

Marlo Vance's three seeded links render with their URLs and with **PLATFORM = "Choose…"** on all
three, every option `aria-selected="false"`:

```
select platform,url from profile_social_links where profile_id='…a2'
→ spotify | https://open.spotify.com/artist/…      ← the row exists and is correct
→ bandcamp | https://bandcamp.com
→ instagram | https://www.instagram.com
```

**Cause, exactly.** `ProfileLinkListField.tsx:8` says *"A list, not an enum: **the value stored is the
label**"* and builds options as `{value: "Spotify", label: "Spotify"}`. The database holds
`"spotify"`. `"spotify" !== "Spotify"`, so the Select falls through to its placeholder.

**What it is NOT.** I expected data loss and checked for it: pressing **Save changes** with the
platforms reading "Choose…" left all three rows intact, and editing a link's URL and saving kept
`spotify` on it. So the platform survives; only the screen denies it exists.

**Scope.** Every profile whose links were not typed in this exact editor — the whole seed, and
anything the API writes. The reader cannot tell what platform a link is filed under, and picking one
to be sure rewrites the stored value into title case.

---

### QA6-19 — NOTE — A fan's RSVP is written, and no screen in the product ever shows it

**Steps.** RSVP'd on the real public page as a stranger (`http://localhost:5173/event/…e1`, name
`QA6 Fan`, `qa6.fan@example.test`, Göteborg). The row lands:

```
select * from audience_rsvps
→ … | e2e00000-…-e1 | QA6 Fan | qa6.fan@example.test | Göteborg | 2026-09-28 00:15:35
```

The operator's `/audience` then reads, unchanged: **"0 contacts across ticket buyers, newsletter and
socials. No audience yet — Fans appear here once they RSVP or buy tickets."**

`audience_rsvps` is written by exactly one route (`routes/public.ts:645`) and read by **nothing but
tests** — `grep -rn audienceRsvps apps/api/src` returns that one insert and four test reads.
`routes/Audience.tsx:22` says so in its own comment.

This is the "built mechanism with no caller" shape, inverted: the caller exists and the reader does
not. It is filed as a NOTE because the gap is known and documented — but the public page tells the
**fan**: *"Your name, email and city go to the organiser of this event so they can count on you and
tell you about it."* That sentence is made to a third party and is not currently true.

---

### QA6-20 — COSMETIC — Three identical participant fetches per settlement page load

One load of `/events/$id/settlement` issues `GET /events/:id/participants` **three** times
(reqid 12060, 12067, 12069) and `GET /events/:id/settlement/lines` twice — three hooks each asking
for the same list. All 200, all cached afterwards; recorded because it is the kind of thing that
stops being free on Cloud Run.


---

## 4. What passed — named, because it is the other half of the result

### The money spine, hand-checked twice on two purpose-built events

**`QA6 Co-promotion Settlement`** — 40 × SEK 2,000, 70% door vs SEK 30,000, 70/30 operator split:

| | on screen | by hand |
|---|---|---|
| Ticket revenue | SEK 80,000 | 40 × 2,000 ✓ |
| Total costs | SEK 57,200 | 56,000 fee + 1.5% × 80,000 ✓ |
| Profit / margin | SEK 22,800 / 28.5% | ✓ / 22,800 ÷ 80,000 ✓ |
| Break-even tickets | **16** | fee is the 30,000 guarantee below n≈21.4, so `1970n = 30,000 → n = 15.23 → 16` ✓ |
| Performer fee | SEK 56,000 | `max(30,000, 0.7 × 80,000)` ✓ |
| Residual 70/30 | 16,800 / 7,200 | (80,000 − 56,000) × 0.7 and × 0.3 ✓ |
| Agent commission | SEK 5,600 | 10% of the act's gross ✓, on its own `representation_id` transfer |
| Σ net | **0** | SQL ✓ |

**`QA6 Waterfall Probe`** — built specifically to exercise **decisions #24.1**, with a rental, a
deduction and an advance:

```
Gross revenue        SEK 100,000      (100 × SEK 1,000)
Deductions         − SEK  15,000      (a Production cost the event carries)
Net revenue          SEK  85,000
Venue rental       − SEK   5,000      paid off the top
Adjusted net         SEK  80,000      ← what percentages divide
```

is exactly what the screen prints, in that order, with those labels. Every derived figure checked:

- Neon Tide 50% **of the adjusted net** = SEK 40,000 — *not* 50% of the 100,000 box office. The
  Deal-structure tab prints the box-office reading too, as an illustration, and resolves the design's
  own contradiction in words: *"These are shares of ticket revenue only. Once deductions and any
  rental are applied, the adjusted net is SEK 80,000 — and that is what the settlement actually
  divides."*
- The operator: rental 5,000 + residual 20,000 = **25,000**; co-host residual **20,000** (no
  `operatorCostSplit`, so an even split of the 40,000 remainder).
- `held` 75,000 = collected 100,000 − the 15,000 cost they paid − the 10,000 advance; net
  25,000 − 75,000 = **−50,000**. **Σ net = 0** in SQL.
- **The advance renders exactly as required, both ways**: `Paid in advance to Neon Tide −SEK 10,000`
  on the operator's line and `Paid in advance by The Lantern Hall SEK 10,000` on Neon Tide's
  (`09-advance-paid-in-advance-by.png`).

**Ticket tiers are in major units and stay there.** `{"price":2000,…,"est":40}` seeded the planner as
SEK 80,000 and imported to the settlement as `VIP — 40 x SEK 2,000 = SEK 80,000`.

**Display currency is cosmetic and marked.** Previewing the finalized settlement in EUR converted
every figure with a visible `≈` (`≈ €2,589`, `≈ €8,630`, …), internally consistent at 0.0863, and
left Postgres untouched: `settlement_transfers` still `3000000 SEK / 2000000 SEK`, `computed.net`
unchanged, status `finalized`.

### decisions #24.2 — Full settlement access, per party, and its limits

- **Default off.** The send-for-review modal's switch reads `aria-checked="false"` on open.
- **Per party.** Sent to Neon Tide alone with the switch on:
  `select name,status,full_access from settlements …` → `Neon Tide | pending_review | t`,
  `Northlight Presents | open | f`, `The Lantern Hall | open | f`.
- **Audited, both sides.** `audit_log` holds
  `settlement.pending_review | settlement.edit | {"after":{"status":"pending_review","fullAccess":true},"before":{"status":"open","fullAccess":false}}`.
- **It reaches the waterfall and stops there.** Neon Tide's Overview then lists all three parties —
  and `GET /events/:id/budgets` as Neon Tide is still **403 "Missing capability: budget.view"**, and
  their Deals list is still `{deals:[…own…], hiddenCount: 1}`.
- **Approvals work.** Neon Tide's **Approve** wrote
  `settlement_approvals (party_participant_id, approved=t, approved_at)` and the operator's panel
  moved `0/3` → `1/3` with that row reading **Signed off**.

### Booking

- **Double-booking warnings are built and room-aware.** New event at The Lantern Hall on
  2026-10-22 with **The whole venue**: *"Already on this night: 'Marlo Vance — Album Release' in Main
  Room. **This room is still free.**"* Switch the room to **Main Room** and it becomes *"Main Room
  already has 'Marlo Vance — Album Release' on this night. You can book it anyway."*
  (`07-double-booking-warning.png`.) It also picked up the event's **new** date, so it reads the
  applied change rather than a cache.
- **Availability sharing excludes a sold night — per room, correctly.** With `Booked dates` ticked
  and **Main Room** selected, `Thu, 22 Oct 2026` is absent from the list; with **All rooms** it is
  present, which is right (Back Room is free that night, and `Open Mic Wednesdays` on 5 Oct is in the
  Back Room, so Main Room's list correctly still offers 5 Oct).
- **Auto-promotion on release.** With `holdAutoPromote: true` on the 3rd hold and the 1st and 2nd
  released, `POST /events/:id/hold/release` answered `{"promoted":[{"holdRank":1}]}` and the row moved
  3 → **1**.
- **Confirm/decline belongs to the act.** `POST /events/:id/hold/decline` as the operator →
  **403 "Only the booked performer, or their agent, can confirm or decline this hold"**.
- **The venue picker's copy-forward.** Linking The Lantern Hall auto-filled city and capacity and
  listed what it brings ("PA System, Sound Engineer, … curfew 02:00 …"), with *"They are copied once,
  and yours to edit or remove afterwards."*

### Permissions and boundaries

- **Crew have no vote and still see the banner** — exactly the rule. With a proposal open, the crew
  seat drew *"A change to this booking is waiting on an answer · Date 15 Oct 2026 → 22 Oct 2026 ·
  Waiting on 3 people to answer"* and **no Confirm/Decline**; the agent and performer B both had both
  buttons.
- **A delegated act does not answer for herself.** `performer.a@`'s screen drew the same banner with
  no buttons; `counterparts()` excluded her participation, so `required` was **3**, not 4.
- **Crew money boundary.** Deals tab: *"Not your deal to see — This event has a deal, and you are not
  a party to it."* Team/Crew tab lists **only Priya Sound**. The poster card's Replace/Remove are
  rendered `disabled` under *"Only the profile operating this show can change its poster."*
- **Setlist scoping.** `GET /events/:id/setlists` → operator **and co-host** see Marlo's 5 songs (they
  file the performance report); **performerB, crew and agent all get `[]`**.
- **Message thread scoping.** The crew's thread list is `Everyone` + `Priya Sound` only — never
  `Operators only`, `Neon Tide` or `Marlo Vance`. The operator's list carries all five.
- **Nav sets per kind.** operator: + Performance Reports, Audience, Financial Projections, no
  Setlists. performer (both): + Setlists, Audience, no Reports/Projections. crew and agent: none of
  the four. `/reports`, `/projections` and `/setlists` all answer a kind that may not have them with a
  boundary sentence.

### Realtime — the half that works

A message posted by the operator appeared in the **crew's** open Messages tab in a separate browser
context within 4 s, no reload. Thread scoping held at the same time.

### Things reached for the first time this run

- **ICS export.** Real button, real download: `showme-calendar-2026-10-01-to-2026-10-31.ics`, valid
  RFC 5545 with CRLF and folded `DESCRIPTION`, scoped to the month on screen, and — checked per
  entry — `Marlo Vance — Album Release` on **20261022** as `STATUS:CONFIRMED`, the draft
  `Open Mic Wednesdays` as `STATUS:TENTATIVE`, timed appointments with real `DTSTART/DTEND`, tasks as
  whole-day entries. Exporting an empty month takes the "nothing to export" path instead.
- **Contacts Import CSV**, end to end. Preview reported `1 to import · 1 duplicate · 0 rejected` and
  named the reason (*"Same email as row 1 of this file."*); importing wrote one row with the persons
  array and the address parsed out of a quoted CSV field, and the card shows *"IBAN on file ·
  unverified"*. The modal says the rule before you commit: *"A row whose email is already in your
  contacts is skipped, never merged."*
- **Setlist authoring.** Added `QA6 Encore` at `4:20`; stored as `{"title":"QA6 Encore","duration":260}`;
  the header went `4 songs · 16:19` → `5 songs · 20:39` (= 1,239 s, hand-checked) and survived Save.
- **Performance Reports** then read it live: `Works 5 · Runtime 21 min`, every song listed with its
  length, under an honest **"Filing — coming soon"**.
- **Public event page.** `http://localhost:5173/event/…e1` renders the show with the **moved** date
  (`Thursday, 22 October 2026`), and an RSVP from a stranger wrote `audience_rsvps` (see QA6-19 for
  where it then goes).
- **Calendar Week and Day views** both render with real entries; `Mark Unavailable` is correctly
  disabled in Day view with the reason on the button (*"Switch to Month or Week to mark dates on the
  grid"*).
- **Invoice `New invoice` → `Create invoice`** works (the defect is only the currency — QA6-17).

### Console and network

**Zero console errors and zero non-2xx application responses** across the whole run, in every seat,
apart from the known `/favicon.ico` 404. The operator's settlement page load was 51 requests, all 200.

---

## 5. Not reached, and why

- **Mobile at ~390 px.** This browser clamps at **500 px** again: `resize_page(390, 844)` left
  `document.documentElement.clientWidth = 490`. Everything narrow below is a **490 px** observation
  and I am not claiming the phone width was checked. At 490 px on the settlement workspace, measured
  rather than eyeballed: exactly **two** elements extend past the viewport, both of them the tab
  strip's own scroller (`Collaborators` at 553 px, `Payout` at 620 px), which is horizontal-scroll by
  design. The page heading measured `right: 481` of 500 — it *looks* clipped in a full-page capture
  and is not. The "Event details" card's empty grey cells are real
  (`10-narrow-settlement-overview.png`).
- **`pnpm test:e2e` and every vitest suite** — out of scope by instruction (running it tears the stack
  down). **No baseline taken, none claimed.**
- **`pnpm jobs:run`** not run: expired offers, venue handoffs, due representation terminations and FX
  refresh did not converge.
- **Locked FX across currencies.** `lockedRates.rates` on the finalized snapshot is `{}` — which is
  **correct** here and not a finding (see §6). Proving the lock needs a multi-currency deal, which
  this run did not build; an earlier run covered it.
- **Not driven at all:** the Google OAuth callback; the share viewer and share links (run 5 covered
  them); rider upload and preview (run 5 covered them, end to end); Audience import/export (no
  controls exist); Tasks assignment, reminders and the calendar grid's task chips; Projections;
  invoice detail/PDF and marking an invoice paid; profile image upload; Settings → Notifications
  toggles actually suppressing a notice; Settings → VAT; ICS **import**; the Board view's drag; the
  event Documents/rider tab this run; settlement **comments** and **Flag a dispute**; curation
  (`settlement_lines.visible_to`) actually being toggled; bonus ladders and escalator tiers
  (decisions #25.5); `Add revision`.
- **`performer.b@` got a browser seat this run** (run 5's gap), and so did `professional@`. All six
  accounts were driven in a browser.

---

## 6. Probes that lied — and what the re-run showed

1. **"Moving the date tells nobody."** Filed as such, then found the announcement in the Messages
   tab: both the proposal and the completing confirmation post to the **Everyone** thread and the
   crew member sees both. QA6-2 is rewritten around what is actually missing — the **bell** — and
   says so in the finding itself.
2. **"The co-host's Production-costs-split card is empty — a card promising a control and offering
   none."** I scanned it for `input` elements, found none, and started writing. It has a
   `role="switch"` toggle my selector missed, and the card is simply **off** because that event has no
   `operatorCostSplit` stored. Correct behaviour. **No finding.**
3. **"The finalized snapshot claims locked FX and holds none."** `lockedRates.rates` is `{}` beside
   `source: "exchangerate-api"`. It is right: `loadRatesToBase` is asked only for the currencies the
   deals and lines actually use, and every one of them was SEK. **No finding** — but the empty map
   next to a named source reads alarmingly on its own.
4. **"The profile editor loses a link's platform on save."** It shows "Choose…" for all three, so I
   expected data loss and went looking for it: saving with the placeholders showing left all three
   `profile_social_links` rows intact, and editing a URL and saving kept `spotify` on it. Downgraded
   to a display defect with the exact cause (title-case options vs lower-case stored values) —
   QA6-18.
5. **"The settlement page heading is clipped at narrow width."** It looks clipped in the full-page
   screenshot. Measured: `getBoundingClientRect().right = 481` inside a 500 px viewport, and the only
   two overhanging elements on the page are the tab scroller's last two tabs. **No finding.**
6. **"Auto-promotion does not fire."** `POST …/hold/auto-promote {"autoPromote":true}` → **400
   `body/holdAutoPromote Required`** — my key, not their bug — so the flag was never set and the
   later release correctly promoted nobody (`"promoted": []`). Re-run with `holdAutoPromote`: the
   3rd hold moved to 1st. **The feature works.**
7. **"Export ICS does nothing."** Two clicks produced no blob, no anchor and no request. The month on
   screen was **September 2026**, which has no entries, so the handler takes the
   `toast.info("Nothing to export — …")` path. Advanced to October and it downloaded a valid file.
   **No finding**, but worth knowing that the empty case is silent unless you catch the toast.
8. **`fill` on an `<input type="date">` does not reach React.** The MCP tool set `el.value` and the
   form's Continue button stayed disabled with HOLD PRIORITY still reading *"Pick a date"*. A native
   value-setter plus a bubbling `input` event did register. A tool limitation, not an app defect —
   recorded because a date typed this way looks like a form that ignores input.

---

## 7. State left behind

The seed is mutated. **Reseed before re-quoting anything here.**

- **New events:** `QA6 Co-promotion Settlement` (25 Nov, co-hosted, 70/30 split, confirmed
  guarantee-vs-door, **finalized settlement**, agent commission), `QA6 Waterfall Probe` (5 Nov,
  co-hosted, rental + advance + production cost, **finalized settlement**, Neon Tide granted
  `full_access`, one approval recorded), `QA6 Hold via Dialog` (**cancelled**, 4 parties, one declined
  and one superseded change request), `QA6 Queue B1` (on hold, rank 1 on 11 Dec, auto-promote on),
  `QA6 Queue B2` and `QA6 Late Venue Hold` (both **cancelled**, ranks 2 and 1 left on the row).
- **`Marlo Vance — Album Release`:** capacity 400 → **410**; date **15 Oct → 22 Oct** via a confirmed
  change request (so the public page, the ICS export and every report now say 22 Oct); one operator
  message in the Everyone thread; two system messages from the change request; Marlo's setlist has a
  5th song (`QA6 Encore`).
- **`Nordic Synth Showcase`:** untouched, still rank 1 on 4 Dec.
- **Rows elsewhere:** one contact (`QA6 Import Venue`), one **EUR** draft invoice
  (`QA6 Sound Rentals AB`, SEK 2,500 stored as €2,500 — QA6-17's evidence), one `audience_rsvps` row
  (`QA6 Fan`), Marlo's tagline now ends `(QA6)` and her Spotify URL is
  `https://open.spotify.com/artist/QA6PROBE`, ~25 notifications, 6 auto-provisioned `operator_full`
  permission sets.
- **Not cleaned up:** notifications, the cancelled probe events, the finalized settlements (which
  cannot be un-finalized by design).

Nothing under `apps/`, `packages/`, `infra/`, a migration, a test or a config was edited. Nothing was
written to ClickUp. The only paths written are this file and
`docs/screenshots/qa-2026-09-27-run6/`.
