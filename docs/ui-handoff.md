# The logged-in UI, by account kind

> **shoWMe · logged-in UI handoff** — Operator · Performer · Team and Crew · Agent
> v1 · August 2026 · **Source of truth: `Prototype/*.dc.html`**
>
> Transcribed from the Claude Design project (remote) — `Prototype/shoWMe Logged-in UI Handoff.dc.html`.
> The rendered `.dc.html` prototypes remain the pixel-exact reference; this document is the structural/spec map.

A build handoff for the four interactive demos: what the signed-in application looks like for an **operator**, a **performer**, a **team_and_crew** (crew) and an **agent** — one shell, four navigation sets, two role-specific surfaces.

---

## 1 · What ships in this handoff

Four demos, each a complete, clickable application in a single file. They share one shell and one component vocabulary; they differ in the sidebar routes they expose and in one screen each.

| Demo file | Account kind | Signed-in identity | Unique surface |
|---|---|---|---|
| shoWMe Prototype | operator | Ran Kessler · Blackbird Presents | — (the reference build) |
| shoWMe Performer | performer | Ran Kessler · Blackbird Presents *(unfixed)* | My Agent |
| shoWMe Crew | team_and_crew | Ran Kessler · Blackbird Presents *(unfixed)* | — (reduced nav only) |
| shoWMe Agent | agent *(new kind)* | Sarah Voss · Paradigm Agency | Roster + representation flow |
| shoWMe All View | — | — | Every route in one file, for review |

*Table 1 — the demo set. All five live in `Prototype/` and open directly in a browser.*

---

## 2 · The shell — identical for all four

Everything below is shared. Build it once; the account kind only decides what goes in the nav list and which role screen mounts.

### Sidebar
- Fixed left, **250px expanded / 72px collapsed**, 0.2s width transition. Always dark — it does *not* follow the light theme (gradient `#140D09 → #0A0604`).
- Logo mark + **shoWMe** wordmark; wordmark hides when collapsed.
- Collapse toggle is a 28px circle floating on the sidebar's right edge (`top:74px; right:-14px`), not a nav row.
- Nav row: 18px icon + label, 11px radius, idle `#9E8E7F`. Active row gets text `#F5EDE2`, a horizontal red→gold tint, and a 3px red bar with glow bleeding into the sidebar gutter.
- Count badge (mono, 10px, red pill) — currently only on **Incoming Requests**, counting requests not yet declined.
- Footer identity chip: 34px gradient avatar with initials, name, organisation. Collapses to the avatar alone.

### Top bar
Sticky, translucent (82% background + 16px blur), 16/30px padding. Left: a mono uppercase eyebrow in accent over a 22px display page title — both driven by one route→`[crumb, title]` map (e.g. *Money → Settlements*, *Inbound → Incoming Requests*). Right: a 260px search pill, a 40px circular theme toggle, and the primary **New event** button. The bar hides on full-bleed screens (public event page).

### Main region
30px padding, screens capped at **1180–1240px and centred**. Every route change replays a 0.4s rise-and-fade on the screen wrapper. Theme is an attribute on the root (`data-theme`) driving a single token set — **light is the demo default, dark is the original design.**

---

## 3 · Navigation matrix

The one thing that actually differs between the four demos. Order is the render order.

| Route | Operator | Performer | Team and Crew | Agent |
|---|---|---|---|---|
| dashboard | Dashboard | Dashboard | Dashboard | Dashboard |
| calendar | Calendar | Calendar | Calendar | Calendar |
| events | Events | Events | Events | Events |
| **representation** | — | **My Agent** | — | **Roster** |
| tasks | Tasks | Tasks | Tasks | Tasks |
| setlists | Setlists | Setlists | — | Setlists |
| settlements | Settlements | Settlements | Settlements | Settlements |
| projections | Financial Projections | Financial Projections | Financial Projections | Financial Projections |
| requests | Incoming Requests | Incoming Requests | Incoming Requests | Incoming Requests |
| bills | Bills & Invoices | Bills & Invoices | Bills & Invoices | Bills & Invoices |
| team | Team | Team | Team | Team |
| contacts | Contacts | Contacts | Contacts | Contacts |
| audience | Audience | Audience | Audience | — |
| profiles | My Profiles | My Profiles | My Profiles | My Profiles |
| settings | Settings | Settings | Settings | Settings |

*Table 2 — routes by account kind. Highlighted (bold) rows are the only genuine differences: **14 items for operator, 15 for performer, 13 for team_and_crew, 14 for agent.***

> **Build note.** The same `representation` route key carries two opposite screens — the agent's *Roster* and the performer's *My Agent*. Treat it as one relationship object rendered from two sides, not two features.

---

## 4 · Shared screens

Every route below renders the same in all four demos today.

- **Dashboard** — time-based greeting with the first name in italic serif, an "N things need attention" line, an attention list (each row an icon tile + title + subtitle, click routes through), event and settlement KPI tiles, filter chips, recent settlements, top venues.
- **Events** list → **Event workspace** (see §5). **Settlements** list → **Settlement detail** (see §6).
- **Calendar**, **Tasks**, **Setlists**, **Financial Projections**, **Incoming Requests**, **Bills & Invoices**, **Team**, **Contacts** (with contact profile modal), **Audience**, **My Profiles**.
- **Public event page** — full-bleed, no top bar; the audience-facing view reachable from the event workspace.
- **New event wizard** — five panels, plus event modals for invite, share and edit.
- **Settings** — a second-level sidebar: General · Team Access · Notifications · Security · Appearance · Integrations · Billing.

---

## 5 · Event workspace

Underlined tab strip, red active tab. Tabs in order:

> To Do · Budget Planner · Event Details · Agreement · Team / Crew · Settlement · Messages · Collaborators · Event History

Header carries the event identity, a published toggle, and an overflow menu. *Event History* shows a count badge. The *Agreement* tab is the deal's paper side — per the data model, deal and agreement are one object, so this tab and the deal terms are two views of one record.

> **Gap — this is the main thing to design next.** All nine tabs render identically for all four kinds. A performer must not see the Budget Planner or other parties' deals; a team-and-crew member should land on schedule and their own deal only; an agent sees their artist's deal but not the operator's pool. The demos show the operator-grade workspace to everyone.

---

## 6 · Settlement detail

The flagship screen. Same tab pattern as the event workspace:

> Overview · Deal Structure · Financials · Settlement · Payout

*Overview* is an identity block — event ID, performer, venue, operator, date. The remaining tabs walk the reconciliation: what the deal entitles, what was collected and paid, the resulting net, and the payout. This maps directly onto the per-participant settlement in the data model — one settlement row per participant, each party seeing only their own slice.

---

## 7 · Role-specific surfaces

### Agent — Roster
- KPI strip: active roster size, YTD commission, commission owed, in-region deals.
- Filter chips (all / active / proposed / ended) over a card grid of represented artists — avatar, genres, territory, rate, status badge. Status reads differently by origin: *Offer received* when the performer proposed, *Awaiting performer* when the agent did.
- Roster → artist detail: the representation agreement (territory, rate, basis, who collects, term dates) plus deals in flight.
- Propose-representation modal: pick which of your agent profiles signs → pick an existing performer profile or invite by email → terms (territory chips or worldwide, rate %, basis, collects, dates). Blocks on an overlapping active representation for the same artist and territory.
- Counter-offer reuses the same modal; termination is a separate confirm step and is unilateral.
- Copy is explicit that commission is private between agent and performer.

### Performer — My Agent
The mirror: the performer's view of the same representation records, plus an invite-an-agent modal and accept / counter on an incoming offer. Same objects, same statuses, opposite actor.

### Team and Crew (crew)
No unique screen — the demo is the operator build with Setlists and representation removed. Everything a team-and-crew member should actually get (their call time, their run-of-show, their own deal and settlement, and nothing else) is still to be designed.

---

## 8 · Visual tokens

One token set, remapped per theme. Sidebar stays dark in both.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0A0604` | `#FBF6EE` | App canvas |
| `--surface` / `--elevated` | `#18100C` / `#221812` | `#FFFDF9` / `#FFF9EF` | Panels, inputs, chips |
| `--text` / `--muted` / `--dim` | `#F5EDE2` / `#8C7A6C` / `#5A483C` | `#18100C` / `#5A483C` / `#8C7A6C` | Three-step text ramp |
| `--accent` | `#FFC266` | `#B8791F` | Eyebrows, links, serif accents |
| `#EE5746` | Fixed in both themes | | Primary action, active tab, badges |

*Table 3 — core tokens. Status hues (green confirmed, amber pending, blue info, purple performer) are fixed across themes.*

**Type.** Clash Display for page titles and headings; **Inter Tight** for all UI and body; *Instrument Serif italic* for one accent word in a heading; JetBrains Mono uppercase for eyebrows, IDs, counts and metadata.

**Form.** Cards 16–18px radius, nav rows and buttons 11px, pills 999px. One hairline border token, one soft shadow. Icon-only buttons — modal close, back arrows — have no background and no border: just the glyph in a muted colour.

---

## 9 · Open decisions

1. **Is "agent" a fifth account kind?** The data model locks kind to `operator | performer | team_and_crew`. The Agent demo adds a real fourth surface with its own object (a representation: performer, territory, rate, basis, term, status). Either kind gains a value, or agent becomes an operator-kind profile with a representation module — the UI works both ways, the plan does not. *(Note: this repo already treats **agent** as a fourth account kind — see `docs/decisions.md` #14.)*
2. **Per-kind gating of the event workspace and settlement.** Nothing is redacted yet (§5). This is the largest remaining design task and it is what the party-scoping rules in the plan exist to drive.
3. **Performer and team-and-crew demos still sign in as the operator** (Ran Kessler · Blackbird Presents). Their identity chip, dashboard greeting and profile set need replacing before these are shown as role demos.
4. **Audience for team and crew, Setlists for agents.** Both are currently inherited rather than decided — a team-and-crew member has no audience to hold, and an agent arguably reads setlists rather than authoring them.
5. **Where commission lives at settlement.** The Roster screen shows commission owed, but the settlement detail has no commission line — the data model carries it as a deal party role, so the UI should surface it inside the performer's settlement, not only in the agent's roster.
