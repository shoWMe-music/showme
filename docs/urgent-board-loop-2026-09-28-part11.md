# Urgent board loop — 2026-09-28, part 11

Continues `-part10.md`. **QA sweep run 7** came back with **20/20** of the verification items
from runs 5 and 6 holding — including the four that had never been browser-proven, and QA6-3's
realtime fix proven with six independent browser seats watching three separate SSE frames land
on already-open screens. New: **6 MAJOR · 13 MINOR · 4 NOTE · 4 COSMETIC**.

**A note on the machine.** This is an M1 Air, and the Testcontainers port-bind flake that has
dogged every full API run is resource exhaustion rather than a mystery — 65 test files each
starting a Postgres container, next to a dev stack, Docker, a browser and the emulator suite.
Docker's daemon stopped answering `docker ps` entirely during this part. So from here: targeted
test files while working, the full API suite and e2e in **one** pass with the dev stack **down**,
orphaned containers pruned as routine, and browser pages closed when done. Where a suite could
not be run, this doc says so rather than implying it was green.

---

## First, the thing the last part promised

`pnpm --filter @showme/api-client sync-spec && generate` — **done**, five files, twelve lines.
`planningAssumptions.paymentProcessing` is now optional in `openapi.json` and in the four
generated models, matching the route QA6-13 fixed. `tsc` clean in web, api and api-client.

---

## `QA7-1` — the break-even card solved the fee on a base `decisions.md` retired

**Verdict: real, and it is a money figure disagreeing with the engine.** The file that settles it:
`packages/shared/src/budget-planning.ts`.

`computeBudgetProjection`'s attendance scan applied `splitBasisPoints` to the **raw door**, which
is **#23.1** — the base **#24.1 reversed a fortnight before this code was written**. So one card
solved its break-even on the retired rule while every other figure on it used the current one, and
#24.1's own promise was broken by the half of the planner nobody had looked at:

> *"the Budget Planner moves with the engine, in the same commit … a split would otherwise have
> quoted the forecast one fee and the settlement another."*

The sweep read one screen at four attendances:

| Tickets | PROFIT / LOSS | BREAK-EVEN TICKETS |
|---|---|---|
| 108 | −SEK 86 | **200** |
| 109 | **+SEK 209** | **200** |
| 200 | +SEK 13,100 | **200** |

The KPI said 200 while the tile two centimetres above printed a profit at 109, and the chart
caption agreed with the KPI against the P&L.

### The fix, and what the base is

`derivedAt` now rebuilds the ladder's adjusted net at each attendance — revenue less every cost
that is **not** the derived fee itself (`trulyFixedCosts`, which carries the production costs and
any off-the-top rental, plus the per-ticket variable cost). Re-solved by hand on the sweep's own
figures it gives 109, and on its third repro (guarantee raised to SEK 25,000) 153 — both the
numbers the report derived independently.

**A clamp was written and then deleted.** `max(0, adjustedNet)` could not change an answer: below
the covering attendance the share comes out negative and `share > floor` refuses it, because a
floor is never negative. A percentage of a loss resolves to the guarantee, or to nothing where
there is none — which is what a guarantee is for.

### Three tests were arguing for the retired rule, in detail

This is the sharpest instance yet of the lesson that went into `CLAUDE.md` this morning — **an
assertion that carries a reason is making a claim about the code.** All three of these were
internally sound and had the wrong base:

| The assertion | Its reasoning | Now |
|---|---|---|
| `breakEvenTickets` **48** | *"70% of a 3,046 door is 2,132, so the SHARE governs there, not the floor"* — and it called run 2's original **42** wrong for freezing the fee | **42.** On the adjusted net the share at 42 tickets is SEK 1,446, so the SEK 2,000 guarantee governs after all. Run 2 was right and the door base made it look wrong. |
| **500** tickets in a 400-seat room | *"SEK 50 a head once the act takes half the door"* | **250.** Half the adjusted net means the operator recovers the SEK 25,000 first. |
| **no break-even** on a 100% share | *"every extra guest brings in nothing the show keeps"* | **50.** 100% of what is LEFT: the operator recovers SEK 5,000 first, so the night stops losing money at 50 and never profits. The old answer hid a real number behind "never". |

The beyond-capacity case the second of those carried has its own test now, built on a **guarantee**
the door cannot reach — 400 tickets in a 200-seat room.

### And a property of the scan worth knowing

Four mutations, three red. The survivor is `standingRevenue`'s place in the base, and it is
**structurally unpinnable** rather than uncovered: at any break-even, revenue equals costs, so the
adjusted net equals the fee — and `fee = split × adjustedNet` with a split under 100% forces
`adjustedNet × (1 − split) = 0`. **On the share arm the adjusted net at break-even is ~0 whatever
the base is made of.**

Which says which half of this fix carries the weight: the base matters on the **guarantee** arm,
where the fee is a constant and the base only decides which arm governs — exactly the case QA7-1
measured. A fixture tuned to catch the standing-revenue term would be tuned rather than true, and
the comment in the code says so.

The new test is the honest counterpart: no floor at all, a standing revenue and a per-ticket fee,
the share governing throughout, and the three wrong bases each answering differently (the gross
door 104, dropping the processing fee 52, dropping the sponsorship 0).

## Suites for this part

biome **732** clean · shared **304** · web **405** · `tsc --noEmit` clean in shared, web and
api-client. **The API suite and e2e were NOT run in this part** — Docker stopped answering under
load and both need it. They run in one pass, stack down, before the next commit that touches the
API.

---

## `QA7-2` — the planner derived the fee from a door it was not showing

**Verdict: real, and the third of three rules for one question.** The file that settles it:
`apps/web/src/components/useBudgetSeed.ts`.

`doorForecastFrom` read `fromSheet > 0n ? fromSheet : fromEventTiers` — the sheet wins whenever it
has any ticket row — on the stated grounds that it is *"the later statement of the same fact"*.
**They are not the same fact, and two other places in this app already say so:**

| | how it merges the sheet's tiers and the event's |
|---|---|
| the planner's ticket **table** | `mergeTicketTierSeeds` — additively, minus what the sheet already carries |
| the **settlement** | the same, `statesItsOwnDoor` in `lib/settlement-lines.ts` |
| `doorForecastFrom` | **either/or** |

So on the sweep's night the same card said `TICKET REVENUE SEK 93,000` and three ticket rows and
*"360 tickets planned"*, while the split beneath it divided **83,000** and promised *"the deal pays
SEK 50,000"*. `settlement/compute` paid **SEK 60,000** — and the compute writes the tier into
`budget_lines`, so only *afterwards* does the planner agree. **The window is exactly the
negotiation window.**

### Scope

`doorForecastFrom` now applies `mergeTicketTierSeeds`' rule, because it has to be the same one:

- a sheet ticket row with **no breakdown** is the whole door under a name of the operator's
  choosing and suppresses the event's tiers entirely;
- otherwise the door is the sheet's rows **plus** the event tiers the sheet does not already carry,
  matched on `details.tierId` first — a rename must not make one tier look like two, which is what
  `1dcc396` fixed for the table — and on the name as the fallback for rows written before that id
  was carried.

**Two more figures had the identical fault and are fixed with it:**

- `totalRevenue` (`sheetRevenue > 0n ? sheetRevenue : ticketRevenue`) dropped an unwritten tier from
  the base a **threshold bonus** is measured against (#23.3), on any event whose sheet held a single
  revenue row of any kind.
- `ticketsSold` counted the EVENT's tiers alone — so on the seeded events, whose tiers live in the
  budget rather than in `extras`, it was **zero**, and an escalator measured against ticket count
  never fired at all.

`BudgetLineForDoor` gained an optional `label`, which is the half of the merge rule that matches on
the name.

*The decision it hides:* none. Three places answer one question and two of them already agreed; this
is the third catching up.

### Mutation-tested: five, all red

| Mutated | |
|---|---|
| back to `fromSheet > 0n ? fromSheet : …` | 2 tests red |
| ignore a typed-in whole door | red |
| drop the tier-id match | red |
| drop the name match | red |
| the threshold base's either/or | red |

## The owed checks — RUN, once Docker was back

Docker's engine had stopped while the Desktop app stayed alive (see `-part12.md` for the diagnosis
and the fix). `showme-e2e-postgres` was `Exited (255)` behind it, so the container really had stopped
as well — it just was not the whole story. All three checks this part deferred are now done:

| | |
|---|---|
| **api** | **1379 passed.** Four files to the Testcontainers flake with zero failed tests; each green alone. |
| **e2e** | **112 passed.** |
| **QA7-2 on the running stack** | proven — see below |

**QA7-2, driven on the seeded Album Release.** Its shared budget holds the two ticket lines
(SEK 65,000 + SEK 18,000) and nothing else; a `QA7 Early bird` tier at 250 × 40 was added to
`events.extras.ticketTiers`, which is the exact shape the sweep used.

```
TICKET REVENUE  SEK 93,000        360 tickets planned across all types
HOW TICKET REVENUE SPLITS         60% SEK 55,800  /  40% SEK 37,200      ( = 93,000 )
"Box office only, before costs and rental — after them the deal pays SEK 60,000."

POST /settlement/compute  →  ladder adjustedNet 6000000
                             b2 entitlement 3600000   b3 entitlement 2400000
```

**The planner says SEK 60,000 and the settlement pays SEK 60,000.** Before the fix the split card
divided 83,000 (49,800 / 33,200) and promised SEK 50,000 against the same compute — and only agreed
*after* the compute had written the tier into `budget_lines`. Screenshot:
`docs/screenshots/qa-2026-09-28-run7/qa7-2-planner-and-settlement-agree.png`.

**QA7-1 is not browser-proven and will not be from here:** the sweep's own event (`QA7 Clash Night`,
a `guarantee_vs_door` deal with a cost row) does not survive a re-seed, and the seeded events have no
guarantee, so there is nothing on this stack where the guarantee arm governs. It stands on
hand-checked arithmetic at four attendances plus three mutations — and the next sweep can drive it,
which is the honest place for it.

## What could not be run at the time, and why

**Docker's daemon stopped answering `docker ps` and has not recovered** — three attempts, 45s, 90s
and 120s, all timing out — so on this machine there is no Postgres, which means **no dev stack, no
API suite and no e2e**. Both of this part's fixes are therefore proven by unit tests and mutation
checks only, and QA7-2's browser proof is owed.

Run when Docker is back, in one pass with the stack down:

1. `pnpm --filter @showme/api exec vitest run` — QA7-2 touches no API file, but the spec
   regeneration at the top of this part does.
2. `pnpm test:e2e`.
3. Then boot the stack and re-drive QA7-2's own scenario: add a tier on Event Details to an event
   whose budget already holds ticket lines, and check the split card and
   `POST /settlement/compute` now state the same figure.

Recorded rather than glossed, because a green unit suite says nothing about either.

## Suites for this part

biome **732** clean · shared **304** · web **409** · `tsc --noEmit` clean in shared, web and
api-client. **API suite and e2e: not run — Docker unavailable.**
