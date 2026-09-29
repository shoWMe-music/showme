# Urgent board loop — 2026-09-29, part 29

Part 28 closed at 339 lines with eight of run 11's MINORs and all four COSMETICs. Six MINORs remain.

---

## 1. QA11-9 — Projections and the Budget Planner disagree by SEK 80,000

**Which file settles it:** `apps/web/src/routes/Projections.tsx` — **not**
`apps/web/src/lib/eventProjection.ts`, and the difference is the whole verdict.

**What was measured.** A tier typed on Event Details (`General Admission · SEK 250 · est 320`,
stored in `events.extras.ticketTiers`) gives the Budget Planner **TOTAL REVENUE SEK 163,000** and
Financial Projections **SEK 83,000** for the same night. No `budget_lines` row is ever written for
the tier; Projections reads stored lines only. The settlement DOES pick tiers up
(`seedTicketTiersIntoBudget`), so Projections is the odd one out — and its own arithmetic is right
for the lines it can see, hand-checked by the sweep.

**The verdict: the number cannot be made right by a third copy of the merge rule, and there are
already two.** A tier only becomes revenue if no line already states it, and that rule is written

- in the web, `mergeTicketTierSeeds` (`useBudgetEditor.ts:184`), and
- in the API, `seedTicketTiersIntoBudget`'s `alreadyStated` (`settlement-lines.ts:215-260`),

each with a comment saying it must agree with the other. It has three cases — match by tier id,
match by lowercased name, and `statesItsOwnDoor`, where a hand-typed door row suppresses the event's
tiers entirely. That third case exists because getting it wrong **showed SEK 57,000 on a SEK 25,000
night**. Reimplementing it a third time, on a money screen, is how that returns.

**So this part does the half that cannot be wrong, and names the half that needs doing properly.**
Projections says what its figures do not include — which is what the sweep's own "Expected" offers
as the alternative, and what that screen already does twice (for deals it cannot read, and for
events with no budget). A third sentence is idiomatic there rather than novel.

**The follow-up, with its shape, so it is a task and not a wish:** move the merge rule into
`@showme/shared` as one function over minor units, have `mergeTicketTierSeeds`,
`seedTicketTiersIntoBudget` and Projections all ask it, and serve `ticketTiers` on the events list
so Projections has the input. That is a refactor of two pieces of working money code plus a payload
change — worth doing deliberately, not as the tail of a cosmetics pass.

**The decision it hides: should a tier on Event Details write a budget line when it is typed?**
That would make all three agree at the source and is tempting — and it is a product call, not a bug
fix: it would mean Event Details writes into the planner's ledger, which is the coupling
`mergeTicketTierSeeds` exists to avoid. Recorded, not taken.

### What landed — and the second half of the same room

Both screens now say what they are, read live with the sweep's own tier in place:

```
Budget Planner   TOTAL REVENUE SEK 163,000
                 640 tickets planned across all types — more than the room's 400 capacity
Projections      Marlo Vance — Album Release   SEK 83,000
                 "…A ticket tier entered on Event Details is not a budget line either, so it is
                  not added here until the planner or the settlement writes it in — and the
                  planner, which reads those tiers directly, will show more."
```

A reader on either screen can now tell which number is theirs and why, in the direction it differs.

## 2. QA11-14 — 640 tickets planned in a 400-capacity room

Taken in the same commit because it is the same sheet and the same cause: **tiers on Event Details
ADD rows to whatever the planner already holds**, so two plausible sets of numbers make one
impossible one. `grep -rn "exceeds capacity\|over capacity"` across `apps/web/src` and
`packages/shared/src` returned nothing — the planner had no concept of the room being full, while a
`Venue capacity 400` field sat two rows below the count and the chart beneath was captioned *"inside
400 capacity"*. Every per-guest figure divided by 640.

Said **on the subtitle that already states the count**, not as a new banner: the reader is looking at
that figure when they need to know, and on a sheet this tall a notice elsewhere is one they scroll
past. Five tests — over, under, exactly full (`>` not `>=`: selling the room is the plan working),
capacity unset (zero means nobody has said how big the room is, which is most draft sheets, and a
warning there teaches the reader to ignore it), and the singular.

**The browser caught my own fixture error on the way:** the first `ticketTiers` I wrote by hand used
the planner's field names (`unitAmount`/`maxQuantity`/`estimatedSales`) and the stored shape is
`price`/`max`/`est`, so the event answered **500** and the screen read *"Couldn't load this event"*.
Worth recording because the DB took the write happily — `extras` is `jsonb` and validates on the way
OUT, so a hand-written fixture can be malformed in a way only a page load reveals.
