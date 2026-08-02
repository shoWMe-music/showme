# API routes build plan — `apps/api`

The remaining backend, as route modules in `apps/api/src/routes/*` + serializers in `apps/api/src/serialize/*`
(features are route modules, not packages). Every route runs the pipeline: **verify token → resolve principal →
`authorize(capability)` → Zod validate → handle → `serialize(capabilities)` → audit-in-txn**. Notation:
`(capability)` = required capability · `[entitlement]` = plan/billing gate · `+version` = optimistic lock ·
`+idem` = idempotency key · `list` = filter/sort + cursor pagination.

Status legend: ☑ done · ◑ partial · ☐ not started.

---

## Cross-cutting infrastructure (build first — every route depends on these)

- **CC-1 `withAudit(tx, entry)`** helper — one place that writes the `audit_log` row inside the same txn as the
  mutation (decisions #2). Replaces the hand-written audit blocks in the events route. ☐
- **CC-2 Typed error envelope** `{ error: { code, message, details? } }` (decisions #15) — an `ErrorResponse` Zod
  schema, registered on routes; error handler emits it (currently `{error, message}` — reshape + add `details`). ◑
- **CC-3 Unified `authorize()` + route guard** — a `requireCapability(capability, resolveEventId)` preHandler that
  computes `effectiveEventCapabilities` once, checks, and stashes them on the request for the serializer (routes
  currently inline this). ☐
- **CC-4 List/pagination** — a shared `?cursor=&limit=&sort=` Zod query schema + keyset-cursor helper; the access
  predicate folds into the `WHERE`. Used by every `list` route. ☐
- **CC-5 Entitlements** — `canUseFeature(db, profileId, feature)` (fresh-read `plans` + `COUNT`): 365-day event cap,
  monthly offer cap, `grant_admin`→paid, spam-suspension (`COUNT(DISTINCT reporter,90d)≥3`). Composed AFTER authorize.
  (decisions #4 ceiling + PLAN §C). ☐
- **CC-6 Seed preset permission sets** — write `PRESET_PERMISSION_SETS` as system presets (`profile_id NULL`) so
  participants can reference them; validate `capabilities ⊆ CAPABILITIES`. ☐
- **CC-7 Serializer modules** — `serialize/{deal,budget,settlement,participant,activity,public}.ts` (party-scoping +
  field redaction). `serialize/event.ts` ☑.

---

## Phase A — core value surface ✅ DONE (36 tests: deals, budget, settlement, participants, events-list)

**events** (`routes/events.ts` — POST/GET/PATCH ☑)
- ☐ `GET /events` — access-scoped `list` (join `event_participants ⋈ profile_members` in WHERE) + filters + cursor.
- ☐ `DELETE /events/:id` (host admin) `+version`.
- ☐ `POST /events/:id/publish` (`event.publish`) — and **remove `published` from `PATCH` body** (route it here).
- ☐ `POST /events/:id/notify` (`event.send_info_email`) — sectional info email via Brevo `+idem`.

**participants** (`routes/participants.ts`)
- ☐ `GET /events/:id/participants` (serialized: 3 tiers) · `POST` (`participants.manage`; `[grant_admin]` if assigning
  admin) `+idem` · `PATCH/DELETE /…/:pid` (`participants.manage`; owner/host row protected) `+version`.

**stages** (`routes/stages.ts`) — NB stages are **venue-owned** (post-decision), so scoped to the profile, not event.
- ☐ `GET/POST/PATCH/DELETE /profiles/:id/stages` (venue profile; `profile.edit`).

**deals** (`routes/deals.ts`, `serialize/deal.ts`)
- ☐ `GET /events/:id/deals` — party-scoped serialize (operator sees all as a party; performer only own `deal_party`
  line; co-performers don't see each other's split). · `POST` (`deal.edit`) `+idem` · `GET/PATCH/DELETE /…/deals/:did`
  (`deal.edit`) `+version`. Includes `deal_parties` + `observer` sharing + per-party `confirm`/`reopen` (agreement is
  folded into the deal, decisions #1).

**budget** (`routes/budget.ts`, `serialize/budget.ts`)
- ☐ `GET/POST /events/:id/budgets` (`budget.view`; shared/private scoped — omit entirely without `budget.view`,
  ceiling-enforced) · `GET/POST/PATCH/DELETE /…/budgets/:bid/lines` (`budget.edit`) `+version`. Money as STRING
  minor-units (money.md).

**settlement** (`routes/settlement.ts`, `serialize/settlement.ts`)
- ☐ `POST /events/:id/settlement/compute` (`settlement.edit`) `+idem` — map DB rows → `SettlementInput`, convert
  non-base lines via locked FX, run `reconcile`, persist `settlements.computed` + `settlement_transfers`; assert `Σ=0`.
- ☐ `GET /events/:id/settlements` (own slice vs all) · `GET/PATCH /…/:pid` (`settlement.edit` manual override) `+version`.
- ☐ `POST /…/settlements/:pid/confirm` (`settlement.confirm` → `settlement_approvals`).
- ☐ `POST /events/:id/settlement/finalize` (`settlement.finalize`) `+idem` `+version` — snapshot + lock FX.
- ☐ `PATCH /…/transfers/:tid` (paid/handled; `settlement.edit`) `+version`.

---

## Phase B — profiles, content, tasks, notifications, invitations ✅ DONE (82 tests total)

**profiles / members** (`routes/profiles.ts`)
- ☐ `GET /profiles` (mine) · `POST` (kind-match; `[seats]`) `+idem` · `GET/PATCH /profiles/:id` (`profile.edit`) `+version`
  · `DELETE` (owner) · members `GET/POST/PATCH/DELETE` (`members.manage`; owner row protected; seat accounting) ·
  `GET/PUT /profiles/:id/unavailability` · templates `GET/POST/PATCH/DELETE` (`templates.manage`).

**holds** (`routes/holds.ts`) — pure math from `@showme/shared`.
- ☐ `POST /events/:id/hold/rank` (operator; `computeRankShift`) · `/confirm` (performer) · `/decline`
  (`computeDeclinePromotion`). Hold rank stays operator-only in the serializer.

**event content** (`routes/{riders,schedule,messages,setlists}.ts`)
- ☐ riders — library vs instance; **copy-on-attach** (`source_rider_id`), `is_default` auto-attach.
- ☐ `schedule_items` CRUD (`schedule.view`/`schedule.edit`; per-viewer row serialize) `+idem` on create.
- ☐ `event_messages` (`message.post`; `visibility[all|operators|party]`) — also the POST-to-send half of realtime.
- ☐ `setlists` (performer authors; party-scoped) · `performance_reports` (operator, derived from setlist).

**tasks & calendar** (`routes/{tasks,calendar}.ts`)
- ☐ `tasks` CRUD (+ `task_reminders`) · `calendar_items` CRUD. Scope by owner (event/profile/user).

**notifications** (`routes/notifications.ts`)
- ☐ `GET /notifications` (`list`) · `POST /notifications/read` (server-side `read_at`).

**contacts** (`routes/contacts.ts`)
- ☐ CRUD (owner-profile scoped; `persons` jsonb).

**invitations** (`routes/invitations.ts`)
- ☐ `POST /invitations` `+idem` · `GET /invitations/:token` · `POST /…/{accept|decline}` · `POST /invitations/:code/claim`
  (JIT membership + seat accounting).

Wire **CC-5 entitlements** into: event confirm (event cap), `POST /offers` (offer cap), admin grant (paid plan).

---

## Phase C — inbound, off-platform, agents, billing ✅ DONE (136 tests total)

**inbound** (`routes/inbound.ts`)
- ☐ `POST /booking-requests` (public form; dedup partial index) · `GET /booking-requests` (`list`) · `PATCH /…/:id`
  · `POST /offers` (`[monthly cap]`) `+idem` · `POST /offers/:id/flag-spam` (`spam_flags`) · `POST /events/:id/handoff`
  (venue handoff → stub profile + `invitation(source=venue_handoff)`).

**off-platform / shares** (`routes/shares.ts`, `packages/auth` share principal) — decisions #6, `off-platform-access.md`
- ☐ `resolveSharePrincipal(db, token, verifiedEmail?)` — 2nd principal front door feeding the SAME authorize/serialize.
- ☐ `POST /events/:id/shares` (create tokenized grant; capabilities[]) · `GET /shares/:token` (reject expired/revoked;
  public vs protected) · `POST /shares/:token/otp` (6-digit salted-SHA256, 10-min TTL, 3/hr) · `POST /shares/:token/verify`
  (5 attempts → HS256 JWT 24h, `SHARE_JWT_SECRET`) · `POST /shares/:token/{comment|approve|confirm}` (through authorize,
  attributed to the matched participant) · `POST /claim` (`UPDATE profiles SET owner_user_id, claimed_at`). Recipients
  never leaked. New: `jsonwebtoken` dep + `SHARE_JWT_SECRET` in config.

**agents / representation** (`routes/representations.ts` + `packages/auth` fan-out) — decisions #14
- ☐ `POST /representations` (propose; proposer auto-confirms) · `PATCH /representations/:id` (accept → both confirm →
  active; counter → re-stamp `proposed_by`, clear other confirm; terminate → effective-dated). Counter history = audit.
- ☐ `assertDisjointRegions(db, performerId, region, isWorldwide)` guard before activation (one active agent per region).
- ☐ **Fan-out**: on active, insert `event_participants(role=agent)` on in-region events (venue country ∈ region) with the
  `agent` preset; flag the performer's participation delegated/view-only.
- ☐ Representation settlement orchestration: `commissionableIncome(deal, basis)` selector → `settleRepresentation` →
  persist a 2nd `settlements` row (`representation_id`); "collectable once source transfer paid" gate.

**plans / billing** (`routes/plans.ts`)
- ☐ `GET /plans/:profileId` · `POST /plans/:profileId/request` · `GET /profiles/:id/cap-status` (computed).

---

## Phase D — realtime, jobs, public, admin, files, fx ✅ DONE

**realtime** (`apps/stream` — new Cloud Run service)
- ☐ `GET /stream` — one SSE connection per user via Postgres `LISTEN/NOTIFY` (shared LISTEN conn, in-process fan-out).
- ☐ Mutations emit `pg_notify` (e.g. `event_messages` insert) → stream fan-out. min-instances=1, bypasses the CDN.

**jobs / reapers** (`apps/jobs` or Cloud Run jobs) — decisions #10/#11
- ☐ GDPR erasure: `tombstoneUser` (overwrite PII, keep pseudonymous id, set `anonymized_at`) + delete deletable bucket
  + Firebase `deleteUser` + anonymize `actor_display`; scoped to shoWMe-controller PII via a codified **PII inventory**.
- ☐ `GET /me/export` (Art. 15/20) — walk the same PII inventory.
- ☐ Retention reapers: unclaimed stubs, expired shares/OTPs, old RSVPs → anonymize. Duration reapers: offers 30d /
  handoffs 90d → `expired`. Local-time reminder job (resolve owner tz → UTC firing).
- ☐ **Timezone lib** (Luxon/Temporal) + `events.timezone` snapshot-from-venue resolver at create; serialize event local
  times as `{ localDateTime, timezone }` (TZ-9).

**public** (`routes/public.ts`, `config.public`)
- ☐ `GET /public/profiles/:slug` · `GET /public/events/:id` · `GET /public/profiles/:slug/availability` ·
  `POST /public/events/:id/rsvp` (`audience_rsvps`, unique(event,email)). Whitelisted-column serializer.

**admin** (`routes/admin.ts`, `is_admin`)
- ☐ `POST /admin/plans/:profileId` · `GET /admin/profiles` · `GET /admin/alerts` · `GET /admin/audit`.

**files** (`routes/files.ts`)
- ☐ Signed-URL issue/upload/confirm; access only after `authorize(read parent)`; metadata in `files` (Firebase Storage).

**fx** (`routes/fx.ts`)
- ☐ `GET /fx?from&to` (display-only, `fx_rates_cache`) · `GET /fx/currencies` (static `currencies`).

**reporting** (decisions #15, mostly SQL)
- ☐ `GET /insights/*` (on-the-fly aggregates) · export CSV builders ported to `packages/shared` (client-side gen, no
  endpoint) · ticketing `source` discriminator on revenue lines (`TicketingSync` port).

---

## Deferred (not in this plan)
Stripe Connect / payment rails / webhooks / Pay-All / escrow / invoice PDF generation / Swish (all payments-phase,
`docs/payments.md`); `apps/web`, `apps/ssr`, `packages/{ui,api-client}` (frontend); crypto-shred IBANs (GDPR optional).
