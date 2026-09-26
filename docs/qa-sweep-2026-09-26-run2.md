# QA sweep — 2026-09-26, run 2

**Branch:** `main` @ `3b8644c` — clean tree, nothing committed-but-unshipped locally.
**Stack:** local `pnpm dev` — web `http://127.0.0.1:5180`, API `:8080`, SSE `:8081`, Firebase Auth
emulator `:9099`, Docker Postgres `:55432`. **47 migrations** (0046 present), freshly seeded at the
start of this run.
**Purpose:** re-verify every open finding of `docs/qa-sweep-2026-09-26.md` (run 1, written against
branch `budget-fee-from-draft-123qy9rnwud` @ `a033436`), confirm the BLOCKER fix `f996c14` holds,
reach what run 1 could not, and hold Ran's 2026-09-21 spec to the letter again.
**Rules applied:** `docs/decisions.md` #14, #19, #20, #21, #23.2, #23.3, **#24.1/#24.2/#24.3**;
`docs/story.md` boundaries; `docs/handoff-2026-09-21-sse-costs-and-settlement.md` (Ran's spec as
written); `PLAN.md:215`.

This file is appended to as each area completes.

---

## Summary

**Run 1's BLOCKER is fixed and the fix holds end to end.** Everything else that mattered in run 1 still
stands: **6 of its 6 open MAJORs reproduce** (one with its root cause corrected, one wider than filed),
and **11 of its 11 MINORs reproduce**. This run also found **1 new BLOCKER, 3 new MAJORs and 10 new
MINORs**, most of them in the same money spine.

**Totals: 1 BLOCKER · 9 MAJOR · 22 MINOR · 6 NOTE** — plus one run-1 BLOCKER confirmed **fixed** and one
half of a run-1 MAJOR that **no longer reproduces**. (Two findings are written up twice, once where they
were first met and once where they were driven properly; both say so and are counted once.)

The three that matter most:

1. **[BLOCKER — new]** Editing **one** ticket tier in the Budget Planner **permanently deletes every
   other tier** the operator listed on Event Details. On the seeded Open Mic that is SEK 4,800 of door
   money — 76% of the night — gone from the plan, from the budget and from the settlement, with one
   POST on the wire and no warning.
2. **[MAJOR — new]** On an event whose only participant is the host — a venue holding its own night,
   the shape the seed ships — **the date can never be moved again**. The PATCH is diverted into a
   change-request proposal with `required: 0` that nothing can answer and no control can withdraw.
3. **[MAJOR]** An **agent's own money is SEK 0 on every screen in the product**, on two freshly computed
   settlements owing them SEK 3,581 — and the act's own settlement card quotes that agent's commission
   **SEK 500 higher** than the transfer the engine actually wrote.

Two results worth stating as passes because they are the ones most likely to be wrong: the **money
boundary between account kinds is exact** on the wire *and* on the screen (a performer's waterfall is
withheld with a written reason, `ladder` is null for everyone but the operator, Σ net = 0 on both
settlements), and the **share ceiling still strips `budget.view`** from a link an operator deliberately
granted it on.

| # | Sev | Area | Finding | vs run 1 |
|---|---|---|---|---|
| — | ~~BLOCKER~~ | money spine | Solo operator's costs never reach the settlement | **FIXED** (`f996c14`) |
| 1 | **BLOCKER** | budget planner | Editing one ticket tier deletes every other tier, permanently | **new** |
| 2 | MAJOR | money spine | An event with no counterparts can never move its date again | **new** |
| 3 | MAJOR | settlements | An agent's own money reads SEK 0 on every screen | still — **wider** |
| 4 | MAJOR | settlements | The act's card contradicts itself and quotes a commission SEK 500 too high | **new** |
| 5 | MAJOR | budget planner | Derived performer fee held fixed in break-even (65 shown vs 42 true) | still |
| 6 | MAJOR | budget planner | Ticket-split card overstates the act's take, uncaptioned (4,410 vs 3,710) | still |
| 7 | MAJOR | money spine | Deduction and non-operator revenue move the forecast, not the engine | still — **now measured** |
| 8 | MAJOR | event workspace | Inline Status field never saves, silently | still |
| 9 | MAJOR | holds | Two venue-pinned holds both read "1st" — **from the wizard** | still — **root cause corrected** |
| 10 | MAJOR | budget planner | Split card prints 111% and drops the operator's row | **new** |
| 11–32 | MINOR | various | see the sections below | 11 still, 11 new |
| — | NOTE | various | 6, incl. two run-1 notes confirmed and one resolved as a stack artifact | |

**One run-1 claim does NOT reproduce**, and is corrected here: *"the panel offers to promote a hold it
already calls first"*. `Promote to 1st` is `disabled` both when `hold_rank` is NULL and when it is
genuinely 1. The tie itself is real; that half of the sentence is not.

**One run-1 root cause is corrected**: run 1 recorded that `HoldPlacement.tsx` *"gets it right for the
wizard"* and that the rank hole was only reachable through the API. It is not — the wizard counts only
holds with **no venue**, so it never ranks a hold at a venue, which is every normal hold.

---

## What was driven

**All five seeded accounts signed in through the real UI** (Firebase emulator, IndexedDB session), one
at a time, plus `coHost` through `api-as.mjs`. The web app was driven in a real browser throughout;
Postgres was read behind every money claim; `api-as.mjs` was used for setup, for the two-sided halves a
single browser context cannot do, and for rules that live below the screen.

| Account | Browser | API | What was walked |
|---|---|---|---|
| operator | ✅ full | ✅ | every sidebar destination, event creation, the hold wizard, both settlements, the planner, requests, calendar, tasks, contacts import/export, shares, notifications, mobile 390 px |
| performerA (Marlo Vance) | ✅ full | ✅ | every screen, both settlements, setlists, requests in + out, the poster affordance, delegated signing |
| agent (Astra) | ✅ full | ✅ | every screen, both settlements, outgoing requests, delegated accept + confirm, out-of-boundary routes |
| teamAndCrew (Priya) | ✅ full | ✅ | every screen, the event workspace, the settlement workspace, the crew "no vote" rule |
| performerB (Neon Tide) | ⬜ API only | ✅ | settlement scoping, the share-document flow, the SSE probe, a change-request answer |
| coHost (Northlight) | ⬜ API only | ✅ | the fourth answer that resolved the change request |

Also driven: the **marketing site** (`apps/marketing` on :5173, started separately — `pnpm dev` does not
start it), which run 1 could not reach, and the unauthenticated `/public/*` API.

Screens reached: Dashboard, Calendar, Events (list + workspace, every tab), Settlement workspace (every
tab), Tasks, Reports, Setlists, Settlements, Projections, Requests (Incoming + Outgoing), Invoices,
Team, Contacts, Audience, Profiles, Settings, the notification panel, the invitation/share flow, and the
marketing home / profile / event pages. What was *not* reached is listed in full at the end.

---

## Priority 2 — the BLOCKER fix: CONFIRMED FIXED

### Run 1's BLOCKER: "a solo operator's costs never reach the settlement" — **no longer reproduces**

Driven end to end on `Open Mic Wednesdays` (`…e3`) — one operating profile, no co-host, the exact
shape run 1 filed it on — and checked in Postgres at every step, not only on the screen.

**Provisioning is now the right way round.** Opening the Budget Planner on a solo event provisions
**one `shared` ledger and no private book**, so there is no scope chooser and no second book to get
lost in:

```sql
select b.scope, b.owner_profile_id from budgets b where b.event_id = 'e2e…e3';
  shared | (null)          ← one book, and it is the one the settlement copies
```

The seed moved too, as `f996c14` says: `Nordic Synth Showcase` (one operator) now ships a `shared`
book, where run 1 found it `private`.

**A cost typed in the planner now lands in the book the settlement reads.** Typing *Production cost
SEK 1,000* into the planner wrote:

```sql
select b.scope, bl.kind, bl.label, bl.amount from budgets b
  join budget_lines bl on bl.budget_id = b.id where b.event_id = 'e2e…e3';
  shared | cost | Production cost | 100000        ← was `private` before f996c14
```

**And it reaches the reconciliation.** Deal: `guarantee_vs_door`, guarantee SEK 2,000, 70%, signed by
the operator and (correctly, decisions #14) by the **agent** on the represented act's behalf. Then
Settlement → Financials → *Start from the Budget Planner* → *Recalculate*. The settlement's own copy
took **all three** lines, and the waterfall reads exactly what run 1 said it should:

```
Gross revenue        SEK 6,300
Deductions          − SEK 1,000          ← was SEK 0 before f996c14
Net revenue          SEK 5,300
Adjusted net         SEK 5,300
  Marlo Vance   Performer  "The 70% door share beats the SEK 2,000 guarantee"  SEK 3,710  70.0%
  The Lantern Hall Operator "What is left after every other party is paid"     SEK 1,590  30.0%
```

Hand-checked on three rows: 70% × 5,300 = **3,710** ✓; 3,710 > the 2,000 guarantee, so the door
governs ✓; residual 5,300 − 3,710 = **1,590** ✓. Run 1's broken figure was 4,410 / 1,890.

In Postgres, three settlement lines (not two), and **Σ net = 0**:

```sql
select kind, label, amount from settlement_lines where event_id = 'e2e…e3';
  revenue | Advance         | 150000
  revenue | Door entry      | 480000
  cost    | Production cost | 100000        ← the cost is in the settlement

The Lantern Hall | entitlement 159000 | net -371000
Marlo Vance      | entitlement 371000 | net  371000
Astra Booking    | entitlement      0 | net       0
select sum((computed->>'net')::bigint) …  →  0
```

Transfers: Lantern Hall → Marlo **SEK 3,710**, and Marlo → Astra **SEK 371** (10% of 3,710 on
`deal_income`, `representation_id` stamped). Correct.

**Evidence:** `docs/screenshots/qa-2026-09-26-run2/solo-operator-settlement-waterfall-fixed.png`.

**A side effect worth recording as a second pass:** because the planner now reads the shared book, its
own derived performer fee moved from run 1's 4,410 to **3,710** — the same number the settlement pays.
Run 1's note that the fix "also closed the MAJOR about the planner's door forecast reading nothing for
a solo operator" is confirmed: planner and engine now agree on this shape.

---

## Ran's 2026-09-21 spec — held to the letter again

| Spec point | Run 1 | Run 2 | Evidence |
|---|---|---|---|
| Fee appears from the **DRAFT** deal, before any confirmation | PASS | **PASS** | Deal left `status: draft`, `agreement_status: draft`; planner read **SEK 3,710** with *"still an offer, nobody has confirmed it"* |
| Fee is **computed live** from ticket quantity × price | PASS | **PASS** | Door qty 60 → 70 moved the fee within one flush |
| `max(guarantee, share)` for guarantee-vs-door | PASS | **PASS** | Guarantee 2,000 → 5,000 flipped the basis line to *"the guarantee beats the 70% door share"* |
| Operator edits the **assumptions**, never the fee | PASS | **PASS** | The Performer-fee row renders **no input at all** — verified by enumerating every `<input>` on the planner; nothing is stored |
| Editing offered terms while pending **re-seeds** | PASS | **PASS** | `PATCH /deals/… {"guaranteeAmount":"500000"}` while `sent`/pending → 200, and the planner moved 3,710 → **5,000** with the reason line rewritten |
| On confirmation the terms **freeze** | PASS | **PASS**, at the server | see below |
| The freeze **must not be silent** | PASS | **PASS** | `· PROPOSED` badge and the *"Nobody has confirmed these terms yet"* sentence disappear on confirmation; the basis sentence stays |
| "Start from the Budget Planner" imports a **non-empty** budget | PASS (shared only) | **PASS, now for the solo case too** | the BLOCKER section above |

The server-side freeze (`467d0b3`), re-run against the live API on the newly confirmed deal:

```
PATCH /deals/e0643865…  {"guaranteeAmount":"500000"}        → 409 conflict
  "These terms are frozen — guaranteeAmount cannot change on a confirmed agreement.
   Reopen it for renegotiation first: POST /deals/e0643865…/reopen"
PATCH /deals/e0643865…  {"splitBasisPoints":9000}           → 409, names splitBasisPoints
PATCH /deals/e0643865…  {"guaranteeAmount":"200000","splitBasisPoints":7000}  → 200 (no-op save)
postgres: guarantee_amount 200000, split_basis_points 7000, confirmed_snapshot written
```

Signing the agreement also advanced the event `draft → confirmed` on its own, which is the domain
path run 1 recorded.

---

## Findings — new in this run

### [BLOCKER] Budget Planner — editing one ticket tier silently deletes every other tier the event had listed, permanently

**As:** operator, on any event whose ticket tiers live on Event Details (`events.extras.ticketTiers`)
and have not yet been written to the budget — which is the state **every** such event is in until the
planner is first touched.

**Steps:**
1. `Open Mic Wednesdays` lists two tiers on Event Details: **Door entry 60 × SEK 80** and
   **Advance 25 × SEK 60**. The Budget Planner shows both, totalling **SEK 6,300** — correctly, as
   seeds (`budget_lines` holds no tier row at all at this point).
2. Change **one** number in **one** row — the Advance quantity, 25 → 30. Blur.

**Expected:** the edited row is stored and the other row is stored as it stands. The seeding branch
says so in its own comment (`useBudgetEditor.ts:973`): *"A suggestion, never an overwrite: this branch
is only reached when the budget has no tiers of its own."* Overwriting is one thing; **deleting** the
tier the operator typed on Event Details is another.

**Actual:** the Door entry row **vanishes from the planner and is never written**. Total ticket
revenue collapses **SEK 6,300 → SEK 1,800**. It does not come back on reload; it does not come back
from `events.extras`, which still lists both tiers.

**Evidence — the wire, one request and only one:**

```
POST /api/v1/events/…e3/budgets/76f117a0…/lines
  {"kind":"revenue","label":"Advance","amount":"180000","collectedBy":"…b8",
   "details":{"basis":"ticket_tier","unitAmount":"6000","quantity":30}}
```

No second POST for Door entry. Afterwards:

```sql
select bl.label, bl.amount, bl.details from budget_lines bl … where b.event_id='e2e…e3';
  Advance | 180000 | {"basis":"ticket_tier","quantity":30,"unitAmount":"6000"}
  -- Door entry: absent
select extras from events where id='e2e…e3';
  {"ticketTiers":[{"name":"Door entry","price":80,"est":60,…},{"name":"Advance",…}]}   ← still there
```

**Why it happens.** `useBudgetEditor.ts:953` reads
`serverTiers.length > 0 ? serverTiers : seedSource.ticketTiers…`. The flush persists only the row the
operator touched, so the budget goes from *no* tier rows to *one*; the ternary then flips to the
server list and the remaining seeds are dropped on the floor. The seed is all-or-nothing where the
write is per-row.

**Blast radius.** The lost revenue is lost to the **settlement** as well — `copyBudgetOnce` copies the
budget, and the budget no longer has the tier. On this event that is SEK 4,800 of door money, 76% of
the night's takings, and it would settle as if it had never been sold.

**Reproduced twice**, from opposite directions: first by editing the Door entry quantity (Advance
vanished, revenue 6,300 → 5,600), then — after clearing the stored row so both seeds returned — by
editing the Advance quantity (Door entry vanished, revenue 6,300 → 1,800). The second run is the one
with the network capture above.

**Evidence:** `docs/screenshots/qa-2026-09-26-run2/tier-loss-and-111-percent.png`.

**Scope:** any event with two or more tiers on Event Details. The seeded Album Release is **not**
affected, because its tiers are already real `budget_lines` — which is why neither run 1 nor the
branch's own verification met this. `Open Mic Wednesdays` is the only seeded event carrying
`extras.ticketTiers`, and it is the shape ClickUp `86cbcn1ue` asked for ("it should first go to budget
planner from event details and then to settlement").

---

### [MAJOR] The ticket-split card prints a performer percentage over 100% and drops the operator's row entirely

**As:** operator. Found while reproducing the tier loss above, and reproducible on its own whenever
the guarantee exceeds the share of the base.

**Steps:** on a `guarantee_vs_door` deal (guarantee SEK 2,000, 70%), reduce ticket revenue until 70%
of the base falls below the guarantee — here SEK 1,800 of tickets against SEK 1,000 of costs, base
SEK 800.

**Expected:** a share card is a division of one quantity. decisions #24.1 makes the percentage a
share of the adjusted net; a party cannot hold 111% of it, and the operator's line is *"what is left
after every other party is paid"* — which is negative here, and is the fact the operator most needs.

**Actual:**

```
HOW TICKET REVENUE SPLITS
111% performer
GUARANTEE VS DOOR · PROPOSED
Marlo Vance · Performer  111%   111%  SEK 2,000
The guarantee beats the door — 70% of the door falls short of it, so the guarantee is paid.
```

One bar, 111%, and **no operator row at all** — the card silently omits the party that is losing
money. The headline above it reads *"111% performer"*.

**Scope:** every guarantee-governed night whose takings fall short. Not dependent on the tier bug —
it is reachable by lowering a quantity or raising a guarantee on any such deal.

---

### [MAJOR] On an event with no counterparts, the date can never be moved again — the change is diverted into a proposal that nobody can answer and nothing applies

**As:** operator, on `Nordic Synth Showcase` (`…e4`, seeded: `on_hold`, **The Lantern Hall is the only
participant**) and independently on `Winter Gala` (`…e5`).

**Steps:**
1. Event Details → **Date** → 2 Dec 2026 → 9 Dec 2026 → Enter.
2. The request goes out: `PATCH /api/v1/events/…e4 {"eventDate":"2026-12-09","expectedVersion":1}` →
   **200**.
3. The screen still reads **2 Dec 2026**. No toast, no banner, no error.
4. Reload. A banner appears: *"A change to this booking is waiting on an answer — Date 2 Dec 2026 →
   9 Dec 2026. Your answer is in."*

**Expected:** the diversion itself is designed and right (`events.ts:1299`, ClickUp `86cbcftg3` —
from `pending` up, a date change is a question, not an edit). But a question put to **nobody** has to
resolve, and the operator has to be told at the moment they ask, not on the next page load.

**Actual:** the proposal is permanently pending with zero required answers, and there is no control
anywhere to apply, withdraw or cancel it:

```
GET /events/…e4/change-request   (as operator)
  { "changes": {"eventDate":"2026-12-09"}, "previous": {"eventDate":"2026-12-02"},
    "required": 0, "confirmed": 0, "declined": 0, "answerable": false }

select status, changes from event_change_requests where event_id='e2e…e4';
  pending | {"eventDate": "2026-12-09"}
select event_date, version from events where id='e2e…e4';
  2026-12-02 | 2          ← version bumped, date untouched
```

Re-asking only supersedes the previous row (verified on `…e5`: the first proposal went `superseded`
and a second identical one was created). The date stays where it is, for ever.

**Evidence:** `docs/screenshots/qa-2026-09-26-run2/date-change-stuck-solo-event.png`.

**Scope:** any event at `pending` or beyond whose only participant is the host — the default shape of
a venue holding a date for its own night, and the shape the seed ships (`Nordic Synth Showcase`). An
event that *has* a counterpart is unaffected; this is the `required: 0` case.

**Two separable defects here,** worth splitting when this reaches the board: (a) a proposal with no
counterparts never applies; (b) the PATCH answers **200 with the old date** and the UI says nothing
until a reload, so even on a multi-party event the operator gets no feedback that their edit became a
question.

---

## Findings — run 1's open findings, re-verified

### [MAJOR] Derived performer fee is fixed in the break-even model — **still reproduces**

Code unchanged: `enteredCosts = sum(inputs.costs)` (`packages/shared/src/budget-planning.ts:277`) and
the `readFromDeal` row is in `inputs.costs`.

Measured live on Open Mic (70% guarantee-vs-door, Door 60 × 80 + Advance 25 × 60, one SEK 1,000 cost,
1.5% processing, capacity 80):

```
screen:  TOTAL REVENUE 6,300 · TOTAL COSTS 4,805 · BREAK-EVEN TICKETS 65
         chart caption: "Revenue passes total cost at 65 tickets of 80 capacity."
```

65 is reproducible from the fixed-fee model: fixed costs 3,710 + 1,000 = 4,710, contribution per head
74.1 × (1 − 0.015) = 73.0, 4,710 / 73.0 = 64.5 → 65. Solving it with the fee **moving**, as
`budget-planning.ts:289` says every attendance-dependent term must be: below R ≈ 3,857 the guarantee
governs, so `R − 2,000 − 1,000 − 0.015R = 0` → R = 3,046 → **42 tickets**. The screen overstates
break-even by 55%.

Run 1 measured 427-of-400 on the Album Release; this run measured 65-versus-42 on a second event with
a different deal basis, so the defect is not specific to a 100% split.

### [MAJOR] The ticket-split card overstates what the performers get, uncaptioned — **still reproduces, and now on one screen at one moment**

The fix to the solo-operator ledger made this sharper rather than softer, because the planner's fee
row now subtracts the cost and the split card still does not:

```
HOW TICKET REVENUE SPLITS : Marlo Vance  70%  SEK 4,410      (= 70% of the 6,300 gross door)
                            The operators 30%  SEK 1,890
Costs → Performer fee     :               SEK 3,710          (= 70% of the 5,300 adjusted net)
```

SEK 700 overstated, 18.9%, with **no caption**. `grep -rn "box office only" apps/web/src` returns one
hit, a comment in `useBudgetSeed.ts:516`; the rendered caption exists only on the settlement
(`EventSettlement.tsx`). The card's own summary line still says *"70% of the door"*, which is true of
the card and false of what is paid — and the settlement screen one click away pays 3,710.

**Evidence:** `docs/screenshots/qa-2026-09-26-run2/openmic-draft-fee-3710-vs-split-4410.png` — both
figures visible in one screenshot.

### [MAJOR] An agent's Settlements screen shows SEK 0 on every event they earn commission on — **still reproduces**

Reproduced on the wire on a freshly settled event (Open Mic), not a leftover:

```
GET /settlements  (as agent)
  items: [ { participantId "544c276e…", entitlement "0", net "0",
             event: { title "Open Mic Wednesdays", status "confirmed" } } ]
```

while the same account's event-scoped read on the same event returns the money:

```
GET /events/…e3/settlements  (as agent)
  commissions: [{ performerEntitlement "371000", commission "37100", agentCollects false }]
  transfers:   [ 4755c8a6… → 544c276e…  37100  (representationId set) ]
```

SEK 371 owed, SEK 0 shown. Root cause is unchanged: a commission is credited as a transfer and as
`commissionEarned`, never as an `entitlement`, and the list projection carries neither.

**This is the same finding as "An agent's own money is SEK 0 on every screen they can open" below,
where it is driven in the browser and shown to be wider than the list endpoint. Counted once.**

### [MAJOR] The inline Status field never saves, silently — **still reproduces**

Re-driven on `Winter Gala` (`…e5`, seeded `cancelled`):

```
click Status → "On hold" → Enter → click away
network: ZERO non-GET requests   (captured with a request listener over the whole interaction)
aria-label afterwards: "Status, Cancelled, edit"
select status, version from events where id='e2e…e5'  →  cancelled | 1
```

**Isolated to this field, proved in the same session:** the Capacity row directly below it, the same
inline component, sent `PATCH /api/v1/events/…e5 {"capacity":…,"expectedVersion":1}` on the very next
interaction. And `PATCH /events/…e5 {"status":"on_hold"}` from `api-as.mjs` works perfectly. The API
is fine; the wiring on this one control is dead.

### [MAJOR] Two holds on one night both read "1st" — **mechanism still reproduces**

`events.hold_rank` is still nullable with no default and every reader still renders `row.holdRank ?? 1`
(`routes/holds.ts:150`, `:627`). Proved that the non-wizard path still assigns nothing:

```
PATCH /events/…e5 {"status":"on_hold"}  → 200
select title, status, hold_rank from events where status='on_hold';
  Nordic Synth Showcase | on_hold | 1
  Winter Gala           | on_hold | (null)      ← renders as "1st"
```

I could not put these two on the **same date** to re-photograph run 1's panel, because moving a held
event's date is now blocked by the change-request defect above — which is itself the finding that makes
this one harder to reach.

**Reached another way and confirmed in full below** — *"Two venue-pinned holds on one night both read
'1st' — and it happens through the wizard"* — with the screenshot, the DB rows and a corrected root
cause. **Counted once.**

### [MINOR] Deal, planner and settlement give the split base three different names — **still reproduces**

Read off the live screens in one journey: the new-deal dialog and the agreement card say **"Share of
the pool (%)" / "Share of the pool 70%"**; the planner's derived row says *"the 70% door share"* and
its card summary *"70% of the door"*; the settlement's waterfall says **"Adjusted net — what
percentages divide"**. In `reconcile`, `pool` and `adjustedNet` are different quantities, so "share of
the pool" names the wrong one.

### [MINOR] Display-currency preview leaves the ticketing rows in SEK — **still reproduces**

Settlement → EUR:

```
Gross revenue €544 · Deductions −€86 · Net €457 · Adjusted net €457
Marlo Vance €320 · The Lantern Hall €137
Ticketing:  Advance — 25 x SEK 60   SEK 1,500
            Door entry — 60 x SEK 80  SEK 4,800      ← still SEK
```

**Evidence:** `docs/screenshots/qa-2026-09-26-run2/settlement-eur-mixed-rows.png`.
**The correct halves, re-verified:** the conversion is right (6,300 × 0.0863 = 544; 3,710 → 320;
1,590 → 137), a **new banner** states the rule outright — *"Preview only. These figures are converted
from SEK at a live rate for reading — the settlement is denominated in SEK, and that is what is owed,
recorded and paid"* — and **no stored amount moved** (`settlement_lines` 150000 / 480000 / 100000 and
every `computed.entitlement` unchanged after the switch). The `≈` prefix the planner uses is still
absent on the settlement.

### [MINOR] The currency chooser offers four currencies it cannot convert to, and fails silently — **still reproduces**

The chooser lists SEK, EUR, NOK, DKK, GBP, USD, JPY, KWD. Choosing **JPY** fires
`GET /api/v1/exchange-rate?from=SEK&to=JPY` → **404** (twice), and the screen stays in SEK with no
message at all.

### [MINOR] Rounding makes the planner's three headline figures disagree — **still reproduces**

`TOTAL REVENUE SEK 6,300 · TOTAL COSTS SEK 4,805 · PROFIT / LOSS SEK 1,496`. 6,300 − 4,805 = 1,495.
Both roundings are individually right (costs 480,450 minor → 4,804.50; profit 149,550 → 1,495.50), and
the displayed figures still do not add up.

### [NOTE] Payment processing is in the planner's profit and never in the settlement — **confirmed still true, still deliberate**

The planner charged Open Mic SEK 95 (1.5% of 6,300); the settlement's Deductions are SEK 1,000, the
production cost alone. Planned-vs-actual shows Costs 1,000 → 1,000, +0 — the SEK 95 is in neither
column, so it is invisible rather than a phantom variance on this shape.

### [NOTE] A deal that pays crew is invisible to the planner — **not re-driven this run**

`performerParticipantIds` (`EventDetail.tsx:249`) still filters to `performer`/`support`. Left as run 1
filed it; I did not build a crew deal. (Restated once more at the end of this file under *Remaining
run-1 findings* — counted once.)

---

## What passed in the money spine

- Every point of Ran's 2026-09-21 spec (table above).
- Server-side terms freeze, including the named field in the 409 and the permitted no-op save.
- **Σ net = 0** on a freshly computed settlement: operator −371,000, Marlo +371,000, agent 0.
- The **waterfall order** of decisions #24.1: gross → deductions → net → (no rental) → adjusted net,
  with *"Adjusted net — what percentages divide"* labelled as such.
- **Per-party money scoping (decisions #24.3) holds exactly**, re-measured on the new settlement:

| Reader | Settlements returned | `ladder` | Transfers seen |
|---|---|---|---|
| operator | 2 — b8 `159000`, Marlo `371000` | **populated** (`revenue 630000 … adjustedNet 530000`) | operator → Marlo only |
| performerA | **1** — their own, `371000` | **null** | operator → Marlo, **and** Marlo → agent |
| agent | 2 — their act's and their own | **null** | Marlo → agent only |
| performerB / crew | **404** — not on this event | — | — |

  The operator sees neither the commission transfer nor the agent's row; the act sees its own line and
  the commission coming off it. Hand-checked: 159,000 + 371,000 = 530,000 = the adjusted net.
- **Agent commission arithmetic:** 10% of 371,000 = **37,100**, `commissionableBasis: deal_income`,
  `agentCollects: false`, matching the `representations` row.
- `extras.ticketTiers.price` major → minor: Door entry SEK 80 stored as `unitAmount "8000"`. The known
  trap is still not present.
- **Representation expansion still works:** adding Marlo Vance (represented by Astra) to Open Mic
  auto-created an `agent` participant row for Astra **mirroring the act's `invited` status** — not
  auto-accepted.
- **Delegated answering is right in both halves:** `POST /events/…e3/participation/accept` as
  **performerA** → 404 (their agent answers for them, decisions #14), as the **agent** → 200, and the
  agent's own row moved with it. `GET /me/event-invitations` showed the invitation in the **agent's**
  inbox and **not** in performerA's.
- The settlement refused to compute nothing: before any deal was signed the Overview said *"This event
  has not been reconciled yet"* rather than inventing zeros.

---

## Area 2b — run 1's MAJOR-4, now measured rather than read

Run 1 filed *"a deduction and a non-operator's revenue move the forecast but not the engine"* by reading
the two implementations and said plainly it had not been driven to a settled number. It has been now,
on the **Album Release** (`…e1`, co-hosted, `door_split` 100% of adjusted net divided 60/40 between
Marlo Vance and Neon Tide, four stored costs totalling SEK 33,000, tickets SEK 83,000). **It
reproduces, and the money is real.**

**First: the co-hosted half of `f996c14` also works.** The planner on this event shows the
**Shared ledger / My budget** chooser that a solo event correctly does not.

### Half one — a deduction

Set **Green-room catering SEK 3,500** → *To be deducted from → Marlo Vance* on the planner (written:
`budget_lines.payee_participant_id = …b2`). Then settled.

| | Performer cost | Marlo | Neon Tide |
|---|---|---|---|
| **Planner forecast** | SEK **50,000** (base 83,000 − 33,000) | implied 60% = **30,000** | implied 40% = **20,000** |
| **Settlement paid** | adjusted net **53,500** divided | **28,600** | **21,400** |

The aggregate happens to agree (the deduction comes back as a smaller transfer), but **each act's
share is wrong by SEK 1,400** — Marlo 1,400 low, Neon 1,400 high — because the planner takes the
deduction off the base both acts divide while `costBearingOf`
(`packages/settlement/src/cost-bearing.ts`) leaves the pool alone and charges the named party.
Σ net = 0 and the transfers are internally right (b1 → Marlo 2,860,000, b1 → Neon 2,140,000,
Marlo → Astra 321,000).

### Half two — revenue collected by a non-operator

Added **Sponsorship SEK 5,000, collected by Marlo Vance** — to the planner *and*, through the
settlement's own *Add revenue* control, to the settlement's copy, so both sides saw the same night.

- **Planner:** the derived performer fee moved **SEK 50,000 → 55,000** (base 88,000 − 33,000). Total
  revenue 88,000.
- **Settlement:** an explicit waterfall row appeared — *"Collected by others — kept by the party that
  took it — − SEK 5,000"* — and the acts still divided **SEK 53,500**.

So the planner over-forecasts the performer cost by **SEK 1,500** where the engine excludes the line:
`(88,000 − 83,000) − (33,000 − 29,500) = 1,500`. On this night the two divergences partly cancel;
nothing makes them cancel in general.

**Worth saying for the engine:** it is the planner that is wrong here, not `reconcile`. The engine's
handling is correct and, on the sponsorship, it even names the rule on screen. Σ net = 0 throughout:
operator −5,000,000, Marlo +2,860,000, Neon +2,140,000.

### [MINOR] "Adjusted net divided" does not equal the entitlements printed under it

Same screen, same moment (`docs/screenshots/qa-2026-09-26-run2/e1-adjusted-net-vs-entitlement-sum.png`):

```
ADJUSTED NET DIVIDED   SEK 53,500
  Marlo Vance   SEK 33,600   61.1%
  Neon Tide     SEK 21,400   38.9%
  The Lantern Hall  SEK 0
```

33,600 + 21,400 = **55,000**, and the percentages are computed off 55,000, not the 53,500 the header
says is being divided. The figures are individually correct — Marlo's 33,600 is `60% × 53,500 + 5,000
collected − 3,500 deducted` — but the column mixes three different things under one heading, so the
one arithmetic check a reader can do by eye fails.

### [MINOR] Both parties to a 60/40 split are told they get "100% of the adjusted net … your share of SEK 53,500"

The caption under each act on the same card reads, verbatim and identically for both:
*"100% of the adjusted net SEK 53,500 — your share of SEK 53,500"* — while one is paid 33,600 and the
other 21,400. It is describing the **deal's** claim on the pool, not the party's line, on a card whose
every other figure is per-party.

### [MINOR] The commission's `performerEntitlement` disagrees with the act's own settlement entitlement

`GET /events/…e1/settlements` returns, in one payload:

```
commissions[0].performerEntitlement = "3210000"   (SEK 32,100 — before the act's own deduction)
settlements[Marlo].computed.entitlement = "3360000"  (SEK 33,600)
```

Two fields named for the same thing, SEK 1,500 apart, in one response. Whether a 10% commission should
be charged on the pre-deduction figure is a product call (decisions #14 does not say); the field
sharing a name with a different number is the defect.

### [MINOR] A line added on the settlement's Financials tab needs an explicit **Add**, and nothing says so

Filed at MINOR because it cost me three probes before I saw it: *Add revenue* opens a draft row with
**Add / Cancel** buttons, but typing a name and amount and then blurring, pressing Enter, or pressing
**Recalculate** all silently discard the row — no request, no warning, and the half-typed line vanishes
from the screen. Pressing **Add** works correctly
(`POST /events/…e1/settlement/lines {"kind":"revenue","label":"Sponsorship","amount":"500000","collectedBy":"…b2"}`).
Recalculating with an unsaved draft on screen is exactly when an operator will lose a figure.

### [NOTE] The settlement's own cost rows have no "To be deducted from" control

The planner's Costs card has both **Carried by** and **To be deducted from**; the settlement's copy has
only **Carried by** (verified by enumerating every `aria-label` on the Financials tab). So a deduction
agreed after the copy was taken cannot be entered on the settlement at all — it has to go back to the
budget, and the budget is not what the settlement reads once copied. Recorded rather than filed as a
bug because it may be deliberate.

---

## Area 3 — booking: holds, hold ranking, promotion, requests in both directions

Run 1 reached the hold *pool* but not promotion, and reached the Requests screen but sent nothing. Both
were driven here.

### [MAJOR] Two venue-pinned holds on one night both read "1st" — and it happens through the **wizard**, the one path run 1 believed was correct

**As:** operator. **Evidence:** `docs/screenshots/qa-2026-09-26-run2/two-first-holds-from-the-wizard.png`.

**Steps:**
1. `Nordic Synth Showcase` is seeded `on_hold` on **2 Dec 2026** at **The Lantern Hall**, `hold_rank = 1`.
2. Calendar → 2 Dec 2026 → **Hold** (the only entry point to hold mode there is, see below) → name the
   act, pick **The Lantern Hall** from MY PLACES, room *The whole venue* → **Place Hold**.
3. Read the **HOLD PRIORITY** field before submitting, and the hold panel afterwards.

**Expected:** decisions **#20** — the hold pool is one queue per room, and the server pools by
`(event_date, venue, stage)`. A second hold on the same date at the same venue is the 2nd.

**Actual:** the wizard's own priority field says, with the venue already chosen and the
double-booking notice on the same screen naming the competitor:

```
DATE *            Already on this night: "Nordic Synth Showcase" and 1 more. This room is still free.
HOLD PRIORITY     1st hold
                  No hold is competing for this date yet, so this is the 1st hold.
                  One other hold on this date is attached to a venue, and queues separately.
```

and the hold lands with **no rank at all**:

```sql
select title, status, hold_rank from events where event_date = '2026-12-02';
  Nordic Synth Showcase | on_hold | 1
  QA Run2 Second Hold   | on_hold | (null)      ← placed through the wizard
```

The panel then shows the tie:

```
2 HOLDS ON THIS DATE
  1st   Nordic Synth Showcase
  1st   QA Run2 Second Hold   ·  This event  ·  Frozen  ·  1st hold
        [ Promote to 1st ]  ← DISABLED, because the panel believes this hold is already first
```

**Root cause, and it is one line.** `useHoldPlacement` (`apps/web/src/components/HoldPlacement.tsx:137`):

```ts
const competingHolds = sameDate.filter(
  (hold) => hold.venueProfileId === null && hold.stageId === null && hold.hostProfileId === hostProfileId,
).length;
```

It counts only holds with **no venue**. A hold pinned to a venue — the normal case — is excluded and
reported by the separate `holdsPinnedToVenue` line as *"queues separately"*, which is the opposite of
what the server does. `competingHolds` is therefore 0, `maxRank` is 1, and the guard four lines later —
`if (holdRank === 1 && competingHolds === 0) return { kind: "on_hold", holdRank: 1 }` — **skips the rank
write entirely**. `hold_rank` stays NULL and every reader renders `row.holdRank ?? 1`.

**Correction to run 1:** it recorded *"`HoldPlacement.tsx:190` gets it right for the wizard: it counts
competing holds and calls `POST /hold/rank` when there are any"*. It counts only **unpinned** competing
holds, so for a venue it never calls the route. This is the wizard, not the API back door.

**Also worth knowing:** the remedy is unreachable from the UI. `Promote to 1st` is `disabled` while the
rank is NULL (the panel thinks it is already first), so the operator cannot break the tie; the
`hold_rank` field has no other control. Only `POST /events/:id/hold/rank` fixes it.

**Run 1's second half does NOT reproduce:** *"the panel offers to promote a hold it already calls
first"*. `Promote to 1st` is `disabled` both when the rank is NULL and when it is genuinely 1 — verified
in both states.

### [MINOR] "Place a hold" exists only in the Calendar's day menu

The hold-mode wizard is reached from exactly one place: Calendar → click a day → **Hold**
(`Calendar.tsx:1202` is the only caller passing `initialStatus: "on_hold"`). The Events screen's
**New event** button and its row menus offer no hold, and the event workspace's only status control is
the dead inline Status field below. The wizard's own fallback toast makes the dead end explicit:
*"saved as a draft. It is not on hold yet — **set its status when you're ready**"* — which is precisely
the control that sends no request.

### What passed — holds

- **Ranking, once a rank exists, is right.** `POST /events/…/hold/rank {"holdRank":2}` returned the
  whole recomputed ordering (`e4 → 1`, new hold → `2`) and wrote it; the panel then read **1st Nordic
  Synth Showcase / 2nd QA Run2 Second Hold**, with the 2nd marked **Frozen**.
- **Release repacks exactly as its own dialog promises.** *"The date stops being held for this event and
  the event is cancelled. Every hold below it moves up one — unless it is frozen."* Releasing the 1st
  hold cancelled it and the 2nd, being frozen, **kept rank 2** — then read *"2nd hold · NOTHING ELSE IS
  COMPETING FOR THIS DATE"* with `Promote to 1st` now **enabled**, and promoting it wrote
  `POST /hold/rank {"holdRank":1}` and moved it to 1st, after which the button correctly went
  `disabled`. The whole promote / freeze / release cycle behaves as documented.
- **Double-booking warnings still warn without blocking**, and they are room-aware:
  *"Already on this night: "Nordic Synth Showcase" and 1 more. This room is still free."*
- **Venue prefill still states the one-time-copy rule on screen**, unchanged from run 1.
- **`hold_auto_promote` is honoured** — the frozen hold did not move when the hold above it went away,
  which is the flag's whole purpose.

### What passed — requests, and the outgoing direction driven

- The Requests screen renders six requests across a month rail with Cards/List, status chips
  (Pending / Unread / All / Accepted / Declined / Flagged / Archived / Expired) and per-card actions
  **Create Draft · Make Offer · Decline · Block · Archive**.
- **An outgoing counter-offer works end to end.** *Make Offer* on the agent-routed request
  (`…f7`, Astra Booking on behalf of Marlo Vance) → fee 26,000–30,000, message, 8 Dec →
  `POST /booking-requests/…f7/counter-offer` → and the notification landed:

  ```sql
  select user_id, type, title from notifications order by created_at desc limit 1;
    e2e-agent | booking_request.counter_offer | The Lantern Hall replied with terms
  ```

  Delivered to the **agent**, which is right (decisions #14). The request stayed `pending` and its
  stored fees were untouched — deliberate, and documented at `routes/inbound.ts:1656`: a counter-offer
  is a message plus an audit row, not a status move.
- An **off-platform** requester (public form, email only) is handled separately and the dialog says so:
  *"Your terms go straight to The Midnight Echo at anders@midnightecho.showme.test."*

### [MINOR] The counter-offer dialog names the act when the terms go to the agent

For the agent-routed request the dialog reads *"Your terms go straight to **Marlo Vance's** inbox"*,
while the notification is delivered to `e2e-agent` — correctly, since Astra sent it and Astra answers
for Marlo. The copy names the party who will not receive it.

### [MINOR] The Requests date rail ignores the status filter, and the empty state does not say so

The **REQUESTS BY DATE** column lists 3 Oct 2026 / DJ Frostbite. Clicking it selects the day and the
list reads *"No requests match this view."* — because that request is `Declined` and the active chip is
**Pending**. Switching to **All** shows it immediately. The rail offers days the current filter hides,
and the empty state gives the reader no way to work out why.

---

## Area 5 — calendar and tasks, driven

### What passed

- **Tasks create end to end.** *New Task* → title, **work-group Core Crew**, due 5 Oct 2026 →
  `POST /api/v1/tasks {"title":…,"dueDate":"2026-10-05","groupId":"…301"}`; the header count moved
  **4 open → 5 open** and the task appeared under **CORE CREW**.
- **A task appears on the calendar grid**, on the right day: `/calendar?date=2026-10-05` renders
  *"QA run2 — check the door float"* on the 5th, and the `?date=` deep link opened October 2026.
- **Month / Week / Day all work**, with `Previous month` / `Today` / `Next month` / `Jump to date`,
  and Day view correctly summarises *"Mon, 5 Oct 2026 — 1 ENTRY — All day — QA run2 … — Task"*.
- **Unavailability marks and unmarks, and reaches the public read.** *Mark Unavailable* → 20 + 21 Oct →
  *Done marking* wrote `PUT /profiles/…a1/unavailability {"entries":[{"startDate":"2026-10-20","endDate":"2026-10-21",…}]}`,
  both days rendered **UNAVAILABLE**, and the unauthenticated
  `GET /public/profiles/e2e-the-lantern-hall/availability` returned
  `[{2026-05-19…},{2026-10-20 → 2026-10-21}]`. Clicking the same two days again wrote
  `{"entries":[]}` and the marks went away — so the wholesale-replace `PUT` round-trips correctly in
  both directions.
- **Room-aware availability still holds (the 2026-09-21 fix).** Two confirmed events at the venue —
  Open Mic in Back Room (3 Oct) and the Album Release in Main Room (13 Oct) — and neither date is
  published as unavailable, because one of two rooms remains free each night. Correct.
- **Venue and room filters work.** Filtering to *The Lantern Hall → Back Room* left only
  `Open Mic Wednesdays` on the October grid.
- The Tasks screen groups by work-group with counts, and has List/Board plus
  All / My Tasks / Open / Done / Event / Profile / Personal filters, all rendering.

### [NOTE] A task has no per-person assignee

The New task dialog offers title, **work-group**, note, priority, due and *remind me* — there is no
"assign to a person". Assignment is by work-group only. Recorded rather than filed, because the screen
says so outright (*"Grouped by work-group — the reusable rosters you share with Team"*); run 1 listed
"assign" as unreached and this is the answer.

---

## Area 0/4 — the account kinds, one at a time

### [MAJOR] The act's own settlement card contradicts itself, and quotes an agent commission SEK 500 higher than the one actually owed

**As:** performerA (Marlo Vance), on the Album Release, signed in through the real UI.
**Evidence:** `docs/screenshots/qa-2026-09-26-run2/performer-commission-3710-vs-stored-3210.png` and
`…/performer-commission-card.png`.

**Steps:** Settlements → *Marlo Vance — Album Release* → **Settlement** tab.

**Actual, one card, read top to bottom:**

```
Marlo Vance (you)   Performer                                  SEK 33,600
  100% of the adjusted net — your share of SEK 53,500          SEK 32,100
  Less costs somebody else fronted on your behalf            − SEK  3,500
  — Green-room catering                                      − SEK  3,500

Total Payouts        Marlo Vance payout   SEK 28,600
                     Total payable        SEK 28,600

AGENT COMMISSION — PRIVATE TO YOU AND YOUR AGENT
  Marlo Vance entitlement                                      SEK 37,100
  Commission to Astra Booking Agency                           SEK  3,710
```

**Two defects, both in money the act reads to decide whether they were paid right:**

1. **The rows do not add up to the headline.** 32,100 − 3,500 = 28,600, which is the payout at the
   bottom — but the headline says **33,600**. The missing SEK 5,000 is the sponsorship line Marlo
   collected, and it appears nowhere on this card. The reader is shown three numbers and given the
   arithmetic for two of them.
2. **The commission is wrong on the screen.** The card says the agent takes **SEK 3,710** on an
   entitlement of **SEK 37,100**. What the settlement actually created is:

   ```
   GET /events/…e1/settlements  →  commissions[0] { performerEntitlement "3210000", commission "321000" }
   select amount from settlement_transfers where representation_id is not null;  →  321000
   ```

   **SEK 32,100 and SEK 3,210.** The screen's base is `entitlement + deductibles` (33,600 + 3,500 =
   37,100); the engine's is the deal entitlement (60% × 53,500 = 32,100). The act is told their agent
   is owed SEK 500 more than the transfer the settlement wrote.

**Bounded:** on a clean shape the two agree. On `Open Mic Wednesdays` — no deduction, no non-pool
revenue — the same card reads *entitlement SEK 3,710 / commission SEK 371*, exactly matching
`performerEntitlement "371000", commission "37100"`. The divergence needs a deductible or revenue
collected by a non-operator, both of which are first-class controls.

### [MINOR] A performer's own settlement says they take "100.0%" and "your share of SEK 53,500"

Same screen, Overview tab: *"Marlo Vance (you) · Performer · **100% of the adjusted net — your share of
SEK 53,500** · SEK 33,600 · **100.0%**"*. Marlo's deal share is 60%, Neon Tide has the other 40%, and
Marlo is paid 33,600 of a 53,500 adjusted net. The 100% is the deal's claim on the pool and the
percentage column is "of the rows shown", which for a performer is always one row — so the number is
always 100.0% and always means nothing. **Evidence:**
`docs/screenshots/qa-2026-09-26-run2/performer-own-settlement-100-percent.png`.

### [MINOR] Bills & Invoices still defaults to € for a performer — **still reproduces**

`OUTSTANDING (PAYABLE) €0 · OVERDUE €0 · RECEIVABLE (SENT) €0` as Marlo Vance, whose events, deals and
settlements are all SEK and whose own Settlements screen reads SEK throughout. The operator's Invoices
screen reads `SEK 9,000`.

### [MINOR] A performer is offered an enabled **Remove** on a poster they may not touch, and gets the capability name — **still reproduces, verbatim**

Album Release → Event Details → Show Poster. **Replace** is correctly `disabled`; **Remove** is
`enabled`. Pressing it:

```
PATCH /api/v1/events/…e1   →  403
toast: "Missing capability: event.edit"
select image_url from events where id='…e1'  →  unchanged
```

The rule holds; the affordance and the copy do not. The card above it already says *"Only the profile
operating this show can change its poster."*

### [MINOR] "Total settled SEK 0" beside "Finalized SEK 20,700" — **still reproduces, on every kind**

Operator: `TOTAL SETTLED SEK 0 · PENDING REVIEW SEK 1,590 · OUTSTANDING SEK 22,290 · FINALIZED
SEK 20,700`, with the Open Mic row's own status chip reading **Open** while the tile counts it as
"Pending review". performerA shows the same shape: `SEK 0 / 37,310 / 83,810 / 46,500`. Not specific to
the operator, as run 1 had it.

### [MINOR] "Edit" a collaborator still changes role only — **still reproduces**

Album Release → Collaborators → *Actions for Priya Sound* → **Edit**. Menu copy: *"Change their role on
this event, **and what they may touch**."* Dialog contents: one control, `Role on this event`
(enumerated: Close, Role on this event, Cancel, Save changes). The Invite dialog on the same tab still
offers **ACCESS — Standard for the role**.

### [MINOR] Nested `<button>` on the Venue row — **still reproduces on all five seeded events**

`document.querySelectorAll('button button').length === 1` on `e1…e5`, and React names both components
outright: `EventInlineField` (`aria-label="Venue, The Lantern Hall, edit"`) containing `ProfileNameMenu`
(`aria-haspopup="dialog"`).
**Changed since run 1:** the inner control now flips `aria-expanded` `false → true` on click — but no
popover is rendered anywhere in the document, so it reports itself open and shows nothing, and the
outer field's edit mode opens at the same time. Run 1 recorded `aria-expanded` staying false; the
symptom has moved, the defect has not.

### [MINOR] The dashboard calls `on_hold` events "Pending event", beside a tile that counts Pending as 0

Operator dashboard: *"Confirm Winter Gala — **Pending event** · 5 Jan 2027"* and *"Confirm QA Run2
Second Hold — **Pending event** · 2 Dec 2026"*, while the EVENTS tile on the same screen reads
`Confirmed 2 · Pending 0 · On hold 2`. Both events are `on_hold` in Postgres.

### [MINOR] Financial Projections calls forecast figures "realized revenue"

`PROJECTED REVENUE SEK 227,300 · 7 events budgeted`, and directly under it: *"All time, ignoring the
filter above: **realized** revenue SEK 227,300 across 7 events you operated."* The same number, and it
includes `Winter Gala SEK 0`, `QA Run2 Hold Rival SEK 0` and `QA Run2 Second Hold SEK 0` — events that
have not happened. Only one of the seven has a finalized settlement.

### What passed — performer (browser, real login)

- **Nav composition is right:** Dashboard, Requests, Calendar, Events, Settlements, **Setlists**, Tasks,
  Team, Contacts, Audience, Bills & Invoices, My Profiles, Settings. No Budget Planner, no Performance
  Reports, no Financial Projections.
- **The settlement money boundary is exact on screen, not just on the wire.** The Overview withholds the
  waterfall with a written reason — *"The night's takings and costs are the operator's view of this
  event. Your own settlement, and the rule behind every figure in it, is below."* — and Neon Tide's
  SEK 21,400 line, the gross, the deductions and the adjusted net are all absent. Event tabs offered to
  a performer: To Do, Event Details, Deals, Team / Crew, Setlist, Settlement, Messages, Collaborators,
  Event History — no Budget Planner.
- **Setlists** lists all three of the act's shows, with *Edit setlist* on the one that has 4 songs /
  16:19 and *Write setlist* on the two that do not.
- **Requests has a working Outgoing tab** — the 18 Nov offer Marlo sent themselves, `Pending`, with its
  fee range and message. The 8 Dec offer Astra sent on Marlo's behalf is **not** in the act's outgoing
  list; per decisions #14 that is the agent's, which is defensible but worth a product eye.
- **Payout tab is correctly locked:** *"Payouts are locked — this settlement is open. Finalize it before
  processing payouts."*
- Contacts, Audience, Team and Tasks all render the performer's own (mostly empty) data rather than the
  operator's.

### [NOTE] A counter-offer leaves no trace on the request the act can see

The operator's counter-offer (SEK 26,000–30,000 on 8 Dec) reaches the agent as a notification and an
audit row. On the requester's own Outgoing card the fee still reads the original `SEK 25,000 – SEK
32,000` and the status still `Pending`, with no record of the reply. `routes/inbound.ts:1656` says this
is deliberate ("there is no threaded reply model for booking requests… inventing one is a schema +
product decision"). Recorded so the next reader does not file it as a bug, and because it is the gap a
real negotiation will hit first.

### [MAJOR] An agent's own money is SEK 0 on every screen they can open — **run 1's finding still reproduces, and it is wider than the list**

**As:** agent (Astra Booking Agency), signed in through the real UI.
**Evidence:** `docs/screenshots/qa-2026-09-26-run2/agent-settlements-all-zero.png`,
`…/agent-event-settlement-zero.png`.

Every surface, on two freshly computed settlements:

```
Dashboard      TOTAL SETTLED SEK 0 · PENDING REVIEW SEK 0 · OUTSTANDING SEK 0 · FINALIZED SEK 0
Settlements    Marlo Vance — Album Release  Confirmed  Open  YOUR PAYOUT SEK 0
               Open Mic Wednesdays          Confirmed  Open  YOUR PAYOUT SEK 0
Event workspace → Settlement:
               Astra Booking Agency (you)   Agent   SEK 0
               Total Payouts — "What is payable to you on this event":
                 Marlo Vance payout   SEK 28,600      ← the ACT's payout, under the agent's heading
                 Total payable        SEK 28,600
```

The money exists: `settlement_transfers` holds `Marlo → Astra 321,000` on the Album Release and
`Marlo → Astra 37,100` on Open Mic — **SEK 3,210 + SEK 371 = SEK 3,581** owed to this account, and the
only figure on the agent's own screens is zero.

**Wider than run 1 recorded.** Run 1 filed the list endpoint (`GET /settlements` returning
`entitlement "0", net "0"`), which is confirmed. But the **event-scoped settlement workspace also shows
the agent SEK 0**, and its *"What is payable to you on this event"* card shows the **act's** SEK 28,600
instead — so there is no screen anywhere in the product where an agent can read what they are owed.

### What passed — agent

- Nav: Dashboard, Requests, Calendar, Events, Settlements, Tasks, Team, Contacts, Bills & Invoices,
  My Profiles, Settings — no Setlists, no Budget Planner, no Performance Reports, no Projections,
  no Audience. Correct for the kind.
- Out-of-boundary routes still explain themselves: `/projections` → *"Projections belong to the venue's
  books — a projection rolls up the event budget, which only the operator running the event can see."*;
  `/setlists` → *"A setlist belongs to the act — the performer writes it; the venue reads it on the show
  to report the performance."*
- **Events list is exactly the two events their act is on**, and no others.
- **Requests → Outgoing** shows the 8 Dec offer Astra sent for Marlo (`via Astra Booking`), with the fee
  range and message.
- The agent can see their act's full settlement line (SEK 33,600) — which is the delegation working, not
  a leak.
- Bills & Invoices defaults to **€** here too (same MINOR as the performer).

### What passed — crew (team_and_crew), and the "no vote" rule held to the letter

Ran's 2026-09-21 call — crew can neither propose nor veto a date move, but still see the banner — was
unreached in run 1. Driven end to end here, and **all three halves hold**:

```
POST /events/…e1/change-request        (as crew)     → 403
  "Only the venue and the acts on the bill can ask to move this booking"
POST /events/…e1/change-request/<id>/decline (as crew) → 403
GET  the event workspace               (as crew)     → the banner IS there:
  "A change to this booking is waiting on an answer — Date 13 Oct 2026 → 27 Oct 2026
   — "QA run2 — touring clash" — Waiting on 4 people to answer. Nothing moves until everyone agrees."
   …with NO Confirm/Decline buttons anywhere on the page.
```

- The crew's **Deals** tab copy is right: *"When a deal naming you is sent, its terms appear here for you
  to confirm."*
- Crew's own settlement line reads `Priya Sound (you) · Crew · SEK 0` with the waterfall withheld and the
  reason written out.

### [MINOR] Crew's settlement "Deal structure" tab still asserts a falsehood about the event — **still reproduces, verbatim**

`No agreements on this event yet` on the Album Release, which carries a confirmed `door_split`
agreement. Crew are simply not a party to it. The Deals tab one click away gets the same fact right.

### [MINOR] Refusing a crew member's answer tells them they proposed the change

`POST /events/…/change-request/<id>/decline` as **crew**, on a change **performerA** proposed, returns
403 *"You proposed this change; somebody else has to answer it"*. The outcome is right and the message
is false. The code knows: `events.ts:1720` comments *"Either they asked for it, or they are on the event
without standing to answer. Both are 'somebody else decides', and the message says so rather than
pretending they are not here."* — but the sentence it actually prints names the reader as the proposer.

### What passed — the change-request flow, when there IS somebody to ask

The counterpart to the solo-event MAJOR above. `performerA` proposed 13 Oct → 27 Oct with a reason;
`required: 4`; operator, performerB, agent and coHost each confirmed; on the **fourth** answer the
response flipped to `"status": "confirmed"` and:

```sql
select status from event_change_requests where id='42d9d7ea…';   →  confirmed
select event_date, version from events where id='e2e…e1';        →  2026-10-27 | 2
```

The move also wrote itself into the event's **Everyone** message thread, from both sides
(*"Asked to change the date from 2026-10-13 to 2026-10-27…"* / *"Confirmed the change … The event has
been updated."*). The mechanism is sound; the solo case is the hole.

### What passed — realtime (SSE), re-confirmed

With an operator tab open and unreloaded on the Album Release's Messages tab,
`POST /events/…e1/messages` as **performerB** surfaced *"QA run2 realtime probe from Neon Tide"* within
six seconds, stamped **19:42** for a 17:42Z write — Europe/Stockholm, correctly applied. Message threads
remain party-scoped (Everyone / Operators only / one per performer and per crew member, each naming its
own readers).

### What passed — the share ceiling, re-verified from scratch

The strongest result of run 1, re-run on a **new** share created in this session, with the settlement
now carrying a deduction and a non-pool revenue line:

```
POST /events/…e1/shares  capabilities:[event.view, budget.view, deal.view.own,
                                       settlement.view.own, schedule.view]
                         access: protected, recipients:[performer.b@e2e.showme.test]   → 201

select capabilities from shares …
  {event.view,budget.view,deal.view.own,settlement.view.own,schedule.view}   ← asked for and stored

GET /shares/<token>/document   unauthenticated      → 401 "Recipient verification required"
GET /shares/<token>/document   with ShareBearer <jwt> after the real OTP flow:
  capabilities: ["event.view","deal.view.own","settlement.view.own","schedule.view"]
                                                   ↑ budget.view STRIPPED
  budget:     null
  settlement: Neon Tide's own only — entitlement 2,140,000, one incoming transfer
  deals[0].parties: ONE line, Neon Tide's own (isYours true, 4000 bps)
  no `ladder` key at all; no pool, no adjusted net, no cost labels
```

The OTP arrived by the real mail path (`Verification code: 875031` in the dev log) and the session uses
`Authorization: ShareBearer`, not `Bearer`.

One thing to watch, not filed as a bug: the recipient's own deal line carries
`share.illustrativeAmount "2000000"` — SEK 20,000, 40% of the **pre-deduction** pool — beside a
settlement entitlement of SEK 21,400. The field is named "illustrative", but nothing on the wire tells
the recipient which of the two they will be paid.

### What passed — public disclosure (decisions #19), re-verified

```
GET /public/events/…e1            → {id, title, eventDate, venueName, doorTime, startTime, imageUrl}
GET /public/events/…e3 (unpublished) → 404
GET /public/profiles/e2e-the-lantern-hall → name, type, bio, tagline, avatar, banner, photos
```

No capacity, no notes, no deal, no budget, no crew names. The published event's date had moved to
**2026-10-27** by then, which is also a live check that the change-request write reaches the public read.

---

## Area 6 — the marketing site, reached this run

Run 1 could not reach `apps/marketing` because `pnpm dev` does not start it. It starts on its own
(`pnpm --filter @showme/marketing dev`, Vite on **5173**, ready in 403 ms) and was driven against the
same live API.

### What passed

- **Home** (`/`) renders in full with **zero console errors and zero failed requests**:
  *"Run your events, not your inbox."*
- **Public profile** (`/profile/e2e-the-lantern-hall`) renders what's on, the room, and how to find it —
  and draws the disclosure line on screen: *"House tech spec, patch list and load-in notes are shared
  with signed-in artists and crew — **never on the open web**."* Zero console errors.
  It listed exactly one upcoming show, at the date the change-request had just moved it to
  (**Tue 27 Oct**), which is a live check that a confirmed date change reaches the public read.
  `Open Mic Wednesdays` — `confirmed` but `published: false` — is correctly absent.
- **Public event** (`/event/…e1`) renders date, times, venue and the RSVP form, with the consent
  sentence decisions #16 asks for: *"Your name, email and city go to the organiser of this event so
  they can count on you and tell you about it. Nothing else is sent, and this page stores nothing on
  your device."*
- **An unpublished event does not leak or crash**: `/event/…e3` renders *"This event isn't public — the
  link may be wrong, or the show may not be announced yet."* on a 404 from the API.
- What `GET /public/profiles/:slug` discloses is marketing data and nothing more: bio, tagline, images,
  `venueDetails {capacity, soundSystem, curfew, audienceLogisticsNotes}` and `upcomingShows` with a
  `lineup` of names and headliner/support tags. No rider, no budget, no deal, no crew.

### [NOTE] Run 1's "every seeded image 404s" is a stack artifact, now confirmed as such

`http://localhost:5173/seed/*.svg` returns **200** once the marketing app is running; it 404s only
because `pnpm dev` does not start it. Same for the Collaborators tab's public-profile links. Nothing to
fix in the product; worth adding to the `pnpm dev` story or to the QA runbook so the next sweep does not
spend its console budget on it.

---

## Remaining run-1 findings, re-verified

### [MINOR] Display currency is still a per-visit preview, and Settings still has no control for it — **still reproduces**

Budget Planner → **View in… → USD**: `TOTAL REVENUE ≈ US$8,281 · TICKET REVENUE ≈ US$7,810 ·
TOTAL COSTS ≈ US$8,398 · PROFIT / LOSS ≈ −US$117`, every figure honestly prefixed `≈`. Reload → straight
back to `SEK 88,000`. **Settings → General** offers `ORGANIZATION NAME`, `CONTACT EMAIL`,
`BASE CURRENCY`, `TIMEZONE` and nothing else — no display currency, no date format. PLAN.md's "display
currency per user" is still stored nowhere.
The asymmetry run 1 flagged also stands: the planner writes `≈ US$8,281`, the settlement writes a bare
`€544`.

### [NOTE] A deal that pays crew is still invisible to the planner — **not re-driven**

`performerParticipantIds` (`EventDetail.tsx:249`) still filters the roster to `performer`/`support`.
I did not build a crew deal this run, so this stands on run 1's reading and the unchanged code — filed
honestly as carried forward, not re-proved.

---

## What passed — the short list, because it is half the result

- **The BLOCKER of run 1 is fixed**, and the fix is right in both directions: a solo operator has one
  book and it is the ledger the settlement copies; a co-hosted event still shows the
  **Shared ledger / My budget** chooser and its private margin book still stays out of the reconciliation.
- **Every point of Ran's 2026-09-21 spec**, including the server-side freeze and the pending re-seed.
- **Σ net = 0** on both settlements computed in this run, with every figure hand-checked.
- **The money boundary between account kinds is exact**, on the wire and on the screen, for operator,
  performer, agent and crew — including the withheld waterfall and its written reason.
- **The share ceiling strips `budget.view` from a link an operator deliberately granted it on.**
- **Crew have no vote on the date, and still see the banner** — all three halves of Ran's 2026-09-21 call.
- **The change-request flow resolves correctly when there is somebody to ask**, and the resolved move
  reaches the event, the message thread and the public page.
- **SSE realtime still delivers** to an unreloaded tab, with the timezone right.
- **Holds promote, freeze and release exactly as their own dialogs promise**, once a rank exists.
- **Contacts CSV round-trips**, skipping a duplicate email by address and saying which row and why.
- **Unavailability marks, unmarks and reaches the unauthenticated public read**, and room-aware
  availability still leaves a venue bookable when one of two rooms is sold.
- **Public disclosure holds** (decisions #19) on the API and on the marketing site, including an
  unpublished event.
- **Mobile at 390 px**: no horizontal overflow on thirteen screens (`body.scrollWidth` 380 of 390), and
  the settlement, planner and New-deal modal were looked at rather than measured — the modal sits at
  left 12 / right 368 in a 390 viewport, and the settlement is fully legible.

---

## Not reached, and why

- **Deal reopening.** `POST /deals/:id/reopen` is named in the freeze's own 409 message; I never called
  it, so renegotiation after a freeze is unproven.
- **Settlement finalize → paid.** Every settlement in this run stayed `open`. The status ladder
  (Pending review → Comments received → Revised → Finalized → Partly paid → Paid), the approve flow, the
  send-for-review modal and **decisions #24.2's `full_access` toggle** were all seen but never driven —
  which means **#24.2 is unverified in both runs**.
- **Curation (`settlement_lines.visible_to`, decisions #24.3).** Run 1 checked the default is closed;
  I did not disclose a line to a party and re-read it as them.
- **Revenue shares** (#23.2's new construct). The card renders and refuses to accept a share before a
  revenue line exists; I never created one, so the "Σ shares ≤ 100%" refusal and the `allocate()`
  division are unproven.
- **Escalator tiers, bonus thresholds, advances/prepaid, `cost_split`, multi-currency payout.** None
  exercised. `prepaid` and `prepaidWith` are in the payload and were always null.
- **ICS import/export** on the Calendar — the buttons exist, I ran neither.
- **Audience import/export** — the screen has no import or export control at all (0 contacts, empty
  state only), so there was nothing to drive.
- **Invoices**: read on four accounts, never created or sent. **Performance reports**: rendered, never
  filed ("Filing — coming soon"). **Setlists**: listed, never authored.
- **Profile editing**: the form was read, no image was uploaded and no room was added or renamed.
- **Google OAuth callback**, the Board view of Events, and Team member invitation.
- **`coHost` (Northlight Presents) in the browser** — driven through `api-as.mjs` only (it answered the
  change request).
- **Dark theme.** The toggle is on every screen; every screenshot here is the light one.
- **Existing test suites were not run.** Nothing in this report rests on them.

---

## Probes that lied — and what the re-run showed

Six this time, and they are the reason to trust the rest.

1. **"A revenue line added on the settlement's Financials tab is silently discarded."** Three probes in
   a row lost the row and sent no request. The draft row has explicit **Add / Cancel** buttons and I had
   never pressed **Add**; with it, the POST fires and the line persists. Filed as a MINOR about the
   affordance rather than the MAJOR I first wrote, because the control is there.
2. **"`ladder` is populated for a performer and an agent, so #24.3 is broken."** My extraction script
   read `settlements[].ladder`, and `ladder` is a **top-level** field. Dumping the raw response showed
   `"ladder": null` for performerA and the agent and populated only for the operator. Rule holds.
3. **"`PATCH /events/:id {"eventDate":…}` returns 200 and writes nothing."** True of the write, false of
   the reason: the field is in the schema and the value is diverted into a change-request proposal
   (`events.ts:1299`). Chasing it turned a suspected silent no-op into the real finding — the proposal
   with `required: 0` that nobody can answer.
4. **"The performer's Date field does not save."** My locator had grabbed the guest-list note input, not
   the date. Targeting `input[type=date]` sent the PATCH correctly. My probe, and it also left a stray
   value in a guest field that I cleared.
5. **"The Rooms filter chip opens nothing."** It opens a portal outside `<main>`; my text read was
   scoped to `main`. It works (Show all / Hide all / one row per room). The **"−1"** badge beside it
   after a room filter is applied is real but ambiguous enough that I am NOT filing it — recorded here
   so the next reader knows it was looked at.
6. **"The agent cannot accept an invitation for their act."** `POST /events/…/participation/accept` as
   the **agent** 404'd — because I had called it before the act had a pending row I was reading right,
   and had confused it with the deal-confirm call I ran in the same breath. Re-run in order:
   performerA → 404 (correct, delegated), agent → **200**, and the agent's own row moved with it.

---

## State of the seed after this run

Mutated, and it should be reseeded before anyone quotes it. Changed:

- **Open Mic Wednesdays** — Marlo Vance and Astra Booking added and accepted; a confirmed
  `guarantee_vs_door` deal (SEK 2,000 / 70%); a shared budget with Door entry, Advance and a
  SEK 1,000 production cost (the cost is now marked *deducted from Marlo Vance*); a computed
  settlement; event status `draft → confirmed`.
- **Marlo Vance — Album Release** — **date moved 13 Oct → 27 Oct** by a completed change request;
  Green-room catering marked *deducted from Marlo Vance*; a SEK 5,000 *Sponsorship* revenue line
  collected by Marlo on the settlement copy and SEK 5,000 of Other revenue on the budget; a computed
  settlement; one share token; one message.
- **Nordic Synth Showcase** — hold **released** (now `cancelled`), and a pending, unanswerable
  change-request proposal on it.
- **Winter Gala** — status `cancelled → on_hold`, and a pending unanswerable proposal.
- **Created:** `QA Run2 Hold Rival` (draft, 2 Dec) and `QA Run2 Second Hold` (on hold, 1st, 2 Dec);
  one task *"QA run2 — check the door float"*; one contact *QA Run2 Supplier*.

Reseed with Ctrl-C and `pnpm dev`.
