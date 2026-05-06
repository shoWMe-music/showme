import { APP_BASE_URL } from "./appBaseUrl";

const LOGO_URL = `${APP_BASE_URL}/images/showme-logo.png`;

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>shoWMe</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 0;text-align:center">
              <img src="${LOGO_URL}" alt="shoWMe" height="36" style="height:36px;width:auto;display:inline-block;border:0;outline:none;text-decoration:none" />
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:24px 32px 32px">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e4e4e7;text-align:center">
              <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5">
                &copy; ${new Date().getFullYear()} shoWMe. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function passwordResetEmail(resetLink: string, recipientName?: string): { subject: string; html: string } {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#18181b">Reset your password</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#71717a;line-height:1.6">
      ${greeting} we received a request to reset your password. Click the button below to choose a new one.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:8px 0 24px">
          <a href="${resetLink}" target="_blank" style="display:inline-block;padding:12px 32px;background:#f97316;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
            Reset Password
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:13px;color:#a1a1aa;line-height:1.5">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 20px;font-size:12px;color:#f97316;word-break:break-all;line-height:1.5">
      ${resetLink}
    </p>
    <p style="margin:0;font-size:13px;color:#a1a1aa;line-height:1.5">
      If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
    </p>
    <p style="margin:16px 0 0;font-size:13px;color:#a1a1aa;line-height:1.5">
      This link expires in 1 hour.
    </p>`;

  return {
    subject: "Reset your password — shoWMe",
    html: baseLayout(content),
  };
}

export function verifyAndChangeEmailTemplate(opts: {
  verifyLink: string;
  newEmail: string;
  recipientName?: string;
}): { subject: string; html: string } {
  const greeting = opts.recipientName ? `Hi ${opts.recipientName},` : "Hi,";

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#18181b">Confirm your new email</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#71717a;line-height:1.6">
      ${greeting} we received a request to change your shoWMe sign-in email to <strong>${opts.newEmail}</strong>. Click the button below to confirm. After confirming, sign in with this address.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:8px 0 24px">
          <a href="${opts.verifyLink}" target="_blank" style="display:inline-block;padding:12px 32px;background:#f97316;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
            Confirm new email
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:13px;color:#a1a1aa;line-height:1.5">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 20px;font-size:12px;color:#f97316;word-break:break-all;line-height:1.5">
      ${opts.verifyLink}
    </p>
    <p style="margin:0;font-size:13px;color:#a1a1aa;line-height:1.5">
      If you didn't request this change, you can safely ignore this email — your sign-in address will stay the same.
    </p>`;

  return {
    subject: "Confirm your new email — shoWMe",
    html: baseLayout(content),
  };
}

export function otpEmail(code: string, recipientName?: string): { subject: string; html: string } {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#18181b">Verify your email</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#71717a;line-height:1.6">
      ${greeting} use the code below to verify your email address.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:8px 0 24px">
          <span style="display:inline-block;padding:16px 32px;background:#f4f4f5;border-radius:8px;font-size:28px;font-weight:700;letter-spacing:6px;color:#18181b;font-family:monospace">
            ${code}
          </span>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#a1a1aa;line-height:1.5">
      This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.
    </p>`;

  return {
    subject: `${code} is your shoWMe verification code`,
    html: baseLayout(content),
  };
}

export function invitationEmail(opts: {
  recipientName: string;
  senderName: string;
  eventName?: string;
  signupLink: string;
  invitationCode: string;
  message?: string;
}): { subject: string; html: string } {
  const eventLine = opts.eventName
    ? ` to collaborate on <strong>${opts.eventName}</strong>`
    : "";
  const messageLine = opts.message
    ? `<p style="margin:16px 0;padding:12px 16px;background:#f4f4f5;border-radius:8px;font-size:14px;color:#3f3f46;line-height:1.6;font-style:italic">"${opts.message}"</p>`
    : "";

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#18181b">You've been invited</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#71717a;line-height:1.6">
      Hi ${opts.recipientName}, <strong>${opts.senderName}</strong> has invited you${eventLine} on shoWMe.
    </p>
    ${messageLine}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:8px 0 16px">
          <a href="${opts.signupLink}" target="_blank" style="display:inline-block;padding:12px 32px;background:#f97316;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
            Accept Invitation
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:13px;color:#a1a1aa;line-height:1.5">
      Your invitation code:
    </p>
    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#18181b;letter-spacing:2px;font-family:monospace">
      ${opts.invitationCode}
    </p>
    <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5">
      If the button doesn't work, go to <span style="color:#f97316">${opts.signupLink}</span>
    </p>`;

  return {
    subject: `${opts.senderName} invited you to shoWMe`,
    html: baseLayout(content),
  };
}

// ── Booking-request emails (Wave 7 A2) ──
//
// The "Want to manage this directly?" CTA links to plain /signup — Daniel
// deferred the ?redirect=<currentPath> plumbing to a later wave.

function signupCallToAction(signupLink: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #e4e4e7">
      <tr>
        <td style="padding:20px 0 0">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#18181b">
            Want to manage this directly?
          </p>
          <p style="margin:0 0 12px;font-size:13px;color:#71717a;line-height:1.5">
            Create a free shoWMe account to track requests, settle events, and message collaborators in one place.
          </p>
          <a href="${signupLink}" target="_blank" style="display:inline-block;padding:10px 20px;background:#f97316;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;border-radius:8px">
            Sign up free
          </a>
        </td>
      </tr>
    </table>`;
}

export function bookingRequestNotificationEmail(opts: {
  recipientName?: string;
  requesterName: string;
  artistName?: string;
  wantedDate?: string;
  note?: string;
  appBaseUrl: string;
}): { subject: string; html: string } {
  const greeting = opts.recipientName ? `Hi ${opts.recipientName},` : "Hi,";
  const artistLine = opts.artistName
    ? ` for <strong>${opts.artistName}</strong>`
    : "";
  const dateLine = opts.wantedDate
    ? ` on <strong>${opts.wantedDate}</strong>`
    : "";
  const noteBlock = opts.note
    ? `<p style="margin:16px 0;padding:12px 16px;background:#f4f4f5;border-radius:8px;font-size:14px;color:#3f3f46;line-height:1.6;font-style:italic">"${opts.note}"</p>`
    : "";

  const signupLink = `${opts.appBaseUrl.replace(/\/$/, "")}/signup`;

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#18181b">New booking request</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#71717a;line-height:1.6">
      ${greeting} <strong>${opts.requesterName}</strong> just sent you a booking request${artistLine}${dateLine}.
    </p>
    ${noteBlock}
    ${signupCallToAction(signupLink)}`;

  return {
    subject: `New booking request from ${opts.requesterName}`,
    html: baseLayout(content),
  };
}

export function profileAdminInviteEmail(opts: {
  recipientEmail: string;
  profileName: string;
  senderName: string;
  role: "admin" | "editor";
  appBaseUrl: string;
}): { subject: string; html: string } {
  const roleLabel = opts.role === "admin" ? "an admin" : "an editor";
  const acceptLink = `${opts.appBaseUrl.replace(/\/$/, "")}/accept-invite?email=${encodeURIComponent(opts.recipientEmail)}`;

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#18181b">You've been invited</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#71717a;line-height:1.6">
      <strong>${opts.senderName}</strong> invited you to be ${roleLabel} on <strong>${opts.profileName}</strong> on shoWMe.
    </p>
    <p style="margin:0 0 20px;font-size:14px;color:#71717a;line-height:1.6">
      Click below to verify your email and finish creating your account. Your access to <strong>${opts.profileName}</strong> is granted automatically.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:8px 0 24px">
          <a href="${acceptLink}" target="_blank" style="display:inline-block;padding:12px 32px;background:#f97316;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
            Accept invitation
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5">
      If the button doesn't work, go to <span style="color:#f97316;word-break:break-all">${acceptLink}</span>
    </p>`;

  return {
    subject: `${opts.senderName} invited you to manage ${opts.profileName} on shoWMe`,
    html: baseLayout(content),
  };
}

export function eventCollaboratorInviteEmail(opts: {
  recipientName: string;
  senderName: string;
  eventName: string;
  venueName?: string;
  eventDate?: string;
  role: string;
  message?: string;
  eventLink: string;
}): { subject: string; html: string } {
  const roleLower = (opts.role || "collaborator").toLowerCase();
  const isPerformer = roleLower === "performer";
  const venueOnDate =
    opts.venueName && opts.eventDate
      ? `${opts.venueName} on ${opts.eventDate}`
      : opts.venueName || opts.eventDate || opts.eventName;

  const subject = isPerformer
    ? `${opts.senderName} invited you to play at ${venueOnDate}`
    : `${opts.senderName} invited you to ${opts.eventName}`;

  const headline = isPerformer
    ? `${opts.senderName} invited you to play at <strong>${opts.venueName || opts.eventName}</strong>${opts.eventDate ? ` on <strong>${opts.eventDate}</strong>` : ""}.`
    : `${opts.senderName} added you as ${roleLower} on <strong>${opts.eventName}</strong>${opts.venueName ? ` at <strong>${opts.venueName}</strong>` : ""}${opts.eventDate ? ` on <strong>${opts.eventDate}</strong>` : ""}.`;

  const messageBlock = opts.message
    ? `<p style="margin:16px 0;padding:12px 16px;background:#f4f4f5;border-radius:8px;font-size:14px;color:#3f3f46;line-height:1.6;font-style:italic">"${opts.message}"</p>`
    : "";

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#18181b">You've been added to an event</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#71717a;line-height:1.6">
      Hi ${opts.recipientName}, ${headline}
    </p>
    ${messageBlock}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:8px 0 16px">
          <a href="${opts.eventLink}" target="_blank" style="display:inline-block;padding:12px 32px;background:#f97316;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
            Open event
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5">
      If the button doesn't work, go to <span style="color:#f97316;word-break:break-all">${opts.eventLink}</span>
    </p>`;

  return {
    subject,
    html: baseLayout(content),
  };
}

export function teamMemberMessageEmail(opts: {
  recipientName: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
}): { subject: string; html: string } {
  const escapedBody = opts.body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#18181b">${opts.subject}</h2>
    <p style="margin:0 0 16px;font-size:13px;color:#a1a1aa;line-height:1.5">
      Hi ${opts.recipientName}, this message is from <strong>${opts.senderName}</strong> &lt;${opts.senderEmail}&gt;. Reply directly to this email to respond.
    </p>
    <div style="margin:16px 0;padding:16px;background:#f4f4f5;border-radius:8px;font-size:14px;color:#3f3f46;line-height:1.6">
      ${escapedBody}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5">
      Sent via shoWMe team management.
    </p>`;

  return {
    subject: opts.subject,
    html: baseLayout(content),
  };
}

export function bookingRequestConfirmationEmail(opts: {
  requesterName: string;
  targetName?: string;
  wantedDate?: string;
  appBaseUrl: string;
}): { subject: string; html: string } {
  const targetLine = opts.targetName
    ? ` to <strong>${opts.targetName}</strong>`
    : "";
  const dateLine = opts.wantedDate
    ? ` for <strong>${opts.wantedDate}</strong>`
    : "";

  const signupLink = `${opts.appBaseUrl.replace(/\/$/, "")}/signup`;

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#18181b">We've sent your request</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#71717a;line-height:1.6">
      Hi ${opts.requesterName}, your booking request${targetLine}${dateLine} has been delivered. You'll hear back as soon as they review it.
    </p>
    ${signupCallToAction(signupLink)}`;

  return {
    subject: opts.targetName
      ? `Your booking request to ${opts.targetName} is on its way`
      : "Your booking request is on its way",
    html: baseLayout(content),
  };
}
