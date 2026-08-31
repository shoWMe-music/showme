# Database build plan — module by module

Living checklist for building `packages/db` (the Drizzle schema) to completion. Scope = **the Postgres schema
only**: tables, enums, constraints, indexes, and a Testcontainers round-trip test per module. The pure-logic engines
(`packages/settlement`, hold ranking, `authorize`/`serialize`) and the Fastify API (`apps/api`) are a **separate
follow-on epic** noted at the end — the schema is the foundation they all need.

**Per-module ritual (every module):**
1. Enums → schema file → export from `src/schema/index.ts`
2. `pnpm generate` (incremental migration) → confirm table/column/fk counts
3. Round-trip test in `src/schema.test.ts` (new `describe` block, shared container) — prove the access join,
   constraints, and cascades actually hold
4. `pnpm test` green → `pnpm typecheck` → `pnpm biome check --write`
5. Tick the box here, report, continue

**Cross-cutting conventions (locked):**
- **Money** = `numeric(14, 2)`; **percentages** = `numeric(5, 2)`; **rates already in basis points** stay `integer`.
- **Canonical enums** taken from the reference app `../showme-settle-fast/src/lib/models.ts` where they exist.
- **Consolidations honored:** no `crew_details` table (→ `event_participants.details`), no `agreements*` tables
  (→ `deals`), no `admins` table (→ `users.is_admin`), no `plan_history`/`contact_persons` tables (→ `audit_log` /
  `contacts.persons`).
- **Required indexes** added as each table lands: `profile_members(user_id|profile_id)`,
  `event_participants(event_id|profile_id)`, `deal_parties(deal_id|participant_id)`.

---

## Module 0 — corrections to shipped M1/M2  ☑
Fold into a regenerated clean baseline (nothing deployed yet, so squash M1+M2 migrations into one correct `0000`):
- Fix `event_status` enum → `draft | suggested | pending | confirmed | on_hold | concluded | cancelled` (canonical).
- Add the missing indexes on `profile_members` and `event_participants`.

## Module 1 — Identity & authorization  ☑ (done; amended by M0)
`users`, `profiles`, `profile_media`, `profile_locations`, `profile_social_links`, `payout_accounts`,
`profile_members`, `profile_custom_roles`, `groups`, `group_members`, `group_profiles`, `representations`,
`permission_sets`. 13 tables, 5 enums, 3 tests.

## Module 2 — Events core  ☑ (done; amended by M0)
`events` (+ hold columns), `event_participants` (+ folded `details`), `stages`. 3 tables, 4 enums, 3 tests.

---

## Module 3 — Deals  ☑ (2 tables, 6 enums, 2 tests)
**Tables:** `deals`, `deal_parties`.
- `deals`: `event_id→events`, `type`(enum `performance|rental|fee|split` — `custom` removed, decisions #16.2),
  `structure`(enum `guarantee|door_split|guarantee_vs_door|rental`, nullable = paper-only),
  `currency`(payout, nullable→event base), `name`, `payer_participant_id→event_participants` nullable,
  `payment_timing`(enum `before_event|at_settlement|due_date`), `priority` int,
  structured cols `guarantee_amount numeric`, `split_percent numeric` + `terms jsonb` (escalators/bonus/commissions),
  `agreement_body_text`, `agreement_status`(enum `draft|sent|confirmed|signed`), `confirmed_snapshot jsonb`,
  `reopen jsonb`, `status`(enum `draft|confirmed|cancelled` — **ratified 2026-08-31**: the last signature
  writes `confirmed` and `reopen` writes it back (`apps/api/src/lib/deal-confirmation.ts`), `PATCH /deals/:did`
  writes `cancelled` and refuses a hand-set `confirmed`, and migration 0030 backfilled it from
  `agreement_status`), `created_by`, timestamps.
- `deal_parties`: `deal_id→deals` (cascade), `participant_id→event_participants`,
  `role_in_deal`(enum `payer|payee|split_member|commission|observer`), `share jsonb`, `confirmed_at`,
  `confirmed_by→users`, `signature_hash`. Indexes on `deal_id`, `participant_id`.
- **Enums:** `deal_type`, `deal_structure`, `payment_timing`, `agreement_status`, `deal_party_role`, `deal_status`.
- **Verify:** split deal with 2 `split_member` parties + 1 `observer`; "deals for participant X" query;
  cascade on deal delete; `unique`? (no natural unique — parties can repeat roles). ~~Flag `deal_status`
  assumption~~ — settled, above.

## Module 4 — Budget & settlement  ☑ (7 tables, 4 enums, 2 tests; XOR CHECK verified)
**Tables:** `budgets`, `budget_lines`, `settlements`, `settlement_transfers`, `settlement_comments`,
`settlement_approvals`, `settlement_snapshots`.
- `budgets`: `event_id`, `scope`(enum `shared|private`), `owner_profile_id` nullable.
- `budget_lines`: `budget_id`(cascade), `kind`(enum `revenue|cost`), `label`, `amount numeric`, `currency`,
  `collected_by/paid_by/payee_participant_id→event_participants` nullable, `cost_split jsonb`, `deal_id→deals` nullable.
- `settlements`: `event_id`, `participant_id→event_participants` nullable, `representation_id→representations` nullable,
  `status`(enum `open|pending_review|comments_received|revised|finalized|partly_paid|paid|dispute`),
  `computed jsonb`, `manual_overrides jsonb`, `locked_fx_rate numeric` nullable, timestamps.
  **CHECK:** exactly one of `participant_id`/`representation_id` is set.
- `settlement_transfers`: `event_id`, `from_participant`/`to_participant→event_participants`, `amount numeric`,
  `currency`, `state`(enum `owed|paid|handled`).
- `settlement_comments`, `settlement_approvals`, `settlement_snapshots`(version, data jsonb, finalized_at).
- **Enums:** `budget_scope`, `budget_line_kind`, `settlement_status`, `transfer_state`.
- **Verify:** worked mini-example (pool = Σrevenue − Σcost); the `exactly-one` CHECK bites when both/neither set;
  transfers `state` transitions; snapshot immutability (insert-only usage).

## Module 5 — Event content (+ files)  ☑ (6 tables, 5 enums, 2 tests)
**Tables:** `files` (pulled forward — riders/messages reference it), `riders`, `schedule_items`, `event_messages`,
`setlists`, `performance_reports`.  (No `crew_details`/`agreements` tables — folded.)
- `files`: `id`, `path`, `kind`(enum `photo|video|document|audio|other`), `content_type`, `size_bytes`,
  `owner_user_id`, `owner_profile_id` nullable, `created_at`. (Bytes in Firebase Storage; this is metadata only.)
- `riders`: library (`owner_profile_id`, `event_id` NULL) vs instance (`event_id`, `owner_participant_id`);
  `type`(enum `tech|hospitality|stage_plot|input_list`), `name`, `description`, `file_id→files` nullable,
  `source_rider_id→riders` self-ref nullable, `is_default bool`, `created_by`, timestamps.
- `schedule_items`: `event_id`, `stage_id` nullable, `start_time`, `duration` nullable, `label`, `description`,
  `category`(enum `production|crew`), `owner_participant_id` nullable, timestamps.
- `event_messages`: `event_id`, `sender_user_id`, `sender_participant_id` nullable, `body`, `attachments jsonb`,
  `visibility`(enum `all|operators|party`), `created_at`.
- `setlists`: `event_id`, `participant_id→event_participants`, `items jsonb`, `updated_at`.
- `performance_reports`: `event_id`, `pro_code`(enum `stim|gema|prs|none`), `event_type`, `confidence`, `estimate`.
- **Enums:** `file_kind`, `rider_type`, `schedule_category`, `message_visibility`, `pro_code`.
- **Verify:** rider library→instance copy (`source_rider_id`); message `visibility`; setlist per participant.

## Module 6 — Monetization  ☑ (2 tables, 2 enums, 1 test)
**Tables:** `plans`, `credit_ledger`.  (No `plan_history` — → audit_log.)
- `plans`: `profile_id` pk→profiles, `tier`(enum `free_operator|operator_pro|free_artist|artist_pro`), `status`,
  `source`(enum `manual|stripe`), `assigned_at`, `assigned_by`, `renewal_at`, `seats int`, `cancel_reason`.
- `credit_ledger`: `profile_id`, `delta int`, `reason`, `at`.
- **Enums:** `plan_tier`, `plan_status`, `plan_source`.
- **Verify:** credits balance = `SUM(delta)`; one plan row per profile (pk).

## Module 7 — Invitations & contacts  ☑ (2 tables, 3 enums, 1 test)
**Tables:** `invitations`, `contacts`.  (No `contact_persons` — → `contacts.persons jsonb`.)
- `invitations`: `type`(enum `profile_member|event_participant|code`), `code` uniq nullable, `token` uniq nullable,
  `status`(enum `pending|accepted|declined|revoked|expired|used`), `created_by_user`, `created_by_profile` nullable,
  `recipient_email`, `recipient_name`, `target_profile_id` nullable, `target_event_id` nullable,
  `linked_contact_id→contacts` nullable, `role` nullable, `permission_set_id` nullable, `password_hash` nullable,
  `source`(enum `collaborator|admin|team|venue_handoff|performer_offer`), `expires_at`, `used_by_user` nullable,
  `used_at`, `created_at`.
- `contacts`: `owner_profile_id→profiles`, `name`, `type`, `iban`, `bank_name`, `vat_id`, `address`, `notes`,
  `persons jsonb`, `invitation_id→invitations` nullable, timestamps.
- **Enums:** `invitation_type`, `invitation_status`, `invitation_source`.
- **Verify:** invite lifecycle (pending→used); unique `code`/`token`; contact with `persons` jsonb round-trip.

## Module 8 — Inbound booking requests  ☑ (1 table, 3 enums, 1 test; partial dedup verified)
**Table:** `booking_requests` (3 sources).
- Columns per PLAN §L; `source`(enum `public_form|performer_offer|venue_handoff`),
  `status`(enum `pending|accepted|declined|flagged|archived|expired`), `sent_via`(enum `in_platform|mailto`),
  amounts numeric, `genres`/`additional_dates`/`social_links` jsonb, `event_id` nullable, `expires_at`.
- **Partial unique index:** `(sender_user_id, target_profile_id, wanted_date) WHERE status='pending'`.
- **Enums:** `booking_request_source`, `booking_request_status`, `booking_sent_via`.
- **Verify:** dedup index bites on a second `pending`; a non-pending duplicate is allowed.

## Module 9 — Settlement sharing  ☑ (4 tables, 3 enums, 1 test)
**Tables:** `shares`, `share_recipients`, `share_otps`, `invoices`.
- `shares`: `token` uniq, `event_id` nullable, `target_kind`, `target_id` nullable, `capabilities text[]`,
  `access`(enum `public|protected`), `owner_user_id`, `owner_profile_id`, `expires_at`, `revoked_at`, timestamps.
- `share_recipients`: `share_id`(cascade), `email`, `name`, `linked_participant_id` nullable, `claimed_by_user_id`
  nullable, `invited_at`, `last_seen_at`, `unique(share_id, email)`.
- `share_otps`: `share_id`, `email_hash`, `code_hash`, `salt`, `expires_at`, `attempts int`, `rate_window_start`.
- `invoices`: `event_id` nullable, `direction`(enum `issued|received`), `issuer_ref`, `recipient_ref`,
  `transfer_id→settlement_transfers` nullable, `budget_line_id→budget_lines` nullable, `number`, `currency`,
  `line_items jsonb`, `vat jsonb`, `total numeric`, `issued_at`, `due_date`, `state`(enum
  `draft|sent|paid|overdue|void`), `document_snapshot jsonb`.
- **Enums:** `share_access`, `invoice_direction`, `invoice_state`.
- **Verify:** `unique(share_id, email)`; OTP row; invoice linked to a transfer.

## Module 10 — Comms & misc  ☑ (12 tables, 3 enums, 3 tests)
**Tables:** `notifications`, `activity_log`, `audit_log`, `tasks`, `task_reminders`, `calendar_items`,
`profile_unavailability`, `templates`, `spam_flags`, `admin_alerts`, `audience_rsvps`, `fx_rates_cache`.
- `notifications`: `user_id→users`, `type`, `title`, `body`, `event_id` nullable, `actor_user_id`, `actor_display`,
  `link`, `metadata jsonb`, `read_at` nullable, `created_at`.
- `activity_log` (target-scoped feed) / `audit_log` (forensic, `changes jsonb`, `request_id`).
- `tasks` (+ `task_reminders`), `calendar_items`(type enum `task|appointment|note`),
  `profile_unavailability` (`start_date`/`end_date` — daterange modeled as two columns unless overlap-exclusion needed).
- `templates`(`category` enum), `spam_flags`(`unique(target_profile_id, reporter_profile_id, kind)`),
  `admin_alerts`(`kind` enum `spam_threshold|expansion_threshold`), `audience_rsvps`(`unique(event_id, email)`),
  `fx_rates_cache`(`base`, `quote`, `rate`, `fetched_at`).
- **Enums:** `notification`? (type free-text), `calendar_item_type`, `template_category`, `admin_alert_kind`.
- **Verify:** `read_at` toggle; `audience_rsvps` unique; `spam_flags` unique + computed distinct-reporter count.

---

## Follow-on epic (after the schema is complete)
- **`packages/auth`** ☑ — `resolvePrincipal`, `effectiveEventCapabilities`, `authorizeEvent`, `roleFilter`, presets.
  7 tests vs real Postgres. Still to add: field-level `serialize()` (needs API DTOs), entitlements
  (`canUseFeature`), representation fan-out resolution.
- **`packages/settlement`** ☑ — per-deal entitlement math (ported) + the pool→entitlement→held→net→transfers
  orchestration + agent commission settlement + **hold ranking** (`computeRankShift` / `computeDeclinePromotion` /
  `competingHoldIds`, ported verbatim with the 15-test spec). 27 tests incl. the worked example, deductibles, a
  300-run `Σ net = 0` property test, and the full hold-rank spec.
- **`apps/api`** ◑ — Fastify + Zod scaffold with the full pipeline (authenticate → authorize → Zod → handle →
  serialize → audit), Firebase auth as an injectable `TokenVerifier` (real firebase-admin verifier + fake for tests),
  Zod→OpenAPI via `fastify-type-provider-zod` + `@fastify/swagger`. Routes so far: `/health`, `POST /auth/session`
  (JIT-provision), `GET/PATCH /me`, `GET/PATCH /events/:id` (authorize + serialize w/ hold-rank redaction + audit).
  7 pipeline tests vs real Postgres + fake verifier. **To do:** the rest of the PLAN route map; drizzle-zod schemas;
  `serialize` for deals/settlements; entitlement gates; add Firebase creds to `.env`.
- `apps/stream`, `packages/api-client`, `apps/web`, `apps/ssr`, CI/CD, Cloud SQL provisioning. ☐
