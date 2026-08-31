/**
 * "Request this date" — the one thing a stranger may DO on the public
 * availability page (`availability.html`) and on a public profile
 * (`profile.html`).
 *
 * TWO HOSTS, ONE FORM. The availability page opens it bound to a date the sharer
 * published (`openForDate`); a profile page has no such list and opens it with no
 * date at all (`open`) — and therefore with a DATE FIELD of its own, plus room to
 * name a few alternatives. Same endpoint, same body, same validation: the only
 * difference is where the date comes from, a chip on the page or the visitor.
 *
 * It used to send no date at all from the profile page, because
 * `booking_requests.wanted_date` was nullable and the public body made
 * `wantedDate` optional. Both changed on 2026-08-31 (Ran: "requests should always
 * come with a date or multiple dates to select from"), and rightly: "are you free
 * sometime?" is not something a venue can answer, put on a calendar, or turn into
 * a draft event. Asking for the night is one more input; leaving it out cost the
 * visitor the reply.
 *
 * The visitor is looking at a list of free dates, so asking for one of them is a
 * single action: click the date, and this panel opens with that date already
 * chosen. There is no date input to retype and no way to name a date the sharer
 * did not publish — the ask is always one of the chips on screen, which is also
 * why the page still reveals nothing about days it is not already showing.
 *
 * It posts to the API's public, unauthenticated `POST /booking-requests`
 * (`apps/api/src/routes/inbound.ts`, `config: { public: true }`) — the same
 * endpoint the app's own inbox reads from, so a request sent here lands in the
 * target profile's Requests screen like any other. This bundle carries no
 * Firebase Auth SDK and no authenticated client, so it cannot do anything else.
 *
 * WHAT IT COLLECTS, and nothing more: the visitor's name, their email (the only
 * way the recipient can answer — a public-form request has no account behind it,
 * so the API's own notification tells the operator to reply by email), an
 * optional act/organisation name, and a message. Deliberately NOT collected:
 *
 *   - **a fee.** The API stamps a request's currency from the TARGET's country
 *     (`venueCurrency`), which this page does not know and must not display — so
 *     a number typed here would be silently denominated in a currency the sender
 *     never saw. An unlabelled amount is worse than no amount.
 *   - **a phone number, links, genres, social profiles.** The columns exist, but
 *     an unauthenticated page asking for them buys the recipient nothing they
 *     cannot ask for in the reply, and every extra field is more attacker-
 *     controlled text on an endpoint with no rate limit behind it.
 *
 * WHAT IT NEVER SHOWS BACK: nothing about the target beyond the display name the
 * page already renders — no email, no location, no id, no hint of whether the
 * date is "really" free. The success state does not echo the visitor's own
 * details back at them either; it only confirms that the request was sent.
 *
 * Cookies: none. This panel sets no cookie and writes nothing to storage, so it
 * needs no interaction with the site's consent banner (which the availability
 * page does not load at all — it has no analytics).
 */

import { element } from "./element";

/**
 * The slice of `GET /public/profiles/:slug` this form needs. `id` is the target
 * of the POST; it is never rendered. `kind` only picks the wording — a performer
 * is asked for a show, everyone else for a date, which is the language the
 * prototype's profile CTA used.
 */
export interface PublicProfileSummary {
  id: string;
  name: string;
  kind: string;
}

export interface DateRequestPanel {
  /** The panel element — insert it in the page; it starts hidden. */
  readonly element: HTMLElement;
  /** Open (or re-target) the form for one of the published dates. */
  openForDate(isoDate: string, dateLabel: string): void;
  /**
   * Open the form with no date CHOSEN — the public profile page, where there is
   * no list of published days to pick from. The visitor names the night in the
   * form's own date field, and may add a few alternates; it is the same request
   * with the date typed rather than clicked, not a second kind of request.
   */
  open(): void;
  /** Close without sending. */
  close(): void;
}

/**
 * HOW the form appears. The form itself is identical either way — same fields,
 * same validation, same POST — so this is presentation and nothing else.
 *
 *   inline  A card that unhides in the page flow, below the dates it belongs to.
 *           The availability page's ask is bound to a chip the visitor just
 *           clicked, so the form belongs next to it and the page stays put.
 *
 *   modal   A `<dialog>` over the page. A profile page's ask is not bound to
 *           anything on screen — it comes off one button at the bottom of a long
 *           page — so an inline panel would open below the fold of wherever the
 *           reader happens to be. The dialog brings the form to them.
 */
export type PanelPresentation = "inline" | "modal";

/**
 * What the ask is called, everywhere it appears — the button that opens the
 * panel and the panel's own heading.
 *
 * Exported so the profile page's lane button reads from the same constant as the
 * dialog it opens. One string, because it is one action: a public, unauthenticated
 * `POST /booking-requests` that lands in the target's Requests inbox whoever they
 * are. It replaces "Pitch a date" and "Request a show", which made a reader work
 * out that two differently-named buttons did the same thing.
 */
export const BOOKING_REQUEST_LABEL = "Send booking request";

interface PanelOptions {
  /** API base including `/api/v1`, e.g. `/api/v1` in dev via the vite proxy. */
  apiBaseUrl: string;
  target: PublicProfileSummary;
  /** Defaults to `inline` — see `PanelPresentation`. */
  presentation?: PanelPresentation;
  /** Fired after a request for `isoDate` is accepted, so the chip can say so. */
  onRequested(isoDate: string): void;
  /** Fired when the panel closes, so the chip can drop its selected state. */
  onClosed(): void;
}

/* --------------------------------------------------------------- sanitizing */

// Mirrors the sanitizers the API applies to inbox-bound text
// (`apps/api/src/routes/inbound.ts`). The server is the authority; doing it here
// too means we never SEND control characters in the first place — which matters
// because the public body schema, unlike the authenticated one, stores what it
// is given without cleaning or bounding it.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — control characters are stripped from visitor input.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — same, but tab and newline survive in the message.
const CONTROL_CHARACTERS_KEEPING_LINE_BREAKS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

function cleanSingleLine(value: string): string {
  return value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
}

function cleanMultipleLines(value: string): string {
  return value.replace(CONTROL_CHARACTERS_KEEPING_LINE_BREAKS, "").replace(/\r\n/g, "\n").trim();
}

/** The same shape the contact form accepts — permissive, then the server decides. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ------------------------------------------------------------------- fields */

interface FieldOptions {
  name: string;
  label: string;
  hint?: string;
  multiline?: boolean;
  inputType?: string;
  autocomplete?: string;
  placeholder?: string;
  maximumLength: number;
  required: boolean;
}

interface Field {
  readonly wrapper: HTMLElement;
  readonly control: HTMLInputElement | HTMLTextAreaElement;
  /** The sanitized, trimmed value — what would actually be sent. */
  value(): string;
  showError(message: string): void;
  clearError(): void;
  reset(): void;
}

function createField(options: FieldOptions): Field {
  const identifier = `request-${options.name}`;
  const errorIdentifier = `${identifier}-error`;

  const wrapper = element("div", "field");
  const label = element("label", "field__label", options.label);
  label.setAttribute("for", identifier);

  const control = options.multiline
    ? document.createElement("textarea")
    : document.createElement("input");
  control.id = identifier;
  control.name = options.name;
  control.className = options.multiline
    ? "field__control field__control--multiline"
    : "field__control";
  control.maxLength = options.maximumLength;
  if (options.required) control.required = true;
  if (options.placeholder) control.placeholder = options.placeholder;
  if (options.autocomplete) control.setAttribute("autocomplete", options.autocomplete);
  if (control instanceof HTMLInputElement) control.type = options.inputType ?? "text";
  if (control instanceof HTMLTextAreaElement) control.rows = 4;

  // The error node exists from the start (empty and hidden) so that pointing
  // `aria-describedby` at it is stable — a description that appears and vanishes
  // from the accessibility tree is announced unreliably.
  const error = element("p", "field__error");
  error.id = errorIdentifier;
  error.hidden = true;

  // The hint goes UNDER the control, not between the label and it: the two fields
  // in the top row sit in a grid, and a hint above the input pushes that input
  // down out of line with its neighbour.
  wrapper.append(label, control);
  if (options.hint) wrapper.append(element("p", "field__hint", options.hint));
  wrapper.append(error);

  const clean = options.multiline ? cleanMultipleLines : cleanSingleLine;

  return {
    wrapper,
    control,
    value: () => clean(control.value),
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

interface RequestPayload {
  source: "public_form";
  targetProfileId: string;
  contactName: string;
  email: string;
  /** The night being asked about — a clicked chip, or the form's own date field. */
  wantedDate: string;
  /** Other nights that would also work. Sent only when there are any. */
  additionalDates?: string[];
  pitch: string;
  artistName?: string;
}

type SendResult =
  | { outcome: "sent" }
  | { outcome: "duplicate" }
  | { outcome: "rejected" }
  | { outcome: "throttled"; retryAfterSeconds: number | null }
  | { outcome: "unreachable" }
  | { outcome: "failed" };

/** How long we wait before calling the network dead. A public page must not spin. */
const SEND_TIMEOUT_MILLISECONDS = 15_000;

async function send(apiBaseUrl: string, payload: RequestPayload): Promise<SendResult> {
  // AbortController rather than AbortSignal.timeout: it is the form supported
  // everywhere this static page can be opened, including older mobile browsers.
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SEND_TIMEOUT_MILLISECONDS);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/booking-requests`, {
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

  if (response.status === 201) return { outcome: "sent" };

  // The pending-dedup index (`booking_requests_pending_dedup`) is the source of a
  // 409. Today it cannot fire for a public request — its first column is
  // `sender_user_id`, which is NULL here, and Postgres treats NULLs as distinct —
  // so this branch is defensive: if the API ever dedups anonymous senders, the
  // page already says the honest thing instead of showing a bare failure.
  if (response.status === 409) return { outcome: "duplicate" };

  if (response.status === 429) {
    const header = response.headers.get("retry-after");
    const seconds = header ? Number.parseInt(header, 10) : Number.NaN;
    return {
      outcome: "throttled",
      retryAfterSeconds: Number.isFinite(seconds) ? seconds : null,
    };
  }

  // A 400 means the server refused the body we built. The visitor is told to look
  // at their own entries; the server's wording goes to the console instead of the
  // page, because a schema message is noise to a stranger and can name internals.
  if (response.status === 400 || response.status === 422) {
    console.warn("[shoWMe] booking request rejected", await response.text().catch(() => ""));
    return { outcome: "rejected" };
  }

  return { outcome: "failed" };
}

/* -------------------------------------------------------------------- panel */

export function createDateRequestPanel(options: PanelOptions): DateRequestPanel {
  const { apiBaseUrl, target, presentation = "inline", onRequested, onClosed } = options;

  // The KIND still decides the wording of the FIELDS below — what a visitor is
  // asked for when addressing a performer differs from a venue. It no longer
  // decides what the panel is CALLED: "Request a show" of an act and "Request a
  // date" of a room were two names for one form posting one body to one endpoint,
  // and the option that let a caller pass a third name went with them.
  const asksForAShow = target.kind === "performer";

  const panel = element("section", "card request");
  panel.hidden = true;
  // `<main>` on this page is an `aria-live="polite"` region for the snapshot it
  // paints. A form inside a live region gets re-announced as the visitor works,
  // so this subtree opts out and speaks only through its own alert line.
  panel.setAttribute("aria-live", "off");
  panel.setAttribute("aria-labelledby", "request-heading");

  const title = element("h2", "request__heading", BOOKING_REQUEST_LABEL);
  title.id = "request-heading";

  const chosenDate = element("p", "request__date");
  const intro = element(
    "p",
    "request__intro",
    `Send this to ${target.name} on shoWMe. It lands in their requests inbox, and they reply to the email you give.`,
  );

  const nameField = createField({
    name: "contactName",
    label: "Your name",
    autocomplete: "name",
    placeholder: "Who is asking",
    maximumLength: 200,
    required: true,
  });
  const emailField = createField({
    name: "email",
    label: "Your email",
    inputType: "email",
    autocomplete: "email",
    placeholder: "you@email.com",
    hint: "The only way they can answer you.",
    maximumLength: 254,
    required: true,
  });
  const artistField = createField({
    name: "artistName",
    label: asksForAShow ? "Event or venue (optional)" : "Act or organisation (optional)",
    placeholder: asksForAShow ? "What the show is" : "Who you are booking for",
    maximumLength: 200,
    required: false,
  });
  /**
   * The night, when the visitor has to name it themselves (`open()`); hidden when
   * they got here by clicking a published date (`openForDate`), which has already
   * answered the question and shows the answer in `chosenDate`.
   */
  const dateField = createField({
    name: "wantedDate",
    label: "Date",
    inputType: "date",
    hint: "The night you are asking about.",
    // A `date` input ignores maxLength; the value is `YYYY-MM-DD` either way and
    // the server validates it as a real calendar date.
    maximumLength: 10,
    required: true,
  });

  const messageField = createField({
    name: "pitch",
    label: "Message",
    multiline: true,
    placeholder: asksForAShow
      ? "Where the show is, what the night looks like, anything they need to know."
      : "What you have in mind for the night.",
    maximumLength: 2000,
    required: true,
  });

  /**
   * The alternates — "any of these would also work". Offered only alongside the
   * typed date, for the same reason the date field is: on the availability page
   * the ask is bound to a chip the sharer published, and letting a visitor type
   * extra nights there would name days that page deliberately does not discuss.
   *
   * Capped at the five the API accepts (`MAXIMUM_ADDITIONAL_DATES` in
   * `routes/inbound.ts`), so the button disappears rather than earning a refusal.
   */
  const MAXIMUM_ALTERNATE_DATES = 5;

  const alternates: HTMLInputElement[] = [];
  const alternateList = element("div", "request__alternates");
  const alternateGroup = element("div", "field");
  const alternateLabel = element("p", "field__label", "Other dates that work (optional)");
  const addAlternateButton = document.createElement("button");
  addAlternateButton.type = "button";
  addAlternateButton.className = "request__add-date";
  addAlternateButton.textContent = "Add another date";

  function refreshAddAlternateButton(): void {
    addAlternateButton.hidden = alternates.length >= MAXIMUM_ALTERNATE_DATES;
  }

  function addAlternate(): void {
    if (alternates.length >= MAXIMUM_ALTERNATE_DATES) return;
    const row = element("div", "request__alternate");
    const input = document.createElement("input");
    input.type = "date";
    input.className = "field__control";
    input.name = `additionalDate-${alternates.length + 1}`;
    input.setAttribute("aria-label", `Alternative date ${alternates.length + 1}`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "request__remove-date";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      row.remove();
      alternates.splice(alternates.indexOf(input), 1);
      refreshAddAlternateButton();
      addAlternateButton.focus();
    });
    row.append(input, remove);
    alternateList.append(row);
    alternates.push(input);
    refreshAddAlternateButton();
    input.focus();
  }

  addAlternateButton.addEventListener("click", addAlternate);
  alternateGroup.append(alternateLabel, alternateList, addAlternateButton);

  /** The alternates actually filled in, in the order they were added. */
  function alternateValues(): string[] {
    return alternates.map((input) => input.value).filter((value) => value.length > 0);
  }

  /** Drop every alternate input — used on reset and on close. */
  function clearAlternates(): void {
    alternateList.replaceChildren();
    alternates.length = 0;
    refreshAddAlternateButton();
  }

  const form = document.createElement("form");
  form.className = "request__form";
  // Same as the contact form: the browser's own bubbles are suppressed and the
  // messages are rendered inline instead, because a bubble disappears on the next
  // click and a failure on a public page must stay on screen.
  form.noValidate = true;

  // Honeypot, copied from the contact form's markup. Note the difference that
  // matters: `/public/leads` READS this field server-side and silently drops the
  // lead; `POST /booking-requests` does not, so this only stops a bot that fills
  // every input in the DOM and lets us refuse before we POST. It is a speed bump,
  // not a defence — see the note in the module header of `availability.ts`.
  const honeypot = element("div", "request__honeypot");
  honeypot.setAttribute("aria-hidden", "true");
  const honeypotLabel = element("label", undefined, "Website");
  honeypotLabel.setAttribute("for", "request-website");
  const honeypotInput = document.createElement("input");
  honeypotInput.type = "text";
  honeypotInput.id = "request-website";
  honeypotInput.name = "website";
  honeypotInput.tabIndex = -1;
  honeypotInput.autocomplete = "off";
  honeypot.append(honeypotLabel, honeypotInput);

  const nameAndEmail = element("div", "request__row");
  nameAndEmail.append(nameField.wrapper, emailField.wrapper);

  const submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.className = "request__submit";
  submitButton.textContent = "Send request";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "request__cancel";
  cancelButton.textContent = "Cancel";

  const actions = element("div", "request__actions");
  actions.append(submitButton, cancelButton);

  const status = element("p", "request__status");
  status.setAttribute("role", "alert");
  status.hidden = true;

  const consent = element("p", "request__consent");
  consent.append(
    document.createTextNode(
      `Your name, email and message are sent to ${target.name} so they can reply. Nothing else is sent, and this page stores nothing on your device. `,
    ),
  );
  const privacyLink = document.createElement("a");
  privacyLink.href = "privacy.html";
  privacyLink.textContent = "Privacy";
  consent.append(privacyLink, document.createTextNode("."));

  // The date group is one block: the night, then the nights that would also do.
  const dateGroup = element("div", "request__dates");
  dateGroup.append(dateField.wrapper, alternateGroup);

  form.append(
    honeypot,
    nameAndEmail,
    dateGroup,
    artistField.wrapper,
    messageField.wrapper,
    actions,
    status,
  );

  const fields = [nameField, emailField, dateField, artistField, messageField];

  /* ------------------------------------------------------------- the states */

  const done = element("div", "request__done");
  done.hidden = true;

  function showStatus(message: string): void {
    status.textContent = message;
    status.hidden = false;
  }

  function clearStatus(): void {
    status.textContent = "";
    status.hidden = true;
  }

  let selectedDate = "";
  /**
   * True when the date came from a chip the visitor clicked on the page, false
   * when they have to name it in the form. It decides whether the date group is
   * shown, and whether "Pick another date" is a thing that exists after sending.
   */
  let dateComesFromThePage = false;

  function close(): void {
    selectedDate = "";
    dateComesFromThePage = false;
    clearAlternates();
    if (dialog) {
      // Closed only once the way OUT has played. `dialog.close()` mid-animation
      // removes the element from the top layer and the last frames are never
      // drawn, which reads as the modal blinking off.
      if (dialog.open) {
        void playAnimation(dialog, "request-dialog--closing").then(() => dialog.close());
      }
    } else {
      panel.hidden = true;
    }
    onClosed();
  }

  function showSent(): void {
    form.hidden = true;
    // "Send this to X" is an instruction, and the sending is done. Left up, it
    // sits directly above "Request sent" and tells the visitor to do the thing
    // they have just done.
    intro.hidden = true;
    done.replaceChildren(
      element("h3", "request__done-title", "Request sent"),
      element(
        "p",
        "request__done-body",
        `It is in ${target.name}'s requests inbox on shoWMe. They will answer by email.`,
      ),
    );
    const another = document.createElement("button");
    another.type = "button";
    another.className = "request__cancel";
    // "Pick another date" is only true on a page that HAS dates to pick.
    another.textContent = dateComesFromThePage ? "Pick another date" : "Close";
    another.addEventListener("click", () => {
      close();
    });
    done.append(another);
    done.hidden = false;
    another.focus();
  }

  /* --------------------------------------------------------- the validation */

  /** Returns true when everything is fillable-and-filled. Focuses the first problem. */
  function validate(): boolean {
    for (const field of fields) field.clearError();

    const problems: Array<[Field, string]> = [];
    if (nameField.value().length === 0) problems.push([nameField, "Tell them who is asking."]);

    const email = emailField.value().toLowerCase();
    if (email.length === 0) problems.push([emailField, "They need an address to reply to."]);
    else if (!EMAIL_SHAPE.test(email) || email.length > 254) {
      problems.push([emailField, "That does not look like an email address."]);
    }

    if (messageField.value().length === 0) {
      problems.push([messageField, "Write a line or two — an empty request is noise."]);
    }

    // Only when the visitor is the one naming the night; a clicked chip has
    // already answered this and the field is not even on screen.
    if (!dateComesFromThePage) {
      const wanted = dateField.control.value;
      if (wanted.length === 0) {
        problems.push([dateField, "Name the night you are asking about."]);
      } else {
        // The same two rules the API applies, so a refusal happens here — next to
        // the field that is wrong — instead of as an anonymous 400 after sending.
        const seen = new Set([wanted]);
        for (const input of alternates) {
          const value = input.value;
          if (value.length === 0) continue;
          if (seen.has(value)) {
            problems.push([dateField, "Each date can only be asked for once."]);
            break;
          }
          seen.add(value);
        }
      }
    }

    if (problems.length === 0) return true;
    for (const [field, message] of problems) field.showError(message);
    problems[0]?.[0].control.focus();
    return false;
  }

  /* ------------------------------------------------------------- submitting */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();

    if (dateComesFromThePage && !selectedDate) {
      showStatus("Pick one of the dates above first.");
      return;
    }
    if (!validate()) return;

    // Honeypot filled → a script, not a person. Show the same success it would
    // have seen so it learns nothing, and never POST.
    if (honeypotInput.value.trim().length > 0) {
      showSent();
      return;
    }

    const artistName = artistField.value();
    // The clicked chip when there was one, the visitor's own answer otherwise.
    const wantedDate = selectedDate || dateField.control.value;
    const otherDates = dateComesFromThePage ? [] : alternateValues();
    const payload: RequestPayload = {
      source: "public_form",
      targetProfileId: target.id,
      contactName: nameField.value(),
      email: emailField.value().toLowerCase(),
      wantedDate,
      // Omitted rather than sent empty — the API takes the key or takes nothing.
      ...(otherDates.length > 0 ? { additionalDates: otherDates } : {}),
      pitch: messageField.value(),
      // Omitted rather than sent empty: the API's schema requires at least one
      // character when the key is present.
      ...(artistName.length > 0 ? { artistName } : {}),
    };

    submitButton.disabled = true;
    submitButton.textContent = "Sending…";
    const result = await send(apiBaseUrl, payload);
    submitButton.disabled = false;
    submitButton.textContent = "Send request";

    switch (result.outcome) {
      case "sent": {
        const sentDate = wantedDate;
        for (const field of fields) field.reset();
        clearAlternates();
        showSent();
        onRequested(sentDate);
        return;
      }
      case "duplicate":
        showStatus("You have already asked about this date. Give them a moment to reply.");
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
        showStatus("shoWMe could not take that request. Nothing was sent — please try again.");
    }
  });

  cancelButton.addEventListener("click", () => {
    close();
  });

  // Typing clears that field's complaint, so a corrected field stops shouting.
  for (const field of fields) {
    field.control.addEventListener("input", () => field.clearError());
  }

  panel.append(title, chosenDate, intro, form, done, consent);

  /* --------------------------------------------------------------- the shell */

  /**
   * In modal mode the card is wrapped in a native `<dialog>`, and that choice is
   * the whole implementation: `showModal()` already gives the things a
   * hand-rolled overlay has to reinvent and usually gets wrong — the top layer
   * (so no z-index race with the sticky bar), a focus trap, Escape, inertness of
   * the page behind it, and a `::backdrop` to dim it with.
   *
   * What is left to write is the MOTION, which the browser does not animate for
   * us: `showModal()` is instant. The two keyframes live in `request.css` and are
   * timed with the shared duration tokens, so the whole thing collapses to zero
   * under `prefers-reduced-motion` with no media query here.
   */
  const dialog = presentation === "modal" ? document.createElement("dialog") : null;
  if (dialog) {
    dialog.className = "request-dialog";
    // The card is no longer hidden by its own attribute — the dialog's open
    // state is what shows and hides it now.
    panel.hidden = false;
    dialog.append(panel);

    // Escape reaches the dialog as `cancel`. Prevented so the close runs through
    // the same path as every other close and gets the same animation; without
    // this the browser slams it shut and `onClosed` never fires.
    dialog.addEventListener("cancel", (cancelEvent) => {
      cancelEvent.preventDefault();
      close();
    });

    // The backdrop IS the dialog element (the card is a child), so a click that
    // lands on the dialog itself landed outside the card.
    dialog.addEventListener("click", (clickEvent) => {
      if (clickEvent.target === dialog) close();
    });
  }

  /**
   * Play a named keyframe on the dialog and resolve when it is over.
   *
   * `animationend` is the signal, with a timer behind it: a 0ms animation (which
   * is what the reduced-motion tokens produce) still fires in every engine that
   * matters, but a dialog removed mid-flight would leave the promise hanging and
   * the form permanently half-open. The fallback is the shorter of the two.
   */
  function playAnimation(node: HTMLElement, className: string): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        node.classList.remove(className);
        node.removeEventListener("animationend", finish);
        resolve();
      };
      node.addEventListener("animationend", finish);
      node.classList.add(className);
      window.setTimeout(finish, 600);
    });
  }

  /** Everything the two openers share: reset the states, show, and take focus. */
  function reveal(): void {
    clearStatus();
    done.hidden = true;
    form.hidden = false;
    intro.hidden = false;

    if (dialog) {
      if (!dialog.open) dialog.showModal();
      void playAnimation(dialog, "request-dialog--opening");
    } else {
      panel.hidden = false;
      // Bring the form into view and put the caret in it — the click that opened
      // it was on a control further up the page.
      panel.scrollIntoView({ block: "nearest" });
    }
    // After `showModal`, which focuses the dialog itself: the caret belongs in
    // the first thing the visitor has to type.
    nameField.control.focus();
  }

  return {
    element: dialog ?? panel,
    openForDate(isoDate, dateLabel) {
      selectedDate = isoDate;
      dateComesFromThePage = true;
      chosenDate.textContent = dateLabel;
      // The night is settled and named above the form; a second, empty date field
      // under it would read as a question that has already been answered.
      dateGroup.hidden = true;
      clearAlternates();
      reveal();
    },
    open() {
      selectedDate = "";
      dateComesFromThePage = false;
      // No date LINE (that names a chip nobody clicked) — but the date FIELD, and
      // room for a couple of alternatives: since 2026-08-31 every request names a
      // night, and this is the host where the visitor supplies it.
      chosenDate.textContent = "";
      dateGroup.hidden = false;
      clearAlternates();
      reveal();
    },
    close,
  };
}
