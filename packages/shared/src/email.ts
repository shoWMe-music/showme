/**
 * THE EMAIL TRANSPORT CONTRACT — what a message is, and what sends one.
 *
 * Three interfaces and no code: this is the seam between the two halves of
 * shoWMe's mail, and both halves stay where they belong. The COPY (every
 * `render*Email` function, the 2003-era table markup, the brand literals) is
 * API-shaped and lives in `apps/api/src/lib/email-templates.ts`. The SENDER
 * (Brevo, and the no-op that logs locally) is an injected integration and lives
 * in `apps/api/src/lib/email.ts`. Neither moved.
 *
 * WHY THE TYPES LIVE HERE AND NOT BESIDE THEM: `@showme/db`'s notification
 * delivery (`@showme/db/notify`) takes an optional rendered message and a sink to
 * hand it to, so the shape has to be nameable from a package that must never
 * import an app — `@showme/db → apps/api` would be a cycle, and a second
 * declaration of `EmailSink` in the db package would be two contracts that drift.
 * `@showme/shared` is the one place the db package, the API and the jobs runner
 * all already depend on.
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

/** The rendered message body — both parts, always. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}
