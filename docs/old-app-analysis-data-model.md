# The old app's data model — what it held, what we dropped, and what its denormalization cost

**Subject:** `../showme-settle-fast` (Firebase/Firestore, 231 commits, last commit 2026-04-29).
**Compared against:** `packages/db/src/schema/*.ts` at migration `0016`.
**Written:** 2026-08-26. Read-only analysis; no application code was changed.

Five questions: what the old app stored, what product data our Postgres schema does *not* capture,
how much denormalization cost and what it broke, which ideas deserve a relational life, and what the
security rules protected that our `authorize()` / `serialize()` layer does not.

---

## 0. Method, and one thing that did not work

The brief said the emulator exports are ground truth for real documents. **They are not — they are
empty.** `emulator-data/` is an empty directory. Of 70 `firebase-export-*` directories, 69 contain
zero bytes; the one non-empty export (`firebase-export-1777288231444sZPk7t`) holds an `auth_export`
whose `accounts.json` is literally
`{"kind":"identitytoolkit#DownloadAccountResponse","users":[]}` and a
`firestore_export.overall_export_metadata` with **no collection files behind it**. There is not one
real document in the repository.

Ground truth therefore came from code, in this order of confidence:

1. **Write sites** — `src/lib/db.ts` (3,182 lines) and `functions/src/*` (11,105 lines). What a field
   is *set to* beats what a type says it may be.
2. **Read sites** — critically, `eventRowToEvent` (`db.ts:1028–1081`), the single mapper every event
   query passes through. A field absent there is written and never read back.
3. `src/lib/models.ts` (1,087 lines) — the declared shapes.
4. `firestore.rules` (734 lines) — an exhaustive path inventory, and the predicates name the fields
   that mattered.
5. `firestore.indexes.json` — 40 composite indexes, proof of which queries really ran.
6. `scripts/inspect-*.ts` / `probe-*.ts` — forensics written against *production*; they enumerate
   real fields and name the bugs they chased.
7. `scripts/seed/fixtures.ts`, `defaults.ts`, `seed.ts`.

**Stored** (a write path exists), **used** (something reads it) and **dead** (declared, never
written) are distinguished throughout, because the brief is right that an unused column is not a
gap — and applying that test moved three of my initial findings out of the gap list.

---

## 1. Every Firestore collection and document shape

Collection constants: `db.ts:95–122, :597, :962, :3057–3058`; cross-checked against every `match`
block in `firestore.rules`.

### Top-level

| Path | What it was for | Writer | Queried how |
|---|---|---|---|
| `events/{eventId}` | The event spine. | client + server | **always** `accessUids array-contains` or `accessProfileIds array-contains`, ± `eventStatus`, ordered by date/artist/venue; public `getDoc` when `published && eventStatus=='confirmed'` |
| `profiles/{profileId}` | Every actor. Doc id convention `{ownerUid}__{roleSlot}`, plus `seed-artist__{slug}`, `stub-{eventId}-{token}`, and random ids. | client | `owner_uid ==`; `isPublic + slug`; `type + isPublic + name` prefix range; `type + unclaimed + country` count |
| `plans/{profileId}` | Tier **and every freemium counter**. **Client-write-denied**; read live by rules so a downgrade bites immediately. | server only | `getDoc`, `onSnapshot`, `get()` from rules |
| `invitationCodes/{code}` | `SHOW-XXXX-XXXX` codes. **`read: if true`** — the code *is* the capability. Client may only flip `active → revoked`. | server | by creator; by status; a 4-field dedupe tuple |
| `profileInvites/{profileId}_{emailLower}` | Pending team invite. Doc id is a deterministic composite, so a verified-email claim is the capability. **`update: if false`.** | client (admin) | by `profileId`; by `email` |
| `collaboratorInvites/{token}` | Collaborator link. **`read: if true`**; client can never set `passwordHash` (and it is always `null` — the password path is disabled). | client | by token |
| `collaboratorWrites/{token}` | Agreement-confirmation scratch space. **`read, write: if true`** — fully open. | anyone | by token |
| `publicShares/{token}` | Share grant, three `kind` variants (`settlement_review` / `event_snapshot` / `budget`) with disjoint fields. Client creates; **update and delete denied**. | client + server | by token via a callable |
| `publicShares/{token}/otp/{sha256(email)}` | OTP challenge. Client read **and** write denied. | server | direct |
| `otpCodes/{id}` | Signup OTPs — a *second*, separate OTP store using `Timestamp` where the share OTP uses epoch millis. | server | `email + createdAt` |
| `inboundBookingRequests/{id}` | All inbound flows, both directions. Anonymous create allowed. | anonymous + client + server | `owner_uid` ∨ `target_profile_id in […≤29]` ± `status`, ordered; `sender_user_uid ==` |
| `publicBookingRequests/{id}` | Legacy predecessor. `create: if true`; **`read, update: if isAuthed()`**. | anonymous | fallback update only |
| `audience_rsvps/{id}` | Public RSVP capture. **`read, update, delete: if false`** — a write-only sink. | anonymous | — |
| `admins/{uid}` | Admin roster. **Admin-ness was a document, not a claim.** | seed/manual | `exists()` |
| `adminAlerts/{id}` | `spam:{profileId}` and `expansion:{COUNTRY}` — two shapes in one collection. `resolved` is written `false` and **never flipped**. | server | admin |
| `auditLog/{id}` | GDPR trail for cold outreach. Written; **no reader exists**. | server | admin |

### `users/{uid}` subtree

`settings/main` (name, initials, avatar, **`roles: OperatorRole[]` — a list**, `currency`,
`default_role`, `company_name`, `country`, `dateFormat`, `timeFormat`) · `contacts/{id}` ·
`calendar_items/{id}` · `share_tokens/{token}` (an owner-side mirror of `publicShares`) ·
`notifications/{id}` (`create: if false`, server fan-out only) · `_meta/refreshClaims` (a `{ts}`
ping that makes the client re-fetch its ID token) · `event_manager/*` (**retired**, replaced by
`events/{id}/meta/main`).

A catch-all `match /users/{userId}/{document=**}` makes every *future* per-user subcollection
client-writable automatically.

### `profiles/{pid}` subtree

`members/{memberUid}` (`user_uid`, `role ∈ {owner, admin, editor}`, `email`, `displayName`,
`schemaVersion`) — read cross-profile through a **collectionGroup** index on `members.user_uid` ·
`team/{id}` (the non-account crew directory) · `calendar_items/{id}` · `unavailability/main`
(`{dates: string[]}`) · `templates/{category}/items/{id}` where category ∈ `schedules`,
`settlement-overview`, `settlement-deal`, `deals`, `budgets`, `riders`, `terms` — **blocked entirely
for performer profiles by rule** · `spamFlags/{kind}:{reporterProfileId}` (server-write **and**
server-read only) · `notifications/*` (an orphan; 22 stale docs found on one production profile).

### `events/{eventId}` subtree

| Path | Held | Note |
|---|---|---|
| `deal/main` | `DealStructure` | **One deal per event.** |
| `revenue/main` | `TicketRevenue` | The actuals. |
| `settlement/main` | `Settlement` | **One settlement per event** — payouts, approvals, comments, revisions. |
| `meta/main` | The junk drawer: expenses, guest list, agreement confirmations + reopen request, PRO estimate, private crew notes, crew schedule, member sections, action-item assignees, `pendingDateChange`. | Nine unrelated features in one document. |
| `meta/todos_{profileId}` / `todos_user_{uid}` | Todos, partitioned by a **document-id naming convention** the rules parse with `docId[6:docId.size()]`. | |
| `budgets/{profileId\|uid}` | `BudgetCalculatorPersisted` — revenue/cost/result `BudgetField[]` with a **formula AST**, manual overrides, local ticket types. Doc id is the authorization subject. | The old private-budget partition. |
| `participants/{profileId}` | `profileId`, `role`, `addedAt`, `addedBy`. | Thin — the real access data was the arrays on the parent. |
| `collaborators/{cid}` | `email`, `eventRole` (8 values), `name`, `status`, `invitedAt`, `userUid`, `profileId`, `permission` (admin/editor/view_only), `invitedByUid`. | Setting `permission='admin'` required a **paid host plan**, enforced in rules. `syncEventCollaboratorsFromUi` **deletes and recreates the whole subcollection on every save**. |
| `riders/{id}` | `name`, `type` (technical/hospitality/catering/custom), `description`, `fileUrl`, `fileName`, `ownerProfileId`, `createdByUid`. | |
| `agreements/{id}` | `type` (terms/rental/collaboration/custom), `name`, `status`, `fileUrl`, `fileName`, `createdByUid`. | A **document** model, separate from the deal. |
| `crew/{id}` | `name`, `role`, `email`, `phone`, `collaborator`, `teamMemberId`, `createdByUid`. | |
| `schedule/{id}` | `time`, `label`, `description`, `ownerProfileId`, **`roomStage`**, `createdByUid`. | |
| `messages/{id}` | `sender_uid`, `sender_name`, `created_at`, `event_id`, body. **`update: if false`.** | One flat thread per event. |
| `activity/{id}` | Settlement activity feed. | Append-only. **Two writers, two incompatible shapes** — see §3. |
| `event_activity/{id}` | Event activity feed, with `visibility ∈ {all, operator_only}`. | Append-only. |

**Deliberately absent:** no `holds` collection (hold state was event columns), no top-level
`contacts` rule (only reachable through the `users/{uid}/**` wildcard, despite having an index), and
no plural `settlements`.

---

## 2. Field-by-field: what the old model captured that ours does not

Denormalization artefacts are excluded — they are §3's subject. So are doc-id copies (`events.id`,
`deal.eventId`, `contacts.id`, …), copied display names, and cached counters.

### 2a. Shipped, used, and genuinely lost

| Old field | What it held | Our equivalent | Verdict |
|---|---|---|---|
| `deal.artistCostSplit` / `promoterCostSplit` / `venueCostSplit` / `organizerCostSplit` (`models.ts:174–177`) | Percentages splitting **production costs** across parties. **Used** — `calculateSettlement:406–428` applies them and pushes a labelled adjustment onto each party. | `budget_lines.cost_split` jsonb exists but **`reconcile()` never reads it** (`packages/settlement/src/reconcile.ts:76–82` handles only a single `payeeParticipantId`), and `SettlementBudgetLine` has no `costSplit` field. | **REAL GAP.** The meeting doc binds it: *"The production system requires a defined rule: either a cost split or a single payer."* Only "single payer" is expressible today. |
| `deal.venueRentalPaidBy` incl. `"split"` (`:179`) | Who bears the rental. **Used** (`:398–420`). | `budget_lines.paid_by` covers the single-payer cases; `"split"` has none. | **REAL GAP**, same root cause. |
| `revenue.ticketTypes[]` / `doorSalesTypes[]` — `{name, price, sold}` (`:201–205`) | **Actual** tickets sold per tier after the show. **Stored** (`db.ts:1488`) and **used** (`RevenueTab.tsx:42–43` derives gross and count from them). | `events.extras.ticketTiers` holds `{price, max, est}` — a **planning estimate**. Nothing holds tickets actually sold. | **REAL GAP.** |
| `revenue.ticketsSold` (`:241`) | The count driving escalator tiers. | `SettlementInput.ticketsSold` exists in the engine, but `routes/settlement.ts:412` builds the input **without it** — always `0`. No column feeds it. | **REAL GAP.** Escalators are unreachable; the handoff doc already says so. |
| `revenue.additionalDeductions[]` — `CustomDeductionField` (`:218–229`) | Two shapes: a **fixed transfer** `fromParty → toParty`, and a **percentage of a named source field split across parties** with `partySplits[]` totalling 100%. **Used** (`:454–474`). Valid `sourceField` values: `grossRevenue`, `doorSales`, `ticketSales`, `totalRevenue`, or an `additionalRevenue[].name`. | `budget_lines.kind` is only `revenue \| cost`. No party-to-party transfer line, no percentage-of-a-named-line deduction. | **REAL GAP.** The meeting doc: *"'Add cost' and 'add deduction' are distinct."* The deductible half is built (`payee_participant_id`); the transfer and %-of-source halves are not. |
| `meta.pendingDateChange` (`db.ts:1769–1776`) — `{proposedBy, proposedAt, previousValues, proposedValues, confirmations: Record<profileId, {status, respondedAt, respondedBy, role, profileName, onPlatform}>}` | A **date-change proposal every party must confirm**, including off-platform parties by tokenized email link (`docs/EMAIL_DATE_CHANGE_CONFIRMATION.md`); mirrored to child events and relayed back by a 187-line server function. Three notification types and three activity types serve it. | Nothing. `PATCH /events/:id` writes `eventDate` under an optimistic lock; every `agreement_status='confirmed'` deal stays confirmed. | **REAL GAP**, and a product-integrity one. |
| `ProfileLocation.label` + `from` / `to` (`user-context.tsx:75–85`) | A **named, date-bounded** location — "EU Summer Tour", 2026-06-01→08-31. **Used** — `getLocationForDate` picks the location active on a date. | `profile_locations` has `street/postcode/city/country/lat/lng/is_primary`. No label, no range. | **REAL GAP** for a touring performer; interacts with #17, which derives the market from the primary location's country. |
| `SharedProfile.genres[]` + `GENRE_CATEGORIES` (`src/lib/genres.ts`) | A **curated taxonomy** — ~200 genres in 14 categories, plus a `VENUE_GENRE_SHORTLIST`. **Used** for search (`type + isPublic + name`, filtered client-side). | Genres are free strings in `profiles.details` jsonb (`serialize/profile.ts:161`). **No genre vocabulary exists anywhere in the rebuild.** | **REAL GAP** against decisions #16.6, which requires "a controlled vocabulary the system relates on later, **not** free text". Also unqueryable. |
| `SubVenue.sittingCapacity` / `standingCapacity` / notes; `SubVenue.type ∈ {room, stage, venue}`; `VenueCapacitySetup.isMain` | Seated-vs-standing capacity **per room**, and which setup is the headline number defaulted into new events. | `stages` has `name`, `capacity`. `venue_details.capacity_setups` jsonb holds setups but not per-stage, and nothing marks a main one. | **GAP**, small. |
| `ScheduleItem.roomStage`; room/stage on tasks | Which room an item happens in. | Neither `schedule_items` nor `tasks` has a stage reference. | **GAP** vs decisions #16.5 ("Room/stage/space assignable on both tasks and schedule items"). Pairs with audit A-31 (`stages` is dead). |
| `meta.privateNotes[]` `{text, assignee}`; `meta.crewScheduleItems[]` `{time, label, assignee}`; `meta.memberSections` | Per-crew private notes, an internal crew schedule with a **per-item assignee**, and crew-tab grouping. | `schedule_items` has `owner_participant_id`, no assignee, no notes. `tasks` has `assignee_participant_id`. | **PARTIAL GAP** vs decisions #16.5 ("Tasks + Schedule + Notes group into one time-blocked entry"). |
| `Event.archived` + `event_archived`/`event_unarchived` activity and notification types | Archive as a state distinct from cancelled/concluded. **Used.** | Nothing on `events` (`booking_request_status` has `archived`; events do not). | **GAP**, small. |
| `Event.autoCancelledReason: "expired_unconfirmed"` | Stamped by a sweep that cancelled events whose date passed unconfirmed. **Used.** | No such reaper (`apps/jobs/src/reapers.ts` covers offers, handoffs, shares, representations) and no reason column. | **GAP**, small. |
| `SENDER_TYPE_FOR_VENUE` (6) / `SENDER_TYPE_FOR_PERFORMER` (7) / `PERFORMER_TYPE` (9) (`src/lib/enums.ts`) | Controlled vocabularies on the public request form. | `booking_requests.sender_type` and `performer_type` are free `text`. | **GAP**, small — they were enums and now are not. |
| `Agreement.type = 'terms'` with `fileUrl` | A standalone **document** — a venue's standing T&Cs — with no money and no deal parties. | Agreement is folded into `deals` (decisions #1). A paper-only deal (`NULL structure`) covers "an agreement with no money" but not "a document that is not a deal". | **PARTIAL GAP.** decisions #1 flagged this as open; it is still open. See Q1. |
| `Rider.type` includes `catering`, `custom` | | `rider_type` is `tech \| hospitality \| stage_plot \| input_list` — gains two, loses two. | **Minor.** |
| `Event.performerRoleTag` includes `special_guest` | | `performer_tag` is `headliner \| support \| dj \| opener`. | **Trivial.** |

### 2b. Declared but never shipped — a design sketch, not lost data

This is the correction the "stored vs used" test forces. Four things I would otherwise have listed
as gaps were **dead types in the old app**: declared in `models.ts`, never written to any
collection, never read by any component.

| Old type | Status in the old app | Bearing on us |
|---|---|---|
| **`ProTariff`** (`models.ts:903–917`) — 13 fields keyed by `(pro_code, country, event_type)` | **DEAD.** No collection, no writer, no reader. `calculateProFee:963–993` hardcodes STIM (4%/3% either side of a 675 SEK ticket, 367 SEK minimum, 5.28/comp) and GEMA (7%, floor 20) instead. | Not a gap — but it *is* a ready-made table design, and `packages/shared/src/performing-rights.ts` already names `pro_tariffs` as the table it is waiting for. **Inherit the design, not a loss.** |
| **`SetlistEntry`** (`:935–942`) — `title`, `composer`, `lyricist`, `publisher`, `order`, `proWorkId` | **DEAD.** Never used. | Same: our `setlists.items` is `z.unknown()` (`routes/setlists.ts:30`), so neither app can file a setlist. A gap against the *stated purpose* of the setlist, not against shipped behaviour. |
| **`ProReportingData`** (`:944–959`) — 15 fields | **DEAD.** | Same. |
| **`VatInfo`** (`:188–191`) on deal fee, additional revenue, custom costs, deductions and settlement adjustments | **Stored and UI-editable** (`VatSelector.tsx` writes it) but **never consumed by `calculateSettlement`** — `vat` is read nowhere in the math. | Our schema cannot even *store* it (no VAT column on `deals` or `budget_lines`), so we are one step behind. But the old app did not compute VAT either — **nobody has ever shipped this**. `docs/money.md:42` promises it; treat it as new work, not a port. |
| `ProviderEvent` (`:255–266`) | In-memory UI type only; the provider array is always `[]` (`RevenueTab.tsx:36`). Ticketing sync was a stub. | Matches our position exactly (`budget_lines.source` is the seam). No gap. |
| `SharedProfile.performanceBonuses[]` | Stored and editable in `ProfileEditPage`, but **never propagated onto a deal** — `DealStructure` uses the unrelated `performanceBonusThreshold`/`Amount` pair. An orphaned feature. | Downgrades this from "gap" to "an idea neither app finished". |
| `Event.sourceRequestId` / `sourceRequestDate` | **Written** (`db.ts:1134–1135`) but **absent from `eventRowToEvent`** — never read back. The date-change detection that consumed them never saw them. | Not lost data. But the *intent* — snapshot the originally-requested date so a change is detectable — is sound and feeds the date-change item. |
| `InvitationCode.expiresAt`, `BudgetField.readOnly`, `PlanSource "mollie"`, `BudgetTemplate`, `ExpenseItem`, `Event.participant_roles` (write side), `adminAlerts.resolved`, `auditLog` (read side), `audience_rsvps` (read side) | All declared-and-dead or write-only. | Nothing to port. |

### 2c. Old fields correctly covered by our schema

`deal.performanceBonusThreshold/Amount` and escalators → `SettlementDeal` (with the caveat below) ·
`deal.commissions[]` → `DisclosedCommission` + `representations` (decisions #14, a strict
improvement) · `deal.venueRentalPaymentMode` → `deals.payment_timing` · `meta.guestList` →
`events.extras.guestList`, ported faithfully (`serialize/event-extras.ts:22–39`) · `meta.expenses`
and `revenue.customCosts[].fromParty` → `budget_lines` + `paid_by` · `SharedProfile.acquired`/
`unclaimed` → `profiles.claimed_at` (and ours has **one** flag where the old app had two inverted
ones) · `SharedProfile.documents[]` → `riders` + `files` · `Event.holdRank`/`holdAutoPromote` →
same columns, `packages/shared/src/holds.ts` a faithful port · `Event.tickets[]` →
`events.extras.ticketing` · `Event.pendingHostHandoff*` → `booking_requests.source='venue_handoff'`
· `Todo` → `tasks` + `task_reminders`, field for field · `Contact` → `contacts` + `persons` jsonb ·
`EventCollaborator.permission` → `permission_sets.capabilities[]`, far more expressive ·
`ProfileMemberRole` → `profile_member_role` plus `viewer`, `crew`, `seat_consumed`.

### 2d. Two of our own columns are dead

Not gaps against the old app, but they distort the comparison:

- **`deals.terms` jsonb is never written.** The only `terms` in `routes/deals.ts` is a free-text
  string on a *party share* (`:75`); the deal-level jsonb appears solely inside the frozen snapshot
  (`:738`). So escalators, bonuses and disclosed commissions have **no write path** — the engine
  implements all three and nothing can populate them.
- **`ticketsSold` is never passed to `reconcile()`** (`routes/settlement.ts:412`), so
  `splitBasisPointsForSales` always picks the base tier.

The old app had worse structure here but *working* bonuses. That is worth saying plainly.

---

## 3. The denormalization audit

### What was denormalized

**Access control** — six copies of one fact:

| Field | Holder | Source of truth | Maintained by |
|---|---|---|---|
| `accessUids: string[]` | `events` | members of every profile on the event ∪ active collaborators ∪ `owner_uid` | `profileMembers.ts:16, :80, :127`; `db.ts:1390, 1459, 1899, 2050`; `invitations.ts:511, 575, 1033`; `userLookup.ts:328`; 3 sites in `useCreateEventSubmit.ts`; `EventDetailsTab.tsx:2171` |
| `accessProfileIds: string[]` | `events` | the `participants` subcollection | `db.ts:1400–1409, 1462, 1917–1930`; `invitations.ts`; `userLookup.ts` |
| `editorUids: string[]` | `events` | `collaborators.permission ∈ {admin, editor}` | `invitations.ts:55`; `userLookup.ts:332`; `CollaboratorsTab.tsx:105` |
| `adminUids: string[]` | `events` | `collaborators.permission == 'admin'` | `invitations.ts:86`; `userLookup.ts:346`; `CollaboratorsTab.tsx:121` |
| `participant_uids`, `participant_roles`, `owner_uid`, `primary_owner_uid` | `events` | superseded, still written and still rule branches | `index.ts:118`; `db.ts:1416–1418` |
| `profileIds` custom claim (**cap 16**, `overflow: true`) | the Auth token | `profiles.owner_uid` ∪ collectionGroup `members.user_uid` | `profileClaims.ts` |
| `members/{uid}.user_uid` | `profiles/*/members` | the document id itself | duplicated purely so a collection-group query is possible |

**Cached counters** — eight, all on `plans/{profileId}`: `eventCapCount`, `eventCapBlocked` (read
*directly by the rules*), `eventCapLastComputedAt` (a drift watermark), `offerCountThisMonth`,
`offerCountMonthKey`, `collabInviteCredits`, `collabInviteCreditsMax`, `spamFlagsLast90d`
(recomputed by rescanning the whole `spamFlags` subcollection on every flag), `collabInviteSuspended`.

**Derived values stored as data:** `settlement.artistPayout` / `promoterPayout` / `venuePayout` /
`commissionPayouts` — a pure function of deal + revenue, recomputed and rewritten on every edit;
`events.status` mirroring `settlement.status`; `events.childEventIds` (the inverse of
`parentEventId`); `holdRank` contiguity, which has **no owning document at all**.

**Full-document snapshots:** `publicShares.snapshot = {event, deal, revenue, settlement}` — a deep
copy of four documents; `publicShares.snapshotData`; `pendingDateChange` mirrored onto every child
event and relayed back; `users/{uid}/share_tokens/*` mirroring `publicShares`; and
`approvePublicShare` mirroring approvals **back** into `settlement/main` — a bidirectional mirror.

**Copied names:** `events.venue` / `operator` / `artist` (free-text names beside the FKs),
`collaborators.name`, `crew.collaborator`, `profileInvites.profileName`,
`booking.sender_profile_name` / `artist_name`, `notifications.eventName` / `actorName`,
`activity.by` / `profile`, `calendar_items.assigneeName`, `members.email` / `displayName`,
`pendingDateChange.profileName` / `respondedByName` / `proposedByProfile`,
`publicShares.creatorName`. And `contacts.invitationStatus`, whose own comment says it exists
*"so list-page filters can avoid a join"* (`models.ts:614`).

**Type duplicates:** `profiles.type` duplicates `profiles.role`; `booking.offer_pitch` duplicates
`booking.note`; `booking.offer_fee_min` duplicates `booking.artist_fee`; `profiles.acquired` and
`profiles.unclaimed` are **two inverted booleans for the same concept**, written by different code
paths.

### How much code maintained it

Counting method: whole-file `wc -l` where a file's only purpose is maintaining a copy; explicit
`start–end` line ranges (re-runnable as `sed -n 'S,Ep' | wc -l`) for blocks inside mixed files.
Business logic, validation and email rendering are excluded.

| Tier | Contents | LOC |
|---|---|---|
| **1 — access-control denormalization** | `profileMembers.ts` (167, whole file) · `profileClaims.ts` (175, whole file) · `invitations.ts:43–74, 76–102, 505–582, 1027–1074` (185) · `userLookup.ts:315–350` (36) · `profileMembership.ts:108–117, 393–402` (20) · `index.ts:118–124` (7) · `db.ts:334–341, 1143–1181, 1184–1200, 1283–1305, 1390–1416, 1459–1466, 1899–1941, 2050–2107` (223) · `profiles/members.ts` (31) · `collaboratorEventAccess.ts` (25) · `useEventMutations.ts:310–325` (16) · `CollaboratorsTab.tsx:87–132` (46) · `useCreateEventSubmit.ts:245–272, 363–386` (52) · `EventDetailsTab.tsx:2171–2179` (9) | **992** |
| **2 — other counters, aggregates, mirrors** | `eventCap.ts` (320) · `notifications.ts:966–1152` `relayChildDateChangeResponse` (187) · `holdRankLogic.ts` (186, whose header says it duplicates the client) · `inviteContactSync.ts` (104) · `plans.ts:195–296` (102) · `useEventMutations.ts` hold self-heal + status cascade + date mirror (114) · `db.ts:2634–2675` approval mirror-back (42) · `spamFlag.ts:130–159` (30) · `db.ts:2391–2417` snapshot copy (27) | **1,112** |
| **3 — notification write fan-out** (one denormalized copy per recipient uid, carrying copied `eventName` + `actorName`) | `notifications.ts:28–156` (129) + its 14 triggers `:158–965` (808) · `profileInvites.ts` (119) · `performerOffer.ts:184–231` (48) | **1,104** |

```
Tier 1 alone (the accessUids family)      =   992
Tier 1 + 2 (all maintained copies)        = 2,104
Tier 1 + 2 + 3 (incl. notification fan-out) = 3,208
```

Then the code that exists **only because that drifted**:

| Category | LOC |
|---|---|
| `scripts/backfill-*`, `migrate-*`, `cleanup-*` (8 files) | 1,549 |
| `scripts/inspect-*`, `probe-*`, `find-*`, `plan-*`, `validate-*`, `list-*`, `promote-*`, `test-*` (23 files) | 2,042 |
| **Repair + forensics total** | **3,591** |

Of those, **1,443 LOC across 13 scripts are untracked** — commit `f56ca2f` *"ignore ad-hoc
investigation scripts"* added a `.gitignore` block for `scripts/inspect-*`, `find-*`, `probe-*`,
`plan-*`, `test-*`, `cleanup-*`. The existence of that rule is itself the finding: forensic scripting
had become routine enough to need a gitignore pattern.

### Verdict on the "~1,700 LOC of denormalization/fan-out" claim

**About right, and if anything conservative. Do not lower it.**

- Too high **only** on the narrowest reading — strictly the `accessUids` family — which is 992 LOC;
  the claim then overshoots by ~70%.
- Too low on the natural reading (all code maintaining a copy of data owned elsewhere): **2,104**,
  about 24% above the claim.
- The claim says "fan-out", and the notification pipeline is literally a write fan-out. Including it
  gives **3,208**, making the claim 53% of reality.

The defensible sentence: **"~2,100 LOC of denormalization and mirror maintenance, plus ~1,100 LOC of
notification write fan-out, plus 3,591 LOC of repair and forensic scripts written to chase the drift
it produced."**

Two costs the LOC count misses:

- **25 of 40 composite indexes (62%)** exist solely for `accessUids` / `accessProfileIds` array
  queries — 12 and 13 respectively.
- `firestore.rules` is 734 lines, and its central `hasEventAccess` helper carries **three documented
  fallback branches** whose only purpose is "the denormalized array hasn't caught up yet".

### The drift bugs, with evidence

Every item is quoted from the old repository.

1. **Removing a participant did not revoke their access.** `db.ts:1936–1940`:
   > *"Note: accessUids cleanup requires knowing which uids came from this profile. For now, we leave
   > accessUids as-is (slightly permissive) — a Cloud Function can handle full cleanup later."*

   The participant document is deleted; the uid stays in `accessUids`. Because `hasEventAccess` reads
   that array, a removed party kept read access to the event **and to `deal/main`, `revenue/main` and
   `settlement/main`**, all of which gate on `canAccessEvent`. Known, documented, shipped.

2. **Admins added after an event existed could not see it.** `backfill-event-access-uids.ts:1–12`:
   > *"repair historic drift (e.g. ran@ran-nir.com being added as admin to a performer profile after
   > that profile's events were already created — the events' accessUids never picked up his uid, so
   > his event-list query returns 0)."*

   164 LOC, with a warning to keep it in sync with `computeEventAccessUids` — **two implementations
   of one derivation**, either of which can drift from the other.

3. **The read path was made to write.** Commit `28d475a` *"Fix events not found when accessUids is
   missing"*: *"Add fallback query by accessProfileIds… **Silently repair accessUids on those events**
   so future queries work. Run repair on first page load in both `fetchEvents` and `fetchEventPage`."*

4. **An empty list cached as truth.** Commit `1b2c1a0` *"fix events list silently caching empty when
   accessProfileIds query fails"* — a swallowed query error made TanStack cache "no events" until a
   hard reload. The fix shipped the `onProfileMemberWritten` trigger, the 164-line backfill script,
   and 102 lines of new composite indexes **in one commit** (632 insertions).

5. **Corruption caused by a repair script.** `cleanup-stale-artist-keys.ts:1–7`:
   > *"remove stale `__artist`-suffixed keys from `events/{id}/meta/main.pendingDateChange.
   > confirmations`. Left over from a migration script that used `set({merge:true})` — which
   > deep-merges the nested map and won't drop the renamed key."*

   Two named production events (`EVT-944554`, `EVT-836147`) were left with duplicate confirmation
   entries for one party, so a date change could never reach unanimity.

6. **A profile-slot collision hid the Confirm/Decline buttons.** Commit `f77ea2d`: two profiles
   sharing a slot collapsed in a `Record`, so the id list used for access matching missed one —
   *"most visibly leaving Confirm/Decline buttons off pendingDateChange banners on EVT-944554"*.
   Shipped with `migrate-legacy-artist-profile.ts` and the cleanup script above.

7. **A trigger that never fired.** Commit `b17caec`: `onBookingRequestCreated` *"read non-existent
   `profileId`/`artistName`/`preferredDate` fields"* — the denormalized field names had drifted to
   snake_case, so venue admins silently received **zero** notifications. The same commit fixed a
   second bug where the request inbox queried `owner_uid` only, so venue admins saw **zero incoming
   requests**.

8. **Identity was copied into fourteen places.** `inspect-uid-takeover.ts:1–11` enumerates them
   before a uid merge: `users/{uid}`, `profiles.owner_uid`, `profiles.primary_owner_uid`, member doc
   ids, `members.user_uid`, `events.owner_uid`, `created_by_uid`, `primary_owner_uid`,
   `invitedByUid`, `_lastUpdatedBy`, `accessUids[]`, `pendingDateChange.confirmations` **keys**,
   collaborator `uid`, `invitationCodes.createdByUid`. 278 LOC to change one person's identity.

9. **Eight duplicate profiles for one user.** `cleanup-ran-performer-profiles.ts` (219 LOC,
   destructive) unwinds 1 real + 1 legacy `__artist` + 1 `__performer` + 1 orphan + 4
   `stub-EVT-516288-collab-*` profiles for a single person, each requiring `collaborators`,
   `collaboratorInvites`, `invitationCodes` and one event's `performerProfileId` +
   `accessProfileIds` to be repointed. Its read-only partner `plan-ran-cleanup.ts` exists to *"report
   every reference that would dangle"*.

10. **Phantom parent documents.** `inspect-phantom-profiles.ts` chases two production ids that report
    `exists=false` on the root document while still holding live `members/` subcollections — profile
    roots deleted without their children.

11. **Self-healing became a pattern.** `1c74951` *"self-heal owner member doc"* (legacy profiles had
    no `members/{ownerUid}` row, so the whole calendar batch failed with "Missing or insufficient
    permissions"); `4187c83` *"self-heal duplicate hold ranks on calendar load"* (55 lines of
    renumber-on-view, because `holdRank` uniqueness had no owner).

12. **A maintained index nobody could use.** `e14781f` *"drop dead accessProfileIds queries"* — the
    primary `accessProfileIds` query *"rejected every time and only added latency"* under the current
    rules. The array was still written on every event save.

13. **The claim mirror had a hard cap.** `profileClaims.ts:12, 48–53`: `PROFILE_IDS_CLAIM_CAP = 16`,
    truncating and setting `overflow: true`. A user in 17+ profiles **silently loses** claim-based
    access to the tail. A denormalized copy with a size limit is a correctness cliff.

14. **Three cache/consistency patches for one race:** `7abb058`, `f5ad35f`, `1f273cb` — notifications
    arriving *because* `accessUids` just changed, before the event was in cache, showing a
    "deleted item" toast for an event that exists. Plus `8a35d01`, drafts vanishing for their own
    creator because `profileIds` hydrates asynchronously.

15. **Two writers, one collection, two shapes.** `events/{id}/activity` gets
    `{type, by, profile, actorUid, details, timestamp, createdAt}` from the client and
    `{kind, actor, actorUid, actorEmail, via, token, details, createdAt}` from
    `publicShares.ts:165`. `fetchSettlementActivity` reads `type: undefined, by: undefined` for every
    server-written row. Also `settlement.comments[]` gains an `email` field server-side that appears
    in no type, and `publicShares` carries server-only `approved` / `approvedAt` / `confirmations`
    that no type declares.

**The in-repo post-mortem.** `.claude/skills/auth-model/SKILL.md` states outright that **three access
mechanisms coexist**, that the phase which retires `accessUids` "**has not landed**", that the
`profileIds` claim is "**populated but idle**" with a 16-id cap, and it names "**the two recurring
bug shapes**" by number. A whole second skill, `legacy-artist-profile/SKILL.md`, exists for one
recurring slot-collision report.

**Our schema closes #1 by construction.** `event_participants` rows are never hard-deleted; removal
sets `status='removed'` (`routes/participants.ts:509`) and `authorize()` filters on
`ne(status, 'removed')` (`packages/auth/src/authorize.ts:95`). There is no array to forget.

---

## 4. Which ideas survive relationally, and which were Firestore workarounds

### Worth keeping

- **The `collected_by` / `paid_by` money model.** `customCosts[].fromParty` and
  `additionalDeductions[].fromParty/toParty` are the ancestors of our columns. Already ported and
  correctly generalized.
- **Cost splits as a first-class term.** The four `*CostSplit` percentages are crude (fixed party
  vocabulary) but encode a real rule. Relationally: a share map on the line.
- **VAT per money line.** `{rate, mode}` is the right shape — it just needs a row *and* engine
  support, which it never had.
- **The PRO tariff table.** `ProTariff` is a relational table wearing a TypeScript interface;
  `(pro_code, country, event_type)` is its natural key. Never built, but the design is sound and
  `performing-rights.ts` is already waiting for it.
- **Setlist entries carrying writer credits.** Only useful as a shape, not a blob.
- **Date-change proposals with per-party confirmation, including off-platform parties.** Maps onto
  our `shares` + OTP machinery almost exactly.
- **Time-bounded, labelled profile locations.** A tour leg is a real thing.
- **A genre taxonomy.** Discovery needs a vocabulary to match on.
- **Two append-only activity feeds with target visibility** — already generalized and improved by
  decisions #3 (target-scoped rather than a coarse `operator_only` flag).
- **`isMain` on a capacity setup**, and seated/standing splits per room.
- **`teamMemberId` on a crew row** — provenance back to the directory entry, for dedupe. We have the
  equivalent idea in `details.sourceGroupId`; worth confirming it is applied to crew.

### Firestore workarounds our schema correctly discards

- **`accessUids` / `accessProfileIds` / `editorUids` / `adminUids`** and every line maintaining them.
  The join is the replacement and it is correct.
- **The `{ownerUid}__{roleSlot}` profile-id convention** and the rule parsing it with
  `profileId.matches(uid() + '__.*')`. Ownership encoded in a string because a join was
  unaffordable; it produced the phantom-profile and slot-collision bugs.
- **`meta/todos_{scopeId}` and `budgets/{profileId}` — the document id as the authorization
  subject.** Replaced by real columns and a `WHERE`.
- **`meta/main` as a junk drawer.** Nine unrelated features in one document because a document read
  was the unit of cost.
- **One deal / one revenue / one settlement per event.** The meeting doc requires settlement **per
  participant**; the old model could not express it.
- **The parent/child multi-performer tree** (`isMultiPerformer`, `parentEventId`, `childEventIds`),
  plus the 187-line function relaying date changes down and back up it. Dropped by CLAUDE.md.
- **The fixed `promoter` / `venue` / `organizer` party vocabulary** in `calculateSettlement`, and
  `settlementParties.ts`, whose entire job is hiding a phantom "Promoter" card when the operator *is*
  the venue (commit `17d0b41`). See item 17 in §6.
- **`plans.eventCapBlocked`** and the seven other stored counters. Ours is a fresh `COUNT` in the
  entitlement layer — never stale. (The old app knew: `expansionAlert.ts` deliberately avoids "a
  denormalized counter … Firestore `count()` aggregation is cheap and **avoids drift**." One place
  got it right.)
- **The `profileIds` custom claim.** Rejected by CLAUDE.md; its 16-entry cap is the argument.
- **`contacts.invitationStatus`** and every other "copied so a list filter can avoid a join".
- **`members.user_uid` duplicating the document id** purely to enable a collection-group query — and
  the five commits (`6f9b99a`, `3c10010`, `885af89`, `0be3969`, `8472d38`) spent making it work.
- **Full-document share snapshots.** decisions #6 already chose "render live, no per-share snapshot".
- **The user-authored budget formula AST.** Tempting, but it is a spreadsheet bolted to a document
  store, and decisions #16.2 rejected free-form deal types for exactly this reason: *"free text
  breaks the settlement engine + DB integrity"*. A formula field is the same hazard one level down.
- **`users/settings/main.roles[]`** — one account holding venue + promoter + performer at once.
  Superseded by one `kind` per account (story.md).

---

## 5. The security rules vs `authorize()` + `serialize()`

The rules encoded **five layers**: array membership on the event; profile membership by document
existence; a role tier from the member doc; a *permission* tier from the collaborator doc, projected
into `editorUids`/`adminUids`; and live entitlement reads from `plans/{profileId}`. Our
`floor ∪ band ∩ ceiling` model (decisions #4) is strictly more expressive for the first four and
better for the fifth.

Notably: **there is not one `diff().affectedKeys().hasOnly([...])` in the file.** Field-level
protection was equality pins, `allow update: if false`, and required-shape assertions on create.

### What we cover, and cover better

| Old protection | Ours |
|---|---|
| `events/*/budgets/{profileId}` readable only by that profile's members — a per-party financial partition inside a shared event | `budgets.scope='private'` + `owner_profile_id`, enforced in `routes/budget.ts:160–190`, which returns **404 not 403** so the *existence* of a co-promoter's private budget is not disclosed. Better than the original. |
| `messages` immutable (`update: if false`) | `routes/messages.ts` exposes only `POST` — plus per-party threads, which one flat thread could not do. |
| `activity` / `event_activity` append-only | `routes/activity.ts` is `GET`-only; `audit_log` is append-only by decisions #2. And we have **one** feed with one shape, where they had two collections and two writers producing incompatible rows. |
| `profiles.owner_uid` immutable for non-owners (anti-escalation) | No route mutates `profiles.owner_user_id`; it is set once at create (`routes/profiles.ts:802`). |
| Member self-claim role allow-list excludes `owner` | Invitation `role` is validated per type; ownership transfer is not an invite path. |
| `permission == 'admin'` requires a paid plan | The `grant_admin` entitlement gate, now enforced at both create **and** accept (handoff A-37). |
| Event create requires an event-hosting profile type | `routes/events.ts:239` — `membership.kind !== "operator"` → 403. |
| Server-write-only collections (`plans`, `auditLog`, `adminAlerts`, `spamFlags`, `otpCodes`) | No client write path exists at all; every write goes through a route that authorizes first. Structurally stronger. |
| `notifications` create denied to clients | Server-side only — and in the old ruleset that protection **did not actually work** (below). |

### Findings worth flagging loudly

**F1 — Nothing re-confirms a deal when the event moves.** The old app forced a `pendingDateChange`
with per-party confirmations before a date, start time or end time change took effect, and emailed
off-platform parties a tokenized confirm/decline link. We have **no equivalent**: `PATCH /events/:id`
writes `eventDate` under an optimistic lock and every confirmed deal stays confirmed. A party can be
bound to a different night than the one they signed for. This is integrity, not merely a missing
feature, and it is the thing I would fix first.

**F2 — `audience_rsvps` is write-only in the old app *by rule* and read-nowhere in ours *by
accident*.** Theirs was `read, update, delete: if false` — a decision that not even the host reads the
list from the client. In ours it is written by `routes/public.ts:312` and **no route reads it**
(`Audience.tsx` renders a hardcoded `[]`). Same end state, opposite reasons. When the read route is
built, the GDPR rules resolved 2026-08-02 (separate, unbundled, per-recipient consent) must gate it —
it must not ship as "the operator sees the list".

**F3 — Field-level *stamping* on create is thinner in ours.** The old rules asserted
`sender_uid == uid()`, `event_id == eventId` and the presence of `created_at`/`sender_name` **at the
storage layer**, so a forged message was impossible even with a compromised client. We do the
equivalent in route handlers, which is fine — but there is no second line of defence and no database
`CHECK` tying `event_messages.sender_user_id` to the acting principal. An accepted architectural
trade; recording it so it stays a choice.

**F4 — `spam_flags` invisibility was deliberate and is now undocumented.** The old rule denied the
flagged party read access with the reason in a comment (*"so an abusive performer can't see their own
flag history"*). Our `spam_flags` table has no route, so the property holds vacuously. Whoever builds
the admin surface must know it was a decision.

**F5 — Templates were gated off performer profiles by rule** (`isPerformerProfile(pid)` negated on
both read and write). An entitlement expressed as authorization. Our `templates` table has
`profile_id` and decisions #16.11 caps templates by tier, but I found no kind-based gate. If
"performers do not get templates" still holds, it lives nowhere. See Q5.

### Old rules bugs we are glad not to have inherited

The strongest possible argument for the one-module approach — six defects in one 734-line file:

- **`users/{userId}/{document=**}` (`:569`) defeats `notifications` `create: if false` (`:564`).**
  Firestore ORs every matching `allow`, so the wildcard re-grants what the specific rule denied. A
  user could fabricate their own notifications. Two rules, five lines apart, silently cancelling.
- **`profiles/*/team` grants `write` (which includes delete) to any member** (`:538`), making the
  admin-only delete on the next line a no-op widening.
- **`publicBookingRequests`: `read, update: if isAuthed()`** (`:717`) — any signed-in user could read
  and modify every legacy booking request. A full cross-tenant hole.
- **`collaboratorWrites`: `read, write: if true`** — unauthenticated, unbounded, world-writable.
- **`hasEventEditPermission`'s legacy branch** (`:80–81`): on any event lacking an `editorUids` key,
  *anyone with read access can write*. Whether that set is empty depends on a backfill having run.
- **The messages read path requires no auth at all** — the thread of any published+confirmed event,
  including `sender_uid` and `sender_name`, was world-readable. And it uses bare
  `parentEvent(eventId).published` rather than `.get(…, false)`, so it errors on an event missing the
  field instead of denying.

---

## 6. Prioritised actions

### PORT NOW

1. **Date-change re-confirmation (F1).** *Migration sketch:* add
   `event_change_proposals(id, event_id, proposed_by_participant_id, proposed_at, previous jsonb,
   proposed jsonb, status)` plus `event_change_confirmations(proposal_id, participant_id,
   share_recipient_id, status, responded_at, responded_by)` — one row per party, `participant_id`
   XOR `share_recipient_id` so off-platform parties confirm through the existing `shares`/OTP front
   door; applying a proposal is the only path that writes `events.event_date`/times, and only once
   every row is `confirmed`.

2. **Cost splits in the settlement engine.** The meeting doc binds it and the old app shipped it.
   *Migration sketch:* no new table — `budget_lines.cost_split` exists; give it a validated shape
   (`{participantId: basisPoints}` summing to 10000), add `costSplit` to `SettlementBudgetLine`, and
   have `reconcile()` step 3 allocate the line across the map with `allocate()` instead of charging a
   single `payeeParticipantId`. Add a `CHECK` that a line has either `payee_participant_id` or
   `cost_split`, never both.

3. **Wire `ticketsSold` and the `deals.terms` write path.** Not a port — a repair of our own dead
   columns, and the precondition for escalators and bonuses that the old app *shipped*.
   *Migration sketch:* add `events.tickets_sold integer` (or aggregate it from ticket-tier lines);
   pass it into `SettlementInput`; accept `terms` (escalators, bonus) on `POST`/`PATCH /deals` and
   map it into `SettlementDeal`.

### PORT LATER

4. **VAT per money line — new work, not a port.** Neither app ever computed it; the old one only
   stored it. Sequence it with the invoice/payments phase, where the jurisdiction rounding rules in
   `docs/money.md:42` have to be settled anyway. *Migration sketch:* `vat_rate integer` (basis
   points) + `vat_mode text` (`included`/`on_top`), nullable, on `budget_lines` and `deals`; compute
   in minor units via `allocate()`.

5. **Actual tickets sold per tier.** *Migration sketch:* extend the existing `budget_lines.details`
   convention — a revenue line with `details.basis='ticket_tier'` already carries
   `unitAmount`/`quantity`; add `soldQuantity` so estimate and actual sit on one row. Resolve the
   duplication with `events.extras.ticketTiers` (a second, major-unit ticket-tier store) at the same
   time; two stores for one concept is how the old app's `artist_fee` / `offer_fee_min` pair started.

6. **A genre vocabulary.** *Migration sketch:* seed `genres(id, category, label)` from
   `src/lib/genres.ts` (~200 rows, 14 categories) and `profile_genres(profile_id, genre_id)`; migrate
   `profiles.details.genres` strings by exact match, leaving unmatched strings in the jsonb for
   review. Normalizing is the point — genre is a discovery filter, and the rule is normalize what you
   filter by.

7. **Time-bounded profile locations.** *Migration sketch:* add `label text`, `starts_on date`,
   `ends_on date` to `profile_locations`; "primary" becomes "the row active today, else
   `is_primary`". Check the #17 interaction first — territory derives from the primary location's
   country, and a tour leg must not silently move an account's market.

8. **Room/stage on schedule items and tasks, plus an assignee on schedule items** (decisions #16.5).
   *Migration sketch:* `schedule_items.stage_id`, `tasks.stage_id`, both
   `references(stages) ON DELETE SET NULL` to match `events.stage_id`; plus
   `schedule_items.assignee_participant_id`. Pairs with audit A-31.

9. **PRO tariffs and a real setlist shape — an inherited *design*, not lost data.** The old types
   were dead, so this is greenfield with a head start. *Migration sketch:* `pro_tariffs(pro_code,
   country, event_type, percentage_rate, percentage_rate_high, price_threshold, minimum_fee,
   complimentary_ticket_fee, flat_fee, currency, estimate_only, updated_at, notes)` keyed
   `(pro_code, country, event_type)`; give `setlists.items` a real Zod shape (`title, composer,
   lyricist, publisher, position, proWorkId`); extend `performance_reports` with
   `final_tickets_sold`, `attendance`, `comp_tickets`, `pre_estimate`, `post_estimate`,
   `reporting_status`. The STIM/GEMA arithmetic in `calculateProFee:963–993` is real and portable to
   minor units. This also un-deads `performance_reports` (audit A-32).

10. **Small event and venue fields.** One additive, all-nullable migration: `events.archived boolean`,
    `events.cancel_reason text`, `events.source_request_date date`,
    `performer_tag += 'special_guest'`, `stages.capacity_standing` / `capacity_seated`, an `isMain`
    marker on `capacity_setups`.

11. **Controlled vocabularies for `booking_requests.sender_type` / `performer_type`.**
    *Migration sketch:* convert to `pgEnum` with the old 6 / 7 / 9 values plus `other`. Production
    currently holds 1 user, 1 profile, 1 draft event — free now, expensive later.

12. **Standalone agreement documents** — only if Q1 says yes. *Migration sketch:* a `files` row plus
    a `profile_documents` join. It must not become a second agreement model.

### DO NOT PORT

13. **`accessUids` / `accessProfileIds` / `editorUids` / `adminUids`** and every line maintaining
    them.
14. **The `profileIds` custom claim** — capped at 16, stale by construction, contrary to CLAUDE.md.
15. **`plans.eventCapBlocked`** and the seven sibling stored counters. Fresh `COUNT` is right.
16. **The `{ownerUid}__{roleSlot}` id convention** and any rule that parses an id.
17. **`settlementParties.ts`.** It is on CLAUDE.md's "port verbatim" list and it should not be. Its
    entire job is folding a phantom "Promoter" party that only exists because
    `calculateSettlement` hardcodes a promoter/venue/organizer vocabulary (commit `17d0b41`).
    Party-scoped `deal_parties` dissolves the problem. `settlementUtils.ts` and `holdRankLogic.ts`
    remain worth their place; this one is a workaround, not domain logic. **Flagging because it
    contradicts CLAUDE.md and I believe CLAUDE.md is wrong here.**
18. **The user-authored budget formula AST.** Same failure mode as the `custom` deal type that
    decisions #16.2 removed. Keep the named derivations in `budget-planning.ts`.
19. **`meta/main` as a shape**, the parent/child multi-performer tree and its date-change relay,
    one-settlement-per-event, multi-role accounts, full-document share snapshots, and the
    delete-and-recreate collaborator sync.
20. **`contacts.invitationStatus`** and every other "copied so a list filter can avoid a join".

---

## 7. Questions for the owner

1. **Standalone agreement documents.** decisions #1 left this open. The old app had
   `Agreement.type = 'terms'` with a file — a venue's standing T&Cs attached to an event, no money,
   no parties. Was that a real thing users did, or an unused affordance? With no exported documents I
   cannot tell whether any `type: 'terms'` agreement was ever created.

2. **Were the budget formula fields ever used in production?** `FormulaBuilder.tsx` exists and
   `BudgetCalculator.tsx:141` mounts it, and unlike `ProTariff` the formula code is genuinely live —
   but I cannot tell whether any stored budget carried a user-authored formula, or whether every one
   used only the eight default fields. If nobody used it, item 18 is uncontroversial.

3. **Was `deal.organizerSplit` / `organizerCostSplit` ever non-zero?** The four-party split was in
   the math, but `buildPartyNames` only emits an Organizer row when `operatorType === 'organizer'`.
   Whether real events had a *separate* organizer party alongside a promoter changes how urgent
   generalized cost splits are.

4. **Should the genre taxonomy be shared across markets?** decisions #17 makes the platform
   territory-scoped and the old taxonomy is Anglophone. One global `genres` table, or per-market
   vocabularies? This changes item 6.

5. **Does "performers get no templates" still hold?** It was a hard rule in `firestore.rules:551–556`.
   I found no equivalent in our entitlement layer and cannot tell whether it was dropped deliberately
   or lost.

6. **`meta.memberSections: Record<string, string[]>`.** Stored and read by the Crew tab for section
   grouping, but I could not establish what a "section" is in product terms, so I have not judged
   whether we lose anything.

7. **The `activity` vs `event_activity` split.** Two parallel append-only feeds with near-identical
   rules and separate notification triggers — one settlement-scoped, one event-scoped, but they
   overlap (`status_changed` appears in both vocabularies). Our single target-scoped `activity_log`
   may or may not be losing a distinction worth keeping.

8. **Was VAT ever expected to affect payouts?** The old app collected `{rate, mode}` on five
   different line types and then ignored it in the math. Someone typed those numbers in. Knowing what
   they expected to happen determines whether item 4 is "display the VAT breakdown" or "settle net of
   VAT", which are very different pieces of work.
