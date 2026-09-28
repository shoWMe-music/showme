# QA sweep — run 8 (2026-09-28)

**Commit under test:** `060cce3` · branch `main`. The stack was booted from that commit with
`pnpm dev` and **freshly seeded** (the container is dropped and recreated on boot), so every figure
below was measured against a seed this run created. No application code was edited at any point.

**`main` moved underneath the run, at 13:27–14:12 local** — `060cce3 → 5092444`, seven commits.
Four are docs. Three touch code, and it matters which process could have seen them:

| Commit | Files | Reached the running stack? |
|---|---|---|
| `fdd607e` (QA7-23 `divideRounded`) | `packages/shared/src/budget-planning.ts` | **Possibly** — the web runs under Vite. **QA8-3 was re-measured after a cache-ignoring reload at `5092444` and is unchanged**: `BREAK-EVEN 130` beside `PROFIT / LOSS −SEK 1,395`. The rounding change cannot move it (9,300,000 / 360 floors and rounds to the same 25,833). |
| `04aa38a` (QA7-17 cost split) | `apps/api/src/routes/budget.ts` | **No** — the API has no watch and was never restarted. Not tested this run either way. |
| `bb00ec3` (QA7-7 agent participation) | `apps/api/src/routes/participants.ts`, `lib/agent-assignment.ts` | **No**, same reason. Not tested this run. |

Nothing in §2's eleven verifications touches those three files, and nothing in §4 depends on them
except QA8-3, which was re-measured. Treat every other measurement as `060cce3`.

**Stack:** web `:5180`, API `:8080`, stream `:8081`, Firebase Auth emulator `:9099`, Postgres
`:55432` (`showme-e2e-postgres`).

**Screenshots:** `docs/screenshots/qa-2026-09-28-run8/`.

## 1. What was driven

The Playwright MCP server is not present in this session, so **every browser step used
chrome-devtools MCP**, with a separate `isolatedContext` per account — genuinely independent
profiles and IndexedDB, not tabs. Verified independent: signing `professional@` into one context
left the `operator@` and `co.host@` sessions untouched in theirs.

| Seat | Account | Context | Depth |
|---|---|---|---|
| 55 | `operator@` — The Lantern Hall | default | full |
| 56 | `performer.a@` — Marlo Vance | `perfA` | full |
| 57 | `co.host@` — Northlight Presents | `cohost` | event workspace, planner, settlement, projections |
| 58 | `professional@` — Priya Sound (crew) | `crew` | all 15 destinations + the whole settlement workspace; closed after |
| 59 | `agent@` — Astra Booking Agency | `agentseat` | all 15 destinations + the settlement workspace |
| 54 | — | default (marketing) | the public profile and event pages, unauthenticated |

**`performer.b@` (Neon Tide) was driven through `api-as.mjs` only, never in a browser.** It signed a
deal line, was proposed a representation and appears on two settlements; no screen of its own was
opened. That is the honest gap in this run's seat coverage and it is repeated in §6.

API probes used `node .claude/skills/verify-e2e/api-as.mjs`. Every figure quoted was read back out
of Postgres with `docker exec -i showme-e2e-postgres psql -U postgres -d showme`.

---

## 2. Verification — run 7's eleven fixes

**All eleven hold.** One (QA7-15) is partly source-verified rather than driven; that is stated below.

| # | Run-7 finding | Verdict | Evidence |
|---|---|---|---|
| 1 | **QA7-9** split card's closing sentence | **HOLDS** | Reopened deal `…d1` (3 parties), signed exactly one as `agent`. Planner reads *"100% of the door. **1 of 3 parties have signed, so they can still move.**"* with a `PROPOSED` badge. `deal_parties` at that moment: Marlo Vance `2026-09-28 11:33:42+00`, The Lantern Hall null, Neon Tide null. `qa8-v1-split-card-1-of-3-signed.png` |
| 2 | **QA7-10** advance on the party card | **HOLDS** | `advanceAmount: "500000"` set on `…d1`, all three parties signed, recomputed. Marlo's card: `SEK 30,000` over *"100% of the adjusted net SEK 50,000 — Marlo Vance's 60% of the deal's SEK 50,000 · SEK 30,000"* then, below a rule, *"**Paid in advance by The Lantern Hall** − SEK 3,000"*. Neon Tide's the same at −SEK 2,000. The operator's carries the mirror: *"**Paid in advance to Marlo Vance and Neon Tide** -SEK 5,000"* |
| 3 | **QA7-28** headline is the reader's net, labelled by sign | **HOLDS, both directions** | `operator@` on `/events/…e1?tab=settlement`: **`SEK 45,000` · "You owe"** (`qa8-v3-operator-you-owe-45000.png`). `performer.a@`, same route: **`SEK 27,000` · "Your payout"** over a card reading 30,000 less the 3,000 advance (`qa8-v3-performer-your-payout-27000.png`). Engine agrees: operator `net -4500000`, Marlo `net 2700000`, Neon `net 1800000`, **Σ = 0**. `/settlements` column header reads **YOUR SHARE** for `operator@` and for `performer.a@` |
| 4 | **QA7-13** a draft is not money | **HOLDS** | Created `QA8 Draft Vendor` SEK 7,777 `received/draft`, then set `due_date = 2026-01-15` (**past**) and reloaded. Tiles unmoved: `OUTSTANDING (PAYABLE) SEK 9,000`, **`OVERDUE SEK 9,000`**, `RECEIVABLE (SENT) SEK 50,000`. Also created `QA8 Draft Customer` SEK 4,321 `issued/draft` — RECEIVABLE stayed 50,000. Both rows still render, badged **Draft** with an **Issue** button |
| 5 | **QA7-19** a zero has units | **HOLDS** | `performer.a@` `/invoices`: `OUTSTANDING (PAYABLE) SEK 0` · `OVERDUE SEK 0` · `RECEIVABLE (SENT) SEK 0`. `professional@` the same |
| 6 | **QA7-14** the issued tab's first column | **HOLDS** | Sent tab header **"Bill to"**; Received tab header **"Vendor"**. Read off the rendered header cells, both tabs, same page load |
| 7 | **QA7-8** no page overflow at 390px | **HOLDS** | iframe at 390px (`innerWidth 386`), settlement workspace → **Settlement** tab: **`scrollWidth 376` vs `clientWidth 376`**. The party chooser now measures `width 298 · height 69` (two rows) with `flex-wrap: wrap`, right edge 337. At 1280px the chips still sit beside the title: title top 628 / chip top 628, chip left 1069 > title right 777 |
| 8 | **QA7-12** the room that is not a room | **HOLDS, all three states** | Create New Event, The Lantern Hall, **2026-10-15**. "No specific room" → *"Already on this night: "Marlo Vance — Album Release" in Main Room."* and **no** "still free". Main Room → *"Main Room already has "Marlo Vance — Album Release" on this night. You can book it anyway."* Back Room → *"… This room is still free."* |
| 9 | **QA7-16** the projections footnote | **HOLDS** | `co.host@` `/projections`: the all-time line is **absent entirely**. `operator@`: *"All time, **as host** — ignoring the filter above: budgeted revenue **SEK 216,000** across 5 events you hosted."*, agreeing with the panel's `PROJECTED REVENUE SEK 216,000` |
| 10 | **QA7-15** the team invite dialog | **HOLDS** (edit dialog source-verified) | ROLE pre-fills **Viewer** with *"Reads the account's events and their details. Changes nothing."* Options in order **Viewer, Crew, Editor, Admin**. Choosing Editor prints *"… **This role uses one of the account's seats.**"* **before** submit. Submitting Editor is refused with *"**Editor and Admin each consume one of the account's seats. Viewer and Crew are included on every plan — pick one of those, or upgrade this account's plan.**"* `qa8-team-invite-default-role.png` |
| 11 | *(QA7-15, second half)* | **HOLDS by construction, not driven** | The member-edit dialog could not be opened on an account-role member: the only such member on the seed is the owner, and every other row is `Group only` (*"They are only on a group roster, so there is no account role to change."*). Both dialogs read the one catalogue in `apps/web/src/hooks/useTeamAccess.ts:125`, and the old sentence claiming Editor is free appears nowhere in `apps/web/src` outside a comment describing the bug |

### Nearby, checked for regression (not on the list, but adjacent to the fixes)

- **QA7-3's fix holds and is clean.** `?budgetScope=mine` on the Album Release now reads
  `TOTAL REVENUE SEK 0 · TICKET REVENUE SEK 0 · TOTAL COSTS SEK 0 · PROFIT / LOSS SEK 0` and
  *"0 tickets planned across all types"* — the borrowed shared-book figures are gone. (One residue
  survives: **QA8-2** below.)
- **QA7-4's fix fires on a real request.** An offer sent in-app by `performer.a@` for **2026-10-15**
  reaches the operator's inbox carrying *"Already on this night: "Marlo Vance — Album Release" in
  Main Room."* — the true sentence for a request that names no room. `booking_requests.venue_profile_id`
  is now populated by the in-app sender.
- **QA7-5's fix is built and works.** `/requests` offers **Send an offer** to a signed-in act; the
  offer lands in the venue's Incoming tab as `source = performer_offer`, `sender_profile_id` set.
  (It also reaches a seat it arguably should not — **QA8-4**.)

## 3. The twenty items from runs 5 and 6

Re-checked at the cheap depth the brief allows. **Every one that was driven holds.** Five were not
re-driven and are named as such rather than implied.

| # | Item | Verdict | How |
|---|---|---|---|
| 1 | QA6-17 invoice currency guard | **HOLDS** | Typing `XYZ` disabled **Create invoice** and printed *"XYZ isn't a currency we know."* |
| 2 | QA6-2 date move rings the whole bill | not re-driven | needs a full multi-party date move; run 7 drove it |
| 3 | QA6-1 co-host on Standard access signs a rental | not re-driven | needs a fresh rental deal; run 7 drove it |
| 4 | QA6-7 co-host is `accepted` at once | **HOLDS** | `POST /events/…e3/participants {role:"co_host"}` → **201** `"status":"accepted"` |
| 5 | QA6-3 confirmed change clears the crew banner live | not re-driven | two-seat realtime; run 7 drove it |
| 6 | QA6-8 participant writes answer with a name | **HOLDS** | the same 201 carries `name: "Northlight Presents"`, `publicSlug`, `genres`, `avatarUrl` |
| 7 | QA6-18 social platforms render | not re-driven | marketing surface; see §6 |
| 8 | QA6-10 cancelled badge | **HOLDS** | `/events` — red **Cancelled** on Winter Gala, nothing on the other four |
| 9 | QA6-11 private ledger ticket count | **HOLDS** | *"0 tickets planned across all types"* against `SEK 0` |
| 10 | QA6-15 recipient chooser | not re-driven | share dialog; run 7 drove it |
| 11 | QA6-13 cost-split-only PATCH | **HOLDS** | `PATCH /events/…e1/budgets/…f11 {planningAssumptions:{operatorCostSplit:{…}}}` → **200** |
| 12 | QA6-9 / QA6-12 pronouns on somebody else's card | **HOLDS** | the operator's card reads *"Plus the money **you** collected"*; Marlo's reads *"Paid in advance by **The Lantern Hall**"*, never "you" |
| 13 | QA5-7 No break-even | not re-driven | no seeded event now reaches the never-breaks-even shape |
| 14 | QA5-9 `?tab=` | **HOLDS** | four tab clicks wrote `?tab=deals/messages/collaborators/todo`; `history.length` stayed **13** throughout |
| 15 | QA5-6 idle sign-out note | not re-driven | needs a 15-minute idle window |
| 16 | QA5-10 audience boundary | **HOLDS** | `professional@` `/audience` → *"An audience belongs to the room and to the act …"* |
| 17 | QA5-8 finalized settlement | **HOLDS** | Spring Warmup Financials contains no *"Start from the Budget Planner"* |
| 18 | QA5-12 schedule starting point | not re-driven | |
| 19 | QA5-13 unsaved ticket-tier hint | not re-driven | |
| 20 | QA5-14 settlements wording | **HOLDS** | `/settlements` header **YOUR SHARE** plus *"These count the same money four ways rather than splitting it…"*; `/` shows *"Not built yet"* under **Top venues by revenue** for all four kinds checked |

---

## 4. Findings

**Counts: 4 MAJOR · 7 MINOR · 4 COSMETIC · 2 NOTE.** No blocker — every journey completed.

| Severity | ID | One line |
|---|---|---|
| MAJOR | QA8-1 | A deal's money is write-once: nothing in the app can change a guarantee, split, advance or party after the deal exists, while two screens promise the terms can still move |
| MAJOR | QA8-2 | The whole representation lifecycle has no screen — an agent cannot sign an act, and a performer cannot accept, delegate to or end one |
| MAJOR | QA8-3 | BREAK-EVEN TICKETS 130 printed beside PROFIT / LOSS −SEK 1,395 on the same card, because the scan's fee base subtracts a cost the headline fee's base does not |
| MAJOR | QA8-4 | The agent's Settlement tab reads "SEK 0 · Your payout" on the night three other screens say they are owed SEK 3,000 |
| MINOR | QA8-5 | The operator's settlement card prints SEK 20,700 over rows of 20,700 and 78,000, and never names the SEK 10,800 it paid |
| MINOR | QA8-6 | A crew account can send a booking offer, and it is stored and displayed as a performer offering to play |
| MINOR | QA8-7 | A message posted in an event's conversation rings no bell — only an already-open screen ever sees it |
| MINOR | QA8-8 | An empty private ledger reading SEK 0 across 0 tickets splits SEK 93,000 of door directly beneath itself |
| MINOR | QA8-9 | The public RSVP tells a stranger to watch their inbox; no email is ever sent, and no screen reads the row |
| MINOR | QA8-10 | Settings → Billing says to add a bank account and offers no control that can; the route behind it accepts an IBAN account with no IBAN |
| MINOR | QA8-11 | The co-host is told to ask the host to add them to the deal, and the host has no control that can |
| COSMETIC | QA8-12 | Two different minus signs, differently spaced, on one stack of settlement cards |
| COSMETIC | QA8-13 | "Agent commission — private to you and your agent", printed on the agent's own screen |
| COSMETIC | QA8-14 | "Read-only preview of the figures entered on Financials. Edit them there." above a Financials tab that refuses the reader |
| NOTE | QA8-15 | `/settlements`' "Artist share" column header cannot be reached by any seeded account |
| NOTE | QA8-16 | Payouts are honestly unbuilt, and `payout_accounts` has no screen at either end |

---

### QA8-1 — MAJOR — A deal's money is write-once, under two sentences promising it can still move

**As:** `operator@` · **Route:** `/events/e2e00000-0000-4000-8000-0000000000e1?tab=deals`
· **Code:** `apps/web/src/components/EventAgreementTab.tsx:204`, `apps/web/src/components/useDealTermsEditor.ts:101`

**Steps.**
1. Open the Deals tab on the Album Release. The deal is `confirmed`; press **Reopen** and give a reason.
2. The card now reads `Sent — awaiting confirmations · 0 of 3 signed` and, beside it,
   **"Terms live until every party signs"**.
3. Enumerate every control the card offers. All of them:
   `Confirm your line`, `Share & Export`, `Write terms`, `+ Add` (amenities). There is no kebab —
   `[...document.querySelectorAll('main button')]` returns twenty buttons and none of them is an
   edit, a delete, or a remove-party.
4. `DEAL STRUCTURE` still reads `Share of the adjusted net 100% · Paid in advance SEK 5,000` and
   `PARTIES — 0 OF 3 CONFIRMED · Marlo Vance 60% · Neon Tide 40%`. Not one of those figures has a
   control anywhere in the app.

**Expected.** Ran's 2026-09-21 spec, quoted in this brief: *"Editing offered terms while pending
should **re-seed** the budget, not hold a stale figure."* That sentence presumes the terms can be
edited while pending. The Budget Planner says the same thing in its own words — *"1 of 3 parties
have signed, **so they can still move**"* — and so does the deal card.

**Actual.** The only `PATCH /deals/:id` call in `apps/web/src` is `useDealTermsEditor`, and it sends
`agreementBodyText` and nothing else:

```
$ grep -rn "usePatchApiV1DealsDid" apps/web/src
apps/web/src/components/useDealTermsEditor.ts:5
apps/web/src/components/useDealTermsEditor.ts:101
```

`DealComposerModal` is mounted once, with no `deal` prop — it only ever composes a NEW deal
(`EventAgreementTab.tsx:204`). And `DELETE /deals/:did` has **no caller at all** in either front
end, so a deal typed with the wrong guarantee can be neither corrected nor removed; the only
remedy on screen is to add a second deal to the same event, which double-counts at settlement.

**The API is not the problem — it accepts the write.** `PATCH /deals/…d1 {"advanceAmount":"500000"}`
while the deal was `sent` → **200**, and the planner re-seeded on the next read exactly as the spec
requires. Run 7 verified the same for `guaranteeAmount` (and its 409 once confirmed). So the engine,
the route and the re-seed are all built and correct; what is missing is the control.

**Evidence.** The button enumeration above; the two greps; the screenshot
`qa8-1-operator-card-20700-over-98700.png` is a different finding but shows the same card family.

**Scope.** Every deal, every account kind, draft and sent alike. Reproduced twice (once on a
`confirmed` deal, once after reopening it to `sent`).

**The one-line fix, for the report only.** Give `DealComposerModal` an optional `deal` and open it
from the card's header when `agreementStatus !== "confirmed"`; the submit path and the API already
exist.

---

### QA8-2 — MAJOR — An agent cannot sign an act, and an act cannot accept, delegate to or end a representation

**As:** `agent@`, `performer.b@` · **Routes:** every screen either account is offered
· **Code:** `apps/api/src/routes/representations.ts:333,399,596,612`

**Steps.**
1. Walk all fifteen sidebar destinations as `agent@` and as `performer.a@`/`performer.b@`. Nothing
   anywhere names a representation, a roster, a commission rate, a territory or a termination.
2. Grep both front ends:

```
$ grep -rn "epresentation" apps/web/src apps/marketing/src | grep -v '\.test\.'
apps/web/src/components/SendOfferDialog.tsx:1,58,62,67,70,76   ← useGetApiV1Representations (READ)
…everything else is a comment or a settlement field name
```

   `GET /representations` has exactly one caller: the Send-an-offer dialog, which filters to
   **active** ones. `POST /representations`, `PATCH /representations/:id`,
   `GET /representations/:id/delegatable-events` and `POST /representations/:id/events` have none.
3. Call the routes directly — they are alive and correct:

```
$ api-as.mjs agent POST /representations {"agentProfileId":"…a5","performerProfileId":"…a3",
    "proposedBy":"agent","region":["SE"],"commissionRate":1500,
    "commissionableBasis":"deal_income","agentCollects":false,"startsAt":"2026-10-01"}
201  … "status":"proposed","confirmedByAgent":true,"confirmedByPerformer":false
$ api-as.mjs performerA GET /representations/…0001/delegatable-events
200  {"events":[{"eventId":"…e1","title":"Marlo Vance — Album Release","alreadyAssigned":true}]}
```

4. The proposal is invisible to the other side. `select count(*) from notifications where created_at
   > now() - interval '3 minutes'` → **0 rows**, and Neon Tide's dashboard, Requests and
   notifications all show nothing.

**Expected.** `docs/decisions.md` **#14** makes the representation the whole basis of the `agent`
account kind: the commission, the delegation of events, the effective-dated termination and the
agent's `settlement.confirm` all hang off it. `story.md` says an agent *"acts through the performers
they represent"*. `apps/jobs` has a scheduled sweep for **due representation terminations**, so the
lifecycle is expected to exist.

**Actual.** The only representation this product can hold is the one the seed writes. The route that
proposes one, the picker that delegates events to it, the PATCH that confirms, declines or
terminates it, and the notification that would tell the act any of this happened — none of them is
reachable, and one of them (the notification) is not written at all.

**Scope.** All three parties to the relationship. It is the same shape as run 7's QA7-5 (`POST
/offers` had no sender), one layer up.

---

### QA8-3 — MAJOR — The break-even scan and the headline fee disagree about the base, so the card says the night breaks even at 130 while its own P&L is negative at 360

**As:** `operator@` · **Route:** `/events/…e1?tab=budget`
· **Code:** `packages/shared/src/budget-planning.ts:465-479`

**Steps.**
1. Album Release: two seeded ticket lines (SEK 65,000 + SEK 18,000), SEK 33,000 of costs, a
   100%-of-adjusted-net door split, payment processing left at its 1.5% default.
2. Add `QA8 Early bird`, price 250, max 50, est 40 on **Event Details → Ticket Information** (the
   tier stores `price: 250` in MAJOR units and seeds the planner at SEK 10,000 — correct).
3. Read the KPI row.

**Actual, one screenshot, five tiles:**

```
TOTAL REVENUE SEK 93,000 · TICKET REVENUE SEK 93,000 · TOTAL COSTS SEK 94,395
PROFIT / LOSS −SEK 1,395 · BREAK-EVEN TICKETS 130
```

against **360 tickets planned**, and the chart caption underneath: *"Revenue passes total cost at
**130** tickets of 400 capacity."* The night is 2.8× past the stated break-even and losing money.

**The arithmetic, by hand.** `averageTicketPrice = 9,300,000 / 360 = 25,833` minor units.
`variableCostPerTicket = 1.5% × 25,833 = 387`. `trulyFixedCosts = 3,300,000`.

- What the **headline fee** does: `fee = 100% × (revenue − costs) = 93,000 − 33,000 = 60,000`, and
  `TOTAL COSTS = 33,000 + 60,000 + 1,395 = 94,395` — payment processing is **not** in the fee's base.
- What the **scan** does (`derivedAt`): `adjustedNetHere = revenueHere − trulyFixedCosts −
  variableCostPerTicket × tickets`, i.e. processing **is** subtracted before the split is applied.

So the scan's costs are `3,300,000 + (25,833N − 3,300,000 − 387N) + 387N = 25,833N` — identically
equal to its revenue for every N ≥ 130, which is why it reports a crossing at the first such N.
Reality is `25,833N + 387N`, which exceeds revenue at every attendance. **On a 100% split the night
never breaks even, and the card says 130.**

Checked at the planned attendance, where both models can be read off the same screen: the scan's fee
at 360 is `25,446 × 360 − 3,300,000 = SEK 58,605.60`; the headline's is `SEK 60,000`; the difference,
SEK 1,394, **is the whole of the printed loss**.

**Expected.** `decisions.md` #24.1: *"the Budget Planner moves with the engine, in the same commit."*
One card, one definition of the adjusted net. This is the second half of run 7's QA7-1 — that fix
moved `derivedAt` from the gross door to the adjusted net and, in doing so, put the per-ticket
variable cost into the base that the headline does not use.

**Evidence.** `qa8-4-breakeven-130-vs-loss-at-360.png` (the five tiles and the three ticket rows in
one frame); the caption read off the same page; the derivation above.

**Scope.** Any event with a percentage deal, at least one cost row, and a non-zero payment-processing
assumption — the default. The error equals the processing fee, so it grows with the door. The
settlement is unaffected: the engine never sees the planner's processing assumption.

---

### QA8-4 — MAJOR — "SEK 0 · Your payout" on the agent's Settlement tab, on a night three other screens say pays them SEK 3,000

**As:** `agent@` (Astra Booking Agency) · **Routes:** `/`, `/settlements`,
`/events/…e1?tab=settlement`, `/events/…e1/settlement`
· **Code:** `apps/web/src/components/EventSettlementTab.tsx:44` (`settlement.ownParty?.netAbsolute`)

**Steps.** Compute the Album Release settlement as the operator. Then, as `agent@`:

| Screen | What it says |
|---|---|
| Dashboard → SETTLEMENTS | `Outstanding SEK 3,000`, and the row `Marlo Vance — Album Release … SEK 3,000` |
| `/settlements` | `OUTSTANDING SEK 3,000`; column **YOUR SHARE** = `SEK 3,000`; the row links to `/events/…e1/settlement` |
| `/events/…e1?tab=settlement` | **`SEK 0` · "Your payout"** |
| `/events/…e1/settlement` → Settlement | `Astra Booking Agency (you) · Agent · SEK 0`, and further down `Total Payouts → Your commission SEK 3,000` |

**Expected.** QA7-28's own argument, unchanged: the headline is *"what moves, not what was earned"*.
SEK 3,000 moves — there is a transfer row for it (`b2 → b5, 300000, representationId …0001`) — and
SEK 0 is not a figure the agent can act on. The fix was verified for an operator and a performer; the
agent is the third seat and the one where `net` and "what I am owed" come apart by construction.

**Actual.** The agent's event `net` is genuinely `0` — their commission is a representation-scoped
settlement with a null `participantId`, which the event breakdown does not carry:

```
b5  ent 0  coll 0  paid 0  held 0  net 0  comm 0  prepaid 0
```

`GET /settlements` compensates deliberately and says so in a docstring
(`routes/settlement.ts:1568-1580`, *"AN AGENT'S MONEY ON A NIGHT IS THEIR COMMISSION"*), overlaying
`commissionByEvent` onto `entitlement` and `net`. The event tab has the same figure available — the
payload it already fetches carries `commissions[0].commission = "300000"` — and does not use it.

**Evidence.** `qa8-3-agent-sek0-your-payout.png`; the four screen readings above; the settlement
compute; `api-as.mjs agent GET /events/…e1/settlements` showing the commission and the transfer.

**Scope.** Every agent, every event they earn on. The performer's and operator's headlines remain
correct (verified in §2).

---

### QA8-5 — MINOR — The operator's settlement card prints a headline its own rows cannot reach, and never names the costs it paid

**As:** `operator@` · **Routes:** `/events/…e2/settlement` → Settlement, and `/events/…e1?tab=settlement`
· **Code:** `apps/web/src/components/settlementDocument.ts:455-475`

**Steps.** Open the finalized Spring Warmup settlement and read the operator's own card.

**Actual.**

```
The Lantern Hall (you) · Operator                       SEK 20,700
  What is left after every other party is paid          SEK 20,700
  Plus the money you collected on the night             SEK 78,000
```

and directly beneath it, Marlo Vance's card, whose rows **do** sum: `48,300 − 1,800 = 46,500`. The
format states a sum; one card keeps it and the other does not. The SEK 10,800 the operator paid —
which the **Payout** tab of the same workspace prints as `Collected SEK 78,000 · Paid SEK 10,800 ·
Net −SEK 46,500` — appears nowhere on the card.

Reproduced on the Album Release with an advance: headline `SEK 0` over `Plus the money you collected
on the night SEK 83,000` and `Paid in advance to Marlo Vance and Neon Tide -SEK 5,000`
(`qa8-1-operator-card-zero-over-83000.png`).

**Expected.** Run 6's QA6-9 added the `collected` row for exactly this reason — *"a party who
collected anything read a headline the rows beneath it could not reach"*. The fix is the mirror of
the bug: the headline is the **entitlement**, and `collected` is not part of it.

**The comment is wrong about the code beside it.** `settlementDocument.ts:459` states *"The engine's
`entitlement` is `deal lines + revenue you collected − costs fronted for you`"*. It is not.
`reconcile.ts:349-365` computes `entitlement` from the allocation alone and keeps the cash in a
separate term: `held = collected − paid + prepaid`, `net = entitlement − held`. On the seed that is
`entitlement 20,700` against `collected 78,000` — the two are not in the same sum and never were.

**Evidence.** `qa8-1-operator-card-20700-over-98700.png`; the same event's Payout tab; the engine
source.

**Scope.** Every operator card on every settlement (an operator always collects). Performer and crew
cards are unaffected and correct.

---

### QA8-6 — MINOR — A crew account can send a booking offer, and it is filed and shown as a performer offering to play

**As:** `professional@` (Priya Sound, FOH engineer), then `operator@` · **Route:** `/requests` → **Send an offer**

**Steps.**
1. As `professional@`, open Requests. The **Send an offer** button is offered, exactly as it is to a
   performer and an agent.
2. Send one to The Lantern Hall for 2026-11-28. It succeeds.
3. Read the row, and the venue's inbox.

```
 id       | artist_name | source          | sender_type | wanted_date | sender_profile_id
 5c684b2b | Priya Sound | performer_offer | performer   | 2026-11-28  | …a4  (team_and_crew)
```

The operator's Incoming tab: `PS · Priya Sound · Priya Sound (FOH engineer) · just now ·
**SOURCE: Performer offer** · FEE Fee TBD`, with **Create Draft** and **Make Offer** beside it.

**Expected.** `docs/story.md:61` — a team-and-crew member is *"**not** talent … an arm's-length
service provider paid a **fixed fee**"*, and the marketplace described there is the other direction:
*"operators/performers post jobs and team-and-crew members apply"*. Nothing about the account kind
says it offers to play a room.

**Actual.** The one sender dialog is offered to every non-operator kind and writes one vocabulary.
The venue is told a sound engineer is an act, and the row's `sender_type` says `performer` about a
`team_and_crew` profile.

**Scope.** Every `team_and_crew` account. The agent's and performer's use of the same dialog is
correct and was verified separately.

---

### QA8-7 — MINOR — A message posted in an event's conversation rings no bell

**As:** `operator@` → `performer.a@`, two independent browsers · **Route:** `/events/…e1?tab=messages`
· **Code:** `apps/api/src/routes/messages.ts:294,313-336`

**Steps.**
1. `performer.a@` on the Messages tab in one browser; `operator@` on the same tab in another.
2. Post *"QA8 realtime probe from the operator"*. It arrives in the performer's browser within
   seconds, without a reload — realtime works and is a pass (§5).
3. Read the performer's bell: **4 unread before, 4 unread after**.

```
select type, count(*) from notifications group by type;
 deal.confirmed 9 | offer.received 3 | deal.reopened 3 | event.participant_added 1
```

No message row has ever been written, on this seed or after the probe.

**Expected.** Every other interactive event route writes a notification — `deals.ts`, `events.ts`,
`holds.ts`, `tasks.ts`, `invitations.ts`, `settlement.ts` and `events-list.ts` all call `notifyUsers`.
`messages.ts` is the only one that does not; it publishes an SSE frame (which carries a `link`, the
shape a notification uses) and stops there. Settings → Notifications lists six categories and none of
them is messages, so there is nothing a reader could have switched off.

**Actual.** A message reaches only a screen that is already open on that tab. Everyone else — the act
who is not looking, the crew who logged out — never learns it was said.

**Scope.** All three thread kinds (`all`, `operators`, party), every account.

---

### QA8-8 — MINOR — An empty private ledger reading SEK 0 across 0 tickets splits SEK 93,000 of door immediately beneath itself

**As:** `operator@` · **Route:** `/events/…e1?tab=budget&budgetScope=mine`

**Steps.** Open **My budget** on the Album Release (a co-promoted event, so the scope chooser is
offered). `select count(*) from budget_lines where budget_id = <the private one>` → 0.

**Actual.** Run 7's QA7-3 is fixed and the KPIs are honest — `TOTAL REVENUE SEK 0 · TICKET REVENUE
SEK 0 · TOTAL COSTS SEK 0 · PROFIT / LOSS SEK 0`, and the ticket table reads *"0 tickets planned
across all types · SEK 0"*. The very next card on the same screen:

```
HOW TICKET REVENUE SPLITS — 60% Marlo Vance / 40% Neon Tide
DOOR SPLIT   Marlo Vance 60%  SEK 55,800     Neon Tide 40%  SEK 37,200
100% of the door.
```

SEK 55,800 + SEK 37,200 = SEK 93,000 — the **shared** book's door, on a page whose own total two
lines above is SEK 0. And the explanatory sentence the shared view carries (*"Box office only,
before costs and rental — after them the deal pays SEK 60,000"*) is **absent here**, so the card
offers no clue which door it means.

**Expected.** `useBudgetSeed` argues, correctly, that the derived FEE is event-scoped. That argument
is about a cost line. It does not license printing a split of the shared door on a private book, and
QA7-3's own fix took the same reasoning in the opposite direction for the tickets.

**Evidence.** `qa8-2-private-ledger-zero-tickets-83000-split.png`; the `budget_lines` count.

**Scope.** Both operators on every co-promoted event (confirmed on the host's and the co-host's
private books).

---

### QA8-9 — MINOR — The public RSVP promises an email that is never sent, and the row it writes is still unreadable

**As:** an anonymous fan, then `operator@` · **Routes:** `localhost:5173/event/…e1`, `/audience`
· **Code:** `apps/api/src/routes/public.ts:643-659`

**Steps.** RSVP as `QA8 Fan / qa8fan@e2e.showme.test / Stockholm`.

**Actual.** The page answers:

> **You're on the list** — The organiser of Marlo Vance — Album Release knows to expect you.
> **Keep an eye on your inbox.**

The route inserts one row into `audience_rsvps` and returns `{ok:true}`. There is no send, no queue
and no template — not a stubbed one. `/audience` as the operator still reads *"0 contacts … **No
audience yet** — Fans appear here once they RSVP or buy tickets"*, and
`select count(*) from notifications where created_at > now() - interval '2 minutes'` is 0.

**Expected.** Two promises on one screen, to a member of the public: that the organiser will know,
and that something will arrive by email. Neither is kept. QA7-11 covered the first half; the inbox
sentence is new and is the sharper of the two, because the reader has no way to discover it is false.

**Scope.** Every RSVP. `audienceRsvps` appears exactly once in `apps/api/src` — the insert.

---

### QA8-10 — MINOR — Settings → Billing tells the reader to add a bank account and offers no control that can

**As:** `operator@` · **Route:** `/settings` → **Billing**

```
PAYOUT ACCOUNTS
No payout accounts yet
Add a bank account to receive settlement transfers.
```

Every button on the page: `General · Team Access · Notifications · Security · Appearance ·
Integrations · VAT · Billing`. There is no Add. `POST /profiles/:id/payout-accounts`,
`PATCH /payout-accounts/:pid` and `DELETE /payout-accounts/:pid` have no caller in either front end.

**And the route accepts an account that identifies nothing.** `identifier` is
`z.string().optional()` (`apps/api/src/routes/payout.ts:21`), so:

```
$ api-as.mjs operator POST /profiles/…a1/payout-accounts
     {"type":"iban","label":"QA8 bank","currency":"SEK","iban":"SE455000…"}
201  {"type":"iban","identifier":null,"currency":"SEK","isPrimary":false}
```

An IBAN payout account with no IBAN, stored and returned as created. (Row deleted afterwards.)

**Mitigating, and why this is MINOR.** The settlement workspace's own Payout tab is honest about the
state — *"Paying out through shoWMe is not connected yet. Until it is, mark each transfer on the
Settlement tab as you pay it."* Only the Billing tab makes a promise the product does not keep.

---

### QA8-11 — MINOR — "Ask the host to add you to it" names an action the host has no control for

**As:** `co.host@` (Northlight Presents, `Operator — full` on the event), then `operator@`
· **Route:** `/events/…e1?tab=deals`

**Steps.** Open the Deals tab as the co-host.

> **Not your deal to see** — This event has a deal, and you are not a party to it. **Ask the host to
> add you to it** if you need its terms.

Then open the same tab as the host. The deal card's controls are `Reopen`, `Share & Export`,
`Write terms`, `+ Add` (amenities) — see **QA8-1**. There is no way to add a party to an existing
deal, so the instruction cannot be followed.

**What is built and what is not.** `docs/decisions.md` records *"Co-operator transparency
realization — **RESOLVED: BOTH** — `observer` `deal_parties` for targeted one-off sharing **and** a
shared-budget rule (co-operators see all deals assigned to the shared budget) for the blanket
co-operator tier."* Half of that is built: **Observes** is offered as a party role in the **New
deal** composer (verified: the role picker reads `Pays · Is paid · Takes a share · Observes`). The
blanket shared-budget rule is not, and the targeted one only reaches a deal that does not exist yet.

**Scope.** Every co-host on every event with a deal they are not on — which is the ordinary case,
since the composer defaults to payer + payee.

---

### QA8-12 — COSMETIC — Two different minus signs, differently spaced, on one stack of cards

`/events/…e1?tab=settlement` as `operator@`. Read straight off `innerText`, same screen, same scroll
position:

```
"-SEK 5,000"    charCodes [45, 83, …]    ← U+002D hyphen-minus, no space (the operator's advance)
"− SEK 3,000"   charCodes [8722, 32, …]  ← U+2212 minus sign, one space (the performers' advances)
```

The first is a formatted negative amount; the second is the card's `negative: true` renderer. One
screen, one concept, two glyphs.

### QA8-13 — COSMETIC — "private to you and your agent", printed on the agent's own screen

`/events/…e1/settlement` → Settlement, as `agent@`. The commission card's eyebrow reads **"AGENT
COMMISSION — PRIVATE TO YOU AND YOUR AGENT"** above `Commission to Astra Booking Agency SEK 3,000`.
The reader *is* Astra. It is correct on the performer's copy of the same card and person-blind on the
agent's — the same class of slip run 6 fixed as QA6-9, in a card that fix did not reach.

### QA8-14 — COSMETIC — "Edit them there" pointing at a tab that refuses the reader

`/events/…e1/settlement` → Settlement, as `professional@` (and as any party without `budget.view`):

```
Revenue & deductions
Read-only preview of the figures entered on Financials. Edit them there.
The night's takings and costs are the operator's view of this event. …
```

The Financials tab for that same reader says *"The plan is the operator's view — What this night was
budgeted to make is the whole event's money, not your own line."* The instruction and the refusal are
one click apart. Evidence: `qa8-crew-edit-them-there.png`.

### QA8-15 — NOTE — The "Artist share" column header cannot be reached

`Settlements.tsx:153` reads `isOperator || isSingleProfile ? "Your share" : "Artist share"`, and
`isSingleProfile` is `session.memberships.length === 1`. Every seeded account has exactly one
membership, so all six read **YOUR SHARE** and the "Artist share" branch was not driven this run.
Recorded so the next sweep does not report it as verified.

### QA8-16 — NOTE — Payouts are unbuilt, and honestly so

The finalized Spring Warmup Payout tab prints the full reconciliation (`WHO OWES WHOM · Σ net = 0`,
`The Lantern Hall Owed SEK 20,700 · Collected SEK 78,000 · Paid SEK 10,800 · Net −SEK 46,500`, one
transfer of SEK 46,500 with **Mark as paid**) and then says plainly that processing is not connected.
That is the right shape for an unbuilt thing. Only the Billing tab (QA8-10) claims otherwise.

---

## 5. What passed — walked, and correct

Named, because it is the other half of the result.

**The money spine.** Three settlements hand-checked to the minor unit; all three balance.

- **Album Release, with a SEK 5,000 advance added this run.** Revenue 83,000 − costs 33,000 =
  net 50,000 = adjusted net. 60/40 → 30,000 / 20,000. The advance settles as cash held and divides by
  the same weights: Marlo 3,000, Neon Tide 2,000, the operator −5,000. Nets −45,000 / +27,000 /
  +18,000, **Σ = 0**, transfers 27,000 + 18,000 = 45,000. Every figure on the screen matches the
  engine's JSON.
- **Spring Warmup (finalized).** 78,000 − 9,000 = 69,000; 70% = 48,300 beats the SEK 18,000
  guarantee; less the SEK 1,800 `Artist hotel` deductible = **46,500** — the figure decisions.md
  #24.1 predicts in writing. Operator residual 20,700, collected 78,000, paid 10,800, net −46,500.
  **Σ = 0**, one transfer of 46,500.
- **The representation commission.** `commissionableIncome 3,000,000 → commission 300,000` at the
  representation's 1000 basis points. 10% of SEK 30,000 = SEK 3,000, and the transfer is
  `Marlo Vance → Astra Booking Agency`, correctly keyed to the representation rather than the event.

**The major/minor unit trap is handled.** A tier typed on Event Details stores
`{"price": 250, "max": 50, "est": 40}` — **major** units — and seeds the planner at `SEK 250 × 40 =
SEK 10,000`, not SEK 2.50. The two seeded budget lines carry `unitAmount` in **minor** (`"25000"` for
SEK 250) and render `SEK 65,000` for 260. Both conventions are right in their own table.

**QA7-2's fix holds.** A tier added on Event Details while the budget already held ticket lines now
raises BOTH the door and the fee it derives: `TOTAL TICKETS REVENUE SEK 93,000 · 360 tickets`, split
card `SEK 55,800 / SEK 37,200` (= 93,000), and *"after them the deal pays **SEK 60,000**"* — which is
exactly what `POST /settlement/compute` produces. Run 7 measured 93,000 against a fee from 83,000.

**QA7-4's fix holds, on a real request.** An offer sent in-app for **2026-10-15** reaches the
operator's inbox carrying *"Already on this night: "Marlo Vance — Album Release" in Main Room."*
`booking_requests.venue_profile_id` is populated by the in-app sender, which is what the warning
needed and never had.

**QA7-3's fix holds.** The private ledger reports its own lines: `SEK 0` revenue, `SEK 0` costs,
`SEK 0` profit, *"0 tickets planned"*. Run 7 measured SEK 10,000 / SEK 60,150 / −SEK 50,150 borrowed
from the shared book. (One residue: **QA8-8**.)

**Realtime, with two genuinely independent browsers.** A message posted in the operator's browser
appeared in the performer's within seconds, on a screen that was already open and never reloaded.

**Party scoping held everywhere it was tested.**

- `performer.a@` on a 60/40 split sees **only** Marlo's card — never Neon Tide's SEK 20,000, never
  the operator's SEK 83,000 of takings.
- `co.host@` (`Operator — full`) sees the shared ladder and its own SEK 0, and is told honestly
  *"The entitlements below come to SEK 0, less than the adjusted net."*
- `professional@` (crew) gets a refusal with a reason on every money surface — *"Not your agreement
  to see"*, *"The plan is the operator's view"*, *"The night's takings and costs are the operator's
  view of this event"* — and has **no Budget Planner tab at all**, so `?tab=budget` falls back to
  Event Details rather than half-rendering.
- The crew's own Poster card shows `Replace` and `Remove` **disabled**, under *"Only the profile
  operating this show can change its poster."* Affordance and sentence agree.

**Boundaries.** `co.host@` DELETE on somebody else's show → **403** with the best refusal in the
product (*"…or, if the show is not yours, archive it instead: that hides it from your own lists and
touches nobody else's"*). A co-host with full control MAY rename, and the rename rings the whole
bill — five `event.updated` rows, each naming the **old** title, which is the useful way round.

**Boundary pages, not stubs and not blanks**, on `/reports`, `/projections`, `/setlists` and
`/audience` for the kinds that should not have them — each naming the reason
(*"An audience belongs to the room and to the act …"*, *"A projection rolls up the event budget,
which only the operator running the event can see."*).

**Console and network across the whole run: clean.** Four accounts × fifteen destinations
(`operator@`, `performer.a@`, `professional@`, `agent@`) — **zero console errors, zero non-2xx
responses**, measured with a `console.error` hook and a `fetch` wrapper installed before the walk.

**Mobile, 390px (`innerWidth 386`), by looking rather than by a metric that cannot fail.**
`scrollWidth == clientWidth == 376` on: the settlement workspace's Settlement tab (QA7-8, plus the
chooser now measuring 298 × 69 on two rows), the three public marketing pages, and seven modals —
Place a hold, Check & Share Availability, New group, New Task, Add Contact, Send an offer, and the
event workspace. The Send-an-offer dialog fits with its footer reachable at `bottom 688` inside an
840px viewport.

**Other things walked and correct.** `?date=` deep-links the calendar to the right month and tasks
land on the grid on the right day. **Mark Unavailable** writes `profile_unavailability`
(`2026-10-21`) and the Create New Event dialog then says *"You marked this date unavailable. You can
still book it — the block is yours to change."* The invoice currency guard, the draft/overdue
exclusions, the ticket-tier unsaved hint, `?tab=` with a stable `history.length`, the team invite's
plan gate, Contacts with full payout details, and the public profile and event pages all behaved as
described above.

---

## 6. Not reached, and why

- **`performer.b@` in a browser.** Driven through the API only. No screen of Neon Tide's was opened.
- **`pnpm test:e2e` and the unit suites.** Not run — the e2e suite tears this stack down, and the
  brief scopes this to a sweep. **No test counts are quoted anywhere in this report.**
- **Scheduled jobs.** `apps/jobs` was not driven. Nothing time-based was aged and re-run, so expired
  offers, venue handoffs, due representation terminations and FX refresh are unexamined — which
  matters to QA8-2, whose termination sweep exists for a lifecycle that has no UI.
- **File upload.** Posters, avatars, banners and rider attachments were read, never uploaded. The
  signed-URL path and the `files` table are unexercised.
- **Google OAuth callback** and calendar **Export ICS** / **Import** beyond seeing the buttons.
- **Email delivery.** The API reports `Email delivery` as unconfigured in this stack; no message was
  read out of a sink this run. QA8-9's claim is about the absence of a send in the code, not about a
  delivery failure.
- **The share viewer and the invitation landing page.** Run 7 drove both; this run did not.
- **Contacts import, Audience import/export.** Contacts *export* affordances were seen and the screen
  renders; no CSV round-trip was run this time (run 7 did one).
- **Two-seat realtime beyond messages.** One frame was proven with two independent browsers. Deal
  confirmation, settlement send-for-review and date-change banners were driven one-sided or through
  the API this run; run 7 proved those with two seats.
- **The "Artist share" branch of `/settlements`** — structurally unreachable on this seed (QA8-15).
- **QA7-7 and QA7-17's fixes**, which landed on `main` mid-run into files the running API had already
  loaded. Deliberately not tested rather than tested against a stale binary.

### State this run left behind (it is not a fresh seed any more)

Named so the next reader does not mistake a probe's leftovers for a defect: a `proposed`
representation between Astra and Neon Tide at 1500 basis points (inert — unconfirmed); three extra
`booking_requests` (21 Nov, 15 Oct, 28 Nov); three draft invoices (`QA8 Draft Vendor` with a past due
date, `QA8 Draft Customer`, `QA8 Duedate Probe`); a `QA8 Early bird` ticket tier on the Album
Release; one `profile_unavailability` row on 2026-10-21; an `audience_rsvps` row for `QA8 Fan`; a
`SEK 5,000` advance on the Album Release deal, which was reopened and re-signed twice and is
`confirmed` again; `Northlight Presents` added as co-host to Open Mic Wednesdays; and one message in
the Album Release conversation.

---

## 7. Probes that lied

Four, and what the re-run showed. This is the section that says the rest was checked rather than
assumed.

1. **"The Send-an-offer dialog promises a fee range it never collects."** It looked like a clean
   copy-versus-code finding: the a11y snapshot listed exactly `VENUE`, `DATE YOU WANT`,
   `WHY THIS NIGHT`, the row I sent stored `offer_fee_min = NULL`, and the dialog's own first
   sentence says *"with the fee range and the note you give here"*. **Wrong twice.** `FEE FROM (SEK)`
   and `FEE TO (SEK)` exist; they appear **once a venue is chosen**, because the currency in their
   labels comes from the venue. My first read was before selecting one, and my `offer_fee_min` was
   null because I left them blank. Re-driven at 390px and at 1280px with a venue selected: both
   fields present, both labelled, no overflow. **No finding.**

2. **"A due date typed into the New invoice dialog is dropped."** The DOM held `2026-02-10` and the
   row stored `NULL`. It is my tooling: setting a React-controlled input through the native value
   setter does not move React state, and the next render wiped it — visible the moment I filled a
   second field and the date went blank. Re-driven with the value-tracker-safe write, the POST body
   carried `"dueDate":"2026-03-03T00:00:00.000Z"` and Postgres stored `2026-03-03`. **No finding**,
   and QA7-13's verification was then re-done properly by ageing the row in SQL.

3. **"A ticket tier saves as an empty row."** `extras.ticketTiers` came back
   `{"name":"","price":0,"max":0,"est":0}` while the screen read `QA8 Early bird / 250 / 50 / 40`
   and `Total inventory 50 max · 40 est.` Same cause as (2) — and the a11y snapshot I trusted for
   "React really does have those values" was one interaction stale. Re-typed through the real input
   path: `{"name":"QA8 Early bird","price":250,"max":50,"est":40}`. **No finding.** The same
   mechanism explains a `Mark Unavailable` click that wrote nothing until re-done with a real
   pointer event.

4. **The reverse: a finding that only survived because I did not stop at the first reading.**
   The agent's settlement workspace *looked* like it hid the SEK 3,000 commission entirely — my first
   capture sliced the tab text at 600 characters and ended before the commission card. Read whole, it
   is there twice (`Your commission SEK 3,000` and a dedicated card). What survives is the narrower
   and truer **QA8-4**: it is the *event workspace's* Settlement tab, one screen earlier, that prints
   `SEK 0 · Your payout`. Had I filed the first version it would have been rejected on sight.

**And one thing worth stating plainly, because it is why QA8-3 is MAJOR rather than a rounding
quibble.** `BREAK-EVEN TICKETS 130` was read three times — twice before `main` moved and once after a
cache-ignoring reload on the newer `packages/shared` — and never changed, each time beside a
`PROFIT / LOSS` of `−SEK 1,395` at 360 tickets. A single reading of a break-even below the planned
attendance is a number you would accept. The same number surviving a reload that replaced the very
function computing its inputs, still contradicting the tile next to it, is not.
