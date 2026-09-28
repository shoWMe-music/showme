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
- **Sweep run 7's six majors and its first seven minors** — QA7-1 through QA7-5 (parts 11-13),
  QA7-6 recorded as a product call rather than built, then QA7-9, QA7-10, QA7-13, QA7-14, QA7-19,
  QA7-8, QA7-12, QA7-16, QA7-15 (parts 14-15). Plus **QA7-28**, which is not in the sweep: the
  Settlement tab labelled the reader's ENTITLEMENT "Your payout", and proving QA7-10 put the
  contradiction one line apart on the same card. An operator owing SEK 45,000 read "SEK 0 · Your
  payout"; it reads **"SEK 45,000 · You owe"** now.

Suites at `060cce3`: **biome 737 clean · api 1380 · web 462 · e2e 112**, `tsc --noEmit` clean, run
in one pass with the dev stack down. (Earlier reading, at `fbfdc92`: biome 732 · api 1379 ·
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

### 4. Run 7's remaining minors, in order of size

`QA7-17` (an `operatorCostSplit` keyed by `profiles.id` is accepted, stored, echoed back and then
silently ignored, because the settlement keys it by `event_participants.id` — the UI is correct and
this is about what the API accepts from anything else), `QA7-18` (a deal awaiting your signature is
not on the dashboard that exists to route you to it), `QA7-7` (an agent added to an event none of
their acts is on gets a permanent `invited` row, a notification promising access, and a 404 behind
the link — the boundary holds, the refusal is at the wrong end), `QA7-11` (the audience read
endpoint, which is the same gap as `QA6-19` above). Then NOTEs `QA7-20`–`QA7-23` and COSMETICs
`QA7-24`–`QA7-27`.

### 5. Recorded rather than built

`QA6-14` (a permission set is provisioned per event, so the event's set list is six rows called
`operator_full` — a data-model question, not a display fix) and `QA6-20` (three identical
participant fetches per settlement load — one shared hook, filed for
`docs/codebase-reuse-audit.md`).

### 6. The owed session

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

**Down** — `pnpm test:e2e` tears the manual stack down and was the last thing run. Sweep run 8 is
booting its own. The sweeps mutate the seed (cancelled shows, extra holds, replaced schedules,
computed settlements), and so do proofs: re-run `pnpm --filter @showme/db seed:e2e` rather than
hand-reversing a fixture. Hand-reversing guesses at the original — re-seeding revealed that the
pristine deal `…d1` carries a NULL `confirmed_snapshot` and an **unsigned** first party, which a
hand-patch had not restored.
