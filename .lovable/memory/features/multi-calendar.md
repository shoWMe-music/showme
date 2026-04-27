---
name: Multi-Calendar System
description: Per-entity calendar views with color-coded toggleable calendars and per-entity unavailability
type: feature
---
Calendar entities are derived automatically from events + profiles (unique venue names, artist names, sub-venues/rooms).

Key behaviors:
- Each entity gets a color from a 10-color palette
- "Calendars" popover in filter bar grouped by type (Venues, Artists, Rooms/Stages)
- Events filtered by visible calendars (venue or artist match)
- Unavailability is tracked per entity: `Record<string, Set<string>>`
- Auto-unavailability applies per-entity (confirmed/on_hold at "Venue A" only marks that venue)
- Mark Unavailable mode includes entity selector when multiple calendars exist
- Share Availability dialog includes calendar entity selector
- Event chips show colored dot matching their calendar entity
- `calendar_items` table has optional `calendar_entity` text column
- Replaces old sub-venue toggles
