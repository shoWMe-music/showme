# shoWMe — Agent representation: data model & flow

A focused walkthrough of how a booking **agent** represents a **performer** — the tables involved and the
step-by-step flow of entering an agreement. This is the *how it works* companion to the decision record
(`docs/decisions.md` #14) and the purpose/boundary layer (`docs/story.md`).

---

## Data model

The whole feature is **one new table** plus reuse of the existing spine — no bespoke machinery.

### New table — `representations` (the standing agent↔performer agreement)

```
representations(
  id,
  agent_profile_id      → profiles,          -- the agent (a kind=agent profile)
  performer_profile_id  → profiles,          -- the performer they represent
  region                (ISO country codes),  -- territory, country-level
  is_worldwide          bool,                 -- covers everywhere
  commission_rate       (basis points),       -- e.g. 1000 = 10%
  commissionable_basis,                        -- which deal income counts (guarantee/ticket/split/escalator/bonus;
                                               --   NOT merch, extras, or reimbursed expenses)
  agent_collects        bool,                 -- agent is the default payout destination?
  proposed_by[agent|performer],                -- who made the CURRENT offer (either side can initiate + propose)
  status[proposed|active|terminated],
  starts_at, ends_at,
  confirmed_by_agent,                          -- symmetric two-party handshake…
  confirmed_by_performer,                      -- …both required before status → active
  terminated_at, terminated_effective_at, terminated_by
)
-- CONSTRAINT: one ACTIVE agent per performer per region (active regions must be DISJOINT)
```

**Symmetric by design.** The two `confirmed_by_*` fields don't care who started — so the relationship works **both
ways**: an agent can invite a performer, or a performer can invite an agent, and either side can propose (or counter)
the terms. `proposed_by` just records who made the current offer.

### Existing tables it leans on (unchanged, except one nullable FK)

| Table | Role in representation |
|---|---|
| `profiles` | Both agent and performer are `profiles` rows (`kind=agent`, `kind=performer`). The representation is two FKs into this table. |
| `event_participants` | Where the agreement **projects** onto events. `role` gained an `agent` value. The agent gets a participant row on the performer's in-region events (the *fan-out*). |
| `deals` / `deal_parties` | The per-event **performance agreements** the agent negotiates on the performer's behalf. Unchanged — the agent confirms the performer's own `deal_party` line. |
| `settlements` | **One nullable FK added:** `representation_id`. A settlement is scoped by *exactly one of* `participant_id` (normal event settlement) **or** `representation_id` (the private agent↔performer commission settlement). |

**Shape:** `representations` is the **contract**; `event_participants(role=agent)` is its **projection onto an
event**; `settlements.representation_id` is its **private money leg**.

---

## Logical flow — entering an agreement (works both ways)

Either party can initiate. Below, **PROPOSER** = whoever sends the first offer (agent *or* performer);
**COUNTERPARTY** = the other side. The steps are identical whichever way round it is.

```
  PROPOSER                      SYSTEM                        COUNTERPARTY
  (agent OR performer)            │                        (the other party)
   │                              │                                │
   │ 1. invite + propose terms    │                                │
   ├─────────────────────────────►│                                │
   │   (region, rate, collect)    │ insert representations row     │
   │                              │ status=proposed                │
   │                              │ proposed_by=<proposer>         │
   │                              │ confirm <proposer's side>=now  │
   │                              │                                │
   │                       2. overlap check                        │
   │                              │ reject if an ACTIVE region     │
   │                              │ for this performer intersects  │
   │                              │                                │
   │                              │ 3. show offer ────────────────►│
   │                              │                                │
   │                              │   3a. ACCEPT ◄─────────────────┤
   │                              │   confirm <their side>=now     │
   │                              │   BOTH set → status=active     │
   │                              │                                │
   │                              │   3b. COUNTER ◄────────────────┤
   │◄─────────────────────────────┤   edit terms                  │
   │   (now proposer's turn)      │   proposed_by=<counterparty>   │
   │                              │   CLEAR proposer's confirm     │
   │                              │   (loop to 3 until both agree) │
   │                              │                                │
   │         4. fan-out onto in-region events                      │
   │            event_participants(role=agent, negotiate/approve)  │
   │            performer participation → view-only (delegated)    │
   │                              │                                │
   │  5. agent negotiates/confirms performer's deal_party lines    │
   │     commission settles privately (settlements.representation_id)
```

1. **Invite + propose.** On the **Agents & Performers** page, the proposer (agent inviting a performer, *or*
   performer inviting an agent) creates a `representations` row: `status='proposed'`, `proposed_by=<proposer>`,
   the proposer's own `confirmed_by_*` set to now, the other left `NULL`, with the terms (`region`,
   `commission_rate`, `agent_collects`). It does nothing yet. *(Off-platform counterparty → reuse the existing
   invitation/stub-profile mechanism, #6.)*

2. **Overlap guard.** Before activation, the disjoint-region constraint checks there's no existing **active**
   representation for this performer whose `region` intersects the proposed one. One agent per performer per
   territory.

3. **Counterparty responds (the handshake).** The counterparty sees the offer on *their* Agents & Performers page
   and either:
   - **3a. Accepts** → their `confirmed_by_*` set to now. With **both** confirmations present, `status → 'active'`.
     This two-sided handshake **is** the agreement — neither party can bind the other alone.
   - **3b. Counters** → edits the terms, which re-stamps `proposed_by` to them and **clears the original proposer's
     confirmation** (the new terms must be re-confirmed). Now it's the original proposer's turn to accept or counter
     back. Loop until both sides have confirmed the *same* terms. The counter history is the `audit_log` (#2) — no
     separate offers table.

4. **Projection (fan-out).** Once active, for the performer's events whose **venue country ∈ region**, the
   representation fans out (like adding a group to an event): an `event_participants(role=agent)` row appears with
   **negotiate/approve** capability, and the performer's own participation is flagged **view-only** (delegation by
   consent — they keep their view floor, hand over the *action* capabilities).

5. **Act & settle.** The agent negotiates and confirms the performer's `deal_party` line on each in-region
   performance deal — acting *as* the performer. Commission never touches the event settlement: a **separate**
   `settlements` row (`representation_id` set) reconciles agent↔performer for
   `commission_rate × commissionable income`, private to the two. If `agent_collects`, the agent is the payout
   **destination** on the performer's event settlement (performer stays the entitled party), and this private
   settlement reconciles the difference back.

6. **Termination.** Either party sets `terminated_effective_at` and `status → 'terminated'` — unilateral, no forced
   notice. Deals already **confirmed** while active keep their commission; open ones revert to the performer.

**Summary:** (either party) invite + propose → overlap-check → accept **or** counter until both agree → active →
fan-out onto in-region events → private commission settlement. The agreement is the `representations` row; going
"active" is the two-confirmation handshake on the *same* terms; everything after is projection and reuse.
