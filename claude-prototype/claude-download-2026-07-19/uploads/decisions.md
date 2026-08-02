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
  `settlements`): a `version` (or `updated_at`) column; a stale write is **rejected** ("someone else changed this,
  reload") — never a silent overwrite (lost-update).
- **Idempotency keys** on every mutating/money endpoint (Pay-All, transfers, mark-paid, finalize, settlement
  compute): an `idempotency_keys` table maps key → stored result; a replay returns the same result instead of
  re-executing. Pass idempotency keys through to Stripe; **dedup provider webhooks** by event id.
- Consistent mechanisms, not a rework: a `version` column + an `idempotency_keys` table.

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

## 12. Membership & groups (roster, roles, seats)

- **Members** = users (or off-platform contacts) added to a profile; a user can be a member of **many profiles**
  (per-profile role). `profile_members.role[owner|admin|editor|viewer|crew]` + `seat_consumed`.
  - **admin = OWNER-LEVEL** operational access, **minus owner-only** actions reserved to the owner: **billing/plan,
    delete profile, transfer ownership**. Admin **consumes a seat** (`plans.seats`; ties to the
    `grant_admin`-needs-paid-plan gate). `editor` (edit, not financials/members) / `viewer` (read) / `crew`
    (event-assigned, own slice) are **free**. `user_id` NULL = off-platform contact (invitable → claim).
- **Groups** = reusable member bundles, **owned at the user/org level** (`groups.owner_user_id`) and **cross-profile**
  (`group_profiles` — a group serves many profiles); a user can be in many groups. Adding a group to an event fans
  out crew into `event_participants(role=crew)`, referencing each member's **own identity** (not a copy).
- Three layers: **member (roster) → group (bundle) → participant (event assignment)**.
- **Refines PLAN.md:** `profile_members.role` gains `viewer`/`crew` + `seat_consumed`; the earlier single-profile
  `teams` stub → `groups`/`group_members`/`group_profiles` (user-owned, cross-profile). Authorization composition
  (#4) unchanged — profile role is the "how much" tier; admin strips nothing bar owner-only.

## 13. Riders — profile-level library + event instances (reuse / auto-populate)

- `riders` gains **profile scope**: a performer/venue keeps a reusable **library** (`owner_profile_id` set,
  `event_id` NULL) — standard tech / hospitality / stage_plot / input_list riders.
- **Event instances** (`event_id` + `owner_participant_id`) are **copied** from a library rider (`source_rider_id`
  back-pointer) — snapshot on attach, so master edits don't retroactively change past/locked events.
- **Auto-populate:** `is_default` library riders one-click-add (or auto-attach) when the owner becomes an
  `event_participant`. **Kind-agnostic** (venues/professionals too).
- Uses `file_id → files` (the canonical registry) instead of inline `file_url`/`file_name`. (The file-storage
  section already anticipated "rider templates" under `profiles/{id}/documents/`.)

## 14. Agents & representation (4th account kind · fan-out into participants · representation-scoped settlement)

A booking **agent** is a first-class role, not a variant of the existing three. Industry meaning: an agent secures
live work and **negotiates on behalf of** a performer, for a **commission on gross live/deal income** (never
merch/publishing).

- **New `kind = agent`** alongside `operator | performer | professional`. Distinct dashboard (roster, negotiation
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

---

## Still-open product calls (not yet decided)

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
  (replaces `pro_reports`; dodges the `professional`/"pro" collision; keeps `pro_code[stim|gema|prs|…]` recipient +
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
- **[DEFERRED — payments phase] Who bears the FX spread** — Stripe converts at its live rate + ~2% fee, ≠ the
  settlement's locked rate. Recommend **payer/operator absorbs** (deal is denominated in the payee's currency);
  record actual-paid vs settlement-expected. See `docs/money.md` + `docs/payments.md`. Decision needed, not yet made.

## Related docs
- `PLAN.md` — the blueprint (single source of truth for everything not overridden here).
- `docs/design-brief.md` — per-role visibility + screens, for the design pass.
- `docs/payments.md` — full payments architecture (deferred build).
- `docs/off-platform-access.md` — links/OTP/shares/claim (decision #6).
