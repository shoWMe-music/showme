# Handoff — 2026-09-14, written for a settlements session

**A snapshot of this moment, not a statement about the present** (CLAUDE.md's
standing warning about exactly this kind of file). Everything below was true when
the budget planner shipped. Check the code before you scope from it.

Deployed state is in [deployment-status.md](./deployment-status.md); the design
scoring is in [design-spec-budget-planner-2026-09-13.md](./design-spec-budget-planner-2026-09-13.md).
This file is only the part a settlements session would otherwise have to
reconstruct from twenty commit messages.

---

## 1. The settlement engine moved under you this session

The budget planner work reached into `packages/settlement` more than its name
suggests. Five changes, all live:

| what | where | why it matters downstream |
|---|---|---|
| `EntitlementBasis.pool` → **`base`** | engine, snapshot, API, generated client, web | a rename carried all the way through; old code reading `basis.pool` gets `undefined`, not an error |
| `EntitlementBases { doorBase, grossRevenue }` | `entitlement.ts` | a door split is a share of **gross ticket revenue** (decisions #23.1); a bonus threshold measures **gross revenue** (#23.3). They were one number before |
| `revenue_shares` jsonb | migration 0038, both `budget_lines` and `settlement_lines` | `revenueSharesOf()` / `reachesThePool()` in `revenue-shares.ts` |
| pooled revenue narrowed | `reconcile.ts` | only operator-collected or unattributed revenue reaches the pool. Residual = `pool − dealBaseSum − slicesOffPooledRevenue`, and attribution is credited **after** the residual |
| `operatorResidualShare` is finally **set** | `routes/settlement.ts` reads the shared budget's `planningAssumptions.operatorCostSplit` | the field existed in the engine since it was written and **nothing ever assigned it**, so every co-promotion split the remainder equally while the books balanced |

That last row is the shape of bug to expect more of: a field the engine reads,
that no caller writes. `Σ net = 0` holds either way, so conservation proves
nothing about attribution.

## 2. Production has never settled anything

Read off the production database on 2026-09-14, through the proxy:

```
budget_lines      27
settlement_lines   0     <-- zero
events            28
```

**The settlement surface has never run against real rows.** Everything known
about it comes from `settlement.test.ts`, `settlement-seed.test.ts` and the
seeded e2e event. Treat "it works" as "it works on the fixtures" until a real
event is settled, and note that `revenue_shares` on `settlement_lines` shipped
into a table with nothing in it — so that column has no production history at
all, only a shape.

## 3. "Carried by" now means the cash, not the bearing

The cost caption was renamed for the **fifth** time on 2026-09-14, and the
Settlement screen followed so the two screens do not disagree about one field:

- **"Carried by"** (was "Paid by") writes `budget_lines.paid_by`, which
  `reconcile.ts:250` reads as **cash held** by that party.
- **"To be deducted from"** is the bearing — `cost_split` /
  `payee_participant_id`, read by `costBearingOf()`.

Two captions that both read as bearing, and only a legend sentence tells them
apart. **Wiring "Carried by" to a bearing because its label sounds like one would
change what a settlement pays.** The full rename history, and the note that this
one was an informed choice rather than another guess, is in
`BudgetLineAttribution.tsx` and asserted by `budget-cost-vocabulary.spec.ts`.

## 4. What is owed and was not done

- **ClickUp writes.** Nothing was written back to any ticket this session. The
  `ticket-to-commit` loop is owed for the budget planner work, including the two
  contradictions on `86cbcn1f8` and the three missing cards recorded earlier.
- **The settlement design** is written up in
  [design-settlement-2026-09-10.md](./design-settlement-2026-09-10.md), and both of
  Ran's files now live in `claude-prototype/ran-2026-09-10/` rather than in
  `~/Downloads`. *Correction to the first version of this file: there is no
  `Settlement.html`.* What exists is the Deal Logic spec's settlement sections plus
  the Settlements screen in the All View prototype — render that before scoping a
  screen, because the budget planner was built twice from a written description.
  **Three of the spec's settlement rules are deliberately not ours** (decisions.md
  #23); implementing §3 and §7 literally would undo that.
- **`drizzle-kit generate` is still blocked** by pre-existing meta snapshot
  collisions at 0006/0007 and 0008/0009. Migration 0038 was hand-written. Any new
  migration needs the same treatment until those are repaired.
- **`apps/api` has no logs.** `buildApp` sets `logger: false`, so a production 500
  arrives in Cloud Run logging with an empty payload. If a settlement route
  misbehaves live, that is the first thing to change.
