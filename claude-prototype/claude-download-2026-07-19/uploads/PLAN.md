# Plan — shoWMe rebuild: Events & Deals data model (Postgres)

> **2026-07 fold-in:** this document now incorporates the working-session decisions (agreement→deal merge,
> mandatory same-txn audit, target-scoped activity feed, three-tier permissions + pure party-scoping, invoices +
> payout identity, generalized `shares`, Setlists). Rationale + still-open product calls: `docs/decisions.md`;
> deferred payments: `docs/payments.md`; off-platform access: `docs/off-platform-access.md`.

## Context

shoWMe is a pre-launch live-events booking + settlement SaaS, currently on Firebase/Firestore.
It began as a Lovable/Supabase prototype, migrated to Firestore, where all real multi-tenancy was
built. The data is deeply relational (events ↔ profiles ↔ members ↔ deals ↔ settlements, many-to-many
access), aggregation-heavy (settlements, caps), and barely uses realtime. ~40% of the backend
(~1,700 LOC) exists only to maintain Firestore denormalization (accessUids fan-out, claims sync,
counters) — and the recurring production bugs are all "a hand-maintained join drifted."

Decision: **build a NEW project from scratch onto Postgres — a separate repo, NOT this one.** No data to
migrate (pre-launch). The current repo is the **reference source** only: proven domain logic
(`calculateSettlement`, hold ranking), the existing test suites (executable spec for edge cases), and the
requirements captured here. This document is the **blueprint** to hand to the new project. It currently
details the **events and deals** modules (built first) plus the locked cross-cutting decisions; remaining
modules (profiles/identity, permissions, settlement, content, invitations, notifications) are still being designed.

## Locked architecture decisions

- **Database:** Postgres (relational). Access = joins, not denormalized arrays. Caps = `COUNT()`, not counters.
- **Infra + API stack (DECIDED):** Cloud SQL for PostgreSQL + Cloud Run. API = **Fastify + Zod**
  (`fastify-type-provider-zod`) + **Drizzle ORM** (`drizzle-zod` derives Zod from tables) + `firebase-admin`
  (verify ID token in a `preHandler` hook) + `@google-cloud/cloud-sql-connector` with a small per-instance pool.
  Domain logic (settlement/holds) = plain TS modules called by handlers (framework-agnostic). Not SQL Connect.
- **Monorepo & toolchain (DECIDED):** **pnpm** workspaces + **Turborepo**. `apps/` = `api` (Fastify, Cloud Run
  scale-to-zero), `stream` (SSE, Cloud Run min-instances=1), `web` (React 19 + Vite SPA → Firebase Hosting), `ssr`
  (Vite SSR of public pages → Cloud Run). `packages/` = `db` (Drizzle + drizzle-kit migrations), `shared`
  (drizzle-zod schemas + types + capability enum), `auth` (`authorize`/`serialize`), `settlement` (ported pure-TS
  math + vitest suites), `ui` (presentational components shared by `web` + `ssr`), `api-client` (**orval**-generated
  TanStack Query hooks + a thin hand-written cross-endpoint invalidation layer). **Types flow one way:**
  drizzle-zod → Fastify emits OpenAPI (`fastify-type-provider-zod`) → orval generates the typed client. **Node 22**,
  **Biome** (lint + format), **Vitest** + **Testcontainers** (real ephemeral Postgres) + **Playwright** (e2e),
  **GitHub Actions** → Cloud Run (Turbo remote cache), **Secret Manager** for creds/keys.
- **Auth:** keep **Firebase Auth**; the Postgres `users` row is keyed by the Firebase `uid`; the API verifies the ID token.
- **Authorization:** ReBAC (relationship-based) — permissions derived by traversing `user → profile_member → profile → event_participant → event → resource`, enforced by a single server-side policy module (replaces `firestore.rules` + scattered client checks).
- **Product layer = account kind:** a user account has a **kind** (operator | performer | professional | agent) chosen at signup; it gates profile creation, dashboard, features, and pricing. Kept **separate** from authorization (entitlement ≠ permission). (`agent` = booking agent who represents performers — decisions #14.)
- **Events are containers; parties are participants.** No parent/child "child events" for multi-performer.
- **Deals are party-scoped agreements** (see below). No global "host sees all."

## Architecture at a glance

```
React 19 + Vite + TanStack ──HTTPS + Firebase ID token──▶  Fastify API on Cloud Run
        ▲                                                    (stateless, Zod + Drizzle, scales to zero)
        └───────────── SSE (live) ◀── realtime service ──────────────┤
                                                                      ▼ (indexed joins)
                                       Cloud SQL for PostgreSQL (Stockholm) — source of truth
   alongside: Firebase Auth (identity) · Cloud Storage (files) · Brevo (email) · Cloud Scheduler/Jobs (reapers)
```
- **Identity:** Firebase token carries only `uid`; everything reachable is resolved from Postgres per request (no claims, no profile cap).
- **Pipeline (every request):** verify token → resolve principal (flat memberships) → `authorize(capability)` → Zod validate → Drizzle handle → `serialize(capabilities)` → audit.
- **Spine:** `profiles` + `events` are the hubs; `profile_members` and `event_participants` are the joins that replace all Firestore fan-out. Money = deals/deal_parties + budgets/budget_lines + settlements/settlement_transfers.
- **Authorization:** ReBAC via joins + field-level `serialize` + a separate entitlement (plan) layer. Account **kind** gates whole surfaces; `serialize` redacts within shared ones.
- **Settlement:** two kinds of money (external cash vs entitlements) → `entitlement − cash-held → transfers`, `Σ net = 0`.
- **Realtime:** one SSE stream per user (POST send / SSE receive) via `LISTEN/NOTIFY`.
- **Through-line:** relational joins replace document denormalization (deletes ~1,700 LOC of fan-out + its bug classes); one authorization module replaces rules+callables+client-hiding; Postgres serves the relational spine **and** `jsonb` leaves.

**Hosting & SSR:**
```
Firebase Hosting (CDN, SPA + Firebase Auth)
  ├─ /p/**, /event/**, /request-date/**  → rewrite → Cloud Run (SSR renderer)   -- SEO/link-previews
  └─ everything else                     → the SPA static build
api.yourapp.com     → Cloud Run (Fastify API)      -- Bearer-token auth (Firebase ID token) + CORS
stream.yourapp.com  → Cloud Run (SSE realtime)     -- DIRECT: CDN buffers/timeouts break SSE, so bypass Hosting
```
- Frontend on **Firebase Hosting** (kept). API on **Cloud Run** — either fronted by Hosting rewrites (single origin) or a subdomain (cleaner, since auth is Bearer-token not cookies). **Not** Firebase App Hosting (that's for framework SSR). Cheap/credit-covered.

## Events model (Phase 1)

```
events
  id, host_profile_id → profiles, title, status, event_date,
  door_time, start_time, end_time, curfew,   -- LOCAL wall-clock times (no offset)
  timezone,                   -- IANA (e.g. Europe/Stockholm); defaulted from venue location + SNAPSHOT onto event; anchors all local times above (DST/reschedule-safe)
  venue_profile_id → profiles (nullable), venue_name, capacity, base_currency,   -- event settlement/reporting currency
  published, notes, extras jsonb (amenities/catering/ticket links),
  created_by → users, created_at, updated_at

event_participants           -- replaces participants + collaborators subcollections,
  id, event_id → events,        child-events, AND accessProfileIds[]/accessUids[]
  profile_id → profiles,
  role,                       -- host | co_host | performer | support | crew_lead | crew | agent (represents a performer; fan-out from representations, decisions #14)
  permission_set_id → permission_sets,   -- modular capability bundle (data-driven)
  performer_tag (nullable),   -- headliner | support | dj | opener (display)
  stage_id → stages (nullable),
  status,                     -- invited | accepted | declined | confirmed | removed
  added_by → users, timestamps,
  unique(event_id, profile_id)

stages                        -- optional, festivals/multi-stage
  id, event_id → events, name, capacity
```

- Host is stored as `events.host_profile_id` (ownership) **and** as an `event_participants` row (`role=host`),
  so access is one uniform join.
- **Access query (replaces the ~1,700 LOC accessUids fan-out):**
  ```sql
  SELECT e.* FROM events e
  JOIN event_participants ep ON ep.event_id = e.id
  JOIN profile_members    pm ON pm.profile_id = ep.profile_id
  WHERE pm.user_id = :uid AND pm.status = 'active' AND ep.status <> 'removed';
  ```
- **Multi-performer** = N `event_participants` rows with `role=performer`. Single-performer = 1. No parent/child.

### Event operator & delegation

- The **operator** of an event = the participant that *manages* it: creates deals, invites/manages participants,
  runs settlement, sends event info emails. This is a **role on the event (a participant), not a profile kind** —
  "the actual operator, not just the profile type." Deal-creation authority belongs to the operator, not to every
  operator-kind profile.
- **Any operator-kind profile can be the operator** — venue, promoter, organizer, or festival. `events.host_profile_id`
  points at whichever profile is running it. The *same* venue profile is the operator in one event and an arm's-length
  rental party in another — role is per-event, not per-profile. Common topologies, all the same tables:
  - **Venue-run:** the venue is operator → direct `performance` deal with the performer, holds revenue, sees all; **no rental deal**.
  - **Promoter-run (rental):** the promoter is operator → a `rental` deal to the venue (arm's-length) + the performance deal.
  - **Co-promotion:** multiple operators share a budget with full transparency.
- **Delegation / manage-on-behalf:** the operator role is assignable. In a rental where the renter (promoter) is
  **off-platform**, the **venue acts as operator** and manages the event on their behalf; operator authority
  transfers to the renter if/when they join. Generalizes the existing venue-handoff / unclaimed-profile flow
  (`pendingHostHandoff`, stub profiles, `invitationCodes`).
- **Off-platform parties:** an `event_participants` row may reference an **unclaimed/stub profile** (off-platform
  renter/performer). They hold a place in the deal/settlement graph; an on-platform operator manages until they claim it.
- **Communication:** the operator can **send sectional info emails** (schedule/section details) to parties, via the
  existing Brevo `sendMail()` (`functions/src/mail.ts`). Modeled as an `event.send_info_email` capability.

## Deals model (Phase 2) — party-scoped agreements

```
deals                         -- ALSO holds the agreement (agreement folded in, 1:1 — decision 2026-07)
  id, event_id → events,
  type,                       -- performance | rental | fee | split | custom  (relationship/grouping)
  structure,                  -- guarantee | door_split | guarantee_vs_door | rental  (standard v1 math; NULL = paper-only agreement)
  currency,                   -- the PAYOUT currency (what's actually paid out); defaults to event base_currency
  name,                       -- deal named after the entity/person (confirmed default)
  payer_participant_id → event_participants (nullable),  -- economic hub for THIS deal
  payment_timing,             -- before_event | at_settlement | due_date
  priority int,               -- rental / before-event settle first
  terms jsonb + structured cols,  -- guarantee, split_pct, escalator tiers[threshold → split], bonus, commissions
  agreement_body_text, agreement_status[draft|sent|confirmed|signed],  -- THE AGREEMENT (folded in; PDF always generatable)
  confirmed_snapshot jsonb, reopen jsonb,   -- freeze terms once all parties confirm (render live → snapshot); e-sign later = signature_hash
  status, created_by, timestamps

deal_parties                  -- "trickle down to multiple profiles"; kind-agnostic. Also carries per-party confirmation.
  id, deal_id → deals,
  participant_id → event_participants,   -- performer | operator | crew — agnostic
  role_in_deal,               -- payer | payee | split_member | commission | observer (read-only share, no entitlement — how a co-host is granted deal visibility)
  share,                      -- %/amount/terms for this party
  confirmed_at, confirmed_by, signature_hash   -- per-party agreement confirmation (replaces agreement_confirmations); e-sign populates signature_hash later
```

**Visibility rule:** a user sees a deal **iff they are a member of a profile that is a `deal_party` on it.**
Nothing else — no global host-sees-all. Consequences:
- Multi-performer: either **separate deals** (when terms differ — one guarantee, one split) OR **one `split` deal with N `split_member` parties** (shared allocation; shares validated to sum to 100%). Operator sees all shares; each performer sees only their own `deal_party` (serializer redaction) — co-performers don't see each other's split.
- Rental → a `rental` deal venue↔renter (paid first); the renter's separate performer deals are **invisible to the venue**.
- Future crew pay → a `crew` deal; same table.
- New arrangements → new `type` + `jsonb` terms, **no schema change**.
- **Crew get deals *and* agreements later = trivial (no migration):** because `deal_parties`, `agreements`, and
  `agreement_confirmations` all key off kind-agnostic `event_participants`, a crew/professional participant becomes a
  deal payee or agreement party by inserting rows. Only additive work: a permission-set entry so they see their own
  deal/agreement, and linking their budget cost-line (`budget_lines.deal_id`) to the crew deal to avoid double-counting.
  The deferred "deal ↔ crew separation" is a **UI/product** choice, not a schema one — the model supports either.

**Deal-creation authority:** deals are created by the event **operator** (the managing participant), not by profile
kind. `payer_participant_id` is typically the operator, or the off-platform renter the venue manages on behalf of.
Rentals use `payment_timing=before_event` + low `priority` (paid first); other deals `at_settlement`.

**Why `deal_parties` is a table, not embedded in the deal:** the app's core reads query *by party* — party-scoped
visibility ("which deals is participant X on?" on every access check), settlement reconciliation ("who owes whom"),
and the professional's own-deals list / marketplace. Indexes on `deal_parties(deal_id)` and `deal_parties(participant_id)`
make both directions a single fast indexed lookup, and Postgres returns `deal` + parties in one round-trip (Drizzle
hydrates a nested `deal.parties[]`, so it *reads* like a document). Embedding parties in a `jsonb` column would be
cheaper *only* for "load one deal by id" — but it cannot answer the by-party queries above without the denormalized
participant-array fan-out we are deliberately deleting. Rule of thumb: **embed what's always read together and never
queried across; normalize what you filter/join/aggregate by** — parties are the latter. (A `jsonb` escape hatch remains
for any genuinely embed-only deal fields.)

**Transparency model (from the 2026-07 product meeting):**
- **Operator** (the event-manager party) sees **all** financials.
- **Co-operators / co-promoters** get **full transparency** — they share a budget and see the whole financial picture.
- **Every other party** (performer, venue-as-rental, professional/crew) sees **only their own deal + settlement**, never the pool.
- The privacy line is drawn by *relationship*: co-promoters share; arm's-length parties (rental, guarantee) see just their slice.

**Product decisions locked in the 2026-07 meeting:**
- **"Operator"** is the UI label for the event-manager (tooltip: = legally the producer). Avoids "producer" ambiguity.
- **Freelancer model only** — no band-member accounts or intra-band revenue splits; a band is *one* performer profile; extra people are billed as seats. Keeps authorization simple.
- **Costs assignable to a specific deal** → per-deal accountability.
- **Consolidated "Deal" tab** — financial terms + agreement + accommodation + amenities live together per participant (event-details + agreements tabs merge). Data stays relational; the *UI* consolidates.
- **Deal name = the entity/person** on the agreement (final naming TBD).
- **Deal ↔ crew separation is DEFERRED** to the next product meeting.
- **Standard deal types for v1** + tiered escalators; **postpone** bar-%/extra-revenue splits (record in an agreement, calc manually) and complex per-party multi-tier splits.

## Settlement & budget — reconciliation, one per participant

**Mandate (meeting):** **one settlement per participant profile** — even when a deal covers several performers,
each participant gets their own individual settlement view.

**Budget — shared vs private (meeting):**
```
budgets(id, event_id, scope[shared|private], owner_profile_id nullable)     -- shared = all co-operators; private = one operator
budget_lines(id, budget_id, kind[revenue|cost], label, amount, currency,   -- currency defaults to event base_currency
             collected_by → event_participants nullable,   -- "Collected By" (revenue: who receives)
             paid_by      → event_participants nullable,    -- "Paid By" (cost: who fronts the cash)
             payee_participant_id → event_participants nullable,  -- cost: WHO the line is for — ANY participant (performer hotel/travel/catering, crew fee, deductibles…); null = external supplier
             cost_split jsonb nullable,                     -- split rule (e.g. 50/50) when shared
             deal_id → deals nullable)                      -- assign to a deal (accountability; later: crew deal)
```
- Co-promoters share **one** budget (full transparency); each operator may also keep a **private** budget. Templates for recurring same-promoter events.

**Settlement engine = "who owes whom":** from each party's **entitlement** (their deal), what they **collected**
(revenue lines) and what they **paid** (cost lines, incl. deductibles paid on another's behalf), compute each party's
net position and the resulting **transfers**.
```
settlements(id, event_id, participant_id → event_participants (nullable), representation_id → representations (nullable),
            status, computed jsonb, manual_overrides jsonb, created_at, updated_at)
            -- exactly ONE of participant_id / representation_id is set:
            --   participant_id  = the per-participant EVENT settlement (one per participant)
            --   representation_id = the private agent↔performer COMMISSION settlement (one per shared event, decisions #14) —
            --                       same engine, same transfers; agent_collects redirect resolved per entitled line at payout
settlement_transfers(id, event_id, from_participant, to_participant, amount, state[owed|paid|handled])
```
- **Manual override + "paid / already handled" flags** everywhere — the platform can't know who holds cash, so parties confirm received amounts. **No escrow** (deliberate — avoids legal complexity); money is *tracked*, not *held*.
- **Deductibles:** one party pays an expense on behalf of another → recorded and netted out of the other's cut.
- Future: ticketing-API revenue sync (must still allow manual cash-at-door entry).

**Reuse verbatim (pure TS, zero Firestore coupling — confirmed):**
- `src/lib/models.ts` — `calculateSettlement()` primitives, `DealStructure`, `TicketRevenue`, `PartyBreakdown` (engine now consumes collected/paid/entitlement inputs and emits transfers)
- `src/lib/settlementUtils.ts` — `buildSettlementUpdate()`; `src/lib/settlementParties.ts` — party display/merge
- `functions/src/holdRankLogic.ts` (+ tests) — hold ranking
- The 50+ existing unit tests = executable spec (VAT modes, guarantee-vs-door, hold promotion).

### Reconciliation algorithm

**Two kinds of money:** **budget lines** = external cash (revenue `collected_by`, external costs `paid_by`); **deals** =
inter-party entitlements (guarantee/rental/split/commission — claims, not cash movements). Settlement reconciles them.

Per event:
1. **Pool** = Σ revenue lines − Σ external cost lines.
2. **Entitlement `E_p`** per party from their deal (ported `calculateSettlement` primitives): fixed guarantee/rental ·
   %-split of pool · guarantee_vs_door = `max` · escalator tier by actual sold · commissions (deduct from recipient,
   credit the commission party — **disclosed/off-the-top only**; private **agent** representation is a separate
   representation-scoped settlement, decisions #14) · bonus if threshold · costs assigned to a deal reduce that
   party's `E` · **operator = residual**
   (pool − Σ others); co-operators split the residual per their split deal.
3. **Cash held** = `C_p − P_p` (revenue collected_by − costs paid_by).
4. **Net** `net_p = E_p − (C_p − P_p)`  (+ = owed to them; − = holding too much).
5. **`Σ net_p = 0`** — conservation law → built-in correctness assertion + property test.
6. **Transfers** — greedy-match debtors → creditors into minimal `settlement_transfers`.
7. **Timing/state** — `before_event` deals pre-settle (transfer marked `paid` upfront); `at_settlement` settle now.
   Every transfer/settlement carries `manual_overrides` + `state(owed|paid|handled)`. **No escrow** — recorded, not moved.
8. **Currency** — pool math runs in `events.base_currency`; amounts in another currency convert at a **locked FX rate**
   (captured at finalize, overridable); each transfer is *paid* in the payee deal's native currency. Display conversion
   (viewer's currency, live FX) is a separate cosmetic layer that never affects these figures.

**Deductibles need no special case:** a cost `paid_by=venue` assigned to the band's deal lowers `E_band`, raises
`P_venue` → net shifts so the venue recovers what it fronted. **Per-participant settlements** fall out of the same
computation (one `settlements` row each: E / collected / paid / net / transfers; serializer shows each party only theirs).

**Reuse:** per-deal math (`src/lib/models.ts::calculateSettlement`: guarantee/door/vs/commission/bonus/VAT) ports verbatim;
only the *orchestration* (pool → entitlement → cash → net → transfers) is new. Add a property test asserting `Σ net = 0`.

**Worked example:** P operates, rents V €1,000, books B €3,000; tickets €10,000 (collected P), production €1,500 (paid P).
Pool=8,500 · E: P=4,500(residual), V=1,000, B=3,000 · held: P=8,500, V=0, B=0 · net: P=−4,000, V=+1,000, B=+3,000 (Σ=0)
→ transfers P→V €1,000, P→B €3,000.

## Full relational data model — all remaining modules

> Every legacy Firestore model is treated as **bad**; below preserves only the *behavior*, redesigned relationally.
> Notation: `table(col, col → fk, …)`. Access = the ReBAC rule that gates it.

### Cross-cutting redesign decisions (what we deliberately fix)

1. **Unify 3 invite systems** (`profileInvites` + `collaboratorInvites` + `invitationCodes`) → one `invitations` table.
2. **Fold the non-user "team" directory into `profile_members`** via a nullable `user_id` (null = contact/crew record, set = real user).
3. **Freemium counters become derived, not stored** — event cap = `COUNT(*)` query (no drift), credits = a ledger, spam = `COUNT(DISTINCT reporter)`. Kills the counter-maintenance code.
4. **Drop the custom-claims sync trigger** — compute `profileIds`/access per request via joins (short-lived Firebase token only for identity).
5. **Server-side notification read state** (`read_at`) — fixes today's client-only read tracking.
6. **Unify `event_activity` + `activity` (settlement)** → one `activity_log` with `scope` + `visibility` columns.
7. **Unify the two todo models + two calendar models** → single `tasks` and `calendar_items` tables with nullable scope owners.
8. **Explicit profile claim state** (`claimed_at` nullable) instead of implicit `unclaimed`/`acquired`.
9. **Real `event_messages` schema + `visibility`** (fixes untyped messages; lets operators keep internal notes).
10. **Fix settlement-snapshot drift** — render shares live from tables; store an immutable snapshot only when a settlement is *finalized* (legal record).
11. **Normalize profile arrays** (media, locations, social links) into child tables; per-type fields = core columns + `jsonb details` (+ extension tables for heavily-queried venue fields).
12. **Contacts scoped to a profile** (an operator's address book), not to a user.

### Table consolidations (after review — ~57 → ~42)

Rule: *normalize what you filter/join/aggregate by; embed what's always read with its parent and never queried across.*
The blocks below still show the normalized form for clarity; these fold the read-with-parent children in:
- **Auth 3 → 1:** `capabilities` = code enum; `permission_set_capabilities` → `permission_sets.capabilities text[]`.
- **Profile arrays → columns on `profiles`:** `profile_social_links`, `profile_media`, `profile_custom_roles` (jsonb/text[]). *Keep `profile_locations`* (discovery queries it).
- **`crew_details` → `event_participants.details jsonb`.**
- **Agreement reopen → `agreements.reopen jsonb`** (drop `agreement_reopen_requests` + `_approvals`; keep `agreement_confirmations`).
- **`settlement_approvals` + `settlement_snapshots` KEEP standalone tables** (decision 2026-07 — versioned revisions wanted; do NOT fold into `settlements`).
- **`contact_persons` → `contacts.persons jsonb`**. (`share_recipients` STAYS a table — carries OTP/claim/party-link state; 2026-07.)
- **`admins` → `users.is_admin`** · **`plan_history` → `audit_log`** · **`fx_rates_cache` → app cache**. (`pro_reports` → renamed **`performance_reports`** table, derived from `setlists`; 2026-07.)
- **Borderline:** `task_reminders` — keep a table only if reminder-notification jobs query by date; else `tasks.reminders jsonb`.
- **Kept normalized (queried across — do NOT fold):** `event_participants`, `deal_parties`, `budget_lines`, `settlements`/`settlement_transfers`, `profile_members`, `profile_locations`, `venue/performer/professional_details`, `spam_flags`.

### A. Identity & accounts
```
users(id = firebase uid, email, name, initials, avatar_url, currency, date_format,
      time_format, timezone, company_name, country, kind[operator|performer|professional|agent],
      anonymized_at nullable, created_at)   -- timezone (IANA) = display + user-local reminders; anonymized_at = GDPR erasure tombstone (anonymize-not-delete)
profiles(id, kind, type, owner_user_id → users, name, slug uniq, is_public,
         bio, avatar_url, banner_url, details jsonb, claimed_at nullable, created_by, timestamps)
profile_media(id, profile_id → profiles, kind[photo|video|banner|avatar|document], url, position)
profile_locations(id, profile_id, city, country, lat, lng, is_primary)
profile_social_links(id, profile_id, platform, url)
payout_accounts(id, profile_id → profiles, currency, holder_name, iban, bank_name, is_primary)  -- party's OWN money identity → later a Stripe Express connected account
-- profiles also gains billing jsonb: legal_name, address, vat_id, vat_registered, vat_rate, invoice_number_seq (GAPLESS — the one deliberately-stored counter)
profile_members(id, profile_id → profiles, user_id → users NULLABLE, email, display_name,
                role[owner|admin|editor|viewer|crew], seat_consumed bool, status, permission_set_id nullable,
                phone, notes, added_by, timestamps, unique(profile_id, user_id))
                -- user_id NULL = off-platform contact (invitable → claim). PER-PROFILE role (a user can be admin on
                -- one profile, editor on another). admin = OWNER-LEVEL minus owner-only (billing/delete/transfer) &
                -- CONSUMES A SEAT; editor(edit,no financials/members)/viewer(read)/crew(event-assigned, own slice) = free.
profile_custom_roles(id, profile_id, label)           -- crew role vocabulary
groups(id, owner_user_id → users, name)                       -- reusable member bundles, owned at USER/org level (2026-07)
group_members(id, group_id → groups, user_id → users NULLABLE, email, role_label, default_permission_set_id nullable)
group_profiles(id, group_id → groups, profile_id → profiles)  -- a group serves MULTIPLE profiles (cross-profile); user can be in many groups
-- adding a group to an event fans out crew into event_participants(role=crew), referencing each member's OWN identity (not a copy)
representations(id, agent_profile_id → profiles, performer_profile_id → profiles, region (ISO country codes) + is_worldwide bool,  -- standing agent↔performer agreement (decisions #14)
                commission_rate (basis points), commissionable_basis, agent_collects bool,  -- agent_collects = agent is default payout destination
                proposed_by[agent|performer],  -- SYMMETRIC: either side can invite + propose terms; who made the current offer
                status[proposed|active|terminated], starts_at, ends_at, confirmed_by_agent, confirmed_by_performer,
                terminated_at, terminated_effective_at, terminated_by)  -- ONE active agent per performer per region (regions DISJOINT)
-- BIDIRECTIONAL: agent invites performer OR performer invites agent. The proposer auto-confirms their side; the counterparty
-- confirms to activate, OR counters (edits terms → re-stamp proposed_by, CLEAR the other's confirmation). Counter history = audit_log (#2).
-- LIKE A GROUP: on the performer's IN-REGION events, fans out into event_participants(role=agent, negotiate/approve) and flags
-- the performer's participation delegated (view-only). Agent authority = an ordinary permission set, NOT an auth override.
-- Commission is NOT an event deal_party — separate representation-scoped settlement (settlements.representation_id). When agent_collects,
-- the performer stays the entitled payee; the agent is only the PAYOUT DESTINATION (never a separate entitled party). Termination:
-- unilateral + effective-dated; commission follows the CONFIRMED deal (deals confirmed while active keep commission post-termination).
```
- `users.kind` is **fixed at signup and locked to one value** (Decision A) — gates profile creation (you may create
  only profiles of your kind), dashboard, features, pricing. A cross-kind person (e.g. promoter + DJ) creates a
  second account. Profiles inherit their owner's kind.
- Venue-heavy queryable fields (capacity, amenities, sub-venues/rooms, setups) → a `venue_details` extension table; performer fields (genres, spotify, deal prefs, bonuses) → `performer_details`. Rare fields stay in `profiles.details` jsonb.
- **Professional** profiles (`kind=professional`) get `professional_details(specialties[] e.g. sound|lighting|catering|security|stage, rates, service_area, availability)` — the marketable identity behind a future **professionals marketplace** (operators & performers post jobs; professionals apply). On an event, a professional participates with `role=crew`. "Crew" is the event-role; "professional" is the account kind.

**Feature surfaces by account kind** (product/entitlement gating — coarse, on `user.kind`; distinct from the per-event serializer):
- **Operator-only:** create/host & publish events · budget planner (shared/private, Collected-By/Paid-By) · full all-party settlement ("who owes whom") · deal authoring · hold ranking · incoming booking-requests inbox · participant management · crew assignment + call sheets + info emails · venue/production setup (capacity, rooms/stages, amenities, ticketing) · audience RSVPs · spam flagging · operator plan/billing.
- **Performer-only:** send offers/pitch venues · availability calendar + public link · "my bookings" across venues · rider submission · respond to invites / confirm holds · performer plan (offer cap, collab credits).
- **Agent-only:** roster of represented performers (Agents & Performers page) · negotiate/approve deals on behalf of in-region performers · commission owed/collected + statements · agent plan/billing. Acts on a performer's event via `event_participants(role=agent)` fanned out from a `representation`; commission settles in a separate representation-scoped settlement (decisions #14).
- **Never visible to performers** (even within a shared event): event budget · other parties' deals/settlements · the reconciliation · other performers' financials. **Cross-event:** a performer's dealings with Venue X are invisible to Venue Y (falls out of party-scoping — operators only see events they participate in).

### B. Authorization (the permission model)
```
permission_sets(id, profile_id → profiles NULLABLE, name, description, capabilities text[])  -- NULL = system preset
```
- `event_participants.permission_set_id` → the modular bundle ("Schedule-only", "Promoter co-host", "Host admin").
- Profile-level roles (`owner|admin|editor|viewer|crew`) are a code-defined enum, **per-profile membership** (a user may hold different roles on different profiles). `admin` = owner-level **minus owner-only** actions (billing/plan, delete profile, transfer ownership) and **consumes a seat**; `editor`/`viewer`/`crew` are free. **event-level** roles use `permission_sets` (data-driven, the modularity requirement).
- Central `authorize(user, action, resource)` policy module = the only place rules live.

### C. Monetization & entitlements  (separate layer from authorization)
```
plans(profile_id pk → profiles, tier[free_operator|operator_pro|free_artist|artist_pro],
      status, source[manual|stripe], assigned_at, assigned_by, renewal_at, seats, cancel_reason)
plan_history(id, profile_id, from_tier, to_tier, at, by, reason)     -- immutable audit
credit_ledger(id, profile_id, delta, reason, at)                     -- collab-invite credits = SUM(delta)
```
- Event cap, monthly offer cap, spam suspension = **computed** (`COUNT`/`COUNT(DISTINCT)`), not stored counters.
- `can_use_feature(profile, feature)` is a distinct check from `can(user, action, resource)` — never conflate billing with permissions.

### D. Invitations (unified)
```
invitations(id, type[profile_member|event_participant|code], code uniq nullable, token uniq nullable,
            status[pending|accepted|declined|revoked|expired|used],
            created_by_user, created_by_profile nullable,
            recipient_email, recipient_name,
            target_profile_id nullable, target_event_id nullable, linked_contact_id nullable,
            role nullable, permission_set_id nullable, password_hash nullable,
            source[collaborator|admin|team|venue_handoff|performer_offer],
            expires_at, used_by_user nullable, used_at nullable, created_at)
```
- One table replaces `profileInvites` + `collaboratorInvites` + `invitationCodes`. Human `SHOW-XXXX-XXXX` code for code-style invites; opaque `token` for link invites.
- Venue-handoff is `source=venue_handoff` linking a `target_event_id` + an unclaimed `target_profile_id`.

### E. Contacts (address book — profile-scoped)
```
contacts(id, owner_profile_id → profiles, name, type, iban, bank_name, vat_id, address,
         notes, invitation_id nullable, timestamps)
contact_persons(id, contact_id → contacts, name, email, phone)
```

### F. Event content  (Phase 4/5)
```
riders(id, owner_profile_id → profiles NULLABLE,       -- LIBRARY: performer/venue's reusable rider (event_id NULL)
       event_id → events NULLABLE, owner_participant_id → event_participants NULLABLE,   -- INSTANCE: attached to an event
       type[tech|hospitality|stage_plot|input_list], name, description, file_id → files,
       source_rider_id → riders NULLABLE,              -- which library rider this instance was COPIED from (snapshot on attach)
       is_default bool, created_by, timestamps)        -- is_default = auto-attach when the owner joins an event
       -- profile-level library (reusable, kind-agnostic) + event instances; attaching COPIES (master stays theirs; edits don't touch past events)
-- crew = event_participants(role=crew) → a PROFESSIONAL profile (real account; unclaimed stub if off-platform, invitable to claim)
crew_details(participant_id → event_participants pk, specialty, call_time, task, pay_note)   -- per-event crew info
-- crew pay/settlement (later) = a deal(type=crew) with the professional as payee — zero schema change
-- AGREEMENTS ARE FOLDED INTO deals + deal_parties (decision 2026-07): agreements / agreement_confirmations /
--   agreement_reopen_* are GONE. The deal holds agreement_body_text/status/confirmed_snapshot/reopen; deal_parties
--   holds confirmed_at/signature_hash. A paper-only agreement = a deal with NULL `structure`.
schedule_items(id, event_id, stage_id nullable, start_time, duration nullable, label,
       description, category[production|crew], owner_participant_id, timestamps)  -- crew run-of-show lives here (+ tech docs), NOT the setlist
event_messages(id, event_id, sender_user_id, sender_participant_id, body, attachments jsonb,
       visibility[all|operators|party], created_at)   -- real schema + visibility
setlists(id, event_id, participant_id → event_participants, items jsonb, updated_at)   -- PERFORMER authors; crew see only if shared (observer). Party-scoped.
performance_reports(id, event_id, pro_code[stim|gema|prs|none], event_type, confidence, estimate)  -- operator's PRO filing DERIVED from the setlist (renamed from pro_reports — dodges the `professional` collision)
```
- Access: all gated by event participation + permission set; `owner_participant_id` + `visibility` refine (e.g. crew permission set = `schedule.view` only).

### G. Holds
- No new tables — `events.status='on_hold'`, `events.hold_rank`, `events.hold_auto_promote`; siblings matched by `(event_date, venue, stage)` (index).
- Port `holdRankLogic.ts` (`computeRankShift`, `computeDeclinePromotion`, `competingHoldIds`) **verbatim**; only operators set rank; only the performer confirms.

### H. Activity & audit
```
activity_log(id, event_id nullable, type, actor_user_id, actor_profile_id, actor_display,
       target_kind, target_id, summary jsonb, created_at)   -- USER feed; TARGET-SCOPED: a row is visible iff
       -- authorize(view, target) passes (replaces visibility[all|operator_only]). Performer/crew see only their slice for free.
audit_log(id, at, actor_user_id, acting_profile_id, capability, action, target_kind, target_id,
       event_id, changes jsonb, request_id)   -- FORENSIC: EVERY mutation, written in the SAME txn as the change
       -- (not "if sensitive"), append-only, admin-only, GDPR. `changes` = before/after diff.
```

### I. Notifications
```
notifications(id, user_id → users, type, title, body, event_id nullable, actor_user_id,
       actor_display, link, metadata jsonb, read_at nullable, created_at)
```
- Still per-user rows (a genuine materialized feed), but recipients resolved by a **join** at write time (no `accessProfileIds` fan-out array). `read_at` is server-side.

### J. Calendar, tasks & availability
```
tasks(id, event_id nullable, owner_profile_id nullable, owner_user_id nullable, title, description,
      completed, completed_at, due_date, assignee_participant_id nullable,
      budget_type nullable, budget_amount nullable, created_by, timestamps)   -- unifies event + profile/user todos
task_reminders(id, task_id, date, time, label)
calendar_items(id, owner_profile_id nullable, owner_user_id nullable, type[task|appointment|note],
      title, date, start_time, end_time, entity, assignee_user_id, assignee_name, timestamps)
profile_unavailability(id, profile_id, day daterange, reason nullable)   -- daterange + reason
```
- "Action items" (finalize settlement, confirm date change, …) stay **derived** from event/settlement state — a computed query, not a table.

### K. Templates
```
templates(id, profile_id → profiles, category[budget|deal|rider|terms|schedule|crew|settlement_overview|settlement_deal],
          name, payload jsonb, created_at, updated_at)
```
- One table; `payload` validated per-category by a Zod schema in the API.

### L. Inbound booking requests
```
booking_requests(id, source[public_form|performer_offer|venue_handoff],
      status[pending|accepted|declined|flagged|archived|expired],
      target_profile_id → profiles, sender_user_id nullable, sender_profile_id nullable,
      contact_name, email, phone, artist_name, wanted_date, additional_dates jsonb,
      artist_fee, offer_fee_min, offer_fee_max, pitch, note, music_url, video_url,
      sender_type, performer_type, genres jsonb, website_url, social_links jsonb,
      sent_via[in_platform|mailto], event_id nullable, expires_at, created_at, timestamps)
```
- Dedup: partial unique index on `(sender_user_id, target_profile_id, wanted_date) WHERE status='pending'`.
- Reapers (30-day offers, 90-day handoffs) = scheduled Cloud Run jobs flipping `status` + notifying.

### M. Settlement sharing & comments  (surfaces Phase-3 settlement data)
```
shares(id, token uniq, event_id → events (nullable), target_kind, target_id nullable, capabilities text[],
      access[public|protected], owner_user_id, owner_profile_id, expires_at nullable, revoked_at nullable, created_at, updated_at)
      -- GENERALIZED beyond settlement: a tokenized capability grant against ANY target; capabilities = same catalog as permission_sets.
share_recipients(id, share_id → shares, email, name, linked_participant_id → event_participants nullable,
      claimed_by_user_id → users nullable, invited_at, last_seen_at, unique(share_id, email))   -- KEEP A TABLE (carries OTP/claim/party-link state)
share_otps(id, share_id, email_hash, code_hash, salt, expires_at, attempts, rate_window_start)   -- port constants: 6-digit salted-SHA256, 10min TTL, 3/hr, 5 attempts → HS256 JWT 24h (SHARE_JWT_SECRET)
settlement_comments(id, event_id, party_participant_id nullable, author_email, author_name,
      message, attachments jsonb, created_at)
settlement_approvals(id, event_id, party_participant_id, approved, approved_at)
settlement_snapshots(id, event_id, version, data jsonb, finalized_at)   -- immutable, only on finalize
invoices(id, event_id nullable, direction[issued|received], issuer_ref, recipient_ref,  -- participant or contact
      transfer_id → settlement_transfers nullable, budget_line_id → budget_lines nullable,
      number, currency, line_items jsonb, vat jsonb, total, issued_at, due_date,
      state[draft|sent|paid|overdue|void], document_snapshot jsonb)   -- document OVER a transfer/cost-line; tracked-not-held; auto-gen/payment/escrow DEFERRED (docs/payments.md)
```
- Protected shares: identity via signed-in recipient / OTP→JWT (stateless, `SHARE_JWT_SECRET`) / owner. Recipients never leaked in responses.

### N. Spam, reputation & admin alerts
```
spam_flags(id, target_profile_id → profiles, reporter_profile_id, reporter_user_id, kind,
      context_kind, context_id, event_id nullable, created_at, unique(target_profile_id, reporter_profile_id, kind))
admin_alerts(id, kind[spam_threshold|expansion_threshold], subject_key, details jsonb, resolved, created_at)
admins(user_id pk → users)
```
- Suspension = `COUNT(DISTINCT reporter_profile_id) WHERE created_at > now()-90d >= 3` (computed). Expansion = `COUNT` stub venues per EU country == 10.

### O. Audience RSVPs
```
audience_rsvps(id, event_id → events, name, email, city, created_at, unique(event_id, email))
```

### P. Currency & public surfaces
```
fx_rates_cache(base, quote, rate, fetched_at)     -- live rates over exchangerate-api (DISPLAY only)
```
**Two currencies, never conflated:**
- **Payout currency (authoritative):** `deals.currency` = what's actually paid out · `budget_lines.currency` · `events.base_currency` = the reconciliation currency. Cross-currency events convert to base at a **locked FX rate captured at finalize** (stored on the settlement, overridable) so settlement is reproducible & auditable; each transfer is *paid* in the payee deal's native currency.
- **Display currency (cosmetic):** the viewer's `users.currency` (or a per-view selector) + **live** `fx_rates_cache` → a view-only translation of every amount. **Never** changes stored or settled values.
- Public profile/event pages = whitelisted-column serializer over `profiles.is_public`+`slug` and `events.published`. No new tables.

## Phased build sequence

Dependency-ordered (events need the identity foundation first, so that's the thin Phase 1; events are the first *substantive* domain).

| Phase | Module | Tables |
|---|---|---|
| 0 | Scaffold | Fastify + Zod + Drizzle + Cloud SQL + firebase-admin auth middleware + `authorize()` skeleton |
| 1 | Identity foundation | users, profiles (+ media/locations/social + venue/performer details), profile_members, capabilities, permission_sets |
| 2 | Events core | events, event_participants, stages |
| 3 | Deals | deals, deal_parties |
| 4 | Money & settlement | budgets, revenue, settlements + orchestration (port `calculateSettlement`), settlement_comments/approvals/snapshots |
| 5 | Event content | riders, crew (event_participants role=crew + crew_details), agreements (+confirmations/reopen), schedule_items, event_messages, pro_reports, holds |
| 6 | Monetization | plans, plan_history, credit_ledger + entitlement checks |
| 7 | Invitations & contacts | invitations (unified), contacts, contact_persons |
| 8 | Inbound | booking_requests (3 flows) + reaper jobs |
| 9 | Settlement sharing | shares, share_recipients, share_otps, OTP→JWT |
| 10 | Comms & misc | notifications, activity_log, audit_log, calendar_items, tasks, templates, profile_unavailability, spam_flags, admin_alerts, audience_rsvps, fx cache, public serializers |

Each phase: **tables (Drizzle) → access predicate → Zod-validated API routes → port pure logic + tests.**

## Open decisions (resolve before the noted phase)

1. ~~Backend platform~~ **DECIDED:** Cloud SQL + Cloud Run + own **Fastify / Zod / Drizzle** API (not SQL Connect).
2. ~~Crew~~ **DECIDED:** crew = real **professional** accounts (`kind=professional`). On an event → `event_participants`
   with `role=crew` + a scoped permission set (e.g. schedule-only); off-platform crew = an unclaimed professional stub.
   Foundation for a future **professionals marketplace** (operators/performers post jobs; professionals apply). Crew pay later via `deal.type=crew`.
3. ~~One kind per account?~~ **DECIDED (A):** account locked to exactly one kind, fixed at signup; cross-kind = a second account.
4. ~~Settlement orchestration~~ **DEFINED (2026-07 meeting):** individual settlement per participant profile;
   collected-by/paid-by reconciliation → "who owes whom"; shared + private budgets; manual override + paid/handled flags; no escrow.
5. **Deal ↔ crew separation** — **deferred to the next product meeting** (whether crew agreements are a distinct entity from deals).
6. **Deal naming** — confirm deal identifiers default to the entity/person name (meeting leaned yes).

**Defaults chosen (flag if wrong):** per-type profile fields = core + `venue_details`/`performer_details` extension tables + `jsonb` for the rest ·
contacts scoped to profile (not user) · team directory folded into `profile_members` (nullable `user_id`) ·
settlement shares render live, immutable snapshot only on finalize · freemium limits computed (`COUNT`), not stored counters.

## Authorization engine

Replaces `firestore.rules` (~900 lines) + scattered callable checks + client-side hiding with **one server-side
module**. Two functions, **deny-by-default**, computed **per request via joins** (no `accessUids`/`editorUids`/`adminUids`
arrays, no `profileIds` custom claim):
- `authorize(principal, action, resource)` → allow/deny  — *can you do this?*
- `serialize(resource, capabilities)` → redacted payload — *what subset do you get back?*  ← closes today's client-only gap

**Principal (resolved once per request):**
```
verify Firebase ID token → uid   (JIT-create users row on first sight)
memberships = SELECT pm.profile_id, p.kind, pm.role
              FROM profile_members pm JOIN profiles p ON p.id = pm.profile_id
              WHERE pm.user_id = uid AND pm.status = 'active'   -- FLAT set, owned + member-of; never a per-kind Record → no slot-collision
principal = { uid, memberships[], is_admin (users.is_admin), acting_profile_id (from header, validated ∈ memberships) }
```
**No profile cap.** The old 16-profile limit was a **JWT-claim-size artifact** of the `profileIds` custom claim, not a
product rule. Membership is now a DB query, so a user can be a member/participant of **unlimited** profiles and events.
The Firebase token carries only `uid`; everything reachable comes from the DB per request. Any real cap would be a
deliberate plan/entitlement rule, never a mechanism constraint.

**Standing on an event (ReBAC resolution — one indexed query):**
```
SELECT ep.role, ps.capabilities
FROM event_participants ep
JOIN profile_members pm ON pm.profile_id = ep.profile_id AND pm.user_id = :uid AND pm.status='active'
LEFT JOIN permission_sets ps ON ps.id = ep.permission_set_id
WHERE ep.event_id = :event AND ep.status <> 'removed'
```
A user can reach an event via several participants (host-member *and* performer). **Effective capabilities = union**, each row's
caps first filtered by the profile role.

**Three-tier composition** — `effective = baseline(event_role) ∪ role_filter(permission_set.capabilities, profile_role) ∩ grantable(relationship)`:
- **Floor** — `baseline(event_role)` = inalienable per-role caps the operator can NEVER revoke (code-defined). Performer floor: `event.view, deal.view.own, settlement.view.own, schedule.view, deal/settlement/agreement.confirm, rider.submit`. Crew floor: `event.view, schedule.view, deal.view.own, settlement.view.own`.
- **Band** — **permission set** (on the participant) = *what this event-role may touch* (modular, data-driven, operator-configurable), filtered by **profile role** (owner/admin/editor): `editor` strips financial-edit + management caps; `owner`/`admin` keep the full set.
- **Ceiling** — `grantable(relationship)` = hard limits: arm's-length parties can NEVER be granted `budget.view` / pool visibility (transparency model); `permission.grant_admin` requires a paid plan (entitlement layer).

**Capability catalog** (code enum; stored in `permission_sets.capabilities text[]`):
```
event.view · event.edit · event.delete · event.publish · event.send_info_email · participants.manage
deal.view.own · deal.view.all · deal.edit · budget.view · budget.edit · revenue.edit
settlement.view.own · settlement.view.all · settlement.edit · settlement.confirm · settlement.finalize
rider.submit · schedule.view · schedule.edit · crew.manage · agreement.manage · agreement.confirm · message.post
profile.edit · members.manage · templates.manage · permission.grant_admin
```

**Preset permission sets** (system rows; operators may clone + customise — map onto the transparency tiers):
- `operator_full` — everything incl. `*.view.all`, `budget.view`, `settlement.finalize`, management (host **and** co-promoters).
- `performer` — `event.view, deal.view.own, settlement.view.own, settlement.confirm, rider.submit, schedule.view, message.post`
- `crew_schedule_only` — `schedule.view` (+ `message.post`)
- `view_only` — the `*.view.own` reads, no writes

**Party-scoped resources (deals, settlements) — PURE party-scoping, NO `*.view.all` override:**
- **If you are not a `deal_party`, you cannot see the deal or its settlement.** Full stop.
- The operator's broad visibility is EMERGENT — they are a party (payer/hub) on the event's main deals — not a see-everything cap. `deal.view.all` / `settlement.view.all` dropped as overrides.
- Co-operator transparency = co-operators are **co-parties** on shared deals + share the budget. Sharing a deal with a co-host = adding an `observer` `deal_party` (read-only, no entitlement).
- A performer's private **sub-hire** (performer↔crew) is invisible to the operator (not a party); the operator still sees the crew *person* as an `event_participant`, just not the *pay*.

**Field-level serializer (the concrete fix):** a read is authorised at the event level, then the payload is *shaped* by
`effective_capabilities` — the budget object is omitted unless `budget.view`; a performer's deal payload contains only their own
`deal_party`; settlement shows only their slice. Enforced **server-side in the response**, not by hiding UI. Fixes
"performer could read the full budget/deal document today."

**Entitlement layer (separate — billing ≠ permission):** `canUseFeature(profile, feature)` **fresh-reads `plans`**
(never cached) and computes limits by **`COUNT()`**, not stored counters:
- confirm/conclude event when `COUNT(confirmed|concluded in 365d) ≥ cap` → blocked (free_operator).
- send offer when `COUNT(offers this month) ≥ 50` → blocked (free_artist).
- assign `operator_full`/admin permission set to a collaborator → requires host plan ∈ paid (`permission.grant_admin`).
- send collab invite when suspended (`COUNT(DISTINCT spam reporter in 90d) ≥ 3`).
Composed at the route **after** `authorize`.

**Public / token paths (no principal):**
- published+confirmed events and `is_public` profiles → dedicated public read serving only whitelisted columns.
- settlement share → OTP→JWT (or signed-in email) resolves to a party by **email match** against participants/recipients
  → party-scoped read of *their* settlement slice only. Recipients never leaked in responses.

**Designed-out bug classes:** flat SQL membership (owned + member-of together) → no slot-collision, no owner-only-query
miss; access by join each request → no denormalized-array drift; one policy module → no rules/callable/client divergence.

**Performance:** both auth lookups are indexed scans over single-digit row counts (sub-ms) — not the bottleneck.
Best practice: **resolve the principal once per request** and reuse it; **fold the access predicate into the data query**
so list endpoints authorize for free (the `WHERE` clause *is* the rule — one query, no N+1). Required indexes:
`profile_members(user_id)`, `profile_members(profile_id)`, `event_participants(event_id)`, `event_participants(profile_id)`,
`deal_parties(deal_id)`, `deal_parties(participant_id)`. Writes are also cheaper than Firestore — adding access = one
`INSERT` into `event_participants`, vs the old trigger rewriting `accessUids` on N events + claims sync + token refresh.
The real perf lever on Cloud Run + Cloud SQL is **connection pooling** (small per-instance pool, capped max-instances /
PgBouncer), orthogonal to auth. Optional per-user membership cache only if ever profiled as hot (almost certainly unneeded).

## API route map (Fastify plugins)

**Pipeline (every non-public route):** verify Firebase token → resolve principal *once* → `authorize(capability, resource)` →
Zod validate → handle → `serialize(capabilities)` → **audit EVERY mutation in the same DB txn** (enriched `audit_log`). Acting profile via `X-Profile-Id` header (validated ∈
memberships). **List routes fold the access predicate into the SQL** (the `WHERE` *is* the rule) + cursor pagination.
Base `/api/v1`. Public/token routes skip the principal. **Naming: full words, no abbreviations** (`capability` not `cap`, `entitlement` not `ent`). `(capability)` = required capability; `[entitlement]` = plan/billing gate.

**session / me**
- `POST /auth/session` — verify token, JIT-provision `users`, return me + memberships (login) · `GET /me` · `PATCH /me` (settings: name, currency, formats)

**profiles**
- `GET /profiles` (mine) · `POST /profiles` (kind-match; `[seats]`)
- `GET/PATCH /profiles/:id` (profile.edit) · `DELETE` (owner)
- `GET/POST /profiles/:id/members` · `PATCH/DELETE /profiles/:id/members/:uid` (members.manage; owner row protected)
- `GET/PUT /profiles/:id/unavailability` · `GET/POST/PATCH/DELETE /profiles/:id/templates`

**events**
- `GET /events` — access-scoped list (filters, pagination) · `POST /events` (operator kind; `[event-cap]` on confirm)
- `GET /events/:id` (event.view, serialized) · `PATCH` (event.edit) · `DELETE` (host admin)
- `POST /events/:id/publish` (event.publish) · `POST /events/:id/notify` — info email (event.send_info_email)
- participants: `GET/POST /events/:id/participants` · `PATCH/DELETE /…/:pid` (participants.manage; `[grant_admin]`→paid)
- stages: `GET/POST/PATCH/DELETE /events/:id/stages` · holds: `POST /events/:id/hold/{rank|confirm|decline}` (rank=operator, confirm=performer)

**deals** — `GET /events/:id/deals` (serialized: operator all / party own) · `POST` (deal.edit) · `GET/PATCH/DELETE /…/deals/:did`

**budget** — `GET/POST /events/:id/budgets` (budget.view; shared/private scoped) · `GET/POST/PATCH/DELETE /…/budgets/:bid/lines` (budget.edit)

**settlement**
- `POST /events/:id/settlement/compute` — reconciliation (settlement.edit) · `GET /events/:id/settlements` (own/all) · `GET/PATCH /…/:pid` (override)
- `POST /…/settlements/:pid/confirm` (settlement.confirm) · `POST /events/:id/settlement/finalize` (settlement.finalize → snapshot + locked FX) · `PATCH /…/transfers/:tid` (paid/handled)

**event content**
- riders `GET/POST/PATCH/DELETE /events/:id/riders` (rider.submit/owner) · crew `…/crew` (crew.manage → participant role=crew + crew_details)
- agreements `…/agreements` (agreement.manage) · `POST /…/:aid/confirm` (agreement.confirm) · `POST /…/:aid/reopen`
- schedule `GET/POST/PATCH/DELETE /events/:id/schedule` (schedule.edit) · messages `GET /events/:id/messages` (history) · `POST` (message.post → NOTIFY)

**realtime** — `GET /stream` — per-user multiplexed **SSE** (messages + notifications + event changes), `LISTEN/NOTIFY`-driven

**notifications** — `GET /notifications` (own) · `POST /notifications/read` (read_at)

**invitations** — `POST /invitations` (member/participant/code) · `GET /invitations/:token` (public peek) · `POST /invitations/:token/{accept|decline}` (email match) · `POST /invitations/:code/claim`

**contacts** (acting-profile scoped) — `GET/POST/PATCH/DELETE /contacts`

**inbound (requests & offers)**
- `POST /booking-requests` (public form, unauth, dedup) · `GET /booking-requests` (venue inbox: target member) · `PATCH /…/:id` (accept/decline/flag)
- `POST /offers` (performer; `[monthly cap]`) · `POST /offers/:id/flag-spam` → spam_flags · `POST /events/:id/handoff` (+resend/cancel/redirect)

**shares / settlement review** (token identity) — `POST /events/:id/shares` (owner) · `GET /shares/:token` (public/owner/OTP-JWT) · `POST /shares/:token/otp` · `POST /…/verify` (→JWT) · `POST /shares/:token/{comment|approve}` (verified party)

**plans / billing** — `GET /plans/:profileId` (member) · `POST /plans/:profileId/request` (owner) · `GET /profiles/:id/cap-status` (fresh count)

**calendar & tasks** (event/profile/user scoped) — `GET/POST/PATCH/DELETE /calendar` · `GET/POST/PATCH/DELETE /tasks`

**public** (no principal; whitelisted serializer) — `GET /public/profiles/:slug` · `GET /public/events/:id` · `GET /public/profiles/:slug/availability` · `POST /public/events/:id/rsvp`

**fx** — `GET /fx?from&to` · `GET /fx/currencies` (display conversion)

**admin** (`is_admin`) — `POST /admin/plans/:profileId` · `GET /admin/profiles` (search) · `GET /admin/alerts` · `GET /admin/audit`

**Background (not HTTP — Cloud Scheduler → job endpoints/Cloud Run Jobs):** offer & handoff reapers, spam-window recompute, reminder dispatch.

## File storage (Firebase Storage / GCS — bucket unchanged; access moves to the API)

Same Firebase Storage bucket (it's a GCS bucket in the project). **Bytes** in Storage, **metadata** in Postgres,
**access decisions** in the API — because ReBAC lives in Postgres, which Storage rules can't query.

**Paths (organized by resource; `fileId` = UUID object name):**
```
public/profiles/{profileId}/{avatar|banner|media}/{fileId}.{ext}      -- public profile media (CDN, public-read)
profiles/{profileId}/documents/{fileId}.{ext}                         -- private profile docs / rider templates
events/{eventId}/riders/{riderId}/{fileId}.{ext}
events/{eventId}/agreements/{agreementId}/{fileId}.{ext}              -- sensitive (signed contracts)
events/{eventId}/messages/{messageId}/{fileId}.{ext}                  -- chat attachments
events/{eventId}/settlement/comments/{commentId}/{fileId}.{ext}      -- settlement review attachments
```

**Metadata (Postgres) — canonical registry; owning rows reference it (replaces scattered `file_url`/attachment fields):**
```
files(id, path, original_name, content_type, size_bytes, visibility[public|private],
      owner_kind, owner_id, uploaded_by → users, uploaded_at)
```

**Access — via API signed URLs, not Storage rules:**
- **Private:** bucket denies all direct client access; the only path is a **short-lived signed URL the API issues after `authorize(read parent)`** (API service account signs). Keeps file access in the same policy module — a performer can't fetch an agreement PDF they can't see.
- **Public media:** public-read prefix / CDN, stable URLs, no signing.

**Upload (direct-to-GCS, bypassing Cloud Run):** client requests upload → API `authorize(write parent)` + validate (type allowlist, size cap; settlement attachments ≤5×10 MB) → returns a **signed upload URL** → client uploads directly to GCS → confirms → API records the `files` row + link.

**Lifecycle:** delete parent → delete `files` rows + GCS objects · Cloud Scheduler sweeps orphaned/never-confirmed uploads · finalized agreements + settlement snapshots retained immutable (legal).

## Not yet designed (TBD before/during build)

The **data model is complete**; these layers on top of it are named but not yet designed:

**Logic (design before building the relevant phase):**
- ~~Authorization engine~~ **DESIGNED** — see the *Authorization engine* section above.
- ~~Settlement algorithm~~ **DESIGNED** — see *Settlement & budget → Reconciliation algorithm* above.
- ~~API route map~~ **DESIGNED** — see the *API route map* section above.

**Integration / infra:**
- Firebase Auth → `users` JIT provisioning on first verified token.
- **Realtime delivery (DECIDED: SSE + POST):** chat, notifications, and event-change updates stream to each client over
  one multiplexed **SSE** connection (client *sends* via `POST`, *receives* via the stream — no WebSocket needed),
  triggered by Postgres **`LISTEN/NOTIFY`**. Chat makes real-time non-optional (polling looks broken for messages).
  Hosting (DECIDED: **self-hosted**): a **dedicated always-on Cloud Run service** (`apps/stream`, min-instances=1)
  holding the connections (shared `LISTEN` conn, in-process fan-out) so the main API stays stateless/scale-to-zero.
  Chosen over a managed service (Ably/Pusher) to keep messages on our infra and lean on GCP credits.
  Cost = one warm instance (~$40–70/mo, $0 on credits).
- ~~File/media storage~~ **DESIGNED** — see the *File storage* section above (Firebase Storage kept; access via API signed URLs).
- Email flows via Brevo triggered from the API (invites, OTP, offers, notifications).
- Background jobs — reapers (30-day offers, 90-day handoffs), reminders, spam-window recompute → Cloud Scheduler + jobs endpoint / Cloud Run Jobs.
- **Deploy/CI/migrations/secrets/envs (DECIDED):** **GitHub Actions** pipeline (Biome lint → `tsc` typecheck →
  Vitest → build → deploy to Cloud Run) with **Turborepo** remote cache; **drizzle-kit** migrations run in CI against
  Cloud SQL; **Secret Manager** for DB creds, `SHARE_JWT_SECRET`, Brevo key; env Zod-parsed at boot. Distroless Node 22
  images, one Dockerfile per app.
- ~~Public pages + SSR~~ **DESIGNED** — Firebase Hosting fronts the SPA; public routes (`/p/**`, `/event/**`,
  `/request-date/**`) rewrite → a **separate Cloud Run service** (`apps/ssr`) that **full-SSR**s them with
  `react-dom/server` (`renderToPipeableStream`) over shared `packages/ui` components, reading the `/public/*`
  whitelisted endpoints (no auth, CDN-cacheable). Plain **Vite SSR**, not a meta-framework — TanStack Start is the
  upgrade path if the public surface grows. (see *Hosting & SSR*).
- **Testing strategy (DECIDED):** **Vitest** for unit + the ported settlement/hold suites; **Testcontainers**
  (ephemeral Postgres) for integration + per-phase access-predicate tests; **Playwright** for the Phase 1–2 e2e slice.

**Deferred features (foundation only):**
- Marketplace search & matching (professionals ↔ jobs) + Postgres FTS · ticketing-provider sync · event-outcomes/AI data. *(Multi-currency moved into v1 — see Currency & public surfaces.)*

**Open product threads:**
- "Shared Team" vs "In-house Management" public/private roster split (currently both fold into `profile_members`).
- Deal naming · deal ↔ crew separation (next product meeting).

**Out of scope of this plan:** the entire **frontend** rebuild (React client + the in-progress redesign, typed API client, state).

## Verification

- Port the pure settlement/hold logic + their existing vitest suites first; they must stay green (executable spec).
- Per phase: write access-predicate tests (e.g. "venue cannot read promoter↔performer deal", "performer sees only own split").
- End-to-end slice for Phase 1–2: create event → add participants → attach deals → assert party-scoped visibility via the API.
