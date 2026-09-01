/**
 * Transactional email templates — the copy and markup for every message shoWMe
 * sends. Plain framework-agnostic TypeScript: no Fastify, no database, no design
 * system import (the API must not depend on `design-system/`, so the handful of
 * brand values it needs are duplicated as literals below and kept in sync by
 * hand). Routes stay thin — they gather the facts, call one render function, and
 * hand the result straight to the `EmailSink`.
 *
 * Every message renders BOTH parts: `html` for the majority of clients and a
 * real `text` alternative, which plain-text readers need and which spam filters
 * read as a signal of a legitimately-composed message.
 *
 * The HTML deliberately targets 2003-era email clients, not browsers: a nested
 * `<table>` skeleton, inline styles only, no stylesheet, no web font, no
 * flexbox/grid, no JavaScript. Outlook renders through Word and silently drops
 * anything more modern.
 */

import type { RenderedEmail } from "@showme/shared";

/** Brand values, copied from `design-system/src/styles/tokens.css`. */
const BRAND = {
  /** `--ink-1000` — the page ground. */
  ground: "#0A0604",
  /** `--ink-900` — the card the message sits on. */
  surface: "#18100C",
  /** `--ink-700` — hairline borders. */
  border: "#2E2118",
  /** `--ink-100` — body copy. */
  text: "#F5EDE2",
  /** `--ink-300` — secondary copy and the footer. */
  muted: "#B8A99B",
  /** `--brand-red` — the primary. */
  accent: "#EE5746",
  accentText: "#FFFFFF",
} as const;

// The brand faces (Clash Display / Inter Tight) are web fonts; email clients do
// not load them, so the wordmark and the copy use the safest system stack there
// is rather than falling back unpredictably.
const FONT_STACK = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Where the web app is served from, with no trailing slash. */
export const DEFAULT_PUBLIC_APP_BASE_URL = "http://localhost:5174";

/**
 * The public origin of the web app, used to build the links in these messages.
 * Read from `PUBLIC_APP_BASE_URL` (declared in `config.ts`) and defaulted to the
 * local Vite dev server, matching how `LEADS_ALLOWED_ORIGINS` defaults — an
 * unconfigured environment is a developer's laptop. Production MUST set it; a
 * domain is never hardcoded into a template.
 */
export function resolvePublicAppBaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.PUBLIC_APP_BASE_URL?.trim();
  const base = configured && configured.length > 0 ? configured : DEFAULT_PUBLIC_APP_BASE_URL;
  return base.replace(/\/+$/, "");
}

/** Join a relative app path onto the public base URL, yielding an absolute URL. */
export function buildApplicationUrl(path: string, baseUrl = resolvePublicAppBaseUrl()): string {
  return new URL(path, `${baseUrl}/`).toString();
}

/** The event facts a recipient needs to recognize which show is meant. */
export interface EventSummary {
  id: string;
  title: string;
  /** `yyyy-mm-dd` from the `date` column, or null when the show is not dated yet. */
  eventDate?: string | null;
  venueName?: string | null;
}

/** Recipient- and title-safe HTML. Every interpolated value passes through here. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// `en-GB` and an explicit UTC zone: `events.event_date` is an offset-free
// calendar date, so formatting it in the server's local zone would shift the
// show a day either way depending on where Cloud Run happens to run it.
const EVENT_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** `2026-09-12` → `Saturday 12 September 2026`. Null when absent or unparseable. */
export function formatEventDate(eventDate: string | null | undefined): string | null {
  if (!eventDate) return null;
  const parsed = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return EVENT_DATE_FORMAT.format(parsed);
}

/** One labelled fact in the detail block ("Event", "Date", "Venue"). */
interface DetailRow {
  label: string;
  value: string;
}

/** The one shape every message is poured into. */
interface EmailLayout {
  subject: string;
  /** The line inbox previews show after the subject — write it, or clients pick a random fragment. */
  preheader: string;
  heading: string;
  /** Body copy, one entry per paragraph. Plain strings; escaped on render. */
  paragraphs: string[];
  details?: DetailRow[];
  /** A short value the recipient reads and types back (an OTP, an invite code). */
  callout?: { label: string; value: string };
  action?: { label: string; url: string };
  footerNote: string;
}

function renderDetailsHtml(details: DetailRow[]): string {
  const rows = details
    .map(
      (detail) => `
              <tr>
                <td style="padding:0 0 6px 0;font-family:${FONT_STACK};font-size:12px;line-height:16px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:.06em;">${escapeHtml(detail.label)}</td>
              </tr>
              <tr>
                <td style="padding:0 0 14px 0;font-family:${FONT_STACK};font-size:16px;line-height:22px;color:${BRAND.text};font-weight:700;">${escapeHtml(detail.value)}</td>
              </tr>`,
    )
    .join("");
  return `
          <tr>
            <td style="padding:6px 0 22px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:${BRAND.ground};border:1px solid ${BRAND.border};border-radius:8px;">
                <tr>
                  <td style="padding:18px 20px 4px 20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${rows}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function renderCalloutHtml(callout: { label: string; value: string }): string {
  return `
          <tr>
            <td align="center" style="padding:6px 0 22px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:${BRAND.ground};border:1px solid ${BRAND.border};border-radius:8px;">
                <tr>
                  <td align="center" style="padding:18px 32px;font-family:${FONT_STACK};font-size:12px;line-height:16px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:.06em;">${escapeHtml(callout.label)}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:0 32px 20px 32px;font-family:${FONT_STACK};font-size:34px;line-height:38px;font-weight:700;letter-spacing:.18em;color:${BRAND.accent};">${escapeHtml(callout.value)}</td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function renderActionHtml(action: { label: string; url: string }): string {
  const url = escapeHtml(action.url);
  return `
          <tr>
            <td style="padding:6px 0 20px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                <tr>
                  <td bgcolor="${BRAND.accent}" style="border-radius:6px;">
                    <a href="${url}" style="display:inline-block;padding:13px 26px;font-family:${FONT_STACK};font-size:15px;line-height:18px;font-weight:700;color:${BRAND.accentText};text-decoration:none;border-radius:6px;">${escapeHtml(action.label)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 22px 0;font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${BRAND.muted};">
              If the button does not work, copy this link into your browser:<br />
              <a href="${url}" style="color:${BRAND.accent};text-decoration:underline;word-break:break-all;">${url}</a>
            </td>
          </tr>`;
}

/** Pour a layout into the table skeleton. The only place markup is written. */
function renderHtml(layout: EmailLayout): string {
  const paragraphs = layout.paragraphs
    .map(
      (paragraph) => `
          <tr>
            <td style="padding:0 0 16px 0;font-family:${FONT_STACK};font-size:15px;line-height:23px;color:${BRAND.text};">${escapeHtml(paragraph)}</td>
          </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(layout.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.ground};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.ground};font-size:1px;line-height:1px;">${escapeHtml(layout.preheader)}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:${BRAND.ground};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="border-collapse:collapse;width:100%;max-width:560px;">
        <tr>
          <td style="padding:0 0 20px 0;font-family:${FONT_STACK};font-size:22px;line-height:26px;font-weight:700;letter-spacing:.02em;color:${BRAND.text};">sho<span style="color:${BRAND.accent};">WM</span>e</td>
        </tr>
        <tr>
          <td style="background-color:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:12px;padding:28px 28px 10px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
              <tr>
                <td style="padding:0 0 14px 0;font-family:${FONT_STACK};font-size:20px;line-height:26px;font-weight:700;color:${BRAND.text};">${escapeHtml(layout.heading)}</td>
              </tr>${paragraphs}${layout.details?.length ? renderDetailsHtml(layout.details) : ""}${layout.callout ? renderCalloutHtml(layout.callout) : ""}${layout.action ? renderActionHtml(layout.action) : ""}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 4px 0 4px;font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${BRAND.muted};">${escapeHtml(layout.footerNote)}<br />shoWMe — booking and settlement for live events.</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** The same layout as plain text — not a stripped copy, a written alternative. */
function renderText(layout: EmailLayout): string {
  const blocks: string[] = [
    "shoWMe",
    "",
    layout.heading,
    "",
    // A blank line between paragraphs — plain text has no other way to show one.
    ...layout.paragraphs.flatMap((paragraph, index) =>
      index === 0 ? [paragraph] : ["", paragraph],
    ),
  ];
  if (layout.details?.length) {
    blocks.push("", ...layout.details.map((detail) => `${detail.label}: ${detail.value}`));
  }
  if (layout.callout) {
    blocks.push("", `${layout.callout.label}: ${layout.callout.value}`);
  }
  if (layout.action) {
    blocks.push("", `${layout.action.label}:`, layout.action.url);
  }
  blocks.push("", "--", layout.footerNote, "shoWMe — booking and settlement for live events.");
  return blocks.join("\n");
}

function render(layout: EmailLayout): RenderedEmail {
  return { subject: layout.subject, html: renderHtml(layout), text: renderText(layout) };
}

/** The detail rows for a show, skipping the facts the event does not carry yet. */
function eventDetails(event: EventSummary): DetailRow[] {
  const details: DetailRow[] = [{ label: "Event", value: event.title }];
  const eventDate = formatEventDate(event.eventDate);
  if (eventDate) details.push({ label: "Date", value: eventDate });
  if (event.venueName) details.push({ label: "Venue", value: event.venueName });
  return details;
}

/**
 * 1. The off-platform share verification code (`POST /shares/:token/otp`).
 *
 * Deliberately the barest message shoWMe sends, and deliberately the ONLY one
 * with no link: the code exists to prove the reader controls this mailbox, and
 * pairing it with the share URL in the same email would hand a forwarded or
 * intercepted copy everything needed to walk in. It names no share, no event, no
 * sharer — the recipient already holds the link they requested it from.
 */
export function renderShareVerificationCodeEmail(input: {
  code: string;
  expiresInMinutes: number;
}): RenderedEmail {
  return render({
    subject: "Your shoWMe verification code",
    preheader: `This code expires in ${input.expiresInMinutes} minutes.`,
    heading: "Your verification code",
    paragraphs: [
      `Enter this code on the page you requested it from. It expires in ${input.expiresInMinutes} minutes.`,
    ],
    callout: { label: "Verification code", value: input.code },
    footerNote:
      "If you did not request this code, you can ignore this email — nothing was shared with you.",
  });
}

/**
 * 2. A performer who is not on shoWMe yet was added to an event
 * (`POST /events/:id/participants/off-platform`).
 *
 * Names the show so the recipient can tell which booking this is about, and
 * nothing else: no fee, no deal terms, no budget, no other participants. They
 * are not yet a party to any of it.
 */
export function renderOffPlatformPerformerEmail(input: {
  performerName?: string | null;
  event?: EventSummary | null;
  baseUrl?: string;
}): RenderedEmail {
  const greeting = input.performerName ? `Hi ${input.performerName},` : "Hi,";
  const subject = input.event
    ? `You've been added to ${input.event.title} on shoWMe`
    : "You've been added to a shoWMe event";
  return render({
    subject,
    preheader: "Create an account with this email address to claim your profile.",
    heading: "You've been added to an event",
    paragraphs: [
      `${greeting} you have been added as a performer on an event on shoWMe.`,
      "Create an account with this email address to claim your profile — this event, and any other you have been added to, will be waiting for you.",
    ],
    details: input.event ? eventDetails(input.event) : undefined,
    action: { label: "Claim your profile", url: buildApplicationUrl("/", input.baseUrl) },
    footerNote: "You received this because an organizer added this email address to their event.",
  });
}

/**
 * 3. An invitation to collaborate (`POST /invitations`).
 *
 * `code` invitations are redeemed by typing the code; `token` invitations by
 * opening a link. Both get an actionable destination — the raw token is never
 * printed on its own, because a string with no URL around it is not something a
 * human can act on.
 *
 * Carries who invited them and to what, and stops there: no permission-set
 * detail, no event money, no list of the other collaborators.
 */
export function renderInvitationEmail(input: {
  recipientName?: string | null;
  /** The inviter's display name, when the token carried one. */
  inviterName?: string | null;
  /** The event or account they are being invited onto, when known. */
  targetName?: string | null;
  /** Whether `targetName` is an event or an account, for the copy. */
  targetKind?: "event" | "profile";
  code?: string | null;
  token?: string | null;
  baseUrl?: string;
}): RenderedEmail {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hi,";
  const inviter = input.inviterName ?? "Someone";
  const target = input.targetName
    ? input.targetKind === "event"
      ? `the event ${input.targetName}`
      : input.targetName
    : "shoWMe";
  const subject = input.targetName
    ? `${inviter} invited you to ${input.targetName} on shoWMe`
    : "You have been invited to shoWMe";

  // A code invitation is redeemed by typing the code, so the link lands on the
  // app rather than carrying the secret in a URL; a token invitation carries it.
  //
  // `/invitations/<token>`, not the `/?invitation=<token>` this used to send: the
  // app's other link-is-the-credential surface is `/shares/<token>`, and one
  // spelling for both is one thing to remember and one place to mask a secret in
  // the logs. **Both forms still land** — `invitationTokenFromLocation` in
  // `apps/web/src/router.tsx` reads the query form too, permanently, because
  // every invitation sent before today carries it and those links must not die.
  const url = input.code
    ? buildApplicationUrl("/", input.baseUrl)
    : buildApplicationUrl(`/invitations/${encodeURIComponent(input.token ?? "")}`, input.baseUrl);

  return render({
    subject,
    preheader: `${inviter} invited you to collaborate on shoWMe.`,
    heading: "You have been invited",
    paragraphs: [
      `${greeting} ${inviter} has invited you to collaborate on ${target}.`,
      input.code
        ? "Open shoWMe, sign in or create an account with this email address, and enter the invitation code below."
        : "Open the link below and sign in — or create an account with this email address — to accept.",
    ],
    callout: input.code ? { label: "Invitation code", value: input.code } : undefined,
    action: { label: "Open shoWMe", url },
    footerNote: "You received this because someone invited this email address to collaborate.",
  });
}

/**
 * 4. The event info notice (`POST /events/:id/notify`).
 *
 * Goes to every reachable member of every participating profile, so it says
 * which show changed and links to it — and nothing about the change itself. The
 * event page already shows each reader only their own slice; an email cannot,
 * so it does not try.
 */
export function renderEventNotificationEmail(input: {
  event: EventSummary;
  baseUrl?: string;
}): RenderedEmail {
  return render({
    subject: `Event update: ${input.event.title}`,
    preheader: "Open the event in shoWMe to see what changed.",
    heading: "There's an update to your event",
    paragraphs: [
      `The details of ${input.event.title} have been updated. Open the event in shoWMe to see the current schedule, line-up and your own deal.`,
    ],
    details: eventDetails(input.event),
    action: {
      label: "Open the event",
      url: buildApplicationUrl(`/events/${encodeURIComponent(input.event.id)}`, input.baseUrl),
    },
    footerNote: "You received this because you are part of this event on shoWMe.",
  });
}

/**
 * 5. A settlement is ready for someone to check (`POST /events/:id/settlement/status`
 *    for parties with an account, `POST /events/:id/settlement/invitations` for those
 *    without).
 *
 * ONE template, two destinations, because it is one message: *your figures are
 * ready, go and check them*. A party with an account is sent to the settlement
 * inside the app; a party without one is sent to a protected share link addressed
 * to their own mailbox. Which link it carries is the only difference, and keeping
 * them in one function is what stops the on-platform and off-platform halves of
 * the same review drifting into two different asks.
 *
 * NO MONEY IN THE EMAIL. Not the entitlement, not the transfer, not the pool —
 * the same rule the invitation and event-update notices already follow. A
 * settlement is party-scoped and the screen behind the link is the only surface
 * that can enforce that scoping (`story.md:44`); a figure in an email is a figure
 * in whatever inbox the message is forwarded to. The email says a settlement is
 * waiting and gets the reader to the place that can show them their own line.
 */
export function renderSettlementReviewEmail(input: {
  recipientName?: string | null;
  event: EventSummary;
  /** Who sent it out, for the copy. */
  senderName?: string | null;
  /**
   * The off-platform share token. Present → the link goes to `/shares/<token>`,
   * which asks for a one-time code before it renders anything. Absent → the
   * reader has an account and the link goes to the settlement in the app.
   */
  shareToken?: string | null;
  baseUrl?: string;
}): RenderedEmail {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hi,";
  const sender = input.senderName ?? "The organizer";
  const url = input.shareToken
    ? buildApplicationUrl(`/shares/${encodeURIComponent(input.shareToken)}`, input.baseUrl)
    : buildApplicationUrl(
        `/events/${encodeURIComponent(input.event.id)}/settlement`,
        input.baseUrl,
      );

  return render({
    subject: `Settlement to review: ${input.event.title}`,
    preheader: "Check your figures and sign off when they match your books.",
    heading: "A settlement is ready for you",
    paragraphs: [
      `${greeting} ${sender} has sent out the settlement for ${input.event.title}.`,
      "Open it to see your own line — what you are owed, and the rule behind every figure in it. If it matches your books, sign it off; if something looks wrong, say so there and the organizer can re-issue.",
      input.shareToken
        ? "You will be asked for a one-time code sent to this address, so the link only works for you."
        : "You are already on shoWMe, so it is waiting for you in the app as well.",
    ],
    details: eventDetails(input.event),
    action: { label: "Review the settlement", url },
    footerNote: "You received this because you are a party to this event's settlement.",
  });
}

/**
 * 6. The mail copy of an in-app NOTIFICATION (`@showme/db/notify`, when a caller
 *    passes a `NotificationEmail`).
 *
 * The five templates above each exist because one route has one thing to say.
 * This one is the opposite by design: the notification feed carries a growing
 * set of small facts — an agreement reopened, a remark on a settlement, a party
 * signing off — and giving each its own bespoke template would mean six near
 * copies of the same shape, and a seventh the next time a route learns to speak.
 * The caller supplies the sentences; the layout, the brand and the link-building
 * stay here, where they already were.
 *
 * IT IS NOT A DUMP OF THE NOTIFICATION. `NotificationInput.title`/`body` are
 * written for a one-line row under a bell and read as a fragment in an inbox, so
 * a caller writes the mail's own copy. Same rule as everything above: no money,
 * no party-scoped figure — the link goes to the screen that can decide what this
 * particular reader may see.
 *
 * FOOTER NAMES THE SWITCH. Every message this renders was sent because a
 * preference allowed it, so it says so and says where to change it. A mail that
 * cannot be turned off from the mail is a mail people mark as spam.
 */
export function renderNotificationEmail(input: {
  subject: string;
  /** The inbox preview line — write it, or the client picks a fragment. */
  preheader: string;
  heading: string;
  paragraphs: string[];
  /** The show this is about, when there is one. Renders the detail block. */
  event?: EventSummary | null;
  action: { label: string /** An app-relative path, e.g. `/events/<id>`. */; path: string };
  baseUrl?: string;
}): RenderedEmail {
  return render({
    subject: input.subject,
    preheader: input.preheader,
    heading: input.heading,
    paragraphs: input.paragraphs,
    details: input.event ? eventDetails(input.event) : undefined,
    action: {
      label: input.action.label,
      url: buildApplicationUrl(input.action.path, input.baseUrl),
    },
    footerNote:
      "You received this because your shoWMe notification settings allow email for this kind of update. Change them in Settings → Notifications.",
  });
}

/**
 * The code that proves control of an invited address, before that address's
 * account may be claimed (`POST /invitations/:token/claim-otp`, migration 0033).
 *
 * Deliberately says nothing about WHAT is being claimed — not the profile, not
 * the event, not who invited them. Whoever holds the link already knows; whoever
 * received this email by mistake should learn nothing from it, and this is the
 * one message that goes to an address we have never verified.
 */
export function renderInvitationClaimCodeEmail(input: {
  code: string;
  expiresInMinutes: number;
}): RenderedEmail {
  return render({
    subject: "Your shoWMe account claim code",
    preheader: `This code expires in ${input.expiresInMinutes} minutes.`,
    heading: "Confirm this is your address",
    paragraphs: [
      `Enter this code to finish claiming the shoWMe account set up for this address. It expires in ${input.expiresInMinutes} minutes.`,
      "You can then sign in with whichever email address you prefer — this one only proves the invitation reached you.",
    ],
    callout: { label: "Claim code", value: input.code },
    footerNote:
      "If you were not expecting this, ignore this email. Nothing can be claimed without the code.",
  });
}

/**
 * "This account was claimed by [Name] on [Date]" — sent to the address the
 * invitation was ORIGINALLY addressed to, after somebody claims it.
 *
 * Ran's spec files this under transparency, and it is also the safety net for the
 * rule above: the claimant may now sign up under a different address, so the
 * invited address has to be told what became of the account offered to it. Sent
 * on EVERY claim, not only the ones attached to an event.
 */
export function renderInvitationClaimedEmail(input: {
  claimantName?: string | null;
  claimedAt: Date;
  targetName?: string | null;
}): RenderedEmail {
  const who = input.claimantName?.trim() || "Someone";
  const when = input.claimedAt.toISOString().slice(0, 10);
  const what = input.targetName?.trim();
  return render({
    subject: what ? `${what} has been claimed on shoWMe` : "Your shoWMe invitation was claimed",
    preheader: `Claimed by ${who} on ${when}.`,
    heading: "The account has been claimed",
    paragraphs: [
      what
        ? `${who} claimed the shoWMe account for ${what} on ${when}.`
        : `${who} claimed the shoWMe account invited at this address on ${when}.`,
      "They confirmed this address with a one-time code before claiming it, and may be signed in under a different email.",
    ],
    footerNote:
      "If this was not you or somebody you know, reply to this email and we will look into it.",
  });
}
