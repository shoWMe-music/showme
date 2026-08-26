# Event history — completeness and visibility audit

**Date:** 2026-08-26 · **Branch:** `p2-audit-fixes` · **Baseline:** `ea038b0`

The requirement, from the product owner:

> Everything changing in an event should be logged in history and visible to the relevant parties
> with the relevant permissions.

Two requirements in one sentence — **completeness** (every change is recorded) and **visibility**
(each viewer sees what they are entitled to, and nothing more). The 2026-08 settlements meeting
(02:00:57) reinforces it: linking deals and participants to event ids "eliminates the need for
scattered notes by consolidating communications into one location". A history tab that omits half
the changes sends people back to the scattered notes.

This document is the audit of what was actually recorded at `ea038b0`, and what changed on
2026-08-26 to close the gaps.

---

## The two logs, and why there are two

| | `activity_log` | `audit_log` |
|---|---|---|
| Audience | participants, via the Event History tab | compliance / platform admin |
| Written by | `lib/activity.ts` → `writeActivity` | `lib/audit.ts` → `writeAudit` |
| Contents | a curated summary: **which** fields moved, never their values | the full `before`/`after` diff, money included |
| Visibility | derived at read time from `target_kind` + `target_id` (`routes/activity.ts`) | never rendered to a participant |
| `event_id` FK | `ON DELETE CASCADE` — the tab dies with its event | **no FK** — history outlives the row it describes |
| Retention | ordinary data | GDPR "must retain", identity anonymized (`docs/gdpr.md`) |

The same mutation may write both, and most do. **`writeAudit` is not optional and `writeActivity`
is** — an unaudited mutation is a defect; an unhistoried one is sometimes correct, and this document
says which.

### The visibility tiers

Visibility is **not stored on the row**. It is `target_kind` + `target_id`, resolved against the
viewer's *effective capabilities* at read time. Choosing the wrong `targetKind` is the whole risk:
it is a back door around the ceiling `isGrantable()` enforces on the resource itself.

| Tier | Kinds | Rule |
|---|---|---|
| Event-level | `event`, `participant`, `invitation`, `task` | anyone with `event.view` |
| Schedule | `schedule` | `schedule.view` — **not** `event.view` |
| Operator | `hold`, `budget`, `share` | `event.edit` / `budget.view` |
| Party-scoped | `deal`, `settlement`, `transfer` | membership of the target row |
| Participant-scoped | `rider`, `setlist` | `target_id` **is the owning participant id** |
| (all tiers) | — | an operator (`budget.view`) sees every kind on their own events |

The `schedule` precedent is the model for the rest: an entry is kind `schedule`, not `event`,
because a `view_only` participant may view the event yet hold no `schedule.view` — the timeline must
not be the back door into a running order they cannot open. Every kind added below was chosen by
asking the same question.

---

## Job 1 — the audit table

Every mutation route that touches an event or one of its children. **A** = activity, **U** = audit.

### Event itself

| Route | Before | After | Notes |
|---|---|---|---|
| `POST /events` | A + U | unchanged | `event.created` |
| `PATCH /events/:id` | A + U | unchanged | `event.updated` / `event.status_changed`, summary = **changed field names**. A no-op PATCH is audited but not historied — correct. |
| `DELETE /events/:id` | **U only** | unchanged | **Deliberate.** `activity_log.event_id` cascades, so an entry written here would be deleted in the same statement. The trail survives in `audit_log`, whose `event_id` has no FK for exactly this reason. |
| `POST /events/:id/publish` | A + U | unchanged | `event.published` |
| `POST /events/:id/notify` | A + U | unchanged | `event.info_email_sent` |
| `POST /calendar/:id/promote-event` | A + U | unchanged | `event.created` |
| `POST /booking-requests/:id/draft-event` | A + U | unchanged | `event.created` |
| `POST /events/:id/handoff` | A + U | unchanged | `event.handoff` |

### Participants, invitations, crew

| Route | Before | After | Notes |
|---|---|---|---|
| `POST /events/:id/participants` | A + U | unchanged | |
| `POST /events/:id/participants/off-platform` | A + U | unchanged | |
| `PATCH /events/:id/participants/:pid` | A + U | unchanged | |
| `DELETE /events/:id/participants/:pid` | A + U | unchanged | `status = 'removed'`, never a hard delete — history survives removal. |
| `POST /invitations` | A + U | unchanged | |
| `POST /invitations/:token/accept` | A + U | unchanged | |
| `POST /invitations/:token/decline` | A + U | unchanged | |
| `POST /invitations/:token/claim` | **U only** | **A + U** | **GAP CLOSED.** A handoff invitation carries `target_event_id`: the off-platform stub the operator typed in has just been taken over by the real person. Everyone on the bill has been dealing with that row. Kind `invitation`. The audit entry was also missing its `eventId` — added. |
| `POST /events/:id/groups` | A + U | unchanged | `group.assigned` |
| `DELETE /events/:id/groups/:gid` | A + U | unchanged | `group.unassigned` |
| `POST /groups/:gid/profiles` | **neither** | **U** | **GAP CLOSED (audit).** An **unaudited mutation** — the one found in this sweep. It decides which events a crew group may later be assigned to, so it is an authority change. No activity: it touches no event. |
| `DELETE /groups/:gid/profiles/:pid` | **neither** | **U** | Same. |

### Schedule

| Route | Before | After | Notes |
|---|---|---|---|
| `POST/PATCH/DELETE /events/:id/schedule[/:sid]` | A + U | unchanged | Kind `schedule`. The precedent every other tier decision follows. |

### Deals

| Route | Before | After | Notes |
|---|---|---|---|
| `POST /events/:id/deals` | A + U | unchanged | |
| `PATCH /deals/:did` | **U only** | **A + U** | **GAP CLOSED.** The terms could move under a party who had already confirmed and nothing in the feed said so. `deal.updated`, summary = **term names only** (`guaranteeAmount`, `splitBasisPoints`…), never the figures. A PATCH that moved nothing writes no row. |
| `POST /deals/:did/send` | A + U | unchanged | |
| `POST /deals/:did/confirm` | A + U | **enriched** | See "consent moments" below. |
| `POST /deals/:did/reopen` | A + U | unchanged | |
| `DELETE /deals/:did` | **U only** | **A + U** | **GAP CLOSED, with a caveat.** `deal_parties` cascades with the deal, so the party-scoped read can no longer resolve who the parties were: the entry lands for the **operators only**. The full record, parties included, is in `audit_log`. |

### Budget

| Route | Before | After | Notes |
|---|---|---|---|
| `POST /events/:id/budgets` | **U only** | **A + U** | **GAP CLOSED.** `budget.created` |
| `PATCH /events/:id/budgets/:bid` | **U only** | **A + U** | **GAP CLOSED.** `budget.assumptions_updated` — the projected margin the co-promoters decide on. |
| `POST /events/:id/budgets/:bid/lines` | **U only** | **A + U** | **GAP CLOSED.** `budget.line_added` |
| `PATCH …/lines/:lid` | **U only** | **A + U** | **GAP CLOSED.** `budget.line_updated`, summary = field names |
| `DELETE …/lines/:lid` | **U only** | **A + U** | **GAP CLOSED.** `budget.line_removed` |

Six mutations, all audited, none in the history — the largest single gap, and the one the meeting
cares about most.

Two design points:

- **Kind `budget`, not `budget_line`.** A line has no access rule of its own: it is reachable
  exactly when its budget is. The line id travels in the summary so the entry still names what moved.
- **A `private` budget writes NO activity at all.** Kind `budget` is the *operator tier*, and a
  private budget is one operator's own margin work, visible to its owning profile alone
  (`visibleBudgetFilter`). An entry would hand it to every co-promoter holding `budget.view` —
  precisely the competitor the private scope exists to keep out. The feed has no owner-scoped tier,
  so the honest answer is silence in the feed and a full record in `audit_log`, which is admin-only.
  *This is a known incompleteness, chosen over a leak.*

### Settlement

| Route | Before | After | Notes |
|---|---|---|---|
| `POST /events/:id/settlement/compute` | **U only** | unchanged | **Deliberate.** A recomputation, not a decision: it derives settlements from budget lines and deals, each of which now writes its own history. An entry here would say "the numbers were recalculated" after every budget keystroke. Recorded in `audit_log`. |
| `PATCH /events/:id/settlements/:sid` | A + U | **enriched** | `settlement.overridden` said only `{overrideCount}`. Now names **which lines** moved, by label — an override is the operator reaching into somebody else's money, and "something was corrected" is not an answer. Still no amounts. |
| `POST …/settlements/:sid/confirm` | A + U | **enriched** | See below. |
| `POST /events/:id/settlement/finalize` | A + U | unchanged | Kind `event` — finalizing is the moment the figures and the FX stop moving, which is news to everyone on the bill even though what each is owed is not. `lockedRates` are in the audit entry. |
| `PATCH /events/:id/transfers/:tid` | A + U | unchanged | Commission transfers are excluded at the **write** side, not filtered at read — decisions #14. |

### Riders, setlists, tasks

| Route | Before | After | Notes |
|---|---|---|---|
| `POST /profiles/:id/riders` | **U only** | unchanged | Correct — a **library** rider carries no event. Profile work, not event history. |
| `POST /events/:id/riders` | **U only** | **A + U** | **GAP CLOSED.** `rider.attached`, kind `rider`, `targetId` = the **submitter's participant id**. |
| `DELETE /events/:id/riders/:rid` | **U only** | **A + U** | **GAP CLOSED.** `rider.removed` — withdrawing a requirement the operator may already have catered for. |
| `PUT /events/:id/setlists` | **U only** | **A + U** | **GAP CLOSED.** `setlist.updated`, `targetId` = the author's participant id. Summary carries the **song count**, never the titles — the titles are the artistic content itself. |
| `POST …/setlists/:id/shares` | **U only** | **A + U** | **GAP CLOSED.** `setlist.shared` — a read grant on the act's own content. |
| `DELETE …/setlists/:id/shares/:pid` | **U only** | **A + U** | **GAP CLOSED.** `setlist.unshared` |
| `POST /tasks` (with `eventId`) | **U only** | **A + U** | **GAP CLOSED.** `task.created`, kind `task` at the `event.view` tier — the literal gate on `GET /tasks?eventId=`. A personal or profile task writes **nothing**. |
| `PATCH /tasks/:id` | **U only** | **A + U** | **GAP CLOSED.** `task.completed` / `task.reopened` get their own type — "is the backline booked yet?" is the question the list exists to answer. |
| `DELETE /tasks/:id` | **U only** | **A + U** | **GAP CLOSED.** `task.deleted` |

Why `rider` and `setlist` needed a **new tier** rather than an entry in `ACTIVITY_KIND_CAPABILITY`:
their resources are scoped by *ownership*, not by a capability. `scopedEventRiders` shows a rider to
its submitter, to the operators, and to crew only within their **sponsor's** reach. No single
capability reproduces that — and note the trap: `rider.view` is carried by `crew_technical` and by
**no performer at all**, so gating on it would have shown a performer's own rider to the technical
crew and not to the performer. `targetId` therefore holds the owning `event_participants.id`, which
is never hard-deleted, so the history outlives both the rider and the participant's involvement.

The two reach-based cases (sponsored crew, an explicit setlist share) get **no feed row** rather
than a wrong one — deny-by-default, the direction the rest of the module already fails in.

### Not event history (verified, no change needed)

| Route | Why |
|---|---|
| `POST /files/upload-url`, `DELETE /files/:id` | `files` has **no `event_id`**. A file becomes event content only by being pointed at from a rider, and the `rider.attached` entry carries that. |
| `POST /calendar`, `PATCH /calendar/:id`, `PATCH /calendar/:id/availability`, `DELETE /calendar/:id` | `calendar_items` has **no `event_id`** — personal/profile availability. Only `promote-event` reaches an event, and it is historied. |
| `POST /invoices`, `POST /invoices/:iid/issue`, `PATCH /invoices/:iid` | Optionally event-**linked**, but an invoice is one party's billing document between that party and its counterparty, and every field on it is money. Audited with `eventId`. See "left open" below. |
| `POST /events/:id/messages` | Messages are their own surface with their own visibility model (thread-scoped, `resolveThreadAccess`) plus a realtime channel and notifications. Duplicating them into the feed would need a thread-scoped tier and would double every conversation. |
| `POST /groups`, `PATCH/DELETE /groups/:gid`, group **members** | Profile-level crew templates. The event-side consequence is `group.assigned`. |
| `POST /booking-requests`, `PATCH`, `/offers`, `/flag-spam`, `/counter-offer` | **Pre-event.** No event exists yet; they carry their own notification types. |
| `POST /shares/:token/otp` · `/verify` | Link-holder authentication mechanics, not a change to the event. |

---

## Job 2 — summaries that are too thin to be legible

> "`event.updated` with no indication of what changed is technically a log entry and practically
> nothing."

The API side was **better than feared**: `event.updated` already carries `{fields: ["capacity",
"title"]}` via `changedFieldNames`, and deliberately omits the values (an event's `extras` is the
operator's guest list). The same discipline runs through `schedule`, `participant` and `hold`.

**The real defect was on the read side, and it was total.**

`EventHistoryTab`'s `describeActivity` looked for `summary.title`, `summary.message` and
`summary.lines`. **No writer in the codebase has ever produced `message` or `lines`.** Every
summary the API carefully assembled — the changed field names, the status transition, the role, the
hold rank — was read, found not to match, and thrown away. Every row rendered as a humanized copy of
its own type string and **zero** detail lines. The two writers that do emit a `title` key emit the
*event's* title, which surfaced as the headline ("Rock Night") instead of "Event created".

So the requirement failed at the last inch: the data was complete and legible in Postgres and
illegible on screen.

**Fixed** in `apps/web/src/components/EventExtraTabs.tsx`:

- `ACTIVITY_TITLE` — an explicit headline per activity type (~50 entries). An unlisted type falls
  back to a humanized version of its own name, so a new API entry appears in the timeline the day it
  ships rather than waiting for the map.
- `activityDetailLines` — a **curated** read of the summary: subject name, `from → to`, `Changed:
  …`, role, times, rider type, the confirmation rollup, "Terms frozen at this confirmation", reason,
  "Via an external share link". Deliberately curated rather than a dump of every key, for two
  reasons: the summaries carry participant and row uuids that mean nothing to a reader, and the API
  keeps money out of a summary *on purpose* — a renderer that blindly printed whatever arrived would
  be one careless writer away from putting a guarantee in front of a `view_only` participant.
- `HISTORY_ICON` now has an entry for **every** kind the API can write (it had four).

The humanizer moved out of `EventExtraTabs.tsx` into a pure, React-free
`apps/web/src/components/eventHistory.ts`. It is the half of the tab with rules in it, and the rules
are worth reading — and checking — without a component around them. The tab adds **no** visibility
logic of its own: it renders what `GET /activity` gives it, which is why there is exactly one place
where "who may see this" is decided.

### What the tab actually renders now

Driven through the real routes against a real Postgres, read back through `GET /activity`, and piped
through the real humanizer — the operator's view of one event:

```
Event created                     | Status: Draft
Event details changed             | Changed: title, capacity
Event status changed              | Draft → On hold
Schedule item added               | Load-in · 2026-10-01 17:00:00
Task added                        | Hire the PA · Due 2026-09-20
Budget created                    | Shared budget
Budget line added                 | Bar take · Revenue
Budget line changed               | Bar take · Changed: amount
Rider submitted                   | Green room · Hospitality rider
Setlist updated                   | 2 songs
Deal created                      | Fee
Deal terms changed                | Fee · Status: Draft · Changed: guaranteeAmount
Agreement sent for confirmation   | Fee
A party confirmed the agreement   | Fee · Status: Sent · 1 of 2 parties confirmed
Agreement confirmed by all parties| Fee · Status: Confirmed · 2 of 2 parties confirmed ·
                                    Terms frozen at this confirmation
```

Before this change, **every one of those fifteen rows** rendered as a bare humanized type string with
no second line — ten of them did not exist at all. Note what is *not* in any line: `240000`,
`350000`, the song titles. The API never wrote them, and the renderer would not print them if it had.

Running that probe is also how two remaining thin spots were caught: `event.created` carries
`{status}` and `budget.created` carries `{scope}`, and neither was being read. Both now render, and
the redundant `Changed: status` beside a `Draft → On hold` arrow is suppressed.

---

## Job 3 — the read side, three viewpoints

Verified against the running stack and pinned in `apps/api/src/activity.test.ts`.

| Entry | Operator (`host`) | The party it is about | A bystander on the same event |
|---|---|---|---|
| `budget.*` | sees all | — | **nothing** (no `budget.view`) |
| `budget.*` on a **private** budget | **nothing** | — | **nothing** |
| `rider.attached` / `rider.removed` | sees all | submitter sees it | **nothing** — the other act on the bill |
| `setlist.updated` | sees all | author sees it | **nothing** |
| `task.*` (event-scoped) | sees all | — | **sees it** — crew hold `event.view`, which is the gate on the task list itself |
| `task.*` (personal) | no event, no row | — | — |
| `deal.updated` | sees all | party sees it | **nothing** |
| `deal.party_confirmed` / `deal.confirmed` | sees all | party sees it | **nothing** |
| `hold.ranked` | sees it | — | a `co_host` with a `view_only` set sees **nothing** |
| `schedule.*` | sees it | — | a `view_only` participant sees **nothing** |

**A performer cannot learn the venue's margin from a history entry.** Three independent barriers,
each verified:

1. `budget.*` is the operator tier — a performer holds no `budget.view` and the feed returns nothing.
2. No amount ever enters a summary, at any tier. Asserted directly: the test edits a line from
   `150000` to `180000` and asserts the string `180000` appears in no summary on the event, only the
   field *name* `amount`.
3. A private budget writes no feed row at all.

The same holds for deal terms: `deal.updated` names `guaranteeAmount` as a field that moved and the
test asserts `600000` appears nowhere in the summary.

---

## Consent moments — is "who agreed to what, and when" reconstructable?

Reported rather than assumed, as asked. Four consent moments exist.

### 1. Deal confirmation, in-app (`POST /deals/:did/confirm`) — **now yes**

**Was:** summary `{name, agreementStatus}`. With three parties, three `deal.party_confirmed` rows
were **indistinguishable**. Worse, the actor is not always the party: a delegated performer hands
`agreement.confirm` to their agent, so `actor_profile_id` is the agent while the party that became
bound is the performer. The feed said "somebody confirmed something".

**Now:** the summary carries `confirmedCount` / `signatoryCount` — "1 of 2 parties confirmed" — and
`termsFrozen`, whether *this* signature was the one that froze the terms. The **audit** entry carries
`confirmedParticipantIds`: exactly which party lines the signature stamped.

That split is deliberate, and it was corrected mid-session after a collision (see "A note on ids in
summaries" below). Together — feed rollup, `actor_display`, the deal's own party list, and
`deals.confirmed_snapshot` — the moment reconstructs: **who** acted, **who** was bound, **when**, and
**to what**.

### 2. Settlement confirmation (`POST …/settlements/:sid/confirm`) — **now yes, forensically**

**The structural gap:** `settlement_approvals` holds only `{event, participant, approved,
approved_at}`. It has **no `confirmed_snapshot`** the way a deal does, no `approved_by`, and the
figures stay editable right up to finalize. So the row alone answers "who clicked approve at time T"
and cannot answer "what were they approving" — that could only be re-derived by replaying every
budget-line audit row up to the timestamp.

**Closed without a migration:** the audit entry now carries `before: serializeSettlement(settlement)`
— the settlement *as the party was looking at it*, overrides included, frozen into
`audit_log.changes` in the same transaction as the signature. That is the record a dispute needs, and
it costs nothing but a serialization. The activity summary stays human: `{approved,
settlementStatus}`, with `actor_display` naming the signer.

**Still recommended (schema, another agent's territory):** give `settlement_approvals` an
`approved_by` user column and a `confirmed_snapshot` jsonb, matching `deals`. The audit entry is a
faithful record but it is a *forensic* one — the party who signed cannot see what they signed.

### 3. Deal confirmation via an off-platform share link (`POST /shares/:token/approve`) — **two defects, NOT closed**

`routes/shares.ts` is another agent's file this session. Reported, not touched:

- **The off-platform signature never freezes the snapshot.** The in-app route rolls up the parties
  and, when the last non-observer signs, sets `agreementStatus = 'confirmed'` and writes
  `confirmedSnapshot = freezeSnapshot(...)`. The share route stamps the caller's own
  `deal_parties.confirmed_at` and stops. A deal whose final signature arrives by share link is
  **fully signed with no frozen terms** — exactly the record a dispute needs.
- Its `writeActivity` summary is `{name, via: "share"}` — no `confirmedParticipantIds`, so it has the
  same "somebody confirmed something" problem the in-app route just had. Also note it does not stamp
  `deal_parties.confirmed_by` (there is no principal), so the signer's identity lives **only** in
  `audit_log.changes.after.offPlatformEmail`.

### 4. Settlement approval via a share link — **a visibility bug, NOT closed**

Same file. It writes:

```ts
await writeActivity(tx, request, {
  type: "settlement.approved",
  targetKind: "settlement",
  targetId: party.participantId,   // ← a PARTICIPANT id
  summary: { via: "share", partyRole: party.role },
});
```

`routes/activity.ts` resolves the party-scoped `settlement` kind against
`viewerSettlementIds` — **`settlements.id` values**. A participant id is never in that list, so the
row is visible to **operators only** and **invisible to the very party who gave the approval**. Two
one-line fixes for whoever owns the file: pass the settlement row id, or move the kind to the
participant-scoped tier now available in `lib/activity.ts`.

There is also a **naming split**: `settlement.approved` (share link) and `settlement.confirmed`
(in-app) are two names for one consent moment. The web humanizer renders both to the same headline
so the timeline reads consistently, but the types should be unified at the source.

### A note on the second audit mechanism

`shares.ts` defines its own `writeOffPlatformAudit` rather than calling `writeAudit`. This is
**justified**, not a divergence: an off-platform signer has no principal, and `writeAudit` throws
without one. It writes to the same `audit_log` table with `actor_user_id = null` and the recipient's
email in `changes.after.offPlatformEmail`.

---

## A note on ids in summaries (a defect found and fixed mid-session)

The first version of this work put `participantId` into the `settlement.confirmed` and
`settlement.overridden` summaries, and `confirmedParticipantIds` into `deal.confirmed`. That was
wrong twice over, and the second reason is the interesting one.

**It broke a safety guard, non-deterministically.** `settlement.test.ts` asserts that no activity
summary matches `/\d{5,}/` — the guard that stops a money figure reaching a summary line a party
without `budget.view` can read. A random uuid contains five consecutive digits roughly half the time
(`…75053…`), so the suite became a coin flip. It passed on one run and failed on the next; the full
suite went 750/750 green on a lucky draw.

**The right fix was to remove the ids, not to loosen the guard.** Loosening a rule until the new
code fits is how a real amount gets in six months later. And the ids should not have been there
anyway: the tab's own renderer deliberately skips uuids because they mean nothing to a reader, so
these were values the only consumer would never display — dead weight that broke a safety net. The
information was never lost:

| Question | Answered by |
|---|---|
| Who performed the act? | `activity_log.actor_display` — a **name** |
| Which settlement? | `activity_log.target_id` — where an id belongs |
| Which party line was bound? | `deal_parties.confirmed_at` (readable by every party via `serializeDeal`) and `audit_log.changes.after.confirmedParticipantIds` |
| What were the figures at signature? | `audit_log.changes.before` — the settlement as the signer saw it |

**A summary is for people; ids are for the trail.** Ids that *are* human-useful stay — `lineId` next
to a label, `riderId` next to a name — but nothing is now carried that the renderer will not show.

The guard itself was left untouched and is now **stronger**: `activity.test.ts` adds
`expectNoMoneyFigure`, which walks the summary's *values*, skips uuid-shaped strings, and then looks
for a money-sized figure — asserting "no money" rather than "no run of five digits". Ids remain
legitimate in a summary (`participant.added` has carried `profileId` since it was written) and money
remains forbidden, which is what the rule always meant.

## Left open

| # | Gap | Why not closed here |
|---|---|---|
| 1 | Off-platform deal confirmation does not freeze `confirmed_snapshot` | `routes/shares.ts` — another agent live in the file. **The most serious item on this list.** |
| 2 | `settlement.approved` from a share link is invisible to its own party | `routes/shares.ts`. |
| 3 | `settlement.approved` vs `settlement.confirmed` — one moment, two type names | `routes/shares.ts`. |
| 4 | `settlement_approvals` freezes no snapshot and records no `approved_by` | Schema change (`packages/db`) — needs a migration. Mitigated forensically above. |
| 5 | A **private** budget writes no history for its own owner | Needs an owner-scoped feed tier. Chosen incompleteness over a leak to a co-promoter. |
| 6 | `deal.deleted` reaches operators only | `deal_parties` cascades, so the party link is gone before the feed can resolve it. Would need `ON DELETE SET NULL` or a soft delete — a schema decision, and arguably a deal should be soft-deleted for the same reason a participant is. |
| 7 | Event **invoices** write no history | An invoice is between two parties and every field is money; it would need a party-scoped `invoice` kind. Worth doing, but a design decision rather than a missing call. |
| 8 | `POST /shares/:token/comment` writes neither log | `routes/shares.ts`. An off-platform party commenting on a settlement leaves no trail at all. |
| 9 | Event **messages** are not in the feed | Deliberate today (own surface, own visibility model). Revisit if the meeting's "one location" goal means the timeline should show that a conversation happened. |

---

## Gates

- `pnpm turbo run typecheck` — **14/14 clean**.
- `pnpm biome check apps packages` — **502 files, clean**.
- `cd apps/api && pnpm vitest run` — 689 at `ea038b0`, **750+ after** (other agents landed work in
  the same window). Seven new tests in `src/activity.test.ts`, no regressions.
- The money guard (`settlement.test.ts`, "never an amount") run **six times consecutively** — green
  every time. That is the check that matters, because the failure it was showing was a coin flip on
  random uuids, and one green run proved nothing.
