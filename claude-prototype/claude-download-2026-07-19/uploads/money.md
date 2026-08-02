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
- **Carry exact minor units through intermediates; round only at `allocate()`/output.** Cascading commissions use
  `allocate()` semantics — no per-step rounding drift.

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
