/**
 * Brevo transactional email sink — sends account/booking emails (invites, share
 * OTPs, event info notices). Like the ClickUp lead sink, this is an external
 * integration injected into the app so the routes stay framework-agnostic and the
 * API key never leaves the server. When unconfigured (local/test/no credentials),
 * the no-op sink just logs, so the app boots and mutations succeed without Brevo.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

export interface EmailSink {
  sendEmail(message: EmailMessage): Promise<void>;
}

/** No-op sink for local/dev/test — logs the message instead of sending it. */
export function createNoopEmailSink(
  log: (message: EmailMessage) => void = (message) =>
    console.info("[shoWMe] email sent (Brevo not configured):", {
      to: message.to,
      subject: message.subject,
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
  return createNoopEmailSink();
}
