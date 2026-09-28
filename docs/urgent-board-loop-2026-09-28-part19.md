# Urgent board — the two features left, sized (2026-09-28, part 19)

Parts 17 and 18 closed everything actionable in sweep run 8 except its two majors, and everything
in run 7 except QA7-18. What remains is **three tickets**, not three fixes, and this part sizes them
so the next pass starts from the measurement rather than the discovery.

# QA8-1 and QA8-2 — sized, not built

Both are **features with a missing front end and a working back end**, which is the shape run 7's
QA7-5 had (`POST /offers` existed and nothing sent one). Neither is a fix; each is a ticket, and
each needs a screen designed rather than a control bolted where it fits. Sized here so the next
pass starts from the measurement rather than the discovery.

## QA8-1 — a deal's money is write-once

**What is already built and correct:** the route, the engine and the re-seed. `PATCH /deals/:id
{"advanceAmount":"500000"}` on a `sent` deal answers **200** and the planner re-seeds on the next
read — exactly what Ran's 2026-09-21 spec asks for — and run 7 verified the same for
`guaranteeAmount`, including its 409 once confirmed. **Nothing about the server needs changing.**

**What is missing:** every control. The only `PATCH /deals/:id` caller in `apps/web/src` is
`useDealTermsEditor`, which sends `agreementBodyText` and nothing else. `DealComposerModal` is
mounted once with no `deal` prop, so it can only ever compose a NEW deal. `DELETE /deals/:did` has
no caller in either front end. A deal typed with the wrong guarantee can be neither corrected nor
removed, and the only remedy on screen is a second deal on the same event — which double-counts at
settlement.

**Two sentences currently promise otherwise**, which is what makes it a MAJOR rather than a gap: the
card says *"Terms live until every party signs"*, and the Budget Planner says *"1 of 3 parties have
signed, so they can still move"* — a sentence **this loop wrote** for QA7-9, truthfully about the
data and falsely about the app.

**Size:** the sweep's own one-line suggestion is right and is the honest starting point — give
`DealComposerModal` an optional `deal` and open it from the card header while `agreementStatus !==
"confirmed"`. What makes it a ticket rather than a line: the composer's submit path creates, so it
needs an update branch; the optimistic-lock story (`expectedVersion`, decisions #8) has to reach the
dialog; reopening already writes an audit trail and an edit must join it; and **delete needs a
product answer first** — whether a deal with a computed settlement may be removed at all, or only
cancelled. That last one is a decision, not a build.

**Recommendation:** ticket the EDIT path on its own and ship it; leave DELETE behind the decision.
Edit alone closes both false sentences, which is the harm.

## QA8-2 — the representation lifecycle has no screen

**What is already built and correct:** `POST /representations` (201, `proposed`,
`confirmedByAgent: true`), `PATCH /representations/:id`, `GET
/representations/:id/delegatable-events` (200, with `alreadyAssigned` per event) and `POST
/representations/:id/events` — all alive, all driven directly this run. `apps/jobs` runs a scheduled
sweep for **due terminations**, so the back half of the lifecycle is not only built but operating.

**What is missing:** every caller but one. `GET /representations` has a single consumer — the
Send-an-offer dialog, filtered to active ones. Nothing in either front end names a representation, a
roster, a commission rate, a territory or a termination. **And one piece is not built at all:** a
proposal writes no notification, so the other side is never told. Measured: `select count(*) from
notifications where created_at > now() - interval '3 minutes'` → 0, and the act's dashboard,
Requests and bell all show nothing.

`decisions.md` #14 hangs the commission, the event delegation, the effective-dated termination and
the agent's `settlement.confirm` off this relationship; `story.md` says an agent *"acts through the
performers they represent"*. The only representation this product can hold is the one the seed
writes.

**Size:** four screens' worth, and they are not interchangeable — propose (agent → act, or act →
agent, since `proposedBy` takes both), answer (confirm / decline, which is the notification's
landing place), delegate (the `delegatable-events` picker, which already returns exactly what a
picker needs), and terminate (immediate or effective-dated, which the jobs sweep already honours).
Plus the notification that makes any of it discoverable — and that one is a prerequisite, not a
polish: a proposal nobody is told about cannot be answered, so shipping propose without it builds a
dead end.

**Recommendation:** notification first, then answer, then propose, then delegate, then terminate —
the reverse of the order the routes were written in, because it is the order in which each piece
becomes usable. Ticket separately; this is a subsystem, not a fix.

---

## What is left after this part

Run 8: nothing actionable but **QA8-1** and **QA8-2** above. `QA8-15` and `QA8-16` are notes the
sweep recorded as such — an unreachable column header on the seed, and Payouts being honestly
unbuilt.

Run 7: **QA7-18** only.

## QA7-18 — a deal awaiting your signature, on the dashboard

Sized in part 16 and unchanged: the predicate is lifted from `POST /deals/:did/confirm` (a line of
the reader's own, `confirmed_at IS NULL`, not an `observer`, the agreement not `draft`, and
`maySignOwnLines` — which matters, because QA6-1 was a party who could not sign and a row that
cannot be acted on would nag forever). The three pieces to reuse all exist:
`effectiveEventCapabilitiesForEvents`, `maySignOwnLines`, and `resolveDealAuthority`'s delegation
rule.

**The one decision, restated because it is the thing to settle before typing:** `resolveDealAuthority`
is per-event, so reusing it verbatim means a query pair per event — acceptable for a dashboard, and a
step below `activity.ts`'s stated standard of *"two extra queries, whatever the number of events; no
N+1"*. **Recommendation: add the batched `resolveDealAuthorityForEvents`.** The delegation rule is
subtle enough (a representation in its notice period is still live, A-19) that a second copy is the
thing to avoid, and a batched entry point in the module that owns it is the only way to have one copy
and no N+1.

**Do not commit the route without the dashboard row.** A mechanism with no caller is the shape this
loop has filed seven times, and QA8-1 and QA8-2 above are both that shape at feature scale.
