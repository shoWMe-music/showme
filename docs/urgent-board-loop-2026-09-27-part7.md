# Urgent board loop — 2026-09-27, part 7

Continues `docs/urgent-board-loop-2026-09-27-part6.md`. Same rules; read-only on ClickUp,
nothing deployed.

## `123qy9rng56` — the two quick-action menus

**Verdict: real, and half of one of them shipped this morning.** Ran asks for two things:

**A — a ⋮ at the top right of the event manager**, offering Delete Event, Archive Event,
Duplicate, Make recurring, Share event link. **There is no ⋮ there at all.**

**B — quick actions in the event list**, offering Publish/Un-publish, Settlement, Invite
collaborator, Print event details, Delete, Archive. The row menu exists and carries
**Archive, Delete permanently… and Cancel show…** — the last two built today for
`123qy9rpdup` and QA4-9.

### What this builds, and what it does not

| Ran's item | Where | Verdict |
|---|---|---|
| Archive / Delete (list) | row menu | **already there**, capability-gated since QA4-9 |
| **Publish / Un-publish** (list) | row menu | **built** — the row already carries `published`, `status` and `capabilities`, which are the three facts the decision needs |
| **Settlement** (list) | row menu | **built** — a navigation, nothing more |
| **Archive / Delete / Share event link** (manager) | new ⋮ | **built** — the same hook the list row uses, plus one entry that copies the public link |
| Invite collaborator (list) | — | **not built.** The invite flow is a modal with its own state, permission-set picker and credit gate. It already exists as a button in the event manager's header, two clicks from the row |
| Print event details | — | **not built.** There is no print sheet for an event anywhere in the app. A design question, not a menu entry — same verdict as on the calendar popover |
| **Duplicate** | — | **not built, and it is a feature.** *"creates a draft with the same details — without the collaborators or performer — opens a calendar with 'Select date to duplicate this event to'"*: a copy rule (which fields travel, which deliberately do not), a date-picking flow, and a new event. Nothing in it is small |
| **Make recurring** | — | **not built, and it is a bigger feature.** *"with a recurring event logic and flow UI"* — a recurrence model the schema has no column for, and the whole question of what a series IS (one event repeated, or N events that know about each other) |

**So: the four cheap ones, and four recorded refusals with their reasons.** Duplicate and
Make recurring are the two items on this ticket that deserve their own tickets; they are
listed beside five one-liners, which is exactly the shape the audit warns about.

### Which files settle it

| File | What changes |
|---|---|
| `apps/web/src/components/usePublishToggle.ts` | renamed from `useCalendarPublishToggle` — two callers now, so the name stops naming one of them |
| `apps/web/src/hooks/eventRowMenu.ts` | two more keys, and the rules for them |
| `apps/web/src/hooks/useEventRowActions.tsx` | the entries, and an `onDeleted` hook for the screen that is standing on the thing it just deleted |
| `apps/web/src/routes/EventDetail.tsx` | the ⋮ in the header |

### The one judgement

**Deleting from the event MANAGER has to navigate away.** The list can refresh in place; a
workspace cannot — its event is gone, and every query on the page will 404 in turn. So the
hook takes an optional `onDeleted`, and the manager passes a navigation back to `/events`.
Without it the operator would watch their own screen fall apart one card at a time.

### Built

`useCalendarPublishToggle` became **`usePublishToggle`** the moment the second caller
arrived — an hour after it was written for the calendar popover. Both surfaces want the
same thing: one press, no form, the lists refreshed after.

**The list row menu now reads** (for an operator on a confirmed, published show):
`Unpublish · Settlement · Cancel show… · Archive`, and on a cancelled one
`Settlement · Archive · Delete permanently…`.

**The event manager has its ⋮**, drawing the SAME five entries from the same hook plus
`Share event link`. Two rules decide what appears, and both mirror the server:

- **Publish** needs `event.publish` AND either `published` already or a `confirmed`
  status — A-22 means only a confirmed show has a public page, so an already-public
  concluded night can still be taken down while a pending one is offered nothing.
- **Settlement** needs `settlement.view.own`, the floor every party holds. Without it the
  reader would land on a 403.

Ten tests on the pure rule, including a case that walks every status against publish.

**Two bugs this turn found by driving it, neither visible to the typecheck or the suites:**

1. **"Rendered more hooks than during the previous render."** I put `useEventRowActions`
   and `useToast` *below* `EventDetail`'s `isPending` / `isError` guards, so the first
   render returned before reaching them and the second did not. The page died on open.
   Hooks live above the guards now, with the reason written beside them.
2. **A lint error a pipe hid.** `biome check .` ran in the same command as the test suite
   and its output was cut by `tail -2` — the exact trap `CLAUDE.md` documents about pipes
   hiding a failing run. `useEventRowActions` was missing `onDeleted` from a dependency
   list; found by re-running biome on its own, fixed at the cause (destructured at the
   parameter, so the dependency is the callback rather than a fresh object each render).

Proven live as `operator@`: both menus render as above; **Settlement** navigates to
`/events/<id>/settlement`; **Share event link** toasts *"Link copied"*.

Suites: biome 725 clean · web **368** (2 new) · e2e 112.

## `86cbcftg3` — the last sentence of it

**Verdict: substantially built, and the messages-box half is built too.** The audit named
two gaps; one closed in an earlier session. `NEGOTIATED_FIELDS` is date/venue/room —
exactly the three Ran named — with a Confirm/Decline banner, and `MessagesTab` already
mounts that banner above the thread, citing his *"such things and UI should also be in the
messages box as well"* verbatim.

**What is left is his final sentence:** *"And the system should always notify the users of
any change — where it happened and by who."*

Today a PATCH that moves the **door time**, the **capacity**, the **curfew** or the
**notes** writes an activity row and **tells nobody**. The only field with a notice of its
own is the title, and even that goes to the host profile alone.

### One mechanism, replacing two

`event.renamed` is deleted, not kept alongside. It exists because a co-host renaming the
host's show was invisible; a general "what changed" notice covers that case **and** the
four it never covered — a performer whose show was renamed was never told at all, because
the notice was addressed to the host profile only. Keeping both would send two
notifications for one act.

| File | What changes |
|---|---|
| `apps/web/src/lib/…` → no, API side: `apps/api/src/lib/event-change-notice.ts` | **new** — which fields are announced, and the sentence. Pure, tested |
| `apps/api/src/routes/events.ts` | the notice replaces the rename-only one |
| `apps/api/src/participants.test.ts` | the co-host rename test now expects the general type |

### The two rules inside it

**1. A field that has its own notification is not named twice.** `status` and `published`
are excluded: a cancellation already says the night is off (with its reason) and a publish
already says the page went up. Naming them again in a list of changed fields is noise on
top of the message that mattered. If the exclusions leave nothing, nothing is sent.

**2. Field NAMES, never values — except the title.** `changedFieldNames`'s own docstring
sets this rule for the activity log: the guest list and the poster are in `extras`, and
echoing a patch body to every participant would undo the redaction `serialize/event.ts`
performs. The title is the exception because it is the event's identifying fact, it is
event-public, and *"it is now X"* is the whole content of that news.

### Built

One notice per save, to everyone standing on the event minus the person who made it,
naming the fields that moved and carrying who moved them. `event.renamed` is gone.

**The audience rule changed with it, deliberately.** The old rename notice was addressed to
the HOST PROFILE and its test asserted that a host renaming their own show *"tells its own
people nothing"*. The new notice tells everyone on the bill except the actor — the same
audience as the cancellation and publication notices built the same day, so the three
behave alike instead of each having its own idea of who counts. The noise argument that
justified the old rule has not gone away; it has moved to where a user can act on it, since
`notification_preferences` already carries an `events` switch. A preference is a better
home for "I do not want these" than an audience rule nobody can see.

**And a guard that did nothing, deleted — the second today.** The file had an
`ANNOUNCED_ELSEWHERE` set naming `status` and `published`; mutating it away turned no test
red, because the phrase map is an allow-list and neither field has a phrase in it. The set
was a line claiming to do work the design already did. Its reasoning moved into the
allow-list's docstring, where it now explains why those two fields are *absent* rather than
pretending to exclude them.

**A probe of my own that proved nothing, caught and redone.** The first check that a
cancellation does not also send an "updated" notice ran against *Open Mic Wednesdays* —
which has only the host on it, so **no notification of either kind was possible** and the
check passed vacuously. Re-run on the album release (six parties): `event.cancelled: 5` and
no `event.updated` beside it. "Green means the thing I measured was fine", exactly as
`CLAUDE.md` warns.

Proven live — the case that told nobody until today, a door time and a capacity on a
confirmed show:

```
agent@ · co.host@ · performer.a@ · performer.b@ · professional@
  "Marlo Vance — Album Release" was updated
  The doors time and the capacity changed.
  by The Lantern Hall (operator) · fields: ["doorTime","capacity"]
```

Suites: biome 727 clean · api **1356** (10 new; `off-platform` and `settlement` lost to the
Testcontainers flake, both green alone) · web 368 · e2e 112.

**§2 and §5 of the audit are now closed.** What remains on the board: the three design
tickets blocked on `/design-login`, the features this loop deliberately did not invent
(Duplicate, Make recurring, Print details, Invite-from-a-menu, the Assets library, the
Repertoire table, Contacts merge, Team-admin seats), and the sweep's eleven minors.
