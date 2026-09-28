# Handoff — the urgent board, worked through (2026-09-27 → 28)

**Supersedes `docs/handoff-2026-09-27-urgent-board.md`**, which was a snapshot taken at
midnight and is now behind by five clusters of work. Keep that file for the day's narrative;
believe this one about the present — and read `CLAUDE.md`'s own warning first: **a handoff is a
snapshot of a moment, not a statement about the present.** Everything below was true at commit
`fbfdc92`. Check the code before you scope from prose.

**Nothing was deployed. Nothing was written to ClickUp** — the board is untouched and every
finding lives in this repo.

---

## What this was

One standing instruction: work `docs/clickup-urgent-audit-2026-09-27.md` and `decisions.md` #25
until the urgent board's work is done, in a fixed order, following `ticket-to-commit` for every
item — plan in a doc **before** building, prove it on the running stack, run the suites, commit
naming the ticket, and spin the QA agent after each cluster.

**86 commits** since the sweep agent landed. The reasoning is one entry per item in
`docs/urgent-board-loop-2026-09-27.md` and its `-part2` … `-part8` continuations, then
`docs/urgent-board-loop-2026-09-28-part9.md` and `-part10.md` after midnight. Four QA sweeps:
`qa-sweep-2026-09-27-run4.md`, `-run5.md`, `-run6.md`, and run 7 in flight when this was written.

## The through-line, and it has not changed since 2026-09-04

**The board's count is not the work's size, and the commonest shape is a built mechanism with a
missing caller.** Today produced it seven more times, and added two siblings of it:

| shape | how often | examples |
|---|---|---|
| a mechanism with no caller | 7× | `?tab=` deep links, `rider.submit`, eight template categories, `autoAssignAgentOnPerformerJoin`, `actorDisplay`, `?tab=` again, the audience RSVP row |
| **a field the API returns and Fastify strips**, because the response schema never declared it | 4× | `capabilities` on the events list was the fourth |
| **a comment or a docstring that states a rule the code does not keep** | 5× | the break-even wording, the invoice currency ("not EUR", fixed for the tiles and not the form), the realtime invalidation list, `ProfileLinkListField`'s "the value stored is the label", the entitlement-gap sentence |

---

## What is closed

- **§2 and §5 of the audit** — every unblocked small fix.
- **§7's unread tickets** — all eight have verdicts in `-part4`; one (`86cbcn1f8`) was mostly built.
- **Items 1–3 of the plan** — the venue+room request chain and the token share link
  (`123qy9rpqp0` + `123qy9rpqn0`); the outbound invite chain's missing rungs; the bonus ladder in
  `packages/settlement` with its entry UI (`123qy9rnwud` / `123qy9rp8k3`).
- **Every actionable finding from QA sweeps 4, 5 and 6** — four majors and eleven
  minors/cosmetics from run 6 alone, including three defects in this loop's own work.
- **Sweep run 9's leak and its mute-users major**, plus the two residuals of this loop's own
  fixes. QA9-1 was the serious one and not an arithmetic error: `GET /insights/profiles/:id/revenue`
  had no `budgets.scope` predicate, so a host's all-time figure counted every private book on their
  events — **SEK 12,345 of it the co-host's** — three lines under a screen saying *"Every figure here
  comes from the event's shared ledger"*. QA9-2: `message.post` was in three presets and **no floor**,
  so a represented act, every crew member and everyone the app's own Invite dialog onboards were
  silently mute. QA9-8 and QA9-14 are places where QA8-4 and QA8-12 stopped one line short.
- **Sweep run 8, everything but its two majors** — QA8-6 through QA8-14, plus run 7's QA7-24.
  Four of those were sentences that were false about whoever was reading them (an agent told a
  commission was "private to you and your agent"; a crew account offered a dialog for offering to
  play; a reader instructed to edit a tab that refuses them; a co-host told to ask the host for
  something the host has no control for), two were promises the product does not keep (an RSVP's
  "keep an eye on your inbox", a Billing panel's "add a bank account"), one was a bell that never
  rang (`messages.ts` was the only interactive event route that never wrote a notification), and
  one was a private book printing the shared book's door.
- **Sweep run 8's three number defects** — QA8-3 (the break-even scan and the headline fee
  divided different bases, so a card read BREAK-EVEN 130 beside a loss; it now says *no
  break-even*, which on a 100% split is the truth), QA8-4 (an agent's headline read SEK 0
  against three screens saying SEK 3,000 — their money is a commission, not a net), and QA8-5
  (the card's rows did not sum to its own headline; cash moved below the divider and the
  operator's card now agrees with the Payout tab exactly).
- **Sweep run 7's six majors and its first seven minors** — QA7-1 through QA7-5 (parts 11-13),
  QA7-6 recorded as a product call rather than built, then QA7-9, QA7-10, QA7-13, QA7-14, QA7-19,
  QA7-8, QA7-12, QA7-16, QA7-15 (parts 14-15). Plus **QA7-28**, which is not in the sweep: the
  Settlement tab labelled the reader's ENTITLEMENT "Your payout", and proving QA7-10 put the
  contradiction one line apart on the same card. An operator owing SEK 45,000 read "SEK 0 · Your
  payout"; it reads **"SEK 45,000 · You owe"** now. Plus QA7-7, QA7-17, QA7-23, QA7-25,
  QA7-26 and QA7-27 — which leaves **QA7-18 and QA7-24** as the only actionable items left
  from run 7.

Suites at `192aeb7`, run in one pass: **biome 737 clean · shared 317 · auth 35 · web 474 ·
api 1405 · e2e 112**, `tsc --noEmit` clean in web, api, shared and auth. Adding `message.post` to
four floors broke **no** capability assertion anywhere, which is the reassuring half of QA9-2: the
floors were not load-bearing for anything that tested them. The API's full run lost the same four files to the
Testcontainers port-bind flake with **zero failed tests** (four `Timed out after 10000ms
while waiting for container ports` in the log); each passed when re-run alone.

One coverage observation from that pass, worth keeping rather than acting on: this stretch
rewrote the settlement card's rows — *"Plus the money you collected"* became *"Less the money
you collected"*, and two rows moved below a divider — and **no e2e spec noticed**. The suite
does not read the party card's breakdown. That is not a failure; it is where the next real
defect on that card will hide. (Earlier reading, at `fbfdc92`: biome 732 · api 1379 ·
shared 302 · auth 31 · db 25 · web 405 · e2e 112.) The API's full run habitually loses 2–6
files to a Testcontainers port-bind flake with **zero failed tests**; each was re-run alone and
passed. Clearing orphaned containers (`docker rm -f` the ones showing `5432/tcp` with no host
binding) makes it much less frequent.

---

## What is open, in the order it should be picked up

### 1. Decisions only Ran or Daniel can make — `decisions.md` §25.6, now eight rows

Seven carry recommendations; **`QA5-11` has none** — whether a represented act may see the booking
request its agent sent in the act's name. Of the rest, two matter most:

- **Whether a co-host may cancel *or rename* the host's show** — recommendation: require the host
  profile, mirroring delete.
- **`QA7-6`, added on the 28th and the only one that moves money.** An off-the-top rental is borne
  by the POOL, so the act pays 70% of it and the party `deal_parties` names as payer pays 15% —
  which is #24.1 working exactly as written, since an off-the-top cost *is* the adjustment. It only
  reads wrong when the named payer is **itself a party on the event**: the engine then charges one
  party through the pool that same party draws from. Recommendation: when the payer is a party,
  settle the rental as a **transfer** between payer and payee and leave the pool alone; keep the
  off-the-top behaviour when no party is the payer. **The engine is untouched pending the call.**

### 2. Blocked on `/design-login`

`86cbcn1q4`, `86cbcn1rr`, `86c9mq7q9`. `claude_design` has failed all session with
`FIRST_PARTY_AUTH_REJECTED`, and `CLAUDE.md` forbids building these from a written description —
it has gone wrong twice. **Do not start them until the prototype renders.**

### 3. Features sitting inside tickets full of one-liners

Each deserves its own ticket; none is a small fix: **Duplicate an event** and **Make recurring**
(`123qy9rng56`), an **Assets library** (`123qy9rnfbe`), the **Repertoire table** behind Setlists
(`123qy9rng8p`), **merge-on-duplicate** across the CRMs (`123qy9rngc8`), **Team-admin as a paid
seat** (`123qy9rnge6`), the **agreement PDF** (`86cbcn1f8`), **Print details** and
**Invite-from-a-menu**, and two the sweeps surfaced:

- **The audience read endpoint** (`QA6-19`). `audience_rsvps` is written by one route and read by
  nothing but tests. Put the public page's own promise on the ticket with it: *"Your name, email
  and city go to the organiser of this event so they can count on you and tell you about it"* — a
  sentence made to a third party that is not yet true.
- **Revenue per venue** (`QA5-14`). `/insights/profiles/:id/revenue` returns one total; the
  dashboard panel now says *"Not built yet"* instead of blaming the reader's data.
- **An entitlement surface for the client** (`QA7-15`). The web app cannot see how many seats an
  account has, so the invite picker cannot grey out the roles the plan refuses — every
  seat-consuming option now says *"This role uses one of the account's seats"* instead, and the
  refusal after the submit is at least true. A client-side guess at a paywall is how a UI starts
  disagreeing with the thing it is guessing about, so this waits for the API to say.

### 4. Three tickets, sized in `docs/urgent-board-loop-2026-09-28-part19.md`

All three are the same shape — **a working back end with no front end**, which is run 7's QA7-5 at
feature scale — so none is a fix and none should be half-built:

- **QA8-1, a deal's money is write-once.** `PATCH /deals/:id` accepts `advanceAmount` on a `sent`
  deal and the planner re-seeds, which is exactly Ran's 2026-09-21 spec; what is missing is every
  control, and `DELETE /deals/:did` has no caller at all. Two sentences promise otherwise, one of
  them written by this loop for QA7-9. **Ticket the edit path; leave delete behind a decision** —
  whether a deal with a computed settlement may be removed or only cancelled.
- **QA8-2, the representation lifecycle has no screen.** Four routes alive and driven directly,
  `apps/jobs` already sweeping due terminations, and one caller in either front end. One piece is
  not built at all: a proposal writes no notification. **Notification first**, then answer, propose,
  delegate, terminate — the reverse of the order the routes were written in, because it is the
  order in which each becomes usable.
- **QA7-18, a deal awaiting your signature is not on the dashboard.** Analysis finished in part 16;
  the one decision is to add a batched `resolveDealAuthorityForEvents` rather than a second copy of
  the delegation rule.

### 5. Run 7's remaining minors, in order of size

`QA7-17` (an `operatorCostSplit` keyed by `profiles.id` is accepted, stored, echoed back and then
silently ignored, because the settlement keys it by `event_participants.id` — the UI is correct and
this is about what the API accepts from anything else), `QA7-18` (a deal awaiting your signature is
not on the dashboard that exists to route you to it), `QA7-7` (an agent added to an event none of
their acts is on gets a permanent `invited` row, a notification promising access, and a 404 behind
the link — the boundary holds, the refusal is at the wrong end), `QA7-11` (the audience read
endpoint, which is the same gap as `QA6-19` above). Then NOTEs `QA7-20`–`QA7-23` and COSMETICs
`QA7-24`–`QA7-27`.

### 6. Recorded rather than built

`QA6-14` (a permission set is provisioned per event, so the event's set list is six rows called
`operator_full` — a data-model question, not a display fix) and `QA6-20` (three identical
participant fetches per settlement load — one shared hook, filed for
`docs/codebase-reuse-audit.md`).

### 7. The owed session

`123qy9rng6d` — the settlement vocabulary session with Ran. Still unheld, still the right call:
the naming has been changed three times from written notes and each was wrong.

---

## What cost time, so it does not cost it again

The four in `CLAUDE.md` still hold. These are the ones this stretch added.

### Two ways a MUTATION check lied

Mutation testing is this loop's standard for "the test can fail on this line", and it
mis-answered twice.

- **A first-match replace can mutate the wrong occurrence.** Two attempts to delete a filter from
  `closeChangeRequestsOnCancel` reported green; the same string occurs twenty lines earlier in
  `proposeEventChange`, and that is where the edit landed. **Anchor on surrounding lines and
  assert the match count is 1.**
- **A mutation survives when every test satisfies the clause another way.** Twelve survivors
  across the stretch, each a filter that looked covered: one had the payee invisible for a second
  reason; four queue-key clauses were satisfied by every fixture using one venue, one room and one
  date. The best catch: `status = "on_hold"` in the hold-queue key needed a **cancelled** hold
  that kept its rank, because the confirm cascade writes `cancelled` and leaves `hold_rank`.

### A mutation harness that cannot find its own result reports a survivor

Two more ways the mutation check lied, both on the 28th, and they are opposites.

- **Silence read as green.** The runner grepped vitest's summary with a pattern that never matched
  the ANSI-coloured output, so `$out` was empty, an empty string does not match `*failed*`, and all
  four mutations were reported **GREEN — SURVIVED**. This is CLAUDE.md's `tail -3` lesson one layer
  down: the pipe decided the answer, not the test. **Fail loudly when no summary line is found** —
  never let absence fall through to a verdict.
- **A here-string appends a newline.** `<<<"$anchor"` gave Python the anchor plus `\n`, so any
  anchor that is not a whole line could never match. That one announced itself (`SKIP — anchor
  matches 0 times`), which is the behaviour to want.

### Copy that states a rule the code does not keep — SIX instances in one sweep

The run's most productive shape by a wide margin: break-even wording, invoice currency, the
realtime list, `ProfileLinkListField`'s *"the value stored is the label"*, the entitlement-gap
sentence, and the team invite dialog telling a reader that **Editor is included on every plan** in
the very message explaining why Editor had just been refused. A comment or a hint that asserts a
behaviour is a claim, and worth testing like one. Where the claim is duplicated — two role
catalogues, one right and one wrong — **derive the sentence from the rule** so they cannot drift
again.

### A FIX CAN CARRY ITS OWN NEXT DEFECT, and the docstring will describe it

QA7-1 moved the break-even scan onto #24.1's adjusted net, correctly. Rebuilding that net per
attendance it also subtracted the per-ticket processing rate — which the headline fee does not,
because processing is a RATE and never a budget line, so the engine never deducts it before a
split. On a 100% split the scan's costs then became identically equal to its own revenue and it
reported a crossing at the first attendance where the share arm governed: **BREAK-EVEN 130
beside PROFIT / LOSS −SEK 1,245**. Not a shifted answer, a fabricated one.

Two things made it survive a whole run, and both were written in the same commit as the defect:

- **the docstring described it precisely** — *"revenue less every cost that is NOT the derived
  fee itself — `trulyFixedCosts` … and the per-ticket variable cost"* — and read as
  justification rather than as a bug report;
- **a test pinned it**, asserting 51 and naming 52 (the right answer) among the WRONG ones. Its
  derivation was internally consistent; its premise was not.

The docstring also claimed the base *"cannot move the number"* on the share arm. It moves it by
a ticket, because the base changes the per-head coefficient — so an assertion that recorded the
difference had been read as evidence about a different wrong base. **When a fix comes with an
explanation of why it is safe, the explanation is a claim about the code too.**

### A comment asserting a rule the code does not keep — NINE instances, and one of them mine

The count is the point. Break-even wording, invoice currency, the realtime list,
`ProfileLinkListField`, the entitlement-gap sentence, the team invite dialog, QA7-1's own docstring
describing the term it had just got wrong, the `collected` row's belief about `entitlement` — and
then QA9-14, where a comment this loop wrote claimed *"the two agree about what a negative figure
looks like on this screen"* while one call site rendered `−SEK 12,000` and four rendered
`− SEK 33,000`.

**A comment that states a rule is a test that never runs.** Where the rule is worth stating, give it
one implementation and point every caller at it — `negativeAmount`, `seatRefusalHint`,
`countsAsMoneyOwed` — so the sentence and the behaviour cannot part company. Where it is only
explanation, remember that a future reader will trust it more than the code beside it.

### A sentence has to be true of whoever is reading it — FIVE instances now

Run 6 found the first (`"Plus the money you collected"` on a performer's screen under the
operator's name, once #24.2 put another party's card in front of a reader). This stretch added four
more: an agent told a commission was *"private to you and your agent"*; *"Edit them there"* pointing
at a tab that refuses the reader; *"Ask the host to add you to it"* naming a control the host does
not have; *"Keep an eye on your inbox"* over a route that sends nothing. The pattern is one rule
with two halves — **person-awareness** (does this sentence's "you" mean the reader?) and
**capability-awareness** (can the reader do the thing it names?) — and the fix is the same both
times: build the sentence where the names and the capabilities already are, not in the component.

### A test can pin a false belief, and then the defect is invisible

`authorize.test.ts` asserted a co-host gets no deal-scoped confirm *"because operators already
carry `agreement.confirm` from floor/preset"*. They never have. That sentence is what made
`QA6-1` — an unsignable rental freezing a whole night's settlement — invisible for as long as it
existed. And `settlement-overview.spec.ts` asserted `/your \d+% of the deal's/` and **passed**, on
the operator's Overview in front of the performer's card, which is `QA6-9` exactly.

### A fixture pinned to an absolute date inside a window measured from `now` is a scheduled failure

`integrations.test.ts`'s aged-out-cursor test went red at midnight with no code change. The sync
window is `now − 30 days … now + 400 days` and the fixture's third event is dated **2026-08-28** —
exactly 30 days behind the 27th, 31 behind the 28th. It had been one day from failing for weeks.

### The rest, briefly

- **`pnpm test:e2e` tears the manual dev stack down.** Every browser check happens before it, or
  the stack is rebooted after. Cost: four `auth/network-request-failed` dead ends.
- **The API does not hot-reload**, and a restart re-seeds — so a stale API and a fresh seed look
  identical.
- **A seeded permission set is a database row, not a constant.** The copies are now one module
  (`@showme/db/seed-capabilities`) with a test asserting each equals its preset.
- **`vitest` does not typecheck.** Run `tsc --noEmit` per package.
- **A pipe hides a failing check** (`biome check . | tail -2`).
- **A refusal is an instruction, and it gets followed.** The delete refusal's clause order made
  "cancel it first" wrong, and the QA agent cancelled a settled, paid show.
- **`notifications.event_id` cascades from `events`** — a delete notice must carry no event id.
- **A hook below an early return kills the page**, and neither the typecheck nor 405 unit tests
  see it.
- **`?? ` reads a legitimate `null` as "nothing came back".** `reread?.holdRank ?? after.holdRank`
  kept the stale rank it was written to clear — the same bug one line further on.

## The local stack, as left

**Down** — `pnpm test:e2e` was the last thing run and it tears the manual stack down. The seed was
restored before that pass, so the probe rows this stretch created (a co-host private budget and its
SEK 12,345 line, an advance on deal `…d1`, two messages) are gone. The seed was
restored (`seed:e2e`) before that pass, so the probe rows this stretch created — an RSVP, two
offers, a numberless bill, an advance on deal `…d1` — are all gone.

`pnpm dev` does NOT start the marketing site; the public event page needs
`pnpm --filter @showme/marketing dev` and it binds to **`localhost:5173` over IPv6 only**, so a
`curl 127.0.0.1:5173` health check never answers and looks like a failed boot. The sweeps mutate the seed (cancelled shows, extra holds, replaced schedules,
computed settlements), and so do proofs: re-run `pnpm --filter @showme/db seed:e2e` rather than
hand-reversing a fixture. Hand-reversing guesses at the original — re-seeding revealed that the
pristine deal `…d1` carries a NULL `confirmed_snapshot` and an **unsigned** first party, which a
hand-patch had not restored.
