# Feature scopes — what Ran's list left behind

Written 2026-08-27, after the thirteen **defects** on Ran's list were fixed,
deployed and marked shipped (ClickUp [86cbaxtz1](https://app.clickup.com/t/86cbaxtz1)).

What remains is not defects. It is work that was **never built**, so there was
nothing to repair. This file scopes it.

> **Why this is a file and not ClickUp tasks.** Thirteen of these already HAVE
> tasks — the backlog subtasks under 86cbaxtz1 — they just have no
> implementation scope. Adding it hit ClickUp's **daily MCP call limit
> (100/100)**. The scope below belongs on those tasks; the four marked
> **NO TICKET** need creating. Push both when the limit resets.

---

## 0. Budget Planner — **CORRECTED 2026-08-27, and now fixed**

> **What this section originally said was wrong.** It claimed the planner
> "reads real budget lines, edits into `useState`, and never writes". That came
> from `handoff-2026-08-26-in-flight.md`, which is **stale**: the write path has
> existed since commit `e64e438` — `useBudgetEditor` imports and calls all four
> mutations. I repeated the claim without checking it. Left here rather than
> deleted, because the doc it came from is still in the repo saying the same
> thing, and the next reader deserves to know it is out of date.

Driving the running stack instead of reading it turned up **four** real defects
in that write path. Three of them lose or invent money, and all four are now
fixed in `components/useBudgetEditor.ts`.

1. **Rounding through a float.** `Math.round(Number("4.015") * 100)` is **401**,
   because the product is `401.49999999999994`. `0.145` gives `14`, not `15`.
   Every amount and every basis-point share went through it. Replaced by shifting
   the decimal point in the *string* and letting the first dropped digit decide
   (half-up, `money.md`).
2. **`amount ≠ unitAmount × quantity`.** A ticket tier's total was the major-unit
   product converted afterwards, so `0.145 × 2` stored `amount 29` against
   `unitAmount 14` — a breakdown that does not add up to its own total. Now
   computed in minor units with `BigInt`.
3. **Collateral writes — the worst.** The flush wrote every row that *differed*
   from the server, and a row differs for structural reasons as readily as
   because somebody typed. One keystroke in "Marketing cost" bumped five
   untouched lines to version 2 and **invented a zero-amount revenue line** from
   the event's seeded capacity. Those are rows in the ledger `Σ net = 0`
   reconciles, that nobody entered — each one also stealing a version a
   co-host's edit needed. Writes are now confined to rows the operator moved.
4. **The reported symptom, genuinely live.** The unmount cleanup *cancelled* the
   pending debounce instead of firing it, so typing a figure and immediately
   changing tab wrote nothing, silently. It now flushes first.

**Save semantics** unchanged in kind: inline, per row, 700 ms debounce, plus a
flush on unmount. No Save button — a budget is one form of many numbers whose
intermediate states mean nothing.

**Conflict:** first writer wins; the second is told and reverts. Every write now
carries `expectedVersion`; a 409 stops the queue, refetches, and raises a sticky
notice naming the row and the figure that did not save. The old code sent no
version because "a debounced autosave would 409 the person typing against
themselves" — real, and already solved in `useEventInlineFields.ts`: track the
version from each write's own response and queue writes one at a time.

**Still owed:** `shiftedTwoPlaces` is a pure function with no regression test,
because `apps/web` has no unit runner (see §16 and ClickUp 86cbazcf3). A
ten-line spec the moment that exists.

## 1. Access giving — 86cbaxvqk

Settings → Team Access is an empty state: *"Inviting teammates isn't available
yet."* There is no way to put a colleague on the **account**.

**Already exists** per-**event** invitation works end to end; `permission_sets.capabilities[]`
and `authorize()` are built; `profile_members` is what `notifyProfileMembers`
already fans out over.

**Work** invite by email → assign a permission set → change or revoke → list
pending. Reuse the event invitation machinery rather than writing a second one.

**Blocked on** the participants-API gaps in
[86cbazcc7](https://app.clickup.com/t/86cbazcc7): `permissionSetId` is not
nullable (access is a one-way door) and no route lists permission sets, so the UI
cannot name the bundle it is granting. Fix those first or this ships half-built.

---

## 2. Notification preferences, and enough events to fill them — 86cbaxvw8

Settings → Notifications is a placeholder. The bell is empty.

**Already exists and works** the `notifications` table, `lib/notify.ts`
(`notifyProfileMembers` writes the row **and** publishes to the recipient's
Postgres channel), and the SSE service. **`BREVO_API_KEY` and `BREVO_SENDER` are
set in production** — verified 2026-08-27 on `showme-api`, so email is not dead;
it simply has little to send.

**Work** per-category email + in-app toggles (bookings, deals, settlements,
tasks) · audit which mutations actually emit and fill the gaps — an empty bell is
mostly a missing-emitter problem, not a UI problem.

---

## 3. Contacts import / export — 86cbaxyud

`/contacts` has one button: Add Contact. Every IBAN, VAT id and address is
hand-typed and cannot be got back out.

**Do this one first of the two imports.** A contact settles nothing, so a bad row
costs nothing — it is the safe place to establish the file-picker + column-mapping
pattern the calendar import will need.

**Work** CSV export honouring the field-level serializer (export only what the
caller may read) · CSV import with column mapping, preview, dedupe on email · an
imported IBAN lands **unverified**, never inheriting a verified badge from a file.

---

## 4. Calendar `.ics` import — 86cbaxw5k

`routes/Calendar.tsx` raises a toast and stops. The stub's own comment names the
real blocker honestly: an imported entry must become something the app owns, and
no route takes a batch of either.

**Work** decide what an import becomes — default to `calendar_item` (a note the
reader owns, settles nothing) and let them promote one to a real event
deliberately. That sidesteps "rows nobody can settle" · then the batch route ·
then the picker, reusing #3's mapping UI.

---

## 5. Task assignee — 86cbaxy05

`tasks.assignee_participant_id` **exists in Postgres** and is read by nothing. The
edit dialog offers a work-*group*, never a person.

**Work** accept and return it on the tasks routes; serialize the assignee's name
beside it (mirror how calendar items already do) · add the select, sourced from
event participants for an event task, account members otherwise · keep
work-group too, they are different acts.

**Unblocks** #6 and #7.

---

## 6. Task reminders — 86cbaxxu1

Nothing exists. `tasks` has no reminder column and `due_date` is a `date`, not a
timestamp — a reminder that fires at a time needs one.

**Work, in Ran's own order** *now:* `remind_at timestamptz`, fired from the
existing `apps/jobs` sweep into `notifyProfileMembers`, which already reaches the
bell over SSE · *later:* Google Tasks sync, so it also raises Google's own
notification. The OAuth half has a precedent in the calendar integration.

**Depends on** #2 (a preference to turn them off) and #5.

---

## 7. In-house teams — 86cbaxxj9

The event's In-House Management panel promises "team schedules, private notes and
assigned tasks" and renders one sentence. It points at the To Do tab for
assignees, which until #5 has none.

**Work** call times per crew member, operator-private · private notes on a crew
member, never shared with the bill · that member's tasks on this event.

**Depends on** #5. The account-level roster (`groups`, `group_members`) is real
already — this is the in-event surface.

---

## 8. Off-platform participant — **NO TICKET** (the other half of 86cbaxxcu)

The *lie* is fixed and shipped: the toast now names who was skipped and why. The
capability gap is not. A venue's own stage manager can sit on their Team roster
as a Contact and still be **unbookable** — `POST /events/:id/groups` skips any
member with no `user_id`.

**Work** let an off-platform person become an event participant (or send the
invite that turns them into one), the way `Invite Collaborator` already does. See
`docs/off-platform-access.md`.

---

## 9. Unavailability on the grid — 86cbaxwb5

Marking is a modal with From/To fields plus a side-rail list. The *display* is
already right — a blocked day renders hatched on the grid.

**Work, V2 behaviour** a marking-mode toggle (X cursor) · drag/click multi-select
with shift-range · a "Done marking" that commits in one write · retire the side
box as the entry point.

Front-end only: `POST /profiles/:id/availability` already exists, and the grids
already take a `blocked` set.

---

## 10. Calendar venue → room filter — 86cbaxwfr

"Venue / Room…" is one free-text box matched as a substring, so you cannot pick a
venue and narrow to a room, or discover what rooms exist.

**Work** a venue select, then a room select that populates from it and is disabled
until one is chosen · keep the rail's existing `hiddenRooms` chips in sync so the
two controls cannot contradict each other.

---

## 11. Rooms and capacity, entered three times — 86cbaxwmt

"The room → Capacity", "Capacity setups", and "Rooms & stages" each with its own
capacity. The copy already carries a disclaimer explaining they are not the same
thing — if a UI needs that, the UI is the problem.

**Work** one model: a venue has **rooms**; a room has a capacity and optionally
alternate setups. Delete the top-level field (it is the single-room case), move
setups inside a room, keep it flat for a one-room venue.

**Watch** `events.capacity` is stamped from the profile at creation — whatever
replaces the flat field must keep feeding that stamp.

---

## 12. Holds — 86cbaxumc

`hold_rank` is written once by the create wizard, shown in one toast, and never
seen again. `POST /events/:id/hold/confirm` and `/hold/decline` **exist in the API
and are called by nothing**.

**Work** surface the rank on the event header, the Events list and the calendar
chip · a holds panel: competing holds, reorder, promote, release, wired to the
three existing routes.

**Fold in, also unticketed:** `hold_auto_promote` is unreachable from any route,
so every hold the wizard creates is frozen and will never auto-promote
(`handoff-2026-08-26-in-flight.md`). The sweep itself lives in `apps/jobs` —
locally `pnpm jobs:run`.

---

## 13. Profile → event carry-over — 86cbaxvku

Capacity and venue carry. Amenities, catering notes, accommodation notes, artist
logistics, curfew, sound system and the venue's preferred deal types do not — so
the operator retypes on every event what their own profile already states.

**Work** seed them onto the event as **editable defaults**, copied not linked: a
later profile edit must never rewrite what a signed show promised · add a Room /
Stage picker to the wizard from `GET /profiles/:id/stages`, which already exists.

---

## 14. Deal → budget → settlement — 86cbaxvf5

A confirmed Door Split deal contributes nothing to the Budget Planner (every cost
line reads "Not tied to a deal", Performer fee is empty) and nothing to the
settlement until someone reconciles.

**Work** on confirmation, a deal's figures appear in the budget as deal-tied
lines and flow into the settlement without re-entry. The schema already models
it — `settlement.ts:72` documents `deal_id` on a budget line as *"the line IS
that deal's own figure"*.

**Depends on** #0. Wiring a deal into a planner that discards its own input
achieves nothing.

---

## 15. A user date/time preference — **NO TICKET** (remainder of 86cbaxud0)

Format is fixed everywhere — one formatter, day-first, year always. What is still
missing is Ran's *"no date time setting available for the user"*: there is no
date-format preference, and the timezone select in Settings → General is unset.

**Work** a user-level preference feeding `lib/format.ts` · make the remaining
`<input type="date">` fields use the in-app picker so they stop rendering in the
browser's locale.

---

## 16. Event list against the design — **NO TICKET** (remainder of 86cbaxu87)

The **data** is fixed and shipped. Whether the columns and row actions match the
prototype has never been checked: the Claude Design MCP needs `/design consent`
from Daniel, and per the `claude-design` skill the prototype must be **rendered
and looked at**, never read as HTML or rebuilt from a description — that has gone
wrong twice.

---

## Suggested order

`0` → `3` → `5` → `2` → `6` → `7` → `12` → `13` → `14` → `1` → `9` → `10` → `11` → `4`

The reasoning: **0** is the worst live defect and **14** is pointless before it.
**3** is the safest place to build the import pattern **4** needs. **5** unblocks
**6** and **7**. **1** waits on the API gaps in 86cbazcc7. **11** carries a
migration risk (`events.capacity`) so it wants a quiet slot, not a busy one.
