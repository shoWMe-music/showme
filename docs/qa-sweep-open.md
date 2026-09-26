# QA sweep — the open list, 2026-09-26

Working state for the `/loop` pass. Sources: `qa-sweep-2026-09-26.md` (run 1),
`-run2.md`, `-run3.md`. IDs are `r<run>:<line>` into those files — go there for the
reproduction, never re-derive it from this summary.

**Rules for this pass:** fix → prove on the running stack → biome + web + API + e2e →
commit. No deploy. No ClickUp writes. Mutation-check every new rule. A finding that
turns out to be a decision rather than a defect moves to *Parked* with the question
stated.

---

## Closed this session

| ID | What it was | Commit |
|---|---|---|
| r2:202 | BLOCKER: editing one tier deleted the event's others | `e69a85a` |
| r3:270 | Renaming a tier counted it twice (6,300 → 7,800) | `1dcc396` |
| r3:297 | A tier could not be removed from the planner | `1dcc396` |
| r3:312 | Hand-written door row vs tiers, 32,000 apart | `1dcc396` |
| r3:330 | A JPY night settled on screen at 1% | `9deae1f` |
| r3:219 | Every re-send silently revoked full access | `9deae1f` |
| r3:389 + r3:94 | Two co-promoters shown profits 41,500 apart | `9deae1f` |
| r2:266 | Split card printed 111% and dropped the operator | `7e31d08` |
| r2:297 | A host-only event's date could never be moved | `7e31d08` |
| r2:387 + r2:947 | An agent read SEK 0 on every night they earn on | `7e31d08` |
| r2:427 + r2:640 | Two holds in one room both genuinely 1st | `7e31d08` |
| r2:580 | "Adjusted net divided" did not equal its own rows | `7e31d08` |
| r2:596 | Both acts told "your share of SEK 53,500" | `7e31d08` |
| r3:126 | Task budgets readable by every non-operator | `7e31d08` |
| r3:113 | Co-promoter's Deals tab said "No deal yet" | `7e31d08` |
| r3:350 | Ticket tiers lost a field on entry | `c95ba82` |
| r3:70 | BLOCKER: the co-promoter could not be SENT the settlement | `b779e45` |
| r3:141 + r2:866 | A refused tab rendered blank, retried 5×, and named a capability | `a9ab0df` |
| r2:346 | Break-even held the derived fee fixed (65 where 48 is true) | `02ff39a` |
| r2:368 | The split card overstated the take with no caption (4,410 vs 3,710) | `08b55e6` |
| r2:804 | The act's card omitted the cash they collected, so it never reached its own headline | `5374e7e` |
| r2:455 + r2:474 + r2:860 | The currency cluster: dead chooser options, unconverted rows, invented EUR | `44719a2` |
| r3:442 + r3:459 | A frame arrived and left the page asserting the opposite | `162785d` |

**Corrected, not fixed:** r2:411 (inline Status "never saves") — run 3 found it does
save, behind a Save button run 2 never pressed. Downgraded to MINOR; no work owed.

---

## Open — blockers and majors

**None.** Every blocker and major from all three runs is either closed above, parked
below as a decision, or corrected as a misreading. What remains is the minor list.

---

## Open — minors

| # | ID | What is wrong |
|---|---|---|
| 8 | r2:447 | Deal, planner and settlement give the split base three different names |
| 11 | r2:480 | Rounding makes the planner's three headline figures disagree |
| 12 | r2:603 | The commission's `performerEntitlement` disagrees with the act's own entitlement |
| 13 | r2:616 | A line on the Financials tab needs an explicit **Add**, and nothing says so |
| 14 | r2:706 | "Place a hold" exists only in the Calendar's day menu |
| 15 | r2:752 | The counter-offer dialog names the act when the terms go to the agent |
| 16 | r2:758 | The Requests date rail ignores the status filter, and the empty state hides it |
| 17 | r2:851 | A performer's own settlement says they take "100.0%" |
| 19 | r2:866 | A performer is offered an enabled Remove they may not use *(the capability-name half is fixed; the enabled-control half is open)* |
| 20 | r2:880 | "Total settled SEK 0" beside "Finalized SEK 20,700" |
| 21 | r2:887 | "Edit" a collaborator changes role only, though the menu says access |
| 22 | r2:894 | Nested `<button>` on the Venue row, on all five seeded events |
| 23 | r2:904 | The dashboard calls `on_hold` events "Pending event", beside a Pending tile of 0 |
| 24 | r2:910 | Financial Projections calls forecast figures "realized revenue" |
| 25 | r2:1011 | Crew's settlement "Deal structure" tab asserts a falsehood about the event |
| 26 | r2:1016 | Refusing a crew member's answer tells them they proposed the change |
| 28 | r3:153 | The invite dialog promises a co-operator their schedule and their own money, and grants neither |
| 29 | r3:165 | The co-host cannot read the venue's rooms; the event prints "Room / Stage: Assigned" |
| 30 | r3:173 | The budget scope chooser does not survive a reload and is not in the URL |
| 31 | r3:178 | Naming a fresh cost row before typing its amount throws the row out of the table |
| 32 | r3:525 | Nobody is told a transfer was paid |
| 33 | r3:529 | The agent is not told when the agreement it must sign is reopened or confirmed |
| 34 | r3:535 | `revenueShares` is accepted and silently dropped on line CREATE |
| 35 | r3:542 | A revenue share pays a participant who has not accepted the booking |
| 36 | r3:619 | Two routes disagree about whether a party may read their own settlement |
| 37 | r3:731 | Escape on the venue autocomplete offers to throw the whole event away |

---

## Corrections owed to the reports

- **r2:346's "42" is wrong.** Run 2 solved break-even holding the fee at the SEK 2,000
  guarantee, but 70% of the door it solved for is SEK 2,132 — the share governs there,
  so the report froze the fee while solving, which is the defect it was filing. The
  true answer is **48** (hand-checked: 42 leaves the night SEK 113 short, 47 leaves it
  SEK 7 short, 48 covers it). The screen said 65; it now says 48.

## Parked — feature work, not a defect

- **A display currency stored per user** (r2:1128, ClickUp `123qy9rpbb3`). PLAN.md
  promises it; nothing stores it, so the preview is per visit and Settings has no
  control. The half of that finding that WAS a defect — the planner marking converted
  figures `≈` while the settlement printed a bare `€544` — is fixed: the marker now
  lives inside `useCurrencyPreview.format`, so no screen can forget it.

## Parked — a decision, not a defect

- **Should a co-promoter see the act's fee?** `PLAN.md:215` says co-promoters share
  one budget with full transparency; the fee is deliberately never a budget row, and
  a deal is shared by making someone a `deal_party` (`decisions.md` #84). The planner
  now withholds the figures it cannot compute rather than guessing. Three options are
  in the status doc for Ran. Items 1–2 above may be narrowed by the answer.
- **Should a reimbursed cost reduce an agent's commissionable income?**
  ClickUp `86cba8wtb`, status `re-do`. Items 12 and the second half of r2:804 both
  turn on it. Measured today: the engine's commissionable base is
  `entitlement + deductibles` (31,500 + 3,500 = 35,000 → SEK 3,500 at 10%), which is
  what `commission-settlement.ts` and its test already assert — *a reimbursed cost
  does not shrink the agent's commission*. The screen renders the stored figure
  faithfully, so run 2's "SEK 500 too high" was two measurements either side of a
  recompute, not a client defect. Nothing to fix until the base is decided.

## Deliberate — recorded, no work owed

r2:486 (payment processing in the planner's profit, not the settlement) · r2:492 +
r2:1138 (a deal that pays crew is invisible to the planner) · r2:625 (no "To be
deducted from" on settlement cost rows) · r2:793 (no per-person task assignee) ·
r2:938 (a counter-offer leaves no trace on the act's request) · r3:471 (a posted
message creates no notification) · r2:1117 (seeded images 404 only without
`apps/marketing`).
