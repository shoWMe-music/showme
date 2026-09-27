# QA sweep — the list, worked to empty (2026-09-26 → 2026-09-27)

Working state for the `/loop` pass, and now its record. Sources:
`qa-sweep-2026-09-26.md` (run 1), `-run2.md`, `-run3.md`. IDs are `r<run>:<line>` into
those files — go there for the reproduction, never re-derive it from this summary.

**Rules this pass was held to:** fix → prove on the running stack → biome + web + API +
e2e → commit. No deploy. No ClickUp writes. Mutation-check every new rule. A finding
that turns out to be a decision rather than a defect moves to *Parked* with the question
stated, and one that does not reproduce is corrected rather than quietly dropped.

**Where it ended.** Every blocker, major and minor from all three runs is closed,
parked as a product question, or recorded as deliberate. **Two of the parked questions
were answered on 2026-09-27** and are marked below; `decisions.md` #25 holds them. Nothing is deployed —
`main` is ahead of production by this session's commits, which is the next decision
someone has to take, not one this pass took. Four things are parked for Ran and are
the only open questions: the co-promoter's sight of the act's fee, the agent's
commissionable base, whether a split may pay a participant who has not accepted, and
the per-user display currency.

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
| r2:447 + r2:851 + r2:904 + r2:910 + r2:1011 + r2:1016 | The copy cluster: six screens asserting something untrue | `30a6782` |
| r2:455 + r2:474 + r2:860 | The currency cluster: dead chooser options, unconverted rows, invented EUR | `44719a2` |
| r3:442 + r3:459 | A frame arrived and left the page asserting the opposite | `162785d` |
| r3:535 | `revenueShares` accepted and silently dropped on line CREATE | `6f8af3d` |
| r3:529 | The agent was not told the agreement it must sign had moved | `6f8af3d` |
| r3:525 | Nobody was told a transfer was paid | `6f8af3d` |
| r3:619 + r3:153 | A co-promoter's own money: listed on one screen, 403 on the event | `f70c519` |
| r3:165 | "Room / Stage: Assigned" to everyone but the venue's own members | `9468472` |
| r2:894 | Nested `<button>` on the Venue row, on all five events | `9468472` |
| r3:178 | Naming a revealed cost heading threw the row out of the table | `fdadde6` |
| r3:173 | The budget scope chooser was nowhere in the URL | `fdadde6` |
| r2:480 | The planner's three headline figures did not add up | `db32eb0` |
| r2:880 | "Total settled SEK 0" beside "Finalized SEK 20,700" | `db32eb0` |
| r2:603 | Two fields named for one thing, SEK 1,500 apart | `db32eb0` |
| r3:731 + r2:866 | Escape went past the panel to the discard guard; a Remove the reader may not use | `5610067` |
| r2:616 | A draft line needed an explicit Add and the keyboard did nothing | `5610067` |
| r2:752 | The counter-offer named the act when the terms go to the agent | `5610067` |
| r2:758 | The date rail offered a day the chip hides, and the empty state said nothing | `5610067` |
| r2:887 | "Edit" promised access it could not change for that collaborator | `5610067` |
| r2:706 | "Place a hold" existed in exactly one place in the app | `5610067` |

**Corrected, not fixed:** r2:411 (inline Status "never saves") — run 3 found it does
save, behind a Save button run 2 never pressed. Downgraded to MINOR; no work owed.

---

## Open — blockers and majors

**None.** Every blocker and major from all three runs is either closed above, parked
below as a decision, or corrected as a misreading.

---

## Open — minors

**None.** Every finding from all three runs is closed above, parked below as a
decision, or recorded as deliberate.

---

## Found on the way, fixed with them

- **A party with no standing was handed money from an event they cannot open.** The
  global `/settlements` list joined `event_participants` with no status filter, so an
  `invited` co-promoter read *"SEK 10,000 — your payout"* on a night the API answers
  `404 Event not found` for (the capability engine refuses a non-standing participant
  `event.view`). The residual allocation writes their settlement row the moment the
  host computes, and nothing asked whether they had answered the invitation. The list
  now excludes the auth engine's own `NON_STANDING_PARTICIPANT_STATUSES` rather than a
  second spelling of them. Mutation-checked both ways.

## Corrections owed to the reports

- **r2:616's "blur, Enter and Recalculate all silently discard the row" does not
  reproduce.** Driven on the running stack 2026-09-27: the draft row survived Enter and
  survived a full Recalculate with both its typed values intact. What IS true is the
  half the report opened with — *"it cost me three probes before I saw it"*: the row
  needs an explicit **Add** and the keyboard did nothing at all, so a reader who
  pressed Enter had no way to tell whether they had entered a figure. Enter now commits
  the row and Escape abandons it.

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

- ~~**Should a co-promoter see the act's fee?**~~ **DECIDED 2026-09-27**
  (`decisions.md` #25): not automatically, and the host is PROMPTED to share it — adding
  a co-promoter offers *"share the act's deal with them?"*, one click makes them a
  `deal_party` observer (#4's own mechanism) and the withheld figures complete. The
  planner's withholding stays as the behaviour until nobody has been asked. Work owed:
  the prompt.
- **Should a reimbursed cost reduce an agent's commissionable income?**
  ClickUp `86cba8wtb`, status `re-do`. The second half of r2:804 turns on it, and so
  does the figure r2:603 was reading (the FIELD is now named for what it holds —
  `commissionableIncome` — which is the half that was a defect). Measured: the engine's
  commissionable base is
  `entitlement + deductibles` (31,500 + 3,500 = 35,000 → SEK 3,500 at 10%), which is
  what `commission-settlement.ts` and its test already assert — *a reimbursed cost
  does not shrink the agent's commission*. The screen renders the stored figure
  faithfully, so run 2's "SEK 500 too high" was two measurements either side of a
  recompute, not a client defect. Nothing to fix until the base is decided.

- ~~**Should a revenue share pay a participant who has not accepted the booking?**~~
  **DECIDED 2026-09-27** (`decisions.md` #25): it pays. The host writes the split
  deliberately, often before the invitations go out, and a settlement that pays someone
  who never turned up is theirs to correct. No work owed. Original note:
  r3:542. A `revenue_shares` row names a `participantId`, and the engine pays it
  whatever that participant's `status` is — so an invited act that has not answered can
  already be owed a cut of the door. The report filed it as *"worth a decision either
  way; recorded, not pressed"*, and it is: refusing to pay an unaccepted participant
  would also refuse the legitimate case where the host writes the split before the
  invitations go out, and the engine would then have to decide what happens to the
  unpaid remainder (drop it to the host? hold it?). Σ net = 0 makes that a product
  answer, not a code one. **Question for Ran:** should a split line to someone who has
  not accepted pay, hold, or be refused at entry?

## Deliberate — recorded, no work owed

r2:486 (payment processing in the planner's profit, not the settlement) · r2:492 +
r2:1138 (a deal that pays crew is invisible to the planner) · r2:625 (no "To be
deducted from" on settlement cost rows) · r2:793 (no per-person task assignee) ·
r2:938 (a counter-offer leaves no trace on the act's request) · r3:471 (a posted
message creates no notification) · r2:1117 (seeded images 404 only without
`apps/marketing`).
