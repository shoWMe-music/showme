# shoWMe — Design Brief

Live-events **booking + settlement** SaaS. This brief frames the product for design: who the
users are, what surfaces they need, and — the load-bearing rule — **what each role is allowed to see.**
Visibility is not a detail here; it *is* the product. Every screen is a redacted view of a shared event.

---

## 1. Four account kinds (fixed at signup, one per account)

Each account is exactly one kind. The kind decides the entire app the user sees.

| Kind | Who | Home / dashboard centers on |
|---|---|---|
| **Operator** | Venue · promoter · organizer · festival | Their events, budgets, settlements, booking inbox, crew |
| **Performer** | Band · DJ · solo artist | "My bookings," availability calendar + public link, offers, riders |
| **Team and Crew** | Freelance crew (sound, lighting, catering, security, stage) | Their gigs, schedule, marketable profile (future marketplace) |
| **Agent** | Booking agent representing performers | Roster of represented artists, negotiation pipeline, commission owed/collected, the **Agents & Performers** page |

A person who is two kinds (promoter *and* DJ) keeps two accounts. Design each kind's shell as a
distinct product, not a mode toggle.

---

## 2. The spine: an event is a container; everyone is a participant

Every actor on an event — operator, performer, venue, crew — is a **participant**. All money, content,
schedule, and history hang off participant rows. There is **no "host sees everything" screen**: even the
operator's full view is just the widest slice, not a different app.

Core objects a designer will build screens for:
- **Event** — title, date/times, venue, status (draft / on-hold / confirmed / concluded), stages.
- **Participants** — the people on the event, each with a role and a permission set.
- **Deal** (per participant) — the agreement + money terms (see §4).
- **Budget** — revenue & cost lines (operator/co-promoter only).
- **Settlement** (one per participant) — "who owes whom," transfers.
- **Content** — riders, schedule/set-times, messages, agreements.
- **Tasks & calendar** — todos (personal / profile / event-scoped), availability.
- **Activity feed** — a per-role history of what changed.

---

## 3. The one rule that shapes every screen: **you see only your slice**

Authorization is three tiers. Design to all three:

1. **Floor (always visible, can't be removed).** A performer *always* sees: event title/date, their own
   deal, their own settlement, the schedule. Crew always sees: title/date, schedule, their own deal.
   → These must never render as "locked" or empty for that role.
2. **Configurable band.** The operator grants extra capabilities per participant (e.g. make a collaborator
   a co-host). → The UI for *managing* permissions is operator-only.
3. **Ceiling (can't be granted).** Arm's-length parties (performer, rental venue, crew) can **never** be
   shown the budget/pool or other parties' financials — even if the operator wanted to. → No affordance
   should exist to expose it.

### What each role sees on a shared event (design matrix)

| Surface | Operator / Co-promoter | Performer | Crew (Team and Crew) |
|---|---|---|---|
| Event title, date, venue | ✅ | ✅ | ✅ |
| Full participant list | ✅ | Own + public | Limited |
| **Budget / pool** | ✅ | ❌ never | ❌ never |
| Their **own deal** | ✅ (all deals) | ✅ own only | ✅ own only |
| Other parties' deals | ✅ | ❌ | ❌ |
| **Settlement** | ✅ all ("who owes whom") | ✅ own slice | ✅ own slice |
| Schedule / set-times | ✅ edit | ✅ view | ✅ view |
| Activity feed | Everything on the event | Own deal + title + schedule | Schedule + own deal + title |

**Co-promoters are the exception:** they share a budget and see the whole financial picture. The privacy
line is drawn by *relationship* — co-operators share; everyone else sees only their slice.

**Agents act *through* the performer they represent.** On that performer's in-region events, the agent sees and
edits the **performer's own slice** (deal, settlement, schedule) with **negotiate/confirm** authority, while the
performer's own screens go **read-only** for those events (delegation, both-party agreed — never a lock-out the
performer can't undo). The operator sees the agent as the **negotiator/contact** — like any participant — but never
the agent's cut: the **commission is a private agent↔performer statement**, not part of the event's settlement. One
agent can represent several performers on the same event; each sees only their represented performer's slice. Full
model: `docs/decisions.md` #14.

---

## 4. Key UI pattern: the consolidated "Deal tab"

Per participant, one tab shows **everything about that party in one place**: financial terms + the
agreement + accommodation + amenities + their schedule. Underneath these are separate data, but the
*experience* is unified. This is the primary screen of the app — design it well.

- A **deal** = the live money terms (guarantee / door split / guarantee-vs-door / rental) **and** the
  agreement document, together. The performer sees only their own line; the operator sees all.
- A deal can always render as a **PDF** (the agreement). **E-signature comes later** — until then it's a
  confirmable document ("all parties confirmed"), not a legally e-signed one.
- **Live vs frozen:** while in progress, terms render **live** (change a number, it updates). Once all
  parties confirm (or later, e-sign), the document **freezes** into an immutable record. Design both
  states: an editable draft and a locked, signed-off record.

---

## 5. Settlement — "who owes whom"

The end-of-event reconciliation. Each participant gets **their own** settlement view:
- What they were **owed** (their deal), what they **collected**, what they **paid**, their **net**, and the
  resulting **transfers** (Party A → Party B, €X).
- Every transfer has a state: **owed → paid → handled**, with manual override ("mark as paid / already
  handled"). The platform tracks money; it never holds it — so confirmation UI is essential.
- Multi-currency: amounts settle in the deal's currency; a viewer can *display* in their own currency
  (cosmetic, never changes the settled figure).

Design the operator's full "who owes whom" board **and** the performer's single-slice "here's what you're
owed and by whom" card — same data, very different scope.

---

## 6. Crew, teams & sub-hires

- Crew are added to an event individually **or** as a saved **team** (a reusable, shareable roster).
- A crew person can be a real freelancer (their own profile) or an off-platform contact that can later
  claim an account — design for both the "invited real user" and "placeholder contact" states.
- A performer can hire their own crew (e.g. a guitarist) paid a guarantee or a share — shown as a deal in
  *their* deal tab, private from the operator (operator sees the *person* for logistics, not the pay).

---

## 7. Notification & realtime

- One live stream per user: chat, notifications, and event-change updates arrive in real time (chat makes
  this non-optional — polling would look broken).
- Notifications have server-side read state; design read/unread cleanly.

---

## 8. Public surfaces (no login)

- Public **profile** pages (venue/performer) and public **event** pages — SEO/link-preview quality,
  whitelisted fields only.
- Performer **public availability** link + a **booking request** form (the inbound "request a date" flow).
- Settlement **share** links for arm's-length review (OTP-verified) — a recipient sees only their slice.

---

## Design-relevant decisions locked in this working session

- **Deal = money + agreement, one entity.** The agreement is always present; e-sign is a later addition.
- **History is per-role.** The activity feed shows each user exactly the changes to things they can see —
  no separate visibility system, it inherits the deal/schedule/settlement scoping.
- **Permission floor is inviolable.** A performer/crew can never be misconfigured out of seeing their own
  deal, the schedule, or the title.
- **Operator is a role, not just a kind.** The same venue is the managing operator in one event and an
  arm's-length rental party in another — the UI must reflect per-event role, not per-profile identity.
- **Agents represent performers.** A new **Agents & Performers** page owns the agent↔performer agreement (region,
  commission, dates). An agent negotiates/confirms and (optionally) collects on the performer's behalf for in-region
  events; the performer's screens go read-only there. The agent's commission is a **private statement between agent
  and performer** — never shown to the operator, never a line on the event settlement.
