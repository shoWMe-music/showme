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
