# Urgent board — run 7's last minors, notes and cosmetics: the plans (2026-09-28, part 16)

Written while **sweep run 8** drives the app. Nothing here is built yet, deliberately: every fix
below touches a file the running app loads, and editing one under a sweep would change the app it is
measuring. Plans first, per the loop's own order; the building follows the sweep's report.

Closed so far this run: QA7-1…6, 8, 9, 10, 12, 13, 14, 15, 16, 19, and QA7-28 (not in the sweep).
Remaining: **QA7-7, 11, 17, 18** and the notes and cosmetics **QA7-20…27**.

---

## QA7-23 — COSMETIC by placement, a real defect by content: a docstring that describes the opposite of its code

**Which file settles it:** `packages/shared/src/budget-planning.ts:264`.

```ts
/** Round half away from zero, so a break-even of 100.5 tickets needs 101. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  return numerator / denominator;          // BigInt division — truncates
}
```

**Verdict: real, and wrong in two ways rather than one.** It does not round, and its example is not
what it computes: the function's only caller is `averageTicketPrice` (line 331), not break-even. The
name `divideRounded` asserts the same thing the docstring does, so the code is the odd one out — two
independent statements of intent against one implementation.

*Scope:* implement the rounding the name and the comment both promise, and correct the docstring to
describe its actual caller. Round **half away from zero** so a negative average (possible on a refund
line) rounds symmetrically. The effect is at most one minor unit on a displayed average, which is why
this sat unnoticed — and is also why it is safe.

*The decision it hides:* none. `docs/money.md` is satisfied either way (BigInt throughout, no float,
no hard-coded ×100); a displayed average is not a settled amount. Round-to-nearest is simply more
accurate than truncation for the thing it is used for.

*Proof:* a test per branch (0.5 up, −0.5 down, exact division untouched), and a mutation that
restores the truncation must go red. No browser proof needed — this is a pure function with a suite.

---

## QA7-25 — the create-event deal step states the base #24.1 retired

**Which file settles it:** `apps/web/src/components/NewEventWizard.tsx:1806`, plus the comment four
lines above it, which asserts the same retired rule.

**Verdict: real.** The hint reads *"Of revenue less the costs paid to outside suppliers. What is left
over is yours."* That is **#23.1**'s pool. `decisions.md` **#24.1** (2026-09-15) reversed it:

```
Gross revenue − Deductions = Net revenue − Venue rental (off the top) = Adjusted net
```

and every percentage divides the **adjusted net**. The wizard's sentence omits the off-the-top step
entirely, so an operator setting 70% is told the 70% is of a larger base than the engine will use.
The deal detail screen already says it correctly (*"Share of the adjusted net 70%"*).

*Scope:* the hint, and the comment above it — both, because the comment is what would restore the
wrong sentence next time somebody edits the hint. Seventh instance this run of copy stating a rule the
code does not keep, and the second where the comment and the copy agree with each other and not with
the engine.

*The decision it hides:* none. #24.1 is explicit and recent.

---

## QA7-27 — an un-numbered invoice shows the first segment of its primary key

**Which file settles it:** `apps/web/src/components/invoiceDocument.ts:58`
(`invoiceReference`), two call sites: the ledger's EVENT / REFERENCE column and the detail modal's
title (*"Invoice 1ec9843d"*).

**Verdict: real, and the fallback is the defect rather than the absence.** A received bill correctly
has no `number` — the vendor's reference is the vendor's — and an issued invoice has none until it is
issued. Falling back to `id.slice(0, 8)` prints a value that looks like a reference, is not one, and
cannot be quoted to anybody. The app already has a word for "nothing to show here": `—`, which
`invoiceCounterparty` in the same file returns for exactly this situation.

*Scope:* the fallback. A row with no number says `—` in the column, and the modal is titled
*"Invoice"* rather than *"Invoice <uuid fragment>"*. Two tests in the file's own suite (a numbered
invoice keeps its number; an un-numbered one does not invent one) and a mutation restoring the slice
must go red.

*The decision it hides:* a small one, and it is answerable from `story.md` rather than needing Ran:
whether a draft should carry a provisional reference. It should not — `POST /invoices/:id/issue` is
what assigns a number, so a provisional one would be a second numbering scheme for the same document.

---

## QA7-24 — a converted card compares euros to kronor in one sentence

**Which file settles it:** the caption builder behind the settlement's entitlement rules — the same
`entitlementRules` / `describeBasis` family in `settlementDocument.ts` that QA5-1 and QA6-4 corrected.

**Verdict: real, and narrower than it looks.** Previewed in EUR, every figure converts and carries
`≈` (hand-checked at one consistent rate across six figures), and the caption beside them reads *"The
70% door share beats the **SEK 18,000** guarantee"*. Keeping a contract figure in its payout currency
is right — a guarantee is a number in an agreement, not a display preference. Putting both currencies
in one comparative sentence is what misleads: the reader is invited to compare `≈ €6,731` against
`SEK 18,000`.

*Scope:* the caption converts the guarantee **too** when the card is being previewed in another
currency, and marks it `≈` like everything else around it. The payout currency stays the authority —
this is the display layer, and `docs/money.md`'s rule is that a live rate is cosmetic and never
touches a settled amount, which is satisfied because nothing here is re-settled.

*The decision it hides:* one worth stating. If the reader must be able to see the contract's own
figure, the honest form is both (*"beats the SEK 18,000 guarantee (≈ €1,554)"*) rather than either
alone. That is the version to build: it keeps the agreement's number authoritative and makes the
comparison legible in one unit.

---

## QA7-26 — "PROFIT MARGIN 0.0%" beside "PROFIT / LOSS −SEK 50,150"

**Verdict: probably already closed by QA7-3, and to be checked rather than built.** Both figures are on
the private ledger's Results card, and QA7-3 stopped the private book seeding itself from the shared
one — its TOTAL REVENUE, TOTAL COSTS and PROFIT / LOSS all read **SEK 0** now (part 13's table). A
margin of 0.0% beside a loss of zero is not a contradiction. Sweep run 8 walks that screen; if the
pairing survives, it is a margin formula that divides by a zero revenue, and the fix is to show `—`
rather than a percentage of nothing.

---

## QA7-17 — an `operatorCostSplit` keyed by the wrong id is accepted, stored, echoed and ignored

**Which file settles it:** the budget PATCH's validation, against
`apps/api/src/routes/settlement.ts:732`, which reads the map.

**Verdict: real, and HALF of the finding is not a defect.** The engine keys the map by
`event_participants.id` (`operatorCostSplit?.[row.id]`), and the Zod schema accepts any uuid, so a
caller passing `profiles.id` gets **200**, a verbatim echo, a stored row, and a silent fall back to
equal shares. Nothing at the API or on screen says the stored split is inert. The UI sends participant
ids and is correct.

**The half that is not a defect:** the finding also objects that *"a value in basis points that a
caller sending percentages (70) will also get accepted"*. `operatorResidualShare` is an **integer
weight** — `allocate(residual, weights)` in `reconcile.ts:233` — so 70 and 30 divide the residual
70/30 exactly. There is no unit to get wrong. Worth writing down, because the schema's `max(10_000)`
reads like basis points and invites the same wrong conclusion twice.

*Scope:* the write validates that every key names a participant **on this event**, and refuses with a
message naming the offending key. A silent no-op is the failure mode to remove; a 400 that says which
id is unknown is the replacement. API-side, so it needs the server restarted before any browser check
— and an API test, which is where this belongs anyway.

*The decision it hides:* whether to accept `profiles.id` as a convenience and translate it. It should
not: one event can carry the same profile twice (a profile in two roles), so a profile id does not
identify a participant. Refusing is the only unambiguous answer.

---

## QA7-18 — a deal waiting for your signature is not something that "needs attention"

**Which files settle it:** `apps/web/src/routes/Dashboard.tsx:183` and a new read on the API.

**Verdict: real, and measured against the card's own stated rule.** The dashboard's comment says what
belongs there: *"What is left in 'Needs attention' is what somebody ELSE is waiting on."* A deal at
`agreement_status = 'sent'` with the reader's own line unsigned is precisely that — every other party
is waiting on them — and the event's Deals tab offers **Confirm your line** while the screen whose job
is routing them to it says *"You're all caught up"*.

**Why it is the biggest of the remaining minors:** there is no cross-event deal list. `/events/:id/deals`
and `/deals/:did` are the only reads, so the dashboard cannot answer "which deals await my signature"
without N requests. This needs **one new API read** — the deals where a `deal_parties` row for one of
the caller's profiles has `confirmed_at IS NULL` on an agreement that has been sent — and then one
`AttentionItem` per row, linking to that event's Deals tab.

*Scope:* one route, one hook, one row shape on a card that already has four. Not a redesign.

*The decision it hides:* none for the signature case. A neighbouring question is worth *not* answering
here: whether a deal merely `draft` (nobody asked yet) should appear. It should not — the card's rule
is somebody else waiting, and a draft is the reader's own unfinished work, which is the same
distinction that moved tasks off this card in the first place.

---

## QA7-7 — an agent added to an event none of their acts is on

**Which file settles it:** `apps/api/src/routes/participants.ts` (the `POST` that writes the row).

**Verdict: real, and the boundary holds — the refusal is at the wrong end.** `POST
/events/:id/participants {role: "agent"}` answers **201** with `status: "invited"` and writes a
notification promising access; the agent then gets **404** from `GET /events/:id`, from
`participation/accept`, and from `/events/:id/deals`, and the invitation appears in no inbox. Nothing
leaks. What exists is a permanent `invited` row nobody can act on and a notification that lies.

`story.md` is the authority: an agent *"acts through the performers they represent"*. Where there is
nobody to act through, there is no participation to invite. The correct path already works and proves
the rule — adding **Marlo Vance** auto-adds Astra, and the notification names the act.

*Scope:* the write refuses (400) when the profile being added as `agent` represents nobody on the
event, with a message saying so. The auto-add path is untouched. An API test per branch: refused
without a represented act, accepted with one.

*The decision it hides:* whether an operator may invite an agent *ahead* of their act — "I want Astra
on this, and Marlo will follow". Recommendation, and it needs no new rule: **no.** Add the act; the
agent follows automatically, which is the mechanism that already exists and the one the correct path
demonstrates. Inviting the representative first inverts the relationship story.md defines.

---

## QA7-11 / QA7-22 — the audience gap, already filed

`audience_rsvps` is written by `routes/public.ts:645` and read by nothing; `/audience` says *"No
audience yet"* over rows that exist, and the public page has already promised a member of the public
that their details reached the organiser. Import/export (QA7-22) is the same screen's other half.

**This is not a minor and should not be built as one** — it is the ticket already recorded in the
handoff as *"the audience read endpoint (QA6-19)"*: a read route, a screen that consumes it, and the
public promise as its acceptance text. Run 7 contributes the row that proves the write happens.
Recorded here so the next pass does not re-derive it.

---

## QA7-20, QA7-21 — notes, and they stay notes

`#25.1` decided and unbuilt (Decline/Counter on the act's side, *Accept request* on the operator's,
and a room/venue on every `booking_requests` row), and the parked per-user display currency and date
format. Both are records of unbuilt decisions rather than defects, and neither is this loop's to
invent.

---

# Built (while the sweep ran)

Three of the plans above landed. All three are API-or-pure, which is what made them safe
to build under a running sweep: **the dev stack does not reload the API** (CLAUDE.md), so
editing `apps/api` is invisible to the app the sweep is driving, and a pure function in
`packages/shared` is proven by its own suite rather than by a browser. The four remaining
items — QA7-24, 25, 26, 27 — are all web files on screens the sweep is walking, and they
wait for it.

## QA7-23 — done (`fdd607e`)

Rounds half away from zero now, on magnitudes re-signed at the end so the half travels the
same distance either side of nothing. Three tests, four mutations red — including
**"ceiling instead of rounding"**, which is how this could have been fixed wrongly in the
other direction, and one that drops the sign handling so a negative rounds toward zero.

**Correction to the plan above.** It said the effect is "at most one minor unit on a
displayed average, which is why this sat unnoticed — and is also why it is safe". The
first half is right and the second was too quick: `averageTicketPrice` feeds
`contributionPerHead` and `perHeadIncome`, so an average that truncated low pushed
break-even a fraction of a ticket HIGH. Still small, still not cosmetic. The sweep filed
it as "not load-bearing" and I repeated that before reading the call sites.

## QA7-17 — done (`04aa38a`)

**The check was already in the file.** A budget LINE's `costSplit` is the same map, keyed
the same way, and has been validated since the audit on the reasoning that *"a foreign id
there breaks the conservation law by the same arithmetic, so it gets the same check"*. The
planner's copy of the map simply never reached that code. So the membership query is now
shared by both doors rather than copied for the second, and the refusal reuses the sentence
a line's `costSplit` already gets — one mistake, one vocabulary.

Four tests, four mutations red, and two of them are worth their counts: dropping the event
from the membership query fails **five** tests and stubbing the query's result fails
**eight** — both callers. That is the evidence the shared query is load-bearing for the
original caller too, not just mine.

## QA7-7 — done (`bb00ec3`)

Same shape as QA7-17, one module over: `assignAgentToEvent` has always refused an agent
whose act is not on the bill, and the direct `POST /events/:id/participants` never went
near it. `agentRepresentsSomeoneOnEvent` asks that question one row wider — any
representation rather than one — in the module that owns it, and the write answers 400 with
the fix in the message.

**Two of my own tests were vacuous, and only mutation testing said so.**

- *"refuses an agent whose act is on ANOTHER event"* never put the act on that event,
  because `seedEventWithHost` seeds the host alone. Dropping the event from the join
  therefore changed nothing: the test would have passed over the exact defect it was
  written for.
- Nothing exercised a **removed** participation, so that clause was unguarded.

CLAUDE.md's *"a test that passes because the case never varies is not covering the line"*,
met twice in one function, in tests written the same hour as the rule. Both fixtures now
vary the case and both mutations die.

**And a third way the mutation harness lied.** Three runs came back GREEN reporting
`Tests 58 skipped (58)` — the suite never executed (Testcontainers losing a port bind
under the sweep's load), and "skipped" is not "failed", so the harness called every one a
survivor. Absence became a verdict for the second time today. It now errors when a run
skips everything, and the same three mutations are red on a re-run.

---

## QA7-18 — not built, and the analysis is done so the next pass need not repeat it

Deliberately left: it needs a cross-event authorization walk AND a browser proof of the
dashboard row, and the second is impossible while a sweep drives the app. Committing the
route alone would leave *a mechanism with no caller* — the shape this loop has now filed
seven times.

**The predicate, taken from `POST /deals/:did/confirm` rather than invented:** a line is
awaiting the reader's signature when it is one of *their* lines (`viewerParticipantIds`,
which includes the lines of performers an agent represents), `confirmed_at IS NULL`,
`role_in_deal <> 'observer'` (observers watch, they do not sign), the deal's
`agreement_status` is not `draft` (`assertAgreementSignable` refuses only that), and
`maySignOwnLines` holds — which matters, because **QA6-1 was precisely a party who could
not sign**, and a dashboard row that cannot be acted on would nag forever.

**The three pieces to reuse, all of which already exist:**

- `effectiveEventCapabilitiesForEvents` (`@showme/auth`) — batched capabilities across
  many events. `routes/activity.ts` is the worked example of a cross-event list built on
  it, and its docstring sets the bar: *"Two extra queries, whatever the number of events;
  no N+1."*
- `maySignOwnLines` (`routes/deals.ts`) — the capability half, event-level then
  deal-scoped, already handling the crew-signatory case.
- `resolveDealAuthority` / `resolveRepresentedParticipants` (`lib/deal-authority.ts`) — the
  delegation rule, including that a representation in its notice period is still live
  (`isRepresentationActiveAt`, A-19).

**The one real design decision, stated so it can be made rather than drifted into:**
`resolveDealAuthority` is per-event, so reusing it verbatim means a query pair per event —
fine for a dashboard's handful, and a step below `activity.ts`'s standard. The alternative
is a batched `resolveDealAuthorityForEvents`, which is the better shape and a wider change.
**Recommendation: add the batched version.** The delegation rule is subtle enough that a
second copy is the thing to avoid, and a batched entry point in the module that owns it is
the only way to have one copy and no N+1.
