# What the old app does that the rebuild still does not — 2026-09-26

**Subject:** every user-facing capability in the retired Firebase app at `../showme-settle-fast`,
checked against the rebuild **as it stands on 2026-09-26** (`main` @ `3b8644c`), and cross-referenced
against the ClickUp Tech → General board (list `901524472815`, 233 tasks read across 3 pages).

**Why this exists even though five analyses already do.** `docs/old-app-analysis-features.md` and its
four siblings were written **2026-08-26**. Their description of the *old* app is still good and this
document builds on it. Their conclusions about what the *rebuild* lacks are a month stale, and the
stalest part is the part that mattered most: **four of the five items on that doc's "BUILD NOW" list
have since been built.** Share & Export, the share viewer, off-platform approval and per-section
comments all ship today (`apps/web/src/routes/ShareViewer.tsx`, `components/ShareExportModal.tsx`,
`POST /shares/:token/approve`, `POST /shares/:token/comment`). Only item 5 — the profile switcher —
is still open. Anyone scoping from that doc without checking the code would re-specify work that is
done, which is the exact failure `CLAUDE.md` records for 2026-08-27.

**Method.** Old side: the router (`src/router.tsx`, 39 pages), every page, every non-primitive
component under `src/components/` (~50 top-level + 9 feature folders), and all 27 Cloud Function
modules in `functions/src/` — where most of the hidden features live. New side: `apps/web/src/router.tsx`,
`routes/`, 161 components, all 36 route modules in `apps/api/src/routes/` (≈180 endpoints),
`apps/jobs/src/`, `packages/settlement/src/`, and all 63 tables in `packages/db/src/schema/`. Every
finding below names a file and symbol on the old side and says what was searched on the new side.

**Judgement basis.** "Should the rebuild have this?" is answered from `docs/story.md`'s purpose-and-boundary
per account kind and from `docs/decisions.md` (#1–#24), not from the old app's habits. Several old
behaviours were bugs or workarounds; those are called out as such rather than filed as gaps.

---

## Headline

| | count |
|---|---|
| **MISSING, no ticket** | **9** |
| MISSING, ticketed | 5 |
| **PARTIAL, no ticket** | **5** |
| PARTIAL, ticketed | 5 |
| PRESENT (old capability covered, often better) | 58 |
| Deliberately dropped (decision cited) | 11 |

The genuinely new information in this document is the two bolded rows. Everything else is either
already on the board or already built.

---

## 1. MISSING — real capability in the old app, nothing equivalent in the rebuild, **no ticket**

Ranked by what it costs the business to launch without it.

### M1. Nobody can put a customer on a paid plan — the admin console has an API and no screen

- **Old:** `pages/AdminPlansPage.tsx` — search every profile, filter by plan and role, see Owner /
  Plan / Status / **Seats** / **Renews**, reassign a plan immediately. Backed by
  `functions/src/plans.ts:453 listProfilesForAdmin` and `plans.ts:565 setPlan`.
- **New:** the API is complete and tested — `GET /admin/profiles`, `PATCH /admin/plans/:profileId`,
  `GET /admin/audit`, `GET /admin/alerts`, `GET /admin/configuration`,
  `GET|PUT|DELETE /admin/performing-rights-rates/:country` (`apps/api/src/routes/admin.ts`, 489 lines).
  **Searched:** `grep -rn "AdminProfiles\|AdminPlans\|AdminAlerts\|AdminAudit" apps/web/src` → **no
  hits**. No route in `apps/web/src/router.tsx`, no nav entry in `shell/navigation.ts`, no generated
  hook consumed.
- **Why it ranks first.** `docs/decisions.md` #5 and the old `plans.ts` agree that v1 moves no money:
  plan assignment is **manual**, and `POST /plans/:profileId/request` mails a request to a sales inbox.
  With no console, the only way to honour that request is hand-written SQL against production. The
  same screen is the only surface for `seats` — the meeting's own charging model — and for the audit
  log and the alert queue. Launching means selling; selling means this screen.
- **Cost:** high. **Effort:** low — one route over six existing endpoints.

### M2. A user who forgets their password cannot get back in

- **Old:** `functions/src/index.ts:137 sendPasswordReset` (Firebase reset link via the branded
  `passwordResetEmail`, `emailTemplates.ts:46`), `index.ts:176 sendVerifyAndChangeEmail`
  (verify-then-change the sign-in address, `emailTemplates.ts:82`),
  `pages/ResetPasswordPage.tsx`, `components/settings/ChangePasswordDialog.tsx`,
  `components/settings/ChangeEmailDialog.tsx`.
- **New:** `apps/web/src/auth/AuthScreen.tsx` is 122 lines of sign-in / sign-up and nothing else.
  `routes/Settings.tsx:509 SecurityPanel` renders an `EmptyState` whose own copy says *"In-app password
  change and 2FA aren't available yet."* **Searched:** `grep -rni "forgot\|sendPasswordResetEmail\|
  updateEmail\|verifyBeforeUpdateEmail" apps/web/src apps/api/src` → no auth-related hits. No
  password-reset email template in `apps/api/src/lib/email-templates.ts` (8 templates; the old app had 13).
- **Why it ranks second.** This is not a feature, it is the floor. Every real user base generates
  forgotten passwords on week one, and the only remedy today is an operator editing Firebase Auth by
  hand. Changing a sign-in address has the same shape.
- **Cost:** high (support load, churn on day one). **Effort:** very low — Firebase client SDK plus one
  email template.

### M3. The venue handoff exists end-to-end in the API and is unreachable from the app

- **Old:** the whole of `functions/src/venueHandoff.ts` (718 lines) plus
  `components/event-manager/VenueHandoffBanner.tsx` (302 lines) and
  `components/CreateDraftWithVenueHandoffDialog.tsx`. A performer drafts a show at a venue that is not
  on shoWMe and hands management of it over: create (`:200`), **cancel** (`:331`), **resend** (`:424`),
  **redirect to a different address** (`:493`), and a daily job (`:571`) that warns the performer at
  day 83 (`venue_handoff_expiring`) before expiring at 90.
- **New:** `POST /events/:id/handoff` is built (`apps/api/src/routes/inbound.ts:1780` — creates the
  unclaimed stub profile, mints the `venue_handoff` invitation, stamps `expires_at` at 90 days, emails
  the venue) and `apps/jobs/src/reapers.ts:65` expires it. **Searched:** `grep -rn "IdHandoff"
  apps/web/src apps/web/tests` → **no hits**; the generated `postApiV1EventsIdHandoff` exists in
  `packages/api-client` and has **no caller anywhere**. No cancel / resend / redirect route
  (`grep -rn "resend\|redirect\|cancelHandoff" apps/api/src/routes/inbound.ts` → nothing). No
  pre-expiry warning (the reaper flips status and notifies nobody).
- **Judgement.** `story.md` makes the performer's world "my bookings", and #16.16's growth thinking
  makes bringing a venue onto the platform the loop. A built API with no door is the cheapest gap on
  this list to close and the one with the largest ratio of value to new code.
- **Cost:** high (it is a growth loop, and the code is already paid for). **Effort:** low for the UI,
  low for the three lifecycle routes.

### M4. An anonymous booking requester is never told yes or no

- **Old:** `functions/src/notifications.ts:748 onBookingRequestUpdated` — on `accepted` / `declined`
  it emails the anonymous requester via `bookingRequestStatusEmail` (`emailTemplates.ts:555`), as well
  as notifying the team in-app.
- **New:** `PATCH /booking-requests/:id` (`apps/api/src/routes/inbound.ts`) notifies only
  `requester.channel === "profile"`. The code says so out loud: *"A public-form sender is reachable by
  EMAIL and is deliberately not mailed here … 'Make Offer' is the door that writes to them."* The
  counter-offer route **does** mail them (`inbound.ts:1751`), so the plumbing exists and only this arm
  is missing.
- **Judgement.** The public request form on a venue's page is a front door we advertise
  (`apps/marketing/availability.html`, `POST /booking-requests`). A stranger who uses it and hears
  nothing back concludes the venue ignored them, which is a reputational cost carried by the customer.
  The in-code reasoning is honest but it trades a two-line email for silence.
- **Cost:** medium-high (it is the public face of the product). **Effort:** very low.

### M5. Admin alerts are read and never written

- **Old:** `functions/src/expansionAlert.ts:33 onStubProfileCreatedExpansionCheck` — tallies unclaimed
  venue stubs per EU country and writes a one-time `expansion_threshold_crossed` alert at 10; the spam
  side is counted in `plans.ts` (`spamFlagsLast90d`, `collabInviteSuspended`).
- **New:** the table and the vocabulary exist — `admin_alerts` with
  `admin_alert_kind = ['spam_threshold','expansion_threshold']` (`packages/db/src/schema/enums.ts:316`)
  — and `GET /admin/alerts` reads it (`admin.ts:269`). **Searched:** `grep -rn "adminAlerts" apps packages`
  (excluding `dist` and `*.test.ts`) → the **only** occurrences are the schema definition and the read
  in `admin.ts`. **Nothing ever inserts a row.**
- Partly ticketed: the expansion signal is inside [Territory: EU-only sends, country stamp on auto-created accounts, 10-account expansion signal](https://app.clickup.com/t/86cbcbhvx) (`normal`, `backlog`) and again inside [Feature: Performer ↔ Venue invitation & offer system](https://app.clickup.com/t/86cbadt7d). **The spam-threshold alert has no ticket at all** — `canUseFeature("not_spam_suspended")` correctly suspends a profile at 3 distinct reporters (`apps/api/src/lib/entitlements.ts`, tested at `entitlements.test.ts:316`), but nobody is ever told it happened.
- **Cost:** medium (a suspension nobody sees is a support ticket nobody can answer). **Effort:** low.

### M6. No way to email a team member from inside the app

- **Old:** `functions/src/index.ts:270 sendTeamMemberEmail` (paid-plan gated, Reply-To the sender,
  `teamMemberMessageEmail` at `emailTemplates.ts:524`) + `components/team/EmailTeamMemberDialog.tsx`.
- **New:** `routes/Team.tsx` is 1052 lines of real roster management and has no compose/send.
  **Searched:** `grep -rn "Email\b\|mailto\|sendEmail" apps/web/src/routes/Team.tsx
  apps/web/src/components/TeamMemberEditModal.tsx` → only `nameFromEmail` helpers. No API route.
- **Judgement.** Defensible to skip — `story.md` gives crew "the schedule and their own deal", and
  tasks + notifications now carry most of what the old email carried. But the old feature was
  Pro-gated, i.e. something we intended to *charge* for, and it is the only way to reach an
  off-platform crew member who has no account.
- **Cost:** low-medium. **Effort:** low.

### M7. Dashboard has no generated "what to do next"

- **Old:** `pages/Index.tsx` — a **System Recommendations** block of generated, dismissible next
  actions, alongside My Tasks and Recent Activity.
- **New:** `routes/Dashboard.tsx` (649 lines) has KPI bands, tasks and activity.
  **Searched:** `grep -n "Recommend\|next action\|suggest" apps/web/src/routes/Dashboard.tsx` → one
  unrelated `NEEDS_DECISION` status set.
- **Judgement.** `decisions.md` #16.14 names exactly this as the natural first surface for the
  assistant layer ("April has 4 holds…", "confirm all shows through April"). Worth building as a
  plain derived list now so the assistant has somewhere to land later.
- **Cost:** low. **Effort:** medium.

### M8. Duplicate an event

- **Old:** `components/event-manager/EventActionsMenu.tsx` — archive / **duplicate** / cancel /
  copy-link / delete.
- **New:** **Searched:** `grep -rn "Duplicate" apps/web/src/routes/Events.tsx routes/EventDetail.tsx
  components/EventRowMenu.tsx` → nothing. The row menu's only entry is Archive
  (`hooks/useEventArchive.tsx:198`). Cancel/delete are separately ticketed
  ([Cancel Delete events + small UI](https://app.clickup.com/t/123qy9rpdup), `urgent`); duplicate is not.
- **Judgement.** A residency or a weekly club night is the same event with a new date. `decisions.md`
  #16.11's event templates are the richer answer, but duplicate is the cheap 80%.
- **Cost:** low-medium (operator time, every week). **Effort:** low.

### M9. Embedded venue map

- **Old:** `components/VenueMap.tsx` — Leaflet + OSM tiles, pin on the venue.
- **New:** **Searched:** `grep -rliE "mapbox|leaflet" apps/web/src` → nothing.
  `components/ProfileNameMenu.tsx` offers a *link* to Google Maps (ticket
  [Address and country missing from calendar and event manager](https://app.clickup.com/t/123qy9rnfab)),
  and `AddressAutocompleteField` + `GET /geocode` provide coordinates, so the data is there.
- **Cost:** low (a link does the job). **Effort:** low. Listed for completeness.

---

## 2. MISSING — but already ticketed (do not re-scope)

| Gap | Old-side evidence | New-side check | Ticket |
|---|---|---|---|
| **Off-platform cold offer** — pitch a venue that has no account, with a claim link | `functions/src/performerOffer.ts:232` (stub venue profile + `performer_offer` code + `performerOfferEmail` handed back for **mailto**, so deliverability stays on the performer's own domain, `emailTemplates.ts:456`) | `POST /offers` requires `targetProfileId: z.string().uuid()` (`inbound.ts`); `booking_requests.sent_via` (`booking_sent_via ['in_platform','mailto']`) is written only by `packages/db/src/seed.ts:1077` and read by **nothing** (`grep -rn "sentVia" apps/api/src apps/web/src` → no hits); the `performer_offer` invitation source exists (`invitations.ts:56`) and no route mints one | [Feature: Performer ↔ Venue invitation & offer system](https://app.clickup.com/t/86cbadt7d) — `urgent`, `backlog`. **Note the design difference:** the ticket says shoWMe sends the external email; the old app deliberately did *not*, handing back a `mailto` so a cold pitch never went out on our domain. Worth deciding explicitly. |
| **Idle logout** | `src/lib/idle-logout.ts` (60 min timeout, 59 min warning, cross-tab `BroadcastChannel`) + `components/IdleLogoutWarning.tsx` | `grep -rli "idle" apps/web/src` → only budget-editor and realtime-stream hits; no auth idle timer | [Auto logout](https://app.clickup.com/t/123qy9rnk3m) — `urgent`, `backlog` |
| **Profile-completeness gate before an invite or offer can be sent** | `functions/src/performerOffer.ts:100 getMissingPerformerFieldsServer` + `src/lib/profileCompleteness.ts` + `components/WelcomeBanner.tsx` | no completeness check on `POST /offers` or `POST /invitations` (only `canUseFeature`) | [Profile-completeness gate before an invite or offer can be sent](https://app.clickup.com/t/86cbcbfzm) — `high`, `backlog`; also inside `86cbadt7d` |
| **Counterparty dedup by name + city** | `functions/src/invitations.ts` auto-creates a Contact per invite; dedup was by email only (the old app had the same bug) | no name+city dedup on stub creation (`inbound.ts:1801` mints `handoff-${suffix}` unconditionally) | [Counterparty dedup by name + city, so one venue doesn't become three orphan accounts](https://app.clickup.com/t/86cbcbhmn) — `normal`, `backlog` |
| **Hold ranking has no interface** | `functions/src/holds.ts:135 setHoldRank` + `holdRankLogic.ts` | every route exists (`/events/:id/hold/{rank,confirm,decline,release,auto-promote}`) and `components/EventHoldPanel.tsx` + `HoldPlacement.tsx` render some of it | [Hold ranking has no interface](https://app.clickup.com/t/123qy9rpdtn) — `backlog`. Partly built since the ticket was filed; re-check before scoping. |

---

## 3. PARTIAL — exists but thinner, **no ticket**

### P1. No global profile switcher — the whole app follows `memberships[0]`

- **Old:** `pages/ProfilesPage.tsx` profile chips at the top of the page, plus a switcher in
  `components/AppSidebar.tsx`, so the acting profile was changeable from anywhere.
- **New:** `apps/web/src/lib/activeProfile.ts:6` says it in its own docstring — *"AuthProvider keeps it
  in sync with the session; **a full profile switcher can set it later**."* `auth/AuthProvider.tsx:145`
  sets `memberships[0]`. It *can* be changed in two places — `routes/Profiles.tsx:157` and
  `components/NewEventWizard.tsx:744` — but `shell/AppShell.tsx:289`'s user menu offers only Sign out.
- **What's thinner:** an owner with a venue profile and a promoter profile has no way to switch which
  one the nav, the dashboard, the calendar and every `X-Profile-Id`-scoped mutation act as, except by
  visiting `/profiles` first or starting an event.
- **Judgement.** This is the last live item from the 2026-08-26 "BUILD NOW" list and the remainder of
  audit finding A-25. `story.md` makes "roles are per-event; kinds are per-account" load-bearing, and
  multi-profile accounts are a paid-tier feature (`decisions.md` #22) — so the switcher is the thing
  the tier is sold on.
- **Cost:** medium-high for multi-profile customers, zero for single-profile ones. **Effort:** low.

### P2. No sort and no group-by on any list, at the API or the UI

- **Old:** `pages/TasksPage.tsx` had a sort control ("Oldest first") and a **Group by: Event**
  selector; `pages/EventsPage.tsx` had sortable columns (Event / Performer / Venue / Host / Date / Status).
- **New:** **Searched:** `grep -rn "sort" apps/api/src/routes/events-list.ts apps/api/src/lib/pagination.ts`
  → nothing; `grep -rn "sort" apps/web/src/routes/{Events,Tasks,Settlements}.tsx` → nothing. Filter
  chips and server-side search are present and good; ordering is fixed.
- **What's thinner:** `decisions.md` #15 promised *"Every list endpoint ships a filter/sort query
  contract + cursor pagination from day one … No endpoint re-shaping when filters land."* Cursor
  pagination and filters landed; **sort did not**, so the promise's whole point — that the UI can add a
  control without an API change — is not available.
- Ticketed only for one list and one axis: [Events order in list - By date/By creation](https://app.clickup.com/t/123qy9rpe3y)
  (`urgent`, `backlog`). Nothing covers group-by or the other eight lists.
- **Cost:** medium. **Effort:** medium (API contract first, then each screen).

### P3. Export produces CSV and a browser print dialog, never a PDF

- **Old:** `components/BudgetExportActions.tsx` — a real branded PDF via `jsPDF` +
  `jspdf-autotable`: header banner, coloured summary cards, tables, pagination guard. Print HTML
  (`components/export-event/buildPrintHTML.ts`) was the *second* path, not the only one.
- **New:** **Searched:** `grep -rliE "jspdf" .` across the repo → **nothing**.
  `components/useShareExport.ts:218` states it plainly: *"PDF is still the browser's print dialog —
  that is where 'Save as PDF' lives and no PDF library exists anywhere in this repo."* CSV is real and
  shared between the file and the print (`lib/shareExport.ts`, `packages/shared/src/csv.ts`).
- **What's thinner:** `decisions.md` #15 explicitly commits to *"generate CSV/PDF client-side from
  already-fetched data (jsPDF)"* as a **v1 feature**. A settlement statement a venue can attach to an
  email is a document, and `Ctrl-P → Save as PDF` is not one a non-technical operator will find.
- **Cost:** medium (it is the artefact the money conversation happens over). **Effort:** medium.

### P4. The share section tree is much coarser than the old one

- **Old:** `components/export-event/SectionSelector.tsx` + `types.ts` `TAB_SECTIONS` — three
  granularities (All Event Details / Specific **Tab** / Specific **Section**) over 21 section ids
  including `crew`, `guest-list`, `to-do`, `amenities`, `private-notes`, `budget-calculator`,
  `deal-structure`.
- **New:** `apps/web/src/lib/shareScope.ts:26 SHARE_SCOPES` — 6 view scopes (`event.view`,
  `schedule.view`, `rider.view`, `budget.view`, `deal.view.own`, `settlement.view.own`) + 3 act scopes
  (`agreement.confirm`, `settlement.confirm`, `message.post`), mirrored by
  `apps/api/src/lib/share-scope.ts`. The mechanism is better — the tick-box *is* the capability, the
  serializer decides, the ceiling refuses what the link claims — but there is no way to share **the
  crew list**, **the to-do list**, **the guest list** or **amenities**, all of which the old app shared
  and all of which are the day-sheet things an off-platform party actually asks for.
- **Judgement.** This is open question #4 from the 2026-08-26 doc ("section-level granularity mapped
  onto capabilities, or is target-kind granularity enough?"), never answered. Adding four capabilities
  is a smaller change than it looks.
- **Cost:** medium (advancing is the agent-facing word `decisions.md` #16.19 keeps deliberately, and
  this is advancing). **Effort:** low-medium.

### P5. User-defined derived budget fields

- **Old:** `components/FormulaBuilder.tsx` + `src/lib/budget-types.ts` (`FormulaNode`,
  `evaluateFormula`, `formulaToString`) behind the budget's **"Add Result Field"** — a user could
  define a derived field as an expression over other fields.
- **New:** `components/BudgetCustomFieldModal.tsx` is amount-or-percentage-of-a-named-row
  (`DeductionShape = "amount" | "percentage"`, basis points, `:111`) — correct and money-safe, but not
  an expression builder. **Searched:** `grep -rli "formula" apps/web/src` → two comment-only hits in
  `useBudgetSeed.ts`.
- **Judgement — probably decide, not build.** This is open question #7 from 2026-08-26, unanswered.
  Arbitrary user expressions over money are a liability (`decisions.md` #16.2 removed the free-text
  deal type for exactly this reason: *"Free text breaks the settlement engine + DB integrity"*). The
  action here is a recorded decision, not a build.
- **Cost:** low. **Effort:** high if built. **Recommendation:** record a decision declining it.

---

## 4. PARTIAL — already ticketed

| Gap | What is thinner, precisely | Ticket |
|---|---|---|
| **Templates: 8 categories in the schema, 2 reachable** | `template_category` = `budget \| deal \| rider \| terms \| schedule \| crew \| settlement_overview \| settlement_deal` (`enums.ts:304`); `GET/POST/PATCH /profiles/:id/templates` validates per category (`profiles.ts:1928`). The web reads templates in exactly two places — `components/useBudgetToolbar.ts:88` (`category === "budget"`) and `components/useDealTermsEditor.ts`. No management page (old `pages/TemplatesPage.tsx`), no per-section save/load menu (old `components/SectionTemplateMenu.tsx`, which covered schedule, amenities, riders and settlement-overview). `decisions.md` #16.11 asks for composable section templates **and** a template-management page. | [Templates still missing inside the event details tab and sections](https://app.clickup.com/t/123qy9rpvfq) — `urgent`, `backlog`; [Templates data model](https://app.clickup.com/t/86caqukrj) — `backlog` |
| **Audience / fan CRM is an honestly-empty screen** | `routes/Audience.tsx:26` — `const CONTACTS: AudienceContact[] = []`, with a comment saying no operator read endpoint exists. `audience_rsvps` is written by `POST /public/events/:id/rsvp` and read by nothing; there is no `GET /profiles/:id/audience`. Old `pages/BillsInvoicesPage.tsx`-era audience was also a stub, but the old RSVP list was at least readable from the event. | [RSVP to Audience page - broken](https://app.clickup.com/t/123qy9rpdth) — `high`; [Audience is missing import export](https://app.clickup.com/t/86cbcepjp) — `high` |
| **Accommodation is one free-text field, not a record** | `decisions.md` #16.7 wants type (hotel/Airbnb/apartment), date range, location (same-as-venue or custom address) and notes, **appearing as a card on every relevant party's calendar**. New: `components/EventHospitalityCard.tsx:58` stores a single `accommodationNotes` string and `:33` acknowledges the cut. Old `components/event-manager/EventDetailsTab.tsx` also kept it as notes, so the rebuild is at parity with the old app — the gap is against our own decision. | [Accommodation](https://app.clickup.com/t/86ca3p88m) — `urgent`, `backlog` |
| **Contact detail** | Old `pages/ContactDetailPage.tsx` — one counterparty with history, payout identity and linked events. New `routes/Contacts.tsx` (489 lines) is a list plus an add/edit `Modal`; payout details are on the card, history and linked events are nowhere. Import **and** export both exist (`hooks/useContactsCsv.ts`, `POST /profiles/:id/contacts/import`), so the 2026-08-26 doc's item 9 is half done. | [Contacts UI/UX](https://app.clickup.com/t/123qy9rngc8) — `urgent`, `backlog` (does not name the detail view; worth adding as a comment when someone picks it up) |
| **Profile hover-preview** | `decisions.md` #16.6 says genre and promoter are *"surfaced via the profile hover-preview"*, and old `components/ProfilePreviewPopover.tsx` was a hover card with an add-to-contacts action. New `components/ProfileNameMenu.tsx` is a **click** menu (go to profile / maps) and its docstring argues the case for click over hover convincingly — but it carries no preview content, so #16.6's genre and promoter have nowhere to live. | [Address and country missing from calendar and event manager](https://app.clickup.com/t/123qy9rnfab) — `backlog`; [Genre / Style/mood missing and not presenting](https://app.clickup.com/t/86cbcf6gr) — `urgent` |

Two more thin spots, each one line and not worth a ticket on their own:

- **Message attachments.** `POST /events/:id/messages` accepts `attachments: z.unknown().optional()`
  (`apps/api/src/routes/messages.ts:37`) and the column is there;
  `components/EventMessagesTab.tsx` has no upload control (`grep "file\|attach\|upload"` → nothing).
  Old `components/EventMessages.tsx` had uploads and an emoji picker. The nearest ticket
  ([Uploading files - Rider and Documents](https://app.clickup.com/t/123qy9rnk1u), `urgent`) is about
  riders, not chat.
- **Embeddable booking widget.** Old `pages/BookingWidgetPage.tsx` at `/request-date/$slug` was an
  embeddable public form. `apps/marketing/availability.html` + `src/availability-request.ts` is the
  equivalent and is deliberately narrower (it documents why it asks for no fee); what is missing is
  only the *embeddable* framing — an iframe snippet a venue can paste on its own site.

---

## 5. PRESENT — the old capability is covered (often better). This is the proof of the sweep.

**Pages and screens**

1. Event workspace with tabbed panels — `routes/EventDetail.tsx` (1305 lines), 11 tabs incl. Event History.
2. Status stepper — `components/EventStatusTimeline.tsx`.
3. Per-event currency / display currency — `hooks/useDisplayCurrency.ts`, `components/CurrencyPeek.tsx`.
4. Invite collaborator — `components/EventCollaboratorInviteModal.tsx`, `POST /events/:id/invitations`.
5. **Share & Export** — `components/ShareExportModal.tsx` + `components/useShareExport.ts` (scope tick-boxes, recipients, Print/PDF, CSV, create link, revoke, "links already out").
6. **The share viewer** — `routes/ShareViewer.tsx` (453 lines), one chrome-less page driven by the serializer, live read not a snapshot.
7. **Off-platform approval (A-33)** — `POST /shares/:token/approve` (`shares.ts:889`), settlement and agreement subjects, party-scoped.
8. **Per-section comments on a share** — `POST /shares/:token/comment` with an explicit section, `components/ShareSectionCard.tsx`.
9. Share OTP gate — `components/ShareOtpGate.tsx`, `POST /shares/:token/otp` + `/verify`, 3 codes/hour per (share, email), 10/window per IP.
10. Publish toggle — `components/EventPublishPanel.tsx`, `POST /events/:id/publish`.
11. Archive / unarchive — `hooks/useEventArchive.tsx`, `POST /events/:id/{archive,unarchive}`.
12. Event list with status chips + server-side search — `routes/Events.tsx` (845 lines).
13. Settlements list + detail + who-owes-whom — `routes/Settlements.tsx`, `routes/EventSettlement.tsx` (1802 lines), `components/WhoOwesWhomBoard.tsx`.
14. Settlement change log — `routes/EventSettlement.tsx:1125 RevisionHistory` over `GET /activity`.
15. Event history / change log — `components/EventExtraTabs.tsx:274 EventHistoryTab`, `components/eventHistory.ts`.
16. Per-party settlement cards — `components/SettlementPartyCard.tsx`, `SettlementShares.tsx`, party-scoped (the old app's all-parties grid is a deliberate non-goal, see §6).
17. Send for review — `components/SendForReviewDialog.tsx`, `POST /events/:id/settlement/invitations`.
18. Settlement approvals + comments tables — `settlement_approvals`, `settlement_comments`.
19. Budget planner — `components/BudgetPlanner.tsx`, `BudgetTable.tsx`, `useBudgetEditor.ts`, `POST /events/:id/budgets/:bid/lines`.
20. **Collected-by / paid-by attribution** — `components/BudgetLineAttribution.tsx`, `CostSplitModal.tsx` (the thing the old app's planner never exposed).
21. Break-even chart — `components/BudgetBreakEvenChart.tsx`.
22. Budget KPI band — `components/KpiRow.tsx`, `BudgetBreakdownCard.tsx`.
23. Budget templates (save/load) — `components/BudgetTemplateDialogs.tsx`, `budgetTemplateDrafts.ts`.
24. Budget snapshot at settlement (#16.8) — `budget_snapshots`, `apps/api/src/lib/budget-snapshot.ts`, `GET /events/:id/settlement/planned-vs-actual`.
25. PRO / performing-rights estimator — `components/PerformingRightsEstimateCard.tsx`, `performing_rights_rates`, `GET /events/:id/performing-rights-rate`, admin rate CRUD.
26. VAT settings — `components/VatSettingsCard.tsx`, `/profiles/:id/billing`.
27. Deals + agreement, confirm and reopen — `components/EventDealsTab.tsx`, `DealComposerModal.tsx`, `DealReopenModal.tsx`, `POST /deals/:did/{send,confirm,reopen}`, `signature_hash` per `deal_parties`.
28. Agreement document view — `components/AgreementView.tsx`, `components/EventAgreementTab.tsx`.
29. Unsigned-agreement notice — `components/UnsignedAgreementsNotice.tsx`.
30. Calendar month/week/day + label mode + jump-to-date — `routes/Calendar.tsx` (1230 lines), `components/Calendar*`.
31. **Room / stage sub-calendars** — `components/MyCalendarsCard.tsx`, `hooks/useCalendarVenueFilter.ts`, `stages` table, `/profiles/:id/stages` (A-31 closed).
32. Mark unavailable on the grid — `components/CalendarUnavailableMark.tsx`, `useMarkUnavailable.ts`, `profile_unavailability`.
33. ICS export **and** import — `lib/calendarIcsExport.ts`, `components/CalendarIcsImportModal.tsx`, `POST /calendar/import`.
34. Google Calendar connect + sync (two-way mirror) — `routes/Integrations.tsx`, `calendar_connections`, `external_calendar_mirrors`, `/integrations/calendar/google/*`.
35. Availability share link — `components/AvailabilityShareModal.tsx`, `lib/availabilityShareLink.ts`, `apps/marketing/availability.html` (signed, revocable — the old base64 URL payload was a bug, see §6).
36. Holds: place, rank, confirm, decline, release, auto-promote — `components/EventHoldPanel.tsx`, `HoldPlacement.tsx`, `/events/:id/hold/*`.
37. Booking-request inbox with buckets, spam flag, counter-offer, draft-event — `routes/Requests.tsx`, `components/RequestTriageDialogs.tsx`, `hooks/useRequestTriage.ts`, `/booking-requests/:id/{counter-offer,draft-event,flag-spam}`.
38. **Outgoing requests / offers** (performer + agent) — `routes/Requests.tsx` outgoing view, `POST /offers` (decisions #18 item 6, ticket `86cb6305n` shipped).
39. Event invitations as a distinct group — `components/EventInvitationsCard.tsx`, `GET /me/event-invitations`.
40. Tasks with assignee, priority, due date, reminders — `routes/Tasks.tsx`, `components/TaskBoard.tsx`, `TaskFormModal.tsx`, `apps/jobs/src/task-reminders.ts`.
41. Tasks on the calendar grid — `components/CalendarDayAgenda.tsx` (tickets `86cbcbjfh`, `86cbcbja9` shipped).
42. Contacts with import and export — `routes/Contacts.tsx`, `components/ContactImportModal.tsx`, `hooks/useContactsCsv.ts`.
43. Crew / team: shared team vs in-house — `components/EventCrewPanel.tsx`, `POST /events/:id/crew/:pid/in-house`, `routes/Team.tsx`, `groups` + `group_members` + `group_profiles`.
44. Team access / permission sets — `components/TeamAccessPanel.tsx`, `GET /events/:id/permission-sets`, `permission_sets`.
45. Profiles: full EPK editor, media, rooms, riders, public preview — `routes/Profiles.tsx` (1037 lines) + 8 `Profile*` components.
46. Riders: profile library + event instances + preview — `components/RidersDocumentsCard.tsx`, `RiderUploadModal.tsx`, `RiderPreviewModal.tsx`, `riders`, `/profiles/:id/riders`, `/events/:id/riders`.
47. Schedule / day sheet — `components/EventScheduleCard.tsx`, `ScheduleList.tsx`, `schedule_items`, `/events/:id/schedule`.
48. Guest list — `components/EventDetailsTab.tsx` + `packages/shared` `GuestListEntry` / `guestListProblem`.
49. Hospitality / amenities / catering — `components/EventHospitalityCard.tsx`, `VenueSpecsCard.tsx`.
50. Event messages / chat with threads — `components/EventMessagesTab.tsx`, `useEventMessageThreads.ts`, `event_messages`, `/events/:id/message-threads`.
51. Notification bell, deep-links, sound, per-category in-app/email preferences — `components/NotificationBell.tsx`, `notificationDestination.ts`, `lib/notificationSound.ts`, `packages/db/src/notify.ts` (6 categories), `/notifications/preferences`. **65 distinct notification types** vs the old app's ~30 — richer, not thinner.
52. Realtime (SSE) — `hooks/useRealtimeStream.ts`, `apps/stream`, Postgres `LISTEN/NOTIFY`.
53. Invoices / bills with gapless numbering + payout identity — `routes/Invoices.tsx`, `components/InvoiceDetailModal.tsx`, `invoices`, `payout_accounts`, `/invoices/:iid/issue`.
54. Financial projections — `routes/Projections.tsx`, `GET /insights/profiles/:id/{summary,revenue}`.
55. Setlists (performer authors) + performed-works report (operator files) — `routes/Setlists.tsx`, `routes/Reports.tsx`, `setlists`, `setlist_shares`, `performance_reports`.
56. Plans, seats, caps, credits, spam suspension — `apps/api/src/lib/entitlements.ts` (7 features), `GET /profiles/:id/cap-status`, `POST /plans/:profileId/request`, `credit_ledger`, `components/UpgradeNotice.tsx`.
57. Onboarding with account-kind capture — `auth/OnboardingFlow.tsx`, `AuthProvider.tsx:99`.
58. Claim flow: prove the address, sign up with any email, notify the originally-invited address — `routes/InvitationLanding.tsx`, `/invitations/:token/{accept,claim,claim-otp,decline}`, `invitation_otps`, `renderInvitationClaimedEmail` (decisions #18/#19 of 2026-09-01; tickets `86cbcbgbe`, `86cbcbgmu` shipped).

**Plus, at parity or better and not in the old app at all:** agent representation and
representation-scoped commission settlement (`representations`, `packages/settlement/src/representation.ts`,
`commissions.ts`), event change requests (`event_change_requests`), GDPR export and erase
(`/me/export`, `/me/erase`, `apps/jobs/src/reapers.ts`), locked-FX at finalize
(`exchange_rate_cache`, `settlement_snapshots.data.lockedRates`), idempotency keys, the full audit
log with before/after diffs, and territory/market scoping.

---

## 6. Deliberately dropped — do NOT file these as gaps

| Old behaviour | Decision that drops it |
|---|---|
| `accessUids` fan-out and every maintained copy of it (`functions/src/profileMembers.ts`, 992–3208 LOC) | `CLAUDE.md` "Core architecture" #1: relational joins replace document denormalization. |
| Firestore-rules-shaped authorization + `profileClaims.ts` custom-claim sync | `CLAUDE.md` Stack: *"token carries only `uid`… **No custom claims**"*; `CLAUDE.md` #2: one authorization module. |
| `src/lib/settlementParties.ts` | `CLAUDE.md` "Reference source": it folds away a phantom "Promoter" card caused by a hardcoded party vocabulary; `deal_parties` dissolves the problem, so porting it would import a workaround for a bug we do not have. |
| Parent/child multi-performer event trees (`relayChildDateChangeResponse`, `notifications.ts:977`) | `CLAUDE.md` Key decisions: events are containers, profiles join as `event_participants`; **"No parent/child multi-performer."** (Ticket [Single to Multi peeformer event](https://app.clickup.com/t/123qy9rpchw) asks for multi-performer *events*, which `event_participants` already models — not the child-event tree.) |
| `CollaboratorAuthPage` — invitee sets a password, hashed in a Cloud Function, then signed in **anonymously** with a `sessionStorage` flag (`collaboratorInvitePassword.ts`, `joinEventAsCollaborator`) | `decisions.md` #6 + `docs/off-platform-access.md`: one engine, three front doors (public token / OTP→JWT / signed-in email match). A second credential store beside Firebase Auth. |
| Unsigned base64 share payloads in URLs (`/availability/eyJmcm9tIjoi…` carrying `ownerUid`, `profileId`) | Superseded by the `shares` table + signed, revocable tokens. This was a **bug**, not a feature: nothing signed it, nothing could revoke it, and it leaked internal ids. |
| Frozen `snapshotData` blobs behind a share ("does not update automatically") | The rebuild's shares store `capabilities` + `target` and read **live** — revocable, cannot drift (`ShareViewer.tsx` docstring). |
| All-parties financial cards on any shared or collaborator view (`SettlementReviewPage.tsx` renders `partyBreakdowns` wholesale, incl. an agent's and a manager's cut) | `story.md` performer boundary + `decisions.md` #4 (deal/settlement visibility is **pure** party-scoping) and #24 (the one grant that exists is the operator's, per settlement, audited). |
| Agent commission as an entitled party line on the event settlement, and the rate shown to the operator (`Booker/Agent: WME Agency (15%)`) | `decisions.md` #14: the agent is *"never a separate entitled party"*; commission lives in a second settlement private to agent + performer. Implemented as `packages/settlement/src/commissions.ts` + `representation.ts`. |
| A "Management" / manager party, contact type and cut (`Management: Starlight Mgmt (10%)`, `Manager (2)` column in Contacts) | `story.md` agent boundary: *"a booking agent, **not** a manager … the exclusions aren't limits to 'fix,' they are the definition of the role."* |
| `BillsInvoicesPage` as a payment-provider ledger, and the ticketing-provider integration screen | `docs/payments.md`: v1 processes no money. `decisions.md` #15/#16.19: ticketing stays an integration behind `budget_lines.source`, never first-party. Also deferred by decision: escalators, tiered splits, bar-percentage deal types, crew payroll (2026-08 meeting), performance bonus thresholds (ticketed separately as [Bonus tiers on a deal](https://app.clickup.com/t/123qy9rp8k3)). |

**Old behaviour that was a bug, not a feature** (recorded so nobody ports it): the availability share
URL above; `competingHoldIds` cancelling every sibling hold regardless of rank, so a 2nd hold could
confirm over a 1st (still an open product call in `decisions.md`); the old app's Budget Planner
having no collected-by/paid-by selectors at all, which is *where the meeting's complaint came from*;
and `vitest.config.ts:11` scoping `include` to `src/**`, so the old repo's five `functions/` suites —
`holdRankLogic.test.ts` among them — have never run in its CI either.

---

## 7. What to do, in order

1. **M1 admin console** — one screen over six finished endpoints. Without it nobody can sell.
2. **M2 password reset + change email** — the floor, half a day.
3. **M3 venue-handoff UI + cancel/resend/redirect + expiry warning** — a paid-for growth loop with no door.
4. **M4 outcome email to an anonymous requester** — two lines, public-facing.
5. **P1 global profile switcher** — the last live item from the 2026-08-26 list; multi-profile is a paid tier.
6. **P3 real PDF (jsPDF)** — `decisions.md` #15 calls it v1; a settlement statement is a document.
7. **P2 sort/group-by contract** — API first, per #15's own promise, then the screens.
8. **M5 write the admin alerts** — the spam-suspension half has no ticket and no voice.
9. **P4 four more share scopes** (crew, tasks, guest list, amenities) — advancing is what shares are for.
10. **M7 dashboard recommendations, M8 duplicate event, M6 email a team member** — cheap, in that order.
11. **Decide and record, don't build:** P5 formula builder (decline it — `decisions.md` #16.2's reasoning
    applies), platform invitation codes / closed-beta gate (unanswered question 1 from 2026-08-26 —
    the old `AdminInvitationsPage` has no equivalent and no ticket, because it is a go-to-market call),
    and whether the off-platform cold offer goes out on **our** domain (ticket `86cbadt7d`) or as a
    `mailto` the performer sends (the old app's deliberate choice).
