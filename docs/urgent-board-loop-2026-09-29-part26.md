# Urgent board loop — 2026-09-29, part 26

Part 25 closed QA10-6/QA9-7, QA10-7, QA9-12's render half and QA9-10, and reached 373 lines. **Run 9
is now fully closed.** What is left of run 10 is two cosmetics, one MINOR about realtime, and one
NOTE that turns out to be about a ruling rather than a screen:

| Finding | Sev | One line |
|---|---|---|
| QA10-8 | MINOR | A settlement recompute does not reach a second operator's open screen |
| QA10-16 | COSMETIC | *"You have 1 thing that need attention today."* |
| QA10-17 | COSMETIC | REVENUE / GUEST and COST / GUEST print the totals when no tickets are planned |
| QA10-21 | NOTE | The wizard's deal auto-sends, so §25.7.2's Delete-draft branch is unreachable from the primary path |

---

## 1. QA10-16 and QA10-17 — the plan, before building

**Which files settle them:** `apps/web/src/routes/Dashboard.tsx:330` and
`packages/shared/src/budget-planning.ts:536`.

### QA10-16 — one verb

`{n} {n === 1 ? "thing" : "things"}` and then, outside the ternary, a flat `that need attention
today`. The noun agrees and the verb does not. One-line fix, nothing hidden in it.

### QA10-17 — a per-guest figure with no guests

**The verdict: this is not a formatting problem on the band, it is a wrong number in the engine.**

```ts
const guests = attendees > 0n ? attendees : 1n;
…
revenuePerGuest: totalRevenue / guests,
```

The `: 1n` is a divide-by-zero guard, and a guard that returns a plausible wrong answer is worse than
the throw it prevents: with no tickets planned, "revenue per guest" comes back as **the entire
revenue**, which is what the sweep read (`TICKETS PLANNED 0 · REVENUE / GUEST SEK 100,000`). Fixing
it on the band would leave the same wrong figure for the next reader — and there already IS a next
reader: `budget-csv.ts:143` exports both, so the sheet somebody opens in Excel carries the same
number with no band to contradict it.

So the figures become `bigint | null`, null meaning *"nobody is coming, so there is no per-head
anything"*, and both readers print `—`. That is the ruling the same band already made about
`PROFIT MARGIN` for the same reason (QA7-26: *"a margin of nothing is not 0.0%"* — `—` is what the
app says everywhere else for "nothing to show").

**And the CSV never got QA7-26.** `budget-csv.ts:139` still writes
`Profit margin ${marginPercent.toFixed(1)}%` unconditionally, so an empty sheet exports **0.0%** —
the exact figure the band stopped printing two sweeps ago. Same shape as QA9-12's invoice modal,
which kept the null-means-dash rule on two sibling fields and not on the third: **a rule enforced at
one reader is enforced at one reader.** Fixed here, because the export is the copy that leaves the
building.

**The decision it hides: does `—` in a CSV cell break a consumer?** No: the column already carries
prose in the same rows (`Break-even tickets` writes `No break-even` through `plainRow`), so a
non-numeric Results cell is established, and every one of these rows is a human-readable export
rather than a machine feed.

## 2. What landed

### QA10-16 · QA10-17 — the verb, and a guard that answered

**QA10-17, read on the running stack** as `operator@` on Winter Gala's empty sheet:

```
TOTAL REVENUE SEK 0 · PROFIT MARGIN — · TICKETS PLANNED 0 · REVENUE / GUEST — · COST / GUEST —
```

The three dashes now agree; before this, the two per-guest cells printed the totals beside a
`PROFIT MARGIN —` that had already made exactly this call.

**The test that had to change is the interesting part.** `budget-planning.test.ts` asserted
`revenuePerGuest` was `0n` under the name *"does not divide by zero when capacity is unset"* — and
it passed because that fixture has **no revenue either**, so `revenue / 1` happens to be zero. It
was accidentally right in precisely the way QA10-6's caption was accidentally right at a 50/50
split, and it would have passed over the defect it was named for. It now asserts null, and a second
test puts money on a sheet with nobody coming — the shape the sweep actually read.

**And the export never got QA7-26.** `budget-csv.ts` still wrote `Profit margin 0.0%` on a sheet
with no revenue, two sweeps after the band stopped. Same shape as QA9-12's invoice modal keeping the
rule on two sibling fields and not the third: **a rule enforced at one reader is enforced at one
reader**, and the CSV is the copy that leaves the building.

QA10-16 is one ternary. The plural branch is verified live (*"You have 5 things that need attention
today."*); the singular is the other arm of the same expression, and forcing a seat to exactly one
attention item was not worth the fixture.

## 3. Next

- **QA10-8** — a settlement recompute does not reach a second operator's open screen. Realtime, so
  read the SSE topic scoping before scoping the fix.
- **QA10-21** — the wizard's deal auto-sends, which makes §25.7.2's *delete while draft* branch
  unreachable from the primary path. A NOTE about a screen that is really about a ruling.
- Then the full pass with the stack down in ONE go, and qa-sweep run 11.
