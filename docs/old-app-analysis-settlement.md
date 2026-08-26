# Old-app analysis — the money core

**Subject:** `../showme-settle-fast` (Firebase/Firestore, ~389 TS/TSX files).
**Scope:** `src/lib/settlementParties.ts`, `src/lib/settlementUtils.ts`,
`functions/src/holdRankLogic.ts`, everything they reach, and every test covering them.
**Date:** 2026-08-26. **Author's stance:** read-only analysis; no application code changed.
**Moving target:** `packages/settlement/` was being edited by another agent throughout.
Line numbers are as of this writing, and §4.1 records a gap that closed mid-analysis.

---

## 0. Method, and what actually ran

| What | Result |
|---|---|
| Old unit tests for the settlement area (`npx vitest run src/lib/settlementParties.test.ts src/components/settlements/SettlementTab.test.tsx src/components/event-detail/SettlementTab.test.tsx`) | **16 passed / 3 files** |
| `functions/src/holdRankLogic.test.ts` (run with `--config /dev/null`; the repo's own `vitest.config.ts:11` restricts `include` to `src/**`, so **`npm test` never runs it**) | **15 passed** |
| **Direct drive of the real engine** — 18 scenarios through `calculateSettlement` via `tsx`, the same entry point every settlement screen calls (`SettlementWorkspace.tsx:69`, `SettlementReviewPage.tsx:250`, `Index.tsx:647`) | **executed; numbers in §2** |
| Boot the Firestore/Auth emulators and drive the UI | **Blocked — did not force it** |

**Why the emulator boot was abandoned (deliberately, not for lack of trying):**
`functions/` deps installed cleanly and `npm run build:functions` succeeded, but
`firebase emulators:start --project showme-local` died with
`Could not start Authentication Emulator, port taken`. Ports **9099** and **8090**
(the old repo's `firebase.json:60,64`) are held by **our own repo's** emulators —
`.../showme-2026/node_modules/.../firebase.js emulators:start --only auth --project demo-showme`
(pid 8299 on 8090, pid 99736 on 9099). Freeing them would kill the stack other
agents are implementing against. Its dev server also defaults to the forbidden
port 8080 (`server.ts:87`). Re-pointing all of that means editing the old repo's
config and its client bootstrap — hours, for a UI that would show me numbers I
already have from the engine itself.

**This turned out not to matter.** The old app's entire settlement math is one
pure function, `calculateSettlement(deal, revenue)` (`src/lib/models.ts:344-531`).
The UI never adds arithmetic (it only re-derives display totals — see §3.10).
Driving that function directly gave *better* evidence than a click-through would:
exact payouts for 18 constructed edge cases, reproducible.

---

## 1. What the old settlement engine actually computes

`calculateSettlement(deal: DealStructure, revenue: TicketRevenue)`, in order
(`src/lib/models.ts:344-531`):

1. **Aggregate revenue.** `totalRevenue = grossRevenue + doorSales + Σ additionalRevenue` (`:346, :362`).
2. **Aggregate deductions.** `ticketFees + tax + refunds + productionExpenses + additionalCosts + Σ customDeductions + Σ customCosts` (`:349-360, :363`).
   - Percentage-type custom deductions resolve against a **named revenue field** via `getSourceFieldAmount` (`:533-545`): `grossRevenue`, `doorSales`, `ticketSales`, `totalRevenue`, or any additional-revenue line **matched by name**.
3. **`netRevenue = totalRevenue − totalDeductions`** (`:364`); **`adjustedNet = netRevenue − venueRental`** (`:368`) — the rental comes **off the top, before any split**.
4. **Fixed-role party payouts, each an independent percentage of `adjustedNet`:**
   `promoterPayout = adjustedNet × promoterSplit%`, `venuePayout = venueRental + adjustedNet × venueSplit%`, `organizerPayout = adjustedNet × organizerSplit%` (`:370-372`).
   **Nothing makes these sum to the pool.** There is no residual party.
5. **Venue-rental paid-by adjustment** (`:387-408`): `promoter` (default) / `performer` / `organizer` / `split` (by the *production* cost-split percentages).
6. **Production cost split** (`:412-429`): `(productionExpenses + unassignedCustomCosts)` apportioned by `artist/promoter/venue/organizerCostSplit`.
7. **Performer base by deal type** (`:431-453`):
   - `guarantee` → `artistGuarantee`
   - `door_split` → `adjustedNet × artistSplit%`
   - `guarantee_vs_door` → `Math.max(guarantee, split)` (`:442`); label ties to **guarantee** (`:443`)
   - `rental` → venue takes the rental, promoter takes `adjustedNet × promoterSplit%` (**overwriting** step 5's promoter adjustment, `:448`), performer takes guarantee-or-split.
8. **Custom deduction party adjustments** (`:456-474`): fixed `fromParty → toParty` transfers, and percentage deductions apportioned across `partySplits`.
9. **Assigned custom costs** (`:477-481`) debit the named party.
10. **Commissions** (`:488-493`), **cascading**: each commission takes its percentage of the *running remainder*, so commission #2 is charged on the amount left after #1.
11. **Performance bonus** (`:502-506`), applied **after** commissions, gated on `totalRevenue ≥ threshold` — i.e. on **gross**, not net.
12. **Round to 2 decimals with `Math.round(x*100)/100`** at output only (`:510-513, :525-527`). Everything upstream is IEEE-754 `number`.

### Compared to ours (`packages/settlement/src/reconcile.ts:24-119`)

| | Old app | Ours |
|---|---|---|
| Numeric type | `number` (float), rounded at print | `bigint` minor units, `allocate()` largest-remainder (`packages/shared/src/money.ts:68-104`) |
| Parties | **Fixed four roles** — artist / promoter / venue / organizer, hardcoded | Arbitrary `participantId`s (`types.ts:25-30`) |
| Deals | **One `DealStructure` per event** | N `SettlementDeal`s, 1..N payees each (`types.ts:33-45`) |
| Operator | An independent `promoterSplit` percentage | **Residual** — `pool − Σ deal entitlements` (`reconcile.ts:71-79`) |
| Conservation | **None. Σ payouts ≠ pool, routinely** (§2) | `Σ net === 0n` by construction, asserted (`reconcile.ts:136-149`) |
| Cash held | **Does not exist.** No `collectedBy`/`paidBy` anywhere in the repo (grep: zero hits in `src/` and `functions/src/`) | `held = collected − paid` (`reconcile.ts:90-107`) |
| Output | Per-party *payout* figures | Per-party `net` + greedy **transfers** (`transfers.ts:9-41`) |
| Deductibles | Ad-hoc: `customCosts[].fromParty`, `additionalDeductions[].fromParty/toParty` | One rule: cost line with `payeeParticipantId` (`reconcile.ts:81-88`) |

**The headline:** the old thing is a **payout calculator**; ours is a
**reconciliation**. It answers "what is each role's share?"; ours answers
"who owes whom, and does the money add up?". The meeting binds ours —
"who owes whom is computed from real data" (01:12:54), "collected-by /
paid-by selectors" (01:27:49), "transparency about who holds which funds"
(`docs/meeting-2026-08-settlements-and-deals.md:21,116-119,124-127`).

---

## 2. Which edge cases the old test suite encodes that ours does not

### The honest answer first

**The old test suite encodes none of them.** This contradicts CLAUDE.md, and the
contradiction should be fixed in CLAUDE.md rather than worked around:

- 55 test files exist. **Zero reference `calculateSettlement`** (`grep -rln "calculateSettlement" --include="*.test.*"` → empty).
- `src/lib/settlementParties.test.ts` (142 lines, 13 tests) tests **display folding only** — that a phantom "Promoter" card is merged into the venue/organizer card. Not money.
- Both `SettlementTab.test.tsx` files (100 + 103 lines) test **one thing**: that a comment attachment renders as a `<button>` and not an `<a download>`.
- **VAT is never computed anywhere.** `VatInfo` (`models.ts:188-191`) is attached to revenue, deduction and cost fields — and `calculateSettlement` never reads it. Its only consumers render a text suffix: `VatSuffix` (`SettlementBreakdownCards.tsx:24-28`) and the PDF/CSV exporter (`settlementExport.ts:60,76,82`). Verified by execution — see case 11.
- The only real money-adjacent unit tests in the repo are `functions/src/holdRankLogic.test.ts` (15 tests) — **and the repo's own `vitest.config.ts:11` excludes `functions/` from `npm test`, so they have not run in CI.**

So `docs/money.md:50` ("Re-express the 50+ test suites in minor units; green =
port accepted") describes suites that **do not exist**. CLAUDE.md's "executable
spec for edge cases: VAT, guarantee-vs-door, hold promotion" is accurate for
**hold promotion only**.

### What I did instead — reverse-engineered the edge cases and executed them

18 scenarios through the real function. Every number below is **output, not
inference**. `Σ parties` is the sum of `finalPayout` across all breakdown rows;
compare it to the pool the revenue actually produced.

| # | Case | Old-app output | Ours | Verdict |
|---|---|---|---|---|
| 1 | Our own worked example (`SKILL.md:53`): guarantee 3000, rental 1000, tickets 10000, production 1500, promoterSplit 100% | Performer 3000, Promoter 6500, Venue 1000 → **Σ = 10 500 on a pool of 8 500. 2 000 invented.** | Σ net = 0, P −4000 / V +1000 / B +3000 (`reconcile.test.ts:48-55`) | **Ours right.** The old engine cannot express "the operator gets what's left". |
| 2 | Splits that don't sum to 100 (artist 50%, promoter 30%) | Σ = 8 000 of 10 000; **2 000 evaporates silently** | Impossible — residual absorbs it | **Ours right.** Meeting 00:15:45 requires totals to add to 100%; the old app never enforced it. |
| 3 | `guarantee_vs_door`, guarantee 2000 @ 50% — gross 2000 / 10000 / **exact tie at 4000** | 2000 / 5000 / 2000 (tie → labelled "Guarantee (higher)", `:443`) | `guarantee > door ? guarantee : door` (`entitlement.ts:21`) → identical amounts | **Equivalent.** The tie-break differs only in the label. No gap. |
| 4 | **Loss with a guarantee:** gross 1000, costs 4000, guarantee_vs_door g=2000 | Performer keeps 2000; **Promoter −3000** | Operator residual goes negative identically | **Both right, and this is the correct rule** — the guarantee protects the performer; the operator eats the loss. Our property test (`reconcile.test.ts:192`) covers this only incidentally. |
| 5 | **Loss on a pure door split** (50% of a −3000 pool) | Performer **−1500** — the performer *owes* the promoter | `applyBasisPoints(pool, bp)` on a negative pool → **also −1500** | **Same behaviour, and no document decides whether it is right.** Industry practice floors a door deal at zero. **→ Question for the owner (Q1).** |
| 6 | `venueRentalPaidBy = "performer"`, rental 1000 | Performer's card shows `Venue Rental (paid by Performer): −1000` **but `finalPayout` stays 3000.** Promoter is not charged either. Σ = 13 000 vs 10 000 | N/A — a rental is a deal, its payer is `deals.payer_participant_id` | **Old app is broken.** `:388-389` pushes a display adjustment and never touches a payout, unlike the `organizer` branch two lines below (`:391-392`) which does. Clear bug, not a rule. |
| 7 | **Production-cost double-charge:** prod cost 2000, cost split 50/50 promoter/venue, door 50/50 | The 2000 is already off the pool (performer gets 50% of 8000 = 4000), **then** promoter and venue are charged 1000 each *again*. Venue lands at **−1000 from a base of 0**. Σ = 6 000 of a 8 000 pool | We have no cost-split concept at all (see §4.1) | **Old app is broken** — very likely the meeting's "production cost split bug" (01:00:17, `meeting:97-99`). The *requirement* is real; this implementation is not. |
| 8 | **Cascading commissions:** 20% then 10% on a 1000 guarantee | Agent 200, Mgmt **80** (10% of the remaining 800), performer 720 | `applyBasisPoints(portion, bp)` per commission against the **same** base (`reconcile.ts:63-67`) → 200 + **100**, performer 700 | **We disagree, and the old app matches `docs/money.md:21`** ("Cascading commissions use `allocate()` semantics"). **→ See §3.4.** |
| 9 | **Bonus vs commission ordering:** guarantee 1000, 20% commission, bonus 500 | Agent gets **200** — the bonus is added *after* the commission block (`:502-506`), so the agent earns nothing on it | The bonus is inside `dealEntitlement` (`entitlement.ts:32-35`), so it **is** commissioned | **Ours right per `SKILL.md:36`** (commissionable income includes "…escalator/bonus"). The old ordering reads as an accident of where the block was appended, not a rule. |
| 10 | **Bonus threshold basis:** threshold 4000, gross 5000, costs 9000 (pool −4000) | Bonus **pays** — the gate is `totalRevenue` i.e. **gross** (`:503`) | Gate is `pool >= bonusThreshold` (`entitlement.ts:32`) — **does not pay** | **Genuine disagreement, undecided by any doc.** **→ Question for the owner (Q2).** |
| 11 | VAT 25% `included` vs `on_top` on 1000 of merch | **Byte-identical output.** VAT is inert | We have no VAT math either (`money.md:42-45` defers it to the invoice phase) | **Not a gap the old app can fill.** Nothing to port. |
| 12 | Three-way 33.33 / 33.33 / 33.34 | 3333 / 3333 / 3334 — correct only because the user pre-balanced. Enter 33.33 three times and a unit vanishes | `allocate()` guarantees `Σ parts === total` (`money.md:17`) | **Ours right.** |
| 13 | `dealType: "rental"` | Promoter card shows `Venue Rental (paid by Promoter): −1000` while `finalPayout` is 9000 — **`:448` overwrites the charge but leaves the adjustment row**. `base ≠ final − Σ adj` | N/A | **Old app is broken** — a second display/engine divergence. |
| 14 | Fixed deduction 300, promoter → performer | The 300 is deducted from the pool at `:349-355` **and** transferred at `:459-460`. Double-counted | Expressible as a deal, or a `payeeParticipantId` cost | **Old app is broken.** The *capability* (a party-to-party side amount) is worth having; the implementation is not. |
| 15 | Percentage deduction: 10% of `grossRevenue` split 50/50 artist/venue | +250 each, on top of the 500 already off the pool (same double-count) | **We cannot express this at all** — our `door_split` is a % of the whole **pool**, never of a *named revenue stream* | **Real capability gap** (§4.2), spoiled by the same double-count bug. |

### Cases neither side covers

- **Multi-performer splits.** The old app cannot express them — one deal, one artist, four fixed roles. Ours can (`partyShares`, `reconcile.ts:55-62`), and `reconcile.test.ts` has **no** multi-payee split test. The meeting binds this: even split or per-performer percentages totalling 100% (00:15:45), and headliner-plus-support (00:09:54). **Our own gap, which the old app cannot help with.**
- **Escalators.** The old app has **none** (no tier concept in `DealStructure`). We have the math (`entitlement.ts:39-49`) and a test (`reconcile.test.ts:151`) — but see §4.4, it is never wired. The meeting defers tiered escalators for v1 anyway (`meeting:25,47-51`).

---

## 3. Where the old app disagrees with us, and which is right

**3.1 Conservation. Ours is right, unambiguously.** Cases 1, 2, 6, 7, 9, 14, 15 all
produce a party total that differs from the money that existed. `Σ net = 0`
(`reconcile.ts:136-149`) is the single thing the rebuild most needs to keep.

**3.2 Operator as residual. Ours is right.** `SKILL.md:18` ("operator = residual
(pool − Σ others); co-operators split the residual") and `money.md:19-20` ("Residual
absorbs rounding"). The old `promoterSplit` percentage is the root cause of nearly
every imbalance above.

**3.3 Rental off the top, before the door split. THE OLD APP IS RIGHT, AND WE HAVE A GAP.**
The old engine computes `adjustedNet = netRevenue − venueRental` **before** the
performer's door percentage (`models.ts:368, :437`). Ours computes **every** deal's
entitlement against the same `pool` (`reconcile.ts:52-69`) — so a 50% door performer
takes 50% of money that is already spoken for by the venue's rental deal.
On a 10 000 pool with a 2 000 rental: old app pays the performer 4 000, ours pays 5 000.
That is a 1 000 difference on a routine deal, and the industry meaning of "net door"
is after the rental.

We already have the field for it and never read it: `deals.priority`
(`packages/db/src/schema/deals.ts:31` — *"rental / before-event settle first"*).
`SettlementDeal` has no `priority` member; `reconcileEvent` never maps one
(`apps/api/src/routes/settlement.ts:378-400`). **This is the single highest-value
port in this document.**

*Uncertainty, stated:* whether "off the top" should apply to **all** priority deals
or only `rental`-structured ones is not written down anywhere. The column comment
says "rental / before-event", which suggests deal-driven ordering. **→ Q3.**

**3.4 Cascading vs parallel commissions. The old app is right; we diverge from our own doc.**
Old: `remainder -= payout` per commission (`models.ts:490-491`) → cascading.
Ours: every commission applies `applyBasisPoints(portion, bp)` to the same base
(`reconcile.ts:63-67`) → parallel. `docs/money.md:21` says **"Cascading commissions
use `allocate()` semantics — no per-step rounding drift"**, which only makes sense
if commissions cascade. But `SKILL.md:18` says "disclosed/**off-the-top** only",
which reads as parallel-off-gross.

*I cannot tell from the documents which was intended.* Case 8 shows the difference
is real money (80 vs 100 on a 1000 guarantee). **→ Q4.** Note this is currently
harmless in practice because commissions are never populated (§4.4).

**3.5 Commission on the bonus. Ours is right** (`SKILL.md:36`). The old exclusion
(`models.ts:502-506` sitting after `:489-500`) looks like code appended at the end
of a function rather than a decision. Low confidence that it was ever intended;
recorded so nobody "ports" it by mimicking the ordering.

**3.6 Bonus gate on gross vs pool.** Unresolved, see case 10 and **Q2**. Worth noting
the meeting speaks of bonuses alongside **ticket-volume** thresholds (00:05:08,
`meeting:47-51`) — arguably neither gross nor pool, but `ticketsSold`, which is what
our escalators already use.

**3.7 Negative entitlement on a pure door split.** Both engines let a performer go
negative. See **Q1**.

**3.8 VAT. Neither engine computes it.** `money.md:42-45` defers per-line vs
per-total VAT rounding to the invoice/payments phase, and the meeting never
raises VAT. **There is no VAT knowledge in the old app to port** — only a label.

**3.9 Float vs minor units. Ours is right** (`money.md:8`). Nothing to debate.

**3.10 Display and engine disagreeing — the failure mode to learn from.**
Three independent divergences, all in the old app, all invisible to its tests:
- `venueRentalPaidBy: "performer"` shows a −1000 row that changes nothing (case 6).
- The `rental` branch shows a −1000 row that was overwritten (case 13).
- `SettlementWorkspace.tsx:83-85` recomputes `totalDeductions` a **third** way, adding
  `overviewVenueRentalDeduction` gated on `venueRentalPaymentMode` — a flag
  `calculateSettlement` **never reads** (`:368` subtracts the rental unconditionally).
  So switching the deal to "request now" changes the displayed net revenue and not
  the settlement.

We have the same latent shape: `deals.advanceAmount` and `deals.paymentTiming` are
stored, validated and serialized (`apps/api/src/routes/deals.ts:99-104`,
`serialize/deal.ts:132-134`) and the engine ignores both — the schema says so
honestly (`deals.ts:33-37`, *"no engine wiring yet"*). Fine while nothing renders
them as if they were live. **Worth a guard test rather than a port.**

### Adjacent finding — our commission base contradicts our own skill doc

Not an old-app issue, but it is in the money core and I found it while comparing.
`syncCommissionSettlements` commissions `breakdowns[].entitlement`
(`apps/api/src/lib/commission-settlement.ts:44`), which `reconcile.ts:81-88` has
already **reduced by deductibles**. `SKILL.md:36` says commissionable income is
"deal income only — guarantee/ticket/split/escalator/bonus; **NOT** merch/extras/
**reimbursements**". A venue-fronted hotel deducted from the performer's cut is a
reimbursement, and it currently shrinks the agent's commission. **→ Q5.**

---

## 4. What the old app did that we have not built at all

**4.1 A cost-split rule per cost line — CLOSED WHILE THIS WAS BEING WRITTEN.**
Old: `artist/promoter/venue/organizerCostSplit` apportioning production costs
(`models.ts:412-429`) plus `venueRentalPaidBy: "split"` (`:393-402`). The meeting
binds it hard: *"The production system requires a defined rule: either a cost split
or a single payer"* (01:02:58–01:06:31, `meeting:101-107`).

When I began, `budget_lines.cost_split` (`packages/db/src/schema/settlement.ts:86`)
was a dead column no engine code read. **Another agent landed it mid-analysis** —
`packages/settlement/src/cost-bearing.ts` (new, uncommitted at the time of writing)
partitions every cost line into `poolShare + Σ borne[]`, `SettlementBudgetLine`
gained `costSplit` (`types.ts:54-61`), and `reconcile.ts:29-42, 81-88` consumes it.
The approach is right and generalises the deductible rather than special-casing it
(`payeeParticipantId` = a 100% split to one party), and it uses `allocate()` so the
parts sum exactly.

**What is left in this area, and it is exactly the old app's bug:** the old engine
charged production costs to parties *and* deducted the same costs from the pool
(case 7). The new partition is explicitly built not to do that. **Worth a targeted
test reproducing case 7's inputs** and asserting `Σ net = 0` — that is the one thing
the old implementation got wrong and the one thing a future refactor is most likely
to reintroduce.

**4.2 Percentage-of-a-named-revenue-stream splits.** `getSourceFieldAmount`
(`models.ts:533-545`) resolves a percentage against `grossRevenue`, `doorSales`,
`totalRevenue`, or **any additional-revenue line by name**. Our `door_split` is a
percentage of the whole pool only. The meeting keeps this in scope —
*"Revenue can be entered (e.g. €500 merchandise) with percentage splits or fixed
deductions applied"* (01:08:30, `meeting:109-114`) — while deferring the
percentage-of-**bar** subclass (`meeting:25,47-51`). Same mechanism, so it lands with
the deferred work.

**4.3 A party-to-party fixed side amount** (`additionalDeductions` with
`fromParty`/`toParty`, `models.ts:458-463`). In our model this is just a small deal,
which is arguably cleaner. Recording it so the capability is not lost, not proposing
a new primitive.

**4.4 Our own engine features that exist but are never fed.** Discovered while
diffing, and the most actionable non-old-app finding here. `reconcileEvent`
(`apps/api/src/routes/settlement.ts:378-400`) maps **only** `structure`,
`payeeParticipantIds`, `guaranteeAmount`, `splitBasisPoints`, `partyShares`.
It never sets `escalators`, `bonusThreshold`, `bonusAmount`, `commissions`, or
`SettlementInput.ticketsSold`. `deals.terms` — the jsonb column whose comment reads
*"escalator tiers, bonus, commissions — read with the deal"*
(`packages/db/src/schema/deals.ts:39`) — is written and serialized
(`routes/deals.ts:729-738`) and **never read into the engine**. So
`entitlement.ts:28-49` and its green tests (`reconcile.test.ts:151-178`) are
**dead code in production**. The bonus/escalator half is fine to leave dead (the
meeting defers escalators, `meeting:25`); the **commission** half is not obviously
deferred anywhere.

**4.5 PRO fee estimation.** `calculateProFee` (`models.ts:963-991`) carries real
STIM and GEMA arithmetic: STIM 4% below a 675 SEK ticket / 3% above, +5.28 SEK per
comp ticket, floor 367 SEK, flat 27.30 SEK for subsidized concerts; GEMA 7% with a
€20 floor; both de-VAT-ing at 25% / 19% first. We ship a deliberate 6% placeholder
that documents its own ignorance (`packages/shared/src/performing-rights.ts:1-40`).
**Those rates are undated and unsourced in the old repo, and PRO tariffs are
renegotiated yearly** — so this is a lead on where the numbers roughly sit, not data
to trust. It also converts via a hardcoded rate table (`models.ts:961`,
`SEK: 11.5`), which must not travel.

**4.6 Settlement PDF / CSV export.** `settlementExport.ts` (jspdf + autotable) builds
a full settlement document. **We have nothing** (`grep jspdf|exportSettlement` over
`apps/web/src` and `packages` → empty). A settlement people actually sign needs a
document; worth knowing it's missing.

**4.7 A ticketing-provider import path.** `ProviderEvent` (`models.ts:255-266`) +
`SyncDialog.tsx`. We designed the seam (`packages/settlement/src/ticketing.ts`) and
ship no provider — matching the meeting (*"Ideal is API sync… but manual input must
remain for cash-at-the-door"*, 00:43:38). Aligned; nothing to do.

**4.8 A formula-driven budget planner.** `budget-types.ts:23-30` defines a small
expression AST (`ref/constant/add/subtract/multiply/divide/percentage`) with
`evaluateFormula` and `formulaToString` (`:92-121`), driving calculated fields —
break-even ticket count, profit margin, revenue/cost per guest, payment-processing
fees, PRO cost (`useBudgetCalculator.ts:176-215`). This is genuinely nice prior art
for the planner, and **strictly separate from settlement**. Our equivalent is
`budgets.planning_assumptions` + `budget_lines.details`
(`packages/db/src/schema/settlement.ts:47,90`).

**4.9 Hold-rank promotion.** Ported already — we have `POST /events/:id/hold-rank`
and `/hold-decline` in the API client surface. The old `computeDeclinePromotion`
(`holdRankLogic.ts:135-170`) encodes one rule worth double-checking against ours:
an `auto_promote: false` hold **freezes its rank number**, and auto-on holds
**jump over** the frozen rank when compacting (`:176-223` in the test — before
`1 on, 2 removed, 3 off, 4 on, 5 on` → after `1, 3 frozen, 4→2, 5→4`). The comment
at `:126-128` explains why the naive "shift everything down by one" is wrong here.

---

## 5. What we should NOT port, and why

| Do not port | Why |
|---|---|
| `calculateSettlement`'s **shape** — four hardcoded roles, one deal per event, independent percentages | It structurally cannot express the meeting's model: one settlement per participant (`meeting:20`), N deals per event, agent + freelancer agreements in the same place (01:50:02). It also cannot balance (§2 cases 1, 2). |
| Every **float** in it | `money.md:8` — "Never float." Case 12 is one keystroke from losing a minor unit. |
| The **production-cost double-charge** (`models.ts:363` + `:412-429`) | Charges the same cost twice: once to the pool, once to the parties. Case 7. Almost certainly the bug the meeting flags at 01:00:17. |
| `venueRentalPaidBy: "performer"` (`:388-389`) and the `rental`-branch overwrite (`:448`) | Both render a money row that does not move money. Case 6, case 13. |
| The **fixed-deduction double-count** (`:349-355` + `:459-460`) | Case 14. Keep the capability, discard the arithmetic. |
| `settlementParties.ts` in full — `visiblePartyBreakdowns`, `buildPartyNames`, `buildPayoutRows`, `buildPayoutParties` | 140 lines existing solely to hide a **phantom "Promoter" card** the engine always emits (its own header, `:5-11`, says so). Our participants are real rows; the phantom does not exist. This is denormalization damage, exactly the ~1,700 LOC CLAUDE.md says the rebuild deletes. Its 13 tests go with it. |
| The **hardcoded IBANs** — `"NL91 ABNA 0417 1643 00"` etc. (`settlementParties.ts:130,133,135,137`) | Fake bank details baked into a payout screen. |
| `EXCHANGE_RATES = { SEK: 11.5, ... }` (`models.ts:961`) | A hardcoded FX table used inside fee math. We lock rates at finalize with source and timestamp (`money.md:30`; `routes/settlement.ts:365-366`). |
| STIM/GEMA rates **as authoritative** | Undated, unsourced, per-country, renegotiated yearly. Use as a sanity range for a `pro_tariffs` table; never as a quote. `performing-rights.ts` already refuses to pretend. |
| `settlementUtils.ts::DEFAULT_APPROVALS` (`:14-18`) — a fixed three-row Operator/Performer/Venue approval list | Our approvals are per-participant rows keyed to real participants (`schema/settlement.ts:170-180`), and approval is a signature on one's **own** line (`routes/settlement.ts:879-881`). |
| **Escrow / money movement** | Rejected outright (`meeting:132-134`). Nothing in the old app does this; noted so it stays rejected. |
| The old repo's **`vitest.config.ts` scoping habit** | `include: ["src/**"]` silently excluded every `functions/` test from CI. A cautionary note, not a port. |

---

## 6. Prioritised list

### PORT NOW

1. **Off-the-top deal ordering — rentals settle before percentage splits.**
   Old `models.ts:368` + `:437`; our gap at `reconcile.ts:52-69`. Wire the existing
   `deals.priority` column (`schema/deals.ts:31`) into `SettlementDeal`, compute
   priority-ordered deals first and reduce the pool the later percentage deals split.
   Worth 1 000 on a routine 10 000/2 000 event. **The single highest-value item here.**
   *Blocked on Q3 (which deals count as off-the-top).*

2. **Test: multi-performer split, per-payee percentages totalling 100%.**
   Bound by the meeting (00:15:45, 00:09:54 headliner-plus-support). Our
   `partyShares` path (`reconcile.ts:55-62`) has **no test**. Also the case
   `SKILL.md:46-47` explicitly asks for: split deal, performer A agented with
   `agent_collects`, performer B self-managed.

3. **Test: `guarantee_vs_door` at an exact tie, and on a loss.** Old cases 3 and 4.
   `reconcile.test.ts:146-149` covers only strict greater/less. The loss case
   (guarantee holds, operator residual goes negative) is the most consequential
   rule in the engine and is currently only covered by chance in the property test.

4. **Regression test: display figures cannot diverge from settled figures.**
   The old app shipped three such divergences (§3.10) and its tests caught none.
   Ours has live-looking-but-inert `advanceAmount` / `paymentTiming` (`deals.ts:33-37`).
   A test asserting these do **not** alter `reconcile` output pins today's honest
   behaviour and fails loudly the day someone half-wires them.

5. **Regression test for the cost-split double-charge (case 7).** The rule itself
   landed while this was being written (§4.1, `packages/settlement/src/cost-bearing.ts`),
   so this is no longer "build it" — it is "prove it does not repeat the old bug".
   Feed the old app's exact inputs (prod cost 2000, 50/50 between two parties, door
   50/50 on a 10 000 gross) and assert the cost is counted **once**: the pool drops
   by the unallocated share only, the two bearers absorb the rest, `Σ net = 0`.
   Also cover a split that does not total 100% — the remainder must stay a pool cost,
   not vanish.

6. **Wire `deals.terms` → commissions, or delete the promise.** `schema/deals.ts:39`
   advertises "escalator tiers, bonus, commissions"; the engine receives none of them
   (§4.4). Escalators/bonus are legitimately deferred; **disclosed commissions are not
   deferred anywhere**, and the engine already implements them. Either connect them or
   change the comment so the next reader is not misled.

7. **`computeDeclinePromotion`'s frozen-rank rule** — verify our
   `/events/:id/hold-decline` reproduces it, including the jump-over-frozen-rank case
   (`holdRankLogic.ts:135-170`; test `:176-223`). Genuinely proven logic; its 15 tests
   are the only real executable spec in the old repo, and they port almost verbatim.

### PORT LATER

8. **Percentage-of-a-named-revenue-stream splits** (`getSourceFieldAmount`,
   `models.ts:533-545`). In scope per `meeting:109-114`, but the same mechanism as the
   deferred percentage-of-bar (`meeting:25`). Land them together.

9. **Tiered escalators end-to-end.** Math and tests already exist
   (`entitlement.ts:39-49`); only the wiring and `ticketsSold` are missing.
   Explicitly deferred for v1 (`meeting:25,47-51`).

10. **PRO tariff table** (`pro_tariffs` keyed by country + event type, per
    decisions #17). The old STIM/GEMA arithmetic is a **starting reference for the
    shape**, not for the rates.

11. **Settlement PDF/CSV export** (`settlementExport.ts`). Not a math port; needed
    before anyone signs a settlement.

12. **Budget-planner formula AST** (`budget-types.ts:23-121`). Nice prior art for
    calculated planner fields. Planner-only — must never touch settled figures.

### DO NOT PORT

Everything in §5. In one line: **port the rules the old app discovered, never the
structure it discovered them in** — the four hardcoded roles, the floats, the phantom
Promoter, the double-charges, the fake IBANs, the hardcoded FX.

---

## 7. Questions for the owner (I could not resolve these from the documents)

- **Q1 — Can a performer's entitlement go negative on a pure door split?**
  Both engines say yes (case 5: −1500). Industry practice usually floors a door deal
  at zero and leaves the loss with the operator. Nothing in `money.md`,
  `decisions.md`, the meeting or `SKILL.md` addresses it. *Deliberate rule, or
  nobody's ever hit it?*

- **Q2 — What does a performance bonus threshold measure?** Old app: **gross**
  revenue (`models.ts:503`). Ours: the **pool** (`entitlement.ts:32`). The meeting
  describes bonuses next to ticket-volume thresholds (00:05:08), suggesting a third
  answer: **tickets sold**. Case 10 shows the old rule paying a bonus on an event
  that lost 4 000.

- **Q3 — Which deals settle off the top?** Only `structure = "rental"`, or any deal
  with `priority > 0`? `schema/deals.ts:31` says "rental / before-event settle first",
  which is two different criteria in one comment. Blocks port item 1.

- **Q4 — Do multiple commissions cascade or apply in parallel?** Old app cascades
  (`models.ts:490-491`); ours is parallel (`reconcile.ts:63-67`); `money.md:21` says
  "cascading"; `SKILL.md:18` says "off-the-top". 80 vs 100 on a 1000 guarantee (case 8).

- **Q5 — Should a reimbursed cost reduce an agent's commissionable income?**
  It does today (`commission-settlement.ts:44` reads a post-deductible entitlement),
  and `SKILL.md:36` says reimbursements are **not** commissionable. Ours-vs-ours, not
  old-vs-new.

- **Q6 — Should CLAUDE.md and `money.md:47-50` be corrected?** Both promise old-app
  settlement test suites ("the executable spec for edge cases: VAT, guarantee-vs-door";
  "50+ test suites") that **do not exist in the repository**. The `holdRankLogic`
  suite is real and worth its billing; the settlement half is not. Future agents will
  go looking for those suites and find display tests.
