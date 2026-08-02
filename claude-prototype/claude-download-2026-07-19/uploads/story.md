# shoWMe — Story & domain context

This is the **why** layer. `PLAN.md`, `docs/decisions.md`, and the skills describe *how* shoWMe works — tables,
math, authorization rules. This doc describes what each actor is *for*, and — the load-bearing part — **what each
actor is *not*.**

The boundaries here are **deliberate product decisions, not gaps to be filled.** When a rule isn't written down
elsewhere, infer it from the purpose and boundary stated here — **not** from what's merely adjacent or conventional
in the industry. (World knowledge tells you what a booking agent generally *is*; only this doc tells you what shoWMe
*decided* it is — and where we drew the line.)

---

## The domain in one paragraph

shoWMe is **booking + settlement** for live events. Someone **runs** a show, **talent** performs, **crew/services**
make it happen, and at the end the **money is split** — "who owes whom," reconciled to zero. The **event** is the
shared object where every party meets; each person sees only **their slice** of it. The two hard problems shoWMe
solves are (1) getting parties to agree on terms — the **deal** — and (2) reconciling the cash afterward — the
**settlement**. Everything else serves those two.

---

## The account kinds — purpose · boundary · why

A **kind** is fixed per account and decides the entire app the user sees. A **role** is per-event. Identity is stable
underneath both: the same person may hold different kinds in different accounts, and the same profile may play
different roles in different events.

### Operator — runs the show
- **Purpose.** The party producing and managing an event — a **venue, promoter, organizer, or festival**. They book
  the talent, plan the budget, host the event, and run the settlement. Economically they take the **residual** (what
  remains after everyone else's entitlements), so they carry the upside and the risk.
- **Boundary.** "Operator" is a **per-event role, not a fixed identity** — the same venue is the operator in a show
  it runs and an arm's-length **rental** party in a show someone else runs. Operators are **not** granted
  see-everything god-mode; their broad visibility is *emergent* from being a party on the event's deals and sharing
  the budget, not a special permission.
- **Why.** The residual and the authority to set terms belong to whoever bears **this** event's risk — which changes
  per event, so it can't be baked into the account.

### Performer — the talent
- **Purpose.** The act being booked — a **band, DJ, or solo artist**. They receive offers, negotiate their deal,
  perform, and get paid. Their world is "my bookings, my availability, my riders, my money."
- **Boundary.** A performer sees **only their own slice** — never the event budget/pool or other parties'
  financials, even within a shared event and even if an operator *wanted* to show them (an inviolable ceiling). A
  performer promoting their own show is wearing an **operator** role for that event, not stretching the performer
  kind. Their **merch and broader career are theirs** — not the operator's, and (see Agent) not their booking
  agent's.
- **Why.** The whole product is "you see your slice"; the performer is the canonical slice-holder.

### Professional — the crew / service
- **Purpose.** Freelance crew and services that make the event happen — **sound, lighting, catering, security,
  stage**. Paid a **fee for labor**. Also a marketable service identity (the future professionals marketplace, where
  operators/performers post jobs and professionals apply).
- **Boundary.** A professional is **not** an employee of the operator and **not** talent. They're an arm's-length
  service provider paid a **fixed fee** — contrast the **agent**, who takes a *percentage of someone else's income*.
  "Crew" is the event-role; "professional" is the account kind. They see the schedule and their own deal, never the
  budget.
- **Why.** Labor-for-fee, not entitlement-to-the-pool — which is why a professional's pay is a simple deal, not a
  share of the reconciliation.

### Agent — represents the talent
- **Purpose.** A **booking agent** who represents performers. They secure live work and negotiate deals **on the
  performer's behalf**, within an agreed **territory**, for a **commission on gross live income**. They act *through*
  the performers they represent: on in-region events the agent negotiates and confirms while the performer's own
  screens go read-only, and the agent may collect the fee on the performer's behalf.
- **Boundary — the load-bearing one: a booking agent, *not* a manager.** shoWMe's agent handles **live bookings
  only** — **not** publishing, **not** record deals, **not** career management, **not** merchandise. Commission is on
  **live/deal income** (guarantee, ticket/door split, escalators, bonuses) and **never** on merch or non-live
  revenue. Agents represent **arm's-length** performers who keep their **own accounts** — this is *not* an agency
  running its artists' profiles (that's ordinary multi-profile membership). The commission is **private** between
  agent and performer: the operator deals with the agent as the negotiator but never sees the cut.
- **Why.** An agent is compensated for **closing live deals** — that's the job. Manager scope (records, publishing,
  career, merch) is a different product we **deliberately don't serve**; the exclusions aren't limits to "fix," they
  are the *definition* of the role. Keeping representation arm's-length preserves the performer's ownership of their
  own identity and out-of-region work. Full mechanics: `docs/decisions.md` #14.

---

## How they meet: the event

An **operator** runs an event and books a **performer** — directly, or through that performer's **agent**.
**Professionals** are brought on as crew to deliver it. Terms are captured as **deals**; the money is reconciled as
**settlements**; each party sees only their slice of both. The same person can be different kinds across accounts (a
promoter who also DJs keeps two accounts), and the same profile can play different roles across events (a venue that
operates one show and rents to a promoter in the next). **Roles are per-event; kinds are per-account; identity is
stable underneath both.**

---

## Reading guide (where the mechanics live)

This doc = **why**. For **how**:
- **`PLAN.md`** — the blueprint: schema, engines, API surface (single source of truth for mechanics).
- **`docs/decisions.md`** — refinements to PLAN.md + the reasoning behind each choice (agent design = #14).
- **`docs/design-brief.md`** — screens + per-role visibility, for the design pass.
- **`docs/payments.md`**, **`docs/money.md`**, **`docs/gdpr.md`**, **`docs/timezones.md`** — deep dives.
- **Skills** (`data-model`, `authorization`, `settlement`, `api-conventions`) — module-level detail.

When a how-doc states a rule and this doc states a purpose and they seem to conflict, the **rule wins on mechanics**
— but re-read it against the purpose: a genuine conflict means one of them is wrong, and it's worth flagging rather
than silently following either.
