---
name: settlement
description: The shoWMe settlement/budget reconciliation algorithm — the collected-by/paid-by "who owes whom" math, per-participant settlements, deductibles, and multi-currency. Use when working on deals, budgets, settlements, or the money math.
---

# Settlement & budget

Full design in [PLAN.md](../../../PLAN.md) → "Settlement & budget → Reconciliation algorithm". Port the pure math primitives
from the old repo (`src/lib/settlementParties.ts`, `src/lib/settlementUtils.ts`, `src/lib/models.ts::calculateSettlement`);
only the **orchestration** below is new.

## Two kinds of money (do not conflate)
- **Budget lines** = external cash — revenue (`collected_by`) and external costs (`paid_by`, optional `payee_participant_id`, `deal_id`). Who physically handled it.
- **Deals** = inter-party **entitlements** (guarantee / rental / split / commission). What each party is *owed* — not cash movements.

## The algorithm (per event)
1. **Pool** = Σ revenue lines − Σ external cost lines.
2. **Entitlement `E_p`** per party from their deal: fixed guarantee/rental · %-split of pool · guarantee_vs_door = `max` · escalator tier by actual sold · commissions (deduct from recipient, credit the commission party — **disclosed/off-the-top only**; private **agent** representation is a separate settlement, see below) · bonus · costs assigned to a deal reduce that party's `E` · **operator = residual** (pool − Σ others); co-operators split the residual.
3. **Cash held** = `C_p − P_p` (revenue collected_by − costs paid_by).
4. **Net** `net_p = E_p − (C_p − P_p)`  (+ owed to them; − holding too much).
5. **`Σ net_p = 0`** — conservation law → assert it (property test on random inputs).
6. **Transfers** — greedy-match debtors → creditors into minimal `settlement_transfers`.
7. **Timing/state** — `before_event` deals pre-settle (transfer marked `paid`); `at_settlement` settle now. Manual override + `state(owed|paid|handled)` everywhere. **No escrow** — tracked, not moved.

## Falls out for free
- **Deductibles:** a cost `paid_by=venue` assigned to the band's deal lowers `E_band`, raises `P_venue` → net shifts, venue recovers it. No special case.
- **Per-participant settlements:** one `settlements` row each (E / collected / paid / net / transfers); serializer shows each party only theirs (operator sees all).

## Agent representation settlement (decisions #14)
An agent's commission is **NOT** an event `deal_party` — it's a **second `settlements` row scoped to a `representation`**
(`settlements.representation_id`), private to agent + performer, run by the SAME engine (a degenerate two-party
reconciliation). The event settlement keeps the performer at **full gross** (agent absent → the event's `Σ net = 0` has
no hidden term).
- **Commission** = `commission_rate × commissionable income` (deal income only — guarantee/ticket/split/escalator/bonus;
  NOT merch/extras/reimbursements). **Currency** = the deal's payout currency (no FX of its own).
- **Direction** from who held the cash: performer collected → performer → agent; agent collected → agent → performer
  (`gross − commission`).
- **INVARIANT — the payout redirect resolves PER ENTITLED `deal_party` LINE, not per deal.** `representation.agent_collects`
  redirects that performer's payout to the agent's account; the performer stays the **entitled** party. In a **split deal**,
  resolve the destination per split-line — one agented (`agent_collects`) + one self-managed performer must settle
  correctly on the **same** deal.
- **Status is derived:** the representation transfer is `owed` but *collectable* only once the event settlement's transfer
  to the collector is `paid`. Money movement (Flow 2 direct charge, never escrow) → `docs/payments.md`.
- **Termination:** commission **follows the confirmed deal** — a deal confirmed while the representation was active keeps
  its commission (its representation settlement stands post-termination); open negotiations revert to the performer.
- **Test to write:** split deal, performer A agented with `agent_collects`, performer B self-managed → per-line payout +
  two independent representation settlements + event `Σ net = 0` unaffected.

## Multi-currency
Pool math in `events.base_currency`; other currencies convert at a **locked FX rate captured at finalize** (overridable). Each transfer is *paid* in the payee deal's native currency. **Display** conversion (user currency, live FX) is a separate cosmetic layer — never touches settled figures.

## Worked example
P operates, rents V €1,000, books B €3,000; tickets €10,000 (collected P), production €1,500 (paid P).
Pool=8,500 · E: P=4,500(residual), V=1,000, B=3,000 · held: P=8,500, V=0, B=0 · net: P=−4,000, V=+1,000, B=+3,000 (Σ=0) → transfers P→V €1,000, P→B €3,000.
