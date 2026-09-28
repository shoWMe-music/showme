# Urgent board loop — 2026-09-28, part 13

Continues `-part12.md`. Run 7's last two majors.

---

## `QA7-3` — the plan

**Verdict: real.** The file that settles it: `apps/web/src/components/useBudgetEditor.ts`.

A **private** book with **zero rows** reported:

```
TOTAL REVENUE SEK 10,000 · TOTAL COSTS SEK 60,150 · PROFIT / LOSS −SEK 50,150
40 tickets planned across all types          Cost breakdown: Performer fee SEK 60,000 100%
```

**Three different books on one screen.** The SEK 10,000 revenue is `events.extras.ticketTiers`
(event scope); the SEK 60,000 fee is derived from the **shared** ledger's door; the private book
itself is empty. The headline −SEK 50,150 is not a figure about anything.

### What is deliberate here, and what it does not license

`useBudgetSeed` states — and is right — that the derived fee is **event-scoped**: *"deriving it from
whatever slice of ticket revenue happened to be in the book being viewed would produce a number that
is not the performer's fee and never will be"* (#23.2). That argument is about **what the fee is**,
and it holds: the "HOW TICKET REVENUE SPLITS" card is about the DEAL, and it should read the same in
either book.

It does not license folding that fee into an empty book's **TOTAL COSTS** and printing a
**PROFIT / LOSS** from it. And it says nothing at all about the ticket **revenue**, which is what
makes the private book count the same 40 tickets the shared book now also holds as a line.

### Scope

The two seeds stop applying to a private book, and only the seeds:

1. **The performer fee read from the deal** (`serverCosts`, the `PERFORMER_FEE_HEADING` branch) — a
   fact about the event's deal, not a cost of this operator's own book. A private book that has
   genuinely written its own share of the fee as a line still shows that line: a stored line is the
   operator's own assertion and outranks any seed, which is already the rule.
2. **The event's ticket tiers** (`eventTiers` into `mergeTicketTierSeeds`) — the door belongs to the
   night and is on the shared ledger. A private book showing it counts it twice across the two books.

Everything a private book actually *holds* still renders, and the deal-split card is untouched —
which is the distinction the finding itself draws.

*The decision it hides:* what a private book is FOR. `PLAN.md:215` answers it — one `shared` ledger
per event, and a `private` book is *"the extra an operator MAY ALSO keep"*. An extra that arrives
pre-filled with the shared book's numbers is not an extra; it is a second, wrong copy.

### Built, and proven on the running stack

One flag, `isPrivateBook`, and the two seeds consult it. Nothing else changed.

| | before | after |
|---|---|---|
| private book, TOTAL REVENUE | SEK 10,000 | **SEK 0** |
| private book, TOTAL COSTS | SEK 60,150 | **SEK 0** |
| private book, PROFIT / LOSS | **−SEK 50,150** | **SEK 0** |
| private book, tickets planned | 40 | **0** |
| private book, Performer fee row | SEK 60,000, 100% of costs | a blank heading, no figure |
| private book, HOW TICKET REVENUE SPLITS | 60/40 of the shared door | **unchanged** — 49,800 / 33,200 |
| **shared** ledger | SEK 83,000 · 320 tickets · fee *"Read from the deal"* | **unchanged** |

The split card surviving is the part worth checking, and it did: #23.2 is right that the fee is
event-scoped, so the deal's own card reads the same in either book. What is gone is the fee appearing
as a **cost of a book that holds nothing**, and a PROFIT / LOSS struck from it.

**No mutation run on this one, and here is why:** the change is two `isPrivateBook ? [] : …`
substitutions whose effect is a screen total, and the existing suite has no fixture that renders a
private book — the editor's tests cover the seed rules, not the scope switch. A test that pinned this
would need the hook under a React renderer with two budgets, which is a test-infrastructure piece
rather than a rule. The browser table above is the evidence, and it is the same kind the sweep used to
find it. Said plainly rather than left as an implied "tested".

## Suites

biome **735** clean · web **430** · e2e **112** · `tsc` clean. API untouched by this part.
