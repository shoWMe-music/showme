# shoWMe — Money representation

The foundation the settlement engine sits on. The **representation + accounting model is lockable now**; the
**payment/payout FX** layer is deferred with payments, with one decision flagged.

## Core representation

- **Integer minor units (`BIGINT`) + explicit currency. Never float.** €10.00 → `amount_minor=1000, currency='EUR'`.
  Exact (so `Σ net = 0` actually holds) and identical to how Stripe/Mollie represent money.
- **`Money` value type** in `packages/shared`: `{ amount: bigint, currency }`. **All** money math flows through it;
  `add`/`subtract` **throw on currency mismatch** (can't net EUR against SEK).
- **Percentages → basis points** (`int`, 4000 = 40.00%). **FX rates → `NUMERIC(18,10)`** [default].
- **Rounding mode: half-up** [default — `allocate()` guarantees totals regardless, so mode only affects single-line rounding].

## Splits & the conservation law

- **`allocate(total, weights[]) → Money[]`** — largest-remainder method: **Σ parts === total, exactly**. Every split
  (door_split, N-way `split_member`, commissions, VAT apportionment, deductibles) goes through it.
- **Residual absorbs rounding:** operator entitlement = `pool − Σ others`, so the residual party soaks up leftover
  units → **`Σ net = 0` holds by construction**, not by luck.
- **Carry exact minor units through intermediates; round only at `allocate()`/output.** A commissioned line is
  partitioned rather than separately rounded — the payee is credited `line − Σ commissions` — so no minor unit
  drifts however the individual cuts round. *(This bullet used to say commissions cascade. They do not today:
  see "Settlement rules the engine enforces" below, and ClickUp `86cba8wmb`.)*

## Settlement rules the engine enforces

Answered by the product owner on **2026-08-26** and implemented in `packages/settlement`. Two adjacent
questions were deliberately left open, and the code is shaped so answering them is a small change.

- **Rentals settle OFF THE TOP.** A `structure = "rental"` deal is settled before the percentage deals and
  its total **reduces the pool they divide** — "net door" means after the rental. On a 10 000 pool with a
  2 000 rental, a 50% door performer takes **4 000**, not 5 000. Fixed amounts that are not rentals keep
  dividing the same pool as everyone else. `packages/settlement/src/deal-order.ts` holds the predicate, and
  it is the only thing that changes if the rule widens.
  **RESOLVED 2026-09-02 — ClickUp `86cba8wfk`: `deals.priority` stays unwired, and rental is the only rule.**
  The column's comment named two criteria, "rental / before-event", and both are already answered by mechanisms
  more specific than a priority integer: rental by `deal-order.ts` (reduces the pool), before-event by
  `advance_amount` / `payment_timing` via `prepaid.ts` — where an advance leaves the ENTITLEMENT untouched and
  settles as cash already held, which is the only reading under which the payer does not pay twice. Those are
  two different operations on the money and neither of them is "priority"; a third route to off-the-top would
  let the product say one thing two ways and the other thing wrongly. `SettlementDeal` still carries no
  `priority` member, so it cannot be half-wired by accident.
- **A percentage-of-pool entitlement is floored at zero.** A loss-making night pays a 50% door performer
  **0**, never −1 500; the operator absorbs the loss through the residual (`pool − Σ others`), so the floor
  costs the conservation law nothing. **Scope:** the floor is on the *share of the pool*. A guarantee is
  untouched, and a party's **net may still go negative** — a deductible or an advance is money genuinely owed
  back, and flooring that would invent money.
- **Disclosed commissions are paid, and the DEAL chooses how they stack** (`deals.commission_mode`, resolved
  2026-09-02, ClickUp `86cba8wmb`). Two cuts of 20% and 10% on a 1 000 line: `parallel` → 200 + 100, payee keeps
  700; `cascading` → 200 + 80, payee keeps 720. The product owner's answer was that it depends on the shape of
  the deal, so neither is the rule and the agreement carries it. **`parallel` is the default** because it is
  what the engine always did (no existing deal is restated) and because it is order-independent — cascading
  makes the payout depend on the sequence the commission parties sit in, so it is the one that must be asked
  for. This resolves the contradiction where this document said cascading and the settlement skill read as
  parallel: both are now true, per deal.
- **Historical note — commissions used to apply in PARALLEL unconditionally.** A `deal_parties` row with
  `role_in_deal = 'commission'` now settles: its rate is `share.splitBasisPoints`, read as basis points **of
  each payee's line**, charged per entitled line so a shared split commissions each performer's own portion.
  Two commissions of 20% and 10% on a 1 000 line pay 200 and 100, and the payee keeps 700.
  **OPEN — ClickUp `86cba8wmb`:** parallel vs cascading (which would pay 200 and 80, payee 720). All the
  arithmetic lives in `packages/settlement/src/commissions.ts`.
  A booking **agent's** private representation commission is none of this — it is a separate,
  representation-scoped settlement (decisions.md #14) and must never be an entitled party line on the event.

## Multi-currency (accounting side)

- **Every deal / settlement / transfer / invoice carries its own currency.** The `Money` type enforces it.
- **Budget lines may differ from `events.base_currency`** → convert each to base (locked FX) **before** summing the pool.
- The **`Σ net = 0` invariant runs in `events.base_currency` minor units.** Native amounts are preserved for payout;
  only the reconciliation math is in base.
- **Store the locked FX rate + timestamp + source** on the finalized settlement (reproducibility/audit).

## Conventions

- **Signed:** net positions are signed (+ owed to them, − holding too much). Transfers = **positive amount + explicit
  `from→to`**.
- **Zero vs null:** `Money(0)` is a real zero; a **nullable** money column = "not set" (e.g. no guarantee).
- **JSON boundary:** serialize `amount` as a **string** (`"1000"`) — bigints past 2⁵³ are unsafe as a JS `number`.
  Never round-trip money through a JS `number`.
- **`currencies` reference** (code → minor-unit exponent + symbol) — static config; required to interpret minor units
  per currency (SEK/EUR=2, JPY=0, KWD=3). Don't hardcode "×100".

## VAT

- Compute in minor units, rounded via `allocate()`. **Invoice VAT rounding** (per-line vs total) follows the
  jurisdiction's rules — finalize with the invoice/payments phase.

## Settlement engine port (NOT purely verbatim)

- The old `calculateSettlement` uses `number` (float) — porting swaps **float → `Money`/bigint** throughout. The
  *logic* ports; the *numeric type* changes. **Re-express the 50+ test suites in minor units; green = port accepted.**

## Deferred decision (payments phase)

- **WHO BEARS THE FX SPREAD** — Stripe converts at *its* live rate + ~2% fee, which ≠ the settlement's locked
  rate. The deal is denominated in the **payee's** currency, so the natural rule is the **payer/operator absorbs the
  FX cost** (recommended) vs payee vs split. Record **actual-paid vs settlement-expected**; the delta is a real cost.
  → **decision needed, deferred.** Minimize FX by charging in the payee's currency (single deals) or holding
  multi-currency balances; mixed-currency **Pay-All** makes provider FX unavoidable (a reason to use Stripe Express).
- The **locked FX in PLAN.md is an accounting *estimate*** for reproducibility; the **actual** cross-currency
  conversion happens at payout at the provider's rate.

## Related
- `docs/payments.md` — the deferred payment layer (Stripe Connect / Mollie).
- `PLAN.md` §"Currency & public surfaces" + Settlement — the base this refines.
