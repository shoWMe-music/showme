/**
 * "RSVP" — the one thing a stranger may DO on the public event page
 * (`event.html`).
 *
 * It posts to the API's public, unauthenticated `POST /public/events/:id/rsvp`
 * (`apps/api/src/routes/public.ts`, `config: { public: true }`), which writes an
 * `audience_rsvps` row for the host. This bundle carries no Firebase Auth SDK
 * and no authenticated client, so it cannot do anything else.
 *
 * WHAT IT COLLECTS, and nothing more: an email (the endpoint's only required
 * field — it is how the host counts and contacts the audience, and it is the
 * unique key that stops one person RSVPing twice), a name, and optionally the
 * city the visitor is coming from. Every one of those three is a column the
 * endpoint already accepts; nothing is collected that the API would throw away.
 *
 * WHAT IT NEVER SHOWS BACK: nothing about the event beyond the poster facts the
 * page already renders, and nothing at all about who else has RSVP'd. The
 * confirmation does not echo the visitor's own details back at them.
 *
 * WHAT PROTECTS THE ENDPOINT, honestly: `POST /public/events/:id/rsvp` has no
 * rate limit, no origin guard and no honeypot of its own — unlike
 * `POST /public/leads`, which has all three. The honeypot below is a client-side
 * speed bump only; the API is what would have to change. Same caveat, and the
 * same wording, as the availability page's request panel.
 *
 * Cookies: none. This form sets no cookie and writes nothing to storage.
 */

import { element } from "./element";

/* --------------------------------------------------------------- sanitizing */

// Same treatment the availability page gives visitor input: the API's public
// body schema neither bounds nor cleans what it stores, so control characters
// are stripped here rather than sent.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — control characters are stripped from visitor input.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;

function cleanSingleLine(value: string): string {
  return value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
}

/** The same permissive shape the contact form accepts — the server decides. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ------------------------------------------------------------------- fields */

interface FieldOptions {
  name: string;
  label: string;
  hint?: string;
  inputType?: string;
  autocomplete?: string;
  placeholder?: string;
  maximumLength: number;
  required: boolean;
}

interface Field {
  readonly wrapper: HTMLElement;
  readonly control: HTMLInputElement;
  /** The sanitized, trimmed value — what would actually be sent. */
  value(): string;
  showError(message: string): void;
  clearError(): void;
  reset(): void;
}

function createField(options: FieldOptions): Field {
  const identifier = `rsvp-${options.name}`;
  const errorIdentifier = `${identifier}-error`;

  const wrapper = element("div", "field");
  const label = element("label", "field__label", options.label);
  label.setAttribute("for", identifier);

  const control = document.createElement("input");
  control.id = identifier;
  control.name = options.name;
  control.className = "field__control";
  control.type = options.inputType ?? "text";
  control.maxLength = options.maximumLength;
  if (options.required) control.required = true;
  if (options.placeholder) control.placeholder = options.placeholder;
  if (options.autocomplete) control.setAttribute("autocomplete", options.autocomplete);

  // Present from the start (empty and hidden) so `aria-describedby` can point at
  // a stable node — a description that comes and goes is announced unreliably.
  const error = element("p", "field__error");
  error.id = errorIdentifier;
  error.hidden = true;

  wrapper.append(label, control);
  if (options.hint) wrapper.append(element("p", "field__hint", options.hint));
  wrapper.append(error);

  return {
    wrapper,
    control,
    value: () => cleanSingleLine(control.value),
    showError(message) {
      error.textContent = message;
      error.hidden = false;
      control.setAttribute("aria-invalid", "true");
      control.setAttribute("aria-describedby", errorIdentifier);
    },
    clearError() {
      error.textContent = "";
      error.hidden = true;
      control.removeAttribute("aria-invalid");
      control.removeAttribute("aria-describedby");
    },
    reset() {
      control.value = "";
      this.clearError();
    },
  };
}

/* ------------------------------------------------------------------ sending */

interface RsvpPayload {
  email: string;
  name?: string;
  city?: string;
}

type SendResult =
  | { outcome: "sent" }
  /** A 409 — already on the list, cancelled, or already played. The API's own
   *  wording is person-facing and carries the reason, so it is shown as-is. */
  | { outcome: "refused"; message: string }
  | { outcome: "gone" }
  | { outcome: "rejected" }
  | { outcome: "throttled"; retryAfterSeconds: number | null }
  | { outcome: "unreachable" }
  | { outcome: "failed" };

/** How long we wait before calling the network dead. A public page must not spin. */
const SEND_TIMEOUT_MILLISECONDS = 15_000;

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    const message = body?.error?.message;
    return typeof message === "string" && message.length > 0 ? message : "";
  } catch {
    return "";
  }
}

async function send(
  apiBaseUrl: string,
  eventId: string,
  payload: RsvpPayload,
): Promise<SendResult> {
  // AbortController rather than AbortSignal.timeout: it is the form supported
  // everywhere this static page can be opened, including older mobile browsers.
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SEND_TIMEOUT_MILLISECONDS);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/public/events/${encodeURIComponent(eventId)}/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // Offline, DNS, CORS, or our own timeout. Indistinguishable from the browser
    // and it does not matter: nothing was sent, and the visitor must be told so.
    return { outcome: "unreachable" };
  } finally {
    window.clearTimeout(timeout);
  }

  if (response.ok) return { outcome: "sent" };

  if (response.status === 409) {
    const message = await readErrorMessage(response);
    return {
      outcome: "refused",
      message: message || "This event is not taking RSVPs any more.",
    };
  }

  // The event stopped being public between loading this page and submitting —
  // unpublished, or cancelled. The API refuses to say which, and so do we.
  if (response.status === 404) return { outcome: "gone" };

  if (response.status === 429) {
    const header = response.headers.get("retry-after");
    const seconds = header ? Number.parseInt(header, 10) : Number.NaN;
    return {
      outcome: "throttled",
      retryAfterSeconds: Number.isFinite(seconds) ? seconds : null,
    };
  }

  // A 400 means the server refused the body we built. The visitor is pointed at
  // their own entries; the server's wording goes to the console instead of the
  // page, because a schema message is noise to a stranger and can name internals.
  if (response.status === 400 || response.status === 422) {
    console.warn("[shoWMe] RSVP rejected", await response.text().catch(() => ""));
    return { outcome: "rejected" };
  }

  return { outcome: "failed" };
}

/* --------------------------------------------------------------------- form */

export interface RsvpForm {
  /** The form element — insert it in the page. */
  readonly element: HTMLElement;
}

export interface RsvpFormOptions {
  /** API base including `/api/v1`, e.g. `/api/v1` in dev via the vite proxy. */
  apiBaseUrl: string;
  eventId: string;
  /** The show's title, used only in the page's own copy. */
  eventTitle: string;
}

export function createRsvpForm(options: RsvpFormOptions): RsvpForm {
  const { apiBaseUrl, eventId, eventTitle } = options;

  const card = element("section", "card rsvp");
  // `<main>` is an `aria-live="polite"` region for the event it paints. A form
  // inside a live region gets re-announced as the visitor types, so this subtree
  // opts out and speaks only through its own alert line.
  card.setAttribute("aria-live", "off");
  card.setAttribute("aria-labelledby", "rsvp-heading");

  const title = element("h2", "rsvp__heading", "RSVP");
  title.id = "rsvp-heading";

  const intro = element(
    "p",
    "rsvp__intro",
    "Let the organiser know you're coming. It is not a ticket — it tells them to expect you.",
  );

  const nameField = createField({
    name: "name",
    label: "Your name",
    autocomplete: "name",
    placeholder: "Who is coming",
    maximumLength: 200,
    required: true,
  });
  const emailField = createField({
    name: "email",
    label: "Your email",
    inputType: "email",
    autocomplete: "email",
    placeholder: "you@email.com",
    hint: "How the organiser reaches you about the show.",
    maximumLength: 254,
    required: true,
  });
  const cityField = createField({
    name: "city",
    label: "Where you're coming from (optional)",
    autocomplete: "address-level2",
    placeholder: "City",
    maximumLength: 120,
    required: false,
  });

  const form = document.createElement("form");
  form.className = "rsvp__form";
  // The browser's own validation bubbles are suppressed and the messages
  // rendered inline instead: a bubble disappears on the next click, and a
  // failure on a public page has to stay on screen.
  form.noValidate = true;

  // Off-screen honeypot, same as the availability page's request panel. Note the
  // difference that matters: `/public/leads` READS this field server-side and
  // silently drops the lead; the RSVP route does not, so this only stops a bot
  // that fills every input in the DOM and lets us refuse before we POST.
  const honeypot = element("div", "rsvp__honeypot");
  honeypot.setAttribute("aria-hidden", "true");
  const honeypotLabel = element("label", undefined, "Website");
  honeypotLabel.setAttribute("for", "rsvp-website");
  const honeypotInput = document.createElement("input");
  honeypotInput.type = "text";
  honeypotInput.id = "rsvp-website";
  honeypotInput.name = "website";
  honeypotInput.tabIndex = -1;
  honeypotInput.autocomplete = "off";
  honeypot.append(honeypotLabel, honeypotInput);

  const nameAndEmail = element("div", "rsvp__row");
  nameAndEmail.append(nameField.wrapper, emailField.wrapper);

  const submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.className = "rsvp__submit";
  submitButton.textContent = "RSVP to this event";

  const actions = element("div", "rsvp__actions");
  actions.append(submitButton);

  const status = element("p", "rsvp__status");
  status.setAttribute("role", "alert");
  status.hidden = true;

  const consent = element("p", "rsvp__consent");
  consent.append(
    document.createTextNode(
      "Your name, email and city go to the organiser of this event so they can count on you and tell you about it. Nothing else is sent, and this page stores nothing on your device. ",
    ),
  );
  const privacyLink = document.createElement("a");
  privacyLink.href = "privacy.html";
  privacyLink.textContent = "Privacy";
  consent.append(privacyLink, document.createTextNode("."));

  form.append(honeypot, nameAndEmail, cityField.wrapper, actions, status);

  const fields = [nameField, emailField, cityField];

  const done = element("div", "rsvp__done");
  done.hidden = true;

  function showStatus(message: string): void {
    status.textContent = message;
    status.hidden = false;
  }

  function clearStatus(): void {
    status.textContent = "";
    status.hidden = true;
  }

  function showSent(): void {
    form.hidden = true;
    done.replaceChildren(
      element("h3", "rsvp__done-title", "You're on the list"),
      element(
        "p",
        "rsvp__done-body",
        `The organiser of ${eventTitle} knows to expect you. Keep an eye on your inbox.`,
      ),
    );
    done.hidden = false;
    done.focus();
  }

  /** Returns true when everything is fillable-and-filled. Focuses the first problem. */
  function validate(): boolean {
    for (const field of fields) field.clearError();

    const problems: Array<[Field, string]> = [];
    if (nameField.value().length === 0) {
      problems.push([nameField, "Tell them who is coming."]);
    }

    const email = emailField.value().toLowerCase();
    if (email.length === 0) problems.push([emailField, "An email is how they reach you."]);
    else if (!EMAIL_SHAPE.test(email) || email.length > 254) {
      problems.push([emailField, "That does not look like an email address."]);
    }

    if (problems.length === 0) return true;
    for (const [field, message] of problems) field.showError(message);
    problems[0]?.[0].control.focus();
    return false;
  }

  form.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    clearStatus();
    if (!validate()) return;

    // Honeypot filled → a script, not a person. Show the same success it would
    // have seen so it learns nothing, and never POST.
    if (honeypotInput.value.trim().length > 0) {
      showSent();
      return;
    }

    const name = nameField.value();
    const city = cityField.value();
    const payload: RsvpPayload = {
      email: emailField.value().toLowerCase(),
      // Omitted rather than sent empty: the API's schema requires at least one
      // character when either key is present.
      ...(name.length > 0 ? { name } : {}),
      ...(city.length > 0 ? { city } : {}),
    };

    submitButton.disabled = true;
    submitButton.textContent = "Sending…";
    const result = await send(apiBaseUrl, eventId, payload);
    submitButton.disabled = false;
    submitButton.textContent = "RSVP to this event";

    switch (result.outcome) {
      case "sent":
        for (const field of fields) field.reset();
        showSent();
        return;
      case "refused":
        showStatus(result.message);
        return;
      case "gone":
        showStatus("This event is no longer public. Nothing was sent.");
        return;
      case "rejected":
        showStatus("Something in this form was refused. Check your email address and try again.");
        return;
      case "throttled":
        showStatus(
          result.retryAfterSeconds
            ? `Too many requests just now. Try again in ${result.retryAfterSeconds} seconds.`
            : "Too many requests just now. Try again in a minute.",
        );
        return;
      case "unreachable":
        showStatus("Could not reach shoWMe. Nothing was sent — check your connection and retry.");
        return;
      default:
        showStatus("shoWMe could not take that RSVP. Nothing was sent — please try again.");
    }
  });

  // Typing clears that field's complaint, so a corrected field stops shouting.
  for (const field of fields) {
    field.control.addEventListener("input", () => field.clearError());
  }

  // The confirmation replaces the form in place, so it has to be reachable —
  // otherwise focus is left on a button that no longer exists.
  done.tabIndex = -1;

  card.append(title, intro, form, done, consent);

  return { element: card };
}
