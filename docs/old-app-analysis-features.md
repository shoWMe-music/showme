# The old app, screen by screen — what to take, what to leave

**Written 2026-08-26.** Subject: the prior Firebase/Firestore app at `../showme-settle-fast`
(~389 TS/TSX files, 39 pages). Purpose: decide, per screen, whether the rebuild should grow an
equivalent — measured against `docs/story.md` (purpose + boundary), `docs/decisions.md`, and the
binding **2026-08 settlements-and-deals meeting**.

**This was done by running the old app, not by reading it.** Emulators + seed + Vite, logged in as
the seeded operator `daniel.islandman@showme.music`, clicked through every route that renders.
Where a claim rests on reading a component rather than seeing it, the text says so.

---

## How it was run (so the next person can redo it in ten minutes)

```
cd ../showme-settle-fast
npm install && npm --prefix functions install && npm run build:functions
# firebase.local.json = firebase.json with the emulator ports moved off 8090/9099,
# because THIS repo's dev stack already holds them.
npx firebase emulators:start --project showme-local --config firebase.local.json \
    --only auth,firestore,storage,functions        # 8390 / 9399 / 9699 / 5301, UI 4300
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9399 FIRESTORE_EMULATOR_HOST=127.0.0.1:8390 \
    npx tsx scripts/seed.ts                        # all accounts: password 123456
PORT=5183 npx tsx server.ts                        # default is 8080 — do not use it
```

`.env.local` in the old repo points the client at those ports (`VITE_FIRESTORE_EMULATOR_PORT`,
`VITE_FIREBASE_AUTH_EMULATOR_URL`, …). The seed produces a real workspace: 118 events, 3 profiles,
18 hand-written fixture events with deals, riders, crew, schedules and settlements. **`EVT-001`
("Neon Nights Festival") is the only fully-populated one** — use it.

Three snags worth knowing: the emulator suite dies on startup if `hosting` is included (it wants a
`dist/client` that does not exist); a crashed run leaves a `java` firestore process holding the
port; and `?tab=` deep links render blank on a cold load — click the tab instead.

---

## Every page

Our equivalents are `apps/web/src/routes/*` unless the row says otherwise (`apps/marketing/*` for
the public pages, `apps/api/src/routes/*` where the API exists but no screen does).

| Old page | What a user can do there | Our equivalent | The gap | Aligns? |
|---|---|---|---|---|
| **`EventManagerPage`** | The event workspace: 9 tabs (To Do · Budget Planner · Event Details · Agreement · Team/Crew · Settlement · Messages · Collaborators · Event History), a status stepper, per-event currency, Invite Collaborator, Share & Export, publish toggle, duplicate, archive | `EventDetail.tsx` — same nine, with **Deals** in place of Agreement | Ours is missing **Share & Export** entirely (see below), and the old Agreement tab's *signature/confirmation ledger* has no home in ours | **Yes** — "Deals" instead of "Agreement" is the meeting's own consolidation decision |
| **`SettlementReviewPage`** (`/review/$token`) | A chrome-less, token-gated page where a party reviews a finalized settlement, reads every line, **approves it**, and comments with file attachments | **none** — `POST /shares/:token/comment` exists; approve does not | The whole page. This is audit **A-33** ("off-platform parties can comment but never approve") with a working reference implementation | **Partly** — the *act* aligns; **what it shows does not** (see conflicts) |
| **`CollaboratorEventView`** (`/collaborate/$eventId/$token/view`) | Read-only event tabs (Details · Agreement · Crew · Riders, plus Budget only at `permission === "admin"`), a **comment box per section**, and **confirm the agreement as your party** | **none** | The entire arm's-length viewer. Our `GET /shares/:token` returns `{targetKind, targetId, capabilities}` and **no client consumes it** | **Yes** in shape — it is exactly `docs/off-platform-access.md` drawn as a screen |
| **`CollaboratorAuthPage`** (`/collaborate/$eventId/$token`) | The invitee sets a password, which a Cloud Function hashes; the session is then an **anonymous** Firebase user plus a `sessionStorage` flag | **none** — we use share-token OTP → JWT | Nothing to take | **No — do not copy.** A second, weaker credential store beside Firebase Auth; our OTP→JWT front door already replaces it |
| **`SharedEventPage`** (`/shared/event/$eventId?token=`) | Views a **frozen snapshot** of an event as a clean read-only document, section by section, under a banner: *"Snapshot — does not update automatically. Ask Daniel for a fresh link."* | **none** | The viewer for `GET /shares/:token` | **Layout yes, mechanism no** — ours is a live, revocable, capability-scoped read; the snapshot is a copy that cannot be revoked |
| **`SharedBudgetPage`** (`/shared/budget/$token`) | A budget report for an off-platform party — Results, Profit Margin, Schedule, Tasks, In-House Assignment | **none** | Same viewer, `targetKind='budget'` | **Yes** |
| **`SharedAvailabilityPage`** (`/availability/$shareId`) | A stranger sees the sharer's open dates and picks one to request | **`apps/marketing/availability.html`** + `availability-request.ts` → `POST /booking-requests` | **Ours is better.** The old `$shareId` is an unsigned **base64 blob in the URL** carrying `ownerUid` and `profileId` — tamperable, unrevocable, and it leaks ids | **Ours yes; theirs no** |
| **`BookingWidgetPage`** (`/request-date/$slug`) | An embeddable public "Request a Date" form: who you are, contact, wanted date, act, genres, **fee**, music/video links, website, socials | **`apps/marketing`** availability request (deliberately narrower) | The old form asks for a fee and links; ours deliberately does not, and `availability-request.ts` writes down exactly why (a fee with no currency is worse than no fee) | **Ours is the considered version** — the *embeddable* framing is the only thing left to want |
| **`PublicEventPage`** (`/event/$id`) | A public event page: poster facts, ticket links, **RSVP form** (name / email / city) | **`apps/marketing/event.html`** + `event-rsvp.ts` → `POST /public/events/:id/rsvp` | Parity | **Yes** |
| **`PublicProfilePage`** (`/p/$slug`) | The public EPK | `apps/marketing/profile.html` + `GET /public/profiles/:slug` | Parity | **Yes** |
| **`ContactsPage`** | Counterparty book as **one column per type** (Promoter · Venue · Performer · Ticketing Provider · Agent · **Manager** · Production Company), Import / Export, bulk select, IBAN-verified flag, "Active Collaborators" filter, "1 from your profile" nudge | `Contacts.tsx` | Ours has no **import/export**, no bulk select, no column-per-type layout, and no "derived from your collaborators" nudge | **Mostly** — but `Manager` as a contact type is out of scope (story.md) |
| **`ContactDetailPage`** | One counterparty: history, payout identity, linked events | **none** — `Contacts.tsx` is a single screen | The detail view | **Yes** |
| **`IncomingRequestsPage`** | Booking-request inbox: buckets (Pending · Accepted · Declined · Archived · **Blocked**), a separate **Event Invitations** group, per-request Make Offer / create draft event / decline hold / **flag spam** / **block email** / copy email, sender type, source (Widget / Profile / Availability / Collaborate invite) | `Requests.tsx` + `RequestTriageDialogs.tsx` + `POST /booking-requests/:id/{counter-offer,draft-event,flag-spam}` | We have spam-flagging but **no block-list**, and no "Event Invitations" as a distinct group | **Yes** |
| **`SentRequestsPage`** | Offers you sent, with a detail worth stealing: *"for venues that aren't on the platform, we'll generate a templated email for you to send from your own inbox"* | `Requests.tsx` (outgoing view) | The **off-platform outbound email draft** | **Yes** |
| **`BillsInvoicesPage`** | Payments Received / Sent / Recurring, KPI band, transaction table, CSV export — *"invoices and receipts are automatically generated by our payment provider"*. Marked **Coming soon** in the old nav; it renders empty | `Invoices.tsx` (issued / received, real) | Nothing to take — this is a Stripe-era stub and `docs/payments.md` says v1 moves no money | **No — deferred by decision** |
| **`TicketingPage`** | Connect a ticketing provider, watch a revenue feed. Also a stub | `Integrations.tsx` | Nothing | **No — deferred** (`budget_lines.source` is the seam) |
| **`TemplatesPage`** | Rename/delete templates saved **per profile and shared with that profile's team**, from Settlement / Schedule / Riders / Budget sections | Budget templates exist (`BudgetTemplateDialogs`, `budgetTemplateDrafts`); **no management page, no other section** | A cross-section template store and its admin page | **Yes** — decisions.md §505 asks for a template-management page; the meeting asks for shared-budget templates |
| **`CalendarPage`** | Month/Week/Day, label mode (Performer / Event Name / Both), **Mark Unavailable**, **Check & Share Availability**, Export ICS, Import, filters, and a **My Calendars tree** with per-profile *and per-room* sub-calendars (Main Hall, Club Room, Rooftop Stage) | `Calendar.tsx` (+ `MarkUnavailableModal`, `AvailabilityShareModal`, `useCalendarIcsExport`, `MyCalendarsCard`) | **Room/stage sub-calendars** — that is `stages`, our dead table (**A-31**) | **Yes** |
| **`TasksPage`** | 33 action items with a **sort control** ("Oldest first"), a **Group-by** selector ("Event"), buckets All / Action Items / My Tasks / Team / System / Overdue / Next 7 days / Completed, grouped cards with "Manage →" | `Tasks.tsx` | **Sort and group-by.** The handoff says "no sort control anywhere, because no list route accepts a sort parameter" — the old app shows what it buys | **Yes** |
| **`Index`** (dashboard) | Plan banner, My Tasks, **System Recommendations** (generated next actions, dismissible), Recent Activity, event KPI band, settlement KPI band, recent settlements with filter chips | `Dashboard.tsx` | **System Recommendations** — a generated "what to do next" list — has no equivalent | **Yes** |
| **`EventsPage`** | Search, status chips (Next Shows · All · Draft · Suggested · Pending · Confirmed · On Hold · Concluded · Cancelled · Archived), **profile chips**, sortable table (Event / Performer / Venue / Host / Date / Status) | `Events.tsx` | **Sortable columns**; a **"Next Shows"** default that is not simply "all" | **Yes** |
| **`SettlementsPage`** / **`SettlementDetailPage`** | List with status chips; detail with tabs Overview · Deal Structure · Financials · Settlement · Payout *(coming soon)* · Change Log, and **per-party cards** (base → deductions → final payout, "YOUR SHARE (RETAINED)" on the operator's) | `Settlements.tsx` + `SettlementDetailModal` + `WhoOwesWhomBoard` | A **Change Log** tab; the per-party card layout | **Yes**, with one hard exception — see conflicts |
| **`ProfilesPage`** / **`ProfileEditPage`** | Profile **switcher chips** at the top; cover + avatar; View Public / Hospitality / Share Profile / **Access** / Edit / Delete. The editor is a full EPK: genres, media, documents, tech + hospitality riders, amenities, capacity (standing/sitting), **rooms & stages**, **deal types**, **performance bonus thresholds** | `Profiles.tsx` (+ `ProfileRoomsCard`, `ProfileMediaField`, `ProfilePublicPreview`) | **The profile switcher** (the rest of A-25: "`activeProfile` is always `memberships[0]`"); the per-profile **Access** screen; default **deal types / bonus thresholds** on a profile | **Yes** — except bonus thresholds, which the meeting **defers** |
| **`TeamPage`** | "Manage crew for your profiles" — 504 bytes, an empty list and an Add button | `Team.tsx` (1039 lines, real) | Nothing. **Ours is far ahead** | — |
| **`AdminPlansPage`** | Internal console: search every profile, filter by plan and role, see Owner / Plan / Status / **Seats** / **Renews**, reassign a plan immediately | **none** — `GET /admin/{profiles,audit,alerts}` exists, no screen | The whole console | **Yes** — seats are the meeting's model ("charge for additional user seats") |
| **`AdminInvitationsPage`** | Create and manage platform **invitation codes** — status, recipient, source, used-by | **none**; we have no invite-code concept at all | The whole feature | **Unclear** — a closed-beta gate is a go-to-market decision, not a product one. See *Questions* |
| **`PricingPage`** | Plan comparison — unlimited events, admin role and permission management, audience management, internal team CRM, promoter/campaign tools, **AI matching and AI tour builder**, API access, advanced analytics. **Route is commented out** in `router.tsx` | Marketing site | Copy, not code | **Mostly** — "AI matching / tour builder" is the *assistant* layer we deliberately deferred |
| `SettingsPage`, `LoginPage`, `SignupPage`, `ResetPasswordPage`, `AcceptInvitePage`, `InvitePage`, `NotFound` | Auth and settings plumbing | `Settings.tsx`, our auth flow, `invitations.ts` | Nothing notable | **Yes** |
| `LandingPage`, `AboutPage`, `ProductPage`, `SolutionsPage` | Marketing | `apps/marketing` | Copy | **Yes** |

---

## The five that matter

### 1. `EventManagerPage` — the workspace we are rebuilding

![Event workspace](../.playwright-mcp/old-app-03-event-manager.png)

The masthead is worth copying almost verbatim: **title · short code · status pill · currency select ·
Invite Collaborator · Share & Export · overflow**, with an identity sub-row (performer chip · venue
chip · date) and, under it, a **four-stop status timeline** (Suggested → Pending → Confirmed →
Concluded) that is a *display* of state, not a control. Our `EventDetailHeader` already has this
shape — including an `onShareExport` prop.

**Nothing in our app passes `onShareExport`.** The button is defined and never rendered. That is the
single largest gap this exercise found, and it is a UI gap only: `apps/api/src/routes/shares.ts` is
complete (create · read · OTP · verify · comment).

The **Event Details** tab is one long stack of cards — Event Information, Performers (with per-row
"Invite to Platform"), Riders & Documents, Event Schedule, Amenities, Guest List, Financial Deal,
Ticket Information — each with its own `Edit` affordance rather than one page-level edit mode. That
per-card edit is the right instinct for a document this long.

### 2. Budget Planner — richer than ours, and it confirms the meeting's complaint

![Budget planner](../.playwright-mcp/old-app-04-budget-planner.png)

Worth taking: a **Planning view** selector at the top that names whose numbers you are looking at
("Venue (your profile)") with a plain-English note about who else sees them; a **Load / Save
Template** pair and **CSV / PDF / Share** beside it; a four-tile KPI band (Total Revenue · Total
Costs · Profit/Loss · **Break-even Tickets**); Revenue and Costs as two editable columns; a
**Results** block of derived fields with **"Add Result Field"** (user-defined formulas — there is a
whole `FormulaBuilder.tsx` behind it); a break-even chart; and a **PRO fee estimator** carrying an
"Estimate only" badge everywhere it appears.

And it confirms the meeting verbatim: **there are no "Collected by" / "Paid by" selectors on any
line.** The meeting records this as *"the columns exist; the planner UI does not expose them"* — the
old app is where that observation came from. Our `BudgetLineAttribution.tsx` and `CostSplitModal.tsx`
are the fix, and they are already the newer answer.

### 3. Share & Export — the flow we have an API for and no UI

![Share scope picker](../.playwright-mcp/old-app-12-share-export.png)
![Link access and export](../.playwright-mcp/old-app-12b-share-export-bottom.png)
![Public-link consent gate](../.playwright-mcp/old-app-12c-share-created.png)

Three choices, in this order: **what** (All Event Details / Specific Tab / **Specific Section**, with
an expandable checkbox tree), **who** (Protected — an email recipient list — vs Public), **how**
(Print/PDF · CSV · Create Link). Choosing Public raises a modal that names the risk in plain words,
disclaims liability, and requires a checkbox before the link exists.

Take: the three-step order, the section tree, the two access tiers (they are literally our
`access: public | protected`), and **the consent gate** — it is the most honest piece of UX in the
old app.

Leave: the storage model. The created share carries a `snapshotData` blob — a frozen copy of the
event, deal, revenue and settlement — so `SharedEventPage` renders a document that says *"does not
update automatically."* Our `shares` table stores `capabilities` + `target` and reads live, which is
revocable and cannot drift. Same screen, better mechanism.

### 4. The collaborator surfaces — where our `authorize()` ceiling gets tested

![Settlement review](../.playwright-mcp/old-app-13-settlement-review.png)

`SettlementReviewPage` is the shape we want: no app chrome, "Reviewing as *name*" in the corner, the
settlement laid out as a document, one primary **Approve Settlement** button, and a comment thread
with file attachment underneath. It answers **A-33** — sign-off is the point of the share flow, and
the old app has it while we do not.

`CollaboratorEventView` is the other half: read-only tabs, a **comment box scoped to each section**
(the comment is posted prefixed `[Agreement] …`, so the operator's inbox knows what it is about), and
per-party **agreement confirmation**. Both are worth building; neither is worth copying as-is,
because of the next section.

### 5. Team / Crew and Collaborators — two lists, two meanings

![Team and crew](../.playwright-mcp/old-app-09-crew-tab.png)
![Collaborators](../.playwright-mcp/old-app-10-collaborators-tab.png)

The crew tab splits **Shared Team** ("visible to all event collaborators") from **In-House
Management** (private to the venue) — the meeting's 01:40:58 decision, already drawn. Within Shared
Team, crew are grouped **under the party who brought them** (Paradiso's sound and light engineers;
Aurora's tour manager and players), which is the honest rendering of "anyone may bring crew, not just
the operator" (decisions.md #12).

The Collaborators tab is the parties list: grouped by role (Event Host / Venue / Agent), each row
carrying a permission select and a connection state. The invite dialog behind it autocompletes from
Contacts, sets role + permission with a one-line explanation of what that permission means
("Can edit event details, but not financial information"), and offers **Copy Link** or **Send Email**.

---

## Where the old app contradicts decisions we have since taken

**1. It shows every party's money to everyone.** The settlement review page renders a card per
party — Performer, Promoter, Venue, **Booker/Agent (WME Agency) −€2,548.14**, **Management
(Starlight Mgmt) −€1,443.95** — and `SettlementReviewPage.tsx` renders `partyBreakdowns` wholesale;
the only scoping is a coarse `viewerIsPerformer` boolean that changes nothing about which cards
appear. story.md: a performer "sees **only their own slice** — never the event budget/pool or other
parties' financials … even if an operator *wanted* to show them (an inviolable ceiling)." The meeting:
"collaborators see only the portions relevant to their own deals."

**2. It puts the agent's commission on the event settlement, in public.** decisions.md #14 is
explicit that the agent is "**never a separate entitled party**", that commission lives in a second
`settlements` row **private to agent + performer**, and that "the **commission rate** is the private
bit." The old app's Agreement tab prints `Booker/Agent: WME Agency (15%)` in the event summary and
gives the agent an entitled card in the settlement.

**3. It has a "Management" party.** `Management: Starlight Mgmt (10%)` on the agreement, a
`Manager (2)` column in Contacts, a management card in the settlement. story.md draws exactly this
line: shoWMe's agent is "**a booking agent, *not* a manager** … not publishing, not record deals, not
career management, not merchandise," and "the exclusions aren't limits to 'fix,' they are the
*definition* of the role."

**4. Its collaborator auth is a second credential store.** `CollaboratorAuthPage` has the invitee
choose a password, hashes it in a Cloud Function, then signs them in **anonymously** and gates the
view on `sessionStorage`. `docs/off-platform-access.md` replaces this with one engine and three front
doors (public token / OTP→JWT / signed-in email match).

**5. Its availability link is an unsigned URL payload.** `/availability/eyJmcm9tIjoi…` base64-decodes
to `{from, to, unavailable[], profileId, ownerUid, …}`. Nothing signs it, nothing can revoke it, and
it hands out internal ids.

None of these are reasons to skip the *screens*. They are reasons the screens must be rebuilt on
`authorize(capability)` + `serialize(capabilities)` rather than ported.

---

## Prioritised implementation plan

### BUILD NOW

1. **Share & Export on the event workspace.** Wire `onShareExport` in `EventDetail.tsx` to a dialog
   with the old app's three-step shape: what (all / tab / section tree) → who (public vs protected +
   recipients) → how (PDF · CSV · link), with the public-link consent gate. The API
   (`apps/api/src/routes/shares.ts`) and the CSV writer (`packages/shared/src/csv.ts`, built and
   consumed by nothing) already exist. **This is the highest ratio of value to new code in the list.**

2. **The share viewer** — one route that reads `GET /shares/:token` and renders the granted
   `targetKind` as a clean document: event, budget, schedule, deal, settlement. Replaces
   `SharedEventPage`, `SharedBudgetPage` and `CollaboratorEventView` with a single
   capability-driven page. Live read, not a snapshot. Sections come from `capabilities`, so the
   serializer — not the template — decides what appears.

3. **Off-platform approval (A-33).** Add `settlement.confirm` and `deal.confirm` to what a share may
   grant, and give the viewer the review page's shape: the document, one Approve button, a comment
   thread with attachment. **Scoped to the recipient's own party** — never the all-parties card grid
   the old app renders.

4. **Per-section comments on the share viewer.** `POST /shares/:token/comment` exists. The old app's
   `[Agreement] …` prefixing is the cheap version of a section id; carry the section explicitly.

5. **The profile switcher.** The last live piece of A-25. The old `ProfilesPage` chip row is the
   pattern; today `activeProfile` is always `memberships[0]`, so the whole nav follows the account
   rather than the acting profile.

### BUILD LATER

6. **Sort and group-by on list screens.** The old Tasks page has both and they carry real weight.
   Blocked on an API change first — no list route accepts a sort parameter.

7. **A templates management page.** Extend beyond budget to schedule, riders and settlement; scope
   per profile, shared with that profile's team. decisions.md §505 asks for it; the meeting asks for
   shared-budget templates for recurring events.

8. **Room / stage sub-calendars.** The old calendar's "My Calendars" tree resolves **A-31** (`stages`
   is a dead table that event-create already accepts a `stageId` for) and gives holds a room to hang
   on.

9. **Contact import / export, bulk actions, and a contact detail page.** Plus the "N contacts derived
   from your collaborators" nudge, which is a genuinely good onboarding move.

10. **A request block-list.** We flag spam; the old app also blocks an email address outright.

11. **The off-platform outbound email draft** on sent offers — "we'll generate a templated email for
    you to send from your own inbox" — for targets who are not on the platform.

12. **An admin console** over the existing `GET /admin/{profiles,audit,alerts}`: plan, status, seats,
    renewal, reassign. Seats are the meeting's charging model, and nothing surfaces them today.

13. **Dashboard "system recommendations."** A generated, dismissible next-actions list. Cheap, and it
    is the natural first surface for the assistant layer when that lands.

14. **Settlement change-log tab.** We have `activity.ts`; the old app gives it a home on the
    settlement.

### DO NOT BUILD

15. **All-parties financial cards on any shared or collaborator view.** Contradicts story.md's
    performer ceiling ("never … other parties' financials … even if an operator *wanted* to show
    them") and the meeting's transparency rule. Party-scope every card. The one exception the meeting
    carves out is **co-promotion**: "all involved parties get full transparency into the entire
    financial deal" — which is a shared-budget rule, not a licence for the settlement view.

16. **Agent commission as a party line on the event settlement**, and any display of the commission
    rate to the operator. decisions.md #14: the agent is "never a separate entitled party"; commission
    is a second `settlements` row private to agent + performer.

17. **A "Management" / manager party, contact type, or cut.** story.md draws the boundary as the
    *definition* of the agent role, not a gap.

18. **`CollaboratorAuthPage`'s password-hash-plus-anonymous-auth scheme.** Superseded by
    `docs/off-platform-access.md`'s OTP→JWT.

19. **Unsigned base64 share payloads in URLs.** Superseded by the `shares` table.

20. **`BillsInvoicesPage` as a payments-provider ledger.** `docs/payments.md`: "v1 processes no
    money." Our `Invoices.tsx` is the right layer for now.

21. **Escalators, tiered splits and bar-percentage deal types.** The meeting defers all three
    explicitly ("Postpone complex structures … Standard industry deal types for the first release").
    Also **performance bonus thresholds** on the profile editor, for the same reason.

22. **Crew payroll / payment management.** The meeting: "Defer crew payment management — lean on
    existing payment integrations."

23. **The ticketing-provider integration screen** as a standalone page. Manual entry stays; the seam
    is `budget_lines.source`, and the meeting keeps manual input mandatory for cash at the door.

---

## Questions for the owner

1. **Invitation codes / closed beta.** `AdminInvitationsPage` gates signup behind codes. Nothing in
   our docs takes a position. Is the rebuild opening to self-serve signup, or do we want the gate?

2. **Public share links at all.** The old app offers **Public** (no identity challenge) alongside
   Protected, behind a liability disclaimer. `docs/off-platform-access.md` supports `access: public`
   and suggests "schedule/info ok, personal/financial protected." Should the UI *offer* Public for a
   settlement or deal at all, or should protected be forced above a sensitivity line? The old
   consent gate is good; refusing the choice may be better.

3. **Snapshot vs live for a share.** I have assumed live-read (revocable, no drift). But "here is
   what we agreed on the night, frozen" has real value for a settlement, and decisions.md already
   freezes deal snapshots at signature. Should a settlement share freeze at finalize?

4. **The "Specific Section" share granularity.** The old tree exposes 21 section ids
   (`budget-calculator`, `deal-structure`, `guest-list`, `private-notes`, …). Our `shares.capabilities`
   is a capability list, not a section list. Do we want section-level granularity in the UI mapped
   onto capabilities, or is target-kind granularity (schedule / deal / settlement / event_info /
   budget / rider) enough?

5. **Co-promotion transparency.** The meeting says co-promoters get "full transparency into the
   entire financial deal." Does that extend to each other's **private** budget tab, or only to the
   shared ledger? The dual-tab design implies the latter; the sentence could be read as the former.

6. **Where the agent's own settlement view lives.** decisions.md #14 puts commission in a
   representation-scoped settlement private to agent + performer. When we build the review/approve
   surface, does the agent get the *same* review page pointed at their representation settlement, or
   a separate screen? (Related: `/representation` does not exist yet — the rest of A-25.)

7. **User-defined formula fields.** The old budget's "Add Result Field" is backed by a
   `FormulaBuilder`. Genuinely useful, and genuinely a surface for arbitrary user expressions. Do we
   want it, or are fixed derived fields enough for v1?
