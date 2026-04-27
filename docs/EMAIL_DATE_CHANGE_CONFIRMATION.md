# Email: Date Change Confirmation (Off-Platform Parties)

## Overview

When an event organizer changes the date, start time, or end time, all involved parties must confirm the change. For parties that are **not on the platform** (no account/profile), confirmation happens via email.

## When to Send

An email is triggered when:

1. An organizer proposes a date change (updates `date`, `startTime`, or `endTime`)
2. One or more parties in `pendingDateChange.confirmations` have `onPlatform: false`
3. Each off-platform party receives one email per proposed change

## Recipient Resolution

- **Performer (off-platform)**: Use the performer's email from the event collaborators list (`EventCollaborator.email` where `eventRole === "artist"`) or from the booking request (`sourceRequestId` -> request contact email).
- **Venue (off-platform)**: Use the venue collaborator's email (`EventCollaborator.email` where `eventRole === "venue"`).

## Email Content

### Subject Line
`Date change proposed for "{event.name}" on {previousDate}`

### Body Should Include

1. **Event name** and current date
2. **Proposed changes** (clearly formatted):
   - Date: `{previousDate}` -> `{proposedDate}`
   - Start time: `{previousStartTime}` -> `{proposedStartTime}` (if changed)
   - End time: `{previousEndTime}` -> `{proposedEndTime}` (if changed)
3. **Who proposed it**: organizer name and profile name
4. **Two action buttons/links**:
   - **Confirm** - links to a tokenized URL that confirms the change
   - **Decline** - links to a tokenized URL that declines the change
5. **Event details summary**: venue, artist, city (for context)
6. **Note**: "This change will not take effect until all parties have confirmed."

### Token-Based Confirmation URLs

Since the recipient has no account, the confirmation links must be tokenized:

```
https://{domain}/confirm-date-change?token={uniqueToken}&response=confirmed
https://{domain}/confirm-date-change?token={uniqueToken}&response=declined
```

The token should:
- Be stored in Firestore (e.g., `date_change_tokens/{token}`)
- Map to: `{ eventId, profileId, dateChangeId, createdAt, expiresAt }`
- Expire after 30 days (or never, since there's no deadline)
- Be single-use (mark as used after first response)

## Backend Implementation

### Cloud Function: `sendDateChangeEmail`

Trigger: Firestore `onWrite` on `events/{eventId}/meta/main` when `pendingDateChange` is created or updated.

Steps:
1. Detect new `pendingDateChange` (compare before/after)
2. For each confirmation with `onPlatform: false` and `status: "pending"`:
   - Generate a unique token
   - Store token in `date_change_tokens` collection
   - Send email via SendGrid/Postmark/etc.
3. Log the email send in event activity

### Cloud Function: `handleDateChangeResponse`

Trigger: HTTP endpoint (GET) at `/confirm-date-change`

Steps:
1. Validate token exists, is not expired, and is not used
2. Read the event's `pendingDateChange` from meta
3. Update the confirmation status for the matching `profileId`
4. Mark token as used
5. If all confirmations are now "confirmed":
   - Apply date change to event document
   - Clear `pendingDateChange` from meta
   - Log `date_change_confirmed` activity
6. If declined:
   - Log `date_change_declined` activity
7. Redirect to a simple confirmation/thank-you page

### Confirmation Landing Page

A simple static page at `/confirm-date-change` that:
- Shows "Date change confirmed" or "Date change declined" message
- Shows the event name and new date
- Includes a link to sign up for the platform (optional)

## Data Model Reference

```typescript
// Firestore: date_change_tokens/{token}
interface DateChangeToken {
  token: string;
  eventId: string;
  profileId: string;
  dateChangeId: string;       // matches PendingDateChange.id
  createdAt: string;          // ISO timestamp
  expiresAt: string;          // ISO timestamp (30 days from creation)
  used: boolean;
  usedAt?: string;
  response?: "confirmed" | "declined";
}
```

## Email Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `eventName` | Event name | "Summer Festival 2026" |
| `previousDate` | Current event date | "Sat, 15 May 2026" |
| `proposedDate` | New proposed date | "Sat, 22 May 2026" |
| `previousStartTime` | Current start time | "20:00" |
| `proposedStartTime` | New start time | "21:00" |
| `previousEndTime` | Current end time | "23:00" |
| `proposedEndTime` | New end time | "00:00" |
| `organizerName` | Who proposed the change | "John Doe" |
| `organizerProfile` | Profile name | "Sunset Events" |
| `venueName` | Venue name | "The Grand Hall" |
| `artistName` | Performer name | "DJ Shadow" |
| `confirmUrl` | Tokenized confirm link | `https://...` |
| `declineUrl` | Tokenized decline link | `https://...` |

## Follow-Up Emails

Consider sending a reminder email if no response is received after 7 days. This can be implemented as a scheduled Cloud Function that checks for pending confirmations with `onPlatform: false` older than 7 days.
