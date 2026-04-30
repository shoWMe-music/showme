import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";

export const BREVO_API_KEY = defineSecret("BREVO_API_KEY");

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  toName?: string;
  replyTo?: { email: string; name?: string };
}

export interface SendMailResult {
  messageId?: string;
  skipped?: boolean;
}

export async function sendMail(opts: SendMailOptions): Promise<SendMailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    logger.warn("BREVO_API_KEY not set — email skipped", {
      to: opts.to,
      subject: opts.subject,
    });
    return { skipped: true };
  }

  const senderEmail = process.env.BREVO_FROM_EMAIL || "no-reply@showme-google.se";
  const senderName = process.env.BREVO_FROM_NAME || "shoWMe";

  const body: Record<string, unknown> = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: opts.to, ...(opts.toName ? { name: opts.toName } : {}) }],
    subject: opts.subject,
    htmlContent: opts.html,
  };
  if (opts.replyTo) {
    body.replyTo = opts.replyTo;
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    logger.error("Brevo send failed", {
      status: res.status,
      body: errBody,
      to: opts.to,
      subject: opts.subject,
    });
    throw new Error(`Brevo send failed (${res.status}): ${errBody}`);
  }

  const data = (await res.json()) as { messageId?: string };
  logger.info("Email sent via Brevo", {
    to: opts.to,
    subject: opts.subject,
    messageId: data.messageId,
  });
  return { messageId: data.messageId };
}
