# Email & Push Notification Implementation Guide

This document describes how to add email notifications on top of the existing Firestore notification system using **Mailersend** or **Brevo** (formerly Sendinblue).

## Architecture

```
Firestore trigger (Cloud Function)
  ├── Write notification doc to profiles/{profileId}/notifications/{id}
  └── Check user notification preferences
        └── If email enabled for this notification type:
              └── Call Mailersend/Brevo API to send email
```

Email sending happens in the **same Cloud Function** that creates the Firestore notification document, after the write succeeds. This keeps it simple and avoids a second trigger.

## Provider Setup

### Option A: Mailersend

1. Create account at [mailersend.com](https://www.mailersend.com)
2. Verify your sending domain (DNS records: SPF, DKIM, DMARC)
3. Create an API token with `Email > Full Access` scope
4. Store the API token as a Firebase secret:
   ```bash
   firebase functions:secrets:set MAILERSEND_API_KEY
   ```
5. Install the SDK in `functions/`:
   ```bash
   cd functions && npm install mailersend
   ```

### Option B: Brevo

1. Create account at [brevo.com](https://www.brevo.com)
2. Verify your sending domain
3. Generate an API key in Settings > SMTP & API
4. Store as Firebase secret:
   ```bash
   firebase functions:secrets:set BREVO_API_KEY
   ```
5. Install the SDK:
   ```bash
   cd functions && npm install @getbrevo/brevo
   ```

## Notification Preferences

User notification preferences are stored at `users/{uid}/userSettings` in the `notificationPreferences` field:

```typescript
interface NotificationPreferences {
  email: {
    event_status_changed: boolean;
    settlement_status_changed: boolean;
    message_sent: boolean;
    collaborator_invited: boolean;
    booking_request_received: boolean;
    task_assigned: boolean;
    // ... one key per NotificationType
    weekly_summary: boolean;
  };
  push: {
    // Same keys — for future web push / mobile push
  };
}
```

### Reading preferences in Cloud Functions

When a notification is created, the Cloud Function needs to:

1. Get all member UIDs from `profiles/{profileId}/members`
2. For each member, read `users/{uid}/userSettings`
3. Check if `notificationPreferences.email[notificationType]` is enabled
4. If enabled, get the user's email from Firebase Auth (`admin.auth().getUser(uid)`)
5. Send the email

```typescript
import * as admin from "firebase-admin";

async function getEmailRecipientsForNotification(
  profileId: string,
  notificationType: string,
  excludeUid?: string, // don't notify the actor
): Promise<{ email: string; name: string }[]> {
  const db = admin.firestore();
  const membersSnap = await db
    .collection("profiles").doc(profileId)
    .collection("members").get();

  const recipients: { email: string; name: string }[] = [];

  for (const memberDoc of membersSnap.docs) {
    const memberUid = memberDoc.id;
    if (memberUid === excludeUid) continue;

    // Check preferences
    const settingsSnap = await db
      .collection("users").doc(memberUid)
      .collection("userSettings").doc("main").get();
    const prefs = settingsSnap.data()?.notificationPreferences?.email ?? {};

    // Default to true if preference not set
    if (prefs[notificationType] === false) continue;

    // Get email from Firebase Auth
    try {
      const userRecord = await admin.auth().getUser(memberUid);
      if (userRecord.email) {
        recipients.push({
          email: userRecord.email,
          name: userRecord.displayName || userRecord.email,
        });
      }
    } catch {
      // User not found or deleted — skip
    }
  }

  return recipients;
}
```

## Email Templates

### Mailersend approach

Use Mailersend's template system. Create templates in the dashboard, then reference by template ID:

```typescript
import { MailerSend, EmailParams, Sender, Recipient } from "mailersend";

const mailerSend = new MailerSend({ apiKey: process.env.MAILERSEND_API_KEY! });

async function sendNotificationEmail(
  to: { email: string; name: string },
  notification: { type: string; title: string; body: string; link?: string },
) {
  const sentFrom = new Sender("notifications@yourdomain.com", "shoWMe");
  const recipients = [new Recipient(to.email, to.name)];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject(notification.title)
    .setTemplateId("YOUR_TEMPLATE_ID")
    .setPersonalization([{
      email: to.email,
      data: {
        name: to.name,
        title: notification.title,
        body: notification.body,
        action_url: `https://app.showme.com${notification.link || "/"}`,
        notification_type: notification.type,
      },
    }]);

  await mailerSend.email.send(emailParams);
}
```

### Brevo approach

```typescript
const brevo = require("@getbrevo/brevo");

const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY!,
);

async function sendNotificationEmail(
  to: { email: string; name: string },
  notification: { type: string; title: string; body: string; link?: string },
) {
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.subject = notification.title;
  sendSmtpEmail.sender = { name: "shoWMe", email: "notifications@yourdomain.com" };
  sendSmtpEmail.to = [{ email: to.email, name: to.name }];
  sendSmtpEmail.templateId = 1; // Your Brevo template ID
  sendSmtpEmail.params = {
    name: to.name,
    title: notification.title,
    body: notification.body,
    action_url: `https://app.showme.com${notification.link || "/"}`,
  };

  await apiInstance.sendTransacEmail(sendSmtpEmail);
}
```

## Integration Point

In `functions/src/notifications.ts`, after writing the notification doc:

```typescript
// After creating the notification document...
const recipients = await getEmailRecipientsForNotification(
  profileId,
  notificationType,
  actorUid,
);

await Promise.allSettled(
  recipients.map((r) =>
    sendNotificationEmail(r, { type: notificationType, title, body, link })
  ),
);
```

## Weekly Summary Email

Add a scheduled Cloud Function:

```typescript
import { onSchedule } from "firebase-functions/v2/scheduler";

export const weeklySummary = onSchedule(
  { schedule: "every monday 09:00", timeZone: "Europe/Amsterdam", region: "europe-west1" },
  async () => {
    // 1. Get all users with weekly_summary email pref enabled
    // 2. For each user, aggregate unread notifications from the past 7 days
    // 3. Send a summary email via Mailersend/Brevo
  },
);
```

## Settings UI Integration

The `NotificationsTab.tsx` component already lists notification categories. Wire each toggle to update `users/{uid}/userSettings.notificationPreferences.email[type]` in Firestore. The Cloud Functions read these preferences before sending emails.

## Checklist

- [ ] Choose provider (Mailersend or Brevo)
- [ ] Verify sending domain (SPF, DKIM, DMARC)
- [ ] Store API key as Firebase secret
- [ ] Install provider SDK in `functions/`
- [ ] Create email templates in provider dashboard
- [ ] Add `notificationPreferences` field to user settings type
- [ ] Wire up NotificationsTab toggles to Firestore
- [ ] Add email sending to notification Cloud Functions
- [ ] Add weekly summary scheduled function
- [ ] Test with Firebase emulator
