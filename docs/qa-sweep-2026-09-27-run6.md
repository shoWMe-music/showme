# QA sweep — run 6 (driven 2026-09-28, filed under 2026-09-27's run series)

Run 5 (`docs/qa-sweep-2026-09-27-run5.md`) filed four majors and ten minors. Three fix commits
landed after it. This run re-checks all seven things named in the brief, then sweeps the app.

## 1. What was driven

**Stack under test.** The `pnpm dev` stack, already running and freshly seeded when this run
started (5 events, 6 profiles, no run-5 leftovers — verified in Postgres before the first probe).

| | |
|---|---|
| Commit at start and finish | `967b6c8` on `main`, clean tree |
| API process | started **01:25:51**, after the last application commit `e4fcf19` (**01:24:43**). `967b6c8` is docs-only. **Every API answer below came from the code under test** — checked rather than assumed, because `pnpm dev` runs the API under plain `tsx` with no watch. |
| Web | Vite HMR, current |
| Postgres | `docker exec -i showme-e2e-postgres psql -U postgres -d showme` |

**Seats.** The Playwright MCP server was disconnected this session, so every browser step ran in
**Chrome DevTools MCP**, using `isolatedContext` to get genuinely separate browser profiles with
their own IndexedDB. Four independent signed-in seats ran side by side and none logged another out:

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
| **QA5-7** `BREAK-EVEN TICKETS 0` when the line never crosses | **unchanged** — see *What passed* for the three break-evens that ARE right |
| **QA5-8** finalized settlement with no lines still offers the chooser | **unchanged** |
| **QA5-9** clicking a tab never writes `?tab=` | **unchanged** — re-measured, see `QA6-9` for the new half |
| **QA5-10** `/audience` renders for crew and agent by URL | **unchanged** |
| **QA5-11** a represented act cannot see their agent's outgoing request | **unchanged** |
| **QA5-12** "Load starting point" duplicates a loaded schedule | not re-driven |
| **QA5-13** ticket-tier blur-save | not re-driven |
| **QA5-14** Settlements tiles double-count; "YOUR PAYOUT" names a retained residual; "Top venues by revenue" empty beside a finalized settlement | **unchanged, and now reproduced on a second account** — `co.host@`'s dashboard reads `Outstanding SEK 7,200` and `Finalized SEK 7,200` for the same one settlement, beside *"No revenue yet."* |
| **QA5-15** realtime: messages arrive, budgets do not | re-confirmed below |
| **QA5-17** `/favicon.ico` 404 | **unchanged**, still the only console error |
