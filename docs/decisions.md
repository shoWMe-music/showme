# shoWMe — Design decisions (working session 2026-07-13/14)

Decisions taken in conversation that **refine or supersede parts of PLAN.md**. PLAN.md remains the blueprint;
where this doc and PLAN.md disagree, **this doc wins** (it's newer). Fold these into PLAN.md + the Drizzle schema
before/at schema-writing time.

---

## 1. Agreement is merged into the deal (1:1)

The `agreements` table and `agreement_confirmations` fold into the deal spine:
- **`deals`** gains the agreement fields (`agreement_body_text`, `agreement_status`, `confirmed_snapshot jsonb`,
  `reopen jsonb`). The deal holds the money terms **and** the agreement.
- **`deal_parties`** gains per-party confirmation (`confirmed_at`, `confirmed_by`, `signature_hash`) — confirming
  an agreement is a per-party act, and `deal_parties` already enumerates the parties.
- **Live vs frozen:** terms render live for settlement; on all-parties-confirm (later: e-sign) they **freeze**
  into `confirmed_snapshot` — same "render live, snapshot on finalize" pattern used for settlements. This resolves
  the mutability conflict (live-recomputed money vs frozen legal record) within one row.
- **E-signature is a later meaning-upgrade** to `signature_hash` — zero schema change. PDF is always generatable.

**Supersedes:** PLAN.md §F (standalone `agreements`/`agreement_confirmations`/reopen) and the §"Table
consolidations" agreement rows.
**Open question before locking:** are there **paper-only agreements** (no money) or one agreement spanning
**multiple deals**? If common, the 1:1 merge needs an escape (a deal with null `structure`, or un-merge). If rare,
merge holds.

**Implemented (2026-07-21) — confirm/reopen endpoints:**
- **`POST /deals/:did/confirm`** (`agreement.confirm`) stamps only the **caller's own** `deal_parties`
  (`confirmed_at`/`confirmed_by`), resolved from the caller's participant ids — a per-party act. **Observers don't
  gate**; when every non-observer party has confirmed, the live terms **freeze** into `confirmed_snapshot` (money as
  string) and `agreement_status → confirmed`. A caller who is not a party gets **400**; a **delegated** performer has
  no `agreement.confirm` (it moved to their agent, #14) → **403**. Idempotent per party.
- **`POST /deals/:did/reopen`** (`agreement.manage`; operator/agent only) requires a currently-`confirmed`/`signed`
  agreement (else **409**), clears **all** per-party confirmations, releases `confirmed_snapshot`, and records
  `{reopenedBy, reopenedAt, reason, priorSnapshot}` in `reopen`; `agreement_status → sent`. Optimistic-locked on the
  deal `version`.
- `DealResponse` now exposes `agreement_status` + per-party `confirmed_at` so the rollup is observable. Implemented in
  `apps/api/src/routes/deals.ts`.

## 2. Audit is mandatory and enriched (not "if sensitive")

- The request pipeline's last step changes from **"audit if sensitive"** to **"audit every mutation, in the same
  DB transaction"** — write + audit row commit atomically, so an unlogged change is impossible by construction.
- **`audit_log`** enriched: `acting_profile_id`, `capability`, `action`, `target_kind`, `target_id`, `event_id`,
  **`changes jsonb` (before/after diff)**, `request_id`. Append-only, admin-only.
- **`activity_log`** stays the curated **user-facing** feed (see #3). Same event can write both.
- **Snapshots** (`deals.confirmed_snapshot`, `settlements.finalized_snapshot`) are frozen legal *states*, distinct
  from the continuous *change trail* in `audit_log`. Keep both.

## 3. Activity feed visibility is target-scoped (inherits resource access)

- Replace `activity_log.visibility[all|operator_only]` (too coarse) with **`target_kind` + `target_id`**.
- A feed row is visible **iff the viewer can view its target** — the *same* `authorize` check that gates the
  resource. One policy module governs resource **and** its history; no second visibility system.
- Falls out for free: performer sees title + own deal + own settlement + schedule history; crew sees
  schedule + own deal + title. Implemented as **one `WHERE`** using the viewer's effective capabilities +
  party-scoped id lists (their `deal_id`s, their settlement id) — the WHERE *is* the rule.

## 4. Permissions are three tiers: floor ∪ band ∩ ceiling

Replace PLAN.md's single formula with:
```
effective = baseline(event_role)                      -- FLOOR: inalienable per-role, operator can't revoke
          ∪ role_filter(permission_set, profile_role) -- BAND: operator's configurable grants (permission_sets)
          ∩ grantable(relationship)                   -- CEILING: un-grantable (transparency + billing)
```
- **Floor** (code-defined, in the auth module): e.g. performer always has `event.view`, `deal.view.own`,
  `settlement.view.own`, `schedule.view`, own-`*.confirm`, `rider.submit`. Crew: `event.view`, `schedule.view`,
  own deal/settlement. Not stored on the participant — a product invariant.
- **Band** = the existing data-driven `permission_sets` (operator clones/customises).
- **Ceiling** = hard rules: arm's-length parties can **never** be granted `budget.view` / `*.view.all` (the
  transparency model); `permission.grant_admin` requires a paid plan (entitlement layer).

**Deal & settlement visibility is PURE party-scoping — no `*.view.all` override.** *If you are not a `deal_party`,
you cannot see the deal or its settlement.* Full stop.
- The operator's broad visibility is **emergent** — they're a party (payer / economic hub) on the event's main
  deals — **not** a see-everything capability. `deal.view.all` / `settlement.view.all` are dropped as overrides.
- **Co-operator transparency** = co-operators are **co-parties** on the shared deals **and** share the budget — not
  an override. To share a deal, be a party on it.
- A performer's private **sub-hire** (performer↔crew) is invisible to the operator (not a party). The operator
  still sees the crew **person** as an `event_participant` (logistics/schedule) — just not the **pay** (the deal).
- A sub-hire is an **ordinary deal + agreement**; its settlement is a **downstream, party-private sub-settlement**
  (nested under the sub-hirer's entitlement).
- **Sharing a deal (e.g. with a co-host) = adding them as a `deal_party`** with a new read-only role
  `role_in_deal='observer'` (sees the deal + its settlement; no entitlement, no money). This *preserves* the rule —
  they can see it because they are now a party. (The off-platform `shares` mechanism is for external/email
  recipients; **observer parties are the on-platform way** to grant deal visibility.)

**Supersedes:** PLAN.md's `effective_capabilities = ⋃ role_filter(permission_set, profile_role)` **and** the
operator `deal.view.all` / `settlement.view.all` "sees all financials" reading (now emergent from party membership,
with co-operator transparency via shared deals + shared budget).

**Implemented (2026-07-21) — entitlement gates wired at their mutation sites** (the layer is SEPARATE from
authorization: a fresh `canUseFeature` read composed AFTER `authorize`, per §C). The gate function existed + was
unit-tested; the enforcement was missing at two routes and is now in place, mirroring the `create_event` gate on
event-confirm:
- **`send_offer`** — `POST /offers` (`inbound.ts`) now gates on the sender's acting profile: a `free_artist` is capped
  at 50 performer-offers per calendar month (fresh `COUNT`), `artist_pro` unlimited → `403` with the reason otherwise.
  Sending an offer now requires an acting profile (the sender identity the tier is read from).
- **`grant_admin`** — `POST`/`PATCH /profiles/:id/members` (`profiles.ts`) now gate promoting a member to `admin` on a
  **paid plan** (decisions #12: admin consumes a seat); free tiers get `403`. PATCH also now sets `seat_consumed` when
  the role changes to/from admin (it previously only set it on add).

## 5. Invoices & payout identity (money-out layer)

- **Invoice = a document over a `settlement_transfer`** (or a `budget_line` cost, for AP "bills"). Tracked with
  `owed/paid/handled`, frozen `document_snapshot` on issue. Direction flag = invoice (AR) vs bill (AP).
  Nullable links both ways (can stand alone). Reuses `contacts` (`iban/bank_name/vat_id`).
- **Payout identity on the profile** — new: `payout_accounts(profile_id, currency, holder_name, iban, …)` +
  billing fields (`legal_name`, `address`, `vat_id`, `vat_registered`, `vat_rate`, `invoice_number_seq`). This is
  the party's own money identity; later maps to a Stripe Express connected account.
- **Invoice numbering is a real stored gapless sequence** per issuer — the **deliberate exception** to the
  "counters are derived (`COUNT`), never stored" rule (voiding must not renumber history).
- **Scope:** auto-generation, payment rails, escrow all **deferred**. v1 = settlement shows bank details + manual
  mark-paid; optional manual invoice document. Full payment architecture → `docs/payments.md`.
- **Adopted new surfaces** (design vs plan gap): **Setlists** (workflow module — `setlists` + `setlist_reports`,
  see open-calls resolution), **Financial Projections** (reuse budget + settlement-preview, mostly a UI mode),
  **Bills & Invoices** (the invoice model above).

**Implemented (2026-07-21) — invoices + gapless numbering + payout identity:**
- **Invoice number = `{year}-{NNNN}`, gapless PER YEAR** (`2026-0001` … resets `2027-0001`). The counter is a stored
  per-year map in `profiles.billing.invoiceNumberByYear` — the deliberate exception to "counters are derived". Handed
  out ONLY at issue by `nextInvoiceNumber` (`apps/api/src/lib/invoice-number.ts`), which locks the issuer's `profiles`
  row **`FOR UPDATE`** and bumps in the SAME txn that commits the invoice → concurrency-safe (N, N+1 never collide),
  gapless (a rolled-back issue consumes nothing), and **void never renumbers** (voiding leaves the counter untouched;
  the number stays consumed). AR (`issued`) only; a `received` bill keeps the external sender's number.
- **Invoice lifecycle** (`routes/invoices.ts`): `POST /invoices` (draft, no number) → `POST /invoices/:iid/issue`
  (assign number + freeze `document_snapshot` + `state=sent`) → `PATCH /invoices/:iid` (draft edits, or state
  `paid`/`overdue`/`void`; an issued doc is frozen — only state moves). Added `invoices.owner_profile_id` (whose books
  + which sequence + access gate). Money as string (money.md); party-scoped to the owner profile's members.
- **Payout identity** (`routes/payout.ts`): `payout_accounts` CRUD, method-typed — **`type` (`payout_method` enum:
  bankgiro | iban | swish, extensible) + generic `identifier`** (the account value), so new rails need no column-per-
  method; plus `PATCH /profiles/:id/billing` (legal name, VAT — preserves the system-managed number counter). Manage =
  owner/admin; bank details are sensitive. Payment rails / auto-generation still deferred (`docs/payments.md`).

## 6. Off-platform access is the auth engine + a token/OTP front door + stub participants

Non-account people get read views and actions via email links, reusing `authorize`/`serialize` — only the
*principal* differs (share token / OTP→JWT → email match → participant). Full design in
`docs/off-platform-access.md`. Key points:
- **Per-share `access[public|protected]`** (sharer's OTP toggle); **scope is orthogonal** — `public` = no identity
  challenge, still the scoped slice only.
- **A share = a tokenized capability grant** (`shares.token` + `target_kind/id` + `capabilities text[]` +
  `access`), reusing the permission-set vocabulary.
- **Keep `share_recipients` a TABLE** (not the `shares.recipients jsonb` the PLAN.md consolidation suggested) —
  it now carries OTP state, claim tracking, and party links. (Confirmed 2026-07-14.)
- **Port the OTP/JWT constants verbatim** (6-digit salted-SHA256, 10-min TTL, 3/hr, 5 attempts, HS256 24h JWT,
  `SHARE_JWT_SECRET`).
- **Simplifications vs old app:** email→party = one join; claiming a stub = one `UPDATE` (`claimed_at`); no
  per-share snapshot (render live). Actions reuse existing tables through the same `authorize`.
- **Venue handoff = the delegation case** (stub host + `pendingHostHandoff` → ownership transfers on claim).

**Resolves:** the off-platform/unclaimed-stub design gap. **Partially covers:** the operator-delegation thread
(the *mechanism* is settled via handoff; the broader manage-on-behalf UX is still open below).

## 7. Money representation — integer minor units + a `Money` type

Full spec in `docs/money.md`. Lockable now (accounting side); payment FX deferred.
- **`BIGINT` minor units + explicit currency, never float.** `Money = {amount: bigint, currency}` in
  `packages/shared`; all math through it; `add`/`sub` throw on currency mismatch.
- **Splits via largest-remainder `allocate()`** (Σ parts === total); **operator residual absorbs rounding** →
  `Σ net = 0` by construction. Percentages = basis points; FX rate = `NUMERIC(18,10)`; rounding = half-up [defaults].
- **Every deal/settlement/transfer/invoice carries its own currency;** the `Σ net = 0` invariant runs in
  `events.base_currency` minor units; store the locked FX rate + timestamp + source on the finalized settlement.
- **JSON: money amount as a STRING** (bigint > 2⁵³ unsafe as a JS number). A static `currencies` reference gives the
  minor-unit exponent per code.
- **Settlement-engine port is NOT verbatim:** float → `Money`/bigint; **re-express the 50+ test suites in minor
  units** (green = port accepted).

## 8. Concurrency & idempotency (integrity of collaborative + money operations)

- **Optimistic locking** on collaboratively-editable rows (`events`, `budgets`, `budget_lines`, `deals`,
  `settlements`, **plus `settlement_transfers` and `deal_parties`** — edited/confirmed concurrently like their
  parents): a dedicated **`version int`** column, bumped on write; a stale write is **rejected** ("someone else
  changed this, reload") — never a silent overwrite (lost-update).
- **Idempotency keys** on every mutating/money endpoint (Pay-All, transfers, mark-paid, finalize, settlement
  compute, **plus `POST /events` (wizard create), invoice issue, and offers/info-emails/invites** — retry-unsafe
  creates & sends): an `idempotency_keys` table maps key → stored result; a replay returns the same result instead
  of re-executing. Pass idempotency keys through to Stripe; **dedup provider webhooks** by event id.
- Consistent mechanisms, not a rework: a `version` column + an `idempotency_keys` table.

**Locked (2026-07):** (1) use a dedicated **`version int`**, not `updated_at` (timestamps can collide under fast
concurrent writes). (2) **Idempotency-key retention = 24h**, scoped per `(user, endpoint)`; client sends
`Idempotency-Key: <uuid>` per user action. (3) The rule of thumb: *"someone else changed this, reload"* → version;
*"this must not happen twice"* (money, creates, sends, gapless sequence numbers) → idempotency key. Money-out
endpoints (finalize, Pay-All, invoice issue) want **both**.

## 10. Time zones — instants (UTC) vs local wall-clock (local + IANA zone)

Full spec in `docs/timezones.md`.
- **Absolute instants** (`*_at`, OTP expiry, `finalized_at`, payments) → **UTC `timestamptz`**.
- **Local wall-clock** (event door/start/end/curfew, `schedule_items`) → **local datetime + an IANA zone**, resolved
  to an instant on demand (never pre-baked to UTC — DST/reschedule-safe).
- **Schema additions:** `events.timezone` (IANA, defaulted from the venue location + snapshotted onto the event —
  anchors all its local times) and `users.timezone` (display + user-local reminders).
- Duration reapers (offer 30d, handoff 90d) stay UTC; local-time reminders resolve in the owner's tz. Event times
  display **venue-local** (labelled); personal items display user-local. API: instants = ISO-8601 UTC, event local
  times = `{localDateTime, timezone}`. Use a real tz lib (Temporal/Luxon), never JS `Date`'s implicit zone.

## 9. Payment provider = Stripe Connect (Mollie dropped)

**Stripe Connect** chosen (2026-07). **Mollie evaluated and dropped** — Stripe's marketplace depth (Express
onboarding, N-way splits, hold-then-release, mature webhooks) fits the Pay-All / split / escrow vision; not worth
maintaining two providers. Keep the provider behind shoWMe's transfer/invoice abstraction. Verify Stripe's **Swish**
support for consumer/ticket money (Swedish market). `plans.source` → `[manual|stripe]` (was `|mollie`); Mollie MCP
removed from `.mcp.json`.

## 11. GDPR — anonymize-not-delete, scoped to where shoWMe is controller

Full spec in `docs/gdpr.md`.
- **Erasure = anonymize, don't delete.** Art. 17(3) exempts data needed for a legal obligation (accounting retention
  ~7y). Keep balanced financial records (settlements/invoices/audit), strip PII: **tombstone** the `users` identity
  (overwrite PII, keep pseudonymous id so FKs + `Σ net = 0` hold), delete personal content, delete the Firebase Auth
  account, anonymize `audit_log.actor_display`. Add **`users.anonymized_at`**.
- **DECIDED: erasure scrubs ONLY data where shoWMe is the controller.** Operator-controlled data (their `contacts` /
  address book + business copies of deal/settlement records) follows the **operator's** obligations — shoWMe
  (processor) does not unilaterally scrub it.
- **Data export** (Art. 15/20) is the twin: gather-all-PII JSON across a documented **PII inventory** (drives both).
  Retention-reaper auto-anonymizes stale data. DPAs with subprocessors (Google/Stripe/Brevo/Firebase).

**Implemented (2026-07-21) — export API + shared package:** the PII-inventory-driven engine (`anonymizeUser`,
`exportUserData`, `PII_INVENTORY`) moved out of `apps/jobs` into a shared **`packages/gdpr`** so both the API
(on-demand export) and the jobs retention-reaper (auto-anonymize) consume one source of truth. Wired the subject-access
route **`GET /me/export`** (`routes/me.ts`): self-service (keyed on the authenticated `principal.userId`, a user can only
export themselves — no extra authz), returns the all-PII JSON grouped by table, and **audits the access itself**
(`gdpr.export`). Note: `audit_log.target_id` is a uuid, so a user's text id lives in the audit payload + `actor_user_id`,
not `target_id` — `AuditEntry.targetId` is now optional for such target-less events. (`contacts` stays excluded — the
operator is its controller.)

**Implemented (2026-07-21) — erasure endpoint:** **`POST /me/erase`** (`routes/me.ts`) wires the existing
`anonymizeUser` for self-service Art. 17 erasure — the caller erases themselves (keyed on `principal.userId`),
tombstoning the identity + deleting personal content, audited (`gdpr.erase`). Still deferred: a **retention
auto-anonymize reaper** (needs a defined "stale user" trigger — no such column yet) and deleting the Firebase Auth
account (outside the DB service).

## 12. Membership & groups (roster, roles, seats)

- **Members** = users (or off-platform contacts) added to a profile; a user can be a member of **many profiles**
  (per-profile role). `profile_members.role[owner|admin|editor|viewer|crew]` + `seat_consumed`.
  - **admin = OWNER-LEVEL** operational access, **minus owner-only** actions reserved to the owner: **billing/plan,
    delete profile, transfer ownership**. Admin **consumes a seat** (`plans.seats`; ties to the
    `grant_admin`-needs-paid-plan gate). `editor` (edit, not financials/members) / `viewer` (read) / `crew`
    (event-assigned, own slice) are **free**. `user_id` NULL = off-platform contact (invitable → claim).
- **Groups** = reusable member bundles, **owned at the user/org level** (`groups.owner_user_id`) and **cross-profile**
  (`group_profiles` — a group serves many profiles); a user can be in many groups. **Assigning** a group to an event
  expands it into one `event_participants(role=crew)` per member, referencing each member's **own identity** (not a copy).
- Three layers: **member (roster) → group (bundle) → participant (event assignment)**.
- **Refines PLAN.md:** `profile_members.role` gains `viewer`/`crew` + `seat_consumed`; the earlier single-profile
  `teams` stub → `groups`/`group_members`/`group_profiles` (user-owned, cross-profile). Authorization composition
  (#4) unchanged — profile role is the "how much" tier; admin strips nothing bar owner-only.

**Implemented (2026-07-21) — groups, per-member crew authorization + sponsor-scoped visibility:**
- **Groups CRUD** (`apps/api/src/routes/groups.ts`, owner-scoped) + `POST /events/:id/groups` **assign** (verb: *assign*,
  not "fan out") → `assignGroupToEvent` expands each member into `event_participants(role=crew)` referencing the
  member's **own profile** (resolved from `user_id`, preferring a `team_and_crew` profile). Off-platform (email-only)
  members are **skipped** (they need an invite first); already-present profiles are skipped via the unique constraint.
  Inverse `DELETE /events/:id/groups/:gid` soft-removes by the `details.sourceGroupId` provenance stamp.
- **Per-member authorization is the participant's permission set** (`event_participants.permission_set_id`), seeded from
  `group_members.default_permission_set_id`. An **unset** default → null set → the bare **crew floor**
  (`event.view` + `schedule.view` + own slice) = the least-privilege "schedule + title + roster" tier. Presets
  `crew_schedule_only` (chef/bartender) and **`crew_technical`** (+`rider.view`, sound/lighting) name the tiers.
- **Riders are opt-in + sponsor-scoped (the "grant only what you hold" rule).** New capability **`rider.view`** gates
  the event rider read (was `event.view` — every crew saw all riders; **leak fixed**). It is NOT in the crew floor.
  `GET /events/:id/riders` scopes the set by the caller's **reach**, computed **role-agnostically** so ANY sponsor works
  (`participantRiderDomain`, recursive + cycle-guarded): operator → all; performer/support → own; **agent → the
  performers they represent**; crew (with `rider.view`) → their **sponsor's** reach (recursed). A caller's own reach is
  intrinsic; a crew participation only contributes its sponsor's reach once the caller holds `rider.view`.
- **Anyone may bring crew, not just the operator** (the sponsor sets the scope). The **sponsor** is recorded on assign
  (`details.sponsorParticipantId` = the bringer's own participant): an **operator** (crew.manage/participants.manage)
  → sponsor is the host → crew can be granted **all** riders; a **performer / agent / crew-lead** (floor cap
  **`crew.submit`**) brings their own crew → sponsor is themselves → crew inherit only **that bringer's** reach (an
  agent's crew sees only the agent's represented performers' riders). So a bringer can never expose beyond their own
  reach. (`crew_lead` gains `crew.submit`; the `agent` preset gains it too.)

## 13. Riders — profile-level library + event instances (reuse / auto-populate)

- `riders` gains **profile scope**: a performer/venue keeps a reusable **library** (`owner_profile_id` set,
  `event_id` NULL) — standard tech / hospitality / stage_plot / input_list riders.
- **Event instances** (`event_id` + `owner_participant_id`) are **copied** from a library rider (`source_rider_id`
  back-pointer) — snapshot on attach, so master edits don't retroactively change past/locked events.
- **Auto-populate:** `is_default` library riders one-click-add (or auto-attach) when the owner becomes an
  `event_participant`. **Kind-agnostic** (venues/team-and-crew too).
- Uses `file_id → files` (the canonical registry) instead of inline `file_url`/`file_name`. (The file-storage
  section already anticipated "rider templates" under `profiles/{id}/documents/`.)

## 14. Agents & representation (4th account kind · fan-out into participants · representation-scoped settlement)

A booking **agent** is a first-class role, not a variant of the existing three. Industry meaning: an agent secures
live work and **negotiates on behalf of** a performer, for a **commission on gross live/deal income** (never
merch/publishing).

- **New `kind = agent`** alongside `operator | performer | team_and_crew`. Distinct dashboard (roster, negotiation
  pipeline, commission owed/collected) and pricing. **Arm's-length** — the performer keeps their **own** account
  (NOT the agency-owns-the-profiles case, which `profile_members`/`groups` (#12) already covers).

- **`representations` table** — a **standing, cross-event, regional agreement** between two profiles (like a `group`,
  **not** an event participant). Set **off-event** on the "Agents & Performers" page: `agent_profile_id → profiles`,
  `performer_profile_id → profiles`, `region` (ISO country codes; **country-level**) + `is_worldwide bool`,
  `commission_rate` (basis points, per #7), `commissionable_basis`, `agent_collects bool` (agent is the default
  payout destination), `proposed_by[agent|performer]`, `status[proposed|active|terminated]`, `starts_at`, `ends_at`,
  `confirmed_by_agent`, `confirmed_by_performer`, `terminated_at`, `terminated_effective_at`, `terminated_by`.
  **One active agent per performer per region** — active regions per performer must be **disjoint**.
  - **Commissionable basis = deal income only** — guarantee, ticket/door split, performer share/split, escalator
    tiers, deal bonuses. **Excludes merchandise, other non-deal extras, and reimbursed/pass-through expenses.**
    Fixed on the representation, never decided per-event.
  - **Bidirectional & symmetric (either side initiates + proposes terms).** Agent invites performer **or** performer
    invites agent — the handshake fields (`confirmed_by_agent`/`confirmed_by_performer`) are already symmetric, so
    direction is just `proposed_by`. The **proposer auto-confirms their own side**; the counterparty either
    **accepts** (their confirm → both set → `active`) or **counters** (edits terms → re-stamp `proposed_by`, **clear
    the counterparty's confirmation** so the new terms need re-confirming). No separate offers table — the
    back-and-forth of counters is the **`audit_log`** (#2). Renegotiating an already-active representation runs the
    same propose/confirm cycle; terms never change silently on an active row.

- **Authorization = fan-out into `event_participants`, NOT an override.** A representation is to an agent what a
  `group` is to crew (#12): on the performer's **in-region** events it **fans out** into participants — the agent
  gets a participant with **negotiate/approve** authority (a permission set), and the performer's participation is
  flagged **delegated** (view-only permission set). The agent reaches the event the **normal** way (they're a
  participant); authority is an ordinary `floor ∪ band ∩ ceiling` (#4) permission set — **no special traversal, no
  subtractive rule.** The performer's read-only is **delegation, not revocation**: by both-party consent they
  delegate their *action* capabilities (confirm/approve/negotiate) to their agent for in-region events; they keep
  their **view** floor (`deal.view.own`, `settlement.view.own`, `schedule.view`). (Supersedes the earlier
  "subtractive cross-profile override" framing — dissolved.)
  - **Region match** = event venue location ∈ `representation.region`. **Scope ceiling:** agent controls **in-region
    events/deals/approvals only** — never the performer's profile identity, billing, or out-of-region events.
  - **Termination:** both-party confirm to activate; **either party can terminate unilaterally** with a
    `terminated_effective_at` (immediate or agreed-future — shoWMe reflects it, doesn't enforce a notice period).
    **Commission follows the closed deal:** any deal **confirmed while active** keeps its commission (its
    representation settlement stands, even post-termination); deals still in negotiation revert to the performer with
    no commission. Agent keeps the **money** earned; performer regains **control** of everything still open.
  - **Participant ≠ financial visibility:** the operator seeing the agent as negotiator is *realistic* and fine
    (they negotiate *with* the agent) — same as seeing a crew person but not their pay (#4). The **commission rate**
    is the private bit; it lives only in the representation settlement below.

- **Settlement = two ordinary `settlements` rows (NO new table).** The commission can't be a `deal_party` on the
  event deal — an in-event commission is a term of the event's `Σ net = 0`, so hiding it unbalances the
  counterparty's view. Instead:
  - **Event settlement** — the normal one. Default payee = the **performer**; when `representation.agent_collects`
    is set, the agent **collects on the performer's behalf** — the **performer stays the entitled `deal_party`**
    (role=payee), the agent is only the **payout destination** (the cash lands in the agent's account). The agent is
    **never a separate entitled party**, so it never enters the event `Σ net = 0`. Derived from the representation
    (optional per-event override). No commission appears here; `Σ net = 0` is clean.
  - **Representation settlement** — a **second `settlements` row scoped to a `representation`** (add nullable
    `settlements.representation_id → representations` alongside the existing event-participant scope). A degenerate
    two-party reconciliation, **private to agent + performer**, produced by the **same engine** and paid by the same
    `settlement_transfers` / invoice (#5) / Stripe rails. Direction falls out of who held the cash:
    **performer collected → performer → agent** (commission); **agent collected → agent → performer**
    (`gross − commission`). Commission = `commission_rate × commissionable income`; **currency = the deal's payout
    currency** (no FX of its own).
  - **Status is derived, not a new enum:** the representation settlement's transfer sits `owed` but is *collectable*
    only once the event settlement's transfer to the collector is `paid` — the "waiting for the performer to be
    paid" state is a **read of the source settlement**, keeping `state[owed|paid|handled]` clean. Money-movement
    detail (Flow 2 direct charge, no split, never escrow) in `docs/payments.md`.

**Supersedes:** the PLAN.md `deal_party role_in_deal='commission'` "deduct from recipient, credit agent" reading —
for **private agent representation**, commission is a **separate representation-scoped settlement**, not a party line
on the event deal. (`role='commission'` remains valid only for a **disclosed, off-the-top** commission all parties
agreed reduces the pool.)

**Locked (2026-07-16):** (1) region = **country-level** `text[]` ISO codes + `is_worldwide`; active regions per
performer must be **disjoint**. (2) termination = **unilateral, effective-dated**, no enforced notice; **commission
follows the confirmed deal**. (3) agent-as-payee = a **payout destination** via `representation.agent_collects`, not a
separate entitled `deal_party` (the performer stays the entitled party).

**Locked (2026-07-21) — assignment is EXPLICIT for current events, IMPLICIT for future** (refines step 4 above, which
read as "automatically fans out onto *all* in-region events on activation"):
- **Current events** — on activation the **performer chooses** which of their current (non-concluded) in-region events
  to hand over: the app shows the list (`GET /representations/:id/delegatable-events`) and the performer selects some
  or **"all"** (`POST /representations/:id/events` with `{eventIds}` or `{all:true}`). No automatic hand-over of
  in-flight events the performer may not want to delegate mid-negotiation.
- **Future events** — automatic and implicit: while the representation is **active**, any new in-region event the
  performer joins assigns the agent automatically (the participant-join hook, the same pattern groups use, #12).
- **Mechanism stays materialized** (decisions #14): assigning = an `event_participants(role=agent)` row + the
  performer's participation flagged view-only (delegated). On **termination**, the performer regains control of every
  still-**open** (non-concluded) event — the agent row is removed and the delegation flag cleared. Implemented in
  `apps/api/src/lib/agent-assignment.ts` (`assignAgentToEvent` / `autoAssignAgentOnPerformerJoin` /
  `unassignAgentFromOpenEvents`).

**Implemented (2026-07-21) — commission settlement is auto-derived on compute:** the representation settlement is
**(re)created automatically inside the event settlement compute**, on **every event the agent is present** (one per
agented performer), from the performer's **gross entitlement** in that same compute × `representation.commission_rate`.
Direction via `settleRepresentation` (performer collected → performer→agent; `agent_collects` → agent→performer for
`gross − commission`). It is **settled manually like any transfer** (`PATCH …/transfers/:tid`, `owed→paid→handled`) —
auto-pay is a later opt-in layer. **Privacy** is enforced by tagging the row: `settlements.representation_id` and a new
`settlement_transfers.representation_id` mark the private rows, so `GET …/settlements` returns them **only** to the
performer/agent (a typed `commissions[]` field) and **never** to the operator (who still sees the agent as a net-0
negotiator participant, never the commission). Implemented in `apps/api/src/lib/commission-settlement.ts`
(`syncCommissionSettlements`), wired into `settlement.ts` compute. **Currency:** the commission settles in the event's
**base currency** — the performer's entitlement is already base-denominated (non-base deals are converted at compute,
#7), and #14 forbids the commission having "FX of its own", so deriving + settling it in base is the coherent reading
of "the deal's payout currency" (which equals base whenever the deal has no distinct payout currency). **Deferred:** the
`commissionable_basis` selector (excluding non-deal income lines) — currently the full entitlement is the base,
matching the default agreement.

---

## 15. Prototype review (2026-07) — deferred features & API seams

From reviewing the design prototypes against this plan. These are **build-for, ship-later** seams plus a few
confirmed features.

- **Ticketing revenue = manual now, providers later (1–3 months).** Revenue/ticket lines carry a **`source`
  discriminator** (`manual` today; `ticketing_provider` + `provider_ref` later) and sit behind a thin `TicketingSync`
  port on the settlement input, so Eventbrite/etc. adapters are **additive, no schema churn**. (The prototype's
  "custom field" = an ad-hoc `budget_lines` entry — already covered, not a new model.)
- **Export (CSV/PDF) is a real v1 feature.** Port the old app's **pure CSV builders** (`buildCSVContent.ts`,
  `settlementExport.ts`, `exportContacts.ts` in `../showme-settle-fast`) into `packages/shared`; generate CSV/PDF
  **client-side from already-fetched data** (jsPDF) — **no API endpoint** for v1. Server-side PDF only later, when
  invoices/settlements need emailing as attachments.

**Implemented (2026-07-21) — Tier 2:**
- **#7 Locked-FX + multi-currency (money.md).** Pure `convertMinorUnits` in `packages/shared` (exact bigint, exponent-
  aware, round-half-away). At **compute**, `settlement.ts` converts every non-base deal `guaranteeAmount` + budget-line
  `amount` to base at the CURRENT cached rate (via `lib/exchange-rate.loadRatesToBase` over `exchange_rate_cache`)
  before `reconcile` — the engine still runs Σnet=0 purely in base; a missing rate → 400. At **finalize**, the rate map
  for every currency in play is FROZEN into the snapshot (`data.lockedRates` = `{baseCurrency, lockedAt, source,
  rates}`) for exact reproducibility.
- **#10 Time zones (decisions #10).** Extracted the Luxon helpers into **`packages/time`** (shared by API + jobs).
  `events.timezone` is snapshotted on create/update from the venue's primary **location country** → IANA (explicit
  override wins); a venue change re-snapshots. `schedule_items.start_time` (pre-baked UTC) → **`local_date_time`** (text,
  offset-free); the API serializes schedule items as `{localDateTime, timezone, instant}` — `instant` is the DST-correct
  UTC resolved via `resolveLocalToInstant` (falls back to null on an unresolvable local time) — anchored by the event.
  Event door/start/curfew are just user-labelled schedule items (freeform `label`) — no fixed columns.
- **Jobs runner (`apps/jobs/src/index.ts`).** `runScheduledJobs(db)` orchestrates the reapers (offers/handoffs/shares)
  + the exchange-rate refresh, each isolated so one failure doesn't abort the others — so the FX cache actually
  populates. A CLI guard runs it once from `DATABASE_URL`. Deploy-time scheduling (Cloud Scheduler → this entry) is
  the remaining Tier-4 wiring.
- **#15 Ticketing source + CSV.** `budget_lines` gained a **`source`** (`ticketing_source` enum: manual |
  ticketing_provider) + **`provider_ref`**; a **`TicketingSync`** port (`packages/settlement`) is the build-for-later
  seam (manual-only in v1). Pure **`toCsv`** builders in `packages/shared` (RFC-4180) — client-side, no API endpoint.
- **Filtering: build the API contract now, UI later.** Every list endpoint ships a **filter/sort query contract +
  cursor pagination** from day one (access predicate folded into `WHERE`), even if the UI initially exposes only
  "All". No endpoint re-shaping when filters land.
- **Insights = computed, not warehoused.** A small `GET /insights/*` (or `/reports/*`) namespace backed by
  **on-the-fly SQL aggregates** (top venues by revenue, margin, occupancy; projected-vs-realized = budget vs
  settlement, already a view per this doc). Cache lightly per profile; promote to materialized views only if
  profiled slow.
- **API error envelope.** Typed `{ error: { code, message, details? } }` so TanStack Query's error state renders via
  the design-system `Skeleton`/`Spinner` + error UI. (Loading/empty/error is a client concern; the API just needs a
  renderable error shape.)
- **Authorization is server-side, always.** The persona prototypes are **look-only** and deliberately over-expose
  operator financials to non-operators; `PLAN.md` `serialize()` is the authority — the mocks are not the security
  spec.

**Frontend stack (confirms/refines PLAN.md):** TanStack all the way — Router (URL/search-param state for
filters/view-mode), Query (server state → drives loading via `Skeleton`/`Spinner`), Table + Virtual (the data grids),
**Form** (the many forms; Standard-Schema so it reuses the drizzle-zod schemas), Store only for the small truly-global
remainder. No Zustand / React Hook Form.

## 16. 2026-07-24 working session — folded-in product decisions

Source: the 2026-07-24 Daniel↔Ran design + ClickUp-grooming session (full transcript archived). These **override
PLAN.md** where they conflict and refine earlier decisions. Most ClickUp items that session were grooming of dead
Lovable-era tasks — only genuine product/model decisions are recorded here.

- **16.1 Account kinds — confirmed 4.** `operator · performer · agent · team_and_crew`. Locks the 4-kind model
  (agent per #14). A **team_and_crew** account is deliberately thin — it "basically only sees events + tasks"
  (its own slice), never the pool.
- **16.2 Remove the `custom` (free-text) deal type.** Free text breaks the settlement engine + DB integrity (users
  default to it and dump anything in). **`deals.type` drops `custom`** → `performance | rental | fee | split`. An
  uncovered arrangement = **notes/detail on the agreement** (a `NULL structure` paper-only deal already allows this,
  #15) + a **"deal type not listed? — tell us"** contact button. Amends PLAN Deals model.
- **16.3 Production cost — no default split.** Creating a deal must **not** pre-fill a `cost_split`; it starts
  empty/zero and the operator opts in and enters their own. (Fixes the Lovable auto-split-in-a-weird-ratio bug.)
- **16.4 Event public start/end — REQUIRED, explicit, canonical (RESOLVED 2026-08-02).** Every event has explicit
  **`event_start_time` + `event_end_time` = the event's PUBLIC start and end** — what the audience, ticket buyers,
  public page and validation read. These are **authoritative stored values**: always the real value, always easily
  findable by us and the system, **independent of any label**. Three layers, never conflated: (1) these two canonical
  public times; (2) the **event-level public schedule** — modular, shared with everyone; (3) **internal team/crew
  schedules** (16.5). **Amends #10** (which had made door/start/curfew purely freeform with no fixed columns): the
  freeform schedule stays, but the two public times are explicit required columns again.
  - **Default schedule — seeded, fully editable, reorderable.** From the old app (`showme-settle-fast`
    `scripts/seed/fixtures.ts`): **Get in → Soundcheck → Doors open → Support Act → Show start → Curfew → Clear
    venue**. A starting point, not a lock — add/remove/reorder/relabel freely; keep it modular.
  - **Public start/end are BOUND to schedule items.** By default `event_start_time` ↔ "Doors open" and
    `event_end_time` ↔ "Curfew". The **label of a bound item is user-editable** (rename / translate), but its
    **underlying time stays the canonical `event_start_time`/`event_end_time`** (the value is machine-authoritative
    and always surfaced for us — only the display label is cosmetic), and the **label is always revertible to the
    default**. Model: a nullable `custom_label` on the bound schedule item — `NULL` = show the default label = the
    revert.
- **16.5 Internal team/crew schedule lives under "Team", not the event.** Ported from Lovable: per crew member,
  **Tasks + Schedule + Notes group into one time-blocked entry** (each assignable, with deadlines + notifications).
  Kept under Team/Crew — **private, delegated from the profile, shareable outward** — so it never mixes with the
  event-wide public schedule or confuses users. Maps to `schedule_items` (internal `visibility`) + `tasks` + notes;
  owner = profile, visible to delegated participants. **Room/stage/space assignable on both tasks and schedule
  items** ("stage" = "room" = "space", incl. non-performance spaces like a bar).
- **16.6 New event fields.** **Age restriction / event-type classification** (18+, 21+, kids, all-ages; per
  venue/country) and **mood & style tags** (cross-platform — everyone tags; a controlled vocabulary the system
  relates on later, **not** free text). **Genre & promoter are NOT shown inline on the event** (clutter) — surfaced
  via the **profile hover-preview**.
- **16.7 Accommodation + artist logistics.** **Accommodation** on an event (type hotel/Airbnb/apartment…, date
  range, location = same-as-venue or custom address, notes e.g. door code) **appears as a card on every relevant
  party's calendar** (artist, venue, agent) — e.g. a mid-tour rest night links back to its event. **Logistics** =
  **artist-specific** parking / load-in / back-entrance / travel-party-size, **distinct** from **audience** parking
  (public). Artist logistics on the venue profile + event; audience logistics on the public page.
- **16.8 Budget snapshot at settlement (planned-vs-actual).** Today a budget disappears once it becomes a
  settlement. **Snapshot the budget when the settlement is created/finalized** so planned-vs-actual survives.
  Amends PLAN Settlement/budget (a captured budget snapshot alongside `settlement_snapshots`). Feeds 16.9.
- **16.9 Dedicated financial analytics page.** A **separate advanced (paid)** surface — not buried in the event view
  — comparing **budget → projected → concluded settlement** across events/months (revenue per event, avg, net
  profit, projected-vs-realized) so operators improve estimate accuracy. Supersedes #15's "insights = computed view"
  as the *surface*; still computed on-the-fly + the 16.8 snapshot.
- **16.10 Notifications = digests, not granular.** Replace per-event granular toggles with an **opt-out
  weekly/monthly review summary** (à la OpenDate) + only genuinely critical notifications. Refines PLAN Notifications.
- **16.11 Modular templates.** **Section templates** (event-details, team, schedule, terms…) compose into **full
  event templates**; sections are switchable/modular. Needs a **template-management page**. Free tier capped (≈2,
  section-level only); the **full event-template suite is paid**. Refines PLAN Templates (K) + entitlements.
- **16.12 Freemium = show-everything, gate persistence.** Premium users **see** paid features (UI advertises the
  value) but can't **persist/automate** without upgrading — e.g. the **budget planner is usable but evaporates on
  tab-leave / Save is Pro-only**, and won't flow into settlement until upgraded. Gating: **CRM
  (collaborator-derived contacts) = free**; **audience management + team seats + budget planner = paid**; free = one
  profile + limited seats/templates. Extends the entitlement layer with a "non-persistent trial" mode alongside the
  `COUNT()` caps.
- **16.13 Territory-based architecture.** The platform is **territory-scoped**: regions (Sweden, Germany, Israel…)
  are **disconnected ecosystems** that don't cross-connect (out-of-region = "not in the ecosystem"). This is the
  tenancy frame the **agent's representation territory** (#14) lives inside; the performer's "my agents" view shows
  **agent-managed *regions* + commission** (e.g. DE 10%, SE 5%), **not** "agent-managed events." **RESOLVED — see
  #17** (derive the boundary from location; country stamp + configurable market grouping; soft `authorize()` scoping).
- **16.14 AI / assistant layer (build AFTER the manual flows work).** Two distinct things — do not conflate with the
  booking-**agent** account kind (16.15):
  - **In-app assistant (Google Gemini "living AI"):** expose each manual action as a **tool** over the **capability
    catalog** — `create event`, `confirm shows`, etc. — so a chat prompt infers args and calls the tool. **The
    `authorize(capability)` catalog IS the tool surface** → build manual routes tool-shaped and the AI layer is a
    thin add-on ("~a day" once manual flows are solid). Plus **AI analytics narration** (explain the graphs in plain
    language) and **automations/briefings** ("April has 4 holds…", "confirm all shows through April").
  - **Agent-native (bring-your-own-agent):** accommodate a user driving shoWMe with **their own** AI (Claude/etc.) —
    expose the same tool/capability surface (MCP-shaped). shoWMe hosts the tools, not necessarily the model.
  - **AI indicator icon:** a distinct UI mark (the spotlight logo + AI stars) flags AI-generated elements.
- **16.15 Naming — "agent" is reserved.** `agent` = the **booking-agent account kind ONLY**. Use **`assistant`**/`ai`
  for the Gemini layer and **"bring-your-own-agent"** for the external-AI surface. Lock this before it reaches
  schema/API — the transcript overloads "agent" three ways in one breath.
- **16.16 Onboarding + ingestion.** TypeForm-style animated signup (onboarding quality drives conversion — anecdotal
  10–20%→80%); capture **kind** up front; **pre-build the venue profile before signup completes** (an assistant
  builds a live-but-unpublished profile). Venue enrichment: **Bolagsverket** (Swedish registry) auto-pulls
  org-number/name/location (later powers reporting); Germany (privacy laws) falls back to a **Google-style internet
  fetch by name** + validation. **VAT ID** captured in settings/onboarding (venues have one; artists usually don't;
  part of the Stripe flow). **AI event ingestion → drafts** (user edits after): scrape public data
  (Bandsintown/Songkick, legality-permitting), upload PDF/Excel, or a poster image; **contact import** via Google
  Workspace/Directory API + **duplicate-merge**. Minified in-browser Gemini for onboarding inference (experimental).
  Landing **"request early access" → ClickUp CRM**.
- **16.17 Identity verification (self-serve, later).** Artists verify via **Spotify-for-Artists / Facebook** (connect
  the official artist page). **MFA was deprioritized** this session (Firebase email MFA remains possible / "implicit"
  — not a committed feature).
- **16.18 Assets library.** Uploaded files collect into a reusable **assets** area per profile → re-attach to future
  events instead of re-uploading (in the data model; not yet in nav).
- **16.19 Positioning (guardrail).** shoWMe is an **operational layer / hub** that "marries everything together" —
  **not a ticketing company, not a replacement**. Ticketing stays an **integration** (#15), never first-party.
  Keep **"advancing"** as the agent-facing term for the pre-show logistics phase — shoWMe builds advancing *into* the
  workflow (no PDF ping-pong) but keeps the word so agents recognize it.
- **16.20 Host → Operator (confirmed).** "Operator" labels the event-manager; ownership is transferable ("host"
  collided with the door-person meaning).
- **Speculative / parked:** embedding an **open-source accounting system** as a full accounting layer (idea only).
  **Terms & Conditions** doc needs updating (task).

## 17. Territory / market scoping — DERIVED from location, not stamped (RESOLVED 2026-08-02)

Resolves the "[design before it's baked in]" flag on #16.13. The load-bearing choice: **derive the territory boundary
from each row's location; never stamp a coarse `market_id` as the only location signal.** That is what keeps the
granularity re-drawable later (country → region → city) **without a data migration**.

- **Two decoupled concepts.**
  - **`country`** — always present on the account/profile/event (from location). Intrinsic; drives the things that
    are *genuinely* per-country: **VAT, PRO codes (STIM/GEMA/PRS), currency, registry enrichment (Bolagsverket)**.
    Never goes finer than national.
  - **`market`** — a **named, configurable grouping of countries** = the **isolation + discovery boundary**. A market
    may be **one country** (`DE` = {Germany}), **many** (`EU` = {DE, SE, FR, …}), or worldwide. Configuration, not a
    fixed schema decision. Model: `markets(id, name, default_currency)` + a **`country → market` mapping** (one country
    → one market at a time). **The boundary is DERIVED via this mapping**, so re-drawing it (e.g. Germany starts
    standalone, later joins an `EU` market) is a mapping edit, **not** a backfill.
- **Enforcement = SOFT, in the existing `authorize()`/`serialize()` module** (one DB, one codebase). Principal
  resolution adds the acting **market** (from the acting profile's primary-location country → mapping); list queries
  fold `WHERE country IN (countries of principal's market)`; `serialize` never crosses the market boundary; public
  pages are market-scoped. **Physical per-market instances (separate DB per market) are the later promotion path**
  only if data residency/regulation ever demands it — premature pre-launch.
- **Cross-border within a market works** (SE ↔ DE both resolve to `EU`) — covers Ran's "German venue books a Swedish
  band." **Cross-market is isolated** (Israel = `IL`, never mapped into `EU`); an actor needing two markets holds
  **one account per market** (consistent with the one-kind-per-account rule).
- **Granularity is re-parameterizable to CITY later, cheaply — two safeguards make it so:**
  1. **Keep the finest location on every location-bearing row** (`country` on the account, `city` + `lat/lng` on
     `profile_locations`, city-via-venue on events) — never collapse to only a coarse stamp.
  2. **Treat the boundary as a derived function over location** — going country → region → city re-parameterizes that
     function; the rows already carry the finer signal, so no re-migration. Tax/PRO/currency stay **country**-keyed.
- **City-level *discovery/matching* is a query/geo concern, already supported** — filter/rank by `city` or a `lat/lng`
  radius over `profile_locations`; **not** a boundary change and **not** the same as a "disconnected city ecosystem"
  (which is the rare isolation case, still cheap under this design). Don't conflate the two.
- **Composes with #14 and #P** — the agent's `representations.region` (country-level) + `is_worldwide` is a set of
  countries *within* a market; a market carries a `default_currency` but **per-object currency stays authoritative**
  (the display/locked-FX layer, #P/#7, is untouched).

## 18. Ran landing review (2026-08-17) — product items surfaced

Ran's 2026-08-17 landing-page feedback (tracked in ClickUp "Ran's Feedback 2026-08-17", parent `86cb62zv4`) was mostly copy/CSS, but three items are **product/build decisions**, not landing tweaks. The landing copy for each was updated to *represent* the intended behaviour; the app build is tracked separately.

- **#6 — Outgoing Requests / offers are first-class (send, not just receive).** Performers and agents must be able to **send** offers/invitations, not only receive them. Landing "Offers" copy now reads "in and out" (send your own request; outgoing offers on an act's behalf). **Build:** an Outgoing Requests surface in `apps/web` for performer + agent, on the existing invitations/offers spine (`event_participants` + the requests/invitations model). This is additive to the current incoming inbox, not a new concept.

- **#7 — "Professional" → "Team and Crew" is a FULL internal rename (RESOLVED: full rename).** The account kind formerly named `professional` is renamed to **`team_and_crew`** everywhere: the user-facing label is **"Team and Crew"** and the internal account-kind slug/enum value, type unions, detail table (`professional_details` → `team_and_crew_details`), seeds and auth layer all move to **`team_and_crew`**. The slug is **`team_and_crew`** (not plain `crew`) deliberately, to avoid collision with the **`crew` event-role** (`event_participants.role=crew`). This **supersedes** the earlier "label-only" default: the internal vocabulary is changed too (schema + auth + seeds + `docs/story.md`'s account-kind vocabulary), applied consistently across PLAN.md, story.md, the skills, and the design docs.

- **#8 — Crew availability feeds event staffing (auto-surface + assign).** Availability is **not** a standalone calendar: when a Team/Crew member marks themselves available on a date that has an event, the operator who owns that crew is **notified the person is free and can click to assign** them to the event. Landing "Availability" copy for Team and Crew now conveys this. **Build:** wire the crew-availability model to the operator's event staffing (surface free crew against event dates → one-click assign into `event_participants(role=crew)`). Intersects availability + `event_participants`; design before building.

## 19. Trade details are for signed-in industry, never the open web (2026-08-31)

**Decision.** A venue's **trade details** — `amenities`, `dealTypes`, `cateringNotes`, `accommodationNotes` — and a
performer's **`setups`** are **removed from the anonymous public profile payload**. They stay in the database, stay
fully editable by the profile's own team, and are meant for **signed-in industry**. Nothing else about the public
profile changes.

**`setups` was missed on the first pass and joined the withheld set later the same day.** The first pass named the
four venue fields, and the miss is worth recording rather than tidying away: the rule was written as a fact about
*venues*, so the search was for venue columns, and the performer's half of the same rule — which lives in
`profiles.details` jsonb, not in `venue_details` — was never looked at. **The rule is about TRADE INFORMATION, not
about rooms.** "Full Band, 7 people" is how an operator sizes the stage, the rider and the travel party before
offering; it is a negotiating fact for exactly the reason amenities and deal shapes are, and a fan does not book on
headcount. The public page rendered it as the About band's chips, and the app's Preview drew it too — so unlike
`cateringNotes` this one leaked in plain sight, which is the other way a disclosure survives review: everybody had
seen it, so nobody read it. **When applying this rule to a new field, ask whether the value is something the other
side of a negotiation would pay to know — not which table it lives in.**

**What stays public** (unchanged): `capacity`, `soundSystem`, `curfew`, `audienceLogisticsNotes` (public by name per
#16.7), location under the existing place-vs-performer address rule, and the rest of the profile — name, tagline,
bio, **all** the genres, photos, videos, social links and the bill. A performer's identity claim is `genres`, and
that is the field the public page leads with now that the line-ups have gone.
**What was already private and stays so:** `artistLogisticsNotes`, `contactEmail`, `contactPhone`, `billing`, payout
accounts.

**Why.** What a room throws in, which deal shapes it will sign, and how many people an act brings with it are all a
**negotiating position**, not audience-facing copy. Published anonymously they are handed to every competitor and
every scraper at the same time they are handed to the promoter they were meant for. `story.md` gives the venue-operator's boundary as running a room and booking it — not
publishing its commercial terms to the world — and **nothing in `story.md` ever backed the old rule**.

**This overturns a documented decision, and the previous rationale is worth naming so it is not re-adopted by
accident.** The old rationale lived in a serializer docstring (`apps/api/src/serialize/profile.ts`) and rested on
three things: a line in `packages/shared/src/venue.ts` saying deal types are "shown on its profile so a promoter
knows before asking"; migration 0010 treating amenities as the searchable half of "find me a room"; and the
marketing page already rendering both. **None of those is a product rule** — the first is a code comment, the second
is about search, and the third is a description of the status quo justifying itself. The docstring has been rewritten
to state this rule instead of the old one.

**A latent disclosure, now closed.** `cateringNotes` and `accommodationNotes` were on the wire and rendered by
**nothing** — `apps/marketing/src/profile.ts` parsed them and never drew them. A field that leaks with no visible
symptom is the one nobody notices coming back, which is why the regression test asserts on the payload rather than
on the page.

**Where the fields go instead — and what is NOT built.** There is today **no surface where a signed-in operator or
agent views a different profile**: every `/profiles/:id*` read is membership-gated, `/profiles/search` returns a thin
card with no venue details, and the only cross-profile view that exists is the anonymous marketing page. So the
"signed-in industry" half of this decision has **no home yet** and none was invented. Two consequences:
- The removal from the anonymous payload is implemented on its own — it is the safety-critical half and stands alone.
- The five are still served to the **owner's own Preview** (`GET /profiles/:id/public-preview`) as
  **`withheldDetails`** — `{ setups, venue }` — a **sibling** of `profile` rather than a field inside it. That
  placement is the safety argument: `profile` stays byte-identical to the anonymous body, so the existing "preview
  equals anonymous, field for field" assertion keeps holding and no trade field can reach the public projection by
  being "already in the preview". **One sibling, not one per family**, because there is one rule here and an owner
  should not have to know which sibling their kind of profile grew. The Preview draws both under an explicit
  **"Not on your public page"** heading (`WithheldNotice`), so the owner sees what they entered and that it is being
  held back.

**Follow-up, not built here:** a signed-in profile-viewing surface (an industry-facing venue/act page reachable from
search or a booking flow), gated through `authorize` on the viewer's principal — never on a query parameter or a
client-side flag. When that surface exists, `serializeWithheldProfileDetails` is what it calls.

**Enforcement.** At the **serializer**, not in the page: `serializePublicVenueDetails` no longer selects the four,
`serializePublicProfile` no longer reads `setups` out of `details`, and `PublicProfileSchema` has no slot for any of
them, so Fastify's response schema strips them even if a handler reintroduces them. Both halves of the double gate
were changed together. Two regression tests walk the anonymous route and assert, for each half, that the key is
`undefined` **and** that the serialized body contains none of the values — the second assertion is the one that
catches a field re-published somewhere other than where it used to live.

## 20. The hold pool is one queue per ROOM — shared reads, never shared writes (2026-08-31)

**The bug.** `loadSiblings` (`apps/api/src/routes/holds.ts`) keyed a hold pool on `(event_date,
venue_profile_id, stage_id)` and nothing else, so two operators pencilling the same room on the same night
landed in ONE ranked queue — and every cascade then wrote the whole queue. Proven live: a rival's hold
collided at rank 1 with an existing rank 1, and `POST /hold/confirm` would cancel another operator's pencil.
Disclosure was already handled (a rival's title is withheld); the problem was the WRITES.

**Decision — one queue, and fix the writes.** The shared ranking STAYS, because it reflects reality: one
physical room, one night, one show. Two operators competing for that date genuinely are in one queue, and
separate queues would tell both of them they are first in line. What changes is that **no operator may cancel,
reorder, demote or otherwise write to a hold they do not own.** When A's date is confirmed, rival holds are
released *as a consequence of the room being taken* — the venue's state changing — not by A reaching into B's
row. B is notified. **A is never the actor on B's record.**

**Reads did not widen.** A rival's title is still withheld. The "rivals are visible" option was explicitly not
chosen.

**The corollary — a hold with no room shares nothing.** `matchNullable` turns a null column into `IS NULL`,
and on two columns that silently pooled strangers together. The shared queue is justified *entirely* by there
being one physical room only one show can occupy; where there is no room and no night there is nothing to
share, so the null match was the bug, not the rule.
- **No `event_date`** → **no pool at all.** A hold is a claim on a date; without one it claims nothing. Every
  dateless hold in the database had been matching every other one.
- **No `venue_profile_id`** → **that host's own holds only.** The create-event wizard captures a free-text
  venue NAME, so its holds carry neither `venue_profile_id` nor `stage_id`; `IS NULL` put every unpinned hold
  on a date into one platform-wide queue, and taking "1st hold" from the wizard silently demoted a stranger's
  pencil in another city. An operator still cannot run two shows on one night, so their OWN unpinned holds
  keep queueing together. Without this the fix would have been *safe but unusable* — with enough unpinned
  holds on a date an operator could only ever take the bottom rank.
- **`stage_id IS NULL` under a real venue profile stays shared**, and should: that is one venue's unassigned
  room, and two operators pencilling it are competing for the same building on the same night.

**How each write changed.**
- `POST /hold/rank` — refuses with **409** when any move `computeRankShift` produces lands on a hold the caller
  lacks `event.edit` on. Refused whole, never half-applied: writing the caller's half and dropping the rest
  would leave two holds claiming one number, the same lie in the other direction. 409 rather than 403 because
  the caller IS allowed to rank their own hold — it is the pool's contents that refuse this number.
- `POST /hold/confirm` — the losing siblings are still cancelled (that is what one queue means), but as an
  **actor-less consequence**: a new `hold.released_room_taken` audit row and the `hold.lost` feed row are both
  written on the *released* event with no actor and `capability: null`.
- `POST /hold/decline` and `/hold/release` (`dropHoldAndRepack`) — a promotion keeps the caller's name only on
  a hold the caller may write (an operator's own queue closing up is their own housekeeping). On somebody
  else's row it is actor-less, plus a `hold.promoted_queue_closed` audit row — otherwise a write on a
  stranger's row left no trace on an event its own operator can read.
- **Direct** `POST /events/{another operator's hold}/hold/*` was already 404 (no `event.view`, no existence
  leak) on all five verbs; that is now regression-tested rather than incidental.
- There is **no hold reaper** in `apps/jobs` — nothing sweeps expiring holds, so nothing there writes a pool.

**The mechanism, so it is not re-derived.** `writeAudit` / `writeActivity` gained `actor?: "caller" | "system"`;
`"system"` writes no actor at all (both tables' actor columns were already nullable, so no migration). The
predicate is one helper, `writableHoldIds`, resolving `event.edit` per hold through the ONE authorization
module — not a host-id comparison, so a co-host with a real permission set is treated correctly. The winner's
own audit row still lists `cancelled: [...]`: that is A's act described accurately on A's own event, and it is
the only place a reader can see the cascade as one transaction.

**Client half.** `GET /events/:id/hold` now returns `canReorder` per pool entry (the caller's `event.edit` on
THAT hold — not derivable from `title === null`, which answers `event.view`). `useEventHold` offers only the
ranks that can actually be taken, mirroring `computeRankShift`'s intervals, so the refusal stops being a toast
the operator cannot act on. `apps/web/src/components/HoldPlacement.tsx` had documented the client/server
disagreement against itself and counted strangers into the operator's own queue; it now scopes the count to
the host, which needed `hostProfileId` declared on the events-LIST response schema (`serializeEvent` had always
returned it and Fastify was stripping it — the third field with that story).

### Still open after this — two product calls that were NOT decided here

1. **Does a rank confer first refusal?** `competingHoldIds` in `packages/shared/src/holds.ts` returns *every*
   sibling in the pool, unconditionally — it is deliberately a named function so this policy lives in one
   place, and the route pre-filters only the target out. So the act on a **2nd** hold can confirm and take the
   date out from under a **1st**, including a rival's. Under this decision that is coherent ("the room got
   taken"), but it means rank promises nothing and there is **no challenge/release flow**: the classic trade
   practice — a 2nd hold challenges the 1st, who gets 24–48h to confirm or release — does not exist in the
   model, and `hold_auto_promote` is about repacking after a drop, not about a challenge. Deciding this means
   deciding what a hold *promises*. **Do not build a challenge flow before it is decided.**
2. **`PATCH /events/:id` can move an event straight to `confirmed` with no cascade.** `UpdateEventBody` accepts
   `status`, and unlike `/hold/confirm` that path runs no pool logic: a date can be taken with no competing
   hold released and nobody notified. It writes only the caller's own event, so it is not a cross-tenant
   problem — it is an inconsistency between two ways of reaching the same state. Recorded, deliberately not
   fixed, because the answer depends on (1).

## 21. A settlement cannot open unless the deal is signed (2026-08-31)

**Decision, in the product owner's words:** *"A settlement cannot open unless the deal is signed."*
`POST /events/:id/settlement/compute` and `POST /events/:id/settlement/finalize` refuse with **409** while any
deal on the event is unsigned, and the refusal **names each agreement and what it is waiting for**.

**This rule is NEW and appears nowhere in the written record.** Neither PLAN.md nor this document said it, and
nothing enforced it: `reconcileEvent` happily reconciled an event whose deals were all still `draft`. The only
precondition anywhere on the settlement surface was `assertNotFinalized`, which is about the settlement's own
state, not about the agreements behind it. Per this repo's convention — later product decisions override
PLAN.md and live here — it lands as this entry.

### "Signed" means `agreement_status IN ('confirmed', 'signed')`

`agreement_status` runs `draft → sent → confirmed → signed`. The gate opens on **`confirmed`**, because that is
the state the product can actually reach: it is written by `confirmDealIfComplete` on exactly the rollup
`allSignatoriesConfirmed` computes — every non-`observer` `deal_parties` line carrying a `confirmed_at` — and it
is the transition that freezes `confirmed_snapshot`. "Confirmed" is not a weaker reading of "signed"; it *is*
every signature being in, recorded against the terms they were given.

**Requiring `signed` would have closed the product.** Nothing writes it: the only occurrences outside the gate
are `packages/db/seed.ts` and `seed-e2e.ts`, which stamp it by hand. A gate on it would have refused every
settlement of every event any operator has ever run — the same class of catastrophe as `33e5742`. It passes the
gate because it is strictly downstream of `confirmed` (#1 makes e-signature "a later meaning-upgrade to
`signature_hash`, zero schema change"), never weaker.

**It gates on `agreement_status`, not on `deals.status`, and the difference is load-bearing on reopen.**
Migration `0030` gave `deals.status` its first writer, and on this transition the two columns say the same
thing — but `POST /deals/:did/reopen` sets `agreement_status → 'sent'` while `status → 'draft'`. Two columns,
two values, one act. The agreement's own state machine is the thing the rule names, so it is the thing the gate
reads.

### Where the gate sits: the WRITE path, never the read path

The tension with PLAN.md is real and was resolved deliberately rather than papered over. PLAN.md's settlement
model is **"render shares live from tables; store an immutable snapshot only when a settlement is
*finalized*"** (PLAN.md:289, restated at PLAN.md:546), and #1 uses the same pattern for agreements. A
constraint on *opening* is a new constraint on a model designed to compute continuously — so it is confined to
the half of that phrase that writes.

The check is one call, `assertEveryAgreementSigned`, at the very top of **`reconcileEvent`** — the only function
that turns the event's spine into money, and the one both writing doors go through.

| Route | Gated | Why |
| --- | --- | --- |
| `POST …/settlement/compute` | **Yes** | This is "opening". It produces every figure and every transfer. |
| `POST …/settlement/finalize` | **Yes** | It re-derives through the same function and then freezes an *immutable* record with locked FX. Freezing what a party is owed under an agreement that is being renegotiated is precisely the record that must not be written. A rule enforced at one call site is enforced nowhere. |
| `GET …/settlements`, `GET /settlements`, `GET …/settlement/lines`, `GET …/settlement/planned-vs-actual` | No | Reads. Blocking one would contradict the live-render design and hide an event's money from the operator who most needs to look at it. A settlement that already exists is a fact; refusing to show it changes nothing and helps nobody. |
| `GET`/`POST …/settlement/comments` | No | The review conversation moves no money. Blocking a party from saying "this figure is wrong" at the exact moment their deal is being renegotiated inverts the point of the rule. |
| `POST …/settlement/status` | No | Already refuses when no settlement exists ("Run the settlement before sending it for review"), so it is downstream of the gated compute. Gating it again would take `dispute` away from a party mid-review. |
| `POST …/settlement/invitations` | No | Already requires a settlement row for the named party — downstream of compute for the same reason. |
| `POST …/settlements/:sid/confirm` | No | A party signing off figures that already exist. It moves no figures. |
| `PATCH …/settlements/:sid` (manual override) | No | 404s without an existing settlement row, so it too is downstream of compute; and the override is how an operator *corrects* a settlement the review pushed back on. |
| `POST`/`PATCH`/`DELETE …/settlement/lines` | No | Entering the night's actuals. They produce no figures on their own — the compute that would read them is the gated act — so gating here blocks real work for no safety gain. |
| `PATCH …/transfers/:tid` | No | Recording that cash physically moved. That is a fact about the world; refusing to record it would strand payments. |

**Ordering.** `requireEventCapability` runs first on both routes, so nothing here leaks an event's existence to
somebody without `event.view`. `assertNotFinalized` runs *before* the signature gate, so a finalized settlement
whose deal is later reopened still answers "finalized — the figures are locked", not "go and get a signature"
for a signature that would change nothing. And the gate runs **before `ensureSettlementLines`**: a refused
compute must not leave behind the settlement's copy of the budget, sealed away from the planner the operator is
about to go and edit. **A refusal writes nothing.**

### The rejected alternative, and why

The earlier idea was to **filter unsigned deals out of the maths and report what was dropped**. It was rejected,
and the reason is the whole point of the rule.

Dropping a deal pays its performer **zero** while `Σ net = 0` still holds *perfectly*, because the operator's
line is the residual and silently absorbs the missing entitlement. Nothing in the figures says an agreement went
missing. **A refusal at the door is legible; a zero inside a settlement that balances is not.** The point of the
rule is that the failure never arises.

This was measured, not asserted. Flipping the engine's own clause to `eq(status, 'confirmed')` turned **33 of
`settlement.test.ts`'s 76 tests** red, every one of them the same way — `expected '0' to be '300000'`, with
transfer lists arriving empty. That is the failure mode, reproduced.

### The four cases

1. **An event with no deals at all → NOT blocked.** A show with only budget lines — an operator reconciling
   their own door and their own costs — has no agreement to wait for. Refusing it would make the settlement
   unreachable with no action that opens it. story.md has the operator taking the residual; with nobody else
   entitled, the residual is the whole pool.
2. **Several deals, some signed → ALL must be signed.** They are reconciled into one `Σ net = 0`; a
   partly-agreed night has no correct set of figures. The refusal lists every outstanding one, not the first.
3. **A cancelled deal → does NOT block.** It is withdrawn, and `reconcileEvent` already entitles nobody under it
   (`ne(status, 'cancelled')`). The gate is handed *the rows that clause returned*, so the set that must be
   signed is by construction the set the engine will settle — the two cannot drift.
4. **A reopened deal against an existing settlement → the FIGURES freeze, and nothing else does.** `reopen`
   clears every confirmation and puts the agreement back to `sent`, so from that moment compute and finalize
   refuse. Everything that is not the arithmetic carries on: reading the settlement, commenting on it, raising a
   dispute, signing off a line, and marking a transfer paid. The stored breakdowns stay byte-for-byte what the
   last compute wrote. **The way out is the act the reopen was for** — re-sign the agreement, or withdraw it —
   and the 409 says so by name. This is correct rather than merely tolerable: recomputing money under terms
   that are, by the operator's own act, being renegotiated is exactly what should wait.

**One deliberate carve-out.** A deal whose parties are *all* `observer` is skipped. `allSignatoriesConfirmed`
returns false on an empty signatory list by design, so such a deal can never reach `confirmed` and would shut
the settlement permanently with no action that reopens it. It also entitles nobody (the engine pays `payee` and
`split_member` lines), so skipping it cannot let money move under an unsigned agreement.

### The refusal, and the client

> `This settlement cannot open until every agreement on the event is signed: "Band guarantee" (‹uuid›) is
> waiting on 2 of 2 signatures. Send each agreement and have its parties confirm it — or cancel one that is no
> longer happening — then run the settlement again.`

**409, not 403.** The caller may absolutely run this settlement — `settlement.edit` is a pool capability the
ceiling gives only to host/co_host. It is the event's state that refuses, which is what `assertNotFinalized` and
"Only a sent agreement can be confirmed" both mean by a conflict.

**It names the deal**, because an operator staring at a 409 has to know which agreement and what it is waiting
for, or the settlement is unopenable with no diagnosis — the failure `unsettlableLine` exists one layer down to
prevent. This discloses deal names to a caller who may not be a party to every deal, the same trade
`unsettlableLine` already makes with settlement-line labels, and for the same reason: the person running the
night's reconciliation is the person who has to go and chase the signature.

**The web app stops offering buttons that would always fail.** `useEventSettlement` derives one
`unsignedAgreementsNotice` sentence from the (party-scoped) deals list, and the settlement screen disables "Run
the settlement", **"Finalize"** and the actuals card's "Recalculate" while it is non-null, printing it beside
them. Finalize matters as much as compute here: it was the most dangerous-looking button on the screen doing
nothing at all. "Send for review", "Add revision", "Flag a dispute" and marking a transfer paid stay live,
because none of them is gated. Disabled and explained rather than hidden — and because the deals list is
party-scoped the notice is a lower bound, so the server keeps the last word.

## 18. Claiming an invited account: prove the address, then use whichever you like (2026-09-01)

**Decided by Daniel, resolving a conflict between the code and Ran's invitation spec.** His words: *"The email
must verify it. So some type of OTP. But they should be able to change the email."*

**The conflict.** `assertInvitationRecipient` required the signed-in Firebase address to EQUAL the invited one,
and `docs/off-platform-access.md` made that the platform-wide rule. It is airtight and it is unusable in the
case the product is for: a venue is invited at `info@`, and the person who runs it has their own account. Ran's
spec went the other way — *"the invitee can sign up with whatever email they prefer"* — which makes the link the
only credential and hands the account to whoever it is forwarded to.

**The rule.** Control of the invited address is proved ONCE, with a one-time code mailed to it
(`POST /invitations/:token/claim-otp` → `invitation_otps`, migration 0033). The account that then takes ownership
may be any address, as long as Firebase says it is verified. This is *stronger* than what Ran asked for — a
forwarded link alone is not enough, because the code went to the original address — and *more usable* than what
it replaced.

**Scope: claim only.** `accept` and `decline` still go by the signed-in address. They are small, reversible-ish
grants; a claim hands over ownership of a whole profile and everything it participates in, and it is the only one
worth a second factor.

**And the invited address is told what happened.** A "claimed by [name] on [date]" email goes to the original
recipient on every claim, not only event-linked ones. Ran filed this under transparency; since the claimant's own
address may now differ, it is also the only message that address ever gets about the account it was offered.

## 19. Unclaimed stub accounts are erased at 90 days, but their names stay on the bill (2026-09-01)

**Decided by Daniel:** *"Every unclaimed stub over 90 days. But it should keep the names in the events, not as
accounts but just as a name / contact, so it doesn't break the events."*

Wider than Ran's spec, which scoped the deletion to invitations that were never accepted. Every unclaimed stub
goes, whatever created it, because an invitation still `pending` after three months is not a live conversation.

**What survives is one field.** `event_participants.profile_id` became nullable and the row gained
`display_name` (migration 0032), so the participant row outlives its profile: the account, the membership and
the email are gone, and a settled show still names who played it. `events.venue_name` does the same job for a
handoff stub.

**What the purge refuses to do.** It skips — and reports — any stub that hosts an event, owns a share or a
private budget, or filed a performing-rights report. Those are records we have no business destroying on a timer,
and a skip is reported rather than counted, because a skipped stub is a profile still holding somebody's email
past its retention date.

## 20. The collaboration-invite cap applies to performers only, and refills on any response (2026-09-01)

**Decided by Daniel.** Ran's spec: 20 credits, +1 per **accepted** invite, declined and expired do not refill.
Daniel: *"It's a cap based on response. So when they get a response they get 1 back."*

- **Performers only.** Venues are uncapped in the spec because curating a roster is its own quality filter;
  agents and crew were left uncapped too, by reading the spec literally. An agency doing volume outreach is the
  obvious candidate for the next revision — noted, not assumed.
- **External invitations only.** Inviting somebody who already has a shoWMe account is collaboration, not
  outreach, and charging for it meters the wrong thing.
- **Accepted OR declined refills; expiry does not.** The cap defends against invitations fired into the void, and
  somebody taking the time to say no is the opposite of that. Silence is the thing being metered.
- **No upgrade prompt at zero.** A plain `forbidden`, not `entitlement_required`, because there is no performer
  PRO to sell yet: *"Potentially we could offer a non-cap pro version when we build the pro for performers."*

Consequence worth stating: because a refill only ever follows a spend, the balance can never exceed the
allowance, so "20 credits" means **20 unanswered invitations at a time**, not 20 for all time.

## Still-open product calls (not yet decided)

- ~~**Event start/end mechanism (#16.4)**~~ **RESOLVED 2026-08-02 (see #16.4):** explicit required
  `event_start_time`/`event_end_time` columns = the PUBLIC start/end (authoritative value), each **bound to a
  schedule item whose label is editable-but-revertible**; default schedule seeded from the old app. Chosen over
  "flag a freeform item" because the value must always be the real, machine-findable canonical time regardless of label.
- ~~**RSVP consent granularity (GDPR)**~~ **RESOLVED 2026-08-02 — SEPARATE per-recipient consent (verified):** the
  venue and the artist are **independent controllers**, so sharing needs **separate, unchecked, purpose-specific
  opt-ins** — one per recipient ("share my details with [Venue]", "…with [Artist]"), **not** a single combined box.
  Rules: no pre-checked boxes; consent **unbundled** from the RSVP action itself and from ToS; the privacy notice
  **names each recipient + purpose + retention**; always **revocable** (marketing opt-in, ~1yr, opt-out any time).
  Platform *storage* is a **separate lawful basis** (shoWMe as processor/its own controller for the RSVP record) —
  don't fold it into the sharing consent. Joint-controller route (one combined arrangement) applies **only** if venue
  + artist jointly organise the event — not shoWMe's default independent-capture model; if it ever arises, take legal
  advice. Sources: ICO/GDPR guidance via [splashthat](https://splashthat.com/blog/gdpr-consent-event-rsvp-form),
  [guild.co](https://guild.co/blog/how-can-event-organisers-give-delegate-data-to-sponsors-and-be-gdpr-and-pecr-compliant/),
  [termsfeed](https://www.termsfeed.com/blog/gdpr-compliance-events-attendee-lists-name-tags/). Cross-ref `docs/gdpr.md`.
- ~~**Sub-hire visibility**~~ **RESOLVED (see #4):** sub-hire = an ordinary deal + agreement; pure party-scoping —
  only the sub-hire's parties see it (operator not a party → invisible; operator still sees the crew *person* as a
  participant). %-of-cut still needs the one-level nested-entitlement pass in settlement (deferred); a guarantee
  sub-hire is trivial (no engine change). The locked "no intra-band splits" (§182) applies to *band members* (seats),
  not freelancer sub-hires.
- ~~**Co-operator transparency realization**~~ **RESOLVED: BOTH** — `observer` `deal_parties` for *targeted*
  one-off sharing **and** a **shared-budget rule** (co-operators see all deals assigned to the shared budget) for
  the *blanket* co-operator tier.
- ~~**Team sharing scope**~~ **RESOLVED: shareable to collaborators** (the "Shared Team" model) as well as kept
  private ("In-house"). Needs `teams(id, owner_profile_id, name)` + `team_members` with an explicit share to other
  profiles/collaborators; adding a team to an event fans out into `event_participants(role=crew)`.
- ~~**Setlists**~~ **RESOLVED:** it's a **workflow module**, not just royalty jsonb. Core consumers are
  **performer** (authors) + **operator** (report). **"Setlist"** (performer authors) = `setlists` table.
  **"Setlist Report"** (operator) = the filing *derived from* the setlist, sent to a PRO — `setlist_reports` table
  (replaces `pro_reports`; dodges the `team_and_crew`/"pro" collision; keeps `pro_code[stim|gema|prs|…]` recipient +
  royalty estimate fields). **Crew are NOT a core consumer** — only a lighting op on a cued show occasionally wants
  it, handled by *optionally sharing* the setlist to that crew participant (observer/party-scoping). Crew's real
  run-of-show is the **schedule + tech docs** (input list, stage plot, rider), not the setlist.
- ~~**Consolidation ambiguities**~~ **RESOLVED:** `settlement_approvals` + `settlement_snapshots` **KEEP standalone
  tables** (versioned revisions wanted). `crew_details` **folds into `event_participants.details jsonb`** (unless
  queried across).
- ~~**Deal naming**~~ **RESOLVED:** default = entity/person (folded into `deals.name`).
- ~~**Paper-only agreements**~~ **RESOLVED:** allowed = a deal with **`NULL structure`** (folded into `deals`).
- ~~**Financial Projections**~~ **RESOLVED:** a **view over budget (projected income) + settlements (realised
  income)** — projected vs realised. No new model/table; reporting layer only.
- **Does a hold rank confer first refusal? (see #20)** — `competingHoldIds` cancels every sibling regardless of
  rank, so a 2nd hold can confirm over a 1st. No challenge/release flow exists. Decision needed, not yet made.
- **Two ways to reach `confirmed` (see #20)** — `PATCH /events/:id` sets the status with no pool cascade and no
  notification, where `/hold/confirm` runs the whole queue. Depends on the call above.
- **[DEFERRED — payments phase] Who bears the FX spread** — Stripe converts at its live rate + ~2% fee, ≠ the
  settlement's locked rate. Recommend **payer/operator absorbs** (deal is denominated in the payee's currency);
  record actual-paid vs settlement-expected. See `docs/money.md` + `docs/payments.md`. Decision needed, not yet made.

## Related docs
- `PLAN.md` — the blueprint (single source of truth for everything not overridden here).
- `docs/design-brief.md` — per-role visibility + screens, for the design pass.
- `docs/payments.md` — full payments architecture (deferred build).
- `docs/off-platform-access.md` — links/OTP/shares/claim (decision #6).
