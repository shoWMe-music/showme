# QA sweep — run 7 (2026-09-28)

**Commit under test:** `fbfdc92` · branch `main`. The running stack was started from that commit and
the API does not hot-reload, so `fbfdc92` is what every finding below was measured against. `main`
moved to `d3dcb60` during the run; `git diff --name-only fbfdc92 d3dcb60` is **docs-only**
(`docs/*` plus `CLAUDE.md`), so nothing under test changed underneath it.
**Stack:** the `pnpm dev` stack left running and freshly seeded — web `:5180`, API `:8080`, stream `:8081`,
marketing `:5173`, auth emulator `:9099`, Postgres `:55432`.
**Screenshots:** `docs/screenshots/qa-2026-09-28-run7/`.

## 1. What was driven

**Six genuinely independent browser seats**, not tabs. The Playwright MCP server is down, so every browser
step used **chrome-devtools MCP**; separate seats were obtained with `new_page`'s `isolatedContext`, which
gives each account its own profile and its own IndexedDB. Verified working: signing `professional@` into
one context did not disturb the `operator@` session in another, and both reacted to live SSE independently.

| Seat | Account | Context |
|---|---|---|
| 46 | `operator@` — The Lantern Hall | default |
| 47 | `professional@` — Priya Sound (crew) | `crewseat` |
| 49 | `performer.a@` — Marlo Vance | `perfA` |
| 50 | `co.host@` — Northlight Presents | `idletest` (also used for `performer.b@` in the idle-logout probe) |
| 51 | `agent@` — Astra Booking Agency | `agentseat` |
| 48 | — | marketing site, unauthenticated |

API probes used `node .claude/skills/verify-e2e/api-as.mjs`; every figure quoted was read back out of
Postgres through `docker exec -i showme-e2e-postgres psql`.


## 2. The twenty items from runs 5 and 6 — all twenty hold

Every one was re-driven on the running stack. **20/20 hold.** Detail where the evidence is
non-obvious; the rest were exactly as specified.

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | QA6-17 invoice currency | **HOLDS** | CURRENCY pre-filled `SEK`; typing `XYZ` disabled **Create invoice** and printed *"XYZ isn't a currency we know."*; the created bill is `currency=SEK, total=123400` in `invoices` |
| 2 | QA6-2 date move rings the whole bill | **HOLDS** | Exactly four `event.updated` rows (`e2e-co-host`, `e2e-performer-a`, `e2e-performer-b`, `e2e-professional`), the proposer's `event.change_confirmed`, and **none** for `e2e-agent`, who confirmed last |
| 3 | QA6-1 co-host on Standard access signs a rental | **HOLDS** | `POST /deals/68296009…/confirm` as `coHost` → **200**; `deal_parties.confirmed_at` set for both; `POST /events/…/settlement/compute` → **200** (was 409) |
| 4 | QA6-7 co-host is `accepted` at once | **HOLDS** | `POST /participants {role:"co_host"}` → `"status":"accepted"`, and `GET /events/:id` as `coHost` → 200 immediately. `performer` and `crew` still answer `"invited"` |
| 5 | QA6-3 confirmed change clears the crew banner live | **HOLDS** | Two independent browsers. Crew seat held the banner *"Date 22 Oct 2026 → 29 Oct 2026 · Waiting on 3 people"*; three API confirms later, **without a reload**, the banner was gone and the header read `29 Oct 2026`; bell 2 → 3 |
| 6 | QA6-8 participant writes answer with a name | **HOLDS** | POST and PATCH both return `name`/`publicSlug`/`genres`/`avatarUrl`; checked against a profile that has all four (Marlo Vance) and ones that legitimately have none |
| 7 | QA6-18 social platforms render | **HOLDS** | The three platform selects read `["Spotify","Bandcamp","Instagram"]`; `localhost:5173/profile/e2e-marlo-vance` prints the same three capitalised |
| 8 | QA6-10 cancelled badge | **HOLDS** | Red **Cancelled** pill on the Winter Gala row — `events-list-operator.png`. (Deliberately the only badged state; `Events.tsx` says why.) |
| 9 | QA6-11 private ledger ticket count | **HOLDS** | `?budgetScope=mine` read *"0 tickets planned across all types"* against `SEK 0`. (But see **QA7-3** — the same card has a different defect.) |
| 10 | QA6-15 recipient chooser | **HOLDS** | *One by one* offers `["Northlight Presents (Co-operator)","Neon Tide","Priya Sound","Astra Booking Agency","Marlo Vance"]` — the reader (The Lantern Hall) absent, the co-operator present |
| 11 | QA6-13 cost-split-only PATCH | **HOLDS** | `PATCH /events/:id/budgets/:bid {planningAssumptions:{operatorCostSplit:{…}}}` → **200** |
| 12 | QA6-9 / QA6-12 on the performer's screen | **HOLDS** | Full access granted to Marlo on a settlement with a SEK 5,000 off-the-top rental. Performer's Settlement tab: *"Plus the money **The Lantern Hall** collected on the night"*. Overview: *"Rental of SEK 5,000, settled off the top — **and 2 more, itemised on the Settlement tab**"* |
| 13 | QA5-7 No break-even | **HOLDS** | KPI reads **No break-even** beside the chart caption *"Revenue never passes total cost inside 400 capacity."* |
| 14 | QA5-9 `?tab=` | **HOLDS** | Four tab clicks wrote `?tab=deals/messages/collaborators/todo`; `history.length` stayed **11** throughout; reload kept To Do selected; Back left the event to `/events` |
| 15 | QA5-6 idle sign-out note | **HOLDS** | *"You were signed out after 15 minutes without activity…"* on the first load, absent on the second |
| 16 | QA5-10 audience boundary | **HOLDS** | Both `professional@` and `agent@` get *"An audience belongs to the room and to the act …"*, not the CRM |
| 17 | QA5-8 finalized settlement | **HOLDS** | Financials tab on the finalized Spring Warmup contains no *"Start from the Budget Planner"* |
| 18 | QA5-12 schedule starting point | **HOLDS** | Second load raised *"This schedule already has items … Cancel / Add to them / Replace them"*; **Replace** left `select count(*) from schedule_items` = **10** |
| 19 | QA5-13 unsaved ticket-tier hint | **HOLDS** | *"unsaved — click outside the field to save"* beside `50 max · 40 est.` while focused, gone on blur, and `events.extras.ticketTiers` then holds the row |
| 20 | QA5-14 settlements wording | **HOLDS** | `/settlements` column header **YOUR SHARE** plus *"These count the same money four ways rather than splitting it…"*; `/` shows *"Not built yet"* under **Top venues by revenue** |


## 3. Findings

Counts: **6 MAJOR · 13 MINOR · 4 NOTE · 4 COSMETIC.** No blocker — every journey completed.

| Severity | ID | One line |
|---|---|---|
| MAJOR | QA7-1 | The break-even KPI, chart and caption solve a different deal from the one the same card is showing — 200 tickets stated, 109 true |
| MAJOR | QA7-2 | A ticket tier typed on Event Details raises the planner's revenue but not the fee it derives: planner quoted SEK 50,000, settlement paid SEK 60,000 |
| MAJOR | QA7-3 | A private ledger with no rows of its own reports SEK 10,000 revenue, SEK 60,150 costs and a −SEK 50,150 loss, all borrowed from the shared book |
| MAJOR | QA7-4 | The double-booking warning on an incoming request never fires for a real request — nothing fills `venue_profile_id` |
| MAJOR | QA7-5 | A signed-in performer or agent cannot send an offer from anywhere in the product; `POST /offers` has no caller |
| MAJOR | QA7-6 | An off-the-top rental never debits the party the deal names as payer — the pool pays it, so the act carries 70% of the co-promoter's room hire |
| MINOR | QA7-7 | An agent added to an event with none of their acts on it is told they were added, then gets `Event not found` forever |
| MINOR | QA7-8 | The settlement's party chooser is 426px wide with no wrap — the whole page scrolls sideways at 390px |
| MINOR | QA7-9 | "Nobody has confirmed these terms yet" printed after one of two parties signed |
| MINOR | QA7-10 | The act's own settlement card explains every part of SEK 67,000 and then pays SEK 62,000 with no line for the advance |
| MINOR | QA7-11 | A fan RSVPs, the row is written, and no screen can ever read it — there is no read route |
| MINOR | QA7-12 | Booking the whole venue on a night a room is taken says "This room is still free" |
| MINOR | QA7-13 | A draft invoice counts as money owed and money receivable before it is issued |
| MINOR | QA7-14 | The issued-invoice tab calls the people you billed "VENDOR" |
| MINOR | QA7-15 | The team invite dialog defaults to the one role the account's plan refuses |
| MINOR | QA7-16 | A co-promoter's projections read "SEK 0 across 0 events you hosted" under a panel reading SEK 83,000 |
| MINOR | QA7-17 | `operatorCostSplit` naming nobody on the event is accepted, stored, echoed back 200 — and silently ignored |
| MINOR | QA7-18 | A deal waiting for the act's signature is not on the act's "needs attention" list |
| MINOR | QA7-19 | Performer and crew invoice tiles print a bare `0` where the operator's print `SEK 9,000` |
| NOTE | QA7-20 | decisions #25.1 (Accept/Decline/Counter on the Deals tab; requests carrying venue + room) is not built |
| NOTE | QA7-21 | No per-user display currency and no date-format control in Settings |
| NOTE | QA7-22 | Audience has neither import nor export |
| NOTE | QA7-23 | `divideRounded` documents rounding and truncates |
| COSMETIC | QA7-24 | A converted card compares "≈ €4,013" against "the SEK 18,000 guarantee" in one sentence |
| COSMETIC | QA7-25 | The create-event deal step describes the split base with #23.1's retired wording |
| COSMETIC | QA7-26 | "PROFIT MARGIN 0.0%" beside "PROFIT / LOSS −SEK 50,150" |
| COSMETIC | QA7-27 | An un-numbered invoice shows its raw UUID prefix in the EVENT / REFERENCE column |

---

### QA7-1 — MAJOR — The break-even card solves the fee off GROSS while the rest of the same card uses ADJUSTED NET

**As:** `operator@` · **Route:** `/events/6262f802-16f1-4834-a034-5fad42eab54e?tab=budget` (QA7 Clash Night)
· **Code:** `packages/shared/src/budget-planning.ts:397-407`

**Steps.**
1. New event with a `guarantee_vs_door` deal: guarantee SEK 12,000, 65% of the adjusted net.
2. Ticket tier SEK 300 × 200. One cost row, `Production cost` SEK 20,000. Payment processing left at its 1.5% default.
3. Read the five KPIs and then walk the quantity down.

**Expected.** One deal, one rule. `docs/decisions.md` **#24.1**: *"every percentage divides the adjusted
net"*, and the same file promises *"the Budget Planner moves with the engine, in the same commit …
a split would otherwise have quoted the forecast one fee and the settlement another."*

**Actual.** The headline fee obeys #24.1 and the break-even scan obeys the retired #23.1. Measured on
one screen, by the screen's own arithmetic:

| Tickets | TOTAL REVENUE | TOTAL COSTS | PROFIT / LOSS | BREAK-EVEN TICKETS |
|---|---|---|---|---|
| 108 | SEK 32,400 | SEK 32,486 | **−SEK 86** | **200** |
| 109 | SEK 32,700 | SEK 32,491 | **+SEK 209** | **200** |
| 120 | SEK 36,000 | SEK 32,540 | +SEK 3,460 | **200** |
| 200 | SEK 60,000 | SEK 46,900 | +SEK 13,100 | **200** |

The night stops losing money at **109** tickets and the card says **200** — and says it while printing
a positive profit at 109 two centimetres above. The chart agrees with the KPI and not with the P&L:
*"Revenue passes total cost at 200 tickets of 400 capacity."*

**The mechanism, read rather than inferred.** `computeBudgetProjection`'s attendance scan derives the
fee from the **door**, not from the adjusted net:

```ts
const derivedAt = (tickets: number): bigint => {
  const door = averageTicketPrice * BigInt(tickets);
  return sum(derivedCosts.map((cost) => {
    const share = cost.splitBasisPoints != null ? applyBasisPoints(door, cost.splitBasisPoints) : 0n;
    const floor = cost.guaranteeMinor ?? 0n;
    return share > floor ? share : floor;
  }));
};
```

Solving `300N = 20,000 + max(12,000, 195N) + 4.5N` gives N = 199.0 → **200**, which is exactly what the
screen prints. Solving the rule the rest of the card uses — `max(12,000, 0.65·(300N − 20,000))` —
gives 108.3 → **109**.

**Evidence.** `docs/screenshots/qa-2026-09-28-run7/qa7-1-breakeven-200-while-profit-positive-at-109.png`
and `qa7-1-breakeven-card-full.png`; the table above is the screen read four times.

**Scope.** Every event with a percentage deal **and at least one cost row**. With no costs the two
bases coincide and the number is right, which is why it survives the seeded events. Reproduced a third
time after raising the guarantee to SEK 25,000: true 153, screen 200. Not a settlement defect — the
engine is correct; it is the forecast that lies.

**The one-line fix, for the report only.** `derivedAt` must subtract the sheet's own costs and rental
from `door` before applying `splitBasisPoints`, the same `EntitlementBases` the headline fee already
builds.

---

### QA7-2 — MAJOR — A tier entered on Event Details raises the planner's revenue and not the fee it derives; the settlement then pays SEK 10,000 more than the planner quoted

**As:** `operator@` · **Routes:** `/events/…e1?tab=details` → Ticket Information, then `?tab=budget`
· **Code:** `apps/web/src/components/useBudgetSeed.ts:685`

**Steps.**
1. Album Release already holds two ticket lines in `budgets` (SEK 65,000 + SEK 18,000 = SEK 83,000) and
   a 100%-of-adjusted-net door split between Marlo Vance (60%) and Neon Tide (40%).
2. On **Event Details → Ticket Information**, add `QA7 Early bird`, price 250, max 50, est. 40.
   `events.extras.ticketTiers` now holds it; `budget_lines` does **not**.
3. Open the Budget Planner, shared ledger.

**Expected.** One door. Whatever the planner counts as ticket revenue is what the deal divides —
decisions.md #24.1's *"the Budget Planner moves with the engine"*.

**Actual.** The same card, at the same moment:

- `TOTAL REVENUE SEK 93,000` · `TICKET REVENUE SEK 93,000` · three ticket rows · **"360 tickets planned across all types"**
- `HOW TICKET REVENUE SPLITS` — 60% **SEK 49,800** / 40% **SEK 33,200** (49,800 + 33,200 = **83,000**)
- *"Box office only, before costs and rental — after them the deal pays **SEK 50,000**."*
- `TOTAL COSTS SEK 84,395` = 50,000 (stale fee) + 33,000 (costs) + 1,395 (1.5% of 93,000)

Then `POST /events/…e1/settlement/compute` as `operator`:

```
ladder {"revenue":"9300000","costs":"3300000","netRevenue":"6000000","offTheTop":"0","adjustedNet":"6000000"}
b2 Marlo Vance  entitlement 3600000   b3 Neon Tide entitlement 2400000
```

**SEK 36,000 and SEK 24,000 — the settlement divides SEK 60,000 where the planner said SEK 50,000.**
The compute writes the tier into `budget_lines` (`seedTicketTiersIntoBudget`), and only *after* that
does the planner agree: reloaded, the same card reads 55,800 / 37,200 and *"the deal pays SEK 60,000."*

**The mechanism.** `doorForecastFrom` takes the sheet OR the event tiers, never both —
`const ticketRevenue = fromSheet > 0n ? fromSheet : fromEventTiers;` — with the comment *"The SHEET
wins when it has tiers of its own: it is the later statement of the same fact."* They are not the same
fact: the planner's ticket **table** renders both, additively (65,000 + 18,000 + 10,000 = 93,000,
"360 tickets").

**Evidence.** `qa7-2-door-93000-fee-from-83000.png`; the `budget_lines` and `settlement_lines` reads
before and after the compute.

**Scope.** Any event whose budget already holds a ticket line when a tier is added on Event Details —
which is the ordinary order of work, because the Budget Planner seeds a ticket line the moment it is
opened. The window is exactly the negotiation window: the operator agrees terms against a fee SEK
10,000 too low and finds out at settlement.

---

### QA7-3 — MAJOR — The private ledger reports a loss made of the shared book's numbers

**As:** `operator@` and `co.host@` · **Route:** `/events/…e1?tab=budget&budgetScope=mine`

**Steps.** Open **My budget** on the Album Release as either operator. Confirm in Postgres that the
private budget has no lines.

```
 id                                   | scope   | owner               | lines
 4519ef58-e1d1-4d20-94d2-81f73e2d6763 | private | The Lantern Hall    |     0
 a7c4c670-d02f-4a34-b6d7-42275e44daae | private | Northlight Presents |     0
```

**Expected.** `PLAN.md:215` — an event has one `shared` ledger, and a `private` book is *the extra an
operator MAY ALSO keep*. A book with nothing in it has nothing to report.

**Actual (host's private book).**

```
TOTAL REVENUE SEK 10,000 · TICKET REVENUE SEK 10,000 · TOTAL COSTS SEK 60,150 · PROFIT / LOSS −SEK 50,150
40 tickets planned across all types
HOW TICKET REVENUE SPLITS  60% SEK 55,800 / 40% SEK 37,200 — "after them the deal pays SEK 60,000"
Cost breakdown: Performer fee SEK 60,000 100%
```

Three different books on one screen: the SEK 10,000 revenue is `events.extras.ticketTiers` (event
scope), the SEK 60,000 fee is derived from the **shared** ledger's door, and the private book itself
is empty. The headline −SEK 50,150 is not a figure about anything. Earlier in the run, before the
tier existed, the same screen read `TOTAL REVENUE SEK 0 / TOTAL COSTS SEK 50,000 / −SEK 50,000`.

The co-host's private book is the same shape: `TOTAL REVENUE SEK 10,000`, *"40 tickets planned"*,
`TOTAL COSTS (PARTIAL)`.

**On what is deliberate here.** `useBudgetSeed` states, and means, that the derived fee is
event-scoped: *"deriving it from whatever slice of ticket revenue happened to be in the book being
viewed would produce a number that is not the performer's fee."* That argument is about the **fee**.
It does not license folding the fee into an empty book's TOTAL COSTS and printing a PROFIT / LOSS
from it — and it says nothing about the ticket **revenue**, which is what makes the private book
double-count the same 40 tickets that the shared book now also holds as a line.

**Evidence.** `qa7-3-private-book-host.png`, `qa7-3-private-book-cohost.png`; the `budgets` /
`budget_lines` reads above.

**Scope.** Every co-promoted event — which is the only kind that offers the scope chooser at all
(correctly: a single-operator event shows no chooser, verified on QA7 Clash Night). This is the
shared-versus-private ledger area the brief points at, and it is where the next one of these lives.

---

### QA7-4 — MAJOR — The double-booking warning on an incoming request cannot fire, because nothing fills the column it reads

**As:** `operator@` · **Route:** `/requests` · **Code:** `apps/web/src/routes/Requests.tsx:164-190`,
`apps/marketing/src/availability-request.ts:774`

**Steps.**
1. The Lantern Hall has two confirmed shows in **Main Room** on **29 Oct 2026**.
2. Post the ordinary public booking request for that night:
   `POST /api/v1/booking-requests {"source":"public_form","targetProfileId":"…a1","wantedDate":"2026-10-29",…}` → **201**.
3. Open the operator's Requests inbox.
4. Post a second identical request that also carries `venueProfileId` + `stageId` → **201**.
5. Reload the inbox.

**Expected.** decisions.md **#25.1**: *"every incoming request must carry date + venue + room …
because the double-booking check on an incoming request has nothing to compare without them."*

**Actual.**

- Request **without** `venueProfileId`: no warning of any kind. Card reads WANTED DATE 29 Oct 2026,
  SOURCE Public form, and offers **Create Draft** on a night already sold twice.
- Request **with** `venueProfileId`: *"Main Room already has "Marlo Vance — Album Release" and 1 more
  on this night. You can book it anyway."*

So the rule works and is never asked. `useRequestClashes` filters to
`request.status === "pending" && request.venueProfileId && request.wantedDate`, and:

```
       artist_name        |     source      | has_venue
 The Midnight Echo        | public_form     | f
 Marlo Vance              | performer_offer | f
 Marlo Vance              | performer_offer | f
 Neon Tide                | performer_offer | f
 DJ Frostbite             | venue_handoff   | f
 Various Artists          | public_form     | f
 QA7 Clash Applicant      | public_form     | f     ← the ordinary public form
 QA7 Room-Aware Applicant | public_form     | t     ← hand-built to prove the rule works
```

**Every seeded row is null**, and the marketing form only sends the pair when a room was picked:
`...(stageId ? { venueProfileId: target.id, stageId } : {})` — which happens on the shared-availability
page and never on the ordinary profile booking form, whose room select defaults to "any".

**Evidence.** `qa7-4-clash-warning-only-with-venueprofileid.png`; the SQL above.

**Scope.** Every incoming request in the product today. The hook, the route
(`GET /events/date-conflicts`), the message and migration `0047`'s column are all built and correct;
the producer was not updated with them. Note that on a request addressed to a venue,
`targetProfileId` **is** the venue — the hook could ask with that and be right for the common case.

---

### QA7-5 — MAJOR — Sending an offer is first-class in the data model, the API and the inbox, and impossible in the app

**As:** `performer.b@`, `agent@` · **Routes:** `/requests` (Outgoing), `POST /api/v1/offers`

**Steps.**
1. Sign in as `agent@` or `performer.b@`. Open **Requests → Outgoing**. The tab renders seeded offers.
2. Look for any way to compose one. Enumerated every button on the screen: `Incoming`, `Outgoing`,
   `Cards`, `List`, the date grid, and the status filters. There is none.
3. `grep -rn "usePostApiV1Offers" apps/web/src apps/marketing/src` → **no matches.**
4. Confirm the route itself is alive:
   `api-as.mjs performerB POST /offers {...}` → **201**, `"source":"performer_offer"`,
   `"senderProfileId":"…a3"`.

**Expected.** The brief's own framing, and the product's: offers and requests in both directions,
sending first-class. `POST /offers` exists, resolves the acting profile, and is entitlement-gated
(decisions #4's implementation note: a `free_artist` is capped at 50 performer-offers a month).

**Actual.** The only producer of a booking request in the whole codebase is
`apps/marketing/src/availability-request.ts`, posting to the **unauthenticated** public
`POST /booking-requests`. A signed-in act's only route to a venue is to leave the app, open that
venue's public page and fill in a stranger's form — which writes `source: public_form`,
`sender_profile_id: null`, no fee range and no agency attribution. The seeded `performer_offer` rows
that populate the Outgoing tab are data no user of this build can produce, and the free-tier offer cap
is unreachable code.

**Evidence.** The grep, the 201 above, and the `booking_requests` table in QA7-4 showing
`performer_offer` only on seeded rows.

**Scope.** Both non-operator directions, all three sender kinds (performer, agent, crew).

---

### QA7-6 — MAJOR — An off-the-top rental is paid by the pool, never by the party the deal names as payer

**As:** `operator@` / `co.host@` · **Event:** QA7 Waterfall Probe · **Deal:** `QA7 Room rental`,
`type: rental`, `guaranteeAmount: 500000`, parties `Northlight Presents = payer`, `The Lantern Hall = payee`

**Steps.** Build the textbook co-promotion: the co-promoter rents the room from the host for SEK 5,000.
Add SEK 120,000 of tickets and SEK 15,000 of costs, plus a 70/30 guarantee-vs-door for the act.
Confirm everything and compute.

**Expected.** `deal_parties.role_in_deal = 'payer'` means Northlight owes Lantern Hall SEK 5,000. The
event's pool should be untouched by an agreement between two of its operators.

**Actual (`POST /settlement/compute`, hand-checked against the DB):**

```
ladder  revenue 120,000 − costs 15,000 = net 105,000 − offTheTop 5,000 = adjustedNet 100,000
Marlo Vance (70%)        entitlement 70,000
The Lantern Hall         entitlement 20,000  (rental 5,000 + residual 15,000)   net −85,000
Northlight Presents      entitlement 15,000  (residual only)                    net +15,000
Σ net = 0
```

Northlight's entitlement carries **no rental obligation at all**. Compare the same night with the
rental deleted: adjusted net 105,000, act 73,500, operators 15,750 each. The SEK 5,000 rental
therefore moves: **host +4,250, co-promoter −750, the act −3,500.** The party named as payer bears
15% of its own rental and the act that never signed it bears 70%.

**Evidence.** The two computes above; `deal_parties` showing `payer`/`payee` correctly stored and both
confirmed.

**Scope.** Every rental deal, whoever the payer is. The engine reads only the rental's amount and its
payee (`reconcile.ts` off-the-top), never `role_in_deal`.

**This may be a product answer rather than a code defect, and it needs one.** decisions.md **#24.1**
un-retired the off-the-top rental and is explicit that the act shares it — for the *promoter rents from
the venue* case, where the promoter **is** the pool. It says nothing about a rental between two
co-operators, which is precisely the case QA6-1 was filed about. Whichever way it is decided, the deal
currently names a payer the settlement ignores, and the settlement screen prints
*"Rental of SEK 5,000, settled off the top"* under the payee's card and nothing under the payer's.


---

### QA7-7 — MINOR — An agent added to an event none of their acts is on is told they were added, then told the event does not exist

**As:** `operator@`, then `agent@` · **Routes:** `POST /events/:id/participants`, `/events/:id`

**Steps.**
1. QA7 Clash Night has Neon Tide (not represented by Astra) and no Marlo Vance.
2. `POST /events/6262f802…/participants {"profileId":"…a5","role":"agent"}` → **201**, `"status":"invited"`.
3. `notifications` gains: *Added to "QA7 Clash Night" — You were added as agent to "QA7 Clash Night."*,
   `link: /events/6262f802…`.
4. As `agent@`, follow that link → **"Couldn't load this event / Event not found"**.
   `GET /events/:id` → 404. `POST /events/:id/participation/accept` → 404. `GET /events/:id/deals` → 404.
   The invitation appears in no inbox either: the agent's `/requests` reads *"No requests match this view."*

**Expected.** Either refuse the write — story.md: an agent *"acts through the performers they
represent"*, and there is nobody to act through here — or make the row answerable. Contrast the
correct path: adding **Marlo Vance** to an event auto-adds Astra and the notification names the act
(*"Marlo Vance is on 'QA7 Waterfall Probe' — You were added to the show as Marlo Vance's agent, so
their deal and their settlement are yours to handle."*), and accepting works.

**Actual.** A permanent `invited` row, a notification promising access, and a 404 behind the link.
The boundary is not crossed — the agent gets nothing — but the refusal happens at the wrong end.

**Evidence.** `qa7-5-agent-added-then-event-not-found.png`; the notification row and the three 404s.

---

### QA7-8 — MINOR — The settlement's party chooser overflows the page at 390px

**As:** `operator@` · **Route:** `/events/:id/settlement` → **Settlement** tab, viewport 386px

**Steps.** Render the app in a 390px frame (macOS will not shrink a window below ~500px; an iframe at
390 gives `innerWidth 386`). Walk every top-level screen, every workspace tab and every settlement tab,
measuring `document.documentElement.scrollWidth` and every element's right edge.

**Expected.** No page-level horizontal scroll.

**Actual.** Fifteen top-level screens: clean (`scrollWidth` 376–386). Ten workspace tabs: clean; the
tab strip scrolls inside itself, which is deliberate. Six of seven settlement tabs: clean. The
**Settlement** tab: `scrollWidth 465` against a 386 viewport — a 79px page overflow, and the browser
draws a horizontal scrollbar under the whole app.

The escaping element, found by walking up for the first ancestor with `overflow-x` set (there is none):

```
DIV  left 39  right 465  width 426  "Marlo VanceNeon TidePriya SoundAstra Booking Agency"
BUTTON left 320 right 465 width 146 "Astra Booking Agency"
```

— the *"Curate what each collaborator sees"* party row: four buttons in a row, no wrap, no scroller.

**Evidence.** `qa7-8-mobile-settlement-status-rail-overflow.png`,
`qa7-8-mobile-party-chooser-overflow.png` (page scrolled right; "Astra Booking A…" clipped at the
edge). Note the status rail beside it is *correctly* contained — it has its own scroller.

**Scope.** Any settlement with four or more non-reader parties. Three would fit.

---

### QA7-9 — MINOR — "Nobody has confirmed these terms yet", printed after one of the two parties signed

**As:** `operator@` · **Route:** `/events/6262f802…?tab=budget`

**Steps.** Reopen a deal, edit the guarantee, confirm as the operator only, reload the planner.

**Actual.** `GUARANTEE VS DOOR · PROPOSED … The guarantee beats the door … **Nobody has confirmed
these terms yet**, so they can still move.` while Postgres holds:

```
 The Lantern Hall | payer | 2026-09-28 04:31:52+00
 Neon Tide        | payee |
```

**Expected.** The second half of the sentence is right and useful — terms can still move until every
party signs. The first half asserts something the same event contradicts. *"One of two parties has
signed"* would be both true and more informative.

**Evidence.** `qa7-6-nobody-has-confirmed-but-one-has.png` and the `deal_parties` read.

---

### QA7-10 — MINOR — The act's settlement card itemises everything except the reason its payout is SEK 5,000 short

**As:** `performer.a@` (and the operator sees the same) · **Route:** `/events/e2656297…/settlement` → Settlement

**Steps.** Put an advance on the deal (`advanceAmount: 500000`) and a deduction on the settlement
(`QA7 Artist hotel`, SEK 3,000, paid by the venue, charged to Marlo). Recompute. Read Marlo's card.

**Actual, on the act's own screen:**

```
Marlo Vance (you)  Performer                          SEK 67,000
  The 70% door share beats the SEK 20,000 guarantee   SEK 70,000
  Less costs somebody else fronted on your behalf    − SEK 3,000
    — QA7 Artist hotel                               − SEK 3,000
…
Total Payouts   Marlo Vance payout                    SEK 62,000
```

The deduction is itemised beautifully. The SEK 5,000 that turns 67,000 into 62,000 appears nowhere on
this tab. The engine has it (`"prepaid":"500000"`) and `packages/settlement/src/types.ts:160` states
the requirement in as many words: *"'paid in advance by X' rather than printing a figure with no
counterparty."*

**Mitigating.** It **is** disclosed, one tab away: **Deal structure** reads `PAID IN ADVANCE SEK 5,000`.
So this is a missing line on the card that states the gap, not a hidden figure — which is why it is
MINOR and not MAJOR. The arithmetic is right: Σ net = 0, transfers 62,000 + 15,000 = 77,000 = the
host's negative net.

---

### QA7-11 — MINOR — A fan RSVPs, the row is written, and no screen can ever read it

**As:** an anonymous fan, then `operator@` · **Routes:** `localhost:5173/event/:id`, `/audience`

**Steps.** RSVP on the Album Release's public page as `QA7 Fan / qa7fan@e2e.showme.test / Stockholm`.
The page answers *"You're on the list — The organiser of Marlo Vance — Album Release knows to expect
you."* Then open `/audience` as the operator.

**Actual.** `audience_rsvps` holds the row. `/audience` reads **"0 contacts … No audience yet — Fans
appear here once they RSVP or buy tickets."** No notification is written either
(`select … from notifications where created_at > now() - interval '5 minutes'` → 0 rows). There is no
read endpoint at all: `audienceRsvps` appears in `apps/api/src` exactly once, in
`routes/public.ts:645`, an `insert`.

**Why this is MINOR and not the NOTE run 6 filed it as.** Two screens state a cause their own data
contradicts, and one of them is a promise made to a member of the public. The gap is known and
recorded (`docs/urgent-board-loop-2026-09-28-part10.md`); this run contributes the row that proves it.

---

### QA7-12 — MINOR — Booking the whole venue on a night a room is taken says the room is free

**As:** `operator@` · **Routes:** Create New Event dialog, and the event workspace's own banner

**Steps.** New event → venue The Lantern Hall → **ROOM / STAGE: The whole venue** → date 2026-10-29
(Main Room already booked).

**Actual.** *"Already on this night: "Marlo Vance — Album Release" in Main Room. **This room is still
free.**"* No room has been chosen, and a whole-venue booking is not free on a night the main room is
sold. Selecting Main Room gives the correct sentence: *"Main Room already has "Marlo Vance — Album
Release" on this night. You can book it anyway."* The same wrong sentence then persists on the created
event's Event Details, under `Room / Stage: No room set`.

**Evidence.** `qa7-whole-venue-says-room-is-free.png` plus the two dialog readings.

---

### QA7-13 — MINOR — A draft invoice is counted as money owed and money receivable

**As:** `operator@` · **Route:** `/invoices`

**Steps.** Create a received bill for SEK 1,234 and an issued invoice for SEK 5,000, both left in
`state: draft`.

**Actual.** `OUTSTANDING (PAYABLE)` went 9,000 → **10,234** *("Bills you owe")* and
`RECEIVABLE (SENT)` went 50,000 → **55,000** *("Invoices you've issued")*, while both rows still show
the status **Draft** with an **Issue** button beside them. `OVERDUE` correctly ignored them.

**Expected.** A bill nobody has issued is not owed, and an invoice nobody has sent has not been issued
— the tile's own subtitle says so.

---

### QA7-14 — MINOR — The issued-invoice tab calls the people you billed "VENDOR"

**As:** `operator@` · **Route:** `/invoices` → **Sent**

The Sent (receivable) table's first column header is **VENDOR**, under which sit
`QA7 Recipient`, `Astra Booking Agency (for Marlo Vance)` and `Söder Live` — the customers. The New
invoice dialog gets it right, labelling the same field **BILL TO** on the Issued tab and **FROM** on
the Received tab. Evidence: `qa7-invoices-sent-tab-vendor-header.png`.

---

### QA7-15 — MINOR — The team invite dialog defaults to the one role this plan refuses

**As:** `operator@` (Free_operator) · **Route:** `/team` → Invite Member

ROLE pre-fills **Editor**. Filling in the email and pressing **Send invite** answers with the upsell
*"Included in shoWMe Pro … Your plan includes one administrator. Everyone else can be added as a
viewer or crew."* Choosing **Viewer** sends fine (`invitations` row written, landing page verified).
The plan is known before the form is drawn; the default should be a role it permits, or the
unavailable options should be marked in the picker rather than after the submit.

---

### QA7-16 — MINOR — A co-promoter's projections say "SEK 0 across 0 events you hosted" under a panel saying SEK 83,000

**As:** `co.host@` · **Route:** `/projections`, filter **All events**

```
PROJECTED REVENUE  SEK 83,000   1 of 2 events budgeted
…
All time, ignoring the filter above: budgeted revenue SEK 0 across 0 events you hosted.
REVENUE BY EVENT   Marlo Vance — Album Release  SEK 83,000
```

The sentence claims to be the same measure with the filter removed; it is in fact a different
measure (host-only) and reports zero for an account that is never the host. The operator's own copy of
the line is consistent (`SEK 336,000 across 6 events you hosted` beside `SEK 336,000` in the panel),
which is why the mismatch only shows up in the co-promoter's seat.

---

### QA7-17 — MINOR — An `operatorCostSplit` that names nobody is accepted, stored, echoed back, and silently ignored

**As:** `operator@` · **Route:** `PATCH /events/:id/budgets/:bid`

`PATCH … {"planningAssumptions":{"operatorCostSplit":{"<profileId>":70,"<profileId>":30}}}` →
**200**, and the response echoes the object back verbatim. `budgets.planning_assumptions` stores it.
The settlement then divides the residual **50/50**, because `routes/settlement.ts:732` keys the map by
`event_participants.id`, not `profiles.id`, and the docstring's fallback — *"naming nobody on the
event, falls back to equal shares"* — fires silently.

The Zod schema is `z.record(z.string().uuid(), z.number().int().min(1).max(10_000))`: any uuid, and a
value in basis points that a caller sending percentages (70) will also get "accepted". Nothing at the
API or on screen says the stored split is inert.

**The UI is correct and was verified separately** — see *What passed*. This is about what the API
accepts from anything that is not that one screen.

---

### QA7-18 — MINOR — A deal waiting for your signature is not something that "needs attention"

**As:** `performer.b@` · **Route:** `/`

With `QA7 Clash Night`'s agreement at `sent`, one party signed and Neon Tide's line unsigned, the
act's dashboard reads *"You're all caught up — nothing needs your attention today"* over
*"Nothing needs attention — Pending events, new booking requests and open tasks surface here."*
The bell showed 17 unread. The Deals tab of that event offers **Confirm your line**; the dashboard,
which is the screen that exists to route people to it, does not know about it.

---

### QA7-19 — MINOR — Performer and crew invoice tiles print a bare `0`

**As:** `performer.a@`, `professional@` · **Route:** `/invoices`

`OUTSTANDING (PAYABLE) 0` · `OVERDUE 0` · `RECEIVABLE (SENT) 0`, where the operator's equivalents read
`SEK 9,000` and `SEK 50,000`. The currency is dropped when the total is zero, so the one number a new
account ever sees on this screen is the one without units.
Evidence: `qa7-invoices-bare-zero-performer.png`.

---

### QA7-20 — NOTE — decisions #25.1 is decided and not built

The act's Deals tab offers **Confirm your line** only — no **Decline**, no **Counter**. The operator's
Requests inbox still offers **Create Draft** / **Make Offer** rather than **Accept request**. And
`booking_requests` has no room or venue on any real row (QA7-4). All three are #25.1, taken
2026-09-27. Recorded as unbuilt, not inflated into a bug.

### QA7-21 — NOTE — No per-user display currency, no date format

Settings → General offers `BASE CURRENCY` and `TIMEZONE` for the **organization** (both honoured: a new
event inherited `SEK` and `Europe/Stockholm`). There is no per-user display currency — the chooser on
the planner and the settlement is per visit — and no date-format control anywhere. This is the parked
item r2:1128, re-confirmed.

### QA7-22 — NOTE — Audience has neither import nor export

`/audience` renders no Export/Import affordance for any account kind. Contacts has both and they work
(see *What passed*).

### QA7-23 — NOTE — `divideRounded` documents rounding and truncates

`packages/shared/src/budget-planning.ts:264-268`: *"Round half away from zero, so a break-even of
100.5 tickets needs 101"* over `return numerator / denominator` — BigInt division, which truncates.
Its one caller is `averageTicketPrice`, so on a mixed-price bill the average is a fraction of a minor
unit low. Not load-bearing; the comment is wrong about the code beside it.

### QA7-24 — COSMETIC — A converted card compares euros to kronor in one sentence

`/events/…e2/settlement` previewed in EUR: every figure carries `≈` and is converted
(78,000 → ≈ €6,731, 46,500 → ≈ €4,013 — rate 0.08630, consistent across all six figures, hand-checked),
and the caption beside them reads *"The 70% door share beats the **SEK 18,000** guarantee"*. Keeping
the contract figure in its payout currency is defensible; making the comparison across two currencies
in one sentence is not.

### QA7-25 — COSMETIC — The create-event deal step describes the split base with the retired wording

Step 2 of Create New Event: *"NEON TIDE'S SHARE OF THE POOL — Of revenue less the costs paid to
outside suppliers. What is left over is yours."* That is #23.1's pool, reversed by **#24.1** on
2026-09-15; the base is the adjusted net, which also subtracts the venue rental off the top. The deal
detail screen gets it right (*"Share of the adjusted net 70%"*).

### QA7-26 — COSMETIC — "PROFIT MARGIN 0.0%" beside "PROFIT / LOSS −SEK 50,150"

The private ledger's Results card, same screen as QA7-3.

### QA7-27 — COSMETIC — An un-numbered invoice shows its raw UUID prefix

A received bill created in-app carries no `number` (correct — the vendor's reference is theirs), and
the EVENT / REFERENCE column falls back to `1ec9843d`, the first segment of the row's primary key.

---

## 4. What passed — walked, and correct

Named, because this is the other half of the result.

**The money spine.** Hand-checked three settlements to the minor unit and all three balance.

- **Spring Warmup (finalized).** Gross 78,000 − deductions 9,000 = net 69,000 = adjusted net.
  70% of 69,000 = 48,300 beats the SEK 18,000 guarantee; less the SEK 1,800 `Artist hotel` deductible
  = **46,500** — which is the figure decisions.md #24.1 predicts in writing (*"54 600 → 48 300 →
  52 800 → 46 500"*). Operator residual 20,700. Σ net = 0. Operator `paid` 10,800 = 9,000 costs +
  1,800 hotel.
- **QA7 Waterfall Probe.** 120,000 − 15,000 = 105,000 − 5,000 rental = 100,000. Act 70,000, residual
  30,000, Σ net = 0. With a SEK 3,000 deduction and a SEK 5,000 advance added: act 67,000, payout
  62,000, Σ net = 0, transfers 62,000 + 15,000 = 77,000 = the host's negative net.
- **QA7 Clash Night.** 36,000 − 20,000 = 16,000; the SEK 25,000 guarantee beats 65% of 16,000;
  residual 4,000. Σ net = 0.

**Ran's 2026-09-21 spec — the fee from the DRAFT deal.** Built and correct. A `sent`, unconfirmed
deal put `Performer fee SEK 12,000` on the planner with *"still an offer, nobody has confirmed it."*
Typing 200 × SEK 300 moved it live to **SEK 39,000** (65% of the door, beating the guarantee) with a
`PROPOSED` badge and the right explanation. Adding a SEK 10,000 cost moved it to **SEK 32,500** — 65%
of the adjusted net, not of the gross — and the headline totals (43,400 / 16,600) reconcile exactly.
Editing the offered terms while pending **re-seeds**: reopening the deal and raising the guarantee to
SEK 25,000 put SEK 25,000 on the planner on the next read.

**The freeze holds at the server.** `PATCH /deals/:id {"guaranteeAmount":…}` on a confirmed agreement
→ **409** *"These terms are frozen — guaranteeAmount cannot change on a confirmed agreement. Reopen it
for renegotiation first: POST /deals/…/reopen"*, and Postgres unchanged.

**Realtime, proven with two genuinely independent browsers.** Three separate frames, each landing on a
screen that was already open and never reloaded:

1. A date change confirmed by three parties over the API cleared the **crew's** banner and moved the
   header from 22 Oct to 29 Oct (QA6-3).
2. The host pressed **Send for review** in one browser; the **co-host's** settlement moved `Open` →
   `Pending review` in the other.
3. The act signed its line in one browser; the **operator's** Budget Planner dropped the `PROPOSED`
   chip and the *"Nobody has confirmed"* sentence in the other.
4. A message posted in the operator's browser appeared in the performer's within seconds.

That closes the gap the brief describes: `useRealtimeStream` now invalidates every event-scoped query
key rather than a hand-maintained list of seven.

**Party scoping.** Neon Tide's settlement on a shared 60/40 split shows **only** their own line —
`SEK 24,000`, captioned *"100% of the adjusted net — your 40% of the deal's SEK 60,000"* — and never
Marlo's SEK 36,000. A co-host on Standard access sees their own SEK 1,200 and is told plainly *"The
night's takings and costs are the operator's view of this event"*. The host's own Overview says
honestly *"At least SEK 15,000 of it belongs to a party whose settlement is not shared with you"*.

**The share viewer.** Created a link with **Budget** deliberately ticked on, addressed to
`performer.a@`. The recipient passed the OTP challenge (code read from the dev mail sink) and got
the show, the schedule, **their own** deal line and their own settlement (`SEK 36,000`, matching the
engine) — and **no budget**. The ceiling refused what the sender asked for, exactly as the dialog
promised it would.

**Crew have no vote, and still see the question.** `POST /change-request` as crew → 403 *"Only the
venue and the acts on the bill can ask to move this booking"*; answering it → 403 *"This change is not
yours to answer — the parties standing on this date decide it"*; `GET /change-request` → 200 with the
full request. Changing Neon Tide's role to `crew_lead` took their proposal right away (403) and
changing it back restored it (200) — a capability that actually changes.

**Co-promotion, the parts that work.** The scope chooser appears only on an event with a co-host
(none on a single-operator event, as PLAN.md:215 requires). A cost typed by the co-promoter lands with
`paid_by = Northlight Presents`. `operatorCostSplit` set through the planner's own toggle stores
participant ids in basis points and moves the money: 70/30 on a SEK 4,000 residual paid
**2,800 / 1,200**, Σ net = 0. `event.delete` is host-only with an excellent refusal. A co-host with
**Full control** may rename and re-date — and the whole bill is notified when they do. A co-host on
Standard access may not (403 `event.edit`). In-House Management is invisible to crew and to a
Standard-access co-host, and visible to a co-host with full control.

**Booking.** Hold ranking is right: placing a second hold on an occupied date defaulted to *"2nd
hold"* and stored `hold_rank = 2`; **Promote to 1st** swapped the two rows in Postgres and then
correctly disabled itself. **Publish** is disabled on a held event. Availability sharing excluded
**29 Oct** and **18 Nov** (confirmed shows) from a 93-day window, included held dates only because the
"Dates on hold" toggle is off by default, and the public viewer shows dates and nothing else, with
*"Counted as unavailable: confirmed events"* stated on the page.

**Invitations.** The team invite writes a row, the landing page masks the address
(`q•••@e•••.showme.test`), and opening the same link while signed in as somebody else says so
precisely: *"This invitation is not for this account … Sign out and sign back in with the invited
address."*

**Contacts import/export round-trips.** Export produced correctly quoted CSV; importing a
hand-built file previewed *"2 to import · 0 duplicate · 0 rejected"*, imported both, and Postgres
holds them with their `persons` jsonb intact.

**Everything else walked clean.** All fifteen sidebar destinations for all six accounts: every one
renders, **zero console errors**, **zero failed requests** except one expected `403` (a Standard-access
co-host's `GET /budgets` from Projections). Boundary pages — not stubs, not blanks — for `/audience`,
`/reports`, `/setlists`, `/projections` on the kinds that should not have them, each naming the reason.
Setlist writes round-trip (`4:20` → `duration: 260`). Tasks create, land on the calendar grid on the
right day. `?date=` deep-links the calendar. Schedule templates, ticket tiers, the invoice currency
guard, the idle sign-out, `?tab=` and the back button — all as specified in §2. Mobile 386px: fifteen
top-level screens, ten workspace tabs and six of seven settlement tabs with no page overflow, and the
New event modal fits with its footer reachable.

---

## 5. Not reached, and why

- **`pnpm test:e2e` and the unit suites.** Excluded by the brief — the e2e run tears this stack down.
  No test counts are quoted anywhere in this report.
- **Scheduled jobs.** `apps/jobs` (expired offers, venue handoffs, due representation terminations,
  FX refresh) was not driven. Nothing time-based was aged and re-run, so anything that only converges
  through `pnpm jobs:run` is unexamined.
- **File upload.** Posters, avatars, banners and rider attachments were read but never uploaded —
  the storage path (signed URLs, the `files` table) is unexercised.
- **Google OAuth callback** (`/oauth/google/callback`) and calendar import/export beyond seeing the
  buttons. **Export ICS** and **Import** on the calendar were not run.
- **Email delivery.** The dev sink prints instead of sending; I read one OTP out of it and took the
  rest on trust.
- **Real second-browser coverage of every two-sided flow.** Four were driven with two independent
  browsers (§4). Counter-offers, settlement approvals and comments were driven one-sided.
- **`performer.b@`'s and `professional@`'s own profile editors**, the Preview tab, and photo/video
  reordering.
- **A reseed.** The stack was handed to me already seeded and I did not restart it, so the later
  probes in this run ran against state earlier probes had left. Everything quoted above names the row
  it was read from, and the three settlements were hand-checked against Postgres rather than against
  the screen — but a reseed before quoting is the discipline, and this run did not have one.

---

## 6. Probes that lied

Three, and the re-runs.

1. **The cost-split probe was vacuous the first time, and looked like a MAJOR.** Setting
   `operatorCostSplit` to `{"<profileId>":70,"<profileId>":30}` through the API returned **200**,
   stored the object, echoed it back — and the recompute paid a flat **50/50**. That reads exactly
   like "the split does nothing". It does not: the engine keys on `event_participants.id` and reads
   **basis points**, so my payload named nobody. Driven again through the planner's own toggle, which
   sends participant ids and `7000`/`3000`, the residual split **2,800 / 1,200** and Σ net stayed 0.
   The mechanism works. What survives as a finding is only the silence — QA7-17.

2. **"The crew seat was signed out mid-run."** It looked like a session bug. `lastActivityAt` was
   1790566801888 and `Date.now()` was 1790570497805 — **62 minutes**, against the account's own
   *"Sign me out when idle: after 1 hour"*. Correct behaviour, caused by my driving that seat through
   `history.pushState` (which is not activity) rather than clicks. No finding.

3. **"A third ticket row appeared on the co-host's ledger that the host does not have."** I had read
   the host's planner *before* creating the `QA7 Early bird` tier and the co-host's *after*. Re-read
   both at the same moment: identical. The real defect in that area is QA7-2, and it is a different
   one — found only because chasing the false alarm made me compare the split card against the header
   on the same screen.

Also worth stating plainly, because it is the reason QA7-1 is filed as MAJOR rather than as a
rounding quibble: **`BREAK-EVEN TICKETS` was read four times at four attendances and never moved.**
A single reading of "200" beside a loss is a number you would accept. Four readings, two of them
straddling the true crossing with the screen's own P&L flipping sign between them, is not.
