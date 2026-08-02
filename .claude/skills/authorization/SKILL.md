---
name: authorization
description: The shoWMe authorization engine — ReBAC via Postgres joins, permission sets, the field-level serializer, and the separate entitlement layer. Use when adding access control, gating a route/resource, or debugging "who can see/do X".
---

# Authorization engine

Full design in [PLAN.md](../../../PLAN.md) → "Authorization engine". Deny-by-default, computed **per request via joins** —
no denormalized `accessUids` arrays, no custom claims. One module; never split auth across layers.

## Two functions
- **`authorize(principal, capability, resource)`** → allow / deny — *can you do this?*
- **`serialize(resource, capabilities)`** → redacted payload — *what subset do you get back?* (closes the old client-only-hiding gap)

## Principal (resolve once per request)
Verify Firebase token → `uid` (JIT-create `users`). Load memberships as a **flat SQL set**:
`SELECT profile_id, kind, role FROM profile_members WHERE user_id = uid AND status='active'`.
Flat set = owned + member-of together → **no slot-collision, no owner-only-query bug**. Acting profile via `X-Profile-Id` header (validated ∈ memberships). No profile cap (that was a JWT-claim-size artifact).

## Standing on a resource = one indexed join
`event_participants ⋈ profile_members ⋈ permission_sets` where `event_id` + `user_id`. A user may reach an event via several
participants → **effective capabilities = union**, each row's caps first filtered by profile role.

## Two-layer composition
`effective_capabilities = ⋃ role_filter(permission_set.capabilities, profile_role)`
- **Permission set** (on participant) = *what the event-role may touch* (modular, data-driven `capabilities text[]`).
- **Profile role**: `editor` strips financial-edit + management capabilities; `owner`/`admin` keep the full set.

## Representation fan-out (agents — delegation, NOT an override)
Decisions #14. A **representation** (a standing agent↔performer regional agreement, its own table) is to an agent what a
**group** is to crew: on the performer's **in-region** events it **fans out** into `event_participants` — the **agent**
gets a participant with negotiate/approve capabilities, the **performer's** participation is flagged **delegated**
(view-only permission set). The agent reaches the event the **normal** way (a participant); authority is an ordinary
permission set under the composition above — **no special traversal, no subtractive rule.** The performer's read-only is
**delegation, not revocation**: by both-party consent they delegate *action* capabilities (confirm/approve) to their
agent for in-region events and keep their **view** floor.
- **Region match** = event venue location ∈ `representation.region` (country-level). Scope: in-region events/deals only.
- **INVARIANT — per-deal resolution, not an event grant.** The agent participant row is only the **reachability edge**; a
  given deal's authority resolves via the `(agent, that deal's performer)` representation. So **one agent row can
  represent several performers** on one event (authority scoped to each represented performer's deal / split-line), and
  agented + self-managed performers coexist on the same split deal. Never a blanket event-level grant.
- **Participant ≠ financial visibility:** operator sees the agent as negotiator (realistic) but never the commission —
  that's a separate, private **representation-scoped settlement** (`settlements.representation_id`), so the event's
  `Σ net = 0` view has no hidden term. Agent-as-payee = a payout **destination** (`representation.agent_collects`),
  resolved **per entitled `deal_party` line** (not a separate entitled party) — see the settlement skill.

## Preset permission sets → the transparency tiers
`operator_full` (host **and** co-promoters: everything incl. `*.view.all`, `budget.view`, `settlement.finalize`) · `performer` (`deal.view.own`, `settlement.view.own`, `settlement.confirm`, `rider.submit`, `schedule.view`) · `crew_schedule_only` · `view_only`.

## Field-level serializer (the security fix)
After a read is authorized, **shape the payload by capabilities**: omit `budget` unless `budget.view`; return only the viewer's
own `deal_party` unless `deal.view.all`; settlement shows only their slice. Server-side, in the response — not UI hiding.
Party-scoped resources (deals/settlements): `*.view.all` → all rows; `*.view.own` → JOIN to the caller's `deal_party` / the settlement's `participant_id`.

## Entitlements are SEPARATE (billing ≠ permission)
`canUseFeature(profile, feature)` **fresh-reads `plans`** and computes limits by **`COUNT()`** (event cap in 365d, monthly offer
cap, spam-suspension via `COUNT(DISTINCT reporter in 90d)`, admin-grant → paid plan). Composed at the route **after** `authorize`.

## Two coarseness levels
Account **kind** gates whole feature surfaces (a performer never sees "create event"); the **serializer** redacts within shared features.

## Naming
`authorize(capability)` not `authorize(cap)`; `capabilities` not `caps`. Full words.
