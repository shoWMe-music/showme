# Urgent board loop — 2026-09-28, part 23

Part 22 closed run 9's four most serious findings. This part does two things: finishes run 9's
NOTEs, and then **builds Daniel's four rulings on `decisions.md` §25.6**, which arrived mid-tick and
outrank everything the loop had recommended. §25.7 is the record; this is the build log, including
the two wrong versions of the money rule that were caught rather than shipped.

Commits, in order: `7c23298` · `1052bb3` · `cf8793a` · `9418bad` · `e983331`.

---

## 1. QA9-17 — a payout account typed `iban` that accepts `not-an-iban`

**Which file settles it:** `apps/api/src/routes/payout.ts`.

**The verdict: fix it, and the sweep's own reason is the argument.** Filed as a NOTE because
`payout_accounts` still has no caller in either front end — which is exactly why it was worth
closing now: *"the first caller will be written against whatever this accepts."* QA8-10 made
`identifier` required, which was that finding; nothing then checked it against `type`, and
`currency` was a bare `z.string().optional()` that took `"XYZ"`.

**The scope.** `isCurrencyCode` already existed for this and was used in the web invoice dialog
(after run 6's QA6-17) and **nowhere in the API**. Per-`type` shape checks for the identifier,
deliberately loose — no IBAN mod-97, no Swedish Luhn — because refusing a legitimate account
somebody is waiting to be paid into is the worse failure of the two. `bankgiro` and `swish` are
Swedish instruments by definition (#17), so a Swedish shape is the right shape for them.

**The decision it hid:** none, but it exposed one defect nobody had filed.

### What a surviving mutation found — the half a schema cannot reach

Deleting the `type === undefined` guard in the Zod refinement changed no test. The reason is
structural: a `PATCH` body is a `.partial()`, so `{"identifier":"not-an-iban"}` arrives with **no
`type`**, and the type it must be judged against is the one already in the database. A refinement
only sees the request. So a correctly-created IBAN account could be edited into prose one field at a
time, and no schema anywhere could have stopped it.

The rule is now one function (`identifierProblem`) called from the create schema **and** the update
handler, where the stored row is readable. Four mutations red, including one that made the handler
ignore the stored type.

### And the authorization test next door, which could have passed on the wrong refusal

`"forbids a viewer from managing payout accounts"` sent `{type:"swish", identifier:"123"}` and
expected 403. Fastify validates **before** `preHandler`, so once a swish number had a shape, that
payload would answer **400** — and the assertion would still have been green while measuring a
refusal that had nothing to do with authorization. Fixed to send a body that would otherwise
succeed. *A negative test needs a request that is valid in every way except the one it is testing.*

---

## 2. Daniel's four rulings (§25.7)

Surfaced as four questions with each answer's cost laid out. Three went the way §25.6 recommended.
The fourth did not, and it is the most interesting.

### §25.7.3 — a represented act sees what is offered in its name · `cf8793a`

**Which file settles it:** `apps/api/src/routes/inbound.ts`, the outgoing scope. One `where` clause:
`sender_profile_id` **or** `on_behalf_of_profile_id`.

The test's second half is the load-bearing one. #14 moved the business **actions** to the agent, and
every mutation on a booking request is scoped to the TARGET profile — so the act reads its own pitch
and can do nothing with it: not accept, not decline, not counter. An unrelated performer still sees
nothing. The read receipt stays withheld from the act too, because the act is not the recipient
either.

**A comment that stated a rule, again.** The response schema said the payload *"only ever reaches
members of the request's TARGET profile (incoming) or of its SENDER profile (outgoing), never a third
party"* — and the third party it excluded turned out to be the act whose name the offer carries.
There are three, not two. Corrected rather than left to read as a rule it no longer describes.
**Instance twelve of this defect shape.**

### §25.7.2 — a deal may be deleted only while draft and unsettled · `cf8793a`

**Which file settles it:** `packages/shared/src/deal-terms.ts` (`dealDeletability`), because **both
sides ask it**: the route refuses, and the screen must not offer a control the route refuses. That is
the defect shape now recorded seven times.

Two things had to be built for the ruling to be reachable at all:

- **Delete and Cancel controls on the deal card.** Cancelling is what the refusal tells you to do
  instead, and it had no control anywhere in the app, on any status — so the advice pointed at
  nothing. One dialog for both, because the whole question a person has there is *which of these two
  am I doing*, and two similar dialogs is how somebody presses the irreversible one by mistake.
- **`hasSettlement` on the deals response.** Deliberately **not** `settlementStatus`, which is what
  the events LIST calls the **caller's own** settlement (`events-list.ts` scopes it by
  `profile_members.user_id`). Reusing that name here would let a co-host with no settlement of their
  own delete a deal out of a night the host had already settled, and read as correct the whole way.
  The web default is `true` — pessimistic — so a Delete control cannot flash into existence while the
  read is in flight.

Both refusals assert their **sentence** as well as their status. QA4-1 was exactly this: a refusal
advised cancelling, the cancellation broadcast to every party and could not be withdrawn, and the
second attempt was refused anyway.

### §25.7.1 — the act stops paying for a room it never rented · `9418bad`

**Which file settles it:** `packages/settlement/src/reconcile.ts`, the off-the-top pass. It read a
rental's amount and its payee and never `role_in_deal`.

The hand-check is now the test: the same night computed **twice**, with and without the rental, and
the **deltas** compared. An absolute assertion on each party's figure would pass on a dozen wrong
implementations that happen to hit one number.

**Two wrong versions on the way, both caught:**

1. *"The deal names a payer → that party pays it"* — the question's own wording, and it **silently
   reversed #24.1**. `settlement.test.ts`'s rental fixture names the **host**, who IS the pool, as
   the payer of a **venue** rental: #24.1's own case, where the act shares. Every rental authored
   through the app names a payer, so that rule would not have narrowed #24.1 — it would have made it
   unreachable. The only thing in the way was one assertion whose stated reason, *"the rental, taken
   first"*, happened to be a claim about the code.
2. *"Both ends are co-operators"* — too narrow, and a **surviving mutation** said so: deleting half
   the condition changed no test, because nothing covered an **act renting the room** from the
   operator. Under it the act's own room hire came off the pool and the operator was credited the
   rental on top of a residual already reduced by it.

The rule as shipped, stated from the pool's side because that is where it is decided: **the pool pays
a rental only when the pool is what owes it and the money leaves the pool side.** Four-wall nights
and rentals between two non-pool parties each have a test now.

**And the sentence on the card.** `describeBasis` said *"Rental of X, settled off the top"* for every
rental — which under this rule appears on the **payer's** card beside a **negative** figure, telling
a party that money it was paying had come off a net the rental never touched. `borneByPayer` rides on
the basis so every caller gets the right one of two sentences; it is stamped in `reconcile`, not in
the entitlement calculator, because only `reconcile` knows who shares the residual. Declared in the
response schema, because **Fastify strips what it does not name** — instance five.

One guard deleted as dead on a mutation's evidence: an unrecognised payer cannot be the pool, so it
always reaches the transfer branch and `settleDeal`'s own check. *Two guards for one case is one
guard nothing can fail on.*

### §25.7.4 — the ruling was already the behaviour · `e983331`

*"The creator should be able to cancel, but they should also be able to give full admin to the co
host."* — an answer none of the four options offered, and the better one: §25.6 framed the question
as *where the line sits* and offered two answers that moved the same fixed line. The ruling changes
what **kind** of thing the line is — not a property of the role, but a permission the host grants.

**Checked rather than assumed, and no code changed.** `OPERATOR_FLOOR` carries neither `event.edit`
nor `event.delete`, so a co-host invited with *Standard for the role* holds no permission set and can
rename nothing. A co-host the host gave **Full control** holds `operator_full` and can. Default
host-only, grantable by the host: that is §25.7.4, built, all along.

**What was missing is that nothing said so** — which is why two sweeps read it as a hole. The
sentence "a co-host can cancel the host's show" describes a defect and a granted permission equally
well, and which one it is depends on a permission set no sweep can see from a screen.

**The trap, recorded because the next person will meet it.** The obvious fix — require the host
profile for `status` and `title` — **breaks the grant the ruling exists to protect**, and every
existing test would have stayed green while it did. My own first plan was a new `event.administer`
capability plus a preset to carry it; both unnecessary. Delete stays out of the grant, and
`event-delete.ts` now says why instead of describing a co-host's `event.delete` as something to
refuse.

---

## 2b. Run 9's other findings, worked after the rulings

### QA9-3 — MAJOR — the bell said "accept or decline" and landed on a 404 · `8f109ba`

**The verdict changed on reading the code, which is the whole reason ticket-to-commit exists.** The
sweep filed it as *a screen routes to an action that does not exist*, and the loop's plan was to SIZE
it. The action exists: `GET /me/event-invitations` is served and `EventInvitationsCard` renders it
with Accept and Decline on `/requests` and `/events`. So it is a link fix, not a missing feature.

`invitation.received` → `/invitations/:token`; the three emitters of `event.participant_added` →
`participantAddedLink`, which routes a not-yet-standing participant to `/requests` and everyone else
to the event. A surviving mutation earned the last test: making the link *always* `/requests` broke
nothing, because nothing covered a participant who CAN open the event — a `co_host` added through
that route lands `accepted`, not `invited`.

Each test asserts the 404 the link used to point at, so it carries its own reason.

**Not fixed, and recorded rather than guessed:** a represented act's invitation is answered by their
AGENT (#14), so for that act `/requests` is empty too. The link stops 404-ing; whether the act should
be told at all, and in what words, is a product question.

### QA9-12 — MINOR — a bill that names no money · `7cf4927` (API half)

Two defects in one row. **In:** `POST /invoices` took three keys that read like its own vocabulary
and are not (`counterpartyName`, `amount`, `category`), stripped all three, and answered **201** — the
QA8-10 shape exactly. Both bodies are `.strict()` now; the dialog in `Invoices.tsx` was checked first
and sends only schema keys. **Out:** a bill advanced to `sent` with `total` NULL and the ledger
printed it as a live liability, *"— · — · — · 15 Jan 2026 · SEK 0 · Overdue"*. The guard reads the
total the PATCH will LEAVE behind, because `{"state":"sent"}` alone is the request that did it;
`void` is still allowed without one.

*The first version added `CreateInvoiceBodyStrict` beside the lax schema and left the route using the
lax one — a second definition nothing calls, instance eight. It is one schema now.*

**Still open (web):** the ledger should print `—` rather than `SEK 0` for a null total. A row with no
amount can no longer be *sent*, but a draft legitimately has none, and `SEK 0` is a figure nobody
wrote.

### QA9-16 — MINOR — a DELETE with no body · `6eb72f8`

`expectedVersion` is optional and a request that omits the body arrives as `null`, not `{}`. Three
routes declared that body and **two got it wrong**. Fixed by moving the definition to
`lib/optimistic-lock-body.ts` and pointing all three at it — a one-line schema copied three times is
*how* they were wrong together. `budget.ts` was also destructuring it without `?.`.

## 2c. SIZED, not built — QA9-4

**QA9-4 — MAJOR — "Confirm Nordic Synth Showcase … needs a decision", and nothing in the app can.**
The dashboard's most prominent card names the verb *Confirm* and its button is *Review*; the
destination offers no Confirm anywhere, and the only control that clears the card is **Release hold**
— the opposite decision. `PATCH /events/:id {"status":"confirmed"}` works at the API and has zero
callers in `apps/web/src`.

**Why this is a sizing and not a fix, precisely: the decision is already open and already written
down.** `decisions.md`'s still-open list, two rows from the bottom:

> **Two ways to reach `confirmed` (see #20)** — `PATCH /events/:id` sets the status with no pool
> cascade and no notification, where `/hold/confirm` runs the whole queue. Depends on the call above
> [*does a hold rank confer first refusal?*].

Wiring an operator-side Confirm button means choosing, in code, which of the two paths the app takes
— and the cheap one skips the hold queue's cascade and tells nobody. That is a product call with
money and other people's dates behind it, not a missing button.

**What it would cost once decided.** If `confirmed` should run the queue: the operator needs an
authorized path into `/hold/confirm`'s machinery, which today refuses them for a stated and correct
reason (*"Only the booked performer, or their agent, can confirm or decline this hold"*) — a new
route or a widened one, plus the cascade's notifications. If the operator's `PATCH` is enough: one
control on the workspace and one on the dashboard card, half a day, and the hold queue stays a
mechanism the operator can silently bypass.

**One thing worth doing either way, and cheap:** the card should not promise a decision the
destination cannot take. *"needs a decision"* on a card whose only outcome is *Release hold* is the
nag QA9-4 is really about.

## 3. What is still open

- **§25.7.1's one remaining question**, recorded in `decisions.md` and small: whether the broader
  reading is also wanted, which would stop the act sharing a promoter-signed **venue** rental too.
  One line plus one fixture. Not done, because it reverses part of #24.1 and #24.1 is Daniel's.
- **§25.6's other five rows** — calls the loop made in code, still unconfirmed. They are running and
  each names the line to change.
- Run 9's remaining findings, all web-side and all waiting on the browser being free: QA9-5, QA9-7,
  QA9-10, QA9-11, QA9-12's render half, QA9-13. QA9-9 is the audience read endpoint and belongs on
  the feature list, not here. QA9-3, QA9-12's API half, QA9-16 and QA9-17 are done (§2b); QA9-4 is
  sized (§2c).
- **QA9-11 has a plan:** `hasBudget` is `budgets.filter(scope === "shared").length > 0`, and
  `GET /events/:id/budgets` PROVISIONS a shared budget on read — so the act of measuring coverage
  creates it, and `partialCoverageNote` is dead for any host who has opened the screen. "Budgeted"
  must mean *has a shared budget with at least one line*, not *has a row*. Not the provisioning,
  which is deliberate and documented.
- Blocked: `86cbcn1q4`, `86cbcn1rr`, `86c9mq7q9` until `/design-login` works.

## 4. Two things about the tools, for the next tick

- **The flake-counting grep in the loop's own instructions does not match the message.** The
  instruction says to count `"Timed out waiting for container ports"`; Testcontainers actually
  prints `Timed out after 10000ms while waiting for container ports to be bound to the host`. The
  count came back **0** on a run with **four** flaked files. Same class as the ANSI-colour grep that
  produced four false GREENs: *a grep that does not match reports the absence of the thing it cannot
  see.* Four files, zero failed tests, 215 skipped; re-run alone, 215 passed.
- **The test count reconciled exactly**, which is the only reason "1415 passed" means anything: 1405
  baseline plus the 10 tests this part added. A count without its baseline is not evidence.

## 5. Proven on the running stack

The API was restarted first — it does not hot-reload, and three of these are API changes.

- **QA9-18** in situ, which is better evidence than the earlier check (executing the parser
  directly): the boot banner now prints *"Seeded accounts (Firebase emulator), **6** of them"* and
  lists `operator co.host@e2e.showme.test → Northlight Presents`.
- **QA9-17**: the sweep's exact body answers **400** naming *both* problems at once
  (`body/currency Unknown currency code, body/identifier That does not look like an IBAN…`); each
  half 400s on its own; `SE45 5000 0000 0583 9825 7466` in SEK is **201**, spaces and all.
  *(The message first read "That does not look like a iban number" — the enum value dropped into a
  sentence. Each method now carries its own noun phrase, with a test on the sentence, because this
  is the one field whose job is to say where somebody's money goes.)*
- **§25.7.3** as Marlo Vance: the Outgoing list shows **two** rows where it showed one — their own
  20 Nov offer, and **"via Astra Booking · 10 Dec 2026 · SEK 25,000 – SEK 32,000"**, the pitch and
  the fee range they were blind to. Incoming is empty on the same screen, which is the control.
- **§25.7.2**, both cases read on the same screen as `operator@`:
  - Album Release (confirmed deal, settled night) → no Delete, and the sentence *"This night has a
    settlement on it, so "Album Release — Door Split" is part of what has already been computed and
    read. Cancel it instead…"* beside a **Cancel agreement** button.
  - Open Mic Wednesdays (draft, unsettled) → **Delete draft** and **Cancel agreement**, no sentence.
    Pressed it: the dialog explains what is destroyed and why it is offered, the toast reads *"The
    draft agreement is gone. Nothing was settled against it."*, the tab falls back to "No deal yet",
    `deals` is empty and `audit_log` carries `deal.delete`. The row created for the test was removed
    afterwards.

*An absent control is the weakest evidence there is, which is why every one of these was read
against its positive case on the same screen, logged in as an account the snapshot names.*

## 5b. Full pass

biome **739** · shared **326** · settlement **72** · auth 35 · web **481** · api **1415**
(1200 + the 215 re-run after the flake) · e2e **112** · `tsc` clean in four packages.
**28 mutations run across the four rulings and QA9-17; every one killed**, two of them only after
the survivors above sent the rule back for rewriting.
