# State of play — through 2026-09-01

> **PRODUCTION IS LIVE AND CURRENT as of 2026-09-01.** Migrations 32/32, API
> revision `showme-api-00021-9h4`, web app on `showme-app.web.app`. Everything
> in this file that reads as "blocked" or "not deployed" describes a moment that
> has passed — see the DEPLOYED section near the end before acting on any of it.
> A handoff doc is a snapshot, not a statement about the present.

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
`apps/web` **now has a vitest suite** (added 2026-09-03, [86cbazcf3](https://app.clickup.com/t/86cbazcf3)):
`pnpm --filter @showme/web test:unit`, or `pnpm test:unit` for every package that
has one. Its `test` script is still Playwright, run from the root with
`pnpm test:e2e` — hence the two task names.

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

The daily MCP call limit (100/100) was hit at ~19:00 on 2026-08-27. **Nothing
below has been recorded in ClickUp.**

Re-checked **2026-08-28 00:16 CEST** with a single cheap read: still locked,
`retryAfter` 57530s — so the reset is **~16:15 on 2026-08-28**, i.e. the window
is ~21h from first lockout, not from the last attempt. Reads draw on the same
budget as writes, so probing costs the thing you are probing for: check ONCE,
past the stated reset, and not before. Add to the list below: **wave 2 of the
mobile pass** (commit `1cc483b`) has no task at all.

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
| [86cbaxv7j](https://app.clickup.com/t/86cbaxv7j) | One deal menu + "Other — agreed manually" |
| [86cbaxv2a](https://app.clickup.com/t/86cbaxv2a) | Terms + template, and the wizard's deal auto-sends |
| [86cbaxvb9](https://app.clickup.com/t/86cbaxvb9) | Settlement "Deal Structure" tab folded away |
| [86cbazcc7](https://app.clickup.com/t/86cbazcc7) | Partially — 2 of its 4 items done; description already updated |

### 3b. Six tasks that DO NOT EXIST and need creating
Full scope for the first four is in `backlog-2026-08-27-feature-scopes.md`.

1. ~~**Budget Planner regression test**~~ — **DONE 2026-09-03.** `apps/web` has a
   vitest project now ([86cbazcf3](https://app.clickup.com/t/86cbazcf3)), the two
   exiled suites are home, and `shiftedTwoPlaces` is covered where it lives
   (`apps/web/src/lib/moneyUnits.test.ts`). See §9.4.
2. **`reconcileEvent` does not filter deals by `status`** — **DONE 2026-08-31.**
   Both halves. Read the whole entry before re-opening it: the middle of this
   story is a fix that would have been a disaster, and the shape of it is worth
   keeping.

   **What was wrong.** `deals.status` had an enum, two readers, and NO WRITER
   ANYWHERE IN THE PRODUCT. It defaulted to `draft` and stayed there for every
   deal any operator ever created — the wizard said so in as many words, both
   confirm doors advanced only `agreement_status`, and no screen sent it. Only
   `seed.ts` / `seed-e2e.ts` wrote `confirmed`, and `db-build-plan.md:50` had
   flagged the whole enum as an unratified assumption.

   **The fix NOT made, on 2026-08-31's first pass.** Filtering the engine to
   `status = 'confirmed'` while nothing wrote it would have dropped every deal
   an operator ever created, collapsed every entitlement into the operator's
   residual, and **paid the performers zero** — while satisfying `Σ net = 0`
   perfectly. Only `cancelled` was filtered; `draft` kept settling, with an
   `it.skip` holding the reasoning.

   **What landed on the second pass (Daniel's decision: give the column a real
   writer).**
   - **The writer is the signature rollup**, in `apps/api/src/lib/deal-confirmation.ts`
     beside the freeze — so BOTH doors get it (`POST /deals/:did/confirm` and
     `POST /shares/:token/approve`). `status → 'confirmed'` when the last
     signatory line is stamped, which is the same condition that freezes
     `confirmed_snapshot`.
   - **`POST /deals/:did/reopen` writes it back to `draft`.** Reopening tears up
     every signature; a `status` left at `confirmed` would be a high-water mark,
     not a fact, and the Budget Planner would keep rendering a read-only fee from
     an agreement under renegotiation.
   - **`PATCH /deals/:did` now REFUSES a hand-set `confirmed`** (400, "confirmed
     by its parties' signatures, not by hand"). It had always accepted `status`
     in its Zod body, which was harmless while the column was inert and is not
     harmless now: `deal.edit` belongs to ONE side of an agreement.
   - **`cancelled` has no dedicated route and none was invented.** That same
     PATCH is the whole cancel path in the product (`DELETE /deals/:did` hard-
     deletes the row instead), and nothing in `apps/web` sends it yet. A
     signature does not un-cancel a withdrawn deal — the writer preserves
     `cancelled` deliberately.
   - **Migration `0030_a_deal_is_confirmed_by_its_signatures.sql`** backfills
     `status = 'confirmed'` from `agreement_status IN ('confirmed','signed')`,
     never touches `cancelled`, and **refuses** (guarded `RAISE`) if it finds the
     mirror-image row — `status = 'confirmed'` on an agreement still draft/sent —
     rather than demoting it silently. Tested both ways on a throwaway database.

   **The engine still gates on `cancelled` ONLY, and that is now a decision
   rather than an obstruction.** Once the writer exists, `status` is
   `agreement_status IN ('confirmed','signed')` under another name, so gating on
   it answers "may an unsigned agreement settle?" — which is a product question
   nobody has answered. And the failure mode has not changed shape: a deal one
   signature short (including the OPERATOR'S OWN payer line) would pay its
   performer nothing, with `Σ net = 0` intact and nothing in the response saying
   a deal was dropped. **Measured:** flipping the clause turns **33 of the 76
   tests in `settlement.test.ts` red**, all of them `expected '0' to be
   '300000'`-shaped. The `it.skip` is GONE — replaced by two passing tests that
   pin both halves (a signed deal settles and reads `confirmed`; a deal in
   flight settles too). If the product later wants unsigned agreements excluded,
   it is one clause in `routes/settlement.ts` and the cost above is the price tag.

   **The Budget Planner is fixed by the writer, with no web change.**
   `useBudgetSeed.ts:196` gates on `status === 'confirmed'`, which is why the
   "Performer fee" heading was blank for every deal made in the app. Verified in
   the browser as the operator: a deal created, sent and signed entirely in the
   app now renders **"Performer fee — SEK 25,000 · Read from the deal 'Headline
   fee'"** as the read-only heading, and reopening the agreement puts the row
   back to a blank, typeable input. (My 2026-08-27 claim that the planner "shows
   only confirmed deals so a draft shows nothing" was inverted; the 2026-08-31
   correction of it stands.)

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
6. **A deal can be confirmed without ever being sent** — `POST /deals/:did/confirm`
   (`apps/api/src/routes/deals.ts`) does not gate on `agreement_status`, so
   `draft → confirmed` skips `sent` entirely and the state machine the enum
   documents is not enforced. This is not academic: it is why the wizard's
   auto-send undo had to hold in FRONT of the send rather than retract after it
   — a party can sign inside a retract window, and retracting would then be
   voiding a signature. Decide whether confirm should require `sent`, or whether
   the enum is aspirational.
7. **Off-platform participant cannot be added to an event** — the other half of
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
| ~~Deals rollback~~ · ~~deal-kind menu~~ · ~~settlement Deal Structure tab~~ | **DECIDED AND BUILT 2026-08-27 evening** — see §7. |
| Events list vs the design ([86cbaxu87](https://app.clickup.com/t/86cbaxu87), data half shipped) | **`/design consent`** from Daniel. Per the `claude-design` skill the prototype must be RENDERED and looked at — never read as HTML or rebuilt from a description. That has gone wrong twice. |
| ~~Access giving~~ ([86cbaxvqk](https://app.clickup.com/t/86cbaxvqk)) | **UNBLOCKED AND BUILT 2026-09-03** — the API gaps in [86cbazcc7](https://app.clickup.com/t/86cbazcc7) are closed (`permissionSetId` is `.nullable()`, `GET /events/:id/permission-sets` exists, and the participant serializer carries the set's name and capabilities). Settings → Team Access is a real screen: members with a role select, pending invitations with Withdraw, and an invite form. See §9. |
| ~~File uploads~~ ([86cbaxw0w](https://app.clickup.com/t/86cbaxw0w)) | **CLOSED 2026-09-03, and it was never Ran's bug.** `FIREBASE_STORAGE_BUCKET` is set in production, as this row already said. What was missing was any way to KNOW that — nine integrations degrade silently and a `--set-env-vars` deploy replaces the whole set. There is now a boot-time audit and `GET /admin/configuration`. The operator's rider Upload button no longer looks broken either. See §9. |

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


---

## 7. The deal-flow decisions — taken 2026-08-27 evening, and built

Ran's three deal complaints were the last thing genuinely blocked on a person.
Daniel ruled: **if Ran asked for something it should exist; if it is too big for
the creation flow, exclude it there and put it on the Deals tab.** That resolved
most of it, and the rest was answered directly.

| Decision | Outcome |
|---|---|
| One menu or two | **One**, using the settlement shapes. The wizard already did it Ran's way; the composer moved to match. `DEAL_STRUCTURE_OPTIONS` is now derived from the kind table so they cannot drift apart again. |
| "Other (manual)" | **Label change only.** "Paper agreement only" → **"Other — agreed manually"**. Still `structure: null`. A free-text *computed* shape cannot exist (decisions #16.2); the helper text now says so out loud instead of offering a box that settles as nothing. |
| T&C box + template | **Built, on the Deals tab, not the creation flow.** Bounded by his own two statements — he asked for it, and he said "we are not an agreements app" — so: a text field and reusable templates, no clause library, no e-signature. |
| Auto-send | **Yes, with a 6s undo that holds in front of the send.** Not a preference: `confirm` does not gate on `agreement_status`, so a party can sign inside a retract window. |
| Settlement "Deal Structure" tab | **Deleted**, cards folded into that workspace's own Settlement tab. Ran did not ask for the tab — he said he did not understand it — so this one was ours to decide. |

**No migration was needed for any of it.** `deals.agreement_body_text` already
existed with three readers and no writer, and `templates.category` has carried
`terms` since migration 0000 — so terms ride the same template mechanism the
budget already uses. One template system, not two.

### What is left of Ran's 30
**Two**, both blocked on something outside the code:
- **Events-list design comparison** ([86cbaxu87](https://app.clickup.com/t/86cbaxu87), data half shipped) — needs `/design consent`.
- **Access giving** ([86cbaxvqk](https://app.clickup.com/t/86cbaxvqk)) — needs the participants-API question answered first: `permissionSetId` is optional-but-not-nullable, so "revoke to standard" has no meaning yet.


---

## 8b. Public profiles + the map — 2026-08-31 (commit `8fe37b5`, CI green)

Four asks from Daniel and Ran, delivered together. Full reasoning for the
visibility rule is **`docs/decisions.md` #19**; this is the operational residue.

### OWED: the Mapbox token is NOT in production
The geocoder ships disabled. Without `MAPBOX_ACCESS_TOKEN` the route returns a
clean **503 `geocoder_unavailable`** and the address field degrades to plain
typing — which is what every venue has today, so nothing regresses. To enable:

```
printf '<the pk. production token, in docs/deploy-api.md and the prior app>' \
  | gcloud secrets create MAPBOX_ACCESS_TOKEN \
      --project prod-showme --replication-policy=automatic --data-file=-

gcloud run deploy showme-api --project prod-showme --region europe-north2 --source . \
  --update-secrets "MAPBOX_ACCESS_TOKEN=MAPBOX_ACCESS_TOKEN:latest"
```

**`--update-secrets`, NEVER `--set-secrets`** — the latter replaces the whole set
and would drop `DATABASE_URL`. Also worth doing: restrict that token by URL in
the Mapbox dashboard, now that it is only ever called from Cloud Run. These are
`pk.` tokens (designed to be client-visible), so server-side is defence in depth
and one metered chokepoint, not a claim that it is a secret.

### The tier that has no home
Daniel chose "amenities and deal types stay visible to signed-in industry". They
are off the anonymous payload — but **there is no screen anywhere in the product
where one account can view another's profile.** Every `/profiles/:id*` read is
membership-gated, `/profiles/search` returns a thin card, and the only
cross-profile view that exists is the anonymous marketing page.

So the middle tier is enforced and unrendered. No browsing screen was invented.
`serializeWithheldVenueTradeDetails` is what one would call. **Until venue
discovery exists, promoters have simply lost information they used to have** —
worth saying out loud to Ran rather than letting him find it.

The editor's copy for that tier deliberately describes **today**, not the plan
(`apps/web/src/components/FieldAudience.tsx`). Widen it in the same change that
ships the surface — a form that overstates who sees a field is the exact defect
this work fixed.

### A ROBUSTNESS BUG THE MOBILE AUDIT CAUGHT SIDEWAYS
Worth generalising. The Events sweep failed on a **20px broken-image box inside
an 18px avatar** — trivially dismissable as a fake-storage artefact, since the
e2e signed URLs point at a sink that serves no bytes.

It was real. **Profile images are signed URLs with a 15-MINUTE EXPIRY**, so any
page left open long enough reaches the broken state on its own, as does a revoked
file or a moment offline — and the browser's placeholder box is *wider than the
avatar asked for*. `Avatar` now falls back to its initials `onError` and resets
that state when `src` changes, so a re-signed URL gets a fresh attempt instead of
being stuck on initials forever.

**The old one-assertion audit could never have seen this** — the avatar has
`overflow: hidden`, so nothing overflowed the document. It took the clip scan
added in wave 4. And note the shape of it: *a failure that looks like test-
environment noise was describing a real production state.*

### Other findings worth not rediscovering
- **A half-migration, now closed:** since `0022` every performer with an
  UPLOADED picture returned `avatarUrl: null` from the event roster; only legacy
  external URLs rendered. `avatarFileId` is now REQUIRED on the participant face
  type, so a caller that omits it fails to compile rather than silently
  reintroducing the bug.
- **`lat`/`lng` were published for months and never written** — no geocoder
  existed. They are still null for every venue in the database; a pin appears
  only when someone re-picks their address. Any bulk backfill should be a
  one-off script driving `GET /geocode` with a human reviewing ambiguous hits,
  **never a migration calling a third-party API**.
- **Public performer avatars: still not published**, deliberately. Doing it needs
  `is_public` gating on the *performer*, or a venue's page publishes the face of
  someone who kept their own profile private.
- The interactive map overturns the marketing page's zero-third-party-request
  stance. Daniel chose that knowingly; Leaflet+OpenStreetMap draws it and Mapbox
  is used **only** for geocoding.

## 8c. Ran's SECOND list — 2026-08-31, all 26 items landed

Commits `c556bd7` (17 items) and `a2ffc1e` (9 items), both CI-green. Product
decisions are `docs/decisions.md` #19-#21. This section is the residue: what was
NOT what it looked like, and what is still owed.

### FIVE items were already working — check before scoping these again
- **Video fullscreen** — `allowFullScreen` was always set; only the link-out was
  missing.
- **Collapsible offers** — deals already collapsed and persisted; the REQUESTS
  inbox was the surface that did not.
- **Archiving** — fully built, three-dots menu included. Only *delete* was
  missing (and see below).
- **Riders/documents** — the upload code is complete. It is DELIBERATELY disabled
  for operators: `RIDER_BEARING_ROLES` excludes `host`. Ran pressed a button that
  is locked on purpose. Whether a venue should attach its own house documents is
  an open product question, not a bug.
- **Email** — the sink is complete and both Brevo secrets ARE set in production.
  `pnpm dev` deliberately does not load `BREVO_API_KEY` (`scripts/stack.mjs:55`),
  which is why a share link cannot be verified locally; the no-op sink prints the
  OTP to the console.

### THE REPORTED BUG SAT ON A WORSE ONE — four times
This is the pattern of the whole list and worth expecting next time.

1. **`DELETE /events/:id` existed and was broken twice.** In `events-list.ts:421`,
   not `events.ts`. It destroyed OTHER PARTIES' records (archive is
   reader-scoped; delete had no such seam), and it did not work anyway:
   `budget_lines.collected_by` → `event_participants` is `NO ACTION` and the
   cascade reaches participants first, so any event with a revenue line naming
   its host raised a foreign-key violation and returned a 500.
2. **The setlist list route gated on `budget.view`** — a money capability read as
   a stand-in for "is an operator", so a co-promoter handed only the budget could
   read every act's songs. The repo had already fixed this exact shortcut once
   for `rider.view` (`presets.ts` records it). And the upsert took
   `participantIds[0]`, so a promoter who also plays could have their songs filed
   at a performing-rights society **under the venue's name**.
3. **The guest-list `note` was accepted with a 200 and thrown away** —
   `.passthrough()` is on the OUTER extras object, so Zod stripped unknown keys
   from the inner one.
4. **"Paid by is always the operator" was a DISPLAY fallback**, not a stored
   value: every unset row rendered the planner's own name as though chosen.

### Blind spots closed, and the one that keeps recurring
- **The mobile audit never covered the Budget Planner.** It visits
  `/events/:id`, which lands on Event Details, so a **482px sideways overflow**
  sat there under a green suite. Fourth blind spot of this family (after
  `position: fixed`, `overflow: hidden`, and pseudo-elements).
  **Rule: a screen not in `SCREENS` is not covered. Add every new screen, and
  exercise any non-default view mode** — a screen tested only in its default
  state is half-tested.
- **`setups` was missed by decisions #19** because that entry was written as a
  fact about VENUES, so the search was for venue columns and `setups` is a
  performer field. #19 now records the failure mode.

### Still open — product calls, not code
- **Rank and first refusal** (decisions #20): a 2nd hold can confirm over a 1st,
  so rank buys nothing. No challenge/release flow exists.
- **`PATCH /events/:id` reaching `confirmed` with no cascade** — a date can be
  taken with no hold released and nobody notified.
- **May an unsigned agreement settle?** Answered for the DOOR (#21 gates compute
  and finalize) but `draft` deals still settle once the door is open.
- **Should an operator attach house documents** (riders, above).
- **An industry-facing profile view** — #19's middle tier is enforced with
  nowhere to render; no screen lets one account browse another's profile.

### Environment, and a trap that cost a session's verification
- **The disk filled to 293 MiB free of 228 GiB and wedged Docker.** Cause: **297
  abandoned Testcontainers volumes, 16.24 GB** — the suites get killed mid-run by
  the port-bind flake and never clean up. Removed the 296 anonymous 64-hex
  volumes and PRESERVED the one named volume,
  `showme-2026_showme-pgdata` (the dev database). **Do not run
  `docker volume prune`** — it takes named volumes too.
- Docker Desktop's VM image does NOT shrink on macOS when volumes are deleted.
  The space is free inside the VM; reclaiming it on the host needs
  Troubleshoot → Purge data.
- This will recur. `docker volume ls -q | grep -E '^[0-9a-f]{64}$' | xargs docker volume rm`
  is the safe sweep.

## 8. The mobile loop — running when this was written

Daniel's brief: *"Make it recursive so you run it until everything is verified
working great and smoothly on mobile everywhere in the app. I'll test on my
phone. So deploy the changes after each wave and verification. Make sure you
dont fuck up the desktop version."*

So: **wave → verify → deploy → repeat**, and the desktop guard is the FULL
Playwright suite, not a spot check.

### The measure
`apps/web/tests/mobile-audit.spec.ts`. Two objective assertions plus one report:
`scrollWidth <= clientWidth` at 390px across 16 screens; the drawer journey
driven with pointer AND with the keyboard alone; and sub-44px tap targets
**counted, never asserted** (the app has deliberate 26–28px icon buttons, so
failing on it would turn a judgement into an obstacle).

```bash
pnpm --filter @showme/web exec playwright test mobile-audit
```

### THE TRAP THAT WASTED TWO RUNS
`apps/web/playwright.config.ts` sets `reuseExistingServer: !CI` on port **4174**.
A run therefore silently reuses whatever preview server is already up —
**including another agent's stale `dist-e2e` build**. An agent's first post-fix
run reported numbers *identical* to its baseline; the CSS was fine, it was
measuring somebody else's build. An orphaned `vite preview` was live with no
orchestrator behind it.

> **`lsof -ti:4174` before trusting any result.** If a number does not move
> after a change you believe in, check that before you touch the CSS. And do
> not run the suite while another agent is running it — you poison each other.

### Wave 2 — what landed
| Screen | Before | Cause | Fix |
|---|---|---|---|
| Settings | 94px | rail is 254px of the 358 available; and `1fr 1fr` is `minmax(auto,1fr)`, so a Select's min-content set the floor | `Settings.module.css`: rail becomes a 2-up grid above the panel ≤860px; `minmax(0,1fr)` lets the trigger's existing ellipsis work |
| Contacts | 59px | four header actions on one unwrappable line | `flexWrap: "wrap"` on the inner actions row |
| Dashboard | 378px | (wave-2 agent) | `Dashboard.module.css` |
| Requests | 129px | (wave-2 agent) | `Requests.module.css` |

Suite moved **54 passed / 6 failed → 58 / 2** on the Settings+Contacts change
alone. `rider-preview` and `two-users` failed in that agent's baseline and pass
now — they were concurrency casualties, not real.

Design system, same wave: `SectionHeader.module.css` gained `flex-wrap: wrap`
on `.actions`, and `.text` — **referenced by the TSX since it was written but
never defined** — now sets `min-width: 0`. New `design-system/src/styles/
touch.css` adds `.touch-target` / `.touch-target-overlay`, both gated on
`@media (pointer: coarse)` rather than a width, so **the file is a no-op on the
desktop by construction**. The finger, not the window, is what the 44px floor
is about: a 390px laptop window needs none of it, a 1024px tablet needs all of
it.

### The house pattern for a narrow rule, now used in four files
A CSS custom property **cannot** appear in a media query condition —
`@media (max-width: var(--breakpoint-tablet))` is invalid and silently never
matches. So write the literal and cite the token beside it:
`/* ≤ --breakpoint-tablet (860px, design-system/src/styles/tokens.css) */`.
The values are `--breakpoint-phone: 560px`, `--breakpoint-tablet: 860px`.

### Wave 3 — the measure was widened, and it found something bad

**Why widen it.** The old spec asserted at 390px only. A width sweep caught a
bug that both widths anyone checks would have passed: a 178px KPI track floor
was fine at 390 and fine at 1440, and pushed a **414px** phone sideways by 17px
and a **430px** by 9px. A long email overflowed Requests at 414, 430 *and* 768.
The crude failures show at 390; the subtle ones live *between* the breakpoints,
where a track floor and the available width cross over.

`mobile-audit.spec.ts` now sweeps **nine widths** — 360, 390, 414, 430, 560,
561, 768, 860, 861. The pairs matter: 560/561 and 860/861 sit on and one past
`--breakpoint-phone` and `--breakpoint-tablet`, and 861 is the narrowest content
column the desktop shell ever has, which is what keeps this a desktop guard too.
Cost: the whole suite went 17.2s/60 tests → **29.0s/80 tests**, by resizing the
viewport in place rather than re-navigating (16 loads, 144 measurements).

### EVERY MODAL WAS BROKEN ON EVERY PHONE, AND THE SUITE SAID GREEN
The single most important finding of the mobile pass, and a lesson about
measurement rather than about CSS.

`Modal.module.css`'s scrim is `display: grid; place-items: center; padding:
24px`. The auto-sized track sizes itself to the panel's `width` prop, so the
panel's `max-width: 100%` **resolves against the track it just created and is a
no-op**. The panel never shrinks: it sits at `left: 24` and runs off the right
edge. The scrim is `position: fixed` with `overflow: visible`, so nothing
scrolls to reach the overhang — and `documentElement.scrollWidth` reads exactly
the viewport width the entire time.

**That is why it was invisible.** The audit's one assertion was structurally
incapable of seeing it. A fixed-position element cannot move the document's
scroll width, so a whole surface of the app failed underneath a green suite.
Nine of ten modals overhang a 390px phone: the 520px default (Add contact, New
task, Create work-group, New invoice, New profile), Invite member at 480,
Availability share at 560, Import contacts at 760, Import .ics at 820. Only the
New event wizard passes, and only because it uses its own overlay
(`width: 100%; max-width: 620`).

> **The general lesson:** when a suite is green, ask what the assertion is
> *capable* of failing on. `scrollWidth <= clientWidth` cannot fail on anything
> `position: fixed`, anything inside an `overflow: hidden` ancestor, or anything
> a pseudo-element owns. Green means "the thing I measured was fine", never
> "the app is fine".

**Expect a second wave when the panel is capped.** The `minmax(auto, 1fr)` bug
is latent inside these modals — their `1fr 1fr` field grids cannot be squeezed
while the panel refuses to shrink. Probed: at 390px the Add-contact grid
resolves to `230px 230px` inside a 474px body. Fix the scrim → re-run → fix what
the clip scan then reports.

### Five fixes the measure itself needed to read true
Worth knowing, because each is a way a mobile assertion can lie:
1. **Measure the panel against the viewport**, not its own scroll box — both
   obvious checks are structurally blind here.
2. **Wait for stable geometry.** `useModalMotion` tweens `scale: .96 → 1`, and
   `getBoundingClientRect()` reports the *transformed* box: un-waited, a 520px
   panel measured 501.7px. Poll for two identical widths, never sleep.
3. **`document.fonts.ready`** — a 3px Event-workspace failure was flaky 2 runs
   in 3 without it, 3 in 3 with.
4. **Skip elements clipped by an ancestor scroller** in the offender dump, or it
   names five tab-strip buttons and buries the real culprit.
5. **Exempt `text-overflow: ellipsis` and form controls** from the clip scan: a
   `type="date"` input reports a 4248px `scrollWidth` in a 362px box while
   looking perfectly normal.

### CI RENDERS TEXT ~10% WIDER THAN macOS — a local green is not a green
Two tests passed on this machine and failed in CI, and the cause is font
metrics, not flakiness. Measured: the same string is **208.59px locally and
225.63px with webfonts blocked (+8.2%)**. All four families are self-hosted
woff2 tracked in git, so CI is not missing font *files* — it simply renders
wider.

What that exposed matters more than the two tests. The New event wizard's
Venue/City row resolved to **`204px 48px` inside a 266px box — a dead-exact fit
with zero headroom**. It was not nearly broken locally; it was passing by luck,
and any change to a label, a font, or a locale would have broken it.

> **A test that passes with zero headroom is not passing, it is pending.**
> A local green is one environment's opinion. Wait for CI before calling a
> layout verified, and fix a boundary failure by removing the floor
> (`minmax(0, 1fr)`, `min-width: 0`) rather than by buying a few pixels.

**How to see it locally:** run the suite with webfonts blocked (+8.2%) or with
the stack forced to Courier New (~+20%). Those two bracket CI's ~10%, so a
layout green under both is genuinely safe. This is how the wizard's step rail
was found — CI never flagged it; the stress run did.

### A THIRD BLIND SPOT: the hand-rolled lists
Found while fixing the modals, and it belongs beside the `position: fixed`
lesson because it is the same shape.

`apps/web/src/routes/Events.tsx:372-383` (`GRID_COLUMNS`) and Bills & Invoices
are their own grid tables — **not** `DataTable`, so the `minmax(0, Nfr)` fix
does not reach them. At 360px Events puts 375px of row into a 330px card and
Bills puts 356 into 330, and each hides the remainder behind its own
`overflow: hidden`. So the last column is silently amputated rather than
scrolled to.

**Neither half of the audit can see it**: it is not a document overflow (the
card clips it) and it is not inside a dialog (which is the other place the spec
scans for clipping). Add the same `minmax(0, …)` treatment, and answer the
design question below at the same time.

### ESCALATED — PARTLY ANSWERED IN WAVE 6, READ THIS BEFORE RE-LITIGATING
This section used to say a narrow table was merely "cramped" and that the fix
was a product call nobody should invent. **Wave 6 built the card layout** for
the two routes where the screen was not just cramped but unusable (Events and
Bills — see §Wave 6). So:

- **DONE:** `Events.tsx` and `InvoiceLedgerTable.tsx` become cards at ≤860px.
- **STILL OPEN, and still Daniel's:** the shared `design-system` `DataTable`
  (Settlements, Projections, the CSV import preview) has NOT been given a phone
  layout. A five-column table at 336px is complete and readable but cramped —
  the mono header wraps to "NA/ME". Whether that wants the same card treatment,
  a reduced column set, or nothing at all is a design decision, and Daniel has
  the prototype. Wave 6 deliberately did not generalise the card pattern into
  the design system on its own authority.

### Wave 5 — touch, and what the count actually means
Every remaining sub-44px control on a coarse pointer is now EITHER a documented
deliberate exemption OR an overlay the measurement cannot see. Verified by
probing with `hasTouch`/`isMobile` and asserting
`matchMedia("(pointer: coarse)").matches` before trusting a number:

| Screen | small | what they are |
|---|---|---|
| Requests | 7 of 100 controls | design-system `Chip` at 29px — the deliberate 37px halo |
| Calendar | 33 | 32 day-number buttons (see below) + "Manage rooms", which HAS an overlay |
| Contacts | 30 | 5 chips + 25 copy buttons carrying the 44×34 halo |

**Zero overflow under a coarse pointer**, all 9 widths × 16 screens — the real
risk of this wave, since `min-width: 44px` widens things.

**The count is a work list, not a score, and it can never reach zero.** An
overlay is a `::after`, and `getBoundingClientRect()` cannot see a
pseudo-element, so a control whose hit area really did grow to 44px stays in the
count forever. Chasing it to zero would mean growing boxes that should not grow.

**The exemptions worth knowing** (full reasoning in `styles/touch.css`):
- **The small button inside a big clickable row** — the calendar's 24×24 day
  number and the invoice ledger's vendor name. These *look* like the worst
  offenders and are not touch targets at all: each exists so a keyboard has
  something to focus without nesting a button inside a button, and the finger
  already has the container. Measured coarse at 360px, the day cell is
  **47×104** and a tap in its empty middle opens that day's menu. Growing the
  inner button would only steal taps from the event chips stacked under it.
- **The month grid's event chips** (34×20) — seven columns of a phone leave 31px
  of content width, so the chip is an ellipsis at any height. That grid needs a
  day agenda on a phone, which is a design answer; Day and Week views already
  are that route.
- **`RemovableChip`'s ×** (13×13 in a 25px pill) — an overlay would reach the
  next pill in a wrapping strip, on a control whose whole job is deletion.
- **Inline dates and URLs** — positioned by the flow of surrounding text, which
  is the exemption WCAG 2.5.8 grants explicitly.

**A probe can lie the same way a suite can.** A first pass reported Requests at
49; the real figure is 7. The probe measured immediately after a viewport resize
with only a double-rAF, so it read a layout mid-reflow — the identical "wait for
stable geometry" trap that wave 3 hit with modal motion. Poll until two
consecutive identical readings, and wait for the DATA, not just the shell: an
earlier attempt reported 7-of-7 because the list had not rendered at all.

### Wave 6 — the LIVE walkthrough, which found what the suite could not
Daniel asked for a real browser pass at phone and desktop size after five green
waves. It found three things, and none of them were visible to any assertion.

**1. "Good morning, The".** The Dashboard greeted the venue by the first word of
"The Lantern Hall". `split(/\s+/)[0]` is right for a person and wrong for an
organisation, and it was a DESKTOP bug too — nothing to do with mobile. Fixed
using `session.kind` as the signal rather than a heuristic: `team_and_crew` and
`agent` name people and get shortened; `operator` (a venue/promoter) and
`performer` (as often a band as a soloist) keep their whole name. The rule comes
from docs/story.md's actor boundaries, which is where product rules belong.

**2. Events and Bills were unreadable on a phone**, and this is the sharpest
example in the whole pass of *correct but unusable*: nothing clipped, nothing
overflowing, the audit honestly green, and the event's own name truncated to
"Ma…" with the date running one character per line. Both are now cards below the
tablet breakpoint. The Bills card drops the Category column, which is a
hardcoded em-dash on every row because the payload has no category — it still
shows on desktop, and the CSS says to delete that rule the day the field exists.

**3. AN INLINE STYLE BEATS A MEDIA QUERY — the first fix silently did nothing.**
The rows carried `display: grid` and `gridTemplateColumns` as inline styles, so
the phone rules never applied and the screenshot came back unchanged. The
truncation had already been moved into CSS for exactly this reason; the
containers themselves were missed. **If a media query appears to do nothing,
check for an inline style on the same property before doubting the selector.**

**4. THE FIRST BREAKPOINT WAS WRONG, AND ONLY A SWEEP SHOWED IT.** 560px was the
guess. Measuring row height 390→1440, both tables still carried an extra wrapped
line at **561 and 640** (h90–91 against a natural h71) — the same unreadable
state, just relocated to where nobody looks. They reach natural height at 720
and hold it at 861, where the sidebar returns and the content column actually
narrows. So the boundary is the structural one, `--breakpoint-tablet: 860px`.
Row height is a good legibility signal precisely because wrapping makes a row
taller: it turns "does this look cramped" into a number.

Desktop proved unchanged by measurement, not by eye: identical resolved grid
tracks (Events `297.719 / 186.078 / 124.047 / 99.2422 / 148.859 / 124.047 /
32px`), cells at identical x positions, zero overflow. Suite 80/0.

### Known gaps — still open
1. **DataTable's pager** left at 30px deliberately: overlays would overlap by
   10px, and spacing them to real 44px targets makes a 9-page pager 508px wide
   — wider than the phone it is meant to help. Needs a narrow redesign, not a
   touch utility.
2. **~134 inline-styled buttons in `apps/web`** are still under 44px on a coarse
   pointer: Calendar's 36×36 month arrows and 24×24 day cells, Contacts' 22×22
   copy buttons, the 28px `SegmentedToggle`. The audit runs `pointer: fine` and
   **structurally cannot see any of this** — measure it with a coarse probe, not
   the suite.
3. Tap-target counts (20–39 per screen) are a work list, not a failure.

### DEPLOYED — 2026-09-01. This section used to say the deploy was blocked.

Production is live and healthy: migrations **27 → 32**, API revision
**`showme-api-00021-9h4`**, web app on `showme-app.web.app`, marketing
deliberately untouched. Kept because the diagnosis was wrong twice.

**THE PASSWORD WAS NEVER BROKEN.** It connected first try once the ADC was
fresh. Both earlier theories in this file were wrong:
- The *secret-version* theory (refuted 2026-08-29 — one version, pinned `latest`).
- **The `$`-in-the-shell theory was ALSO wrong.** The password does contain a
  `$`, and shell interpolation would eat it — but that was never what happened.
- **The real cause was the stale ADC, the whole time.** `cloud-sql-proxy`
  authenticates with Application Default Credentials, which `gcloud auth login`
  does NOT refresh. The proxy could not reach Cloud SQL, and that surfaced as
  `password authentication failed` — an error that reads like Postgres rejecting
  a credential when it is really the tunnel failing to open.

> **An auth error at the end of a tunnel may belong to the tunnel.** This nearly
> cost a rotation of a working production password, and the outage that would
> have caused.

**FOUR credentials expire independently**, and all four were dead:
`gcloud auth login` · `gcloud auth application-default login` (ADC — the proxy)
· `firebase login` for `daniel@showme.music` · and again for
`daniel.islandman@gmail.com`.

**`firebase login --reauth` REPLACES the primary account.** Using it for the
second account evicted the first, and `login:list` then said *"No authorized
accounts"* because `activeAccounts` still pinned this directory to a name whose
credentials were gone. **Use `firebase login:add` for a second account.**

**Migration 0031's guard fired, as designed.** Two dateless `booking_requests`
in production — both Ran's own tests, both terminal, the only two rows in the
table. Deleted in a transaction scoped to `dateless AND terminal AND
public_form`, which would have rolled back had any been live. Zero inbound FKs,
so nothing cascaded. Backup `1788244448191` verified SUCCESSFUL first.

### A PUBLIC ROUTE COULD NOT SIGN AN IMAGE — found in production, fixed same day
`GET /public/profiles/:slug` returned 500: *"The default Firebase app does not
exist."* `initializeApp()` ran as a **side effect of verifying a token**, so
Firebase existed only on authenticated requests; a public route carries none, so
the storage signer's `getStorage()` threw. Now in `lib/firebase-app.ts`,
idempotent, called by both the verifier and the signer.

It hid because `signProfileImageUrls` short-circuits on an empty file list — the
public page was fine until somebody **uploaded** a picture rather than pasting a
URL.

> **A CHECK MADE SECONDS AFTER A DEPLOY CAN ANSWER FROM THE CODE YOU REPLACED.**
> Right after deploying revision 00019 that route returned **200** — served by a
> warm instance of the PREVIOUS revision mid-rollout. Rolling back to 00019
> reproduced the 500 and proved the 200 meaningless.

**Also:** `update-traffic --to-revisions` PINS traffic; every later deploy lands
at 0% until `--to-latest` releases the pin.

### The Mapbox secret is wired — 2026-09-01
Created, and `secretAccessor` granted to
`680839076083-compute@developer.gserviceaccount.com`. **Access is granted
PER-SECRET in this project, not project-wide** — a new secret without its own
binding fails at startup. Wired with `--update-secrets` (never `--set-secrets`,
which replaces the whole set); all six verified present afterwards.
`/api/v1/geocode` returning **401 rather than 503** is the proof the token
reached the process.

### What is left
- **ClickUp** — ~16 commits unrecorded; the board is what Ran sees.
- **Docker VM** holds ~16 GB the host cannot see (Troubleshoot → Purge data).
  Root cause recurs: Testcontainers abandons a volume whenever the port-bind
  flake kills a suite. Safe sweep:
  `docker volume ls -q | grep -E '^[0-9a-f]{64}$' | xargs docker volume rm`
  — never plain `prune`, which also takes the named dev database.
- The open product calls listed earlier in this file still stand.

---

## 9. The five engineering-found bugs — 2026-09-03

The items on the board that Ran never filed: found while verifying his lists, filed,
and then left. All five are closed. Each was a different KIND of invisible: a trap in
code nobody had run, a failure with no way to observe it, a rule that could only be
stated because the API could not express it, a package with nowhere to put a test, and
a screen that shipped as a placeholder.

### 1. A `terraform apply` on prod would have replaced the LIVE TLS certificate
[123qy9rng46](https://app.clickup.com/t/123qy9rng46) · `infra/`

`cert_version` shipped with a default of `"v1"` on 2026-08-23 to force a replacement
that was needed at the time. The certificate then went `ACTIVE` on Google's own retry,
and the now-pointless rename sat in the code for **eleven days**. `name` forces
replacement on a managed certificate, so the next bare `terraform apply` in `envs/prod`
would have taken `api.showme.music` off the air for the 15–60 minutes the new cert
spends provisioning. Not degraded — the whole product, failing TLS.

`create_before_destroy` does not save you. It guarantees the proxy references *some*
certificate; it says nothing about that certificate being valid.

Fixed by making the default `""`, which reproduces the live name `showme-api-lb-cert`,
so `terraform plan` goes quiet. The escape hatch survives, with the rule written into
the module: **bumping `cert_version` is only right when the certificate has ALREADY
failed.** Rotating a healthy one needs an overlap, and the two-apply procedure for that
is in `infra/README.md`. `cert_version` is also now declared as a root variable in
`envs/prod` — the README's `terraform apply -var="cert_version=v2"` had never worked,
because the root module did not declare it.

Also corrected while in there: the README still said Cloud Scheduler lives in
`europe-north1` (it is `europe-west1` — Scheduler exists in neither Nordic region) and
still claimed `Dockerfile.jobs` did not exist.

**Not verified against the live plan.** Terraform is not installed on this machine and
`gcloud` needs a re-auth. Run `terraform plan` in `infra/envs/prod` and confirm it
reports no changes to `module.api_load_balancer` before trusting this.

### 2. File uploads — the bug was that nothing could observe the bug
[86cbaxw0w](https://app.clickup.com/t/86cbaxw0w) · `apps/api/src/lib/config-audit.ts`

The ticket asked whether `FIREBASE_STORAGE_BUCKET` was set in production. It is, and
§4 of this file already said so. The real defect is the class of failure: **nine
integrations degrade silently by design**, and `gcloud run deploy --set-env-vars`
REPLACES the whole set rather than merging it. One deploy that forgets a variable
strips it from a healthy service and nothing errors — email keeps "succeeding" into a
no-op sink, uploads keep returning a URL to nowhere. The only trace is a user, days
later, saying a feature is "missing or non functional". That is precisely how this
ticket started, and it could as easily have been any of the other eight.

So the API now states, once, what each variable buys and what its absence costs:

- **At boot** it logs which subsystems are configured, and in production logs one
  `ERROR` per missing REQUIRED subsystem, naming the variables and the **symptom** —
  "File storage is unavailable. Every upload fails: posters, avatars, banners and rider
  documents." Search Cloud Logging for `configuration INCOMPLETE` after a deploy.
- **`GET /admin/configuration`** serves the same report on demand. Platform-admin only,
  and **presence-only**: it reports that a variable is set, never what it is set to.

It logs and returns; it never exits. A stripped `BREVO_API_KEY` must not take down an
API that is still settling shows correctly.

The rider UI gap folded in as asked: the operator's **Upload button is now ABSENT
rather than disabled**, with a plain line saying riders are submitted by the act on the
bill. The explanation used to live only in a `title` tooltip — no explanation at all on
a touch device, and a broken-looking button everywhere else. The ticket's second UI gap
(a rider rendering "NO FILE") **was already closed**: that rider carries notes, the row
opens to them, and there is an e2e spec for it.

### 3. Participants API — three limits the UI could only apologise for
[86cbazcc7](https://app.clickup.com/t/86cbazcc7) · migration **0037**

1. **`permissionSetId` was optional but not nullable, so access only went up.** A
   collaborator promoted to full control could never be demoted — "standard for the
   role" was a thing the API had no way to be told. Now `.nullable()`. Lowering is
   never an entitlement grant, so `assertGrantAdminAllows` returns early on it: **a
   free plan can always take admin authority away, and only ever pays to hand it out.**
2. **Nothing listed the permission sets, and a participant serialized to a bare id.**
   The roster could only detect "full control" by comparing set ids against the HOST's
   — a comparison of rows, not of authority — and it got the seeded co-host wrong.
   Northlight Presents holds set `c6`, a *different row* carrying an identical
   `operator_full` list, and was labelled "Standard for the role" while having exactly
   the authority that denies. Now there is `GET /events/:id/permission-sets`, and the
   participant carries its set by value (name + capabilities), operator-tier only.
   `ADMIN_GRADE_CAPABILITIES` / `confersAdminAuthority` **moved to `@showme/shared`** so
   the API's entitlement gate and the web app's label read the same list — two copies
   would eventually disagree about who counts as an administrator.
3. **The soft remove discarded the prior status, so there was no honest Restore.**
   `invited`, `accepted` and `confirmed` were flattened into `removed`, and nothing
   could put a row back as it was — so the confirm dialog presented a reversible act as
   a permanent one. Migration 0037 adds `event_participants.status_before_removal`,
   written by the remove and CLEARED by the restore. A column and not the audit log:
   the moment a product feature reads the audit trail, pruning it becomes a breaking
   change.

### 4. `apps/web` had no unit-test runner
[86cbazcf3](https://app.clickup.com/t/86cbazcf3)

`"test": "playwright test"` and no vitest project, so nothing could assert a pure
function — which is how `parseDayLocal` shipped with an unanchored regex that sent a
zoned instant down the date-only branch and named the UTC day rather than the reader's.

Added `apps/web/vitest.config.ts` (node env, `src/**/*.test.ts`, explicitly excluding
the Playwright specs, pinned to `TZ=Europe/Stockholm` so the "reader's day vs UTC day"
distinction can actually fail), a `test:unit` script, a `test:unit` turbo task and a CI
step. `test` still means Playwright for this package, hence a second task rather than a
rename.

The two suites exiled into `apps/api` (`web-format.test.ts`, `money-units.test.ts`) are
home, headers dropped. Backfilled the modules the ticket named: **103 tests** across
`lib/format`, `lib/status`, `lib/moneyUnits`, `components/calendarGrid`,
`components/budgetPlannerView` and `hooks/useEventList` — for which
`eventListQuery` was lifted out of the hook so the filter→query rule (the whole of the
Events screen's filtering) could be asserted without React.

### 5. Settings → Team Access was a shipped "coming soon"
[86cbaxvqk](https://app.clickup.com/t/86cbaxvqk)

Two read-only rows and an empty state. Next to a working per-EVENT invite flow it read
as a broken feature rather than an unbuilt one, which is exactly how Ran reported it.

Almost nothing had to be invented. It is the same `POST /invitations` the event roster
sends, with `type: "profile_member"` and a `targetProfileId`, plus the
`profile_members` routes that have existed since the schema did. The one missing piece
was **`GET /profiles/:id/invitations`** — an invitation writes NO member row until it
is answered, so an owner who had just invited someone saw a list identical to the one
before they asked, with nothing to withdraw and every reason to send it twice.

The screen now shows members (role as a select, remove), pending invitations (with
Withdraw), and an inline invite form. Roles carry a plain-language sentence and say
**before** you choose whether they cost a seat, so running out is a fact met on the way
in rather than a 403 met on the way out.

### How it was verified

- **39/39 live probes** against the booted stack as the real seeded accounts, asserting
  the reason as well as the status and reading rows back in Postgres.
- **A browser pass** through both changed screens: invited and withdrew a teammate,
  demoted the co-host (confirmed `NULL` in Postgres), was refused on re-raising it with
  "Granting admin requires a paid plan" **on the form**, and removed → restored Priya
  Sound, whose menu offered *"Puts them back on this event as confirmed"* and left
  `status_before_removal` null afterwards.
- **One probe lied and was caught.** It asserted the operator gets 403 from
  `/admin/configuration`. The seeded operator carries `users.is_admin = true` — checked
  in Postgres rather than assumed — so 200 was correct and the probe was wrong. Rewritten
  to assert the admin's 200 *and* a performer's 403.

Terraform is the one item with no live verification; see §9.1.
