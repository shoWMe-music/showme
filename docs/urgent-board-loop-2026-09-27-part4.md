# Urgent board loop — 2026-09-27, part 4

Continues `docs/urgent-board-loop-2026-09-27-part3.md`. Same rules: the plan is written
here **before** the build, each entry names the file that settles the ticket, the verdict,
the scope and any decision hiding inside it. Read-only on ClickUp; nothing is deployed.

## `123qy9rpdup` (half 2 of 2) — cancel with a reason, and the delete ladder

**Verdict: decision, already taken — `decisions.md` #25.3 — then ordinary work.** The
ticket asked for cancel-then-delete *at any status*; `lib/event-delete.ts` refused
anything with another party, a confirmed agreement, a settlement or an invoice. #25.3
splits them on **whether money exists**, and that is the rule being built:

- **No settlement and no invoice** → Ran's ladder. Cancel first, with a reason, sent to the
  collaborators; then delete, notifying every party. The other-party and
  confirmed-agreement clauses **give way**: cancelling is the notification.
- **A settlement or an invoice exists** → deletion stays permanently refused. Archive only.

### Which files settle it

| File | What changes |
|---|---|
| `apps/api/src/lib/event-delete.ts` | `assertEventIsDeletable` takes the event's `status`; clauses 2 (other parties) and 3 (signed agreement) give way on a cancelled show; clause 6 accepts **cancelled OR archived** |
| `apps/api/src/routes/events.ts` | the PATCH accepts `cancellationReason`, writes it into the `event.status_changed` activity, and notifies the bill |
| `apps/api/src/routes/events-list.ts` | the DELETE notifies every party **before** the tree goes |
| `apps/web/src/components/EventCancelModal.tsx` | new — the reason is asked for, not assumed |
| `apps/web/src/hooks/useEventRowActions.tsx` | renamed from `useEventArchive`; "Cancel show…" in the row menu, delete offered on a cancelled show too |
| `apps/web/src/components/useEventInlineFields.ts` | the Status row's "Cancelled" asks for the reason instead of saving |

### Scope, and the three judgements inside it

**1. Where the reason lives: the activity row, not a new column and not `extras`.**
`components/eventHistory.ts` *already* renders `Reason: …` from any activity summary
carrying a `reason` key — the Event History tab needs no change at all. The activity row is
also the right shape: immutable, access-filtered by `GET /activity`, and written in the
same transaction as the status move. `events.extras` was the other candidate and is the
wrong one — it is client-supplied wholesale on every PATCH, so a stamp there is both
**forgeable** and **losable** on the next save. No migration, and no fourth pending one.

**2. The reason is required by the DIALOG, optional at the API.** Its whole purpose is to
be sent, so the confirm button stays disabled while it is blank — the same rule
`DealReopenModal` already follows. But the API must not refuse a cancel for want of prose:
a cancelled show is a fact about the world, and a 400 there would leave the event standing
as live. So the field is optional in `UpdateEventBody`, and a cancel with no reason still
cancels and still notifies — the notification simply says none was given.

**3. One mechanism, at the place the status actually moves.** Not a `POST
/events/:id/cancel`: `PATCH { status: "cancelled" }` already exists and will not stop
existing, so a second route would mean two ways to cancel and only one of them speaking.
The notify therefore hangs off the transition the PATCH already computes
(`before.status !== "cancelled" && after.status === "cancelled"`), which is the same
argument `notificationDestination.ts` makes for deriving at read time: a rule applied where
the fact is cannot be forgotten by a caller.

Capability: `event.edit`, unchanged — that is the power that could already cancel a show
through the PATCH, and making cancel *stricter* than the thing it replaces would be a new
restriction nobody asked for. Deleting still requires being the profile operating the show.

### The trap in "notifying every party"

**`notifications.event_id` references `events` with `ON DELETE CASCADE`**
(`packages/db/src/schema/comms.ts:39`). A "this show was deleted" notification that carried
its `eventId` would be **destroyed by the very delete it announces** — written, then swept
away microseconds later inside the same request, leaving every party silently uninformed
and a green test suite. So the delete notification carries **no `eventId` and no link**:
the title is in the body, and `/events/<id>` is a route that now 404s. It is the one
notification in the app that deliberately leads nowhere.

Recipients come from `eventParticipantRecipients` — the built mechanism for "everyone on
this event, minus the actor" — read **before** `deleteEventTree` removes the participant
rows it reads from.

### Not built, deliberately

A "Cancelled because…" banner on the Event screen. The reason is on the History tab the
day this ships, and the notification puts it in front of exactly the people #25.3 names.
A banner is a design question for a screen whose header is already carrying the status
chip, the date and the venue — and `86cbcn1q4` (the event-screen redesign) is blocked on
`/design-login`, so a banner placed now would be placed twice.

### Built — and the four things driving it taught

**1. The confirm dialog was carrying the old rule.** Its second paragraph read *"If
anyone else is on the bill, or the show has a signed agreement, a settlement or an
invoice, it stays where it is"* — true before #25.3 and a false promise after it, since
neither clause refuses a cancelled show any more. Found by opening the dialog rather
than by reading the diff. It now says what still refuses (money) and what now happens
instead (the parties are told).

**2. The `event.cancelled` notification for a show that is later deleted is gone — and
that is correct.** Measured on the running stack: the five bells raised by cancelling
*Marlo Vance — Album Release* are in the database; the one raised by cancelling *Nordic
Synth Showcase* is not, because that event was then deleted and `notifications.event_id`
cascades. The `event.deleted` row beside it survives, carrying `event_id = NULL` and no
link. This is the trap the plan predicted, confirmed from both ends by the same run.

**3. A settlement row exists on a show whose list column says "Not started".** Deleting
the cancelled *Marlo Vance — Album Release* was refused 409 with *"has a settlement on
it, which is the financial record of the night"* — while the Events list showed its
settlement as **Not started**. Both are right: the clause is "a settlement row exists",
deliberately one step stricter than "finalized" (its own comment says so), and the column
reports the row's STATUS. Worth writing down because it looks like a contradiction on
screen, and the refusal is the thing that is load-bearing.

**4. The inline Status field was a second, silent way to cancel.** `EVENT_STATUS_OPTIONS`
offers "Cancelled" on the Event Information card, so with only the row menu wired the same
act would have asked for a reason in one place and sent none from the other — the exact
two-paths-one-speaking failure the plan rejected a `POST /cancel` route to avoid. The
inline commit now holds a chosen "Cancelled" and raises the same dialog.

### Proven live (`operator@`, restarted stack)

| Step | Result |
|---|---|
| Row menu, confirmed show | **Cancel show…** · Archive — no delete offered |
| Cancel dialog | confirm **disabled** until a reason is typed |
| Cancelled *Marlo Vance — Album Release* | `status=cancelled`; activity summary carries `reason`; **5 parties** notified (performer.a, performer.b, professional, co.host, agent) with the reason as the body |
| Row menu, cancelled show | Cancel entry **gone**, **Delete permanently…** now offered |
| Delete *Winter Gala* (cancelled, never archived) | **deleted** — clause 6 gave way |
| Delete *Nordic Synth Showcase* (cancelled, a performer on the bill) | **deleted**; the performer's `event.deleted` bell **survived**, `event_id` NULL, no link |
| Delete *Marlo Vance — Album Release* (cancelled, has a settlement) | **409**, naming the settlement — money does not give way |

Mutation-checked, each one printing that it matched: `cancelled = false` in the ladder →
4 red · `eventId: id` on the delete notice → the survival test red · dropping
`before.status !== "cancelled"` → the re-send test red · dropping the
`after.status === "cancelled"` gate on the reason → the wrong-transition test red.

Suites: biome 712 clean · api **1323** (10 new; `external-calendar.test.ts` lost to the
Testcontainers port-bind flake and green when run alone) · web 330 · e2e **112**.
