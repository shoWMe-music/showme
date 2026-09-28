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
