/**
 * Brevo transactional email sink — sends account/booking emails (invites, share
 * OTPs, event info notices). Like the ClickUp lead sink, this is an external
 * integration injected into the app so the routes stay framework-agnostic and the
 * API key never leaves the server. When unconfigured (local/test/no credentials),
 * the no-op sink just logs, so the app boots and mutations succeed without Brevo.
 */

import type { EmailMessage, EmailSink } from "@showme/shared";

/**
 * No-op sink for local/dev/test — logs the message instead of sending it.
 *
 * IT LOGS THE BODY, and that is the point. It used to log only `to` and
 * `subject`, which made every flow that is *gated on reading an email*
 * untestable by a human on `pnpm dev`: the share OTP is a six-digit code that
 * exists nowhere else — not in the response (the echo needs `SHARE_OTP_ECHO=1`
 * or `NODE_ENV=test`, and the dev stack sets neither), not in the database in
 * plaintext (it is stored salted + SHA256), and not in any mailbox, because
 * nothing was sent. A developer opening their own share link got "a code is on
 * its way" and then had nowhere to go. This is the local mail-catcher every
 * project has; ours just prints.
 *
 * NEVER in production. This sink is reachable there only through the
 * unconfigured-Brevo fallback in `createEmailSink`, and a verification code in
 * Cloud Logging is a verification code anyone with log access can spend. In
 * production the body is withheld and the fallback shouts instead.
 */
export function createNoopEmailSink(
  log: (message: EmailMessage) => void = (message) =>
    console.info("[shoWMe] email NOT sent (Brevo not configured):", {
      to: message.to,
      subject: message.subject,
      ...(process.env.NODE_ENV === "production" ? {} : { text: message.text }),
    }),
): EmailSink {
  return {
    async sendEmail(message) {
      log(message);
    },
  };
}

export interface BrevoConfig {
  apiKey: string;
  /** The verified `from` address every message is sent as. */
  sender: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImplementation?: typeof fetch;
}

/**
 * Real sink — sends a single transactional email via Brevo's SMTP API. A non-2xx
 * response throws with the status + a truncated body so the caller can log the
 * failure (routes swallow it so a mail hiccup never fails the primary DB effect).
 */
export function createBrevoEmailSink(config: BrevoConfig): EmailSink {
  const doFetch = config.fetchImplementation ?? fetch;
  return {
    async sendEmail(message) {
      const response = await doFetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": config.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: { email: config.sender },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
          replyTo: message.replyTo ? { email: message.replyTo } : undefined,
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Brevo email send failed (${response.status}): ${detail.slice(0, 200)}`);
      }
    },
  };
}

/** Pick the real sink only when BOTH the key and sender are set, else the no-op. */
export function createEmailSink(config: {
  brevoApiKey?: string;
  brevoSender?: string;
}): EmailSink {
  if (config.brevoApiKey && config.brevoSender) {
    return createBrevoEmailSink({ apiKey: config.brevoApiKey, sender: config.brevoSender });
  }
  // A silent downgrade to "log it and move on" is right on a laptop and wrong on a
  // deployment: every invitation, share code and event notice is dropped, each
  // route reports success, and nothing anywhere says so. `SHARE_JWT_SECRET` went
  // unset in prod exactly this way (`docs/deployment-status.md`) and was not found
  // by anyone noticing — it was found by someone going to look. One line at boot
  // is the difference between a deployment state and a mystery.
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[shoWMe] BREVO_API_KEY / BREVO_SENDER are not both set — this deployment CANNOT send email. " +
        "Share verification codes, invitations and event notices will be dropped silently.",
    );
  }
  return createNoopEmailSink();
}
