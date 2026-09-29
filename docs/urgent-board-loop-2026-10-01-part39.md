# Urgent board loop — part 39 (2026-10-01)

Part 38 ends with run 14 closed in full and the whole pass green (biome 757 · shared 349 · auth 41 ·
settlement 82 · db 25 · web 649 · **API 65 files / 1497 tests / 0 skipped** · **e2e 118**). QA sweep
**run 15** is walking the app now; this part holds the two named follow-ups, planned while it runs.

**Nothing in this part is built yet, deliberately.** A sweep is reading the running stack, and every
edit here would reach it — Vite hot-reloads the web on a `packages/shared` change, and the API needs a
restart it must not get mid-walk. The plans are written first because the standing instruction asks
for that anyway; the building waits for run 15's report.

---

## 1. The ticket-tier merge rule — one function, three callers

**Named in part 29 §1** as *"a task and not a wish"*, and left for a session that could do it
deliberately rather than as the tail of a cosmetics pass. Reading the two implementations, that was
the right call and the shape is now precise.

### What is actually duplicated

The rule is *"a tier on Event Details becomes revenue only if no budget line already states it"*, and
it has three cases. Both copies implement all three; they are just split differently:

| case | web — `mergeTicketTierSeeds` (`useBudgetEditor.ts:183`) | API — `copyBudgetOnce` + `seedTicketTiersIntoBudget` (`settlement-lines.ts:138`, `:229`) |
|---|---|---|
| the sheet states its own door | `serverTiers.some(tier => tier.hasBreakdown === false)` → return `serverTiers`, seed nothing | `ticketRows.some(row => details.basis !== "ticket_tier")` → skip the seed entirely (in the CALLER, one level up) |
| matched by tier id | event tier's `originTierId` ∈ written rows' `originTierId`s | `alreadyStated.has('id:' + tier.id)`, built from `details.tierId` |
| matched by name | trimmed, lowercased `name` | `alreadyStated.has('name:' + label.trim().toLowerCase())`, with `|| "ticket tier"` for a nameless tier |

Each side carries a comment saying it must agree with the other. They do agree today. The third
case exists because getting it wrong **showed SEK 57,000 on a SEK 25,000 night**, and matching by
name alone once settled SEK 6,300 as SEK 7,800 — so the cost of a third copy is already measured, and
Projections is the money screen that would be writing it.

### The shape to extract

The two callers disagree about what a "stated row" IS — a planner draft on one side, a `budget_lines`
row on the other — so the shared function must take the rule's own vocabulary and let each caller
translate into it:

```ts
// packages/shared/src/ticket-tiers.ts
export interface StatedTicketRow {
  /** `details.tierId` / the draft's `originTierId` — the tier this row was written FROM, if any. */
  tierId?: string | null;
  /** The row's label, as stored. Matched trimmed and lowercased. */
  label: string;
  /** False for a door row somebody typed themselves, which suppresses every tier. */
  fromTier: boolean;
}

export interface TierIdentity {
  id?: string | null;
  name?: string | null;
}

/**
 * Which of an event's tiers the budget does NOT already state. Empty when the sheet states its own
 * door — see the SEK 57,000 measurement.
 */
export function unstatedTicketTiers<T extends TierIdentity>(
  stated: readonly StatedTicketRow[],
  tiers: readonly T[],
): T[];
```

Then:
- `mergeTicketTierSeeds` becomes `[...serverTiers, ...unstatedTicketTiers(stated, eventTiers).filter(notDismissed)]`, keeping `dismissed` on the web where it belongs — a per-sheet-session removal is a UI fact, not a money rule.
- `seedTicketTiersIntoBudget` loses `alreadyStated` and takes the tiers it should write; its caller's `statesItsOwnDoor` block collapses into the one call.
- Projections asks the same function, which is the whole point.

Tests belong on the shared function, per case, plus the two measurements that made the cases exist as
named regressions (the door suppression at SEK 57,000, the rename double-count at SEK 7,800). The two
existing call-site tests stay: they are the only assertion that each caller translates correctly.

### The payload half

Projections has no input today — `ticketTiers` is not served on the events list. `GET /events` must
carry it. Whether it carries the tiers or a per-event minor-unit **total** is a real choice:

- **the tiers** — Projections runs the same function as everybody else, which is what makes a third
  copy unnecessary. Costs payload on a list read.
- **a precomputed total** — smaller, but the merge has to happen server-side against the budget the
  list query does not join, so it is a fourth place the rule lives. Rejected for that reason.

So: the tiers, on the events list, serialized minor-unit-safe. Changing the response schema means
`pnpm --filter @showme/api-client run sync-spec` then `… run generate`.

### The decision this does NOT take

Part 29 recorded it and it stays recorded: **should a tier on Event Details write a budget line the
moment it is typed?** That would make all three agree at the source, and it is a product call, not a
refactor — it would have Event Details writing into the planner's ledger, which is the coupling
`mergeTicketTierSeeds` exists to avoid.

---

## 2. The hand-rolled pluralisations — and why the count is not 38

Part 28 left **38** `n === 1 ? … : …` sites as a named follow-up, reasoning that *"converting
thirty-eight strings inside a cosmetic fix is a large mechanical diff over COPY, where a regression is
invisible to every suite."* Both halves of that need updating.

**The count is now 43**, which is the argument for doing it: the shape is still being written.

**But they are not all pluralisations.** Two of the first eight are not plural rules at all —
`useMarkUnavailable.ts:203` picks a single day out of a list, and `InvoiceDetailModal.tsx:166` chooses
between two whole labels. A blind sweep of the pattern would "fix" both into nonsense. And the real
plural sites come in at least four shapes:

```
{n} {n === 1 ? "song" : "songs"}          a whole word
member{n === 1 ? "" : "s"}                a suffix
entr${n === 1 ? "y" : "ies"}              an irregular stem
hiddenDealCount === 1 ? "it" : "them"     pronoun agreement, not a plural at all
```

So the task is a helper plus a **read** of every site, not a regex. `pluralise(count, singular,
plural?)` covers the first three (defaulting `plural` to `singular + "s"`); the fourth is a different
rule and stays where it is.

**How to convert without a blind diff.** A copy regression is invisible to the suites, so the
conversion is only safe where the rendered string is already asserted. The order is therefore:

1. `pluralise` in `@showme/shared`, with tests including 0, 1, 2, an irregular plural and a negative
   (which nothing produces today but a count can go negative through a bug, and "−1 tickets" is the
   right answer rather than "−1 ticket").
2. Convert the sites whose output an existing test already pins — `budgetPlannerView.ts` is the
   largest of these and has per-branch tests including *"the singular"*.
3. Convert the rest in small commits grouped by screen, each read rather than pattern-matched, with
   the before-and-after string quoted in the commit for anything not under test.
4. Record in `docs/codebase-reuse-audit.md` what was deliberately left — the pronoun case, and any
   site where a hand-written pair reads better than a helper call.

That is a real improvement rather than a mechanical one, and it is the only version of this task that
cannot silently change what a screen says.

---

## 3. The third follow-up, for completeness

`docs/codebase-reuse-audit.md` also holds **nine copies of `initials()`** and **three unread `users`
columns**. Neither is urgent and neither is copy: the `initials()` dedup is the review gate's own
example of real repetition, and the unread columns are a question about whether anything should read
them before they are dropped. Sequenced after the two above.
