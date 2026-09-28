# Urgent board — sweep run 9 (2026-09-28, part 22)

Run 9 verified **ten of ten** of the previous tick's fixes, plus run 8's three number fixes and run 7's
eleven. It then found **19 new items** — 4 MAJOR, 10 MINOR, 2 COSMETIC, 3 NOTE — and three of the
"holds" carry a residual it filed separately rather than calling a regression, which is the right
call: QA9-8 and QA9-14 are both leftovers of my own fixes, one card below where I stopped.

Order here: **QA9-1 first, because it is a leak and not a wrong number.** Then QA9-2, then the two
residuals of this loop's own work, then the rest.

---

## QA9-1 — the host's all-time revenue includes the CO-HOST's private book

**Which file settles it:** `apps/api/src/routes/insights.ts:74-79`.

**Verdict: real, and it is a cross-party leak rather than an arithmetic error.** That is what moves
it to the front of the queue. `/projections` shows the host:

```
PROJECTED REVENUE  SEK 216,000     4 events budgeted
Every figure here comes from the event's shared ledger.
…
All time, as host — ignoring the filter above: budgeted revenue SEK 238,345 across 5 events you hosted.
```

The SEK 22,345 difference is the two private books on one co-promoted event — and **SEK 12,345 of it
is Northlight's**, a figure the host is not entitled to see at all. The sweep proved it by moving
one: before the co-host typed anything the footnote read SEK 226,000; after, SEK 238,345.

The query filters on `events.hostProfileId` and `budgetLines.kind` and **nothing else** — there is no
`budgets.scope` predicate. `PLAN.md:215` is explicit that a private book is *"the extra an operator
MAY ALSO keep, existing only once there is a co-host to keep it from"*, and the **detail** route
already enforces it (`visibleBudgetFilter`, verified both directions by the sweep). So the aggregate
contradicts the detail route it sits above, and the screen's own sentence is true of the panel and
false of the line three below it.

**Scope:** one `where` clause. The route has exactly one consumer, so one screen leaks; the
`…/summary` beside it counts events and is unaffected; and the sweep confirmed **the settlement does
not leak** — recomputed with both private books present, `ladder.revenue` stayed `8300000` and
`Σ net = 0`.

*Why `shared` only, and not "shared plus my own":* the figure sits under *"Every figure here comes
from the event's shared ledger"* and beside a panel that `projectFromBudgets` already filters to
`scope === "shared"`. Including the reader's own private book would make the footnote disagree with
the panel in the other direction and keep the sentence false. One definition, and it is the panel's.

*The decision it hides:* none. PLAN.md:215 settles what a private book is, and the detail route
already implements it — this is the aggregate catching up.

### Built, and proven on the running stack

One predicate. Proven by reproducing the sweep's own setup — a co-host private book with a
**SEK 12,345** revenue line, created as `co.host@` through the API — and then reading the host's
figures:

| | before (run 9's measurement) | after |
|---|---|---|
| `GET /insights/profiles/…a1/revenue` | `23834500` | **`21600000`** |
| `/projections` panel | SEK 216,000 | SEK 216,000 |
| `/projections` footnote | **SEK 238,345** | **SEK 216,000** |
| the private line in the database | present | **still present** |

That last row is the point: the money was not deleted, it stopped being counted by somebody who is
not entitled to it. The panel and the footnote now agree, and the screen's own sentence — *"Every
figure here comes from the event's shared ledger"* — is true of both.

Two tests (the shared-only sum, seeding **both** a private book of the host's own and another
profile's, because the two are excluded for different reasons) and two mutations red: the scope
filter dropped, and inverted to private-only.

The line refused a `collectedBy`-less revenue line on the way in, which is worth noting as the
system working: *"Revenue nobody collected raises the pool while nobody holds it, and the settlement
can never balance."*
