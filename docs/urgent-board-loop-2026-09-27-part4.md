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

## §7 of the audit — the eight unread tickets, now read

The ClickUp daily cap reset, so the eight tickets the audit could not reach are read and
checked against the code. **Nothing here was built from these; they are verdicts.** The
pattern from the rest of the audit holds: of eight, one is already done, two are stale in
our favour, two are a missing caller on a built mechanism, and three are genuinely large.

### `123qy9rnk1u` Uploading files — riders and documents · **REAL, and a one-line cause**

Ran: *"For some reason the logic now thinks only Performers can upload Rider and
Documents, this is false. all Users with edit permission or over can add files."*

**He is exactly right, and the cause is a missing capability in one list.**
`PRESET_PERMISSION_SETS.operator_full` (`packages/auth/src/presets.ts:18`) carries
`rider.view` and **not `rider.submit`**. `rider.submit` appears in the `performer` preset,
`PERFORMER_FLOOR` and `DELEGATED_PERFORMER_FLOOR` — and nowhere an operator can reach. So
`POST /events/:id/riders` 403s for the venue running the room, which is why the
{Venue Name} → *Technical info · Equipment list · Rules of Behavior* half of his ticket
cannot exist at all.

The file even carries the precedent: `rider.view` was added to this same list for this
same class of gap, with a comment explaining that the capability *"now says what was
already true"*. This is that, one capability along. **Cheapest real fix on the board** —
built below.

The rest of the ticket (profile riders migrating into the event on acceptance, grouping
files by collaborator, notifying on a change) is a feature and not small.

### `123qy9rngc8` Contacts UI/UX · **REAL, and the missing half is the FORM only**

*"Phone / Address / VAT / Bank / Notes input missing per contact."* The columns all
exist (`contacts.address`, `vat_id`, `bank_name`, `notes`, and `persons` jsonb carrying
`phone` — `packages/db/src/schema/invitations.ts:51`), the API accepts them, and the
contact CARD already renders every one (`routes/Contacts.tsx:175-179`). The CREATE form
offers five fields: Name, Type, Contact person, Email, IBAN. So the data round-trips
today for a contact imported from a spreadsheet and is untypeable by hand — a missing
caller, not a missing feature. Cheap.

Merge-on-duplicate (*"in all CRMs — Audience, Team, Contacts"*), grouping by company and
the Linked Events section are three separate features and none is small.

### `86cbcn1f8` Deals · **MOSTLY ALREADY DONE — the headline bullet is built**

*"'Kind of deal' menu doesn't list the real types: Door split vs Guarantee, Guarantee,
Door split, Rental — plus extras (freelancing employee, service, other/manual)."*
`DEAL_KIND_OPTIONS` (`packages/shared/src/deal-terms.ts`) lists **Guarantee · Door split ·
Guarantee vs door · Rental fee · Fee for a service · Other — agreed manually**, each with
the settlement structure it drives, which is also his *"changing the deal kind must change
the settlement options"*. Terms & conditions text: built today (`deals.terms`,
`serialize/deal.ts:50`). Standalone deals: the composer needs no counterparty.

What is genuinely open: **the agreement PDF carrying event details + deal** (the Share &
Export document prints settlements, not agreements), and **saving a deal structure as a
template**, which is `123qy9rpvfq` — the same work under two tickets.

### `123qy9rnge6` Team & Crew account + admin role · **SPLIT: one small, one is pricing**

*"Tasks on the calendar don't have a navigation 'To task' button"* — real and small, and
the same gap `86cbcn189`/`123qy9rnk21` already cover: `CalendarDayAgenda` only draws a
click target when `event.eventId` exists, with the comment *"a task or a note has no page
of its own"*. Fixing it properly means deciding where a task opens, which is the
day-popover work already queued in §5.

*"Team page should only show the user what teams they belong to"* is the same finding as
`123qy9rnk3h` below — one mechanism, two tickets. **The Team Admin as a paid seat is a
pricing decision** (his own words: *"this should be a paid feature… must buy an extra seat
per admin"*) and is not buildable from the ticket: it needs the `entitlements` layer to
carry a seat count, which decisions.md does not yet rule on.

### `123qy9rnk3h` Team & Crew issues · **REAL, and one mechanism with two symptoms**

An invited team member lands on `/team` rendered as an OPERATOR's team screen — a page
offering to invite members and create groups to somebody whose account cannot do either.
And *"Crew Lead"* is offered in the Invite Collaborator flow, where Ran says it must not
be (*"Team and crew are invited into events and managed only in the Team & Crew tab
inside the event manager"*). `crew_lead` exists as an event role (`EventDetail.tsx:262`,
`SettlementPartyCard`) and appears in no invite-team-member flow. One screen and one
menu; a real unit of work, bigger than the two cheap ones above.

### `123qy9rng8p` Setlists page + event manager · **REAL and LARGE — a new table**

*"scrape that and do this instead."* The Repertoire half does not exist at all: there is
no songs/catalogue table in `packages/db/src/schema` — only `setlists`. Everything he
asks for hangs off it (ISWC, composers, publishers, import/export, the A4 print, attach to
events, per-performer visibility with the operator seeing only THAT a setlist exists).
The visibility rules he restates are already the built ones (`setlist.author` is in the
performer preset and deliberately in no other). **Not a small fix, and not item 4.**

### `123qy9rnfbe` Poster → Promo material + Assets · **STALE in one half, a feature in the other**

*"At the moment uploading the poster does nothing — it doesn't appear in the poster area
in preview and it does not appear in the Event page."* The poster round-trips today:
`imageFileId` is accepted and validated against the host's own folder
(`routes/events.ts:155`), signed per response, and `apps/marketing/src/event.ts:66`
renders it on the public page. Worth re-driving in a sweep rather than trusting either of
us. "Promo material" (many files, any type) plus an **Assets** library to import from is a
new feature and overlaps `123qy9rnfbe`'s own second bullet — the audit already said it
should leave this ticket.

### `123qy9rng6d` W5 · the terminology session · **NOT A BUILD ITEM, and it says so**

A scheduling ticket, written by us, pinning exactly why no fourth guess should be made:
the settlement vocabulary has been renamed three times from written notes and each was
wrong. **Left untouched, deliberately** — it is the sibling of the three design tickets
blocked on `/design-login`: both kinds are "do not build this from prose".

## `123qy9rnk1u` (first bullet) — the operator can attach a document at last

**Verdict: real, and the cause was one entry in one list.** Planned in the §7 section
above; this is what building it found.

**Settled in:** `packages/auth/src/presets.ts` (`rider.submit` into `operator_full`),
`apps/web/src/components/useRiderUpload.ts` (the role set and the gate),
`packages/db/src/seed-capabilities.ts` (**new** — the seeds' one copy),
`apps/api/src/seed-presets.test.ts` (**new** — the copy can no longer drift).

**Scope grew twice, both times because the first fix would have looked like it worked
and not worked.**

1. **The capability alone changes nothing in the browser.** `useRiderUpload` decided
   `canSubmit` from the caller's event ROLE, and its `RIDER_BEARING_ROLES` was written as
   *"everyone but the managing operator"*. So the API would have allowed the attach and
   no button would have offered it. The set now includes `host`/`co_host`.
2. **Role is the wrong question anyway.** `canSubmit` now also requires `rider.submit` in
   the event's own `capabilities` — the pattern `useEventAgreements` and
   `useEventSettlement` already follow. This closes a **lying button that was already
   there**: crew passed the role test, no crew preset carries `rider.submit`, so a
   technical crew member was offered an Upload that 403s. A view-only co-host was too.

**And the third drift of the same list.** The seeds hand-copy
`PRESET_PERMISSION_SETS.operator_full` — twice, once in `seed.ts` and once in
`seed-e2e.ts` — because `packages/auth` depends on `packages/db` and the arrow cannot
point both ways. `rider.view` drifted out of that copy in `e5928ec`;
`performance_report.file` did it before that; `rider.submit` did it today, and the
symptom was precise: **every suite green, and the button still absent in the browser**,
because a seeded `permission_sets.capabilities[]` is a database row, not a constant.

The file's own comment said the third drift should end the copying — *"make the copy
derive from `PRESET_PERMISSION_SETS` instead of adding a fourth comment"* — so:

- the two copies became **one** (`packages/db/src/seed-capabilities.ts`, exported as
  `@showme/db/seed-capabilities`), and
- `apps/api/src/seed-presets.test.ts` asserts each bundle **equals** the preset it names.
  An app may depend on both packages, so the comparison lives there; it needs no
  database. It also names the two presets no seed uses (`crew_technical`, `view_only`),
  so the gap is stated rather than assumed.

The import cycle is still the reason the copy exists at all. Moving the bundles into
`@showme/shared` — where `Capability` already lives — would delete the copy outright, and
is the right next step; it is a package-level refactor with 40-odd call sites and did not
belong inside this fix.

**What is NOT built, and needs a ruling.** An operator-attached document is visible to
the operators only: `scopedEventRiders` (`routes/riders.ts`) gives a performer their OWN
rider and nothing else, by decisions #12. Ran wants the opposite for house paperwork —
*"Files uploaded should be divided and arranged by collaborator: {Venue Name} Technical
info · Equipment list · Rules of Behavior"* — which means a venue's document must reach
the acts. That widens #12 and belongs in `decisions.md`, not in a capability list. Also
noted while testing: `rider_type` is `tech | hospitality | stage_plot | input_list`, four
PERFORMER artifacts — his three venue categories have no home in that vocabulary.

Mutation-checked: removing `rider.submit` from the preset turns both new tests red, the
second with the 403 it used to answer. Proven live as `operator@` after a re-seed: the
seeded set carries 24 capabilities including `rider.submit`, the Riders & Documents card
shows **Upload** where it used to show *"submitted by the act on the bill"*, and the
*Attach a rider* dialog opens. Suites: biome 715 · auth 30 · api **1330** (7 new — two for the
attach, five pinning the seeds to the presets; a clean full run, no flake) · db 25 · web 330 ·
e2e 112.

## `123qy9rpe3q` — a performer can publish their own show, and the other side is told

**Verdict: mixed — bullet 1 is ALREADY DONE, bullets 2 and 3 are real.** Exactly as the
audit has it.

**Bullet 1** — *"Events confirmed only appear on the operator's public page not on the
performer's"* — is not true of the code. `loadPublicShows` (`routes/public.ts:254`)
selects events where the profile is the venue **OR** is a confirmed participant in
`PUBLICLY_BILLED_ROLES`, so a published, confirmed show already appears on the act's page
with its own lineup line. Nothing to build; re-drive it in a sweep rather than trust
either of us.

### Which files settle bullets 2 and 3

| File | What changes |
|---|---|
| `packages/auth/src/presets.ts` | `event.publish` into the `performer` preset |
| `packages/db/src/seed-capabilities.ts` | the same, in the seeds' one copy — the equality test forces this |
| `apps/api/src/lib/event-publication.ts` | **new** — who is told, and in what words, when a show goes public or dark |
| `apps/api/src/routes/events-list.ts` | the publish route notifies; a new `POST /events/:id/unpublish` |
| `apps/api/src/routes/events.ts` | the PATCH path notifies through the same helper |
| `apps/web/src/components/useEventPublishing.ts` | unpublish via the new route; who "the other side" is |
| `apps/web/src/components/EventPublishPanel.tsx` | Ran's sentence, after publishing |

### The four decisions inside it

**1. `event.publish` goes in the performer PRESET, not the performer FLOOR.** The floor is
inalienable — what an operator may never strip (their own money, their own artistic
content). Publishing is a shared act with one flag and a public consequence, so it is a
default an operator can narrow by handing over a tighter permission set, not a right.
`isGrantable` already permits it: `event.publish` is in neither `POOL_CAPABILITIES` nor
`PERFORMER_AUTHORED_CAPABILITIES`. **The agent preset does NOT get it** — Ran named the
performer, an agent's authority is business (negotiate, approve, sign), and announcing a
show to the public is promotion rather than business. Say it out loud rather than infer it.

**2. Unpublishing needs its own route.** Today it is `PATCH { published: false }` under
`event.edit` — which a performer will never hold, and must not: `event.edit` is the title,
the date, the venue, the capacity. So `POST /events/:id/unpublish`, gated on
`event.publish`, the same capability as its opposite. The PATCH path stays for the
operators who already use it.

**3. Two paths must not mean one voice.** That is the trap the cancel work just walked
into, so the notification is a shared helper called from BOTH the publish/unpublish routes
and the PATCH transition (`before.published !== after.published`) — not written twice, and
not attached to one door.

**4. Ran's message is a POST-publish line, and the pre-publish dialog stays.** His words:
*"when pressing add a UI text, not a confirmation box, 'The event is now published and
public on your profile and the {performer} or {Operator} profile'. 'They will be
notified'"* — present tense, after the act. The existing confirm dialog answers a
different question (*what am I about to expose?*, transcribed from
`serializePublicEvent`'s six columns) and was written deliberately. So: keep the dialog,
add his sentence inline in the panel, naming the other side's profile. **If he meant the
dialog itself should go, this is the line to overrule** — recorded here rather than
guessed silently.

### Scope note

The inline text needs the other side's NAME, which the panel does not have. It comes from
the participants query the event screen already holds — the publicly-billed profiles that
are not the acting one — so no new request.
