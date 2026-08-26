# Data meeting — settlements & deals

**Participants:** Daniel Öhman, Ran Nir.
**Status:** binding. Later product decisions override PLAN.md (CLAUDE.md); this
meeting is later than `docs/decisions.md` #16 and settles several questions that
document leaves open. Where this and PLAN.md disagree, **this wins**.

Transcribed from the meeting record. Timestamps are the transcript's own.

---

## Decisions — aligned

| Decision | Consequence for the build |
|---|---|
| **Consolidate deal-specific sections** into a new **"Deal" tab** covering agreements, accommodation and the financial deal | The current separate Agreement tab is not the end state |
| **Event details and agreements consolidated** to streamline event confirmation | Event Details keeps *general* information; the Deals tab owns *specific* financial and contractual agreements per participant (02:57:22) |
| **Label the responsible party "operator"**, not "producer" | Plus a UI note that this corresponds to the legally-defined producer of the event |
| **Shared budget tab** inside the budget planner for co-promoted events | Multiple operators need the same financial data. *Already built:* shared ledger + private budget with a switcher |
| **Settlement is per profile, individually** — one per participant | Even when the underlying deal covers multiple performers |
| **"Collected By" and "Paid By" selectors in the budget planner** | Explicitly assign responsibility for each revenue stream and each cost. **The columns exist; the planner UI does not expose them** |
| **All costs assignable to specific deals** | Accountability per agreement — this is `budget_lines.deal_id`, currently unused by any UI |
| **Deal naming uses the name of the person or entity** on the agreement | |
| **Freelancer model only** | No band-account structures, no inter-band payment splits |
| **Postpone complex structures** — percentage-of-bar splits, tiered escalators | Standard industry deal types for the first release |
| **Defer crew payment management** | Lean on existing payment integrations rather than building payroll |

## Decisions — still open

- **Deal vs crew separation.** Structural separation of the two entities is
  explicitly undecided and deferred to a later discussion (02:08:31, 02:09:43).

## Next steps agreed

- Dual budgets: shared + private for co-promoters.
- Transparency options: let an operator share additional financial information.
- Automate individual settlements — a separate settlement view per participant.
- Budget selectors: collected-by for revenue, paid-by for costs.
- **Fix the production cost split bug** — the field shows incorrect default
  values; those options should appear only under specific rental conditions.
- Operator budget view: shared and own tabs.

---

## Details that bind implementation

**Deal types (00:05:08, 00:08:38).** Rentals, bonus structures, and escalators
where the split changes at ticket-volume thresholds. Tiered splits are normal in
the industry because they reward a promoter for taking more risk. **Deferred for
v1**, along with bar percentages — common in the US, less essential for this
market, addable later on demand.

**Multi-party events (00:09:54–00:11:00).** Real scenarios are simpler than the
worst case: equal splits between performers, or headliner-plus-support. Do not
architect for highly intricate multi-tiered splits for every party.

**Splits (00:15:45).** Default to an even split, or let the user set specific
percentages per performer — **the total must add up to 100%** of the allocated
cut.

**Operator vs producer (00:19:53).** "Producer" is ambiguous across contexts.
The system says **operator**, with UI text clarifying it means the legally
defined producer.

**Transparency (00:21:42, 00:25:48).** Operators see all financials;
collaborators see only the portions relevant to their own deals. **For
co-promotions, all involved parties get full transparency into the entire
financial deal.**

**Budgets for co-promotions (00:27:05, 00:30:48).** A tabbed interface toggling
**shared** and **private**, so it stays clear who is responsible for which cost.

**Admins vs operators (00:31:44).** Multiple operators on an event effectively
act as admins, so explicit permission editing may not be needed for co-promotion
setups. Granular access still matters for general profile management.

**Crew and freelancers (00:32:43, 00:33:51).** Keep it simple — such teams
usually have existing payment methods. Their costs may eventually be assigned to
individuals in the budget planner.

**Unified deals tab (00:34:55, 00:36:15).** Manage all agreements for an event in
one place rather than navigating nested sub-events. The prototype already has a
selector for **separate settlements per performer vs one for all**.

**Manual adjustment (00:39:19).** Settlements must be manually editable for
real-world variables — last-minute operational changes, cash on the night.

**Ticketing (00:43:38).** Ideal is API sync from ticketing companies, but manual
input must remain for cash-at-the-door.

**Money flow (00:45:30, 00:52:03, 00:51:01, 00:54:55).** Track who holds revenue
and who pays whom, but always offer **"paid"** / **"already handled"** marks —
money often moves as cash or is processed by the promoter before settlement.
Define who receives which revenue stream and who pays whom **at the start** of an
event to remove ambiguity.

**Prototype bug (01:00:17).** The financial-deal section's **production cost
splits** shows incorrect default options; they should appear only under specific
rental conditions.

**Cost splits (01:02:58, 01:04:30, 01:06:31).** Who bears marketing, staff, etc.
is set by the contract, not a system default. The platform allows flexible splits
(e.g. 50/50) even when individual expenses are paid by different parties, and
calculates the final settlement so obligations balance. **The production system
requires a defined rule: either a cost split or a single payer.** Once the rule
is set in the budget planner, costs entered against it are processed
automatically at settlement.

**Costs vs deductions (01:08:30, 01:09:38, 01:10:41).** "Add cost" and "add
deduction" are distinct. Revenue can be entered (e.g. €500 merchandise) with
percentage splits or fixed deductions applied. A **deductible** is one party
paying an expense on behalf of another — a venue paying for the performer — later
deducted from that party's cut. The system tracks it, but must accept that
different parties hold different revenue streams in their own accounts.

**Settlement workflow (01:12:54, 01:13:52, 01:18:14).** All collaborators input
their revenue and cost information before the settlement is generated, so
"who owes whom" is computed from real data. The process may involve comments or
operator adjustment. Transparency about **who holds which funds** is essential.

**Cash vs digital (01:24:48, 01:25:57).** The system cannot know who holds cash.
Collaborators confirm their received amounts manually to enable settlement.

**Collected-by (01:27:49, 01:29:46).** Every revenue stream carries a
**collected-by** designation so collaborators log their own revenue and costs.
A multi-selector defines who pays a cost and who receives revenue; both settle
after the event.

**Banking (01:30:47, 01:31:39).** Structure should permit future PSD2-style bank
API connections, not needed now. **Templates for shared budgets** are valuable
for recurring events with the same promoters.

**No escrow (01:31:39, 01:33:18).** Moving money through the platform was
considered and rejected for now, to avoid legal complexity.

**Freelancer agreements (01:34:29, 01:35:41, 01:46:37).** Adding them to event
tabs would streamline paying sound engineers and similar. Caution: handle them so
they do not clutter the collaborator view; acceptable if handled as internal
agreements. Keep the event manager interface clean rather than one tab per
freelancer agreement.

**Team vs in-house (01:40:58).** **Shared Team** is a contact list all
participants can access; **In-house Management** is private to the venue.

**Freelancers in budgeting (01:43:43).** A freelancer added to an event should
appear automatically as a cost item in the budget planner — provided the system
does not force data entry before the user has planned the event.

**Agent and freelancer deals (01:50:02, 01:51:37).** All agreements — performer,
freelancer, agent — live in the same place, with each user seeing only the
agreements relevant to their role.

**Consolidation (01:53:36, 01:56:08, 01:57:22, 01:59:41).** Replace the
fragmented tabs with a single **Deals** tab covering financial agreements,
accommodations and amenities. Event Details keeps general information. Loading an
event should retrieve a clean, document-like structure associated with the event
ID.

**Event data (02:00:57).** Linking deals and participants to event IDs centralises
information — total revenue, songs performed — which supports AI training later
and removes scattered notes.

**Agreement automation (02:03:50).** Entering hired personnel in the budget
planner (a bass player, a drummer) should prompt creating an agreement, with an
option to invite that person by email.

**Seats, not band splits (02:05:19).** Charge for additional user seats rather
than free access for every band member. Avoid complex revenue splits between band
members.

**Cost assignment (02:07:31).** Performer profiles may inherit financial data
from venue reports — expected ticket revenue — and costs are assigned directly to
specific deals or to the individuals responsible.

**Placeholders (02:02:56).** Non-functional but **explainable** placeholders are
acceptable in the prototype while final components are built. *(Note: in the
shipped app this project's rule is stricter — no dead affordances.)*
