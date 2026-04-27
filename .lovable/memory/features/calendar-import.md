---
name: Calendar Import
description: ICS and CSV file import dialog for importing events from Google Calendar, Outlook, iCal
type: feature
---
`src/components/ImportCalendarDialog.tsx` — Import dialog with two tabs:
- **ICS tab**: Accepts .ics/.ical files, parses VEVENT blocks (SUMMARY, DTSTART, DTEND, LOCATION, DESCRIPTION)
- **CSV tab**: Accepts .csv with columns title/name, date, start_time, end_time, location, description

Features:
- Row preview table with select/deselect checkboxes
- Import as "Calendar Items" (appointments) or "Events"
- File drop zone with drag-and-drop support
- Date normalization (ISO, US, EU formats)
- Success state with "Import More" option
