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
