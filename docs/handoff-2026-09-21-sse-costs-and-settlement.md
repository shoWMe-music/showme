# Handoff — 2026-09-21 (realtime on, costs measured, the budget→settlement link fixed)

**A handoff doc is a snapshot of a moment.** Everything below was true at the end of
2026-09-21. Check the code before you scope from it — this file has been wrong before,
and one of the corrections in it is about exactly that (see *"The load balancer was not
idle"*).

## What is live right now

| | |
|---|---|
| **API** | `showme-api-00040-8l8` |
| **SSE** | `showme-stream-00005-c9g` — **first ever deploy** of `apps/stream` |
| **Web** | `showme-app.web.app`, bundle `index-e_JH1J4i.js` |
| **Database** | 46 migrations. **None added this session.** |
| **Domain** | `api.showme.music` serves the API, and `/stream` on the same host serves SSE |

`main` is clean and fully deployed. Nothing is committed-but-unshipped.

---

## The one thing to pick up first

**Ran posted a final spec on 2026-09-21 (ClickUp `123qy9rnwud`) that is NOT built.**

He resolved the long-running "single number vs formula" question in favour of the
formula, and moved the trigger earlier:

- The performer fee is a **computed output of the deal**, never a static seeded number.
- It must appear on the Budget Planner **from the moment the operator drafts a deal —
  before any confirmation**.
- It resolves the deal formula **live** against the ticket quantity and price the
  operator enters (`max(guarantee, 70% of net)` for guarantee-vs-door, moving as
  attendance changes).
- The operator edits the **assumptions**, never the fee itself — so there is no second
  source of truth.
- On confirmation the deal terms **freeze**; the fee still tracks quantities but the
  guarantee/percentage are fixed.

Two follow-ons he attached: editing offered terms while pending should **re-seed** the
budget rather than hold a stale figure, and the confirmation freeze **must not be
silent** if the operator's projections differ materially from the locked terms.

**Where the code stands against that.** `apps/web/src/components/useBudgetSeed.ts`
→ `performerFeeOf` opens with:

```ts
if (deal.status !== "confirmed" || isRental(deal)) return null;
```

So today the fee appears only after every party has signed. That line is the change.
Pinned by `apps/web/src/components/useBudgetSeed.test.ts`, whose fixtures are all
`status: "confirmed"` — the draft case has no coverage at all, so add it rather than
assume the suite protects you.

Be careful of the reason the fee is NOT written as a budget line: the long comment at
the top of `useBudgetSeed.ts` explains that a cost line with `payee_participant_id`
lowers that party's entitlement while the deal separately entitles them — a real wrong
transfer, not a cosmetic duplicate. Ran's spec does not change that; the fee stays
rendered, never stored.

---

## What landed this session

### Ran's "you only look from the operator side" review (`86cbcehmp`, `86cbcftg3`)

Driving all four account kinds found three gaps, all fixed and deployed:

- **Only the operator could ask to move a booked night** — performer, agent and crew all
  got a flat 403. `POST /events/:id/change-request` is the mirror, gated on `event.view`
  + standing rather than `event.edit`, so an act can ask without acquiring the ability to
  rename the show.
- **A represented act's agent was never told.** The invitation went to the act; the agent
  saw nothing and, being auto-accepted, could not have answered. Now resolved through
  `liveEventDelegationsForEvents`, so a lapsed representation hands the answer back.
- **The agent stood on an event nobody had agreed to play** — inserted `accepted`
  outright. Now mirrors the act's status.

**Crew have no vote** (Ran's call, read as covering both directions): they cannot propose
a move, and they are no longer counterparts, so they cannot veto one either. A decline is
control over the date just as surely as a proposal. They still see the banner — story.md
puts `team_and_crew` at arm's length, seeing "the schedule and their own deal".

### Public availability (`86cbceux0`, third checkbox)

A venue with a confirmed show **published that night as free**. `readProfileBookedDates`
computes it — reusing `isDateTaken` and `occupiedDates` rather than restating them, so one
room sold out of three still leaves the venue bookable.

Deliberately separate from `readProfileBusyTime`: the in-app read feeds a control whose
save is a wholesale `PUT` replace, so folding derived dates in there would let the next
save materialise them as real rows.

### SSE turned on

`apps/stream` had never been deployed, and **could not have been**. Two bugs, both
reported by Cloud Run as the same generic "container failed to start and listen on the
port":

1. `DATABASE_URL: z.string().url()` rejected the production secret. Cloud SQL's socket
   form has no host (`@/showme?host=/cloudsql/...`) and `.url()` is `new URL()`
   underneath. The API has always used `min(1)` for the same secret.
2. `createPubSub` then called `postgres(url)` directly, bypassing the socket-aware
   connector `packages/db` has owned since the API first shipped. Now exported as
   `createSqlClient`.

Neither could be caught locally: `pnpm dev` and the e2e harness both pass a plain TCP URL,
so every test was green on a path production never takes.

**Cost control shipped with it.** An SSE connection is one long-lived request, so Cloud
Run bills for as long as a tab holds it open. A hidden tab now lets go after 60 seconds
and stays let go. The policy is a pure state machine in
`apps/web/src/hooks/realtimeLifecycle.ts` — extracted because this repo has no
testing-library, and "it does not reconnect while hidden" is exactly the claim a bill
disproves a month later.

### Connection pool

Production was carrying **23 connections with six accounts and no traffic**. postgres-js
defaults to `max: 10` with `idle_timeout: null` — ten per client, an idle one never
closed — and `createDatabase` passed neither. With `maxScale: 20` the ceiling was **200
against a `max_connections` of 100**: a latent outage, not untidiness.

Now `max: 4`, `idle_timeout: 30`. Measured after deploy: **23 → 4**.

### Budget Planner → Settlement (`123qy9rnwud`)

Ran: "Start from the Budget Planner" showed a success toast and imported nothing.

Two correct rules meeting badly. Ticket tiers are entered on **Event Details** and live in
`events.extras`; the planner seeds them into its form and only persists a seeded figure
once the operator **touches** it (writing untouched rows used to invent phantom lines).
`copyBudgetOnce` copies stored `budget_lines`. So a planner showing a correct SEK 400,000
door had nothing to copy.

Fixed by materialising the event's ticket tiers as budget lines when the shared budget is
empty — pressing that button *is* the acceptance the planner waits for. Budget rows rather
than settlement rows, because planned-vs-actual pairs on `origin_budget_line_id`.

---

## Corrections to things written down elsewhere

### The load balancer was NOT idle — do not delete it

`docs/deployment-status.md` listed "DNS-wire `api.showme.music` or tear it down" as
outstanding, and I repeated that as "$19.16/month for nothing, delete it". **Wrong.** The
A record resolves, the managed certificate is ACTIVE, and the domain serves the full
163-path spec. It had simply never been *used* — the web app pointed at the `run.app`
origin. Both `VITE_API_URL` and `VITE_STREAM_URL` now point at the domain.

### `timeout_sec` is inert on a serverless NEG

The API backend shows `timeoutSec: 30`, which looks like it would sever every SSE
connection after thirty seconds. It governs nothing — GCP rejects the field outright for
serverless NEGs ("Timeout sec is not supported..."). Request duration comes from the Cloud
Run service's own `--timeout 3600`. Verified by holding a connection 95 seconds through
the load balancer.

### URL map changes take ~100 seconds to propagate

After adding the `/stream` path rule, the first three checks showed the API answering
`/stream` — indistinguishable from a broken path matcher. Re-check before diagnosing.

### Distinguishing the two services needs CORS, not status codes

The API and the stream share an error shape, so a 401 on `/stream` proves nothing. The
stream answers `GET, OPTIONS`; the API answers its full method list.

---

## Traps worth keeping

- **zsh applies `:l` to `$VAR:latest`.** `"$IMAGE:latest"` expanded to
  `showme-streamatest` and the deploy failed with "image not found". Use `${IMAGE}:latest`.
- **`options.host` on a Cloud SQL socket client reads truncated** (`/cloudsql/prod-showme`)
  because an instance name is `project:region:instance` and postgres-js splits `host` on
  the colon. It is not broken — a unix socket dials `options.path`, which keeps the whole
  name and ends `/.s.PGSQL.5432`.
- **`extras.ticketTiers.price` is in MAJOR units.** Reading it as minor settles a
  SEK 2,000 ticket at SEK 20. Use `majorToMinor` from `@showme/shared`, not the hardcoded
  x100 the planner does inline — that is wrong for JPY.
- **`budgets` has no `currency` column**; `budget_lines` does. Functions taking an untyped
  Drizzle handle will not catch an invented column — only a test that inserts for real.
- **`budget_lines.amount` is a bigint column**, not a string.
- **Terraform can be planned without ADC** by passing `GOOGLE_OAUTH_ACCESS_TOKEN` to the
  Docker recipe, which sidesteps the stale-ADC problem in
  `project_terraform_prod_cert_trap`.
- **`gcloud` and `firebase` are separate credentials.** Refreshing one does not refresh the
  other, and `firebase login:list` happily shows an account whose refresh token is dead.
- The **Testcontainers port-bind flake** loses 2–4 random API test files per run on this
  machine. Always re-run the named files alone before believing a failure.

---

## Production data

**Ran's data was deleted at his request** — 39 events (plus 64 participants, 24 deals, 13
settlements, 38 budgets, 7 messages, 4 change requests cascading), 2 booking requests, 4
invitations, 43 calendar items, 4 blocked dates. **Kept:** his user, both profiles ("The
test venue", "The Test 2"), his 3 rooms, 2 contacts. `audit_log` untouched at 702 rows —
`audit_log.event_id` deliberately carries no foreign key so the trail outlives the event.

Backup of every deleted row is in the session scratchpad as `ran-cleanup-backup.json`
(201 KB). Daily automated backups and point-in-time recovery are both on.

**The first attempt rolled back**: `budget_lines.collected_by` references
`event_participants` with no cascade, and Postgres does not order two cascade paths.
Nine child tables are now deleted explicitly first (script in the scratchpad).

---

## Running costs

Measured from the live deployment at exact Stockholm list prices (pulled from the Cloud
Billing Catalog API, so the region-tier guess is gone). Full breakdown published at
<https://claude.ai/code/artifact/d1d88e01-e36a-4f64-ba71-f9b40041afa9>.

| Users | Total/mo | Per user |
|---|---|---|
| 10 | $91 | $9.12 |
| 100 | $92 | $0.92 |
| 1,000 | $159 | $0.16 |
| 10,000 | $413 | $0.04 |
| 100,000 | $3,013 | $0.03 |

**The bill is almost entirely fixed** — a floor of about **$74/month** at zero users, of
which Cloud SQL is $53.72 and the load balancer $19.16. An extra user costs between
**0.7¢ and 3.5¢** a month depending on kind.

**Actual spend could not be read from the CLI**: no BigQuery billing export, no budgets
configured. Console → Billing is the only source, and Google for Startups credits may be
absorbing all of it.

**The database can be made cheaper, conditionally.** `db-g1-small` saves $25.08/month but
allows ~50 connections; at `maxScale 20` x pool 4 = 80, so `maxScale` must come down to
about 10 first. `db-f1-micro` is ruled out by measurement — 25 connections against a
measured 23. This is a pre-revenue optimisation: correct now, wrong once there is a launch
date.

---

## Open, in rough priority order

1. **Ran's draft-deal fee spec** (`123qy9rnwud`) — see the top of this file.
2. **The act-side "ask to move" has no UI.** Only the ANSWER route is in the generated
   client, so an act can be asked and can reply but cannot start a request from the
   browser. The operator's path works only because their ordinary `PATCH` is intercepted.
   The API is deployed and correct.
3. **Only two triggers publish over SSE** — `event.participant_added` and
   `event.message_posted`. **Confirming a deal pushes nothing**, so the Budget Planner
   still will not move by itself when an agreement is signed. Needs a publisher on the
   deal routes.
4. **Ran is waiting on a plain-English summary of `86cbcehmp`** — "I can't follow all the
   comments here. Give me a new, short explanation on what works and what needs to be
   decided." That ticket has nine comments, most of them long ones of mine.
5. **W3 profile tickets** (`86cbcn1rr`, `86cbcn1q4`, `123qy9rnfz1`) — untouched.
6. **`123qy9rpchw`** "Single to Multi performer event" — urgent, unscoped.
7. **`123qy9rnfyx`** — Ran's screenshot shows `(Removed)`; needs re-uploading before it
   can be read.

## ClickUp

**Writes are OFF.** Daniel, 2026-09-21: *"Stop commenting in clickup now. No changes in
clickup."* Reading is fine. Two comments went up before that instruction (`86cbcehmp`,
`86cbceux0`); nothing since. Findings go into commit messages and reports to Daniel
instead. Ask before resuming writes.

When writes come back: **Ran is a musician, not an engineer.** Plain English, his
vocabulary (venue, room, hold, rider, settlement, deal, act, bill), no file paths, no test
counts. See the `write-to-ran-plainly` memory.
