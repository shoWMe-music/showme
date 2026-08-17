# Venue (operator) app — build plan

Rebuild the operator/venue logged-in view in `apps/web` to match the Claude Design prototype
(project `004a889b-f032-4801-8c67-df58241e9227`, operator = "Blackbird Presents / All View"), using
`@showme/design-system` in **both light and dark themes**, wired to the **existing API**. All 14 nav
destinations. **Visual/UX spec per screen → `screen-specs.md`** (this doc owns API binding + architecture + order).

## Foundations (build first — everything depends on these)

1. **Theme** — DS is dark-default with semantic tokens; drive light/dark via `data-theme` on `<html>` (AppShell already toggles it). Every screen uses DS tokens only — no hardcoded colors — so both themes work.
2. **Acting profile** — `apps/web/src/lib/activeProfile.ts` (done). Wire `getProfileId` in `main.tsx` to it; `AuthProvider` sets it from the session's first membership; topbar profile switcher updates it. Required for all profile-scoped mutations (`X-Profile-Id`).
3. **Shell** — dark sidebar (14 nav items, icons, live badges), topbar (`SearchInput` + theme toggle + notifications + profile menu + orange-gradient **＋ New event**), content frame with the subtle grid ground. See screen-specs "Shell".
4. **Router** — a route per destination (below). Replace the current 3-route tree.

## Screen → API binding

| # | Nav | Endpoints | Notes |
|---|---|---|---|
| 1 | Dashboard | `GET /events`, `GET /insights/profiles/:id/summary`, `GET /insights/profiles/:id/revenue`, `GET /booking-requests`, `GET /notifications` | KPIs + upcoming events + recent requests + money |
| 2 | Calendar | `GET /calendar` | month grid; event + hold items by date |
| 3 | Events | `GET /events`, `POST /events` (create), `GET /events/:id` | list + New-event modal |
| — | Event detail (workspace) | `/events/:id/participants·deals·budgets·settlements·schedule·riders·messages·setlists` | consolidated **Deal tab**, Budget, Settlement board, Collaborators, Schedule |
| 4 | Tasks | `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id` | todo list (personal/profile/event) |
| 5 | Performance Reports | `GET /insights/profiles/:id/revenue` + `/summary` | analytics; **partial** — empty-state what the API can't yet give |
| 6 | Settlements | `GET /events` → per-event `GET /events/:id/settlements` | cross-event overview → drill into event settlement board |
| 7 | Financial Projections | `GET /insights/profiles/:id/revenue` | projections; **partial** → empty-state gaps |
| 8 | Incoming Requests | `GET /booking-requests`, `GET /offers`, `POST /booking-requests/:id/flag-spam`, accept→`/events/:id/handoff` or `/offers` | inbox (light-01): calendar rail + request cards + actions |
| 9 | Bills & Invoices | `GET /invoices`, `GET /profiles/:id/invoices`, `POST /invoices`, `POST /invoices/:iid/issue` | AR/AP |
| 10 | Team | `GET /groups`, `GET /groups/:gid/members` | reusable rosters (light-06) |
| 11 | Contacts | `GET /profiles/:id/contacts` | address book (light-07) |
| 12 | Audience | audience_rsvps — **no operator GET yet** | empty-state now; small `GET /events/:id/audience` later |
| 13 | My Profiles | `GET /profiles`, `GET /me`, `POST /profiles` | profile switcher + management |
| 14 | Settings | `GET /me`, `GET /profiles/:id`, `PATCH /me`, `PATCH /profiles/:id/billing`, payout-accounts, `GET /plans/:profileId` | account + profile + **legal/VAT billing** (deferred from onboarding lands here) + payout + plan |

## Data gaps (honest empty states — no mock data, per the brief)
- **Audience**: no operator RSVP read endpoint → clean empty/"coming soon".
- **Performance Reports / Financial Projections**: only `insights` revenue/summary exist → show what's real, empty-state the rest.

## Seed extension (so venue screens show real content)
Extend `packages/db/src/seed.ts` for the operator to add: a few `booking_requests` (pending), `contacts`, a `group`/team + members, `invoices`, `tasks`, `calendar_items`. Keeps Requests/Contacts/Team/Bills/Tasks/Calendar alive against real data.

## Build order (orchestrated; each screen = one delegated unit built from screen-specs.md + this binding, DS components, both themes)
1. **Foundations** — shell, theme, router, acting profile.
2. **Core** — Dashboard · Events + New-event · Event detail workspace (Deal/Budget/Settlement/Collaborators/Schedule).
3. **Operator daily** — Incoming Requests · Settlements · Calendar · Tasks · Contacts · Team.
4. **Money/admin** — Bills & Invoices · My Profiles · Settings.
5. **Analytics (data-limited)** — Performance Reports · Financial Projections · Audience.
6. **Seed extension + per-screen verification** — Playwright screenshot each screen (both themes) vs the prototype shots.

## Verification
Drive the app as the seeded operator; screenshot each screen in light + dark; compare to `apps/marketing/public/assets/shots/light-0*.webp` and the prototype. Typecheck + Biome + e2e green.
