# Urgent board loop — 2026-09-29, part 25

Part 24 (2026-09-28) reached 347 lines and closed all six of qa-sweep run 10's MAJORs plus three of
its MINORs. **The date rolled over mid-stretch**, so this part is dated today and the numbering
continues — the sequence is `…-2026-09-28-part24.md` → `…-2026-09-29-part25.md`, and nothing about the
work restarted at midnight.

---

## 1. QA10-13 — the plan, before building

**Which file settles it:** `apps/api/src/routes/inbound.ts`, `POST /offers`.

**What the sweep left standing.** Run 9's QA9-13 said *"a Requests destination a crew account can
neither receive on nor send from"*. Half of that is now wrong and the sweep says so: **sending** is
correctly refused (QA8-6, with the right sentence), and **receiving works** with a full action set.
What survives is the labelling — a venue's offer to a FOH engineer is stored `source:
"performer_offer"`, `sender_type: "performer"`, so the crew's card prints **SOURCE: Performer offer**
over a message from The Lantern Hall.

**The verdict, from reading the code rather than the report: the label is not the defect, the ROUTE
accepting the request is.** `senderType` is `kind === "agent" ? "agency" : "performer"` — an operator
falls into the else, so the row cannot help lying about who sent it. Two rules already written down
say an operator should never be here at all:

- `story.md`'s marketplace runs the other way — *"operators/performers post jobs and team-and-crew
  members apply"* — and that marketplace is unbuilt. QA8-6 refused the crew→venue direction on exactly
  this ground: *"inventing a second vocabulary for it here would ship a surface nobody has designed."*
- The operator's outbound move is **not** a booking request. `Requests.tsx` states it where the button
  would be: *"Not offered to an operator: they receive offers and answer them, and the outbound move
  that is theirs — a suggested event — is the Events screen's (`event_participants`, not a booking
  request)."* The same reasoning is in `86cbcehmp`'s own note: an operator offering a night to an act
  is an invitation, and the record of it is already the participant row.

So the web already refuses this direction and the API does not. **The rule is stated in the client and
enforced nowhere** — instance seventeen, and the mirror image of the usual one: not a comment that
outran its code, a comment in the right place with no server behind it.

**The scope.** Refuse `POST /offers` from an operator profile, with a sentence that names the move that
IS theirs rather than a status. Plus the label: `Requests.tsx` hand-rolls
`source.replace(/_/g," ").replace(/^\w/, upper)`, which is `humanizeEnumValue` from `@showme/shared`
copied — the review gate's *"nothing hand-rolls what the design system has"*, and a second place for
this vocabulary to drift.

**The decision it hides: may an operator ever offer a date to a performer through this route?** No, and
that is not a new call — it is #16's `event_participants` path, already built and already the only one
the UI offers. What this does NOT touch is the public form (`public_form`) or a venue handoff
(`venue_handoff`), which are other people's offers arriving.

---

## 2. What landed

| Finding | Commit | The shape of it |
|---|---|---|
| QA10-13 | `54256a5` | A rule stated in the CLIENT and enforced nowhere |
| QA10-11's split control | `32448e8` | A shared-ledger control drawn in a private book |
| QA10-12's second half | `32448e8` | **Not a defect** — a documented mechanism whose docstring warns against changing it |
| QA9-5 / QA10-11's margin | `f505396` | One predicate applied one scope too wide |
| QA10-6 / QA9-7 | see §4 | The same defect as `partyBasisPoints`, one field over, not generalised |
| QA10-7 | see §4 | A caption my own fix made conditional the same day |

### QA10-13 — refused, not re-labelled · `54256a5`

Built as planned: an operator's `POST /offers` is refused, naming the move that *is* theirs. The
label was downstream — `senderType` is `agent ? "agency" : "performer"`, so an operator falls into the
else and the row cannot help lying.

An existing test had been **using the gap as a fixture**, creating a self-addressed request through
`POST /offers` under the note *"`POST /offers` does not refuse a profile addressing itself, so this row
can exist"*. Its subject is `draft-event`, and such a row still arrives by public form, so it seeds the
row directly now and says why. Also deduped `Requests.tsx`'s hand-rolled `humanizeEnumValue`.

### QA10-11 — the production-costs split is the shared ledger's · `32448e8`

Its own subtitle is the argument: *"For co-promotions. Agree once how the operators share everything the
event carries."* A private book is the one book the other operator cannot see. `useBudgetEditor` was
already computing `isPrivateBook` for the two things this book had *already* dropped — the derived
performer fee (#23.2 / QA7-3) and the door-split card (QA8-8) — so it is exposed rather than recomputed.
**This is the third thing to leave that book for the same reason**, which is worth noticing: the pattern
is "a fact about the NIGHT rendered in a book that is about one operator".

### QA10-12's second half — not a defect, and why that is the finding

The sweep objected that opening the planner on a co-promoted event provisions a PRIVATE budget before
the operator asks, citing PLAN.md:215's *"the extra an operator MAY ALSO keep"*. `ensureEventBudgets`
answers it: giving both operators a private book **once a co-host exists** is deliberate and documented,
and its docstring records the money bug from the last time this was inverted — a solo operator given
only a private book, costs typed where nothing read them, and a 70% act paid **4,410 instead of 3,710**,
plus migration 0046 to heal the events already written. PLAN.md:215's own wording is that the private
book exists once there IS a co-host to keep it from, which is this case exactly.

The harm the sweep actually measured from those empty rows was the inflated *"5 events budgeted"*, and
that is fixed at the reading end (`924a143`). What was left is a mechanism whose docstring warns the
next reader off it. **Not every finding is a defect, and a report that names a real symptom can still
point at the wrong line.**

### QA9-5 — a private book shows its own margin · `f505396`

The withholding was one scope too wide, so the sentence was untrue of its page: *"what the night costs
is higher than the total above"*, where the total above was the operator's own SEK 4,000. The
asymmetry proves it — the HOST's private book always did print a margin, because the host can see the
deal, so the only operator who could never see one was the co-promoter, who is who the book is for.

Proven on both books in the same seat: My budget prints `PROFIT / LOSS −SEK 4,000` with no note; the
Shared ledger still reads `TOTAL COSTS (PARTIAL)` with *"One of this event's deals is not shown to
you…"* intact.

**One mutation survived and stays survived**: the editor→predicate wiring, which
`budgetPlannerView.test.ts` deliberately does not cover — its docstring says standing up a fake
`BudgetEditor` to re-assert somebody else's maths is not worth it. The two-book browser check is that
wiring's proof, rather than a fixture the file argues against. *A surviving mutation is a question, and
sometimes the answer is "covered somewhere better".*

## 3. Next

- Run 9's remaining: QA9-7 (two co-operators, one sentence, two fractions of "what is left"), QA9-10
  ("Base currency" in Settings honoured by one screen), QA9-12's render half (`—` not `SEK 0` for a null
  total). **QA9-13 is closed** by QA10-13 — the receiving half was already working and the labelling half
  is what the refusal removes.
- Run 10's remaining MINOR/COSMETIC rows from its §2.
- Then the full pass with the stack down in ONE go, and qa-sweep run 11.

---

## 4. QA10-6 / QA9-7 — the plan, before building

**Which file settles it:** `packages/settlement/src/reconcile.ts` first, not
`apps/web/src/components/settlementDocument.ts`. The screen cannot name a share it was never told.

**The finding.** Two operator cards on one screen at a 25/75 production-costs split:

```
The Lantern Hall | Operator | SEK 12,875
  What is left after every other party is paid   SEK 7,875
Northlight Presents (you) | Co-operator | SEK 18,625
  What is left after every other party is paid   SEK 23,625
```

Identical wording over SEK 7,875 and SEK 23,625. *"What is left"* is one quantity — SEK 31,500 — and
neither card says it is being divided, nor in what ratio. At 50/50 both read SEK 15,750 and the
sentence is **accidentally true**, which is why it has read as correct for four sweeps.

**The verdict: this exact defect was already fixed once, one field over, and the fix was not
generalised.** `partyBasisPoints` exists on an `EntitlementLine` for precisely this reason — the QA
sweep of 2026-09-27 found both acts on a 60/40 reading *"100% of the adjusted net SEK 50,000 — your
share of the deal's SEK 50,000"* over payouts of 30,000 and 20,000, and the answer was to carry the
party's own share into the snapshot and name it. `residual` is the same sentence with the same bug
and no such field. So this is not a copy fix; it is the second instance of a shape, and the first
instance already established the pattern, the fallback, and the reason for the fallback.

**The scope**, mirroring `partyBasisPoints` at every step:

1. `PartyBreakdown.residualBasisPoints?: number` — this operator's share of the residual in basis
   points, **absent when there is only one operator** (a share of one is noise) and absent on every
   settlement snapshotted before today.
2. `reconcile.ts` computes it from the weights it already allocates by (`operatorResidualShare`,
   default 1), so the percentage cannot drift from the arithmetic that produced the money.
3. `SerializedBreakdown` — the one contract shared by the engine, `settlements.computed` (jsonb) and
   `BreakdownResponse`. **And `BreakdownResponse` itself**, because Fastify strips what a schema does
   not declare and the field would vanish between a green API test and the browser.
4. The label: `"Your 25% of what is left after every other party is paid"`, and
   `"The Lantern Hall's 25% of…"` on somebody else's card under Full settlement access (#24.2) —
   `whose` already exists for that. **Falling back to `"Your share of…"`** when no share is
   recorded: true and vague, rather than precise and wrong, which is the ruling `partyBasisPoints`
   already made for a finalized settlement that is a legal record and is never rewritten.

**The decision it hides: does naming the share disclose a pool fact to a seat that may not read the
pool?** No, and the shape of the answer is why it is worth writing down. `operatorCostSplit` lives in
the SHARED ledger's planning assumptions, which a co-host on *Standard for the role* cannot read
(`OPERATOR_FLOOR` carries no `budget.view`) — so my first instinct was the vaguer
*"Your share of…"* with no number. It is the wrong call: the share on a card is **that party's own
term**, the same disclosure `partyBasisPoints` already makes about a deal, and the co-operator's
residual **amount** is on that screen already. A percentage is strictly less than the amount it
produced. What stays out is the other operator's share, and party scoping already handles that.

### QA10-6 / QA9-7 — the residual names its own share · what landed

Built as planned, engine first. Measured on the running stack, Album Release at 25/75 with the
acts on 65% so a residual exists at all (SEK 32,200):

```
Northlight Presents (you) | Co-operator | SEK 24,150
  Your 75% of what is left after every other party is paid   SEK 24,150
```

and the same compute's payload carries `residualBasisPoints: 2500` for The Lantern Hall against
`7500` for Northlight — the two cards can no longer read identically over different numbers. The
host's own card was not read in a second browser seat: both tabs share one browser profile and one
session, and signing out did not take. What is measured is the payload for both parties and the
render for one, plus a unit test for the other party's wording; that is the honest extent of it.

Five mutations, all killed — the label ignoring the share, the engine reporting a share for a solo
operator, the share computed as the raw weight rather than the fraction, the possessive never
trimming a trailing s, and **the API schema not declaring the field**, which is the one that
matters: without `residualBasisPoints` in `BreakdownResponse` the engine test, the snapshot test and
the web test all stay green while the browser renders "your share of" forever. Fastify strips what
it is not told about.

Fixed on the way, all three found by reading rather than by the sweep:

- **`"Northlight Presents's 75%"`** — `whose` appends `'s` unconditionally, and four captions on
  somebody else's card (#24.2) run through it. `possessiveOf` now gives a name already ending in s
  the apostrophe alone.
- **QA10-7's rental copy** (`packages/shared/src/deal-terms.ts`) — *"settled off the top before any
  split"* was made conditional by my own §25.7.1 the same day, so the New-deal dialog was promising
  a settlement the engine will not perform. It now says what is true of both shapes and names what
  decides between them, because the dialog genuinely cannot know yet: the parties are chosen further
  down the same form. **Instance eighteen** of a comment — here a caption — stating a rule the code
  does not keep, and the second of the "correct when written, world moved underneath it" variant.
- **`PartyBreakdown.offTheTop`'s docstring** — *"Rentals, taken off the top before any split"*, the
  same sentence one layer down in the engine's own types. Now names the predicate
  (`rentalComesOffTheTop`) and the four-wall case that keeps it from being simply "whoever pays".

### And a Testcontainers flake that perpetuates itself

`settlement.test.ts` failed twice running with *"Timed out after 10000ms while waiting for container
ports to be bound"* and **117 skipped, zero failed** — the shape the handoff warns about. A manual
`docker run -P` bound a port in under six seconds, so the daemon was fine. What was not fine:
**each failed run leaves its `testcontainers-ryuk` container behind, and the leftover makes the next
run fail identically.** Two were up; `docker rm -f` on both, and the same command passed 117/117
first try. The lesson is not "retry" — it is that the retry is guaranteed to fail the same way until
the reaper is pruned, which reads exactly like a permanent break. **`docker ps -a --filter
name=testcontainers-ryuk` before concluding anything from that timeout.**

One more small trap recorded in passing: `$CLAUDE_JOB_DIR/tmp/dburl.txt` is the **in-container**
url (`localhost:5432`) and works only through `docker exec`. Anything run on the host — the seed
script, for one — needs the `DATABASE_URL` from `api-env.txt` (`127.0.0.1:55432`).

**Fixture hygiene.** The browser check needed an unequal split, a residual, and a revenue line
inserted into the sealed settlement copy, all typed straight into the database. Those are exactly
the edits that become somebody else's phantom finding, so the event was restored with
`DATABASE_URL=… pnpm --filter @showme/db seed:e2e` — it deletes by seeded id and rebuilt Album
Release to the split of 10000, zero settlement lines, one settlement (`…f4`) and no planning
assumptions. Verified after the fact rather than assumed.

---

## 5. QA9-12's render half — the plan, before building

**Which file settles it:** `apps/web/src/components/invoiceDocument.ts` — the module that already
owns this table's vocabulary — and then its two readers.

**What is left of the finding.** The API half landed in `7cf4927`: an invoice with no total can no
longer be SENT (*"This invoice has no amount on it yet. Add the total before sending it — an invoice
without one reads as zero everywhere it is listed."*). What survives is the sentence that quote
makes: the ledger still prints **`SEK 0`** where the column is NULL, so a draft nobody has finished
asserts an amount of zero, three columns to the right of a `—` the same row uses for a category it
does not have.

**The verdict.** `formatMoney(null, currency)` coerces null to 0 by design — `amountMinor ?? 0` —
and that is right nearly everywhere: a total of nothing IS zero. It is wrong for exactly this field,
where null means *"nobody has typed the amount yet"* and zero would be a claim. So the fix is at the
two call sites that render `invoice.total`, not in `formatMoney`, and it is the same ruling
`settlementTotals` already made: an em dash rather than a zero when there is nothing at all.

**The scope.** One predicate in `invoiceDocument.ts`, used by `InvoiceLedgerTable` (the row) and
`InvoiceDetailModal` (the Total key-value). Two call sites rather than the review gate's three, and
deliberately so: this is not an extraction for reuse but one rule about one nullable column, and the
module those two screens already share is where a rule about an invoice field belongs. `Invoices.tsx`
is NOT a third: its `Number(invoice.total ?? 0)` feeds the money TILES, where a null contributing
zero is correct and QA7-13 is the reason.

**The decision it hides: is a null total ever legitimately zero?** No — and the API now agrees in
both directions. `total` is optional only so a draft can be written before its amount is known, and
a genuinely zero invoice writes `"0"`, which prints as `SEK 0` and should.

### QA9-12's render half — an em dash, and one more sentence it made untrue · what landed

Measured live as `operator@`, both rows on one screen:

```
VENDOR                     EVENT / REFERENCE   CATEGORY  DUE          AMOUNT     STATUS
QA9-12 amountless vendor   —                   —         15 Jan 2026  —          Draft
Nordic Sound Rentals AB    PA + backline hire  —         13 Jun 2026  SEK 9,000  Overdue
```

and in the detail overlay, `Total —`. The tiles did not move, which is QA7-13 still holding.

**The detail modal already had this rule on two sibling fields** — the VAT amount and a line-item
total are both `x != null ? formatMoney(x) : "—"` — and the invoice's own total was the one field it
was missing. That is the sharpest form of this recurring shape yet: not a comment stating a rule the
code does not keep, but *the same file keeping the rule twice and not the third time*.

And a sentence the fix made untrue two lines above it: **"No line items — this invoice carries a
total only"** printed directly over the new `Total —`, promising a total on the one invoice that has
neither. It now reads *"Nothing itemised and no total yet — this draft is still being written"* when
there is no total. Nineteen.

Two mutations killed on the predicate (the early return, and ignoring the row's own currency). The
two CALL SITES are covered by the browser reading above and by nothing repeatable: no e2e spec
drives the ledger's rows, and the fixture it would need — an invoice with a null total — is one the
API now refuses to send, so it would have to be posted by the spec itself. Recorded rather than
papered over, the same way QA9-5's surviving mutation was.

### Switching seats in the MCP browser, since this cost half an hour

Both tabs share one browser profile, so two accounts cannot be open at once, and the account menu's
**Sign out** did not end the session (the URL moved to `/login`, which is not a route, while the next
navigation rendered the dashboard from live authenticated data). What works: delete the origin's
IndexedDB (`firebaseLocalStorageDb` and `firebase-heartbeat-database`), **close every page on that
origin** — a surviving page holds a connection that leaves the delete pending, and a fresh tab then
hangs forever on the auth spinner with a clean console — then open a new page and sign in through
the form. `apps/web/tests/.auth/*.json` is NOT a shortcut: Firebase persists in IndexedDB, so those
files carry one `lastActivityAt` key and no session at all.

---

## 6. QA9-10 — the plan, before building

**Which file settles it:** `apps/web/src/routes/Settings.tsx:208-213` for the defect, and
`apps/web/src/routes/Invoices.tsx:313, 419-425` for the thing reading the code turned up.

**The finding, as filed.** Setting Settings → General → **BASE CURRENCY** to EUR changed one of six
money screens. Two complaints, called separable: the label names the *authoritative* measure
(`events.base_currency`, `deals.currency`) while writing the *cosmetic* one (`users.currency`), and
`useDisplayCurrency` has exactly one consumer.

**The verdict, from reading rather than from the report: `users.currency` is NOT purely cosmetic, so
neither the sweep's framing nor the hook's own docstring is right.** `Invoices.tsx` reads it as the
**denomination of a new bill** — and it does so because of QA6-17, where a `useState("EUR")` on that
form stored *"a bill for €2,500 that nobody wrote"* for an operator whose every event is SEK. That
is authoritative money, written from this field. So:

- The label is still wrong, but not because the field is cosmetic — because "base currency" is taken.
  It is the account's OWN currency, doing two jobs: what new bills are written in, and what screens
  offer to show figures in. **Recommendation, built: "Account currency", with one line under it
  naming both jobs and the boundary** — it never changes an event's or a deal's own currency.
- `useDisplayCurrency`'s docstring says *"It is COSMETIC and stays cosmetic … Nothing here touches
  what is owed, recorded or paid."* True of the HOOK, and read as a claim about the FIELD it is
  false. Instance twenty, and the first where the sentence is true of its own subject and wrong
  about the thing next to it.

**The Budget Planner is not a defect, and its own comment says so.** The sweep's table marks it "no",
but `EventDetail.tsx:962-970` refuses on purpose: *"a peek is a glance, not a preference, and coming
back to a budget you last looked at in euros and finding it still in euros is the silent-relabel bug
wearing a memory."* The planner's money fields are EDITABLE — seeding them from a standing preference
is the one shape that can write a converted number back as an authoritative one. Second time this
stretch a report named a real symptom over a documented refusal (QA10-12 was the first).

**The four aggregate screens are blocked, and by something worse than effort.** `settlementTotals`
does `const currency = settlements[0]?.currency ?? null` and labels a sum of every row with the FIRST
row's currency — so a Swedish operator with one Oslo show already reads a SEK+NOK total labelled SEK,
with the minor units added together. Converting that total into a preferred currency would multiply
one wrong label by another. **What a cross-currency total should even say is a product call, so it
goes to §25.6 with a recommendation rather than getting invented here**, and QA9-10's second half
rides on the answer.

**The scope, then:** the label and its line, the invoice form's pointer to it, the hook's docstring,
and one new row in `decisions.md` §25.6.

### QA9-10 — what landed

The control reads **ACCOUNT CURRENCY** with one line under it: *"Your currency: what a new bill is
written in, and what screens offer to show figures in. An event and a deal keep their own — this
never changes what is owed."* Read on the running stack as `operator@`. The invoice form's pointer
follows it, and `useDisplayCurrency`'s docstring no longer calls the field cosmetic.

**What is deliberately NOT built, and where the reason now lives:** the four aggregate money screens,
because `decisions.md` §25.6 now carries the cross-currency tile question with a recommendation —
refuse to label a mixed-currency sum today, convert with `≈` once the FX cache is actually filled.
The row names the three answers and says which of them is *wrong* rather than merely limited, which
is the part that does not need a ruling: `settlements[0].currency` labelling everyone's sum.

## 7. Next

- Run 10's remaining MINOR/COSMETIC rows from its §2 — read them there, do not re-derive.
- Run 9's QA9-14 (two minus spacings on one card) and QA9-15 (an event with no act shows its own
  title in the performer chip) are the last two cosmetics filed against a screen.
- Then the full pass with the stack down in ONE go — biome, shared, auth, settlement, web, the full
  API suite against the 1423 baseline plus what this part added, e2e including `motion.spec.ts` —
  and qa-sweep run 11.
- **Part 26 starts after this one; this file is at its length.**
