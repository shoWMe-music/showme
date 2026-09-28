# QA sweep — run 9 (2026-09-28)

**Stack booted from `93030f0` · branch `main`, freshly seeded** (`pnpm dev` drops and recreates the
container), so every figure below was measured against a seed this run created. The marketing site
was started separately (`pnpm --filter @showme/marketing dev`, `localhost:5173`, IPv6-only — a
`curl 127.0.0.1:5173` health check never answers). **No application code was edited at any point.**

**`main` moved and the tree went dirty underneath the run, and it does not affect a single
measurement — here is why.** At boot HEAD was `93030f0`; at close it was `7125f00` plus an
uncommitted change.

| What | Files | Could it have reached a measurement? |
|---|---|---|
| `7fb68e4`, `993e4c7`, `7125f00` | `docs/` only (+ this run's screenshots, committed by the other pass) | **No.** No code. |
| Uncommitted working tree | `apps/api/src/routes/deals.ts`, `apps/api/src/lib/deal-authority.ts`, `packages/shared/src/deal-terms.ts` (+ two test files) | **No.** The API has no watch and was never restarted, so it ran `93030f0` throughout. The `packages/shared` change *is* reachable through Vite HMR, but it is **purely additive** (`git diff --numstat` → 125 added / 1 removed, the one removal an import line; the new exports are `dealDraftFrom`, `dealKindOf`, `StoredDealTerms`) and it lives in `deal-terms.ts`, which the deal **composer** reads. Every money reading below comes from `budget-planning.ts`, `break-even-chart.ts` and `settlementDocument.ts` — all untouched. |

**Stack:** web `:5180`, API `:8080`, stream `:8081`, Firebase Auth emulator `:9099`, Postgres
`:55432` (`showme-e2e-postgres`), marketing `localhost:5173`.

**Screenshots:** `docs/screenshots/qa-2026-09-28-run9/`.

---

## 1. What was driven

The Playwright MCP server is not present in this session, so **every browser step used
chrome-devtools MCP**, one `isolatedContext` per account — separate profiles and separate IndexedDB,
not tabs. Verified independent: five accounts were signed in simultaneously and none displaced
another, and the two-seat realtime check below only works because of it.

| Seat | Account | Context | Depth |
|---|---|---|---|
| 64 | `operator@` — The Lantern Hall | default | full: all 14 destinations, event creation end to end, all 10 workspace tabs on a new event, both budget scopes, both settlement workspaces, Settings (all 8 panels), 390px sweep |
| 65 | `co.host@` — Northlight Presents | `cohost` | full: all 14 destinations, Deals, both budget scopes with typed lines, the settlement on two events |
| 66 | `agent@` — Astra Booking Agency | `agentseat` | all 11 destinations, event Settlement tab, settlement workspace, Requests (both tabs) |
| 67 | `performer.a@` — Marlo Vance | `perfA` | all 13 destinations, settlement workspace, Messages, Requests (both tabs), Invoices |
| 68 | `professional@` — Priya Sound (crew) | `crew` | all 11 destinations + the four boundary pages by direct URL, Messages, Requests |
| 69 | `performer.b@` — Neon Tide | `perfB` | all 13 destinations, Messages (posted from here), the invitation landing page, an accepted invitation |
| 63 | — | default (marketing) | the public event page and public profile page, unauthenticated, plus a real RSVP |

**`performer.b@` got a browser seat this run.** Run 8 named its absence as the honest gap in its seat
coverage; it is closed. All six seeded accounts were driven in a browser.

API probes used `node .claude/skills/verify-e2e/api-as.mjs`. Every figure quoted was read back out of
Postgres with `docker exec -i showme-e2e-postgres psql -U postgres -d showme`.

---

## 2. Part 1 — what run 8 caused to be fixed

**Ten of ten HOLD.** Three carry a residual that is filed as a new finding rather than a regression,
and that distinction is stated in each row.

| # | Item | Verdict | The figure I read |
|---|---|---|---|
| 1 | **QA8-7** message notifications | **HOLDS, all five sub-claims** | See §2.1 below |
| 2 | **QA8-6** crew cannot offer to play | **HOLDS** | See §2.2 |
| 3 | **QA8-8** private book does not divide a shared door | **HOLDS** | See §2.3 |
| 4 | **QA8-13** commission eyebrow names the other party | **HOLDS, all three seats** | See §2.4 |
| 5 | **QA8-14** "Edit them there." only for `budget.edit` | **HOLDS, all four seats** | See §2.5 |
| 6 | **QA8-12** one minus glyph | **HOLDS on the glyph; the SPACING is still two ways** → **QA9-14** | See §2.6 |
| 7 | **QA8-9** no inbox promise on the RSVP | **HOLDS**; the unread row is still unread → **QA9-9** | See §2.7 |
| 8 | **QA8-10** Billing, and a payout account that identifies nothing | **HOLDS**; format still unvalidated → **QA9-17** | See §2.8 |
| 9 | **QA8-11** "Ask the host to add you to it" | **HOLDS** | See §2.9 |
| 10 | **QA7-24** the agreement's currency first | **HOLDS, both directions** | See §2.10 |

### 2.1 QA8-7 — HOLDS

`notifications` was emptied before each probe, so every count below is exact.

- **An all-hands message** posted by `operator@` on the Album Release wrote **5** `message.posted`
  rows — `e2e-agent`, `e2e-co-host`, `e2e-performer-a`, `e2e-performer-b`, `e2e-professional`. The
  **sender got none** (`e2e-operator` absent), confirmed again on screen: the operator's bell held
  only *"Offer from Marlo Vance"*.
- **An operators-only note** wrote **exactly one** row, `e2e-co-host`. **No performer row, no crew
  row** — the disclosure boundary holds.
- **A party thread addressed to Marlo Vance** wrote **three** rows: `e2e-performer-a` (the party),
  `e2e-agent` (their agent) and `e2e-co-host`. **Neon Tide got nothing** — the other act on the same
  bill is not told. The co-host's row is correct, not over-notification: `GET
  /events/:id/messages` as `coHost` returns all three messages, and the thread's own `readers` list
  names *"Northlight Presents (co_host)"* to Marlo, so the bell mirrors the read rule exactly as the
  route's docstring requires.
- **The row carries no message text.** `select body from notifications` → NULL on every row. The
  recipient's bell (driven as `co.host@`) reads *"New message on "Marlo Vance — Album Release" · by
  The Lantern Hall (operator)"* and nothing else.
- **Settings → Notifications now lists seven categories**, the seventh
  *"Messages on your events — Somebody posts in a conversation you are part of."* Read off the
  controls: `Messages on your events — in app` **checked true**, `Messages on your events — email`
  **checked false**.

### 2.2 QA8-6 — HOLDS

```
teamAndCrew POST /offers  (actingProfileId = Priya Sound)
400  "A team-and-crew profile is a service rather than an act, so it cannot offer to play a date.
      An offer to play comes from a performer, or from the agent who represents them."
booking_requests count: 6 before, 6 after
performerA POST /offers   (actingProfileId = Marlo Vance)
201  "source":"performer_offer","senderType":"performer","artistName":"Marlo Vance"
booking_requests count: 7
```

In the browser: **`/requests` as `professional@` has no "Send an offer" button** (every main button
enumerated: `Incoming, Outgoing, Cards, List, Pending, Unread, All, Accepted, Declined, Flagged,
Archived, Expired`). It is present for `performer.a@`, `performer.b@` and `agent@`.

**This is also the probe that lied to me first — see §6.1.** The crew 400 initially came from
`!sender` ("Select a profile to send the offer from"), not the kind guard.

### 2.3 QA8-8 — HOLDS

Driven as **`operator@`** on `?tab=budget&budgetScope=mine` (the co-host's copy is a false positive
and was not used for the verdict).

- **My budget:** `TOTAL REVENUE SEK 0 · TICKET REVENUE SEK 0 · TOTAL COSTS SEK 0 · PROFIT / LOSS
  SEK 0`, *"0 tickets planned across all types"*, and **no "HOW TICKET REVENUE SPLITS" card anywhere
  on the page** — grepped the whole `main` innerText for `SPLIT`, `55,800`, `49,800`, `33,200`:
  nothing.
- **Shared ledger, same event, same load:** the card whole —
  `HOW TICKET REVENUE SPLITS · 60% Marlo Vance / 40% Neon Tide · DOOR SPLIT · Marlo Vance 60% SEK
  49,800 · Neon Tide 40% SEK 33,200 · 100% of the door.` and the sentence **"Box office only, before
  costs and rental — after them the deal pays SEK 50,000."** 49,800 + 33,200 = 83,000 = the shared
  door. ✓

### 2.4 QA8-13 — HOLDS, all three seats

| Seat | The commission card's eyebrow |
|---|---|
| `agent@` | **AGENT COMMISSION — PRIVATE TO YOU AND MARLO VANCE** |
| `performer.a@` | **AGENT COMMISSION — PRIVATE TO YOU AND YOUR AGENT** |
| `operator@` | **no commission card at all** (the whole Settlement tab text searched for `COMMISSION`, `Astra`, `1,500`: nothing) |

### 2.5 QA8-14 — HOLDS

| Seat | The Revenue & deductions subtitle |
|---|---|
| `operator@` | *"Read-only preview of the figures entered on Financials. **Edit them there.**"* |
| `agent@` | *"Read-only preview of the figures entered on Financials."* — stops there |
| `performer.a@` | *"Read-only preview of the figures entered on Financials."* — stops there |
| `professional@` | no money surface at all on that route |

### 2.6 QA8-12 — HOLDS on the glyph, and the spacing is still two ways

On `/events/…e1?tab=settlement` (the card stack run 8 measured) every negative is now **one glyph and
one spacing**, read as codepoints off one `innerText`:

```
"− SEK 83,000"  [8722, 32, 83]
"− SEK 3,000"   [8722, 32, 83]
"− SEK 2,000"   [8722, 32, 83]
```

U+2212 throughout; the U+002D hyphen is gone. **And the payer's advance renders with no sign** —
`Paid in advance to Marlo Vance and Neon Tide  SEK 5,000` — which is right: it raises what the
operator is owed.

The settlement **workspace** one screen along still prints two spacings on one card — filed as
**QA9-14**.

### 2.7 QA8-9 — HOLDS

RSVP submitted as `QA9 Fan / qa9fan@e2e.showme.test / Gothenburg` on
`localhost:5173/event.html?event=…e1`. The page answers, in full:

> **You're on the list** — The organiser of Marlo Vance — Album Release knows to expect you.

**"Keep an eye on your inbox" is gone.** The organiser sentence survives. The row is written:

```
 event_id | name    | email                  | city       | created_at
 …e1      | QA9 Fan | qa9fan@e2e.showme.test | Gothenburg | 2026-09-28 14:56:07+00
```

The row is still unreadable by anything — **QA9-9**.

### 2.8 QA8-10 — HOLDS

Settings → Billing now reads:

```
PAYOUT ACCOUNTS
No payout accounts yet
Paying out through shoWMe is not connected yet, so there is nothing to add here.
Mark each transfer on a settlement as you pay it.
```

No "Add a bank account", and no Add control promised. And the route:

```
POST /profiles/…a1/payout-accounts {"type":"iban","label":"QA9 bank","currency":"SEK",
                                    "iban":"SE4550000000058398257466"}
400  "body/identifier Required"          payout_accounts count: 0
… same call with "identifier": …        201                     (deleted afterwards)
```

400, not 201-with-null, and no row. Format is still unchecked — **QA9-17**.

### 2.9 QA8-11 — HOLDS

`/events/…e1?tab=deals` as `co.host@`:

> **Not your deal to see** — This event has a deal, and its terms are not yours to read. A deal is
> only visible to the parties named on it.

No instruction naming an action nobody can take.

### 2.10 QA7-24 — HOLDS, both directions

Spring Warmup's settlement, `operator@`, same page load, currency switched with the header's
**Preview in another currency** chooser:

- **SEK:** *"The 70% door share beats the **SEK 18,000** guarantee"* — no parenthetical.
- **EUR:** *"The 70% door share beats the **SEK 18,000 (≈ €1,553)** guarantee"* — the agreement's
  currency first, the conversion beside it.

The rate checks out: 46,500 → €4,013 is 0.08630; 18,000 × 0.08630 = 1,553.4 → €1,553; 78,000 ×
0.08630 = €6,731, which is what the gross row reads. And the preview moved **nothing** settled —
`settlements.computed` unchanged, and the banner says so: *"Preview only… the settlement is
denominated in SEK, and that is what is owed, recorded and paid."*
Evidence: `qa9-v-qa7-24-eur-guarantee.png`.

### 2.11 Run 8's own three number fixes

**QA8-3 — HOLDS, and it holds on a shape the fix has not been measured against before.** The seeded
100%-of-adjusted-net deal now reads `TOTAL REVENUE SEK 83,000 · TOTAL COSTS SEK 84,245 · PROFIT /
LOSS -SEK 1,245 · **BREAK-EVEN TICKETS No break-even**` at 320 planned — the card no longer claims a
crossing it cannot reach. I then re-measured at a **50%** split (`PATCH /deals/…d1
{"splitBasisPoints":5000}`), which the fix has never been read at:

```
TOTAL REVENUE SEK 83,000 · TOTAL COSTS SEK 59,245 · PROFIT / LOSS SEK 23,755 · BREAK-EVEN TICKETS 132
```

By hand: `averageTicketPrice = 8,300,000/320 = 25,937`; `variableCostPerTicket = 1.5% × 25,937 = 389`;
`trulyFixedCosts = 3,300,000`. The fix's base excludes the variable cost, so
`fee(N) = 0.5 × (25,937N − 3,300,000)` and
`costs(N) = 3,300,000 + fee(N) + 389N = 1,650,000 + 13,357.5N`. Crossing: `25,937N = 1,650,000 +
13,357.5N` → `N = 131.2` → **132**. ✓ At 320: `costs = 5,924,400` → SEK 59,244, printed 59,245
(rounding), profit 83,000 − 59,245 = **23,755**. ✓ Break-even below planned attendance and profit
positive — the two tiles agree.

**QA8-4 — HOLDS at the headline.** `agent@` on `/events/…e1?tab=settlement` reads **`SEK 3,000` ·
"Your payout"**, matching the dashboard (`Outstanding SEK 3,000`), `/settlements` (`YOUR SHARE SEK
3,000`) and the workspace's `Your commission SEK 3,000`. The `SEK 0` the sweep found is gone from the
headline — **and it is still on the agent's own card two inches below it**: `Astra Booking Agency
(you) · Agent · SEK 0`. Filed as **QA9-8**, not as a regression.

**QA8-5 — HOLDS.** Spring Warmup, `operator@`:

```
The Lantern Hall (you) · Operator                        SEK 20,700
  What is left after every other party is paid           SEK 20,700
  ────────────────────────────────── (border-top: 2px) ──
  Less the money you collected on the night            − SEK 78,000
  Plus the costs you paid on the night                   SEK 10,800
```

The entitlement row above the divider sums to the headline; cash sits below it; **the SEK 10,800 is
named**, which run 8 measured as missing. Verified structurally, not by eye: the cash rows are in a
sibling block whose computed `border-top-width` is `2px` while every other row's is `0px`.

### 2.12 Run 7's eleven, re-checked at the cheap depth the brief allows

| Item | Verdict | How |
|---|---|---|
| QA7-9 split card's closing sentence | **HOLDS** | At a 50% split, `sent`: *"50% of the door. **Nobody has confirmed these terms yet, so they can still move.**"* with a `PROPOSED` badge |
| QA7-10 advance on the party card | **HOLDS** | `Paid in advance by The Lantern Hall − SEK 3,000` on Marlo's card, `− SEK 2,000` on Neon Tide's, mirror `SEK 5,000` on the operator's |
| QA7-28 headline is the reader's net, labelled by sign | **HOLDS, three directions** | `operator@` e4: `SEK 22,875 · You owe`; `co.host@` e4: `SEK 22,875 · Your payout`; `performer.a@` e1: `SEK 12,000` payable |
| QA7-13 a draft is not money | **HOLDS** | Created a `received/draft` bill, due **15 Jan 2026** (past). Tiles unmoved: `OUTSTANDING SEK 9,000 · OVERDUE SEK 9,000 · RECEIVABLE SEK 50,000`; the row renders badged **Draft** with an **Issue** button |
| QA7-19 a zero has units | **HOLDS** | `performer.a@` `/invoices`: `SEK 0 · SEK 0 · SEK 0`; `professional@` and `agent@` the same |
| QA7-14 the issued tab's first column | **HOLDS** | Received header **VENDOR**, Sent header **BILL TO**, read off the rendered header cells on one page load |
| QA7-8 no page overflow at 390px | **HOLDS** | See §5's mobile section — `scrollWidth == clientWidth == 376` on 13 destinations and 10 event-workspace routes, measured by element right edges rather than by `scrollWidth` alone |
| QA7-12 the room that is not a room | **HOLDS** (the "no room" state) | Create New Event, The Lantern Hall, **2026-10-15**, room left at "No specific room": *"Already on this night: "Marlo Vance — Album Release" in Main Room."* and **no** "still free". The per-room states were not re-driven this run |
| QA7-16 the projections footnote | **HOLDS as a fix** | The all-time line is drawn for `operator@` (5 events hosted) and **absent** for `co.host@`. Its *figure* is wrong for a different reason — **QA9-1** |
| QA7-15 the team invite dialog | not re-driven | Run 8 drove it; nothing this run touched `useTeamAccess` |
| QA7-7 the agent is told when their act is booked | **HOLDS** | Adding Marlo to Nordic Synth wrote two rows: `event.participant_added → e2e-performer-a "Added to "Nordic Synth Showcase""` and `→ e2e-agent "Marlo Vance is on "Nordic Synth Showcase""`, and the agent's participant row was created with a permission set. (The *link* on those rows is broken — **QA9-3**) |
| QA7-2 a tier raises the door and the fee | **HOLDS** | 320 tickets → `TOTAL TICKETS REVENUE SEK 83,000`, split card `49,800 / 33,200` = 83,000, and *"after them the deal pays SEK 50,000"* — which is exactly what `POST /settlement/compute` returns as the deal total |
| QA7-3 the private ledger reports its own lines | **HOLDS** | See §2.3 |
| QA7-5 an act can send an offer | **HOLDS** | `/requests` → Send an offer → the row lands in the venue's Incoming tab with `source=performer_offer`, `sender_profile_id` set, and appears on the sender's Outgoing tab |

---

## 3. Part 2 — new findings

**Counts: 4 MAJOR · 10 MINOR · 2 COSMETIC · 3 NOTE — nineteen.** No blocker — every journey
completed, though two completed only by a route the UI does not offer (QA9-3, QA9-4).

| Severity | ID | One line |
|---|---|---|
| MAJOR | QA9-1 | The host's all-time revenue figure sums the CO-HOST's private margin book, three lines under a sentence saying every figure comes from the shared ledger |
| MAJOR | QA9-2 | A represented act, a crew member, and every collaborator the app itself invites cannot post a single message on the event — no composer, no sentence, and no access level that would grant it |
| MAJOR | QA9-3 | "Open the invitation to accept or decline" links to "Event not found", and every accept route is keyed by a token only the email carries |
| MAJOR | QA9-4 | The operator's top dashboard card says to confirm a held show; nothing in the app can change an event's status, and the route that can has no caller |
| MINOR | QA9-5 | A co-promoter's own private book can never show its own margin: profit, margin and break-even are withheld because of a deal that is not one of its costs |
| MINOR | QA9-6 | "BREAK-EVEN TICKETS 0" beside "Revenue never passes total cost inside 400 capacity" on a night making SEK 5,000 |
| MINOR | QA9-7 | Both co-operators read "What is left after every other party is paid" over different fractions of the residual, and the split that produced them is never named |
| MINOR | QA9-8 | The agent's own settlement card reads SEK 0 two cards above "Your commission SEK 3,000" |
| MINOR | QA9-9 | "Fans appear here once they RSVP" over "0 contacts — No audience yet", with the RSVP row sitting in Postgres |
| MINOR | QA9-10 | Settings' "Base currency" writes the cosmetic display preference, and only one screen in the app honours it |
| MINOR | QA9-11 | "4 events budgeted" where three events have a budget, because the GET that measures coverage creates the thing it measures |
| MINOR | QA9-12 | `POST /invoices` needs only two fields, so a past-due bill with no vendor and no amount is stored and printed as "— · — · SEK 0 · Overdue" |
| MINOR | QA9-13 | A crew account keeps a Requests destination it can neither receive on nor send from, addressed to venues |
| MINOR | QA9-16 | Two DELETE routes reject a bodyless request with a 400 naming the body, while a third accepts one (detail in §5) |
| COSMETIC | QA9-14 | Two minus spacings on one settlement card, under a comment claiming the two agree |
| COSMETIC | QA9-15 | An event with no act shows its own title in the performer chip |
| NOTE | QA9-17 | A payout account typed `iban` accepts `not-an-iban`, and `currency: "XYZ"` |
| NOTE | QA9-18 | `pnpm dev` prints five of the six seeded accounts — `co.host@` is still missing from the banner |
| NOTE | QA9-19 | QA8-15's "Artist share" column header is still structurally unreachable |

---

### QA9-1 — MAJOR — The host's all-time revenue figure includes the co-host's private margin book

**As:** `operator@` (The Lantern Hall) · **Route:** `/projections`
· **Code:** `apps/api/src/routes/insights.ts:74-79`

**Steps.**
1. As `co.host@` (Northlight Presents), open the Album Release → Budget Planner → **My budget** and
   type `Other revenue` **12,345** and a `Production cost` **4,000**. (I first did this through
   `POST /events/:id/budgets/:bid/lines`; it is reproduced entirely in the browser, and the
   browser-typed version is what is quoted.)
2. As `operator@`, open `/projections` and read the panel and the footnote under it.

**Actual.** One screen, two figures ten pixels apart:

```
PROJECTED REVENUE  SEK 216,000        4 events budgeted
…
Every figure here comes from the event's shared ledger. …

All time, as host — ignoring the filter above: budgeted revenue SEK 238,345 across 5 events you hosted.
```

SEK 238,345 − SEK 216,000 = **SEK 22,345**, which is exactly the two private books on that event:
Northlight's SEK 12,345 and the operator's own SEK 10,000. Confirmed by moving one of them:
before Northlight typed anything the footnote read **SEK 226,000**; after, **SEK 238,345**; the
`api-as.mjs` reading agrees exactly.

```
$ api-as.mjs operator GET /insights/profiles/…a1/revenue
200  {"totalRevenue":"23834500","currency":"SEK"}     ← 238,345.00
$ psql: select b.scope, sum(bl.amount) from budget_lines bl join budgets b … group by 1
 shared  | 21600000      ← the 216,000 the panel shows
 private | 2234500       ← the 22,345 only the footnote carries
```

**Expected.** `PLAN.md:215` — an event has one `shared` ledger and a `private` book is *"the extra an
operator MAY ALSO keep, existing only once there is a co-host to keep it from."* The detail route
already enforces exactly that: `GET /events/:id/budgets` uses `visibleBudgetFilter`, and I verified
both directions — `coHost` sees the shared book plus **only** its own private one, `operator` sees the
shared book plus **only** its own. The aggregate contradicts the detail route it sits above, and the
screen's own sentence (*"Every figure here comes from the event's shared ledger"*) is true of the
panel and false of the line three below it.

**Actual cause, in one line.** The query filters on `events.hostProfileId` and
`budgetLines.kind = 'revenue'` and **on nothing else** — no `budgets.scope` predicate:

```ts
.from(schema.budgetLines)
.innerJoin(schema.budgets, eq(schema.budgets.id, schema.budgetLines.budgetId))
.innerJoin(schema.events, eq(schema.events.id, schema.budgets.eventId))
.where(and(eq(schema.events.hostProfileId, id), eq(schema.budgetLines.kind, "revenue")))
```

**Evidence.** `qa9-alltime-includes-cohost-private-book.png`; the two API readings; the SQL above.

**Scope.** Every operator hosting any co-promoted event. `GET /insights/profiles/:id/revenue` has
exactly one consumer (`Projections.tsx:117`), so one screen leaks; `…/summary` alongside it counts
events and is unaffected. **The settlement does not leak** — recomputed with both private books
present, `ladder.revenue` stayed `8300000` and `costs` `3300000`, and Σ net = 0.

**The one-line fix, for the report only.** Add `eq(schema.budgets.scope, "shared")` to that `where`.
`projectFromBudgets` in the web already does the equivalent (`budgets.filter(b => b.scope ===
"shared")`), which is why the panel is right and the footnote is not.

---

### QA9-2 — MAJOR — A represented act, a crew member and every collaborator the app invites are silently mute on the event

**As:** `performer.a@`, `professional@`, `performer.b@` · **Route:** `/events/$eventId?tab=messages`
· **Code:** `packages/auth/src/presets.ts:303-323` (`DELEGATED_PERFORMER_FLOOR`), `:286-291`
(`CREW_FLOOR`), `:78/:113/:139` (`message.post` lives only in the three presets)

**Steps and the contrast that makes it airtight.** Two performers, the same event, the same
`performer` role; one is represented by an agent and one is not.

```
performerA POST /events/…e1/messages {"visibility":"party","threadParticipantId":<Marlo>}
  403  "Missing capability: message.post"
performerB POST /events/…e1/messages {"visibility":"party","threadParticipantId":<Neon Tide>}
  201
teamAndCrew POST /events/…e1/messages {"visibility":"party","threadParticipantId":<Priya>}
  403  "Missing capability: message.post"
```

And `GET /events/…e1/message-threads` says the same thing before you try:

```
performerA   all: canPost false | party:Marlo   canPost false
performerB   all: canPost true  | party:NeonTide canPost true
teamAndCrew  all: canPost false | party:Priya   canPost false
```

**In the browser, and this is the part that makes it a finding rather than a rule.** On
`?tab=messages`:

- `performer.b@` has `<input placeholder="Message Everyone…">` and a **Send** button.
- `performer.a@` has **no input and no Send**, and **no sentence anywhere saying why** — the screen
  reads *"Everyone · Read by everyone on this event"* over the thread and stops.
- `professional@` the same: threads listed (including one titled with their own name), no composer,
  no explanation.

**And it reaches everyone the app itself onboards.** I invited `performer.b@` to a new event through
**Invite Collaborator** at the default access. The dialog's ACCESS control is **not rendered at all**
for a `Performer` role, and the row-actions menu says why: *"Only a co-operator can be granted more
than their role's own access."* The accept path copies `invitation.permissionSetId`, which is null, so
the participant lands on the bare floor:

```
 event_participants: Neon Tide | performer | accepted | permission_set_id NULL
 POST /events/<new>/messages as performerB → 403 "Missing capability: message.post"
 browser: no input, no Send, "Nothing has been said in this conversation yet."
```

So on the seeded events messaging works only because the **seed** attaches `Performer — own slice`
(`permission_sets.c2/c3`); on any event the app creates it does not.

**Expected.** `DELEGATED_PERFORMER_FLOOR`'s own docstring states the rule it is built on: *"they keep
their VIEW floor plus artistic authorship — the BUSINESS action capabilities (confirm/approve) move to
the agent. **Delegation, not revocation**."* Posting a message is neither business authority nor
artistic content, so by that rule it should not move — and for crew and for a default invite there is
no delegation at all, so nothing explains it. `story.md`'s crew boundary is about the **budget**
(*"They see the schedule and their own deal, never the budget"*), not about talking to the operator
about load-in.

**Evidence.** The three API calls with their messages (not their statuses); the `canPost` triple; the
three browser readings; the empty ACCESS control; the NULL `permission_set_id`.

**Scope.** Every represented act on every in-region event, every crew member, and every performer,
support act, crew lead or crew invited through the app. The two operator seats and `performer.b@` on
the seeded events are the only accounts that can speak.

**Two candidate fixes, for the report only.** Either add `message.post` to `PERFORMER_FLOOR`,
`DELEGATED_PERFORMER_FLOOR` and `CREW_FLOOR` (which is what "you see your slice and you can answer
about it" means), or — if muteness is deliberate — render the refusal: the crew's Poster card already
does it well (*"Only the profile operating this show can change its poster."*), and `canPost` is
already on the wire for the UI to read.

---

### QA9-3 — MAJOR — The invitation bell says "accept or decline" and lands on "Event not found"

**As:** `performer.b@`, then `performer.a@` · **Routes:** `/` (bell) → `/events/$eventId`
· **Code:** `apps/api/src/routes/invitations.ts:641-651`

**Steps.**
1. As `operator@`, **Invite Collaborator** on a new event → `performer.b@`, role Performer, Send
   invite. The toast is honest: *"They get an email with a join link… nothing is granted until they
   do."*
2. As `performer.b@`, open the bell. It reads:

> **The Lantern Hall (operator) invited you to collaborate** · just now
> **Open the invitation to accept or decline.** · by The Lantern Hall (operator)

3. Click it.

**Actual.** It navigates to `/events/a17af8a8-…` and the page reads, whole:

```
Couldn't load this event

Event not found
```

`GET /events/a17af8a8-…` as `performerB` → **404 `{"code":"not_found","message":"Event not found"}"`,
which is correct — nothing is granted until they accept. The link is the problem, not the refusal.

**And there is nowhere else to answer.** Every accept/decline route on `invitations.ts` is keyed by
the **token**: `/invitations/:token`, `/invitations/:token/accept`, `/invitations/:token/decline`,
`/invitations/:token/claim`. `GET /profiles/:id/invitations` lists the ones a profile has **sent**.
There is no "invitations addressed to me" read. The landing page itself is fine — I completed the
journey by pulling the token out of Postgres:

```
/invitations/f758f0db…  →  "Do you accept? … Accept | Decline"  →  "You are in" → Open the event ✓
```

so the only working path is the emailed link.

**Expected — and the code states the expectation itself, which is what makes this a bug.** The
comment beside the link says: *"Not the token link: the recipient is signed in already, and the event
(or the team screen) is where the invitation is answered."* The event is not where it is answered; the
event is a 404 until it has been answered.

**Second instance, on a different emitter.** `POST /events/:id/participants` adding Marlo Vance to
Nordic Synth wrote `event.participant_added → e2e-performer-a  "Added to "Nordic Synth Showcase""`
with the same `/events/:id` link. As `performer.a@` that page reads **"Couldn't load this event —
Event not found"** (`qa9-act-notified-of-event-it-cannot-open.png`), and their own inbox is empty:

```
performerA GET /me/event-invitations  →  200  []
agent      GET /me/event-invitations  →  200  [{ "title":"Nordic Synth Showcase", "status":"invited" …}]
```

The invitation routes to the **agent** (correct under decisions #14 — the agent's `/requests` shows
the card with **Accept** and **Decline**, verified). But the act is told about it, cannot open it and
cannot answer it. Either the act should not get that row, or its link should go somewhere they can
read.

**Evidence.** `qa9-invitation-bell-dead-end.png`,
`qa9-act-notified-of-event-it-cannot-open.png`; the 404 with its message; the route list; the two
`/me/event-invitations` responses.

**Scope.** Every event invitation to an address that already has an account — which is the ordinary
case for a collaborator, and the case the notification was added for. The participant-added variant
hits every represented act.

**The one-line fix, for the report only.** The notification already carries
`metadata.invitationId`; point `link` at the landing page instead of the event. For
`event.participant_added`, link to `/requests`, where `useEventInvitations` already renders the
Accept/Decline card.

---

### QA9-4 — MAJOR — "Confirm Nordic Synth Showcase … needs a decision", and nothing in the app can

**As:** `operator@` · **Routes:** `/` → `/events/e2e00000-0000-4000-8000-0000000000e4`
· **Code:** no `status` caller exists in `apps/web/src`

**Steps.**
1. Sign in as `operator@`. The **first** card in "things that need attention today" reads
   **`Confirm Nordic Synth Showcase · On hold · 4 Dec 2026 · needs a decision · Review`**.
2. Click **Review**. It lands on the event workspace.
3. Enumerate every control the workspace offers. All of them:
   `Invite Collaborator`, `Share & Export`, **`Promote to 1st` (disabled)**, `Release hold`,
   the ten tabs, `Publish` (disabled), `Upload`, `Load starting point`, `Save as template`,
   `+ Add`, `Sync from Ticketing Company`, `+ Add ticket type`. **There is no Confirm.** The
   `Suggested / On hold / Confirmed / Concluded` strip is a step indicator, not buttons — the
   enumeration contains no button named `Confirmed`.
4. Try the row-actions menu on `/events` (List and Board): `Settlement`, `Cancel show…`, `Archive`.
   No Confirm there either.

**Actual, at the API.** The hold route refuses the operator for a stated and correct reason:

```
operator POST /events/…e4/hold/confirm {}
  403 "Only the booked performer, or their agent, can confirm or decline this hold"
```

and `GET /events/…e4/hold` returns `canDecide: false` for the host, which `holds.ts:51-54` explains
deliberately (*"`operator_full` carries `agreement.confirm`, and the host is still never the act"*).
But there **is** an operator path, and it works:

```
operator PATCH /events/…e4 {"status":"confirmed"}   →  200  "status":"confirmed"
```

and it has **no caller in the web app**. Every `usePatchApiV1EventsId` call site sends `extras`, the
venue link, or an inline detail field; `grep` for a `status:` in a mutation body across
`apps/web/src` returns only badge-tone maps. So the whole event-status ladder — `suggested → on_hold
→ confirmed → concluded` — is unreachable from the app in the operator's direction, while the
dashboard's most prominent card instructs them to walk it.

**Expected.** A dashboard card in a list headed *"things that need attention today"*, whose verb is
*Confirm* and whose button is *Review*, must land somewhere the reader can confirm. This is the
shape the loop has filed seven times (a mechanism with no caller), here with a nag attached: the
only way to clear the card is **Release hold**, which is the opposite decision.

**Evidence.** The button enumeration on the destination; the two API calls with their messages; the
row-actions menu; the grep. The state was restored (`PATCH … {"status":"on_hold"}` → 200).

**Scope.** Every on-hold event an operator hosts. It is worse where the event has no act at all (the
seeded Nordic Synth Showcase has none), because then no `hold/confirm` caller exists on any seat
either — I added Marlo as a performer and the act's own row landed `invited`, so `canDecide` stayed
`false` for everyone until the agent accepts.

---

### QA9-5 — MINOR — A co-promoter's private book can never show its own margin

**As:** `co.host@` · **Route:** `/events/…e1?tab=budget&budgetScope=mine`

**Steps.** Type `Other revenue` 12,345 and `Production cost` 4,000 on Northlight's **My budget** for
the Album Release. Read the KPI row and the Results card.

**Actual.**

```
TOTAL REVENUE SEK 12,345 · TICKET REVENUE SEK 0 · TOTAL COSTS (PARTIAL) SEK 4,000
TICKETS PLANNED 0 · REVENUE / GUEST SEK 12,345

One of this event's deals is not shown to you, so what the night costs is higher than the total
above. Profit, margin and break-even are left out rather than calculated without it.
```

No `PROFIT / LOSS`, no `PROFIT MARGIN`, no `BREAK-EVEN TICKETS` — confirmed by searching the whole
`main` innerText for each string.

**Expected.** `PLAN.md:215` — a private book is the operator's **own** extra ledger. The performer fee
on the shared ledger is not one of its costs, so the sentence is untrue of the page it is printed on:
"the total above" is Northlight's own SEK 4,000, and the SEK 25,000 deal is nowhere in it. The
withholding rule is right where it was written (QA4-5: a **shared** ledger missing a fee must not
compute a profit) and it has been applied one scope too wide.

**The asymmetry that shows it.** The **host's** private book on the same event, same run, reads
`TOTAL COSTS SEK 0 → SEK 5,000` with **`PROFIT / LOSS SEK 5,000`** printed — because the host can see
the deal, so `costsIncomplete` is false. So the only operator whose private book can never show a
margin is the one the private book exists for.

**Evidence.** `qa9-cohost-private-book-no-margin.png`; the host's own private book in
`qa9-private-book-full.png`.

**Scope.** Every co-operator who is not a party to an event's deal — which is the ordinary case, since
the deal composer defaults to payer + payee (QA8-11).

---

### QA9-6 — MINOR — "BREAK-EVEN TICKETS 0" beside "Revenue never passes total cost"

**As:** `operator@` · **Route:** `/events/…e1?tab=budget&budgetScope=mine`
· **Code:** `packages/shared/src/break-even-chart.ts:215` vs `packages/shared/src/budget-planning.ts:532`

**Steps.** On a private book, type `Other revenue` **10,000** and a `Production cost` **5,000** — a
sponsor-funded night, costs covered before a ticket sells.

**Actual, one card:**

```
TOTAL REVENUE SEK 10,000 · TICKET REVENUE SEK 0 · TOTAL COSTS SEK 5,000
PROFIT / LOSS SEK 5,000 · BREAK-EVEN TICKETS 0
…
BREAK-EVEN ANALYSIS
Revenue never passes total cost inside 400 capacity.
```

and the chart's `aria-label` carries the same sentence, so the reader who cannot see it gets it too.
A night SEK 5,000 up, which the tile correctly reports as needing **0** tickets, is described by the
caption beside it as never breaking even.

**Expected.** The engine already distinguishes the two cases and says so in as many words
(`budget-planning.ts:528-532`): *"`uncovered <= 0` is a true zero … it is the one case where
`breakEvenTickets === 0` means 'none needed' rather than 'never'"* — and it exports
`breakEvenReachable` for exactly that. The KPI tile reads it
(`budgetPlannerView.ts:687`). **The chart does not:** `BudgetBreakEvenChart` branches on
`chart.hasBreakEven`, which is `breakEvenAt > 0 && breakEvenAt < capacity` — false at zero. A computed
field with no caller on the one surface that contradicts it.

**Evidence.** `qa9-breakeven-never-on-a-profitable-night.png`; the `aria-label` read off the SVG; the
two predicates.

**Scope.** Any book whose standing revenue covers its entered costs, and every empty book (where the
seeded private ledger reads `BREAK-EVEN TICKETS 0` against the same caption with zero clicks).

---

### QA9-7 — MINOR — Two co-operators, one sentence, two different fractions of "what is left"

**As:** `operator@` and `co.host@` · **Route:** `/events/$eventId?tab=settlement`
· **Code:** `apps/web/src/components/settlementDocument.ts:566-571`

**Steps.** Set `planning_assumptions.operatorCostSplit` to **25 / 75** (host / co-host) on a shared
budget and compute. Read both operators' cards.

**Actual, on the Album Release** (residual SEK 25,000 after a 50% deal):

| Seat | Card |
|---|---|
| `operator@` | `The Lantern Hall (you) · Operator · SEK 6,250` over *"What is left after every other party is paid  SEK 6,250"* |
| `co.host@` | `Northlight Presents (you) · Co-operator · SEK 18,750` over *"What is left after every other party is paid  SEK 18,750"* |

Reproduced on Nordic Synth Showcase (residual SEK 30,500): **SEK 7,625** and **SEK 22,875**, same
sentence on both. In every case what is actually left is the sum, and neither number is it.

**Expected.** The engine is right — `reconcile.ts:233` weights the residual by
`operatorResidualShare` and `allocate` splits it exactly; Σ net = 0 on all three computes, and
7,625 + 22,875 = 30,500 = `adjustedNet` by hand. The **label** names the residual and the number is a
share of it. The app already has the vocabulary: the Budget Planner's own control is *"Production
costs split — For co-promotions. Agree once how the operators share everything the event carries —
and the profit it leaves."* The settlement never mentions it. `settlementDocument.ts:569` is one
unconditional string with no co-operator branch, and the breakdown does not carry the weight back, so
the screen cannot name it without reading the budget's assumptions.

**Evidence.** `qa9-cohost-residual-label.png`; the two card readings on two events; the engine
output (`b9 resid 762500`, `c0b513 resid 2287500`, `sum net 0`).

**Scope.** Every co-promoted event with a non-zero residual.

---

### QA9-8 — MINOR — The agent's own card reads SEK 0 two cards above "Your commission SEK 3,000"

**As:** `agent@` · **Routes:** `/events/…e1?tab=settlement` and `/events/…e1/settlement`
· **Code:** `apps/web/src/components/settlementDocument.ts` (the party card) vs `EventSettlementTab.tsx`

**Actual.** QA8-4's fix moved the headline; the card it sits over did not move with it. One screen:

```
SETTLEMENT
SEK 3,000            ← the headline, correct, QA8-4's fix
Your payout
…
Marlo Vance · Performer · SEK 30,000
  100% of the adjusted net — Marlo Vance's 60% of the deal's SEK 50,000   SEK 30,000
  Paid in advance by The Lantern Hall                                   − SEK 3,000
Astra Booking Agency (you) · Agent · SEK 0      ← no rows at all
```

and in the workspace, the same `SEK 0` card with `Total Payouts → Your commission SEK 3,000` and a
dedicated `AGENT COMMISSION` card below it.

**Expected.** QA8-4's own argument, one level down: *"SEK 0 is not a figure the agent can act on."*
The payload the screen already has carries `commissions[0].commission`, and the four other surfaces
(dashboard, `/settlements`, the tab headline, Total Payouts) all say SEK 3,000. A card that prints
`SEK 0` with no explanatory row is the one place the reader is told they earned nothing.

**Evidence.** `qa9-agent-headline-3000-card-0.png`; the workspace text in full. Reproduced after the
split changed: headline `SEK 1,500`, card `SEK 0`, commission card `SEK 1,500`.

**Scope.** Every agent on every event they earn on. The agent's event `net` genuinely is 0 — the
commission is a representation-scoped settlement with a null `participantId` — so the fix is the same
overlay `GET /settlements` already does and says it does.

---

### QA9-9 — MINOR — "Fans appear here once they RSVP", over "0 contacts · No audience yet"

**As:** an anonymous fan, then `operator@` · **Routes:** `localhost:5173/event.html?event=…e1`,
`/audience` · **Code:** `apps/api/src/routes/public.ts:645`

**Steps.** RSVP as `QA9 Fan / qa9fan@e2e.showme.test / Gothenburg`. Then open `/audience` as the
operator of that event.

**Actual.** The row exists (§2.7). The screen reads, whole:

```
Audience
0 contacts across ticket buyers, newsletter and socials.
No audience yet
Fans appear here once they RSVP or buy tickets — segmented by city, tier and source.
```

**Expected.** The sentence is a promise about the data, and a real RSVP is sitting in the table
falsifying it. `audienceRsvps` appears exactly **once** in `apps/api/src` and **zero** times in
`apps/web/src`: the insert, and no reader.

```
$ grep -rn "audienceRsvps" apps/api/src apps/web/src | grep -v '\.test\.'
apps/api/src/routes/public.ts:645:        await database.insert(schema.audienceRsvps).values({
```

**Scope.** Every RSVP. Run 8 filed the inbox half of this and it is fixed; this half is what is left,
and it is now demonstrably false rather than merely unbuilt. If the read is not coming soon, the
honest empty state is *"RSVPs are collected but not shown here yet"* — the Payout tab's tone
(QA8-16), not a promise.

---

### QA9-10 — MINOR — "Base currency" in Settings is the cosmetic display preference, and one screen honours it

**As:** `operator@` · **Routes:** `/settings` → General, then `/`, `/settlements`, `/invoices`,
`/projections`, `/events/…e1?tab=budget` · **Code:** `apps/web/src/routes/Settings.tsx:208-213,
220-227`; `apps/web/src/hooks/useDisplayCurrency.ts`

**Steps.** Set Settings → General → **BASE CURRENCY** to `EUR`, Save changes (toast: *"Organization
updated"*). Then read every money screen.

**Actual.**

| Screen | Honoured? | Read |
|---|---|---|
| `/events/…e2/settlement` | **yes** | `≈ €6,731 · − ≈ €777 · ≈ €5,955`, with the preview banner |
| `/` (dashboard) | no | `SEK 0 · SEK 0 · SEK 34,575 · SEK 20,700` |
| `/settlements` | no | `SEK 34,575 · SEK 20,700` |
| `/invoices` | no | `SEK 9,000 · SEK 50,000` |
| `/projections` | no | `SEK 216,000 · SEK 68,300 · SEK 147,700` |
| Budget Planner | no | `SEK 83,000 …`, and its own "View in…" chooser still shows `SEK` |

**Two things are wrong and they are separable.**

1. **The label names the wrong measure.** The control writes `users.currency`, which
   `useDisplayCurrency` reads as the **display** preference — *"It is COSMETIC and stays cosmetic
   (`docs/money.md`, PLAN.md): the payout currency on a deal is authoritative."* Calling it **Base
   currency** in Settings is the name this product gives the *authoritative* currency of an event and
   a deal (`events.base_currency`, `deals.currency`). A user changing it has every reason to believe
   they are changing what is owed.
2. **One caller.** `useDisplayCurrency` has one consumer, `EventSettlement.tsx:92`. Its own docstring
   says *"Every money screen kept its own `useState("")` … This is the hook that makes the preference
   mean something."* It means something on one of the six money screens.

**Evidence.** The table above, all six read in one pass after one save. Reverted afterwards
(`PATCH /me {"currency":"SEK"}` → 200).

**Scope.** Every account. Nothing settled moved — the settlement workspace's figures are a labelled
preview and `settlements.computed` was unchanged, which is the one thing that had to be true.

---

### QA9-11 — MINOR — "4 events budgeted" where three events have a budget

**As:** `operator@` · **Route:** `/projections`
· **Code:** `apps/api/src/routes/budget.ts:668-670`; `apps/web/src/routes/Projections.tsx:74, 150-153`

**Actual.** The panel reads `PROJECTED REVENUE SEK 216,000 · **4 events budgeted**` and the table
below lists four, one of which is `Open Mic Wednesdays · SEK 0 · SEK 0 · —`. That event has no budget
lines at all. The caption should read *"3 of 4 events budgeted"* and the screen should carry
`partialCoverageNote` — *"Figures cover the 3 of 4 events in this view that have a budget — 1 event
has none yet, so they show as —."*

**Why it cannot.** `GET /events/:id/budgets` **provisions a shared budget on read**:

```ts
// Give the caller's operating profile its budget if it has not got one.
await ensureEventBudgets(database, id, callerProfileIds(request));
```

The Projections screen fires exactly that GET once per event (`useQueries` over `eventItems`), so the
act of measuring coverage creates full coverage. Before the sweep the `budgets` table held rows for
e1, e2 and e4; after one visit it held rows for **e3 and e5 as well**, both `shared` with zero lines:

```
 daa3cd0f… | …e3 | shared |          ← created by my page load
 947cb9f2… | …e5 | shared |          ← created by my page load
```

`hasBudget` is `budgets.filter(scope === "shared").length > 0`, so an empty provisioned budget counts,
`isPartial` is false, and `partialCoverageNote` / `noBudgetDescription` are dead for any host who has
ever opened the screen.

**Expected.** The mechanism's own docstring: *"a figure summed over the budgeted subset must never be
captioned with the matched count, or the card claims to describe events it silently left out."* The
lazy provisioning is deliberate and documented; its effect on this caption is not.

**Scope.** Every host. It is **not** dead for a co-host: `co.host@`'s Projections correctly reads
`SEK 83,000 · 1 of 2 events budgeted`, because their GET on the co-promoted event answers **403** and
never provisions. That 403 is the only non-2xx response any seat produced in the whole run, and it is
an expected refusal.

**One-line fix, for the report only.** Count an event as budgeted only when its shared budget has at
least one line (`projectFromBudgets` already knows), or provision on first write rather than on read.

---

### QA9-12 — MINOR — A past-due bill with no vendor and no amount, printed as "SEK 0 · Overdue"

**As:** `operator@` · **Route:** `/invoices` · **Code:** `apps/api/src/routes/invoices.ts:21-41, 43-52`

**Steps.**

```
POST /invoices {"ownerProfileId":"…a1","direction":"received","status":"draft",
                "counterpartyName":"QA9 Draft Vendor","amount":"777700",
                "currency":"SEK","category":"production","dueDate":"2026-01-15"}
201
```

Then read the row in Postgres, and on screen.

**Actual.** The 201 stored:

```
 id c5c2406c… | direction received | issuer_ref NULL | total NULL | due_date 2026-01-15 | state draft
```

`counterpartyName`, `amount` and `category` were all silently stripped — none of them is a key
`CreateInvoiceBody` has (`total` is the amount; the counterparty is `issuerRef`/`recipientRef`; there
is no `category`). `total` is `z.string().regex(/^-?\d+$/).optional()` and the same `moneyString` is
reused for `UpdateInvoiceBody`, so the row then advanced state with no amount:

```
PATCH /invoices/c5c2406c… {"state":"sent"}   →  200      total still NULL
```

and the list renders it as a live liability:

```
VENDOR  EVENT / REFERENCE  CATEGORY  DUE          AMOUNT   STATUS
—       —                  —         15 Jan 2026  SEK 0    Overdue
```

**Expected.** This is the exact shape run 8 filed as QA8-10 and the loop closed on `payout_accounts`,
quoting its own reasoning: *"Every ingredient of a silent data loss: an optional field, a plausible
wrong key, and a success response."* `POST /invoices` has all three, plus a second: `SEK 0` asserts an
amount of zero where the column is NULL, and the same screen uses `—` for unknown three columns to
the left.

**Mitigating, and why this is MINOR.** The **tiles are right** — `OUTSTANDING SEK 9,000` and
`OVERDUE SEK 9,000` did not move when the amountless bill went `sent` and past due, so the money
totals ignore a null total. QA7-13's fix is unharmed. Only the row lies.

**Scope.** Any caller that is not the app's own dialog. Left behind in the seed — see §5.

---

### QA9-13 — MINOR — A Requests destination a crew account can neither receive on nor send from

**As:** `professional@` · **Route:** `/requests`

**Actual.** Both tabs render, with copy addressed to someone else:

```
Incoming:  "Incoming Requests — Manage booking requests from artists, agents, and venues."
Outgoing:  "Outgoing Requests — Offers and requests you have sent, and where they stand."
```

The reader is none of *artists, agents or venues*; `POST /offers` now refuses them by account kind
(QA8-6, correctly), so nothing can ever appear on Outgoing; and `booking_requests.target_profile_id`
is only ever a venue in the send path, so nothing can appear on Incoming either. The
**Send an offer** button is correctly gone — the destination it served is not.

**Expected.** The brief's own rule: *"a nav entry a kind should not have is a finding."* The app is
already good at this elsewhere — `/reports`, `/projections`, `/setlists` and `/audience` are all
absent from the crew sidebar and answer with a reason and no stub when reached by URL (*"An audience
belongs to the room and to the act…"*). Requests is the one that kept the entry after the capability
was removed.

**Scope.** Every `team_and_crew` account. The marketplace `story.md` describes runs the other way
(*"operators/performers post jobs and team-and-crew members apply"*) and is unbuilt, so this screen
has no content in either direction today.

---

### QA9-14 — COSMETIC — Two minus spacings on one settlement card, under a comment claiming they agree

**As:** `operator@` · **Route:** `/events/…e1/settlement` → Settlement
· **Code:** `apps/web/src/components/SettlementLinePreview.tsx:78` vs
`apps/web/src/components/SettlementPartyCard.tsx:132` / `EventSettlement.tsx:1009`

Read as codepoints off one `innerText`, one scroll position, and both forms are inside the **same**
"Revenue & deductions" card — its line items on top, its own summary rows below:

```
"−SEK 12,000"    [8722, 83, 69]   ← line item, no space
"−SEK 9,000"     [8722, 83, 69]
"−SEK 8,500"     [8722, 83, 69]
"−SEK 3,500"     [8722, 83, 69]
"− SEK 33,000"   [8722, 32, 83]   ← the same card's Deductions row, with a space
"− SEK 83,000"   [8722, 32, 83]
"− SEK 3,000"    [8722, 32, 83]
```

QA8-12's glyph fix holds — U+2212 everywhere, the hyphen is gone. The spacing is still two ways, and
the comment at `SettlementLinePreview.tsx:71-74` claims otherwise: *"A cost is drawn as the
subtraction it is, in the same red the waterfall's deduction row uses, **so the two agree about what a
negative figure looks like on this screen**."* They do not — one inserts `${"−"} ` and the other
does not. `− ${value}` appears at three call sites; the bare `−` at one.

**Evidence.** `qa9-minus-spacing-two-ways.png` and the codepoints above.

---

### QA9-15 — COSMETIC — An event with no act shows its own title in the performer chip

**As:** `operator@` · **Route:** `/events/$eventId`

Create an event with no **PERFORMER PROFILE** linked. The workspace header reads
`QN  QA9 Regression Night  ·  TH  The Lantern Hall`, the first chip being the slot that holds the act
on every other event (`MV Marlo Vance · TH The Lantern Hall`), while Event Information two inches
below reads `Performer —` and the Event Details tab says `PERFORMERS — No performers added yet.` The
header invents an act from the event's own name.

---

### QA9-17 — NOTE — A payout account typed `iban` accepts `not-an-iban`, and `currency: "XYZ"`

QA8-10's fix made `identifier` required, which was the finding. Nothing checks it against `type`, and
`currency` is a bare `z.string().optional()`:

```
POST /profiles/…a1/payout-accounts {"type":"iban","identifier":"not-an-iban","currency":"SEK"}   201
POST /profiles/…a1/payout-accounts {"type":"swish","identifier":"0701234567","currency":"XYZ"}   201
```

Recorded as a NOTE rather than a finding because `payout_accounts` still has no caller in either
front end (QA8-16) — but the route's own comment names the reason it matters now: *"the first caller
will be written against whatever this accepts."* Worth contrasting with `/invoices`, where run 6's
QA6-17 fix rejects `XYZ` in the dialog. Rows deleted afterwards.

---

### QA9-18 — NOTE — `pnpm dev` still prints five of the six seeded accounts

**Code:** `scripts/dev-emulator.mjs:43-52`, and the file's own header comment at `:3`.

The seeder prints all six and the auth emulator creates all six:

```
  operator      operator@e2e.showme.test       → The Lantern Hall
  …
  operator      co.host@e2e.showme.test        → Northlight Presents   ← line 27 of the log
  agent         agent@e2e.showme.test          → Astra Booking Agency
```

The "Local dev ready" banner twenty lines later lists **five**, and `co.host@` is not among them. The
list is a hand-copy that says it is a copy (*"Mirror of packages/shared/src/e2e-accounts.ts (the
source of truth)"*) and has drifted from it; the file's header says *"the **five** seeded test
accounts"*. `api-as.mjs` had exactly this bug and its fix carries the note (*"It was missing here
while it existed in the seed, so any probe naming it died on INVALID_EMAIL"*) — `dev-emulator.mjs` is
the same mirror, unfixed. This is the mechanical reason the co-host seat kept going undriven, which is
the seat that produced **QA9-1** and **QA9-5** this run.

---

### QA9-19 — NOTE — "Artist share" is still unreachable

`Settlements.tsx:153` is `isOperator || isSingleProfile ? "Your share" : "Artist share"` and
`isSingleProfile` is `session.memberships.length === 1`. Measured:

```
select user_id, count(*) from profile_members group by user_id;   → 1 for all six
```

so all six seats read **YOUR SHARE** and the other branch was not driven. Unchanged from QA8-15.

---

## 4. What passed — walked, and correct

**The money spine. Five computes, all hand-checked to the minor unit, all balancing.**

- **Album Release with a SEK 5,000 advance, 100% deal.** Revenue 83,000 − costs 33,000 = adjusted net
  50,000. 60/40 → 30,000 / 20,000. The advance settles as cash held and divides by the same weights:
  Marlo 3,000, Neon Tide 2,000, operator −5,000. Nets **−45,000 / +27,000 / +18,000, Σ = 0**;
  transfers 27,000 + 18,000 = 45,000. Every figure on screen matches the engine's JSON.
- **The same event after `splitBasisPoints → 5000` and a 25/75 operator split.** Adjusted net 50,000;
  deal takes 25,000; Marlo 60% = 15,000, Neon 40% = 10,000; residual 25,000 split 6,250 / 18,750.
  `6,250 + 18,750 + 15,000 + 10,000 = 50,000` ✓. Nets −38,750 / +12,000 / +8,000 / +6,250 / +18,750,
  **Σ = 0**, three transfers summing to 38,750.
- **Nordic Synth Showcase, 25/75, no deal.** 55,000 − 24,500 = 30,500 → 7,625 / 22,875, **Σ = 0**, one
  transfer of 22,875. `operatorCostSplit` lands exactly where the arithmetic says.
- **Spring Warmup (finalized).** 78,000 − 9,000 = 69,000; 70% = 48,300 beats the SEK 18,000
  guarantee; less SEK 1,800 `Artist hotel` = **46,500**, the figure decisions.md #24.1 predicts in
  writing. Operator residual 20,700, collected 78,000, paid 10,800, net −46,500, **Σ = 0**.
- **The representation commission tracks the deal.** After the split halved, `commissionableIncome
  1,500,000 → commission 150,000` — 10% of SEK 15,000 — and the performer's own card reads
  `payout SEK 12,000` with `Commission to Astra Booking Agency SEK 1,500` beside it.

**The private book stays out of the reconciliation.** With SEK 10,000 + SEK 12,345 of private revenue
and SEK 9,000 of private cost on the event across two operators' books, `POST /settlement/compute`
returned `ladder.revenue 8300000 · costs 3300000` — unchanged — and Σ net = 0. `copyBudgetOnce` copies
the shared budget and only the shared budget, and I confirmed by `budgets.scope` that every line I
typed landed in the book I typed it in (host's private → `owner_profile_id a1`, co-host's private →
`a6`, neither in `shared`).

**Private books are scoped at the detail route, both ways.** `GET /events/…e1/budgets` as `coHost`
returns the shared book + **only** Northlight's private one; as `operator`, the shared book + **only**
The Lantern Hall's. Neither sees the other's. (The aggregate does — QA9-1.)

**Realtime, with two genuinely independent browsers.** `performer.b@` typed *"QA9 realtime from Neon
Tide"* into the composer in one browser; it appeared in `operator@`'s already-open Messages tab in the
other **without a reload**, and the operator's bell moved from 1 unread to 5. The message notification
carries the night and the speaker and no text.

**The known realtime gap is confirmed, not re-discovered.** With `operator@` watching the Budget
Planner, `PATCH /deals/…d1 {"splitBasisPoints":5000}` landed on the server and the screen did not
move for 5 seconds: still `100% of the door`, still `the deal pays SEK 50,000`, still
`Performer fee SEK 50,000`. A reload showed all of it: `30% Marlo / 20% Neon / 50% The operators`,
`DOOR SPLIT · PROPOSED`, `Performer fee SEK 25,000`, `TOTAL COSTS SEK 59,245`, `BREAK-EVEN 132`. So
the server and the engine are right and `useRealtimeStream` invalidates neither the deal nor the
budget nor the settlement query — exactly the shape the brief describes.

**Send-for-review reaches the other side.** `POST /events/…e1/settlement/status
{"status":"pending_review"}` → 200, `updated: 6`, five `settlement.pending_review` notifications (the
actor excluded), and `performer.a@`'s bell showed **1 unread** with the workspace reading
`Pending review` and their own correct figures.

**Party scoping held everywhere it was tested.**

- `performer.a@` on a 60/40 split sees **only** Marlo's card — never Neon Tide's line, never the
  operator's takings, and the Revenue & deductions card is a refusal with a reason (*"The night's
  takings and costs are the operator's view of this event."*).
- `co.host@` sees the shared ladder with `TOTAL COSTS (PARTIAL)` and a stated reason, and their own
  settlement card only.
- `professional@` gets a refusal with a reason on every money surface and has **no Budget Planner tab
  at all**.
- The Curate panel's default is closed: *"Marlo Vance — IN THEIR SETTLEMENT: Nothing yet — this party
  sees no figures at all"*, and Marlo's own Revenue & deductions card is correspondingly empty.
- `co.host@` on `?tab=deals`: *"Not your deal to see."*

**Boundaries and delegation.**

- `performer.a@` (represented) `POST /deals/:did/confirm` → **403 "Missing capability:
  agreement.confirm"**; the **agent** signing the same line → **200**, and the deal reached
  `confirmed`. decisions #14's delegation works in both halves.
- The Approval Status card follows it: Marlo's own copy shows `Pending` with **no Approve button**;
  the agent's copy shows **Approve** for both Marlo's line and their own.
- `operator@` `POST /events/…e4/hold/confirm` → **403 "Only the booked performer, or their agent, can
  confirm or decline this hold"** — the right refusal for the right reason.
- The collaborator Edit dialog offers a **performer** only the role, and the menu says why: *"Only a
  co-operator can be granted more than their role's own access."*
- Changing a role changes the capability, checked by the message it produces rather than the status:
  `performer.b@` posted fine as `performer`; after the UI role change to `Crew`, the same call on the
  same event → **403 "Missing capability: message.post"**.
- A co-host added through the API lands `accepted` at once (QA6-7) while a performer lands `invited` —
  correct, and the invite dialog states the co-operator default in plain words.

**Event creation and the workspace.** Created `QA9 Regression Night` end to end through the two-step
dialog, with the double-booking warning firing correctly on the room choice. All **ten** workspace
tabs render with real data or an honest empty state, `?tab=` is written for nine of them (Event
Details is the default and writes none), and there were **zero console errors and zero non-2xx
responses** across the whole walk.

**Console and network across the whole run: clean.** Six accounts × every destination they are
offered (14 + 14 + 11 + 13 + 11 + 13), measured with a `console.error` hook, `window.onerror`, an
`unhandledrejection` listener and a `fetch` wrapper installed before each walk: **zero console errors,
zero unhandled rejections, and one non-2xx** — the expected `403 GET /events/…e4/budgets` on
`co.host@`'s `/projections`.

**Mobile, 390px, by looking rather than by a metric that cannot fail.** Chrome will not size a window
below 500px, so the walk ran inside a 390px iframe (`innerWidth 386`) and measured **every element's
right edge**, not just `scrollWidth`:

- 13 sidebar destinations: `documentElement.scrollWidth == clientWidth` (376, or 386 on `/reports`)
  and **zero elements overhanging the viewport**.
- 10 event-workspace routes: the same, with six elements past the edge on nine of them — all of them
  the **tab strip**, whose container is `overflow-x: auto` with `scrollWidth 867 / clientWidth 348`.
  Scrolling it brought `Event History` fully into view at `right 362 ≤ 386`. Not clipped, not
  amputated.
- Three modals not measured before — **New deal composer**, **Invite Collaborator**, **New invoice** —
  all `left 12 / right 364` inside 386, footers reachable at `bottom 635–798` inside 840, zero
  internal overflow.

**Refresh-survival.** Everything typed survived a reload: the private-book lines (autosaved, re-read
from Postgres), the new event and its participants, the ticket figures, the display-currency
preference, the accepted invitation.

**Public surfaces.** The public event page renders title, date, doors/show and venue **name** and
nothing else, and the RSVP completes. The public profile page renders the room, the address, the one
published show and *"House tech spec, patch list and load-in notes are shared with signed-in artists
and crew — never on the open web."* Neither page carries a fee, a budget, a participant list or a
capacity it should not.

**Boundary pages, not stubs and not blanks.** `/reports`, `/projections`, `/setlists` and `/audience`
each name their reason for the kinds that should not have them.

---

## 5. Not reached, and why

- **`pnpm test:e2e` and the unit suites.** Not run — the e2e suite tears this stack down, and the
  brief scopes this to a sweep. **No test counts are quoted anywhere in this report.**
- **Scheduled jobs.** `apps/jobs` was not driven and nothing time-based was aged and re-run, so
  expired offers, venue handoffs, due representation terminations and FX refresh are unexamined. (One
  row *was* aged in SQL, for QA7-13's draft/overdue check.)
- **File upload.** Posters, avatars, banners and rider attachments were read, never uploaded. The
  signed-URL path and the `files` table are unexercised.
- **Google OAuth callback**, calendar **Export ICS** and **Import** beyond seeing the buttons, and
  **Contacts / Audience CSV import-export** beyond seeing the affordances.
- **Email delivery.** The stack reports email unconfigured; nothing was read out of a sink. QA9-3's
  claim is about the in-app link, not about a delivery failure — the emailed token link was verified
  by pulling the token from Postgres, and the landing page works.
- **The share viewer and shared availability links.** Not driven this run; run 7 drove both.
- **Hold ranking and promotion with a real competing hold.** The pool held one entry
  (*"NOTHING ELSE IS COMPETING FOR THIS DATE"*), `Promote to 1st` correctly disabled. No second hold
  was created, so ranking and auto-promotion were not exercised.
- **QA7-15's team-invite dialog** and **QA7-12's per-room double-booking states** — run 8 drove both
  and nothing this run touched their code.
- **The "Artist share" branch of `/settlements`** — structurally unreachable on this seed (QA9-19).
- **Deleting a deal.** `DELETE /deals/:did` was probed only for its request shape (QA9-16 below), not
  driven against a real deal, because whether a deal with a computed settlement may be deleted is an
  open product question (`part19`, §25.6).

### QA9-16 — MINOR — two DELETE routes reject a bodyless request (recorded here, next to the reason it was probed)

`DELETE /events/:id/budgets/:bid/lines/:lid` and `DELETE /deals/:did` both declare
`body: z.object({ expectedVersion: … .optional() })` without `.nullish()`, so a DELETE with no body
fails validation before the handler runs:

```
DELETE /deals/…d9            (no body)  →  400  "body/ Expected object, received null"
DELETE /deals/…d9            {}         →  404  "Deal not found"       ← the real answer
DELETE /…/budgets/…/lines/…  (no body)  →  400  "body/ Expected object, received null"
DELETE /…/budgets/…/lines/…  {}         →  200  {"deleted":true}
```

`DELETE /events/:id` got this right — `OptimisticLockBody` is `z.object({…}).nullish()`
(`events-list.ts:244`) — and accepts a bodyless call (404 on a bad id, not 400). The generated client
always sends a body so the app is unaffected; it matters for the agent-native surface decisions
#16.14–15 commits to, and it is a two-character fix in two places.

### State this run left behind (it is not a fresh seed any more)

Named so the next reader does not mistake a probe's leftovers for a defect.

- **`QA9 Regression Night`** (`a17af8a8-…`), 15 Oct 2026, status `suggested`, with `Neon Tide` as an
  accepted performer carrying **no permission set**.
- The Album Release deal `…d1` is **`confirmed` at `splitBasisPoints: 5000`** (was 10000) with
  `advanceAmount: 500000`, and its settlement is **`pending_review`** with six participant rows.
- `planning_assumptions.operatorCostSplit` set to **25 / 75** on the shared budgets of **e1** and
  **e4**.
- **Northlight Presents** added as co-host to **Nordic Synth Showcase**, and **Marlo Vance** +
  **Astra Booking Agency** added there as `invited`.
- Two private budgets on e1 with lines: The Lantern Hall's (`Other revenue` 10,000, `Production cost`
  5,000) and Northlight's (`Other revenue` 12,345, `Production cost` 4,000).
- Empty provisioned **shared** budgets on **e3** and **e5**, created by a page load (QA9-11).
- Two extra `booking_requests` (27 Nov from Marlo, and the 28 Nov crew attempt that was correctly
  refused and wrote nothing).
- One invoice `c5c2406c-…`, `received/sent`, **total NULL**, due 15 Jan 2026 (QA9-12).
- One `audience_rsvps` row for `QA9 Fan`.
- Three messages on the Album Release (`all`, `operators`, `party:Marlo`) and one from Neon Tide.
- `notifications` was emptied three times during the QA8-7 probes, so its history is not the seed's.

---

## 6. Probes that lied

Four, and what the re-run showed. This is the line that says the rest was checked rather than assumed.

**6.1 A 400 for the wrong reason — the trap the brief names first.** `POST /offers` as
`teamAndCrew` answered **400** on the first try, which is the expected status for QA8-6. The message
was *"Select a profile to send the offer from"* — the `!sender` guard, twenty lines **before** the
kind check, because `api-as.mjs` sends no `x-profile-id` unless you pass an acting profile. Had I
asserted the status I would have recorded QA8-6 as holding on a check that never ran. Re-run with
`actingProfileId = Priya Sound`, the 400 carries the real reason (*"A team-and-crew profile is a
service rather than an act…"*) and `booking_requests` was 6 before and 6 after both times.

**6.2 "Every modal is entirely off-screen at 390px."** My first pass reported `dlgLeft -300 /
dlgRight 0` for both dialogs I measured — a modal sitting wholly to the left of the viewport, which
would have been a BLOCKER. `document.querySelector('[role="dialog"]')` had matched the **closed
off-canvas nav drawer**: `position: fixed`, `width 300`, `transform: matrix(1,0,0,1,-300,0)`, and
`innerText` empty — which is the tell I should have read the first time. Selecting the last dialog
**with text** gives `left 12 / right 364` for all three modals, fitting inside 386 with reachable
footers. **No finding.**

**6.3 "Editing a collaborator's role drops their permission set."** After a UI role change
Performer → Crew and back, `permission_set_id` was NULL and `POST /messages` 403'd — and the same
account had posted successfully twenty minutes earlier. **Wrong:** the successful post was on the
**seeded** event, where the seed attaches `Performer — own slice`; on the newly-invited event the
participant never had a set, because the accept path copies `invitation.permissionSetId` and the
invite dialog sends none. Nothing was dropped. Chasing it is what produced the third and widest leg of
**QA9-2**, so the false lead was worth following — but the finding I nearly filed was not the one
that is true.

**6.4 A probe that contaminated its own evidence.** My first co-host private-book reading showed
`TICKET REVENUE SEK 12,345 · 1 ticket planned across all types · PRO fee SEK 741`. That was my
`POST /budgets/:bid/lines` body: it carried no `details.basis`, and the planner buckets a basis-less
revenue line as a **ticket tier**. Re-typed through the browser's own `Other revenue` field, it reads
`Revenue sources → Other SEK 12,345` and `TICKETS PLANNED 0`, and **QA9-5** is quoted entirely from
the browser-typed version. (The underlying asymmetry — the route accepts a revenue line the planner
then mis-buckets — is real but only reachable by a non-app caller, and is not filed as a finding.)

**And one reading worth stating plainly, because it is why QA9-1 is MAJOR rather than a rounding
quibble.** The all-time footnote was read three times: **SEK 226,000** with only the host's private
book present, **SEK 238,345** after the co-host typed SEK 12,345 into theirs, and **SEK 238,345**
again after a cache-ignoring reload — each time under the sentence *"Every figure here comes from the
event's shared ledger"* and beside a panel reading **SEK 216,000**. A single figure ten thousand off a
sibling is a number you would go and check. A figure that moves by exactly the amount another operator
typed into a book you are not allowed to see is the whole finding.
