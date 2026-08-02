---
name: data-model
description: The Postgres relational schema for the shoWMe rebuild — the ~42 tables, the event/deal/settlement spine, and the normalize-vs-jsonb rule. Use when designing or changing database tables, the Drizzle schema, or migrations.
---

# Data model

Full schema in [PLAN.md](../../../PLAN.md) → "Full relational data model" + "Table consolidations". This is the map.

## The spine (memorize this)
Two hubs — **`profiles`** (every actor: operator / performer / professional) and **`events`** (the container) — joined by:
- **`profile_members`** — users ↔ profiles (role: owner/admin/editor). Also absorbs the old non-user "team" directory (nullable `user_id`).
- **`event_participants`** — profiles ↔ events (event-role + `permission_set_id`). **This replaces the entire Firestore `accessUids` fan-out.**

Money is three pairs:
- **`deals` + `deal_parties`** — party-scoped agreements (1..N parties, kind-agnostic).
- **`budgets` + `budget_lines`** — revenue & cost lines with `collected_by` / `paid_by` / `payee_participant_id` / `deal_id`.
- **`settlements` + `settlement_transfers`** — one settlement per participant; "who owes whom".

**Access is a JOIN** across `profile_members → event_participants (→ deal_parties)`. Never a denormalized array.

## The one rule for adding tables
> **Normalize what you filter / join / aggregate *by*; embed (`jsonb`/columns) what's always read *with* its parent and never queried across.**

Kept normalized (queried across): `event_participants`, `deal_parties`, `budget_lines`, `settlements`/`transfers`, `profile_members`, `profile_locations`, `venue/performer/professional_details`, `spam_flags`.
Folded into parents as `jsonb`: profile social links / media / custom roles, `crew_details`, agreement reopen, `share_recipients`, `contact_persons`, etc.

## Modules (~42 tables, build in this order)
1. Identity — users, profiles (+ media/locations/social + type `_details` extension tables), profile_members, capabilities-as-code, `permission_sets`
2. Events — events, event_participants, stages
3. Deals — deals, deal_parties
4. Budget & settlement — budgets, budget_lines, settlements, settlement_transfers, settlement_comments/approvals/snapshots
5. Event content — riders, crew (participant role=crew + crew_details), agreements (+confirmations/reopen), schedule_items, event_messages, pro_reports, holds (columns on events)
6. Monetization — plans, plan_history→audit, credit_ledger
7. Invitations (unified) & contacts
8. Inbound — booking_requests (public form / performer offer / venue handoff)
9. Sharing — shares, share_otps
10. Comms & misc — notifications, activity_log, audit_log, calendar_items, tasks, templates, unavailability, admin_alerts, audience_rsvps, files, fx_rates_cache

## Watch-outs
- **Currency lives on the money:** `events.base_currency`, `deals.currency` (payout), `budget_lines.currency`. Settlement reconciles in base with a **locked FX** rate; display FX is separate/cosmetic.
- **Crew forward-compat:** crew are `event_participants` (role=crew) → a `professional` profile; giving them deals/agreements later is additive (kind-agnostic FKs), no migration.
- **Files:** bytes in Firebase Storage; metadata in a `files` table (path, not URL); access via API signed URLs.
