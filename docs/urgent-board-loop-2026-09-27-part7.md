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

---

## QA sweep run 5 — `QA5-2` and `QA5-5`, planned before building

Two findings from `docs/qa-sweep-2026-09-27-run5.md`, taken together because they are both
**a field the API already had and nobody read**. Neither is on the board; both are mine.

| | Verdict | The file that settles it |
|---|---|---|
| **QA5-5** — the bell never says who did it | **one mechanism, missing caller** | `components/NotificationBell.tsx` |
| **QA5-2** — cancelling closes nothing still open on the night | **real, at two surfaces** | `routes/participants.ts` + `lib/event-change-requests.ts` |

### QA5-5 — `actorDisplay` had exactly one reader, and it was not the bell

`notifications.actorDisplay` is written by every route that raises a notice (`events.ts`
three times, `deals.ts`, and the rest) and is declared on the activity response — so the
**timeline** says *"by The Lantern Hall (operator)"* while the bell, the surface a person
actually looks at, dropped it. Ran's own line on `86cbcftg3` asks for *"where it happened
and by who"*; half of that was being thrown away in the renderer.

Scope: one conditional line and one CSS class. **No decision hidden** — the value is
already event-public (it is the profile's display name, already visible to every party) and
nullable, so a notice raised by the system rather than a person simply renders no line.

### QA5-2 — a cancelled night is not a question, at two surfaces

The sweep found the same defect twice, and run 4 had found it once already (`QA4-16`):

1. **`GET /me/event-invitations`** derived `requestStatus` from the *participation* alone —
   `invited` → `pending` — never looking at the event. So an invitation to a **cancelled**
   show still sat in the Pending tab offering **Accept** and **Decline**, and accepting it
   joined a night that was off.
2. **A pending change request survived the cancellation.** The Confirm/Decline banner asking
   three people to agree a new date stayed live on top of a cancelled event.

Scope, and the decision each hides:

- `inboxStatusFor` gains the event's status as its fourth argument and answers `cancelled`
  **first**, before the past-date test. *The decision:* a show cancelled before its date is
  **not "expired"** — expired means the date came and went unanswered, and telling a reader
  "expired" about a night somebody called off names the wrong cause. `cancelled` is a fifth
  value on the response enum and on the web union.
- `closeChangeRequestsOnCancel` moves every `pending` request on the event to **`superseded`**
  inside the cancellation's own transaction. *The decision:* `superseded`, not `declined` —
  nobody refused anything, and it is the state a second proposal already puts the first one
  in. The row survives for the timeline.
- `EventInvitationsCard` renders a **Cancelled badge**, and only for that status. Every other
  bucket is named by the tab the reader chose; `cancelled` belongs to no chip, so it appears
  only under **All**, beside pending invitations it would otherwise be identical to — same
  title, same date, and now no buttons, with nothing on the row to say why.

### Mutation-tested, and the first attempt at it was worthless

Three mutations, each one red:

| Mutated | Result |
|---|---|
| `if (eventStatus === "cancelled") return "cancelled"` → removed | `expected [ … ] to match object [ { requestStatus: 'cancelled' } ]` |
| `await closeChangeRequestsOnCancel(tx, id)` → removed | `expected [ … ] to have a length of +0 but got 1` |
| the `status = pending` filter → removed | `expected [ …, … ] to have a length of 1 but got 2` |

**The third one is the lesson.** The first two attempts to mutate that filter reported
*green*, and the mutation had been applied to the **wrong occurrence**: `proposeEventChange`
supersedes prior pending requests with a nearly identical `where`, twenty lines earlier in
the same file, and a first-match replace hit that instead. A mutation check that mutates
something else is not a mutation check — the same trap as a green suite over real breakage,
one level down. Anchoring the replacement on the surrounding lines and asserting the match
count is 1 is what made it honest, and then it went red.

That third mutation only has something to fail on because the test now seeds an **already
answered** request on the same event and asserts it stays `confirmed`. A cancellation closes
what is still open; it does not rewrite what the bill already decided.

### Proven on the running stack, before e2e

Invited *Neon Tide* to *Nordic Synth Showcase*, cancelled it as the operator, then read it
back as the performer — API first, then the browser:

```
performerB GET /me/event-invitations   before → "requestStatus": "pending"
operator   PATCH /events/…e4 {"status":"cancelled","cancellationReason":"Room flooded"}
performerB GET /me/event-invitations   after  → "requestStatus": "cancelled"
```

In the browser as `performer.b@`, **Pending** reads *"No requests match this view"* — the
invitation that would have offered Accept is gone — and **All** shows:

```
1 event invitation
Nordic Synth Showcase   [Cancelled]
Fri, 4 Dec 2026 · The Lantern Hall · from The Lantern Hall
```

with no action bar. The bell, on the same page:

```
"Nordic Synth Showcase" was cancelled      2m ago
Room flooded
by The Lantern Hall (operator)
```

Screenshot: `docs/screenshots/qa-2026-09-27-run5/qa5-2-and-5-proof.png`.

### `QA5-3` — recorded, not built

The sweep's third major is that a **co-host can rename** the host's show. That is the same
capability `decisions.md` §25.6 already carries an open call on for *cancel*, so its row has
been widened to name the rename rather than a seventh row being added: both ride on
`event.edit`, and one answer settles both. **Still Ran's or Daniel's call** —
recommendation unchanged, require the host profile for `status` and `title`, mirroring
delete.

---

## QA sweep run 5 — `QA5-1`, the plan before the build

**Verdict: real, and it is three wrong statements from one cause.** Not on the board.

**The file that settles it:** `apps/web/src/components/useEventSettlement.ts` — and the
cause is not in it. `GET /events/:id/settlements` scopes the **party list** through
`partiesVisibleTo` (a co-operator is party to no *deal*, so their settlement row is withheld
from the host — `routes/settlement.ts:1133`, deliberate and documented) while it scopes the
**transfers** separately through `isMyEnd`, which does reach the host. So the API hands the
operator both halves of the night and the screen totals only one of them.

On the sweep's probe — a co-promotion with production costs split 70/30 — the operator's
screen said:

| Card | What it said | What is true |
|---|---|---|
| Total Payouts → **Total payable** | `SEK 56,000` | `SEK 63,200`, which the same card's own transfer list and its own `Net` line both state |
| Overview → entitlement gap | *"each line also carries the cash that party collected and the deductions taken off them"* | nobody collected anything and `deductibles: 0` on every row — the gap is a **withheld party** |
| Who owes whom | two parties, and beneath them *"Your own line. The other parties' figures aren't shared with you."* | two lines are visible, so it is not "your own line", and the board names three parties in its transfers |

### Scope

Three changes, all in the hook and its one caption, none in the API:

1. **`payouts` / `totalPayable`** gain the parties the reader **pays by transfer but cannot
   read a settlement for**. Derived from the raw transfers whose `fromParticipantId` is the
   reader's own participant and whose `toParticipantId` has no visible party row — grouped
   and summed in BigInt minor units, like every other total here.
2. **`entitlementReconciliation`** says *withheld* when there is something withheld. The
   present sentence asserts a cause unconditionally; it becomes one of two sentences, and the
   collected/deducted clause survives only where nothing is withheld.
3. **The redaction caption** under Who owes whom stops saying *"Your own line"* when more than
   one line is visible.

### The decision it hides

**Whether naming a withheld party at all is a leak.** It is not, and the API has already
decided so: the transfer is served to this caller with the counterparty's `participantId`,
and the board renders their name two inches below. What is withheld is their **settlement** —
their entitlement, their collections, their ladder — and none of that is added here. This
change reveals no figure the caller was not already shown; it stops a total from silently
dropping one.

**The alternative, rejected:** compute the totals from the transfers *alone*. It would be
wrong in the other direction — a payout is a party's net, a transfer is one leg of it, and a
party paid across two legs would be listed twice.

### Built, mutation-tested, and proven on the running stack

The rule is pure and lives in `settlementDocument.ts` as `withheldPayees`, with eight tests.
**Six mutations, and two of them survived the first pass** — worth writing down because both
survivors were tests that *looked* like they covered the line:

| Mutated | First pass | Why |
|---|---|---|
| the `from me` filter | **green** | every case had the payee visible too, so the *other* filter refused it. Fixed by a leg between two other parties. |
| the `ownParticipantId` null guard | **green** | nothing exercised a `null` payer. Fixed by one — `fromParticipantId` is nullable, and without the guard two nulls match and an off-platform party's transfer is billed to a reader who is party to nothing. |

Reproduced on the seeded co-promotion rather than a hand-built one: the *Album Release* has
`co.host@` on it as a co-host with no deal of their own. Setting the planner's **Production
costs split** to 70/30 and lowering the door deal from 100% to 60% of the pool leaves a
residual for the operators to share, which is the only lever that pays a co-host
(`operatorResidualShare`, `reconcile.ts`). The API then hands the host three settlements and
**four** parties' worth of transfers:

```
settlements visible to the host   b1 (yours) ent 1,400,000   b2 1,800,000   b3 1,200,000
transfers                         b1 → b2 1,800,000   b1 → b3 1,200,000   b1 → bb 600,000
adjusted net 5,000,000            visible entitlements 4,400,000 — short by exactly bb's 600,000
```

In the browser as `operator@`, all three statements now hold:

```
Total Payouts
  Marlo Vance payout          SEK 18,000
  Neon Tide payout            SEK 12,000
  Northlight Presents payout  SEK  6,000     ← the withheld party, named
  Total payable               SEK 36,000     ← and the card's own Net reads −SEK 36,000

ENTITLEMENT BY PARTY
  The entitlements below come to SEK 44,000, less than the adjusted net. At least
  SEK 6,000 of it belongs to a party whose settlement is not shared with you; it is
  in Total Payouts as a transfer. The percentages are shares of the entitlements shown.

WHO OWES WHOM
  Some parties' figures on this event aren't shared with you, so these lines don't sum to zero.
```

Before the fix the headline read **SEK 30,000** beside a Net of −SEK 36,000. Screenshot:
`docs/screenshots/qa-2026-09-27-run5/qa5-1-total-payable-fixed.png`.
