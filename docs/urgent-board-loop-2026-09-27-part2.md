# Urgent board — the build loop, part 2 (2026-09-27)

Continues `docs/urgent-board-loop-2026-09-27.md`, which closed **item 1**
(`123qy9rpqp0` + `123qy9rpqn0`) in seven commits, `4fa6136` → `b4ba17d`. Same rules: plan
here before building, prove on the running stack, biome + web + API + e2e, commit naming
the ticket, no deploy, no ClickUp writes.

This file carries **item 2** (the outbound invite chain) onward.

---

## Item 2 — the outbound invite chain · `123qy9rnf87` · `86cbcehmp` · `86cbcftg3`

**Verdict: mostly ALREADY BUILT — the 2026-09-04 analysis is stale, and one rung is
missing on both paths a user actually takes.**

`docs/bug-analysis-2026-09-04.md` D1 calls this *"the largest item on the board"* and
scopes it as an epic of six steps. It was right on the day it was written. Since then
`86cbcehmp` has been largely built, and reading the code against the six steps gives:

| Step, in Ran's order | State today | Where |
|---|---|---|
| 1. Inviting a performer moves `draft` → `suggested`, **from the wizard and from Invite Collaborator** | **THE GAP.** The rung exists and fires on a path the web app never calls | `lib/event-status-ladder.ts` · `routes/participants.ts:339` |
| 2. A suggested event arrives as an incoming request, and shows on the performer's calendar | **Built** — `GET /me/event-invitations`, surfaced on Requests, Events and Calendar, with `requestStatus` deciding the tab | `useEventInvitations.ts`, `Requests.tsx:262`, `Calendar.tsx:559` |
| 3. Accept → event becomes `pending` | **Built** — rung 2 fires inside `answerInvitation` | `routes/participants.ts:864` |
| 4. Deal confirmed by all sides → `confirmed` | **Built** | `lib/deal-confirmation.ts:262` |
| 5. Decline → operator notified, **with a note**, and can edit the date to re-issue | **Built, both halves.** The note rides the notification and the activity row; a date change on a `suggested` event puts a `declined` participation back to `invited` and re-notifies | `routes/participants.ts:867-907`, `lib/event-change-requests.ts:430-476` |
| 6. `86cbcftg3` — a change on an agreed night raises a change request | **Substantially built** (`NEGOTIATED_FIELDS` = date · venue · room, with a confirm/decline banner). The audit §5 already records the remaining gap: the same UI in the messages box, and always saying where a change happened and by whom | `lib/event-change-requests.ts` |

**So the epic is one small fix plus a known §5 tail.** This is the audit's own headline
one level down: the board's count is not the work's size.

### The gap, precisely

`advanceEventStatus` has exactly four call sites (checked exhaustively, not by a
truncated grep — the first pass at this missed one to `head` and nearly produced a wrong
plan):

- `routes/participants.ts:339` — `POST /events/:id/participants`
- `routes/participants.ts:483` — `POST /events/:id/participants/off-platform`
- `routes/participants.ts:864` — `answerInvitation` (rung 2)
- `lib/deal-confirmation.ts:262` — rung 3

**Neither path the product actually uses is in that list:**

1. **The wizard.** `POST /events` writes its performers through `joinParticipants`
   (`routes/events.ts:303`) with `status: "invited"` and no ladder call.
2. **Invite Collaborator.** The modal posts `POST /invitations` with a `targetEventId`
   (`useEventCollaboratorInvite.ts:1`, and its own header says so), and that route never
   touches the ladder.

`POST /events/:id/participants` — the one path that DOES fire rung 1 — has **no caller in
`apps/web`** at all.

So, live: an operator invites an act → the event stays **`draft`** → the act accepts →
rung 2 moves it `draft → pending`. The `suggested` state, which is the whole of step 1,
is skipped on every path a person can take.

**The ladder already carries the scar.** `nextLadderStatus` accepts `draft` for
`invitation_accepted` and explains it as legacy: *"every event invited BEFORE this
shipped is sitting at `draft` with live invitations on it (30 of them in production)"*.
That is true, and it is also the symptom — nothing was moving them to `suggested` in the
first place. Fixing rung 1 upstream is what makes that branch a genuine backstop for old
rows instead of the normal case.

### Scope

- **Rung 1 on the wizard's path.** `joinParticipants` fires `performer_invited` once, if
  any joining participant holds a performing role — once, not per performer: the ladder
  is idempotent (forward-only, `draft` → `suggested`) but a loop that calls it per row
  reads as if a second act could move the status again.
- **Rung 1 on the invitation path.** `POST /invitations` fires it when the invitation
  targets an EVENT and its role is a performing one. A co-operator or a crew invite must
  not: the ladder is about the act's answer, which is the same rule
  `PERFORMING_EVENT_ROLES` already states at `participants.ts:338`.
- **Tests**: the rule itself is already exhaustively tabled in
  `event-status-ladder.test.ts`; what is missing is that the two routes CALL it. One test
  per path, each asserting the event's status after the call — plus the negative (a crew
  invite leaves a draft alone), which is the assertion that can actually fail on a
  copy-paste.

**The decision this hides:** whether an invitation that is later **revoked or declined**
should drop the event back to `draft`. **No** — the ladder is forward-only by design, and
Ran's step 5 is explicit that a refusal produces a notification and the operator's choice
of what to do next, not a status change. An event whose only act said no is still an
event somebody is trying to fill, and reverting it would erase that.

---

## Log

*(appended as each piece lands)*
