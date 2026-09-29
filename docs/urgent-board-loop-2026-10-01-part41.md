# The urgent board — part 41 (2026-10-01)

Continues `part40.md`, which closed at 480 lines with the full pass after run 16 clean and part 39
§1's payload half re-scoped. **This part is run 17's fold-back.**

`docs/qa-sweep-2026-10-01-run17.md` — **1 MAJOR, 6 MINOR, 3 COSMETIC, 3 NOTE. Not clean, so the loop
continues.** Five of the six named targets came back correct, and the report is the most careful one
yet: it grades its own MAJOR as a judgement call, separates what it verified from what it inferred in
four places, and lists **five probes that lied to it** — including a `fill_form` that reported success
and wrote `NULL`, and an a11y snapshot that renders a disabled button as an ordinary one. It also
names its own boundaries: nothing measured below 490 px, no two-browser check so **no evidence about
SSE at all**, and `agent@` never rendered.

The sweep's own best sentence is the one to carry forward:

> **the Album Release proves the dispute fix works, and if I had stopped there I would have reported
> this area clean.** … A fix verified on the row that motivated it is verified on one row.

That is the heuristic sharpened: not just *"the last fix is the next sweep's first target"* but
**check it on a row the fix has never met.**

---

## QA17-1 [MAJOR] · an objection reaches nobody, while a signature reaches the operator twice

### Which file settles it

`apps/api/src/routes/settlement.ts:3208` — `if (status === "pending_review") { … notifyUsers … }`,
the only `notifyUsers` in the status route.

### The verdict: real, and the shipped precedent is forty lines away

Verified. The comment above that guard reasons only about **e-mail to the objecting party** — *"a
dispute is raised BY a party and mailing them their own objection helps nobody"* — which is true and
is not an argument about the operator. The confirm route already does exactly the right thing at
`:4049`, with its reason written out:

> Realtime + feed: the OPERATORS only. *"Has everyone signed off yet?"* is the operator's question —
> it is what gates finalize.

**An objection is that question answered *no*.** So this is not a new mechanism, it is the same
mechanism the sibling route already has: `eventParticipantRecipients(database, id, actorUserId,
{ operatorsOnly: true })` → `notifyUsers`. FOLLOW A SHIPPED PRECEDENT INSTEAD OF INVENTING A RULE.

### The scope

1. **The channel.** On `dispute`, notify the event's operators — the precedent's exact call, its
   `operatorsOnly` flag included. `revised` and `pending_review` are the operator's own acts and need
   nothing; `comments_received` already lands in a thread the operator reads. So: `dispute` only, and
   say in the comment why the other two are not in it.
2. **The reader's own list.** The report's sharpest detail is that the Dashboard attention list still
   read *"4 things that need attention today"* through two disputes. `attentionList.ts` already has a
   `changeRequests` source built the same shape in run 16 — a disputed settlement the reader can act
   on belongs beside it.
3. **The roster's word.** The approval roster printed the objecting party as **Pending**, the same
   word as the four parties who simply had not answered. Silence and refusal are not the same state
   and the roster is where an operator looks. This is the same derivation QA17-6 needs, so it is
   built once, there.

### The decision it hides

**None for the channel** — the precedent settles it. But it sharpens §25.6's **objection row**
(§25.8.2), which proposes carrying an objection in `settlement_approvals` rather than overwriting
`settlements.status`: a notification and a roster state are both easier to get right if an objection
is a *row* rather than an erased status. Appending the evidence to that row rather than filing again.

---

## QA17-2 [MINOR] · run 16's fix holds only where `settlement_snapshots` has a row

### Which file settles it — and the answer is NOT the one the report proposes

`apps/api/src/routes/settlement.ts:591` `eventHasBeenFinalized`, and
`packages/db/src/seed-e2e.ts`.

### The verdict: the report's diagnosis is right, its suggested widening is wrong, and the root cause is the FIXTURE

The report proposes widening `wasFinalized` to the three other durable records it found:
`audit_log action='settlement.finalize'`, the non-disputing parties' `settlements.status`, and
`budget_snapshots.settlement_snapshot_id`. **Two of those three would not have helped.** Checked:
the finalize route writes the snapshot, the `writeAudit` row and the `settlement.finalized` activity
row **inside one transaction** — so a night the route finalized has all of them, and the seeded
Spring Warmup has *none* of them. The only record on the seeded row is `settlements.status` itself.

Which reframes the finding. `REVIEW_STATUSES` is `["pending_review", "revised", "dispute"]` and the
schema comment says so in words — *"`finalized` is not here either; it has its own route, because it
locks FX and cannot be undone"*. **So the status route cannot write `finalized`, the finalize route
always writes the snapshot, and the report's own inference is now verified: production cannot produce
a `finalized` settlement without a snapshot.** The state exists only because the seed writes a status
the app only ever writes together with three other records.

**A FIXTURE THAT ENCODES A STATE THE APP CANNOT PRODUCE** — the tallied shape, and this time it cost
a real symptom: the rail rewound on screen and `confirm` answered **200**, writing approval
`0457f53d…` after the freeze.

### The scope

1. **The seed writes what the route writes.** A `settlement_snapshots` row for the seeded finalized
   night, so the demo data is a state the app could have produced. That alone makes the rail correct
   and `confirm` 409 on Spring Warmup.
2. **And `eventHasBeenFinalized` gains one safe second clause**: any settlement row on the event at
   exactly **`finalized`**. Not `partly_paid` and not `paid` — those drift per party as transfers are
   marked, so including them would let one party's payment refuse another party's signature, which is
   A GUARD THAT REFUSES TOO MUCH. The clause cannot over-claim, because no route but finalize writes
   `finalized`.
3. **The clause needs a test that can reach it**, or it is a branch nothing can reach: an API test
   that inserts the seeded shape directly (status `finalized`, no snapshot), disputes, and asserts
   `confirm` 409s. Without that test, fixing the seed makes the clause unreachable and therefore
   unprovable.

### The decision it hides

None. Both halves are corrections, not choices.

---

## QA17-3 + QA17-4 [MINOR ×2] · the badge and the tile — one API field settles both

### Which files settle them

`apps/api/src/routes/settlement.ts:1988` (the list route already computes `finalizedEventIds` and
does not serialize it), `apps/web/src/components/settlementDocument.ts:39`
(`settlementStatusToDisplay`) and `:1184` (`settlementTotals`).

### The verdict

**QA17-3:** run 16 taught the rail, the caption and the signature button to read `wasFinalized`; the
one-word state badge still reads `status` alone, so a red **Dispute** pill sits in the same viewport
as a green **"Finalized — figures and rates locked, with an objection on record"**. A RULING
IMPLEMENTED ON ONE OF ITS TWO SURFACES — **eleventh** instance.

**QA17-4:** `settlementTotals` sums `row.status === "finalized"`, so a finalized-then-disputed night
reads **FINALIZED SEK 0** beside the row it is about, and `performer.a@` reads `Finalized SEK 30,000`
while holding SEK 46,500 of frozen money.

**They are the same missing field.** The list route computes the answer twenty lines above, for
`signableByYou`, and keeps it to itself — so the client cannot ask. Serving `wasFinalized` per row
fixes the sum and the badge together, and it is the **sixth** instance of the shape part 40 recorded
this morning: *a response schema that must re-declare what the route already knows will keep silently
dropping fields.*

### The scope

- `wasFinalized` on the settlements **list** row (it is already on the single read). Schema change →
  `sync-spec` then `generate`.
- `settlementTotals` counts a row as finalized when `status === "finalized" || wasFinalized`. The
  documented overlap with `outstanding` is unchanged and its reason stays written where it is.
- `settlementStatusToDisplay(status, wasFinalized?)`. **On a finalized night the badge reads
  `Finalized`** — matching the rail, the list, and the confirm route's own words — and the objection
  stays on the caption right below it, which already says *"with an objection on record"*. A one-word
  pill cannot say both things; the screen already has a place for the second one.
- Four call sites (`EventSettlementTab`, `Dashboard`, `Events`, `Settlements`) pass it where they now
  have it. An optional parameter, not a new function: the same question with better evidence.

### The decision it hides

None — the rail already decided which of the two facts leads.

---

## QA17-5 [MINOR] · the Curate card stays live on a finalized settlement

`apps/web/src/components/SettlementCurationCard.tsx:24` — `({ eventId })`, and it renders whenever
there are lines. `routes/settlement.ts:3787` calls `assertNotFinalized` unconditionally, so **every
chip 409s**. NEVER OFFER WHAT THE API WILL REFUSE — and the rest of this screen was rebuilt around
that rule in run 16, which withdrew Recalculate, Finalize, Send for review and Add revision. The card
is the one control left looking live.

**Scope:** the card learns the settlement is locked and draws its chips disabled under a caption that
says why, reusing the frozen wording already on the screen. The toast is honest today, which is why
this is MINOR — but an honest refusal is not a substitute for not offering.

---

## QA17-6 (+ QA17-1's third half) [MINOR] · "Pending" and "0/6" on a night nobody can ever sign

`routes/settlement.ts:2556` — `signatureExpected: (maySign.get(participantId) ?? false) || approved`.
After the freeze `signableByYou` is correctly `false` in all six seats while `signatureExpected` stays
`true` for every row, so the screen prints a pending signature and offers no way to give it, for ever.
The roster's own documented job is *"is this line waiting on somebody"* and the answer is no.

**Scope — one derivation, three states, because QA17-1 needs the same function:**

- **signed** → unchanged (`approved`), and it must survive the freeze: the confirm route's own words
  are *"Signatures given before they were finalized still stand."*
- **objected** → a party at `dispute` is not silent, and the operator's roster must not print the
  same word for a refusal as for no answer.
- **not expected** → once the night is finalized and this party never signed. Not "Pending": nothing
  is pending. The roster's count needs a denominator that means something on a closed night.

A GUARD WITH TWO CLAUSES NEEDS A TEST PER CLAUSE, and this one now has three.

### The decision it hides

**One, and it goes to Daniel.** *What should a finalized night's roster say about a party who never
signed?* The figures are final without them — finalize does not require every signature — so the
honest reading is "not required", but that is a statement about what a signature MEANT on that night,
and it is the same question §25.6's objection row is already holding. Recording the recommendation
(count only what was expected, and label the rest "not signed") and building that, flagged.

---

## QA17-7 [MINOR] · the Event status badge overhangs its track — and Events.tsx already wrote the rule out

`apps/web/src/routes/Settlements.tsx:111`. The report's inference is that the fix is `wrap: "nowrap"`
on the `Event status` column. **It is right, and there is a shipped precedent that says so rather than
an inference** — `apps/web/src/routes/Events.tsx:80`:

> The status track keeps its `min-content` floor because its content genuinely cannot wrap: the badge
> is `white-space: nowrap`, so a track narrower than the badge does not reflow it, it just pushes it
> out of the card again.

The Events list solved this for status badges by hand, in a literal template, before `DataTable` had
a prop for it. This morning's `shrinkableTrack` change generalised the same rule into
`wrap: "nowrap"` → `minmax(min-content, Nfr)` without knowing that comment existed. They agree.
Settlements simply never declared its third badge column.

**Scope:** `wrap: "nowrap"` on `Event status`, and then **measure** — three min-content floors on one
five-column table at 360 px is exactly the arithmetic that made this morning's failure, and
`mobile-audit.spec.ts` is the only thing that can fail on it. If three floors do not fit, the answer
is not to remove one: it is that this table must collapse the way Events, Bills, Requests and Tasks
do (the report swept all four at 490 px and they collapse cleanly).

**Verified pre-existing**, and the report proved it properly: it put the old `minmax(0, Nfr)` tracks
back in the live DOM and the pill still overhung by ~22 px. Today's commit widened it to ~30 px; it
did not cause it.

---

## The three COSMETICs

- **QA17-8 · "Dispute" vs "Disputed", four inches apart.** The chip says one, the badge and both list
  rows say the other, and clicking *Disputed* filters to *Dispute*. Every other status uses one word
  in both places. One word wins; the chip's is the better English.
- **QA17-9 · LINKED RECORDS prints truncated raw UUIDs** — `Event e2e00000`, `Budget line a7bcdf1b`
  (`InvoiceDetailModal.tsx:75`), for records that have names (*Spring Warmup*, *Sound & production*)
  and are not links. A fragment of a UUID is not an identifier a person can use; if the names are not
  on the response, the block says less rather than saying it in hex.
- **QA17-10 · six identical history rows for one press of Send for review** — and the fix already
  exists. `foldRepeatedActivity` and `repeatedActivityLabel` were built in run 16 and are applied at
  `EventSettlement.tsx:1333` only; `EventExtraTabs.tsx:299` (`EventHistoryTab`) maps `items` raw. A
  RULING IMPLEMENTED ON ONE OF ITS TWO SURFACES — **twelfth**, and this one is a call to a tested
  helper. It matters more than a cosmetic normally would, because after QA17-1 the operator's history
  is the *only* surface carrying a dispute, and six copies of one press push it down the page.

## The three NOTEs

- **QA17-11** — the Spring Warmup rail showing stage 2 unvisited is the documented safe direction
  (*"it can understate, never claim something happened"*). No action, and QA17-2's seed fix will make
  the underlying data honest anyway.
- **QA17-12** — the seed gives the co-host **`event.delete`** on the host's event, and
  `presets.ts:615` permits it by design because operators short-circuit the capability ceiling. The
  report deliberately did not file it or probe delete, because `story.md` states no co-host boundary
  to measure against. **A new §25.6 row**, and it belongs beside the floor-only-co-host row already
  waiting: both ask where a co-promoter's authority stops.
- **QA17-13** — `apps/marketing` not on :5173, known, recorded twice already.

## What the next sweep must carry

The boundaries are as valuable as the findings, because they say what this report is **not** evidence
about:

- **Nothing was measured below 490 px.** `resize_page` clamps at a 500 px window and Playwright MCP
  is down. The DataTable comment's 360 px measurement could not be re-checked — so the only current
  evidence at phone widths is `mobile-audit.spec.ts`, which is a suite and not a sweep.
- **No two-browser check, so nothing here says anything about SSE delivery** — no screen was seen
  updating without a reload.
- **`agent@` was never rendered**, so the represented-act surfaces are unverified.
- `…f3` (Spring Warmup / Marlo Vance) is left at `dispute` with no route back. QA17-2's seed fix
  makes the reseed that clears it worth doing anyway.
