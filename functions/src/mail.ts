import { createTransport, Transporter } from "nodemailer";
import * as logger from "firebase-functions/logger";

let transporter: Transporter | null = null;

export function getMailTransport(): Transporter {
  if (!transporter) {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || "587");
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      logger.warn("SMTP not configured — emails will not be sent");
      // Return a transport that logs instead of sending
      transporter = createTransport({ jsonTransport: true });
      return transporter;
    }

    transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return transporter;
}

export const FROM_ADDRESS = process.env.SMTP_FROM || "shoWMe <no-reply@showme.live>";
