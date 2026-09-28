# Handoff — the urgent board, worked through (2026-09-27)

> **SUPERSEDED by `docs/handoff-2026-09-28-urgent-board.md`.** That file is the state at the end
> of the stretch; this one is the snapshot taken at midnight and is behind by five clusters of
> work. Kept for the day's narrative — the sweep findings, the decisions and the lessons it
> records are all still accurate about what happened. Do not scope from its "what is open" list.

**A snapshot of this evening, not a statement about any later day.** This repo has lost a
full session to trusting a stale handoff (`CLAUDE.md` names the incident), so: everything
below was true at the last commit listed, and anything you are about to scope from it should
be checked against the code first.

**Nothing was deployed. Nothing was written to ClickUp** — the board is untouched and every
finding lives in this repo.

---

## What the day was

One standing instruction: work `docs/clickup-urgent-audit-2026-09-27.md` and
`decisions.md` #25 until the urgent board's work is done, in a fixed order, following
`ticket-to-commit` for every item — plan in a doc **before** building, prove it on the
running stack, run the suites, commit naming the ticket, and spin the QA agent after each
cluster.

**60 commits.** The day's reasoning is in `docs/urgent-board-loop-2026-09-27.md` and its
`-part2` … `-part8` continuations, one entry per ticket: the verdict, the file that settled
it, the decision it hid, and how it was proven. Two QA sweeps:
`docs/qa-sweep-2026-09-27-run4.md` and `-run5.md`, with a third running when this was
written. **The last three commits are past midnight, so they are 2026-09-28 work** — the
docs keep the 27th's numbering because it is one continuous session.

## The through-line, and it is the same as 2026-09-04

**The board's count is not the work's size, and the commonest shape is a built mechanism
with a missing caller.** Today produced it four more times:

| | The mechanism existed | Nobody called it |
|---|---|---|
| `86cbcgq5f` | `?tab=` deep links into the event workspace | all 18 notification links sent a bare `/events/<id>` |
| `123qy9rnk1u` | `rider.submit` + a role-agnostic attach route | the capability was in no operator preset, so the venue got a 403 |
| `123qy9rpvfq` | eight template categories, a validator, an entitlement gate | the app had only ever written `budget` |
| `QA4-7` | `autoAssignAgentOnPerformerJoin` | the invitation path — one of the two a person uses — called nothing |

The second shape, four times: **a field the API returned and Fastify stripped**, because the
response schema never declared it (`capabilities` on the events list was the fourth).

---

## What is closed

- **§2 and §5 of the audit** — every unblocked small fix, built and proven.
- **§7's unread tickets** — the ClickUp cap reset; all eight have verdicts in `-part4`.
  One (`86cbcn1f8`) turned out to be **mostly already built**.
- **Items 1–3 of the plan** — the venue+room request chain and the token share link
  (`123qy9rpqp0` + `123qy9rpqn0`); the outbound invite chain's missing rungs; the bonus
  ladder in `packages/settlement` with its entry UI (`123qy9rnwud` / `123qy9rp8k3`).
- **Every actionable major from QA sweep run 4** — including two defects in work this loop
  had shipped hours earlier.
- **Every actionable major from QA sweep run 5**, in three commits (`-part7`, `-part8`):
  a cancelled show no longer asks anyone to accept it and closes the change requests still
  open on it (**QA5-2**); the bell says who made the change (**QA5-5**); an operator's
  "Total payable" stops dropping a co-host paid only by transfer, and the entitlement-gap
  sentence stops blaming a cause that is not the cause (**QA5-1**); a hold that gets its
  venue attached after placement joins the queue at the back instead of tying, unbreakably,
  for first (**QA5-4**). **QA5-3** is a decision, recorded in §25.6 rather than built.
  One of run 5's four majors — QA5-4's "no venue picker" — **did not reproduce**; the
  correction is in `-part8`.

Suites at the last commit: **biome 729 clean · api 1366 · shared 293 · auth 30 · db 25 ·
web 376 · e2e 112**, and `tsc --noEmit` clean in all seven packages. The API's full run habitually loses 1–4 files to a Testcontainers port-bind
flake with zero failed tests; each was re-run alone and passed.

---

## What is open, and why — in the order it should be picked up

### 1. Decisions only Ran or Daniel can make

| | The question |
|---|---|
| **QA4-2 / QA5-3** | A co-host can rename **and cancel** the host's show. `event-delete.ts` says *"the show is not theirs to end"*, and the date move is already protected by a change request — but blocking a co-promoter from calling off a night they co-produce has a real cost, and the proper fix is a cancel *request*, which is a feature. **Recommendation: require the host profile, mirroring delete.** |
| **Auto logout** | The timeout is stored **per device** (`localStorage`) and the settings row says so. Account-wide would be a migration and a policy `decisions.md` does not rule on. Moving it server-side later changes one storage line. |
| **House documents** | An operator-attached rider is now visible to every party — a widening of decisions #12, justified by the share dialog's own promise and by Ran naming *"Rules of Behavior"*. Worth a line in `decisions.md` so it stops being an inference. |
| **"From your calendar"** | The one side-panel card `86cbcn189` asks to remove that was kept: it is not a read-out, it carries the only two controls an imported entry has. Deleting it deletes two features. |
| **Print details / Invite from a menu** | Asked for in two tickets, built in neither: there is no print sheet for an event anywhere, and the invite flow is a modal with its own state, permission-set picker and credit gate. |

### 2. Blocked on `/design-login`

`86cbcn1q4`, `86cbcn1rr`, `86c9mq7q9`. The `claude_design` MCP has failed all day with
`FIRST_PARTY_AUTH_REJECTED`, and `CLAUDE.md` forbids building these from a written
description — it has gone wrong twice. **Do not start them until the prototype renders.**

### 3. Features sitting inside tickets full of one-liners

Each deserves its own ticket; none is a small fix, and no ticket says enough to build it:
**Duplicate an event** and **Make recurring** (`123qy9rng56`), an **Assets library**
(`123qy9rnfbe`), the **Repertoire table** behind Setlists (`123qy9rng8p`), **merge-on-
duplicate** across the CRMs (`123qy9rngc8`), **Team-admin as a paid seat** (`123qy9rnge6`),
and the **agreement PDF** (`86cbcn1f8`).

### 4. The sweeps' minors

Eleven from run 4 (QA4-10 … QA4-20) and nine from run 5 (QA5-6 … QA5-14), each with its
route and account in its report; several run-5 entries are run-4 minors re-confirmed rather
than new. None blocks a journey. **This is the largest single thing still open.**

### 5. The owed session

`123qy9rng6d` — the settlement vocabulary session with Ran. Still unheld, still the right
call: the naming has been changed three times from written notes and each was wrong.

---

## Two ways a MUTATION check lied, both measured after midnight

Mutation testing is this session's standard for "the test can fail on this line", and it
mis-answered twice in the QA5 work. Both are the same shape as `CLAUDE.md`'s green-suite
warning, one level down.

- **A first-match replace can mutate the wrong occurrence.** Two attempts to delete the
  `status = pending` filter from `closeChangeRequestsOnCancel` reported green; the string also
  occurs twenty lines earlier in `proposeEventChange`, and that is where the edit landed.
  **Anchor the replacement on surrounding lines and assert the match count is 1.**
- **A mutation survives when every test happens to satisfy the clause another way.** Seven
  survivors across the two fixes, each a filter that looked covered: the "from me" test had
  the payee invisible as well, so the *other* filter refused it; four queue-key clauses were
  satisfied by every fixture using one venue, one room and one date. **A test that passes
  because the case never varies is not covering the line.** The best of them:
  `status = "on_hold"` in the hold-queue key needed a **cancelled** hold that kept its rank,
  because the confirm cascade writes `cancelled` and leaves `hold_rank` where it was.

## What cost time today, so it does not cost it again

Four of these are already in `CLAUDE.md`; the rest are new.

- **`pnpm test:e2e` tears the manual dev stack down.** Every browser check must happen
  before it, or the stack gets rebooted after. Cost: three separate `auth/network-request-
  failed` dead ends.
- **The API does not hot-reload.** A restart re-seeds the database, which invalidates the
  browser's Firebase session — so the symptom of a stale API and the symptom of a fresh
  seed look identical.
- **A seeded permission set is a database row, not a constant.** A capability added to
  `PRESET_PERMISSION_SETS` does not reach a seeded operator until the seed's own copy has
  it. Three capabilities had already drifted this way; the copies are now **one** module
  (`@showme/db/seed-capabilities`) and a test asserts each equals its preset.
- **`vitest` does not typecheck.** A green API run shipped a type error in a test file;
  only `tsc --noEmit` per package sees it. Run it for **every** package after touching
  `packages/*` — `packages/shared` and `packages/auth` resolve from source.
- **A pipe hides a failing check.** `biome check . | tail -2` in the same command as a test
  suite silently dropped a lint error that was already in the tree.
- **A refusal is an instruction, and it gets followed.** The delete refusal's "cancel it
  first" advice was read as a suggestion when the clause order made it wrong: the QA agent
  followed it and cancelled a settled, paid show. Adding a "do X instead" to one clause
  changes what the whole ordered list means.
- **Ask what a check CAN fail on — twice in one day a guard was dead.** Two defensive `if`s
  survived mutation testing because the code around them already handled the case; both
  were deleted with their reasoning kept in comments. And one probe of mine proved nothing
  at all: it checked a notification on an event with a single participant, where **no**
  notification was possible.
- **A hook below an early return kills the page** and neither the typecheck nor 368 unit
  tests can see it. `EventDetail` died with *"Rendered more hooks than during the previous
  render"* on open.
- **`notifications.event_id` cascades from `events`.** A "this show was deleted" notice that
  carried the event id would be destroyed by the delete it announces — written and swept
  away inside the same request, leaving every party uninformed behind a green suite.

## The local stack, as left

Running (`pnpm dev`), and **re-seeded** before the last sweep. The sweeps mutate the seed
(cancelled shows, deleted events, extra riders and share links) — restart `pnpm dev` before
quoting anything from the database.
