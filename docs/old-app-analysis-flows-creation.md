# The old app as FLOWS — what it knew so the user did not have to type it

**Written 2026-08-26.** Subject: the prior Firebase/Firestore app at `../showme-settle-fast`. Three
earlier reports read that app as **pages** (`old-app-analysis-features.md`), as **tables**
(`old-app-analysis-data-model.md`) and as **money math** (`old-app-analysis-settlement.md`). None of
them followed a value from where it was first typed to where it turned up again. That is what this
one does: **creating an event**, **filling in a profile**, and every place the old app carried data
from one object to another.

**This is a mechanism report, not a design report.** Nothing below recommends how anything looked.
Where presentation matters it is stated as a behavioural property in words — *offered into a visible
field the user can overwrite* vs *written behind their back* — because those two are different
products, not different stylesheets. The design system is ours and is not in question here.

---

## How it was run (and what is proven vs read)

Boot recipe as recorded in `old-app-analysis-features.md`, on my own ports so nothing collided:

```
cd ../showme-settle-fast
node -e '…'                       # firebase.local.json = firebase.json minus hosting,
                                  # emulators moved to 8391/9391/9691/5311, hub 4411, UI 4301
npx firebase emulators:start --project showme-local --config firebase.local.json \
    --only auth,firestore,storage,functions
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9391 FIRESTORE_EMULATOR_HOST=127.0.0.1:8391 \
    npx tsx scripts/seed.ts       # all accounts: password 123456
PORT=5187 npx tsx server.ts       # .env.local points the client at those ports
```

Two events were **created through the real wizard** in a scripted browser (the MCP browser is shared
with another session, so I drove my own Chromium out of the old repo's Playwright), and the resulting
Firestore documents were read back over the emulator REST API. So every claim about what a created
event *contains* is measured, not inferred. Claims about code paths I did not execute say so.

Evidence images (mechanism evidence, not visual targets) are in `.playwright-mcp/old-app-flows-*.png`.
The most useful single frame is `old-app-flows-09-created-event.png`: an event created by typing a
name, a performer's name and a date, which arrived carrying a room, a capacity, eight amenities, a
linked performer profile and a full production-cost split.

---

## 1. Every field on a new event: where it came from, and where ours comes from

"Typed" = the user entered it. "Derived" = computed from other input. "Copied" = taken from another
stored object. Old-app column cites `showme-settle-fast`; ours cites this repo.

| Field on a new event | Old app — how it was populated | Ours — how it is populated | Gap |
|---|---|---|---|
| **Acting role / host profile** | Preselected from `currentUser.defaultRole`, or the only role if there is one (`CreateEventDialog.tsx:32`). **But the preselection does not run `handleRoleSelect`**, so the venue/capacity prefill only fires if the user *clicks* the role — measured | Role step is skipped entirely when there is one operator profile; otherwise picked (`NewEventWizard.tsx:134-138`) | Ours is cleaner. The old app's silent-default-without-side-effects is a bug to avoid, not copy |
| **Event name / title** | Typed | Typed (`artist` field doubles as the title, `NewEventWizard.tsx:383`) | — |
| **Date** | Typed; prefilled from the calendar cell you clicked (`CalendarPage.tsx:772` passes `defaultDate`) | Typed; `initialDate` prop exists and the calendar passes it | Parity |
| **Venue name** | Venue-role: auto-selected when the account owns exactly one venue profile (`CreateEventDialog.tsx:180-186`). Otherwise a **Contacts-backed combobox** (`ContactCombobox contactType="venue"`) | Typed, or picked from `EventVenuePicker`; server fills `venueName` from the venue profile when blank (`routes/events.ts:181-183`) | Ours does not auto-pick the single owned venue |
| **Room / stage** | **Picked from the venue profile's `subVenues`** (`EventDetailsStep.tsx:161-186`). Options measured live: `Main Hall (350)`, `Club Room (120)`, `Rooftop Stage (80)` | **Nothing.** `events.stage_id` exists and the API accepts it; the wizard has no picker (audit **A-31**) | **The whole room concept is missing from create** |
| **Capacity** | **Copied from the venue profile (500), then overwritten by the chosen room (350)** — measured on the created doc | Copied from the venue profile only, into a visible field (`useEventVenuePrefill.ts:60-70`, server backstop `routes/events.ts:188-190`) | **Ours prefills the BUILDING's capacity onto a show that may be in the 120-cap Club Room.** A wrong figure, not a missing one |
| **City** | Not on the event; the venue profile's `locations[0]` was the location | Copied from the venue profile into `extras.city`, blank-only (`useEventVenuePrefill.ts`, `routes/events.ts:203-210`) | Ours is ahead |
| **Country** | Same | Copied into `extras.country`, blank-only | Ours is ahead |
| **Curfew** | Not carried | Copied from `venue_details.curfew` when it parses as a time, else dropped (`routes/events.ts:163-166`) | Ours is ahead |
| **Amenities** | **Copied from the venue profile onto the event at create** (`useCreateEventSubmit.ts:46-56, 385`). Measured: 8 amenity strings on a wizard-created event | Copied blank-only into `extras.amenities` (`routes/events.ts:196-200`) | Parity |
| **Catering / accommodation notes** | **Copied from the venue profile at create** (same `pickVenueAmenities`), and copied again as *riders* when a collaborator accepts | Not carried. `VenueDetailsFields.tsx:123-129` collects both on the profile; nothing reads them onto an event | **Collected and never used** |
| **Timezone** | Absent (`docs/timezones.md` is a rebuild concept) | Derived from the venue profile's country (`resolveEventTimezone`) | Ours is ahead |
| **Base currency** | Per-event currency selector, defaulting to EUR globally | `defaultCurrencyForCountry(acting profile's country)`, `FALLBACK_CURRENCY = "EUR"` (`packages/shared/src/currencies.ts:84-89`) | Right rule, **empty input**: onboarding never asks for a country (below), so a Swedish operator silently gets EUR on an authoritative money field |
| **Performer name** | Typed, or picked from `PerformerSearch` (profiles + contacts) | Typed, or picked from `PerformerSearch` (profile / contact / draft) | Parity |
| **Performer → profile link** | **Resolved from the typed name.** If no profile was picked, the submit path exact-matches by name (`searchArtistProfiles`) and, failing that, **creates an un-acquired placeholder profile** (`useCreateEventSubmit.ts:319-334`). Measured: typing "Aurora" produced `performerProfileId: seed-artist__aurora` | Only when picked; a typed name is stored as a `draft` performer inside `extras.performers` | Ours never links, never stubs, at create |
| **Whether the performer is notified** | **Asked, once, with the consequence spelled out** — "invite now so they see it on their dashboard, or save quietly as a draft" (`CreateEventDialog.tsx:377-395`). Drives `accessUids` and the status (`draft` vs `suggested`) | Not asked; events are always created as `draft` and participants are invited later | Ours is safer but loses the one-step path |
| **Status** | Derived: explicit `defaultStatus` wins, else `suggested` if a performer is being invited, else `draft` (`useCreateEventSubmit.ts:189-196`) | Always the column default `draft` (`routes/events.ts:216-219`); hold mode does a second write | Deliberate on our side |
| **Hold rank** | Derived from the slot: defaults to the queue's max+1 and follows the slot until the user picks (`EventDetailsStep.tsx:88-118`) | `useHoldPlacement` reads the pool for the date and ranks against it | Parity — ours is the better-scoped version |
| **Ticket links / provider** | Typed into a **Contacts-backed combobox** of ticketing providers; each new provider name is written back as a contact | Typed free text into `extras.ticketing.provider` | Ours has no provider memory |
| **Deal type** | Defaulted to `guarantee` for everyone, always | Defaulted to `guarantee_vs_door`, always (`NewEventWizard.tsx:159`) | Both ignore the venue profile's own **`dealTypes`** list — which both apps collect (`ProfileEditPage.tsx:716`, `VenueDetailsFields.tsx:138`) and neither reads |
| **Guarantee** | Typed; **prefilled from a booking request's `artist_fee`** (`CreateEventDialog.tsx:98`) | Typed into `extras.dealDraft.guarantee` | See "deal draft" below |
| **Revenue split** | Hard-coded 70 / 20 / 10, with the third leg derived so the three total 100 (`CreateEventDialog.tsx:210-215`) | Hard-coded 70 / 20 / 10, no auto-balance (`NewEventWizard.tsx:161-163`) | Ours lost the "keep it at 100" derivation |
| **Production cost split** | **Hard-coded 20 / 50 / 30 and written even when the section is never opened** — proven: `EVT-905744`, a `guarantee` deal, has `artistCostSplit 20 / promoterCostSplit 50 / venueCostSplit 30` | Not written at all | **Ours is correct.** See §4 — this is the old behaviour that is now explicitly forbidden |
| **Venue rental + who pays** | Typed for `rental` deals; payment mode `deduct_at_settlement` vs `request_now` | Typed into `extras.dealDraft` | — |
| **Commissions (agent / promoter / management)** | Party rows with **default percentages baked in**: Booker/Agent 15%, Promoter 20%, Management 10% (`create-event/types.ts:73-77`) | Not present | **Correctly absent** — see §4 |
| **The deal itself** | **A real `events/{id}/deal/main` document is written by the wizard** — measured | **Written to `extras.dealDraft` and read by nothing.** `grep dealDraft` finds one writer and zero consumers | **The deal step of our wizard is a dead end.** The operator states terms and they vanish |
| **Riders** | The **host's own profile documents are copied onto the event at create** (`useCreateEventSubmit.ts:414-433`); collaborators' arrive on accept | Nothing at create. `riders.is_default` ("auto-attach on join") exists in the schema and nothing acts on it | **Decided in `decisions.md` #13, not built** |
| **Schedule** | Empty; a **"Load Defaults"** button offers Get-in / Soundcheck / Doors / Show / Curfew when the list is empty (`EventDetailsTab.tsx:1277-1286`) | Empty, no defaults | **Decided in `decisions.md` #16.4** ("seeded, fully editable… from the old app"), not built |
| **Budget** | Not created at event create; the planner seeds `capacity` from the event on first open, and only when the event is **not a draft** (`useBudgetCalculator.ts:35-38`) | A budget row is created **with the event** (`routes/events.ts:229-231`); `useBudgetSeed` offers capacity, a tier at 80%, 1.5% processing and the venue cost | **Ours is ahead** |
| **Revenue + settlement scaffold** | **Created with the event** — `revenue/main` (zeros) and `settlement/main` with an `approvals[]` row per party. Measured | Settlement is created later | Old app's is eager; ours is lazy. No obvious winner (see Questions) |
| **Contacts** | **Written back from what you typed**: the venue, every ticketing provider, every commission party and every performer become contacts if they are not already, and never if the name is one of your own profiles (`useCreateEventSubmit.ts:157-172, 203-208`) | Not done | Missing (see §3) |
| **Back-reference to the booking request** | `sourceRequestId` + `sourceRequestDate` stamped on the event; the request flips to `accepted`/`draft_created` and stores `event_id` (`IncomingRequestsPage.tsx:329-344`) | `POST /booking-requests/:id/draft-event` exists | Check parity when that route is next touched — the two-way link is the part that matters |

---

## 2. Profiles, end to end: what a complete one holds, how a user gets there, what it then feeds

### What "complete" meant, and why it was enforced

The old app had a **canonical completeness definition for performers** —
`src/lib/profileCompleteness.ts`: bio, photo, a music link, a **technical rider**, a stage setup or a
live video, and at least one genre. It is not decorative:

- The dashboard banner names the count of missing items and links straight to the editor
  (`WelcomeBanner.tsx:80-110`; measured live — see `old-app-flows-01-dashboard.png`, *"Complete your
  performer profile (1 item left) to start sending invites and offers to venues"*).
- **Sending is gated on it.** `CreatePerformerOfferDialog.tsx:77-81` blocks the send, and
  `functions/src/performerOffer.ts:100-141` re-checks the same list **server-side** before writing an
  offer. Same gate on `CreateDraftWithVenueHandoffDialog.tsx:73-77`.

The gate is the reason the prefills downstream have anything to draw on. It is a *product* rule with
a clear rationale — a venue reading a cold pitch expects to see a rider and hear the music — and it is
enforced in the one place that counts.

### How a user got there

The old **signup wizard collected profile facts at account creation**, per profile:
street / postcode / city / country, genres, **venue capacity**, performer setup type and size, bio,
avatar (`SignupPage.tsx:104-121, 603-632`). That is why every venue in that app had a capacity on day
one, and why "capacity is already filled in" was true for everyone rather than for the diligent.

**Ours collects a name and a type, and nothing else** (`apps/web/src/auth/OnboardingFlow.tsx` steps:
welcome → kind → name → entity → profiles → review). The venue editor we have is *richer* than the old
one — capacity, curfew, amenities, catering and accommodation notes, deal types, and rooms as real
records (`VenueDetailsFields.tsx`, `ProfileRoomsCard.tsx`) — but nothing ever asks, so a new account's
prefill chain starts empty and stays empty. The single highest-leverage change in this report is
therefore not a prefill at all: **it is asking for the venue's country, capacity and rooms once.**

### What a profile fed, once it existed

| Profile field | What it seeded in the old app | In ours |
|---|---|---|
| Venue `capacity` | Event capacity at create | Event capacity at create |
| Venue `subVenues` (rooms / stages, each with capacity) | The Room/Stage picker → **event capacity**; the Calendar's per-room sub-calendars; the multi-performer stage options (`EventDetailsTab.tsx:221-240`) | Rooms exist as records; **nothing on an event points at one** |
| Venue `amenities` | Event amenities at create; **and again** when the Amenities card is opened empty (`EventDetailsTab.tsx:1371-1382`) | Event `extras.amenities` at create only |
| Venue `cateringNotes` / `accommodationNotes` | Event fields at create; **and as riders** ("Catering Requirements", "Accommodation Requirements") when a collaborator accepts (`useEventMutations.ts:567-585`) | Nothing |
| Venue `dealTypes` | Displayed on the profile and the public EPK. **Never seeds the deal step** | Same — collected, displayed, unused |
| Venue `performanceBonuses` | Editable on the profile; **no consumer anywhere** (`grep bonusThresholds` → nothing) | Absent — correct, the meeting defers escalators |
| Performer `documents` (tech / hospitality riders) | Host's own → event riders at create; collaborator's → event riders **on accept**; and an explicit **"Autofill from Profile"** button on the Riders card (`EventDetailsTab.tsx:1186`) | A rider library exists (`riders` with `owner_profile_id`), and the only way to put one on an event is to **upload the file again** |
| Performer `genres`, `locations[0]`, `slug`, name | The **offer email** to an off-platform venue: name, public EPK URL, genres, location (`performerOffer.ts:481-503`); the offer dialog also defaults its target country from the performer's own country | Not applicable yet |
| Performer `setups` / `setupType` | Completeness gate; public EPK | `ProfileSetupsField` exists |

---

## 3. The mechanisms worth taking

Ten distinct moves, ranked by how much they prevent rather than how much they save.

**1. Fill only a genuine blank, into a field the user can see and change.** Both apps landed here
independently — the old app's amenity re-offer only fires `if (amenities.length === 0)`, ours states
the rule twice in comments (`useEventVenuePrefill.ts:16-19`, `useBudgetSeed.ts:11-17`). Worth naming
as a house rule: **a prefill is a suggestion in the form, never a value written behind the user's
back.** The difference is not cosmetic — an operator who can see 350 and correct it to 120 is in a
different product from one who discovers it in the settlement.

**2. The room, not the building, is the unit that has a capacity.** Picking "Club Room" set capacity
to 120 in the old app. Ours has rooms as first-class records and no way to attach one to a show, so it
prefills the building's 500 onto a 120-cap night. This is the clearest *wrong-figure* prefill we
currently ship.

**3. Transfer on accept, not on invite.** `migrateCollaboratorRidersOnAccept` (`useEventMutations.ts:607-645`)
copies the accepting party's documents and hospitality notes onto the event **when they accept**, is
idempotent by deterministic rider id, and silently no-ops when the profile is unreadable. The comment
at `useCreateEventSubmit.ts:404-410` is explicit that this is a rule, not an accident: the host's own
riders copy at create because the host owns the event; **everyone else's wait for consent.** That is
the correct shape for `riders.is_default` in our schema, and it is already decided (`decisions.md` #13).

**4. An explicit pull, plus a hint that there is something to pull.** The Riders card carries an
"Autofill from Profile" action, and when it is empty it says *"Rider data available on Aurora's
profile"* (`EventDetailsTab.tsx:1197-1210`). Cheap, honest, and it never asserts anything on the
user's behalf. Our rider modal currently promises "so you can re-attach the same rider to the next one
without uploading it again" (`RiderUploadModal.tsx:68-70`) — and there is no affordance that does it.

**5. Resolve a typed name to a real profile, and stub one when there is none.** Typing "Aurora"
produced a linked profile on the created event; a name with no match produces an un-acquired
placeholder the performer can claim later (`createUnacquiredProfile`, and the venue-side equivalent in
`functions/src/venueHandoff.ts`). The stub is what lets an event, an offer and an invitation code all
point at the same thing before the counterparty has an account. We already have `createPerformerStub`
on the participants route — the missing half is using it **from the create wizard** instead of parking
a `draft` name in `extras`.

**6. Ask once, in the user's own terms, when the consequence is real.** The invite prompt is one
sentence naming both outcomes, and it decides both `accessUids` and the event's status. Contrast a
silent default: the same wizard, with no performer profile attached, invited a performer and moved the
event to `suggested` **without asking**, because the prompt only fires when a profile was picked from
the dropdown (`CreateEventDialog.tsx:361-370`). Ask when it is consequential; do not let the same
consequence slip through a different door.

**7. Derive, don't store, when a figure lives somewhere else.** The old budget's performer-fee rows
are built from `deal.artistGuarantee`, marked `readOnly`, and re-synced when the deal changes
(`useBudgetCalculator.ts:93-110`; source at `EventManagerPage.tsx:302`). That is the same conclusion
our `useBudgetSeed` reaches from the settlement side. Two independent code bases arriving at "the fee
is rendered from the deal" is about as strong a signal as this exercise produces. Our deal-name
suggestion (`useDealComposer.ts:56-71`) is the same instinct applied to text: follow the parties until
the user types their own, then stop.

**8. Write back what the user taught you.** Every venue, ticketing provider, commission party and
performer name typed into the old wizard became a **contact**, with two guards worth copying: never
create a contact for one of your own profile names, and never duplicate an existing one
(`useCreateEventSubmit.ts:157-172`). It is why the second event's venue field autocompletes. We have
`contacts` and the create wizard never touches them.

**9. Per-profile section templates, shared with the profile's team.** `SectionTemplateMenu.tsx` is a
generic Save/Load over `profiles/{id}/templates/{category}`, dropped onto the schedule, the deal and
the settlement overview. `decisions.md` #16.11 already asks for modular section templates and a
management page; the old app shows the smallest version that is useful — a Save box and a list, per
section.

**10. A task that carries an amount is a budget line.** Todos with `budgetType` + `budgetAmount`
appear in the planner as read-only rows (`useBudgetCalculator.ts:79-91`). Note what the old app did
**not** do, despite the meeting asking for it: adding a freelancer to the crew does **not** create a
cost item (`CrewTab.tsx` has no budget linkage). The meeting's 01:43:43 item is unbuilt in both apps.

---

## 4. Where an old prefill would now be WRONG

**a. The production cost split. Proven, and it moves money.** I created an event with a `guarantee`
deal, never opened the cost section, and never saw a split field. The stored deal reads
`artistCostSplit: 20, promoterCostSplit: 50, venueCostSplit: 30` (`events/EVT-905744/deal/main`), and
the event page prints *"Production Costs Split (A/P/V/O) 20% / 50% / 30%"*
(`old-app-flows-09-created-event.png`). It is not inert: `src/lib/models.ts:412-426` deducts
`totalProdCosts × artistCostSplit/100` from the performer's payout and labels it "Production cost
share (20%)". So an artist on a flat guarantee silently loses a fifth of the production costs.
`decisions.md` **#16.3** forbids exactly this — *"Creating a deal must **not** pre-fill a `cost_split`;
it starts empty/zero and the operator opts in"* — and the 2026-08 meeting logs it twice (01:00:17 and
"the production system requires a defined rule: either a cost split or a single payer"). **Do not port;
our blank is the correct behaviour.**

**b. The invisible 70/20/10 revenue split.** Same event, same mechanism: `artistSplit 70 /
promoterSplit 20 / venueSplit 10` are written on a `guarantee` deal where no split field is ever
rendered. Harmless in that engine only because a guarantee path ignores them. Ours writes them into
`extras.dealDraft` where nothing reads them — harmless for a different reason, and equally not a
design. **A split figure should not exist until a split deal does.**

**c. Default commission percentages.** `AVAILABLE_PARTIES` ships Booker/Agent **15%**, Promoter 20%,
Management **10%** as one-click defaults on the event's deal. `decisions.md` #14 makes the agent
"never a separate entitled party" and the commission rate private between agent and performer;
`story.md` rules out a manager entirely. A default rate for a party that must not appear on the event
settlement is doubly wrong. **Do not port.**

**d. Copying the venue's amenities onto the event as a silent snapshot.** The mechanism is right; the
old app's version is unconditional at create *and* re-offered at edit. Ours fills a blank once. Keep
ours. Worth remembering that these are **snapshots** — a venue that later adds "Wheelchair Accessible"
does not update last year's shows, which is correct for a document and surprising for a list, so the
copy should read as a copy.

**e. Auto-creating contacts from typed names.** Useful (mechanism 8), but it writes a third party's
name into your CRM without asking. `docs/gdpr.md` should be checked before porting verbatim; the
conservative version writes the contact only for names that were *picked* or explicitly confirmed.

**f. Auto-linking a typed performer name to a real profile AND inviting them in one step.** Measured:
typing "Aurora" attached `seed-artist__aurora`, pushed the event into that account's `accessUids` and
set the status to `suggested` — no confirmation, on an exact name match. Name-matching a real
counterparty into a booking is a claim about identity. Keep the resolution; **do not keep the silent
invite.**

---

## 5. Prioritised plan

### BUILD NOW

**1. Attach a room to an event, and take capacity from the room.** *Reason: it replaces a wrong figure
with a right one.* We prefill the building's capacity onto every show; the old app took the room's
(measured: 500 → 350 on picking Main Hall). Every downstream number that leans on capacity — the
budget's seeded ticket tier at 80%, break-even, the settlement's expectations — inherits the error.
`events.stage_id` is accepted by the API and written by nothing (audit **A-31**), `ProfileRoomsCard`
already creates rooms with capacities, and `useEventVenuePrefill` is the one place to change.
Citations: `EventDetailsStep.tsx:161-186`; `apps/web/src/components/useEventVenuePrefill.ts:60-70`.

**2. Ask for the venue's country and capacity during onboarding.** *Reason: it is the input to every
other prefill, and its absence corrupts an authoritative money field.* Base currency defaults to
`FALLBACK_CURRENCY = "EUR"` whenever the acting profile has no country
(`packages/shared/src/currencies.ts:84-89`), and `events.base_currency` is authoritative for the deal
and locked at settlement. A Swedish operator who never opens the profile editor books in EUR forever.
The old signup asked for city/country/capacity per profile (`SignupPage.tsx:603-632`). Add the two or
three questions to `OnboardingFlow.tsx` — territory is also what `decisions.md` #17 derives the market
from, so this is not only a convenience.

**3. Make the wizard's deal step produce a deal.** *Reason: the operator states terms today and the
app throws them away.* `NewEventWizard.tsx:407-415` writes `extras.dealDraft`; nothing reads it —
verified by grep across `apps/` and `packages/`. Either create a real `deals` row from it (the old app
wrote `deal/main` at create) or carry it into the Deals tab as the composer's opening draft. Leaving
it as a jsonb blob is the worst of the three, because the screen implies it was recorded.
**Constraint:** whatever it writes must obey `decisions.md` #16.3 — no cost split, and no split
percentages unless the chosen structure has splits.

**4. Auto-attach `is_default` library riders when a participant accepts.** *Reason: already decided,
schema already carries it, and today the app promises it in copy it cannot keep.* `decisions.md` #13:
*"`is_default` library riders one-click-add (or auto-attach) when the owner becomes an
`event_participant`. Kind-agnostic."* The old app's `migrateCollaboratorRidersOnAccept` is the working
reference, including the on-accept-not-on-invite rule and idempotency by deterministic id. Pair it
with an explicit "attach one I already have" action, since `RiderUploadModal.tsx:68-70` already tells
the user that is possible.

**5. Seed the default schedule.** *Reason: decided, cited to this exact source, cheap.* `decisions.md`
#16.4: *"Default schedule — seeded, fully editable, reorderable. From the old app: Get in → Soundcheck
→ Doors open → Support Act → Show start → Curfew → Clear venue."* Nothing in `apps/` contains the word
"Soundcheck" outside a comment. Note the old app made it a **user-invoked "Load Defaults"** shown only
on an empty list (`EventDetailsTab.tsx:1277-1286`) while the decision says "seeded" — see Questions.

**6. Carry catering and accommodation notes from the venue profile.** *Reason: two fields we ask for
and never use.* `VenueDetailsFields.tsx:123-129` collects them; no event ever reads them. The old app
put them on the event at create and surfaced them as hospitality riders on accept
(`useEventMutations.ts:567-585`). Blank-only fill, same rule as amenities.

### BUILD LATER

**7. Duplicate an event.** We have none; the old app had two, deliberately different: a menu action
that clones the event doc as a draft while stripping identity, parent/child links, access and the
source-request back-reference (`useEventMutations.ts:826-887`), and a "duplicate" that reopens the
wizard **prefilled with the artist, venue and deal terms** so the user picks a new date
(`EventManagerPage.tsx:398-411`). Neither copies riders, schedule or crew — which is the obvious
improvement rather than a constraint to inherit. For a venue running a weekly night this is the single
biggest keystroke saver in the report; it is BUILD LATER only because it saves typing rather than
preventing an error.

**8. Write contacts back from the create flow.** Venue, ticketing provider and performer names become
contacts, with the "never one of my own profiles" and "never a duplicate" guards
(`useCreateEventSubmit.ts:157-172`). Check `docs/gdpr.md` first, and consider limiting it to names the
user picked rather than typed.

**9. Per-profile section templates.** `SectionTemplateMenu.tsx` over schedule / amenities / deal, as
the small end of `decisions.md` #16.11 and the meeting's "templates for shared budgets… valuable for
recurring events with the same promoters" (01:31:39).

**10. Auto-select the single owned venue.** When an operator account has exactly one venue profile,
select it (and thereby its capacity, city and amenities) instead of making them pick it every time.
Small, safe, and the old app's version had a real bug worth not repeating: the default role is
preselected without running its side effects, so the prefill silently depends on whether the user
clicked the already-selected card.

**11. Keep the revenue split summing to 100 as the user types.** `CreateEventDialog.tsx:210-215`
derives the third leg. The meeting is explicit (00:15:45): *"the total must add up to 100%"*. We
validate but do not help.

**12. Seed the deal type from the venue profile's `dealTypes`.** Both apps collect it; neither reads
it. Only worth doing after item 3, and only as a preselection in a visible field.

**13. A completeness signal on the profile — as guidance, not yet a gate.** The old app's list
(bio / photo / music link / tech rider / setup or video / genre) is a good starting definition for a
performer. Whether it should *block* anything is a product decision, not a port (Questions).

### DO NOT BUILD

**14. Any default production cost split.** `decisions.md` #16.3, and §4a above proves it deducts real
money from an artist who never saw the field. Our blank is the answer.

**15. Split percentages on a deal that has no splits.** Same root cause; a figure should not exist
until the structure that uses it does.

**16. Default commission rows and rates (Agent 15% / Promoter 20% / Management 10%).**
`decisions.md` #14 (the agent is never a separate entitled party, the rate is private) and `story.md`
(no manager role at all).

**17. Auto-inviting a performer resolved from a typed name.** Keep the resolution and the stub; drop
the silent push into someone else's dashboard. Measured behaviour, §4f.

**18. Performance bonus thresholds on the profile.** Collected in the old profile editor, consumed by
nothing, and the meeting defers escalators explicitly ("Postpone complex structures").

**19. Copying a whole event including its collaborators' access.** The old duplicate strips
`accessUids`, `accessProfileIds`, `sourceRequestId` and the parent/child links, and it is right to.
Whatever we build for item 7 must strip the same class of thing: identity, other parties' access, and
any back-reference to the thing that caused the original.

---

## 6. Questions for the owner

1. **Is the default schedule offered or asserted?** `decisions.md` #16.4 says "seeded"; the old app
   made it a button on an empty list. Seeding writes seven rows onto every event including ones that
   will never use them; offering costs one click. Which do you want?

2. **Should a profile's completeness gate anything in the rebuild?** The old app blocked a performer
   from sending offers until bio + photo + music + tech rider + setup/video + genre existed, and
   enforced it server-side. That is a real product position (a venue should never receive a blank
   pitch) with a real cost (a new user cannot do the first thing they came for). Keep the gate, keep
   only the nudge, or drop both?

3. **Does an event's capacity belong to the room or to the event?** If a show moves from the Club Room
   to the Main Hall a week out, should capacity follow the room automatically, or stay at whatever was
   agreed? The old app copied once and never looked back. I have assumed copy-once-then-independent,
   like every other prefill, but a room change is a different event.

4. **Should the create wizard link a typed performer name to an existing profile at all?** The old app
   did it on an exact case-insensitive name match. "Aurora" is a name several acts have. The safe
   version offers the match and lets the operator confirm; the old version decided.

5. **Do we want un-acquired / stub profiles created from the create wizard?** We already create
   performer stubs from the participants route. Doing it in the wizard means a typed name becomes a
   claimable profile object immediately — good for continuity, and it puts a name in our database for
   someone who never asked to be there. Where is the line?

6. **Eager or lazy settlement scaffolding?** The old app wrote `revenue/main` and a `settlement/main`
   with an approval row per party at event creation. We create the budget eagerly and the settlement
   lazily. Eager makes "is everyone signed off" answerable from day one; lazy avoids rows for events
   that never happen.

7. **Is auto-creating contacts from typed names acceptable under our GDPR position?** It is the
   mechanism behind "the second event is faster than the first", and it also means typing a promoter's
   name files them in your CRM.

---

## Appendix — the two probe events

Both created through the real wizard as `daniel.islandman@showme.music` acting as **The New Test
Venue**, then read back from Firestore.

| | `EVT-572839` "PREFILL PROBE EVENT" | `EVT-905744` "COSTSPLIT PROBE" |
|---|---|---|
| Typed by hand | name, "Aurora", a date | name, a date |
| Arrived carrying | venue name, `roomStage: Main Hall`, `capacity: 350` (the room's, not the venue's 500), 8 `amenities`, `performerProfileId: seed-artist__aurora`, the performer's owner uid in `accessUids`, `status: suggested`, a full `deal/main`, `revenue/main`, `settlement/main` with per-party approvals | the same venue/amenity inheritance, plus a `deal/main` reading `dealType: guarantee`, `artistSplit 70 / promoterSplit 20 / venueSplit 10`, `artistCostSplit 20 / promoterCostSplit 50 / venueCostSplit 30` — **none of which was ever shown to the operator** |

The second row is the whole argument of §4 in one line: the old app's generosity with defaults is not
separable from its willingness to assert figures nobody entered.
