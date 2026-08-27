# State of play — Ran's list, end of 2026-08-27

**Read this first if you are picking the work up cold.** It is the single
place that knows what is done, what is deployed, what is only committed, and
what nobody has written down anywhere else.

> ### This file will go stale, and this repo has a habit of trusting stale files
> Four handoff docs here describe a working tree that has since been committed,
> deployed or fixed. One of them cost a session today: it said the Budget Planner
> "never writes", which had been false since commit `e64e438`, and that claim was
> repeated into a scoping doc, a commit message and a ClickUp task before anybody
> checked the code.
>
> **So: verify before you act on any line below.** Every claim here is checkable
> in a few seconds — the SQL, the grep or the file is named. Prefer the check.

---

## 1. The one thing that is not obvious and will bite

**`gcloud run deploy --source .` uploads the WORKING TREE, not `main`.**
`.gcloudignore` excludes `.git` and `dist/`, not uncommitted source. A deploy has
never required a commit here, which is exactly how a previous session's work
ended up live but untracked. Commit before you deploy, or you will not be able
to say later what production runs.

**The dev API runs `tsx` WITHOUT `watch`** (`scripts/stack.mjs`). It serves stale
code after any route edit and looks perfectly healthy doing it. This cost four
agents time today. `lsof -ti:8080` before assuming a route is broken — and note
agents have left detached API processes outside the `pnpm dev` supervisor, which
Ctrl-C will not reap.

**`pnpm vitest run` at the repo root is wrong.** It sweeps `apps/web/tests`
Playwright specs into vitest and starves Docker; you get ~47 failures that mean
nothing. Correct: `cd apps/api && pnpm vitest run [src/one.test.ts]`, per package.
`apps/web` has **no** vitest suite at all — its `test` script is Playwright, run
from the root with `pnpm test:e2e`.

**Testcontainer suites fail spuriously under contention.** Two did today and both
passed 24/24 and 7/7 alone. Re-run a single suite before believing a failure.

---

## 2. What is DEPLOYED vs what is only on `main`

| | |
|---|---|
| **Deployed to production** | The 13 defect fixes only — commit `e47e387` and the tree it was built from. API revision `showme-api-00018-wp6`, web at `showme-app.web.app`. |
| **On `main`, CI green, NOT deployed** | Everything from `74b8f87` onward — 13 feature builds across four waves. |
| **Production database** | migration **0026**. |
| **Repo** | migrations **0027, 0028, 0029** are pending. |

### The three pending migrations, and the risk in each
- **0027** `notification_preferences` — additive, no risk.
- **0028** task reminders — additive, **plus a guarded DROP of `task_reminders`.**
  The table has been write-only since migration 0000 and nothing reads it, but
  that argument is made from the code and the code cannot see production's rows
  (`POST /tasks` did accept a `reminders[]` array). The drop **counts first and
  raises** if any row exists, so the deploy stops rather than destroying data.
  Verified both ways on a throwaway database.
- **0029** capacity moves onto the room — **backfills data** across four venue
  shapes. Accepts one documented loss: a building total no single room can hold.

**Recommended deploy order:** run migrations explicitly and read the output,
*then* deploy code. Do not let one `--source` deploy carry both.

---

## 3. ClickUp — what is owed the moment the limit resets

The daily MCP call limit (100/100) was hit at ~19:00 on 2026-08-27; it resets
about 21 hours later. **Nothing below has been recorded in ClickUp.**

Board: **Tech → General**, list `901524472815`. Parent: **[Ran list 2026-08-27](https://app.clickup.com/t/86cbaxtz1)**.

### 3a. Thirteen subtasks need moving to `shipped`
They are built, committed, on `main`, and CI-green — but **not deployed**, so if
you are strict they are `in review` until the next deploy. Pick one convention
and say which in a comment.

| Task | What shipped |
|---|---|
| [86cbaxy05](https://app.clickup.com/t/86cbaxy05) | Task assignee |
| [86cbaxyud](https://app.clickup.com/t/86cbaxyud) | Contacts import/export |
| [86cbaxwfr](https://app.clickup.com/t/86cbaxwfr) | Venue → room filter |
| [86cbaxvw8](https://app.clickup.com/t/86cbaxvw8) | Notification preferences + 5 emitters |
| [86cbaxumc](https://app.clickup.com/t/86cbaxumc) | Holds surface + auto-promote |
| [86cbaxvku](https://app.clickup.com/t/86cbaxvku) | Profile → event carry-over |
| [86cbaxxu1](https://app.clickup.com/t/86cbaxxu1) | Task reminders (in-app half only) |
| [86cbaxvf5](https://app.clickup.com/t/86cbaxvf5) | Deal → budget |
| [86cbaxwb5](https://app.clickup.com/t/86cbaxwb5) | Unavailability on the grid |
| [86cbaxxj9](https://app.clickup.com/t/86cbaxxj9) | In-house teams |
| [86cbaxwmt](https://app.clickup.com/t/86cbaxwmt) | Rooms/capacity consolidation |
| [86cbaxw5k](https://app.clickup.com/t/86cbaxw5k) | Calendar `.ics` import |
| [86cbazcc7](https://app.clickup.com/t/86cbazcc7) | Partially — 2 of its 4 items done; description already updated |

### 3b. Six tasks that DO NOT EXIST and need creating
Full scope for the first four is in `backlog-2026-08-27-feature-scopes.md`.

1. **Budget Planner regression test** — `shiftedTwoPlaces` is a pure function with
   no test, because `apps/web` has no unit runner. Blocked on [86cbazcf3](https://app.clickup.com/t/86cbazcf3).
2. **`reconcileEvent` does not filter deals by `status`** — a `draft` or
   `cancelled` deal still settles (`apps/api/src/routes/settlement.ts` ~603). Now
   a visible divergence: the Budget Planner shows only confirmed deals, so a
   draft deal displays nothing while the settlement would still pay it. **Money.**
3. **The hold pool is not scoped to an operator** — `loadSiblings` keys on
   (date, venue, stage) only, so two operators' holds share one queue. Proven
   live: a rival's hold collided at rank 1 with an existing rank 1, and
   `hold/confirm` would cancel another operator's pencil. Disclosure is handled
   (a rival's title is withheld); the ranking semantics are a **story.md
   question**, not a code one.
4. **Crew cannot see their own call time** — `serializeParticipant` returns
   `details` to operators only, which is correct for operator-private notes but
   means the person being asked to turn up at 16:15 cannot see 16:15. Needs a
   self-row branch and a decision about which keys are self-visible.
5. **`apps/jobs` imports `notify.ts` from `apps/api` by relative path** — a
   layering smell. The alternative was a second copy of the preference gate,
   which `notify.ts` explicitly forbids. Proper fix: move `notify.ts` into
   `@showme/db` beside `representation-termination.ts`. Touches every emitting
   route, so it wants its own change.
6. **Off-platform participant cannot be added to an event** — the other half of
   [86cbaxxcu](https://app.clickup.com/t/86cbaxxcu), which shipped only the honest
   reporting. A venue's own stage manager can sit on the Team roster as a Contact
   and remain unbookable. See `docs/off-platform-access.md`.

### 3c. Smaller findings worth a line each
- **`docs/timezones.md` names `task_reminders`** as its user-local example. 0028
  drops that table; the *rule* survives in `tasks.remind_at`.
- **The `.ics` import audits outside the write transaction** — `upsertExternalCalendarEvents`
  takes a `Database`, not a `Transaction` (a deviation from decisions #2). One-line
  widening on three signatures. Note the Google sync path writes those same rows
  with **no** audit at all today, so this is already better than the status quo.
- **The public profile page does not publish rooms.** Alternate setups are now
  owner-only. Publishing rooms would need `routes/public.ts` and
  `apps/marketing/src/profile.ts`.
- **Notification emitters still missing:** event cancelled / date moved / deleted
  (`routes/events.ts` was contended when notifications were built — this is the
  biggest remaining gap), deal delete (needs recipients captured before the
  transaction cascades them away), and `task.*` beyond the reminder.

---

## 4. Still genuinely blocked — not work, decisions

| | Blocked on |
|---|---|
| Deals rollback to V2 ([86cbaxv2a](https://app.clickup.com/t/86cbaxv2a)) | Ran. He settled on "keep it in creation AND keep the tab", but the agreement/confirmation flow and T&C template need specifying. |
| Deal-kind menu ([86cbaxv7j](https://app.clickup.com/t/86cbaxv7j)) | Ran. One menu or two. Note `custom`/free-text was deliberately removed (decisions #16.2) because it broke the engine. |
| Settlement "Deal Structure" tab ([86cbaxvb9](https://app.clickup.com/t/86cbaxvb9)) | Ran. Keep and make legible before a settlement runs, or fold into the Settlement tab. |
| Events list vs the design ([86cbaxu87](https://app.clickup.com/t/86cbaxu87), data half shipped) | **`/design consent`** from Daniel. Per the `claude-design` skill the prototype must be RENDERED and looked at — never read as HTML or rebuilt from a description. That has gone wrong twice. |
| Access giving ([86cbaxvqk](https://app.clickup.com/t/86cbaxvqk)) | The API gaps in [86cbazcc7](https://app.clickup.com/t/86cbazcc7): `permissionSetId` is optional-but-not-nullable, so access is a one-way door — "revoke to standard" has no meaning yet — and no route lists permission sets, so the UI cannot name the bundle it grants. |
| File uploads ([86cbaxw0w](https://app.clickup.com/t/86cbaxw0w)) | **Ran.** Not reproducible: `FIREBASE_STORAGE_BUCKET` and both BREVO secrets ARE set in production (read off the live service). Best remaining guess is he hit the rider Upload button, disabled for operators by design. Ask him what he clicked before building anything. |

---

## 5. Two corrections to earlier claims, so nobody re-inherits them

1. **The `localhost:5173` "bug" was a false positive.** `apps/web/src/lib/publicSite.ts`
   deliberately targets the marketing site, which owns 5173 in dev while the app
   runs on 5180. The links are dead locally only because `pnpm dev` does not start
   the marketing app.
2. **"You are not a party to this settlement" was not a defect.** Party resolution
   is correct — it comes from `event_participants`, so the host IS a party the
   moment the engine runs. `ownParty` is null for everyone until somebody
   reconciles, and the copy read "no rows" as a statement about the reader. Copy
   fixed, engine untouched, invariant pinned by a test.

---

## 6. The pattern worth carrying forward

**The reported bug was rarely the real one.**

- The Budget Planner was not failing to write. It was rounding through a float
  (`Math.round(Number("4.015") * 100)` is **401**), storing totals that disagreed
  with their own line items, writing rows nobody typed — including an invented
  revenue line — and losing the last edit on tab change.
- The deal was not failing to reach the budget. `paysAPerformer` matched
  `roleInDeal === "payee"` only, and **a door split names its performers
  `split_member`** — so no split deal had ever matched, since the day it was written.
- "No rooms filter" was really "no rooms": the `stages` table was empty and the
  seed faked a second room with free text in `venue_name`.
- The "IBAN verified" badge was `Boolean(contact.iban)`. No such column exists.

Reproduce it yourself before scoping it. Every one of those was found by driving
the running stack, and none would have been found by reading.
