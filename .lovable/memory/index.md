# Project Memory

## Core
Event management platform for promoters/venues. Space Grotesk headings, Inter body.
White marketing header nav. Sidebar logo → dashboard, header logo → /landing.
Lovable Cloud backend. No auth yet. Currency: EUR/USD/GBP/SEK per event.
Calendar sidebar shows only user-created profiles, not event-derived entities.

## Memories
- [Multi-Calendar System](mem://features/multi-calendar) — Per-entity calendar views with color-coded toggleable calendars and per-entity unavailability
- [Hold Ranking System](mem://features/hold-ranking) — Per-event hold ranks (1st/2nd/3rd) with auto-promote when higher hold removed
- [Calendar Import](mem://features/calendar-import) — ICS/CSV file import dialog for Google Calendar, Outlook, iCal
- [Festival Profile](mem://features/festival-profile) — Festival as OperatorRole, profile-based calendar entities, add/remove performers
- [Multi-Performer Events](mem://features/multi-performer-events) — Parent-child event architecture for festivals with per-performer deals, settlements, crew
- [Profile Management](mem://features/profile-management) — Multiple profiles with normalized base role logic
- [Event Lifecycle](mem://features/event-lifecycle) — Draft→Confirmed→Concluded auto-transition
- [Navigation Style](mem://style/navigation) — White marketing header, sidebar structure
- [Design Tokens](mem://style/design-tokens) — Space Grotesk + Inter, card-based UI
- [Data Persistence](mem://technical/data-persistence) — JSONB event_manager_data, debounced saves
- [Budget Planner](mem://features/budget-planner) — Card-based estimation tool with templates
- [Crew Tab](mem://features/crew-tab) — In-House Management with schedules/tasks/notes
- [Agreement Tab](mem://features/agreement-tab) — Dynamic reactive agreement auto-syncing
- [Team Management](mem://features/team-management) — Global team directory with multiple roles
