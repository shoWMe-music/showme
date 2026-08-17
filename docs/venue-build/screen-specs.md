# shoWMe — Operator / Venue Web App: Screen Specs

Faithful UI spec for the **Operator** (venue · promoter · organizer · festival) app, to be rebuilt in
`apps/web` (React 19 + TanStack Router/Query + `@showme/design-system`). **Analysis only** — no app code here.

**Sources baked in:** the 10 product screenshots (`apps/marketing/public/assets/shots/light-0*.webp`),
`docs/design-brief.md`, `docs/story.md`, and the live component exports in `design-system/src/index.ts`.

**How to read this doc.** Start with **§0 Shell** (sidebar + topbar + content frame + theme). Then one section
per nav destination (14). Each destination section has: **Layout · Sections & content · Components · Data needs ·
Shot**. Cross-screen patterns are called out in **§15**.

---

## Design language (established — do not re-derive)

- **Dark sidebar**, always ink-dark in both themes; active item is a red→gold gradient fade with white text.
- **Content area is theme-aware** via DS tokens: light = warm cream ground with white cards; dark = ink ground with
  raised cards. **Describe layout by token intent, never hardcoded hex.** The whole content frame carries a faint
  grid-paper texture in the shots.
- **Rounded cards + soft shadows.** Generous radius (~16–20px on cards, 999px on pills/chips).
- **Primary buttons = orange→red gradient** (`Button variant="primary"`). Secondary = quiet outline/ghost on card.
- **Mono uppercase eyebrow labels** (JetBrains Mono, letter-spaced): `INBOUND`, `WANTED DATE`, `FEE`, `SCHEDULE`,
  `FORECAST`, `CRM`, `PEOPLE`, `SETTLEMENT`, `DEAL STRUCTURE`, `PRODUCTION SCHEDULE`, `REQUESTS BY DATE`, etc.
- **Status pills** = `Badge` (amber pending, green confirmed, grey concluded/draft, red cancelled, purple suggested).
- **Topbar**: global `SearchInput` ("Search events, artists…"), a **theme toggle** (moon/sun), and a
  **`＋ New event`** primary button. On event-scoped screens the topbar instead shows a bell (notifications) only —
  see §15.C.
- **Fonts (already in DS):** Clash Display (display headings), Instrument Serif (italic accents), Inter Tight (body),
  JetBrains Mono (eyebrows / numeric / labels).

---

## Component inventory (from `design-system/src/index.ts`)

Atoms: `Button` (`variant`, `leftIcon`, `rightIcon`), `Badge` (`status`, `dot`), `Chip` (`active`), `Avatar`
(`initials`/`src`, `tone`: amber|green|purple|blue|brand, `shape`, `size`), `Input` / `SearchInput`, `TextField`,
`Checkbox`, `Toggle`, `Card`, `StatusDot` (`status`, `size`), `Tag` (`tone`: muted|accent|dim), `ProgressBar`
(`value`, `label`, `showValue`, `status`), `Skeleton`, `Spinner`, `Icon` (`name`: 21 names — see below).

Molecules: `SectionHeader` (`eyebrow`, `title`, `accent`, `subtitle`, `actions`), `StatCard` (`label`, `value`,
`hint`, `icon`), `Toast` + `ToastProvider` + `useToast`, `ListRow` (`leading`, `title`, `meta`, `trailing`,
`interactive`), `SidebarItem` (`icon`, `label`, `active`, `collapsed`, `badge`, `tag`), `KeyValueRow` (`label`,
`value`, `mono`, `total`, `valueColor`), `EmptyState` (`icon`, `title`, `description`, `action`), `Modal`, `Tabs`
(`tabs`, `value`, `onChange`), `Stepper` (`steps`, `active`), `SelectCard` (`icon`, `title`, `description`,
`selected`), `TodoItem` (`text`, `done`, `onToggle`, `onDelete`).

Organisms: `ContactCard` (`name`, `role`, `initials`, `tone`, `email`, `verified`, `linkedProfile`, `onViewProfile`),
`DataTable<Row>` (`columns`, `rows`, `getRowKey`, `onRowClick`, `pagination`, `loading`, `skeletonRows`).

Status vocabulary (`STATUSES`): `suggested · pending · confirmed · hold · concluded · cancelled · draft · task`.

**Icon set (21):** `plus, search, calendar, grid, alert, check, chevron-down, chevron-right, users, user, file, star,
music, settings, bell, mail, x, building, clock, trash, arrow-right`.
**New icons required** (not in set — add to DS `IconName`): `trending-up` (Financial Projections, Performance
Reports), `inbox` / `arrow-down` (Incoming Requests), `receipt` (Bills & Invoices), `list` & `grid` view-toggle
already covered by `grid`, `download`/`upload` (Calendar Export/Import, Share & Export), `share`, `edit`/`pencil`,
`dots-vertical` (row overflow menus), `eye` / `eye-off` (publish toggle), `link` (shareable links), `copy`. These are
small line icons; several screens depend on them.

---

# §0 — The Shell

Every operator screen renders inside one persistent shell: **fixed dark sidebar (left) + topbar (top) + scrolling
content frame (right)**. TanStack Router: a root `__operator` layout route hosts the shell; each nav destination is a
child route rendered into the content outlet.

## 0.1 Sidebar (fixed left rail)

- Dark ink background, full height, ~250px wide. Collapsible: a small circular chevron toggle floats on the rail's
  right edge (`SidebarItem collapsed` renders icon-only with the label as tooltip).
- **Brand lockup** at top: the shoWMe triangle mark (orange→red gradient) + wordmark "shoWMe" (Clash Display).
- **Nav list** — `SidebarItem` per row, **in this exact order**, active row = red→gold gradient fade:

  | # | Label | `icon` prop | Badge / tag |
  |---|---|---|---|
  | 1 | Dashboard | `grid` | — |
  | 2 | Calendar | `calendar` | — |
  | 3 | Events | `calendar`* (**new: `calendar-check`** preferred) | — |
  | 4 | Tasks | `check` | optional count of open tasks |
  | 5 | Performance Reports | `file` (**new: `trending-up`** preferred) | — |
  | 6 | Settlements | `file` (**new: `receipt`/`scale`**) | optional count needing action |
  | 7 | Financial Projections | **new: `trending-up`** (`arrow-right` placeholder) | — |
  | 8 | Incoming Requests | **new: `inbox`/`arrow-down`** | `badge={pendingCount}` (red pill — shows `4` in shots) |
  | 9 | Bills & Invoices | `file` (**new: `receipt`**) | optional overdue count |
  | 10 | Team | `users` | — |
  | 11 | Contacts | `building` (**or `user`**) | — |
  | 12 | Audience | `users` | — |
  | 13 | My Profiles | `user` | — |
  | 14 | Settings | `settings` | — |

  \* In shots Events uses a calendar-with-check glyph distinct from Calendar; add `calendar-check` to disambiguate.
- **Active-state rule:** exactly one item active per route; `aria-current="page"`. Incoming Requests keeps its numeric
  badge visible even when active (shots show badge `4` on the active red row).

## 0.2 Topbar

Two variants, chosen by route:

- **List/CRM variant** (Dashboard, Calendar, Events, Tasks, Reports, Settlements, Projections, Incoming Requests,
  Bills, Team, Contacts, Audience, My Profiles, Settings): left = page eyebrow + title stack (or empty when the page
  renders its own `SectionHeader`); right cluster = **`SearchInput`** ("Search events, artists…") · **theme toggle**
  (moon/sun icon `Button variant="ghost"`) · **`＋ New event`** (`Button variant="primary" leftIcon={<Icon plus/>}`).
- **Event-detail variant** (inside an event, and the Settlement detail): the global search/new-event cluster is
  replaced by a single **bell** notification button (`Icon name="bell"` in a round card button). The page's own
  header (title, status pill, publish toggle, currency selector, Invite/Share actions) lives in the content, not the
  topbar. See §15.C.

## 0.3 Content frame

- Scrolls independently of sidebar/topbar. Max content width ~1360px, comfortable gutters, cream/ink ground with the
  faint grid texture. Cards float on it with soft shadow.
- Standard page masthead = `SectionHeader` with mono `eyebrow`, Clash Display `title`, optional Instrument-Serif
  italic `accent`, `subtitle` line, and right-aligned `actions`.

## 0.4 Theme system

- Two themes driven by DS tokens; toggle in topbar persists to user settings + `localStorage`, applied as a
  `data-theme` attribute on `<html>`. Sidebar stays dark in both. **All screen specs below are theme-agnostic** —
  reference token intent (ground / raised-surface / text-strong / text-muted / accent-gradient / status-color), never
  hex.

## 0.5 Global providers

`ToastProvider` at app root (settlement saves, "link copied", invite sent, etc. → `useToast`). Loading everywhere via
`Skeleton` (lists/tables) and `Spinner` (buttons/inline). Realtime SSE feeds notification bell + request/settlement
badges live.

---

# §1 — Dashboard  *(no shot — design from language + brief)*

**Purpose (story.md):** the operator's home — "their events, budgets, settlements, booking inbox, crew." The
residual-bearer's cockpit: what needs attention now, money in flight, the near calendar.

**Layout.** `SectionHeader` (eyebrow `OVERVIEW`, title "Dashboard", subtitle greeting/date). Then a **KPI row**
(4 `StatCard`), then a **two-column body**: left ~65% = "Needs attention" + "Upcoming events" lists; right ~35% =
"Booking inbox" preview + "Tasks" preview + activity.

**Sections & content.**
- **KPI row** (`StatCard` ×4): `PENDING REQUESTS` (count, hint "awaiting reply") · `CONFIRMED THIS MONTH` (count +
  gross) · `SETTLEMENTS OPEN` (count, hint "need review/finalize") · `NET PROJECTED` (€, hint "pipeline P&L"). Icons
  optional.
- **Needs attention** (`SectionHeader` subtitle small + list of `ListRow` / `TodoItem`): settlements pending review,
  requests older than N days, events missing a deal, overdue bills. `trailing` = `Badge` status + chevron.
- **Upcoming events** (list of `ListRow`): `leading` `Avatar` (performer initials, tone), `title` event name,
  `meta` "Venue · date · capacity", `trailing` `Badge` status (suggested/pending/confirmed). Row click → event.
- **Booking inbox preview**: 2–3 most-recent requests as compact `ListRow` (requester + wanted date + fee), footer
  link "View all → Incoming Requests".
- **Tasks preview**: top open `TodoItem`s scoped to the operator, footer link "All tasks".
- **Empty/loading:** `Skeleton` rows in each list; `EmptyState` (icon `calendar`, "No upcoming events", action
  `＋ New event`) when brand-new.

**Components.** `SectionHeader`, `StatCard`, `ListRow`, `TodoItem`, `Badge`, `Avatar`, `Button`, `Skeleton`,
`EmptyState`. **New composite:** none required (compose from `Card` + `ListRow`).

**Data needs.** counts + sums for the 4 KPIs; list of attention items (type, label, related event, status,
age); upcoming events (name, performer, venue, date, capacity, status); recent requests (requester, wanted date, fee,
status); open personal/operator tasks; recent activity entries.

---

# §2 — Calendar  *(shot: light-03-calendar, modal in light-02-availability)*

**Purpose.** The operator's scheduling spine across all their profiles/venues — plan holds, confirmed shows, tasks,
appointments, notes; check & share availability; import/export ICS.

**Layout.** Full-width. `SectionHeader` (eyebrow `SCHEDULE`, title "Calendar"). Below: a **large month title**
("July 2026", Clash Display) + a **control cluster row**, a **filter row**, then the **grid (main, ~75%)** with a
**right rail (~25%)** holding the Status legend + "My calendars" toggles.

**Sections & content.**
- **Control cluster** (row of pill buttons): `‹ Today ›` nav trio; a segmented **Month / Week / Day** toggle (active
  = red); a segmented **Performer / Event Name / Both** label-mode toggle (active = red); then action pills:
  **Mark Unavailable** (icon `calendar`), **Check & Share Availability** (`share`), **Export ICS** (`download`),
  **Import** (`upload`), **`＋ Create Event`** (primary gradient).
- **Legend strip** (inline dots): Suggested · Pending · Confirmed · On hold · Concluded · Cancelled · Task ·
  Appointment · Note — each a `StatusDot` + label. (Appointment/Note extend the status vocabulary — add two tones.)
- **Filter row** (pills / inputs): **Calendars** (dropdown, icon `grid`), **Status** (dropdown, icon `eye`),
  **Performer…** free text (`Input`), **Venue / Room…** free text (`Input`), **date** `yyyy-mm-dd` (`Input`).
- **Month grid**: 7-col MON…SUN header (mono), day cells with day-number; events render as slim rounded chips tinted
  by status (e.g. "Overmono" on the 2nd, "Nils Frahm" on the 4th). Today highlighted. Cells scroll/overflow "+N more".
- **Right rail — Status legend card** (`Card`, eyebrow `STATUS LEGEND`): full vertical legend list, each `StatusDot` +
  label. **My calendars card** (`Card`, eyebrow `MY CALENDARS`): checkbox rows — "Promoter events", "Performer shows",
  "Venue bookings" — each a colored `Checkbox` toggling that source layer.
- **Empty/loading:** grid renders skeleton cells; empty month still shows the grid (calendars are never "empty").

**Modal — Check & Share Availability** (shot light-02, `Modal`):
- Title "Check & Share Availability" + close `x`.
- **Calendar** select (`Input`/select styled, e.g. "The Nest"). **From / To** date fields (two-up).
- **SHOW AS UNAVAILABLE** (eyebrow) → two `Checkbox` rows: "Confirmed events", "Held events".
- **DAYS OF THE WEEK** (eyebrow) → 7 toggle pills Mon…Sun (active = red) — a weekday multi-select.
- **AVAILABLE DATES IN RANGE** (eyebrow) → wrapped grid of computed date pills ("Fri · Jul 11", …) in a tinted panel;
  a **Copy dates** link (icon `copy`).
- **SHAREABLE LINK** (eyebrow) → read-only `Input` with the public URL + a copy `Button` (icon `copy`); helper line
  "Availabilities may change. This link reflects availability as of when it was generated."
- Footer: **Close**.

**Components.** `SectionHeader`, `Card`, `Chip`/`Button` (segmented toggles), `Input`, `Checkbox`, `StatusDot`,
`Badge`, `Modal`, `Button`, `Toast` (copy confirmations). **New composites required:**
- **`CalendarMonthGrid`** — props `{ month, events: CalEvent[], labelMode: 'performer'|'eventName'|'both', view:
  'month'|'week'|'day', onSelectDay, onSelectEvent, onCreateAt }`. Renders the 7×N grid + status-tinted event chips.
  (Core widget; not in DS.)
- **`SegmentedToggle`** — props `{ options: {value,label}[], value, onChange }` (the Month/Week/Day and
  Performer/EventName/Both switches). Could be built from `Chip`, but a dedicated segmented control is cleaner.
- **`AvailabilityShareModal`** — the modal above, wrapping DS `Modal`.

**Data needs.** calendar sources the operator owns (promoter events, performer shows, venue bookings) with
per-source color + visibility; events with title, performer, venue/room, date/time, status; tasks/appointments/notes
on dates; per-profile availability + unavailable blocks; computed available dates for a range+weekday filter; a
generated public availability share link.

---

# §3 — Events  *(no shot for the list — design from language; the event **detail** tabs are shots 04/05/07)*

**Purpose.** The operator's roster of events (containers). List → open one → the tabbed event workspace (the heart of
the app — the consolidated "Deal tab" experience).

## 3a. Events list (index route)

**Layout.** `SectionHeader` (eyebrow `EVENTS`, title "Events", `actions`: view toggle list/grid + `＋ New event`).
Optional KPI strip (counts by status). Then a **filter/segment row** (All · Draft · Suggested · Pending · Confirmed ·
Concluded · Cancelled — `Chip`s) + `SearchInput`. Then a **`DataTable`** (or card grid via view toggle).

**Sections & content.**
- **`DataTable` columns**: Event (name + code `EVT-…`), Performer (avatar + name), Venue, Date, Capacity, Status
  (`Badge`), Deal type, Projected net (€, right-aligned), overflow `⋯`. Row click → event detail. `pagination`.
- **Empty/loading:** `DataTable loading` skeleton rows; `EmptyState` (icon `calendar`, "No events yet",
  action `＋ New event`).

**Components.** `SectionHeader`, `Chip`, `SearchInput`, `DataTable`, `Badge`, `Avatar`, `Button`, `EmptyState`.

**Data needs.** events list: name, code, performer(s), venue, date, capacity, status, deal type, projected net;
status filter counts.

## 3b. Event detail — the tabbed workspace  *(shots 04, 05, 07)*

The single most important surface. One event, opened from the list/calendar/requests.

**Layout (shared header + tab bar, per-tab body).**
- **Breadcrumb**: `Events / {Event name}` (icon `calendar`).
- **Event header row**: big title (Clash Display, e.g. "Nils Frahm") + mono event code (`EVT-927162`) + a **status
  pill** ("Concluded"). Right cluster: **Unpublished/Published toggle** (eye/eye-off + `Toggle`), **currency select**
  (`EUR (€)` dropdown), **Invite Collaborator** (`Button` icon `user`+plus), **Share & Export** (`Button` icon
  `share`), **overflow `⋮`**.
- **Identity sub-row**: performer chip (`Avatar` initials `NF` + "Nils Frahm") · venue chip (`Avatar` `F` +
  "Funkhaus") · date ("Jul 04") — mono/tag styling.
- **Status timeline** (`Stepper`-like horizontal): Suggested → Pending → Confirmed → Concluded, dots colored, the
  connecting line orange/red; current stage bold. (This is a **richer Stepper** — see new composite.)
- **Tab bar** (`Tabs`, underline active = red): **To Do · Budget Planner · Event Details · Agreement · Team / Crew ·
  Settlement · Messages · Collaborators · Event History** (History carries a count badge, e.g. `3`/`6`).

**Tab: To Do.** Event-scoped todos. `SectionHeader` small + list of `TodoItem` (`onToggle`, `onDelete`) + an add-row
`Input`. Empty → `EmptyState` (icon `check`, "No tasks yet").
Data: event tasks (text, done, assignee?, due?).

**Tab: Budget Planner**  *(shot light-04).* Operator/co-promoter only (ceiling: never shown to performer/crew).
- Amber advisory banner: "This is an estimate only and should be reviewed before final decisions." (`Card` +
  icon `alert`).
- **Action pills**: Load Template (`file`), Save as Template (`file`), CSV, PDF, Share.
- **KPI row** (4 tinted `StatCard`): `TOTAL REVENUE` (green), `TOTAL COSTS` (red tint), `PROFIT / LOSS` (green),
  `BREAK-EVEN TICKETS` (amber, integer).
- **Two columns**: **Revenue** (green eyebrow) — `TICKET REVENUE` block: repeatable ticket-type rows
  (name `Input` · price `Input €` · qty `Input` · delete `trash`), a "Total ticket revenue" `KeyValueRow`
  (green value), **＋ Add ticket type**; then Capacity `Input`, Average bar spend per guest `Input`, Bar revenue
  (computed `KeyValueRow`). **Costs** (red eyebrow) — labeled amount rows: Performer fee, Production cost, Staff cost,
  Marketing cost, Venue cost, Other cost, Payment processing fees… each `KeyValueRow`-style label + `Input €`.
- Everything **live-recomputes** the KPI row on edit.
Data: ticket types (name, price, qty); capacity; avg bar spend; cost lines (label, amount); currency; derived totals,
P/L, break-even.

**Tab: Event Details.** Editable core fields: title, date/times, venue/room, stages, capacity, status, description,
publish state. Compose from `TextField`/`Input`/`Toggle` in a `Card`, grouped by `SectionHeader`.
Data: all event scalar fields + stages list.

**Tab: Agreement**  *(shot light-05).* The consolidated deal/agreement view (see §15.A cross-pattern).
- **Event Summary** `Card`: two-column `KeyValueRow` grid — Event, Date, Performer, Venue, Capacity, Operator,
  Status.
- **DEAL STRUCTURE** (eyebrow): `KeyValueRow`s — Deal Type ("Guarantee vs Door"), Cost Split
  ("Performer 70% / Promoter 20% / Venue 10%").
- **PRODUCTION SCHEDULE** (eyebrow): time-rows (mono time + label) — 15:00 Get-in, 16:00 Soundcheck, 19:00 Doors,
  20:00 Show, 23:00 Curfew. (`ListRow` with mono `leading` time.)
- **Live vs frozen** (brief §4): draft = editable inline; once all parties confirm/e-sign → locked read-only record +
  "All parties confirmed" state; render-to-PDF always available (Share & Export).
Data: deal terms (type, splits, guarantee/door figures, currency); agreement doc fields; production schedule rows;
confirmation state per party; accommodation/amenities/rider references.

**Tab: Team / Crew.** Crew added individually or as a saved **team** (reusable roster). Rows for each crew person
(`ListRow` / `ContactCard`): name, role (sound/lighting/…), on-platform vs placeholder-contact state, their deal
(fee) — with the note that a performer's own sub-hires are **private from the operator** (operator sees the person for
logistics, not the pay; brief §6). Add-crew and add-team actions.
Data: event crew (person/contact, role, on-platform flag, fee visible-to-operator?), saved teams available to attach.

**Tab: Settlement.** In-event entry point to the participant settlement(s); mirrors the Settlements detail (§6). Often
a summary + "Open settlement →". See §15.B.

**Tab: Messages.** Per-event thread(s), realtime (SSE). Message list + composer (`Input` + send). Read state.
Data: messages (author, body, timestamp, read state), participants.

**Tab: Collaborators**  *(shot light-07).*
- `SectionHeader` "Collaborators" / subtitle "Profiles and parties connected to this event" / `actions`: **＋ Invite**.
- **List of `ListRow`** (in a `Card`): `leading` `Avatar` (initials, tone), `title` party name, `meta` role
  ("Venue" / "Performer" / "Booking Agent"), `trailing` `Badge` state ("Invited" amber). Rows for e.g. Funkhaus
  Berlin (Venue), Nils Frahm (Performer), Paradigm Agency (Booking Agent).
Data: connected parties (name, kind/role, invite state, avatar); available invitees.

**Tab: Event History.** Per-role activity feed (brief §"History is per-role"). Chronological entries: who changed
what, when. Count badge on tab = unseen. Compose `ListRow` (time meta + actor + change) or a timeline.
Data: activity entries (actor, action, target, timestamp, visibility already scoped server-side).

**Components (detail).** `Tabs`, `Badge`, `Toggle`, `Button`, `Avatar`, `Tag`, `KeyValueRow`, `StatCard`, `Input`/
`TextField`, `ListRow`, `TodoItem`, `ContactCard`, `EmptyState`, `Card`, `Modal` (invite/share). **New composites:**
- **`EventStatusTimeline`** — props `{ stages: {key,label}[], current: string }`, the horizontal colored
  Suggested→Concluded rail (a themed superset of `Stepper`; `Stepper` is number-dots only).
- **`EventDetailHeader`** — the title + code + status + publish toggle + currency + action cluster + identity sub-row +
  timeline, so all tabs share one header. Wraps DS atoms.
- **`BudgetPlanner`** — the two-column live-recompute revenue/costs editor (its own module; the math lives in
  `@showme/settlement`-adjacent plain TS, the component only renders).
- **`ScheduleList`** — mono-time + label production-schedule rows (thin; could be `ListRow`).

**Which shot:** list = no shot; detail tabs = Budget (04), Agreement (05), Collaborators (07); Budget/Settlement math
detail also references Settlement shot (08).

---

# §4 — Tasks  *(no shot — design from language + brief; `TodoItem` is built for this)*

**Purpose.** Todos across scopes: personal / profile / event-scoped (brief §2). The operator's standalone task board
(the To-Do tab inside an event is the event-scoped slice of the same data).

**Layout.** `SectionHeader` (eyebrow `TASKS`, title "Tasks", `actions`: `＋ New task`). A **scope filter row**
(`Chip`: All · Personal · By profile · By event · Done). Optional grouping (Today / Upcoming / No date / Done). Then a
list of `TodoItem`.

**Sections & content.**
- Grouped **`TodoItem`** rows: checkbox (`onToggle`), text (strike-through when done), optional meta chips (scope /
  event / due date), delete (`onDelete`).
- Inline add-row `Input` per group or a top composer.
- **Empty/loading:** `Skeleton` rows; `EmptyState` (icon `check`, "You're all caught up", action `＋ New task`).

**Components.** `SectionHeader`, `Chip`, `TodoItem`, `Input`, `Badge`/`Tag` (scope), `EmptyState`, `Skeleton`.

**Data needs.** tasks (text, done, scope type = personal|profile|event, related profile/event, due date, assignee),
grouped/counted by scope + due bucket.

---

# §5 — Performance Reports  *(no shot — design from language; sibling of Financial Projections shot 10)*

**Purpose.** Backward-looking analytics on **concluded** events — how shows actually performed (attendance, revenue,
profit, margin, sell-through) vs projected. (Projections §7 = forward; Reports = actuals.)

**Layout.** `SectionHeader` (eyebrow `REPORTS` / `ANALYTICS`, title "Performance Reports", subtitle "How your past
shows actually performed", `actions`: date-range / filter). **KPI row** (4 `StatCard`) → **two-column body**: left =
a "Revenue by event" (or attendance) bar list; right = a `DataTable` of concluded events. Mirrors the Projections
layout (§7) but on realized numbers.

**Sections & content.**
- **KPI row** (`StatCard` ×4, tinted): `GROSS REVENUE (realized)` · `NET PROFIT` (+ margin hint) · `TICKETS SOLD` /
  avg sell-through · `AVG PER SHOW`.
- **Bar list card** ("Revenue by Event" or "Attendance by Event"): per-event `ProgressBar`/gradient bar + € value.
- **Table card** (`DataTable`): Event (name + venue), Date, Capacity, Sold (+ %), Revenue, Costs, Net (green/red),
  Margin %, vs-projection delta.
- **Empty/loading:** `EmptyState` (icon `trending-up`, "No concluded events yet"); `DataTable loading`.

**Components.** `SectionHeader`, `StatCard`, `ProgressBar` (or new bar), `DataTable`, `Chip` (range filter), `Badge`,
`EmptyState`. **New composite:** **`HorizontalBarList`** (shared with §7) — props `{ items: {label, value, max,
sublabel?}[], format }`, the gradient bar + right-aligned figure list.

**Data needs.** concluded events with realized: tickets sold, capacity, gross revenue, costs, net, margin, and the
originally projected figures for delta; aggregate KPIs; range filter.

---

# §6 — Settlements  *(shot: light-08-settlement)*

**Purpose.** End-of-event reconciliation — the operator's full **"who owes whom"** board + per-participant settlement
workspace. One settlement per participant; the operator sees all, arm's-length parties see only their slice
(brief §5). Platform tracks money, never holds it → confirmation UI is essential.

## 6a. Settlements list (index)

**Layout.** `SectionHeader` (eyebrow `SETTLEMENT`, title "Settlements", subtitle "Reconcile concluded events").
Segment `Chip` row by state (Open · Pending review · Finalized · Partly paid · Paid · Disputed). `DataTable`.
**Columns:** Event (name + venue), Party (avatar + name), Date, State (`Badge`), Net (€, +/- colored), Transfers
owed, Updated, `⋯`. Row click → settlement detail.
Data: settlements list (event, party, date, state, net, transfer count, updated).

## 6b. Settlement detail  *(shot light-08)*

**Layout.** Event-detail topbar variant (bell only). **Back to event** link. Header: eyebrow `SETTLEMENT`, big title
"Nils Frahm / Funkhaus" (party / venue), sub-line "Funkhaus · Berlin · Jul 04". Right: **state pill**
("● Pending review" amber), **currency select** (`EUR (€)`), **Report to PRO** (`Button` icon `music`).
Below: **process stepper**, **action row**, then **two-column body** (main editor left, comments/history right).

**Sections & content.**
- **Process stepper** (`Card`, numbered): Open ✓ → **Pending review** (active amber) → Comments received → Revised →
  Finalized → Partly paid → Paid. (Richer than DS `Stepper` — needs check/active/pending states + connectors.)
- **Action row** (pills): **Add revision** (outline), **Mark finalized** (primary gradient), **Flag dispute**
  (red-tinted outline).
- **Left — Revenue & deductions** (`Card`): heading + helper "Edit any figure — every payout recomputes live."
  Editable `KeyValueRow`+`Input €` rows: Gross ticket revenue, Door sales, Additional revenue, Ticketing fees (−€),
  Tax (−€), Refunds (−€)… negatives shown in red with `-€`. Live recompute.
- **(below, main) — Who owes whom / transfers** *(the settlement board, brief §5)*: per-participant lines — Owed,
  Collected, Paid, **Net**, and resulting **transfers** ("Party A → Party B €X") each with state **owed → paid →
  handled** and a manual override ("Mark as paid" / "Already handled"). Σ net = 0 invariant shown. (See §15.B.)
- **Right — Comments** (`Card`): threaded review comments — avatar + author ("Funkhaus Finance") + time ("2d ago") +
  body; a composer `Input` + **Post** (gradient). Realtime.
- **Right — Revision history** (`Card`): timeline dots — e.g. "Settlement auto-created on conclusion · Jul 05 · 09:12".
- **Tabs** (within detail, shot shows `Tabs`): **Overview · Deal Structure · Financials · Settlement · Payout** —
  underline active red. (Settlement = the reconcile editor above; Payout = transfer execution/marking; Deal Structure
  = the frozen deal; Financials = the money breakdown.)
- Multi-currency: figures settle in the deal currency; the currency select is **display-only** (cosmetic; never
  alters settled amounts — brief §5).
- **Empty/loading:** `Skeleton` on figures; a fresh settlement opens in "Open" state pre-filled from budget/deal.

**Components.** `SectionHeader`, `Tabs`, `Badge`, `Button`, `Card`, `KeyValueRow`, `Input`, `Avatar`, `Toast`.
**New composites:**
- **`SettlementStepper`** — props `{ steps: {label, state:'done'|'active'|'pending'}[] }`.
- **`WhoOwesWhomBoard`** — props `{ participants: SettleLine[], transfers: Transfer[], onMark(transferId, state) }`;
  renders the per-party net lines + directional transfer rows with owed/paid/handled controls and the Σ=0 check.
  (Central settlement widget — see §15.B; shared shape with the performer's single-slice card in the performer app.)
- **`RevenueDeductionsEditor`** — the live-recompute figures list.
- **`CommentThread`** — avatar/author/time/body + composer (reused by Messages).

**Data needs.** per settlement: revenue & deduction figures (gross, door, additional, ticketing fees, tax, refunds);
per-participant owed/collected/paid/net; transfers (from, to, amount, state); process state; comments (author, time,
body); revision history entries; deal structure snapshot; currency (settle vs display); PRO-report payload.

---

# §7 — Financial Projections  *(shot: light-10-projections)*

**Purpose.** Forward-looking P&L aggregated across the event pipeline (draft/pending/confirmed/upcoming). "Where is
the business heading."

**Layout.** `SectionHeader` (eyebrow `FORECAST`, title "Financial Projections", subtitle "Forward-looking P&L
aggregated across your event pipeline.", `actions`: segment **All events / Confirmed / Upcoming** `Chip`s, active
red). **KPI row** (4 tinted `StatCard`) → **two-column body**: left = "Revenue by Event" bar list card; right =
per-event `DataTable`.

**Sections & content.**
- **KPI row** (`StatCard` ×4): `PROJECTED REVENUE` (green, hint "8 events") · `PROJECTED COSTS` (red, hint "All-in") ·
  `NET PROFIT` (green, hint "66.5% margin") · `AVG PER EVENT` (amber, hint "Profit / show").
- **Revenue by Event** (`Card`): per-event row = label + right-aligned € + a full-width gradient `ProgressBar`
  (orange→red, width ∝ revenue). Zero-revenue events show an empty track ("Four Tet €0").
- **Table** (`Card` + `DataTable`): columns **EVENT** (name + venue sub), **REVENUE**, **PROFIT** (green/red),
  **MARGIN** (%). Negative profit red (e.g. Floating Points −€1,704 / −5%).
- **Filter** re-scopes both panels (All / Confirmed / Upcoming).
- **Empty/loading:** `EmptyState` (icon `trending-up`, "No events in pipeline"); `DataTable loading`.

**Components.** `SectionHeader`, `Chip`, `StatCard`, `ProgressBar`, `DataTable`, `EmptyState`. **New composite:**
`HorizontalBarList` (shared with §5).

**Data needs.** pipeline events with projected revenue, costs, profit, margin, venue; aggregate projected revenue /
costs / net / margin / avg-per-event; event-count; scope filter (all/confirmed/upcoming).

---

# §8 — Incoming Requests  *(shot: light-01-requests)*

**Purpose (brief §8, story: operator's booking inbox).** Inbound "request a date" flow — booking requests from
artists, agents, and venues. The operator triages: draft → offer / decline / block / archive. Sidebar badge = pending
count.

**Layout.** `SectionHeader` (eyebrow `INBOUND`, title "Incoming Requests" + amber count pill "4 pending", subtitle
"Manage booking requests from artists, agents, and venues."). **Two columns**: **left rail (~30%)** = a **mini
month calendar** + a "Requests by date" list; **main (~70%)** = selected-day header + status filter chips + a stack of
**request cards**.

**Sections & content.**
- **Left — mini calendar** (`Card`): month nav `‹ October 2026 ›`, MTWTFSS grid, selected day highlighted red (18).
  Days with requests marked. Selecting a day filters the main list.
- **Left — REQUESTS BY DATE** (`Card`, eyebrow): grouped list — **Earlier** / **Selected day** / **Later** — each row
  = mono date + requester name (Sep 26 Tom Fischer; Oct 18 Sarah Voss; Oct 18 Elif Demir; Nov 02 Kulturhaus Insel;
  Dec 12 Marcus Reid). Row click jumps the calendar/list.
- **Main — selected-day heading**: "October 18, 2026" + **status filter `Chip` row**: All · Pending · Accepted ·
  Declined · Draft · Archived · Blocked (active red).
- **Main — request cards** (`Card` each): header row = `Avatar` (initials, tone) + **requester name** (e.g. "Jon
  Hopkins") + **status `Badge`** ("Pending" amber) + **Profile →** link. Sub-line = "Sarah Voss · Paradigm Agency ·
  2h ago" (contact · agency · age). A **field grid** with mono eyebrow labels: `WANTED DATE` (Oct 18, 2026),
  `VENUE` (Printworks · London), `FEE` (€65,000), `EMAIL` (sarah@paradigm.com), `PHONE` (+44 …), `CAPACITY` (5,000).
  A quoted **message** panel (tinted) ("Jon is touring the new album — Printworks is the priority London date…").
  **Action row**: **Create Draft** (outline) · **Make Offer** (primary gradient) · **Decline** · **Block** ·
  **Archive** (ghost).
- **Empty/loading:** `EmptyState` (icon `inbox`, "No requests", "Requests from artists and agents will land here");
  `Skeleton` cards.

**Components.** `SectionHeader`, `Badge`, `Chip`, `Card`, `Avatar`, `Button`, `KeyValueRow`/mono field grid,
`EmptyState`, `Skeleton`. **New composites:**
- **`MiniMonthCalendar`** — props `{ month, markedDates, selected, onSelect, onNavigate }` (the left-rail picker; also
  reusable elsewhere).
- **`RequestCard`** — props `{ request, onCreateDraft, onMakeOffer, onDecline, onBlock, onArchive }`; the full
  requester + field-grid + message + actions card. (See §15.D requests calendar+cards pattern.)

**Data needs.** booking requests: requester name + profile, contact person, agency/venue, submitted age, wanted date,
target venue/room, fee, capacity, email, phone, free-text message, status (pending/accepted/declined/draft/archived/
blocked); dates with requests for the mini calendar; grouped by earlier/selected/later.

---

# §9 — Bills & Invoices  *(no shot — design from language + brief)*

**Purpose.** The operator's payables/receivables ledger — invoices they've issued and bills they owe (venue rental,
crew fees, production, ticketing fees), tied to events. Sidebar may carry an overdue badge.

**Layout.** `SectionHeader` (eyebrow `FINANCE` / `LEDGER`, title "Bills & Invoices", `actions`: `＋ New invoice`
/ filter). Optional KPI strip (Outstanding · Overdue · Paid this month). Segment `Chip` (All · Draft · Sent ·
Overdue · Paid · Bills · Invoices). `DataTable`.

**Sections & content.**
- **KPI strip** (`StatCard` ×3): `OUTSTANDING` (€) · `OVERDUE` (€, red) · `PAID (30d)` (€, green).
- **`DataTable` columns**: Doc # / type (Bill vs Invoice `Badge`), Counterparty (avatar + name), Event, Issued,
  Due, Amount (€), Status (`Badge`: draft/sent/overdue/paid), `⋯` (mark paid / send / download PDF).
- Row click → invoice detail (line items, counterparty, dates, PDF, mark-paid) — `Modal` or route.
- **Empty/loading:** `EmptyState` (icon `receipt`/`file`, "No bills or invoices yet", action `＋ New invoice`);
  `DataTable loading`.

**Components.** `SectionHeader`, `StatCard`, `Chip`, `DataTable`, `Badge`, `Avatar`, `Button`, `Modal`, `EmptyState`.
**New composite:** none strictly (invoice detail could reuse `KeyValueRow` + a line-item table).

**Data needs.** documents: number, type (bill|invoice), counterparty, related event, issued date, due date, amount,
currency, status, line items, PDF ref; KPI sums (outstanding, overdue, paid-30d).

---

# §10 — Team  *(shot: light-06-team)*

**Purpose (brief §6, "PEOPLE").** The operator's internal staff — members with roles/access across the operator's
profiles (venues/brands), organized into groups (Booking, Production, Marketing, Venue Ops).

**Layout.** `SectionHeader` (eyebrow `PEOPLE`, title "Team", subtitle "5 members · manage roles and access.",
`actions`: **list/grid view toggle** + **Invite Member** (primary gradient, icon `users`+plus)). Below: a
**PROFILES filter** chip row, a **GROUPS** card row, then the **members list**.

**Sections & content.**
- **PROFILES** (eyebrow) — `Chip` row: All · Blackbird Presents · The Nest · Halle 7 · Spree Garden (each with a
  colored `StatusDot`). Filters members by profile.
- **GROUPS** (eyebrow, with **＋ New group** on the right) — row of group `Card`s: each = colored dot + **group name**
  (Booking / Production / Marketing / Venue Ops) + edit `pencil` + remove `x`; a stack of member `Avatar`s (initials
  RK, LH, TD, MB…); footer "N members" + profile-scope ("BLACKBIRD PRESEN…" / "3 PROFILES").
- **Members list** — per member `ListRow`/row: `Avatar` (initials, tone) + **name** + presence `StatusDot` +
  **account-state `Badge`** ("On shoWMe" green / "Contact" amber) + email; a **group `Tag`** chip (Booking /
  Production+Venue Ops / Marketing); right side = **role title** + **access level** ("Owner/Owner",
  "Head of Booking/Admin", "Production Manager/Editor", "Finance/Admin", "Marketing/Editor") + overflow `⋮`.
- **Empty/loading:** `EmptyState` (icon `users`, "Invite your first teammate", action Invite Member); `Skeleton` rows.

**Components.** `SectionHeader`, `Chip`, `StatusDot`, `Card`, `Avatar`, `Badge`, `Tag`, `ListRow`, `Button`,
`EmptyState`. **New composites:**
- **`GroupCard`** — props `{ name, color, members: {initials,tone}[], memberCount, scopeLabel, onEdit, onRemove }`.
- **`TeamMemberRow`** — props `{ member, roleTitle, accessLevel, groups, presence, accountState, onMenu }` (or compose
  from `ListRow` with rich `trailing`).

**Data needs.** operator profiles (name, color); groups (name, color, members, member count, profile scope); members
(name, email, initials, presence, account state on/off-platform, group memberships, role title, access level = Owner/
Admin/Editor).

---

# §11 — Contacts  *(no shot — design from language + brief)*

**Purpose (brief §6).** The operator's address book — external people/organizations: artists, agents, venues, crew,
suppliers. Includes **placeholder contacts** that can later claim a real account (design both invited-real-user and
placeholder states). Distinct from Team (internal staff) and Audience (ticket buyers/CRM).

**Layout.** `SectionHeader` (eyebrow `CONTACTS`, title "Contacts", `actions`: list/grid toggle + **＋ Add contact**).
`SearchInput` + category `Chip` row (All · Artists · Agents · Venues · Crew · Suppliers). Then a **card grid** of
`ContactCard` (grid view) or a `DataTable`/`ListRow` list (list view).

**Sections & content.**
- **`ContactCard`** per contact: `Avatar` (initials, tone), name, role, email; **verified/unverified** `Badge`
  (IBAN verified vs Unverified) — the DS `ContactCard` already renders this; `linkedProfile` (handle + rating + kind)
  when the contact maps to a real shoWMe profile; **View Profile** action. Placeholder contacts show unverified + no
  linked profile.
- **List view**: `DataTable` — Name (avatar), Category, Org, Email, Phone, Linked profile?, Verified, `⋯`.
- **Empty/loading:** `EmptyState` (icon `user`/`building`, "No contacts yet", action Add contact); `Skeleton` cards.

**Components.** `SectionHeader`, `SearchInput`, `Chip`, `ContactCard`, `DataTable`, `Avatar`, `Badge`, `Button`,
`EmptyState`. **New composite:** none (DS `ContactCard` fits).

**Data needs.** contacts: name, category (artist/agent/venue/crew/supplier), org, email, phone, initials/avatar,
verified (IBAN) state, on-platform vs placeholder, linked profile (handle, kind, rating).

---

# §12 — Audience  *(shot: light-09-audience)*

**Purpose (eyebrow `CRM`).** The operator's fan/customer CRM — ticket buyers, newsletter subscribers, and social
followers across events. Marketing surface (distinct from Contacts = business address book).

**Layout.** `SectionHeader` (eyebrow `CRM`, title "Audience", subtitle "6 contacts across ticket buyers, newsletter
and socials.", `actions`: **grid/list view toggle**). Below: a **card grid** (3-up) of audience person cards; a list
view alternative.

**Sections & content.**
- **Audience card** (`Card`, centered): round `Avatar` (initials, tone) → **name** → email → **`Tag` chips** (city
  "Berlin"/"London"/"Bristol" + tier "VIP"/"Superfan") → divider → footer mono line "N events · {source}"
  ("8 events · Ticket buyer", "3 events · Newsletter", "2 events · Instagram").
- Likely filters/search by city, tier, source; segment building (implied, not in shot).
- **List view**: `DataTable` — Name, Email, City, Tier, Events attended, Source, Last seen.
- **Empty/loading:** `EmptyState` (icon `users`, "No audience yet", "Ticket buyers and subscribers appear here");
  `Skeleton` cards.

**Components.** `SectionHeader`, `Card`, `Avatar`, `Tag`, `DataTable`, `Chip`/`SearchInput` (filters), `EmptyState`.
**New composite:** **`AudienceCard`** — props `{ name, email, initials, tone, tags: string[], eventsCount, source }`
(centered layout differs from `ContactCard`; small dedicated card).

**Data needs.** audience contacts: name, email, initials, city, tier/segment tags (VIP/Superfan), events-attended
count, acquisition source (ticket buyer / newsletter / Instagram / etc.), last activity.

---

# §13 — My Profiles  *(no shot — design from language + brief)*

**Purpose (brief §"Operator is a role, not just a kind").** The operator account can hold multiple **profiles** —
distinct venues/brands (Blackbird Presents, The Nest, Halle 7, Spree Garden — seen as filter chips in Team). This
screen manages those profiles: public page, branding, details, and per-profile settings. A profile is also the public
surface (brief §8: public venue profile pages).

**Layout.** `SectionHeader` (eyebrow `PROFILES`, title "My Profiles", `actions`: **＋ New profile**). A **card grid**
of profile cards; selecting one opens a profile editor (route/`Tabs`).

**Sections & content.**
- **Profile card** (`Card`): logo/`Avatar` (brand tone/color), profile name, kind/type (Venue / Promoter brand),
  city, a couple of stats (events, capacity), **public/unpublished** `Badge`, "Edit" + "View public page" actions.
- **Profile editor** (on open): `Tabs` — **Details** (name, type, description, city, capacity, contact), **Branding**
  (logo, color, cover — the DS `Avatar tone` + color drives calendar/team dots), **Public page** (whitelisted public
  fields, preview, SSR link), **Members/Access** (which team members are scoped here — cross-links Team). Compose from
  `TextField`, `Toggle`, `Input`, `KeyValueRow`.
- **Empty/loading:** `EmptyState` (icon `building`, "Create your first venue profile", action New profile).

**Components.** `SectionHeader`, `Card`, `Avatar`, `Badge`, `Tabs`, `TextField`/`Input`, `Toggle`, `Button`,
`KeyValueRow`, `EmptyState`. **New composite:** **`ProfileCard`** — props `{ name, kind, city, color, published,
stats, onEdit, onViewPublic }` (or compose from `Card`).

**Data needs.** operator profiles: name, kind (venue/promoter brand), color, city, description, capacity, public
fields + published state, per-profile stats (events, upcoming), member scoping, public page URL.

---

# §14 — Settings  *(no shot — design from language + brief)*

**Purpose.** Account-level configuration for the operator: account, notifications, billing/plan (entitlements),
integrations, security, region/currency, danger zone.

**Layout.** `SectionHeader` (eyebrow `SETTINGS`, title "Settings"). A **left settings-nav** (`ListRow`/vertical
`Tabs`) + right detail panel; or a single scrolling column of `Card` sections.

**Sections & content.**
- **Account** (`Card`): name, email, avatar upload, account kind (Operator, read-only), password/auth.
- **Notifications** (`Card`): per-channel `Toggle` rows (email, in-app, realtime); read-state prefs (brief §7).
- **Display & region** (`Card`): **theme** (light/dark/system) `SegmentedToggle`/`Toggle`, **display currency**
  select (cosmetic FX; brief §5), timezone, language, **market/territory** (decisions #17 territory scope).
- **Plan & billing** (`Card`): current plan, **entitlements/limits** (events, profiles, seats — the separate
  fresh-read layer), usage `ProgressBar`, upgrade `Button`, payment method, invoices link.
- **Integrations** (`Card`): calendar/ICS, ticketing, PRO reporting, email (Brevo) — `ListRow` + connect `Toggle`.
- **Security** (`Card`): sessions, 2FA, API/agent-native access tokens (decisions #16 assistant/agent-native surface).
- **Danger zone** (`Card`): delete account (destructive `Button`).
- **Save** feedback via `Toast`.

**Components.** `SectionHeader`, `Card`, `Tabs`/`ListRow` (settings nav), `Toggle`, `TextField`/`Input`, `Checkbox`,
`Button`, `ProgressBar`, `Badge`, `KeyValueRow`, `Toast`. **New composite:** none.

**Data needs.** account profile (name, email, avatar, kind); notification prefs per channel; theme + display currency
+ timezone + market; plan + entitlement limits + usage; connected integrations; sessions/2FA/tokens.

---

# §15 — Cross-screen patterns (build once, reuse)

**A. The consolidated Deal / Agreement tab** (brief §4). Per participant, one surface unifying money terms + agreement
doc + accommodation/amenities + production schedule. **Live vs frozen**: editable draft that renders numbers live,
then freezes to an immutable "all parties confirmed" record; always PDF-renderable; e-sign is a later add-on. Appears
as the **Agreement** tab (§3b, shot 05) and feeds the **Settlement Deal Structure** tab (§6b). The performer app shows
only their own line of this same object. Build as `AgreementView` with a `frozen` flag.

**B. The Settlement "who owes whom" board** (brief §5). Per-participant Owed/Collected/Paid/**Net** lines + directional
**transfers** (A→B €X) each cycling **owed → paid → handled** with manual override, and a Σ net = 0 invariant. The
operator sees the **full board**; every arm's-length party sees only their **single-slice card** (same data, scoped).
`WhoOwesWhomBoard` (operator) + `SettlementSliceCard` (participant) share one data shape. Currency is settle-vs-display
(display cosmetic). Central to §6 (shot 08) and the event Settlement tab (§3b).

**C. Two topbar modes.** List/CRM routes get the global search + theme toggle + `＋ New event`. Event-detail and
Settlement-detail routes swap to a bell-only topbar and host their own rich header (title, status, publish toggle,
currency, Invite/Share). The router layout picks the mode per route.

**D. Requests = mini-calendar + cards.** Incoming Requests (§8, shot 01) pairs a left-rail `MiniMonthCalendar` +
"requests by date" list with a main column of `RequestCard`s filtered by selected day + status chips. The mini
calendar is reusable (dashboard, event date-picking). Request actions (Create Draft / Make Offer / Decline / Block /
Archive) are a fixed action set.

**E. Status vocabulary is one system.** `Badge` + `StatusDot` + `ProgressBar status` all read from the DS `Status`
palette (`suggested/pending/confirmed/hold/concluded/cancelled/draft/task`). Calendar adds **appointment** + **note**
tones → extend the palette rather than hardcode. Event timeline, settlement stepper, and every pill reuse it.

**F. KPI-row + bar-list + table triptych.** Financial Projections (§7), Performance Reports (§5), and Budget Planner
(§3b) share: a 4-tile `StatCard` row (green/red/amber tints) → a `HorizontalBarList` → a `DataTable`. Build the bar
list + tinted stat tiles once.

**G. Live-recompute editors.** Budget Planner (§3b) and Settlement Revenue & Deductions (§6b) are both "edit a figure,
totals recompute instantly" forms with the math in framework-agnostic TS (per CLAUDE.md), the component only rendering.

---

# New components to add to `@showme/design-system`

Ordered by leverage:
1. **`WhoOwesWhomBoard`** + **`SettlementSliceCard`** — the settlement core (§6, §15.B).
2. **`CalendarMonthGrid`** + **`MiniMonthCalendar`** — scheduling + requests (§2, §8).
3. **`EventStatusTimeline`** + **`SettlementStepper`** — richer than DS `Stepper` (states + connectors).
4. **`EventDetailHeader`** — shared event masthead (§3b).
5. **`BudgetPlanner`** / **`RevenueDeductionsEditor`** — live-recompute money editors (§3b, §6b).
6. **`RequestCard`** — booking-request card (§8).
7. **`HorizontalBarList`** + tinted-`StatCard` variant — analytics triptych (§5, §7).
8. **`GroupCard`** + **`TeamMemberRow`** — Team (§10).
9. **`AudienceCard`**, **`ProfileCard`** — small centered cards (§12, §13).
10. **`SegmentedToggle`** — Month/Week/Day, All/Confirmed/Upcoming, etc. (many screens).
11. **`CommentThread`** — settlement comments + event messages (§6, §3b).
12. **`AgreementView`** (with `frozen`) + **`ScheduleList`** — the deal tab (§3b, §15.A).

**New icons for `IconName`:** `trending-up, inbox, receipt, download, upload, share, edit, dots-vertical, eye, eye-off,
link, copy, calendar-check` (+ `appointment`/`note` status tones).

---

# Screen inventory (summary)

| # | Nav destination | Shot | Core widgets | New composites |
|---|---|---|---|---|
| 1 | Dashboard | none | KPI row · attention/upcoming lists · inbox+tasks preview | — |
| 2 | Calendar | 03 (+02 modal) | Month grid · controls · legend · availability modal | CalendarMonthGrid, SegmentedToggle, AvailabilityShareModal |
| 3 | Events (list + tabbed detail) | 04·05·07 | List/`DataTable`; detail = Stepper + 9 tabs (Deal tab core) | EventStatusTimeline, EventDetailHeader, BudgetPlanner, AgreementView |
| 4 | Tasks | none | Scoped `TodoItem` board | — |
| 5 | Performance Reports | none | KPI row · bar list · concluded-events table (actuals) | HorizontalBarList |
| 6 | Settlements | 08 | Stepper · revenue/deductions editor · who-owes-whom · comments | WhoOwesWhomBoard, SettlementStepper, CommentThread |
| 7 | Financial Projections | 10 | KPI row · revenue bar list · P&L table (forecast) | HorizontalBarList |
| 8 | Incoming Requests | 01 | Mini calendar + by-date list + request cards + status chips | MiniMonthCalendar, RequestCard |
| 9 | Bills & Invoices | none | KPI strip · ledger `DataTable` · invoice detail | — |
| 10 | Team | 06 | Profiles filter · group cards · member rows | GroupCard, TeamMemberRow |
| 11 | Contacts | none | Address-book `ContactCard` grid / list | — |
| 12 | Audience | 09 | CRM person-card grid | AudienceCard |
| 13 | My Profiles | none | Profile cards + editor tabs | ProfileCard |
| 14 | Settings | none | Sectioned account/notif/billing/region cards | — |

**Shell:** dark collapsible sidebar (14 nav items, order + icons + Incoming-Requests `4` badge above) · two-mode
topbar (search+theme+New event / bell) · theme-aware cream⇄ink content frame · `ToastProvider` + SSE-driven badges.
```
