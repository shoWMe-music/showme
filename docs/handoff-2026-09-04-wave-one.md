# Wave 1 of the bug plan — built 2026-09-04

Six fixes from `docs/bug-analysis-2026-09-04.md`: everything in that plan that
needed nothing from Ran. All are in the working tree, **not committed and not
deployed**. Nothing here needed a migration.

| | Ticket | What changed |
|---|---|---|
| A1 | [123qy9rnfz0](https://app.clickup.com/t/123qy9rnfz0) | `GET /me` returns `currency` + `timezone`; the settlement screen honours the preference |
| A2 | [123qy9rnfyw](https://app.clickup.com/t/123qy9rnfyw) | The wizard asks before discarding; **Save draft** built; 16 form modals opt out of scrim-dismiss |
| A3 | [86cbcgw46](https://app.clickup.com/t/86cbcgw46) | My Calendars hides its venue furniture from performers |
| A4 | [86cbcgjhw](https://app.clickup.com/t/86cbcgjhw) + [86cbcn189](https://app.clickup.com/t/86cbcn189) | The reason prompt only appears when something is being blocked |
| A5 | [86cbceux0](https://app.clickup.com/t/86cbceux0) | `GET /events/date-conflicts` + the warning on both date fields |
| C4 | [86cbcn1ue](https://app.clickup.com/t/86cbcn1ue) | The FX notice names its cause instead of reading as a broken control |

**Checks:** API 1093 tests, web unit **147** (up from 103), 101 Playwright specs,
full typecheck and lint clean. 14/14 live probes against the booted stack, plus a
browser pass through every changed screen.

---

## A1 · The write worked; the read did not exist

`PATCH /me` had always stored `currency` and `timezone`. `MeResponse` never
returned them, so the Settings form had nothing to seed from and came up blank on
every visit — indistinguishable from a save that failed. `Settings.tsx` said so in
a comment rather than in a ticket.

- `MeResponse` now carries both, and `serializeMe` builds the response once so a
  field cannot be added to the read and forgotten on the write. **That asymmetry
  is the bug**, so the shape is now declared in one place.
- The PATCH returns via `returning()` — what was *stored*, not what was sent.
- Deliberately **not** added to `Principal`. That type is the authorization
  identity and `resolvePrincipal` runs on every request; a display currency is not
  authority, and putting it there invites routes to make access decisions out of a
  preference. `/me` pays one primary-key lookup instead.

**The second half of Ran's report — "currency around the platform is wrong" — was
the bigger bug.** `users.currency` was read by *nothing*. `useDisplayCurrency` now
seeds the settlement screen from it, with one rule worth keeping:

> **A currency the reader CHOSE warns when no rate exists. One they inherited
> falls back silently.** Asking for a conversion and not getting one deserves to
> be said; a default they never set on that page does not. Without this,
> `exchange_rate_cache` being empty would have lit a warning on every money screen
> for every user whose preference differs from the event's — correct, and unusable.

### What was deliberately NOT done, and why it matters

The event workspace's own "Display currency" selector was left alone. **It does
not convert** — `currency` reaches the budget, details, deals and settlement tabs
purely as the argument to `formatMoney`, so picking EUR on a SEK event relabels
SEK numbers with a euro sign. Seeding it from the preference would have turned a
mislabelling you must opt into into the default for everyone.

Filed as **[123qy9rnjb8](https://app.clickup.com/t/123qy9rnjb8)** with the two ways
out, and a comment in `EventDetail.tsx` so the next person does not "finish the
job". A show budgeted at SEK 20,700 currently reads €20,700 if you touch that
control.

---

## A2 · The wizard no longer eats your work

`NewEventWizard`'s backdrop ran `reset()` then `onClose()` — every field gone, no
warning. **Escape did the same**, which the ticket did not mention.

- `isDirty` compares against what the wizard OPENS with, not against empty: the
  date is seeded from a calendar cell and the profile is pre-selected when there is
  only one. Treating those as typing would fire the confirm on an untouched wizard,
  which teaches people to click through it — and then it protects nothing.
- The backdrop, the X, Cancel and Escape all go through one `requestClose`.
- The confirm's own backdrop **keeps** the work. A confirm that discards on an
  outside click would be the original bug wearing a dialog.
- **Save draft is a real feature.** `eventPayload()` is shared with submit, so the
  draft records the same event the finish button would have. The agreement is left
  behind on purpose — a half-stated deal is not a deal, and writing one from an
  incomplete step would put figures on a settlement nobody agreed. Its own mutation
  rather than a second callback on `create`, because react-query runs hook-level
  and call-level callbacks both.

**Design system:** `Modal` gained `dismissOnScrim`, default `true`. Sixteen form
modals opt out. Opt-in on purpose: most modals hold nothing worth protecting, and
one that will not go away teaches people to hunt for the X.

---

## A3 · Rooms UI shown to performers

The ticket said only *"See comment. This is Venue UI. remove it."* — **opening
Ran's screenshot** identified it as the **My Calendars** card, telling a performer
that "a venue's rooms are separate calendars" and offering "+ Manage rooms".

`CalendarInventoryGroup` now carries `isVenue` from the source. It cannot be
inferred here: a performer and a venue with no rooms recorded both produce a group
with `heading: null` and one row. `some`, not `every` — an operator who also
performs still gets the rooms half for the venue among their profiles.

> Note for Ran's decision on [86cbcn189](https://app.clickup.com/t/86cbcn189): if
> this card is one of the three coming off the calendar page, this gate goes with
> it. It was cheap enough to do now rather than leave a live bug pending an answer.

---

## A4 · Freeing a night no longer asks why

Marking already toggled, so unmarking always worked. The bug was the **reason
modal**: asked once at the end for the whole selection, so freeing a night
prompted you to explain why you freed it.

Now the prompt appears only when at least one night is being *blocked*. A mixed
selection still asks — it is still blocking something. This closes 86cbcgjhw and
the first bullet of the Calendar ticket in one condition.

**`applyDaySelection` got its first tests** (13 of them). It is the range
arithmetic behind every marking write — freeing a night can trim a range, split it
in two, or delete it — and it had none, because `apps/web` had no unit runner until
yesterday. **Mutation-tested:** a plausible wrong implementation turns four of them
red.

---

## A5 · The double-booking warning

`occupiedDates` has stated Ran's rule correctly since the calendar was built and
was called only by screens that *display* availability. Nothing asked it while
somebody was creating a clash.

**`GET /events/date-conflicts`** is the asking. It gathers the bookings and lets
the shared module decide — it re-implements no availability logic.

- **It warns; it never blocks.** A read, and the create call does not consult it.
  Ran was explicit that several shows can share a night.
- **Per room.** A venue with a free basement is not busy because the main hall is
  sold. A show with no room recorded occupies every room, because nobody can say
  which one is free.
- **Only for a venue you are a member of.** Another operator's calendar is not ours
  to read; "the 14th is busy" for any profile id would leak their schedule.
- Wired into both places a date is set: the wizard and the event's inline field
  (excluding itself, so moving a show never reports a clash with itself).

### A third message tier, found by driving it

The first live run said **nothing** for 21 September at a venue whose Main Room was
already sold — because the Back Room was free, so the venue was not "full".
Technically correct and useless. There are now three tiers:

| State | What it says |
|---|---|
| Manual block | *"You marked this date unavailable (Refit). You can still book it."* |
| Room busy | *"Main Room already has 'Marlo Vance — Album Release'. You can book it anyway."* |
| Room free, building not empty | *"Already on this night: 'Marlo Vance — Album Release' in Main Room. This room is still free."* |

All three verified in the browser. A test asserts that every message tells the
operator they may proceed, and that none uses the language of refusal.

**Still open on this ticket:** room-level unavailability needs a `stage_id` on
`profile_unavailability` — a migration, and Ran's call. Asked on the ticket.

---

## Verification

- **14/14 live probes** against the booted stack as the seeded accounts, reading
  rows back in Postgres.
- **Browser pass**: saved a currency and confirmed it survives a reload; filled the
  wizard, clicked the backdrop, got the three-way confirm, used **Save draft** and
  confirmed in Postgres that it wrote `draft` with the typed title and **no deal**;
  saw all three conflict tiers, including the Back Room reading free while the Main
  Room was sold.
- **One probe lied and was caught.** It asserted performerA's `/me` should not read
  SEK — but the seed gives *every* user SEK, so the check was true whether the route
  was correct or leaking. Rewritten to set a different currency and assert both
  directions.

## What is left of Wave 1

Nothing. The remaining items in the plan are Wave 2 (a verification session with
Ran), Wave 3 (the invitation epic), Wave 4 (the re-scoped builds) and Wave 5 (the
design pass) — plus the seven decisions, which are on the tickets.

**A6 (profile images) is not in this wave**: the plan says it needs a live
reproduce before it can be planned honestly, and that has not been done.
