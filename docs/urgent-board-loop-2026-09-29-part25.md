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
