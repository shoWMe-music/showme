---
name: Festival Profile Type
description: "festival" added as OperatorRole alongside venue/artist/promoter/organizer with calendar, settings, signup support
type: feature
---
- `OperatorRole` includes `"festival"` with label "Festival"
- `getBaseRole` handles "festival" prefix
- Festival profiles support capacity, location, sub-venues (rooms/stages) like venue profiles
- Calendar sidebar derives entities only from user-created profiles (created === true), not from event data
- CalendarEntity type includes "festival" type
- CreateEventDialog shows festival profile selector when multi-performer + festival type selected
- EventManagerPage supports add/remove performers on parent multi-performer events via inline dialogs
