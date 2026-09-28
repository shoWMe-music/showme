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

Suites at `fbfdc92`: **biome 732 clean · api 1379 · shared 302 · auth 31 · db 25 · web 405 ·
e2e 112**, and `tsc --noEmit` clean in every package. The API's full run habitually loses 2–6
files to a Testcontainers port-bind flake with **zero failed tests**; each was re-run alone and
passed. Clearing orphaned containers (`docker rm -f` the ones showing `5432/tcp` with no host
binding) makes it much less frequent.

---

## What is open, in the order it should be picked up

### 1. Decisions only Ran or Daniel can make — `decisions.md` §25.6, now seven rows

The seventh was added on the 28th and is the first with **no recommendation attached**: whether a
represented act may see the booking request its agent sent in the act's name (`QA5-11`). The
other six carry recommendations; the one most likely to matter is **whether a co-host may cancel
*or rename* the host's show** — recommendation: require the host profile, mirroring delete.

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

### 4. Recorded rather than built

`QA6-14` (a permission set is provisioned per event, so the event's set list is six rows called
`operator_full` — a data-model question, not a display fix) and `QA6-20` (three identical
participant fetches per settlement load — one shared hook, filed for
`docs/codebase-reuse-audit.md`).

### 5. The owed session

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

Running (`pnpm dev`) and re-seeded, with sweep run 7 driving it. The sweeps mutate the seed
(cancelled shows, extra holds, replaced schedules, computed settlements) — restart `pnpm dev`
before quoting anything from the database.
