---
name: Hold Ranking System
description: Per-event hold ranks with auto-promotion and multi-date hold placement mode
type: feature
---
Events with `on_hold` status can have hold ranking metadata stored in `event_manager_data` JSONB:
- `holdRank: number` — 1 = 1st hold, 2 = 2nd, etc.
- `holdAutoPromote: boolean` — default true, auto-promotes when a higher hold is removed

Key behaviors:
- Hold rank badge displayed on event chips in calendar (e.g., "1st", "2nd", "3rd")
- ItemPopup shows hold settings (rank selector + auto-promote toggle) for on_hold events
- `promoteHoldsOnDate(date, removedRank)` in event-store scans same-date on_hold events and decrements ranks
- "Place Hold" mode in calendar: click dates to select, floating panel with per-date hold level, artist/venue fields
- Confirming holds creates on_hold events with the specified rank
