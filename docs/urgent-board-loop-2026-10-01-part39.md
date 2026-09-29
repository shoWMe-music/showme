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

---

# Run 15 — NOT CLEAN: 1 MAJOR, 6 MINOR, 5 COSMETIC, 5 NOTE

`docs/qa-sweep-2026-10-01-run15.md`, 838 lines. Seven of the eight requested re-checks pass; the
eighth is the MAJOR. Folding them in in severity order.

## MAJOR — three settlement stage rows carry a `target_id` that is not a settlement

### Which file settles it

`apps/api/src/routes/settlement.ts` — the `writeActivity` calls at `:2949` (the status route) and
`:2705` (the comment route). Verified against the live database before touching anything:

```
settlement.pending_review | kind=settlement | target=…0000000000e1   ← the EVENT id
settlement.commented      | kind=settlement | target=…65a06d57c478   ← the settlement_comments id
settlement.revised        | kind=settlement | target=…0000000000e1   ← the EVENT id
settlement.finalized      | kind=event      | target=…0000000000e1   ← correct
e1's actual settlement ids: …2f1960dae5f6 …ea9a0dd7a111 …37206a56b58e …7a462ef92349 …434e7021992f …
```

### The verdict: a party-scoped KIND with an event-level SUBJECT

`lib/activity.ts` states the rule the read side enforces: `settlement` is **party-scoped** — *"only
the parties to that row — resolved by joining the viewer's participants to the target"*. So
`target_kind = 'settlement' AND target_id IN (viewer's settlement ids)` can never match an event id
or a comment id, and the rows are unreachable by every non-operator. Operators read them only
because `activity.ts` lets an operator bypass the kind filter.

**This is not a fix of mine carrying its next defect — it is a pre-existing defect my fix made
visible.** The rows have been unreachable since they were written; nothing read them until the rail
started asking the feed what had happened. The report is right that the fix commit's own browser
check would have passed: I checked it as `operator@`, the one seat for which it works.

**And the correct shape is already in the file, one line away.** The status route's own per-row
`writeAudit` writes `targetKind: "settlement", targetId: row.id` inside the same loop. One rule
written twice, and the copy that feeds the screen is the wrong one — the thirty-fourth instance of
a comment stating a rule that no test runs.

The comment above the broken call is what led it astray:

> *"ONE activity row for the event, not one per party. The status is a fact about the settlement as a
> whole, and a timeline that repeated it per participant would read as three things happening
> instead of one."*

That reasoning is **falsified by its own neighbour**: `settlement.confirmed` writes one row per
signature and the seeded Album Release carries six of them, which the Revision history has rendered
as six lines all along without anybody filing it. And the reasoning is only ever true of the
OPERATOR's timeline — the feed is party-scoped, so per-settlement rows appear to each party exactly
once. The comment optimised the one reader for whom the row already worked, at the cost of every
reader for whom it did not.

### Scope — three writes, and what each one's subject actually is

1. **`POST /settlement/status`** → one row **per settlement it moved**, `targetId: row.id`, written
   inside the loop beside the audit row. Only when the status really moved: a pure grant change
   (`fullAccess` without a status move) keeps its audit row and gets no timeline row, because #24's
   *"who opened the books, and when"* is answered by the audit trail and the comment beside it
   already says so.
   The summary gains `{ from, to }`, which `activityDetailLines` renders as
   **"Pending review → Comments received"** — so the operator's N rows become distinguishable by
   their own transition, which is strictly more than the single row said. `participantId` goes in
   too; the detail renderer is a whitelist, so an id it does not know is ignored rather than printed.
2. **`settlement.commented`** → the subject is **whose remark it is**, which is exactly the rule the
   thread's own read already applies (`GET /settlement/comments`: your own party's comments plus the
   event-side ones): `targetKind: "settlement", targetId: <the author's own settlement>` when
   `asParty` is set, and `targetKind: "event"` when it is null — the operator speaking for the event,
   *"addressed to everyone it is being reviewed by"*. No new disclosure either way: the feed row says
   only that somebody commented, and it now reaches precisely the people the remark does.
3. **`comments_received` needs its own row.** The comment path moves EVERY party sitting at
   `pending_review`, not just the commenter's — so party X's rail can stand at `comments_received`
   while X can see no remark. The status move is X's own settlement's news and X is entitled to it,
   so the path writes a `settlement.comments_received` row per settlement it moved, exactly like the
   status route. `EVIDENCE_FOR_STAGE[2]` already lists both types, so the rail needs no change.

### The half that is not the API's

`eventHistory.ts`'s `ACTIVITY_TITLE` has no entry for `settlement.pending_review`,
`settlement.revised`, `settlement.comments_received`, `settlement.dispute` or
`settlement.commented`, so all five fall through `humanize` — which is the API's identifier with a
capital letter on it. Nobody noticed because no party could see the rows. They get real titles now
that a performer reads them, which is run 13's own lesson in this file: *"THE READER'S WORD FOR A
FIELD THAT MOVED — never the API's identifier."*

### No decision for Daniel

Every choice above is settled by a rule already written down: the kind map says `settlement` is
party-scoped, the thread's read rule says whose a comment is, and #24 says the grant lives in the
audit trail.

### MAJOR built and proved

Six mutations, all killed — including **both disclosure directions** on the remark, which is the pair
a one-sided test would have missed: scoping it back to the comment id (nobody sees it) and widening it
to event-level (everybody does).

Proved on a fresh probe event, because both seeded settlements are finalized and a status move is
refused there — `QA15 stage-feed probe`, host plus Marlo Vance and Neon Tide on one split guarantee,
driven through all four stages with **Neon Tide** posting the only remark:

```
GET /activity?eventId=<probe>&typePrefix=settlement.,transfer.
  performer.a (did not comment)  pending_review 1 · comments_received 1
  performer.b (commented)        pending_review 1 · comments_received 1 · commented 1
  operator                       pending_review 3 · comments_received 3 · commented 1

…and on e1, whose rows were written BEFORE this fix, performer.a still sees:
  settlement.finalized 1            ← run 15's exact symptom, side by side with the fix
```

Marlo sees that the figures came back commented without seeing the remark she is not shown — which is
precisely the thread's own rule, and the reason `comments_received` needed a row of its own rather
than borrowing the remark's.

In the browser, as `performer.a@` on the probe:

```
before:  ✓ Open · ² Pending review · ³ Comments received · ⁴ Revised · ● Finalized
after:   ✓ Open · ✓ Pending review · ✓ Comments received · ✓ Revised · ● Finalized

Revision history: "Settlement finalized — figures locked" · "Figures re-issued after review"
                  "Comments came back on these figures" · "Figures sent out for review"
```

The last line is the other half: those four titles were `humanize`d identifiers until now, because no
party could see the rows to notice. Screenshot:
`docs/screenshots/qa-2026-10-01-run15/fixed-performer-sees-all-four-stages.png`.

biome 757 · settlement + activity + shares 198 passed, 0 failures.
