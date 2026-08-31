import { randomBytes } from "node:crypto";
import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { notifyProfileMembers } from "@showme/db/notify";
import { currencyForCountry, invitationExpiresAt } from "@showme/shared";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  badRequest,
  conflict,
  forbidden,
  isUniqueViolation,
  notFound,
  tooManyRequests,
} from "../errors";
import { writeActivity } from "../lib/activity";
import { autoAssignAgentOnPerformerJoin } from "../lib/agent-assignment";
import type { Transaction } from "../lib/audit";
import { writeAudit } from "../lib/audit";
import { requireEventCapability, requireProfileRole } from "../lib/authorize";
import {
  type BookingRequestSender,
  resolveBookingRequestSender,
} from "../lib/booking-request-sender";
import { renderInvitationEmail, renderOffPlatformPerformerEmail } from "../lib/email-templates";
import { canUseFeature, entitlementRequired } from "../lib/entitlements";
import { loadEventSummary } from "../lib/event-summary";
import { resolveEventTimezone } from "../lib/event-timezone";
import { createPerformerStub } from "../lib/off-platform";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";
import { createSlidingWindowRateLimiter } from "../lib/rate-limit";
import { isRepresentationActiveAt } from "../lib/representation-rules";

const IdParams = z.object({ id: z.string().uuid() });

/** Money on the wire is a decimal STRING of minor units (money.md); parse to bigint. */
const MinorUnits = z.string().regex(/^\d+$/, 'amount must be minor units, e.g. "50000"');

// Free text from a sender lands in someone else's inbox, so it is sanitized before
// the length checks run — the same treatment the public lead form gives its input
// (see `routes/public.ts`). All C0 control characters + DEL on single-line fields;
// tab and newline survive in the multi-line ones.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — we strip control chars from user input.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — we strip control chars from user input.
const CONTROL_CHARACTERS_KEEPING_LINE_BREAKS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

const cleanSingleLine = (value: string) =>
  value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();

const cleanMultipleLines = (value: string) =>
  value.replace(CONTROL_CHARACTERS_KEEPING_LINE_BREAKS, "").replace(/\r\n/g, "\n").trim();

/** A bounded, sanitized one-line field (a name, a label). */
const singleLineText = (maximumLength: number) =>
  z.string().transform(cleanSingleLine).pipe(z.string().min(1).max(maximumLength));

/** A bounded, sanitized multi-line field (a pitch, a note). */
const multipleLineText = (maximumLength: number) =>
  z.string().transform(cleanMultipleLines).pipe(z.string().min(1).max(maximumLength));

/** A bounded, sanitized, lower-cased email address. */
const emailAddress = z
  .string()
  .transform((value) => value.replace(CONTROL_CHARACTERS, "").trim().toLowerCase())
  .pipe(z.string().email().max(254));

/** A bounded, sanitized link (music / video). */
const linkUrl = z.string().transform(cleanSingleLine).pipe(z.string().url().max(500));

/**
 * A calendar date for the `date` columns (`wanted_date`, `events.event_date`).
 * Postgres parses a `date` literal itself, so an unvalidated string reached the
 * driver and came back as a 22007 — surfaced to the caller as a bare 500 (audit:
 * `{"wantedDate":"banana"}`). The round-trip check rejects the dates that LOOK
 * right and are not: 2026-02-30 normalizes to March 2nd, so comparing the
 * normalized value back against the input is what catches it.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a calendar date, e.g. 2026-09-01")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Not a real calendar date");

/**
 * How many OTHER nights a sender may name (`additional_dates`).
 *
 * Five, because the field is "these also work", not a calendar. A recipient reads
 * the options as a set and has to hold them in their head against their own
 * diary; past half a dozen the honest answer is "when are you free?", which is a
 * conversation and not a request. It also keeps the row small enough to render as
 * chips in an inbox line.
 */
const MAXIMUM_ADDITIONAL_DATES = 5;

/**
 * The alternates, unsorted and unchecked against the wanted date — the two
 * cross-field rules are applied by `refuseRepeatedDates` on the body that holds
 * both. Distinctness is REFUSED rather than silently deduplicated: a repeated
 * date is a mistake in the sender's own form, and quietly swallowing it teaches
 * them the field does something it does not.
 */
const additionalDates = z.array(calendarDate).max(MAXIMUM_ADDITIONAL_DATES);

/**
 * The cross-field date rule, shared by the public form and `POST /offers`: an
 * alternate may not repeat the wanted date, and may not repeat another alternate.
 * Both would be a promise of choice the sender did not actually make.
 */
function refuseRepeatedDates(
  body: { wantedDate: string; additionalDates?: string[] },
  context: z.RefinementCtx,
): void {
  const alternates = body.additionalDates;
  if (!alternates || alternates.length === 0) return;
  const seen = new Set([body.wantedDate]);
  for (const [position, date] of alternates.entries()) {
    if (seen.has(date)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["additionalDates", position],
        message: `${date} is already one of the dates asked for`,
      });
      return;
    }
    seen.add(date);
  }
}

/** Alternates as they are stored: calendar order, because the set is unordered. */
function sortedAdditionalDates(dates: string[] | undefined): string[] | undefined {
  return dates && dates.length > 0 ? [...dates].sort() : undefined;
}

/**
 * The statuses a recipient may move a request to. `pending` is included so an
 * archive or a decline can be UNDONE — the screen offers "Restore", and without
 * it archiving is a one-way door with no route back. `expired` is deliberately
 * absent: it is the reaper's word, not a human's.
 */
const bookingRequestStatus = z.enum(["pending", "accepted", "declined", "archived", "flagged"]);

/**
 * The PUBLIC body — the one an anonymous browser can post, which makes it the
 * one that has to be tightest. It was the weakest in this file: bare
 * `z.string()` for `contactName` and `pitch` (no bound, no control-character
 * stripping) against an unbounded `text` column, and an unchecked `wantedDate`
 * into a `date` column. It now uses exactly the sanitizers the AUTHENTICATED
 * `CreateOfferBody` below already used.
 */
const CreatePublicRequestBody = z
  .object({
    source: z.literal("public_form"),
    targetProfileId: z.string().uuid(),
    contactName: singleLineText(200),
    email: emailAddress,
    artistName: singleLineText(200).optional(),
    // REQUIRED since 2026-08-31 (Ran). It was optional so that the public PROFILE
    // page — which, unlike the availability page, has no list of published days to
    // click — could ask "are you free at all". That ask is unanswerable: it cannot
    // be placed on a calendar, cannot become a dated draft event, and cannot be
    // deduplicated. The profile page now carries a date input instead
    // (`apps/marketing/src/availability-request.ts`), so the question survives and
    // names a night.
    wantedDate: calendarDate,
    additionalDates: additionalDates.optional(),
    pitch: multipleLineText(5000).optional(),
    offerFeeMin: MinorUnits.optional(),
    offerFeeMax: MinorUnits.optional(),
  })
  .superRefine(refuseRepeatedDates);

const ListQuery = PaginationQuery.extend({
  status: z.enum(["pending", "accepted", "declined", "flagged", "archived", "expired"]).optional(),
  // "incoming" (default) = requests targeting a profile I am a member of.
  // "outgoing" = offers/requests I have SENT from one of my profiles (fix-list #6).
  direction: z.enum(["incoming", "outgoing"]).optional().default("incoming"),
  /** `?unread=true` — the badge's query. Incoming only; see the route. */
  unread: z.coerce.boolean().optional(),
});

const UpdateStatusBody = z.object({ status: bookingRequestStatus });

/**
 * Mark requests read — or unread again. Ran asked for both, and the existing
 * notifications door was one-way (`routes/notifications.ts` only ever stamped
 * `read_at`), which is how "I'll deal with that later" becomes "I lost it".
 *
 * `ids` omitted means EVERY unread request in the caller's inboxes ("mark all
 * read"), the same shape `POST /notifications/read` uses. The cap is the same
 * order as a page of the inbox — a longer list is a client bug, not a use.
 */
const MarkReadBody = z
  .object({
    ids: z.array(z.string().uuid()).max(200).optional(),
    /** False marks them UNREAD again. */
    read: z.boolean().optional(),
  })
  .nullish();

const MarkReadResponse = z.object({ updated: z.number() });

/**
 * An outgoing offer. The date and the fee range are the ASK; everything below the
 * fold is WHO is asking and WHY — an offer that reaches a venue's inbox nameless
 * and pitchless is not an offer, it is noise (audit A-24, decisions.md #18/#6).
 * The identity fields are optional on the wire but never optional in the row: when
 * the caller omits them they are derived from the sending user and profile.
 */
const CreateOfferBody = z
  .object({
    targetProfileId: z.string().uuid(),
    wantedDate: calendarDate,
    /** "Any of these would also work" — see `MAXIMUM_ADDITIONAL_DATES`. */
    additionalDates: additionalDates.optional(),
    offerFeeMin: MinorUnits.optional(),
    offerFeeMax: MinorUnits.optional(),
    // Who is offering. Defaulted from the sender when omitted — never left blank.
    contactName: singleLineText(200).optional(),
    email: emailAddress.optional(),
    artistName: singleLineText(200).optional(),
    // Why. Free text, sanitized and length-bounded like any other inbox-bound input.
    pitch: multipleLineText(5000).optional(),
    note: multipleLineText(2000).optional(),
    musicUrl: linkUrl.optional(),
    videoUrl: linkUrl.optional(),
    // AGENT ONLY: the performer this offer is FOR (decisions.md #14). Accepted only
    // from an `agent`-kind profile with an ACTIVE representation of that performer;
    // anything else is a 400, never a silent drop.
    onBehalfOfProfileId: z.string().uuid().optional(),
  })
  .superRefine(refuseRepeatedDates);

const FlagSpamBody = z.object({ kind: z.string().min(1) });

/**
 * Turn a request into a DRAFT event (§8 "Create Draft"). Everything is optional:
 * the title, the date and the currency are all derivable from the request, and
 * the body only exists so a recipient can correct them before the row is written.
 */
const CreateDraftEventBody = z
  .object({
    title: singleLineText(200).optional(),
    eventDate: calendarDate.optional(),
    /** ISO 4217, upper-cased. Derived from the request/venue when omitted. */
    baseCurrency: z
      .string()
      .transform((value) => value.trim().toUpperCase())
      .pipe(z.string().length(3))
      .optional(),
  })
  .nullish();

/**
 * The recipient's terms in reply — "Make Offer" (§8). A counter is a MESSAGE with
 * numbers on it, not a new request: it is delivered to whoever asked (their
 * notification feed if they have an account, their email if they came off the
 * public form) and recorded in the audit trail. See the route for why it does not
 * reuse `POST /offers` and why it does not move the request's status.
 */
const CounterOfferBody = z.object({
  message: multipleLineText(2000),
  wantedDate: calendarDate.optional(),
  offerFeeMin: MinorUnits.optional(),
  offerFeeMax: MinorUnits.optional(),
});

const HandoffBody = z
  .object({ name: z.string().min(1).optional(), recipientEmail: z.string().email().optional() })
  .nullish();

const BookingRequestResponse = z.object({
  id: z.string(),
  source: z.string(),
  status: z.string(),
  targetProfileId: z.string(),
  // WHO sent it. `senderProfileId` is null for a public-form request (no account).
  // `contactName` / `email` are the sender's business contact — the whole point of
  // a booking request is that the recipient can answer it, and this payload only
  // ever reaches members of the request's TARGET profile (incoming) or of its
  // SENDER profile (outgoing), never a third party. No separate field-level rule
  // applies: there is no capability under which a party may read the row but not
  // the contact on it.
  senderProfileId: z.string().nullable(),
  senderType: z.string().nullable(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  artistName: z.string().nullable(),
  // Set when an AGENT offers on behalf of a performer it represents: the venue's
  // inbox names the ACT (`artistName`) and can still see the agency behind it
  // (`contactName`). `onBehalfOfName` is the performer profile's own display name.
  onBehalfOfProfileId: z.string().nullable(),
  onBehalfOfName: z.string().nullable(),
  // Never null since 0031 — every request names a night (Ran, 2026-08-31).
  wantedDate: z.string(),
  /** The other nights that would also work, in calendar order. `[]`, never null. */
  additionalDates: z.array(z.string()),
  /**
   * WHEN THE RECIPIENT'S TEAM READ IT, and who read it — present only for the
   * profile the request was sent TO.
   *
   * ABSENT, not null, on an outgoing row. Whether a venue has opened your offer
   * is the venue's business: story.md draws the line at "each party sees only
   * their slice", and a read receipt is a fact about how the other party works
   * its inbox, not a fact about the offer. `null` would be a lie in the other
   * direction (it reads as "not yet"), so the key is simply not there.
   */
  readAt: z.string().nullable().optional(),
  readByUserId: z.string().nullable().optional(),
  pitch: z.string().nullable(),
  note: z.string().nullable(),
  musicUrl: z.string().nullable(),
  videoUrl: z.string().nullable(),
  // `artistFee` is what a public-form sender asks for; `offerFeeMin/Max` is the
  // range a performer/agent offers. A row carries one shape or the other, so a
  // client that reads only the offer range shows nothing for public-form requests.
  artistFee: z.string().nullable(),
  offerFeeMin: z.string().nullable(),
  offerFeeMax: z.string().nullable(),
  // The draft event this request was turned into, if any ("Create Draft"). The
  // screen needs it to show that the work has already been started — without it
  // the only feedback is a 409 on the second click.
  eventId: z.string().nullable(),
  // Denomination of the three amounts above; null when the venue's country is
  // unknown, and then the amount must be rendered without a currency symbol.
  currency: z.string().nullable(),
  createdAt: z.string(),
});

const ListResponse = z.object({
  items: z.array(BookingRequestResponse),
  nextCursor: z.string().nullable(),
});

const CreatedIdResponse = z.object({ id: z.string() });
const FlagResponse = z.object({
  id: z.string(),
  flagged: z.literal(true),
  /** The request's status after blocking — `flagged`, so it leaves the inbox. */
  status: z.string(),
  /** The profile the report was filed AGAINST; null when the sender has no account. */
  reportedProfileId: z.string().nullable(),
});
/**
 * The handoff, as the operator handing it over sees it.
 *
 * `token` is here because without it the handoff had no door at all: the route
 * minted exactly the right rows and then returned neither the token nor an email
 * carrying it, so the only way to reach the invitation it created was a database
 * query (`docs/old-app-analysis-flows-invite-settle.md` §1.3). It goes to the
 * SENDER, who is the one being asked to pass it on — the same person who already
 * holds it by virtue of having created it.
 */
const HandoffResponse = z.object({
  profileId: z.string(),
  invitationId: z.string(),
  token: z.string(),
  /** Whether we mailed the link ourselves, or the sender has to pass it on. */
  emailed: z.boolean(),
});

/**
 * What "Create Draft" produces, plus the plan consequence stated out loud. A
 * draft costs NOTHING today — the free-tier event cap is charged where an event
 * enters the counted set (`confirmed`/`concluded`, `assertEventCapAllows`), not
 * at creation. Returning the live counter lets the screen say that honestly
 * instead of either hiding the cost or inventing one.
 */
/**
 * What happened to the person who asked, when their request became a draft.
 *
 * Reported rather than assumed, because the two branches are visibly different
 * things on the screen: an on-platform act is simply THERE on the event and has
 * been told, while a stranger is there as an unclaimed stub with an invitation
 * mail in flight — and a mail that did not leave is something the operator can
 * act on (they can send the link themselves) only if we say so.
 */
const DraftEventSenderResponse = z.object({
  /**
   * `notification` — they have an account: added as the act and told in-app.
   * `invitation`   — a stranger: an unclaimed stub profile + a claim invitation.
   * `none`         — neither an account nor an address; nobody was added.
   */
  channel: z.enum(["notification", "invitation", "none"]),
  /** The profile now on the event as the act — theirs, or the stub just minted. */
  profileId: z.string().nullable(),
  /** Where the invitation was sent, when the channel is `invitation`. */
  email: z.string().nullable(),
  /** False when the mail did not leave — the invitation still stands. */
  emailed: z.boolean(),
});

const DraftEventResponse = z.object({
  requestId: z.string(),
  eventId: z.string(),
  title: z.string(),
  eventDate: z.string().nullable(),
  baseCurrency: z.string(),
  status: z.string(),
  eventCap: z.object({
    allowed: z.boolean(),
    used: z.number().nullable(),
    limit: z.number().nullable(),
    /** Always true: the cap bites when the event is confirmed, not now. */
    chargedAtConfirm: z.literal(true),
  }),
  sender: DraftEventSenderResponse,
});

const CounterOfferResponse = z.object({
  requestId: z.string(),
  /** How the terms reached the requester — their feed, their email, or nowhere. */
  channel: z.enum(["notification", "email", "none"]),
  /** The email address it was sent to, when the channel is email. */
  deliveredTo: z.string().nullable(),
  /** False when delivery failed; the terms are still in the audit trail. */
  delivered: z.boolean(),
});

type BookingRequestRow = typeof schema.bookingRequests.$inferSelect;

/** Keyset cursor over `(created_at, id)` — opaque to the client. */
interface BookingRequestCursor {
  createdAt: string;
  id: string;
}

/**
 * Shape a booking-request row for the wire — bigint money → string, dates → ISO.
 * `onBehalfOfName` is the represented performer's display name, resolved by the
 * caller (a join on the list path, a single lookup elsewhere) rather than here, so
 * the serializer stays synchronous and free of I/O.
 */
function serializeBookingRequest(
  row: BookingRequestRow,
  onBehalfOfName: string | null = null,
  /**
   * True when the caller is reading their OWN inbox. The read state is theirs;
   * see `BookingRequestResponse.readAt` for why a sender never gets it.
   */
  viewerIsRecipient = true,
): z.infer<typeof BookingRequestResponse> {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    targetProfileId: row.targetProfileId,
    senderProfileId: row.senderProfileId,
    senderType: row.senderType,
    contactName: row.contactName,
    email: row.email,
    artistName: row.artistName,
    onBehalfOfProfileId: row.onBehalfOfProfileId,
    onBehalfOfName,
    wantedDate: row.wantedDate,
    additionalDates: row.additionalDates ?? [],
    ...(viewerIsRecipient
      ? { readAt: row.readAt?.toISOString() ?? null, readByUserId: row.readByUserId }
      : {}),
    pitch: row.pitch,
    note: row.note,
    musicUrl: row.musicUrl,
    videoUrl: row.videoUrl,
    artistFee: row.artistFee?.toString() ?? null,
    offerFeeMin: row.offerFeeMin?.toString() ?? null,
    offerFeeMax: row.offerFeeMax?.toString() ?? null,
    eventId: row.eventId,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The currency a request's fees are denominated in: the target VENUE's currency,
 * derived from its primary location's country (currency is a per-country fact —
 * decisions.md #17). Stamped once at creation so a later correction to the venue's
 * country cannot silently reprice requests already sent. Returns null when the
 * venue has no primary-location country, and the amount then renders bare.
 */
async function venueCurrency(
  database: FastifyInstance["database"],
  targetProfileId: string,
): Promise<string | null> {
  const [location] = await database
    .select({ country: schema.profileLocations.country })
    .from(schema.profileLocations)
    .where(
      and(
        eq(schema.profileLocations.profileId, targetProfileId),
        eq(schema.profileLocations.isPrimary, true),
      ),
    )
    .limit(1);
  return currencyForCountry(location?.country);
}

/**
 * The live representation linking an agent to a performer, or null. Every row for
 * the pair is read and the "is it live?" question answered by the shared
 * `isRepresentationActiveAt` — which is NOT `status = 'active'`, because a
 * termination effective-dated into the future leaves the agreement running until
 * that moment (decisions.md #14). Filtering in SQL would fork that definition, so
 * the rows come back whole and the one rule decides.
 */
async function findActiveRepresentation(
  database: FastifyInstance["database"],
  agentProfileId: string,
  performerProfileId: string,
): Promise<typeof schema.representations.$inferSelect | null> {
  const rows = await database
    .select()
    .from(schema.representations)
    .where(
      and(
        eq(schema.representations.agentProfileId, agentProfileId),
        eq(schema.representations.performerProfileId, performerProfileId),
      ),
    );
  const now = new Date();
  return rows.find((row) => isRepresentationActiveAt(row, now)) ?? null;
}

/** A profile's display name, or null when the id is null / the profile is gone. */
async function profileDisplayName(
  database: FastifyInstance["database"],
  profileId: string | null,
): Promise<string | null> {
  if (!profileId) return null;
  const [profile] = await database
    .select({ name: schema.profiles.name })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, profileId))
    .limit(1);
  return profile?.name ?? null;
}

/** A minor-unit amount as major units with its code, e.g. "SEK 65000". Bare when unknown. */
function formatMinorUnits(minorUnits: string | bigint, currency: string | null): string {
  const major = (Number(minorUnits) / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return currency ? `${currency} ${major}` : major;
}

/**
 * The one-line summary of a counter's numbers, for the notification body and the
 * email. Empty when the reply carries no numbers at all — a counter may be purely
 * a question ("which weekend?"), and inventing "no fee" would be a lie.
 */
function counterOfferTerms(offer: {
  offerFeeMin?: string;
  offerFeeMax?: string;
  currency: string | null;
  wantedDate: string | null;
}): string {
  const parts: string[] = [];
  if (offer.offerFeeMin && offer.offerFeeMax && offer.offerFeeMax !== offer.offerFeeMin) {
    parts.push(
      `${formatMinorUnits(offer.offerFeeMin, offer.currency)}–${formatMinorUnits(offer.offerFeeMax, offer.currency)}`,
    );
  } else if (offer.offerFeeMin ?? offer.offerFeeMax) {
    parts.push(
      formatMinorUnits((offer.offerFeeMin ?? offer.offerFeeMax) as string, offer.currency),
    );
  }
  if (offer.wantedDate) parts.push(`for ${offer.wantedDate}`);
  return parts.join(" ");
}

/**
 * "They asked about 2027-03-10, or 2027-03-12 / 2027-03-17." — the one line an
 * arrival notification carries. The alternates belong here rather than only in
 * the row: a recipient whose 10th is taken can answer from the notification
 * itself instead of opening the inbox to find out there was a second option.
 */
function datesAsked(bookingRequest: {
  wantedDate: string;
  additionalDates: string[] | null;
}): string {
  const alternates = bookingRequest.additionalDates ?? [];
  return alternates.length > 0
    ? `They asked about ${bookingRequest.wantedDate}, or ${alternates.join(" / ")}.`
    : `They asked about ${bookingRequest.wantedDate}.`;
}

/**
 * The draft event's notes: who asked, how to answer them, what they asked for,
 * and what they said. The fee is written here rather than into a deal on purpose
 * — a fee becomes real when both parties agree it, and the request is one party
 * talking. Everything else would be lost the moment the operator opens the event.
 */
function draftEventNotes(bookingRequest: BookingRequestRow): string {
  const askedFee = bookingRequest.artistFee ?? bookingRequest.offerFeeMin;
  const alternates = bookingRequest.additionalDates ?? [];
  const lines = [
    `From a booking request for ${bookingRequest.wantedDate}.`,
    // The alternates survive into the event because the draft takes ONE of the
    // dates — the operator who later has to move the night needs to know which
    // others the act already said yes to.
    alternates.length > 0 ? `They could also play: ${alternates.join(", ")}.` : null,
    bookingRequest.contactName
      ? `Contact: ${bookingRequest.contactName}${bookingRequest.email ? ` <${bookingRequest.email}>` : ""}`
      : null,
    bookingRequest.artistName ? `Act: ${bookingRequest.artistName}` : null,
    askedFee != null
      ? `Asked fee: ${formatMinorUnits(askedFee, bookingRequest.currency)}${
          bookingRequest.offerFeeMax != null && bookingRequest.offerFeeMax !== askedFee
            ? `–${formatMinorUnits(bookingRequest.offerFeeMax, bookingRequest.currency)}`
            : ""
        } (asked, not agreed — set the real terms in the deal)`
      : null,
    bookingRequest.pitch ? `\n${bookingRequest.pitch}` : null,
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

/**
 * Client IP for rate-limit keying — prefer the proxy's forwarded-for (Cloud Run).
 *
 * Deliberately duplicated from `routes/public.ts` rather than shared: these two
 * are three-line reads of the request, and the public-form defenses are easier to
 * audit when the whole set sits in the file that needs them. If a third public
 * endpoint appears, move all three into `lib/`.
 */
function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(",")[0]?.trim() || request.ip;
  return request.ip;
}

/**
 * Server-side origin guard, the same one `POST /public/leads` uses and for the
 * same reason: CORS is enforced by the BROWSER, so it stops a page on another
 * origin but not a script. This 403 rejects server-side, so the endpoint is only
 * reachable from the pages we ship (`LEADS_ALLOWED_ORIGINS` — the marketing site
 * that hosts the availability form). A missing Origin is refused too.
 */
function isAllowedPublicOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  return typeof origin === "string" && request.server.leadsAllowedOrigins.includes(origin);
}

/** What "Create Draft" did with the person who asked, as the response reports it. */
type AttachedSender = z.infer<typeof DraftEventSenderResponse>;

/**
 * Put the person who asked ONTO the draft event, through whichever of the two
 * doors their sender identity opens (`resolveBookingRequestSender`).
 *
 * Both doors already existed and neither was reachable from here: the profile
 * branch is an ordinary `event_participants` insert, and the stranger branch is
 * the stub-and-claim mechanic `POST /events/:id/participants/off-platform` uses —
 * `createPerformerStub` mints the unclaimed profile and the email-bearing
 * membership that IS the claim key, so signing up with that address later
 * inherits this event through the normal access join. This is the third caller of
 * that mechanic (off-platform participants, the venue handoff, and now here), so
 * it is called rather than copied.
 *
 * Runs INSIDE the draft-event transaction: an act half-added to an event, or an
 * invitation to an event that rolled back, is worse than no draft at all.
 */
async function attachSenderToEvent(
  tx: Transaction,
  input: {
    sender: BookingRequestSender;
    event: typeof schema.events.$inferSelect;
    operatorUserId: string;
    actingProfileId: string | null;
  },
): Promise<AttachedSender> {
  const { sender, event, operatorUserId, actingProfileId } = input;
  // A `venue_handoff` row can carry neither an account nor an address. Nothing to
  // add and nobody to write to — said plainly in the response, not papered over.
  if (sender.channel === "none") {
    return { channel: "none", profileId: null, email: null, emailed: false };
  }

  // The act IS the host. `POST /offers` does not refuse a profile addressing
  // itself, so an operator can pitch their own venue and then draft it; the host
  // participant is already written, and adding a second row for the same profile
  // is a 23505 the caller would see as a bare 500. Nobody is added and nobody is
  // told, which is the truth — you cannot support your own show.
  if (sender.channel === "profile" && sender.actProfileId === event.hostProfileId) {
    return { channel: "none", profileId: null, email: null, emailed: false };
  }

  const profileId =
    sender.channel === "profile"
      ? sender.actProfileId
      : (
          await createPerformerStub(tx, {
            name: sender.name,
            email: sender.email,
            operatorUserId,
          })
        ).profileId;

  // The act's own permission set, minted per event exactly as the host's is two
  // lines above in the caller (and as `POST /calendar-items/:id/event` does).
  const [permissionSet] = await tx
    .insert(schema.permissionSets)
    .values({
      profileId,
      name: "performer",
      capabilities: [...PRESET_PERMISSION_SETS.performer],
    })
    .returning();
  if (!permissionSet) throw new Error("permission set create failed");

  await tx.insert(schema.eventParticipants).values({
    eventId: event.id,
    profileId,
    role: "performer",
    permissionSetId: permissionSet.id,
    status: "invited",
    addedBy: operatorUserId,
  });

  if (sender.channel === "profile") {
    // decisions #14: a represented act joining an in-region event hands control to
    // their agent in the same breath — the same call `POST /events/:id/participants`
    // makes, so an act reaches an event with the same standing whichever door it
    // came through. A stub has no representations, so this is the profile branch only.
    await autoAssignAgentOnPerformerJoin(tx, event, profileId);
    return { channel: "notification", profileId, email: null, emailed: false };
  }

  await tx.insert(schema.invitations).values({
    // `profile_member` + `performer_offer`: the invitation is to CLAIM the stub
    // profile (and with it this event), which is the shape the off-platform
    // participant route writes and the claim flow already understands.
    type: "profile_member",
    source: "performer_offer",
    status: "pending",
    token: generateToken(),
    expiresAt: invitationExpiresAt("performer_offer", new Date()),
    recipientEmail: sender.email,
    recipientName: sender.name,
    targetProfileId: profileId,
    targetEventId: event.id,
    role: "owner",
    createdByUser: operatorUserId,
    createdByProfile: actingProfileId,
  });

  return { channel: "invitation", profileId, email: sender.email, emailed: false };
}

/**
 * Tell them. Best-effort by design and by precedent (`POST /invitations`, the
 * venue handoff, every notification in this file): the rows are committed and
 * redeemable, so a delivery failure costs a copy-paste, never the draft.
 */
async function deliverDraftEventInvitation(
  request: FastifyRequest,
  input: {
    sender: BookingRequestSender;
    event: typeof schema.events.$inferSelect;
    attached: AttachedSender;
  },
): Promise<AttachedSender> {
  const { sender, event, attached } = input;
  const { database } = request.server;

  if (attached.channel === "notification" && sender.channel === "profile") {
    try {
      // Addressed to the SENDING profile, not the act: when an agency offered, the
      // agency is who is holding the conversation (story.md — the agent negotiates
      // on the act's behalf). The act sees the event itself, as a participant.
      await notifyProfileMembers(
        database,
        sender.senderProfileId,
        request.principal?.userId ?? null,
        {
          type: "booking_request.draft_event",
          title: `${event.title} is being drafted`,
          body: `Your request became a draft event${event.eventDate ? ` on ${event.eventDate}` : ""}. You are on it as the act.`,
          eventId: event.id,
          actorDisplay: request.firebaseUser?.name ?? undefined,
          link: `/events/${event.id}`,
          metadata: { eventId: event.id, profileId: attached.profileId },
        },
      );
    } catch (error) {
      request.log.error({ error, eventId: event.id }, "draft-event notification failed");
    }

    // When an AGENT asked, the act itself is now standing on an event it has not
    // heard about — the agency got the reply, and the performer got a new booking.
    // Both are affected, so both are told; they are the same profile on a direct
    // offer, and then this does not run at all.
    if (attached.profileId && attached.profileId !== sender.senderProfileId) {
      try {
        await notifyProfileMembers(
          database,
          attached.profileId,
          request.principal?.userId ?? null,
          {
            type: "event.participant_added",
            title: `Added to "${event.title}"`,
            body: `Your agent's request became a draft event${event.eventDate ? ` on ${event.eventDate}` : ""}. You are on it as the act.`,
            eventId: event.id,
            actorDisplay: request.firebaseUser?.name ?? undefined,
            link: `/events/${event.id}`,
            metadata: { eventId: event.id },
          },
        );
      } catch (error) {
        request.log.error({ error, eventId: event.id }, "draft-event act notification failed");
      }
    }
    return attached;
  }

  if (attached.channel === "invitation" && sender.channel === "email") {
    try {
      await request.server.emailSink.sendEmail({
        to: sender.email,
        ...renderOffPlatformPerformerEmail({
          performerName: sender.name,
          event: await loadEventSummary(database, event.id),
        }),
      });
      return { ...attached, emailed: true };
    } catch (error) {
      request.log.error({ error, eventId: event.id }, "draft-event invitation email failed");
    }
  }

  return attached;
}

/** An opaque link token for the handoff invitation — never guessable, never typed. */
function generateToken(): string {
  return randomBytes(24).toString("hex");
}

export async function inboundRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * Per-instance limiter for the public booking form: 5 submissions per IP per
   * minute, the same budget the lead form uses. Scoped to this plugin
   * registration so test apps never share a window.
   *
   * Honest about its reach: `lib/rate-limit.ts` keeps its state in the PROCESS,
   * and the API runs on Cloud Run with several instances and scale-to-zero — so a
   * determined flood spread across instances (or arriving after a cold start)
   * sees a fresh window. It stops casual abuse and accidental double-submits, not
   * a distributed one; the global answer is Cloud Armor at the edge.
   */
  const publicRequestRateLimiter = createSlidingWindowRateLimiter({ limit: 5, windowMs: 60_000 });

  // Create from the PUBLIC booking form — no auth, no principal. Anyone on the open
  // web can pitch a target profile; we only ever hand back the new id (never any
  // other request), so the endpoint can't be used to enumerate a profile's inbox.
  //
  // This is a reachable, anonymous INSERT — the marketing availability page posts
  // to it from a stranger's browser — so it carries the same layered defenses as
  // `POST /public/leads`: an origin allow-list, a per-IP rate limit, and hard
  // bounds on every field (`CreatePublicRequestBody`). On top of those it refuses
  // a target that is not a real, PUBLIC profile, and refuses a repeat of a
  // request that is already pending.
  app.post(
    "/booking-requests",
    {
      config: { public: true },
      schema: { body: CreatePublicRequestBody, response: { 201: CreatedIdResponse } },
    },
    async (request, reply) => {
      const { database } = request.server;
      const body = request.body;

      if (!isAllowedPublicOrigin(request)) throw forbidden("Origin not allowed");

      if (!publicRequestRateLimiter.take(clientIp(request))) {
        reply.header("retry-after", "60");
        throw tooManyRequests("Too many requests — please try again in a minute");
      }

      // The target must exist AND be public. Without this, a bad uuid was an FK
      // violation surfaced as a 500, and — worse — a profile that had never
      // published anything was addressable from a public form, which is exactly
      // the "no existence leak" rule `routes/public.ts` holds everywhere else. A
      // non-public or unknown profile is the same 404, so neither can be probed.
      const [target] = await database
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(
          and(eq(schema.profiles.id, body.targetProfileId), eq(schema.profiles.isPublic, true)),
        );
      if (!target) throw notFound("Profile not found");

      // Dedup a public sender the only way an anonymous sender CAN be identified:
      // their email, on the same target and date, while the earlier request is
      // still pending. The `booking_requests_pending_dedup` index cannot do this —
      // its first column is `sender_user_id`, NULL here, and Postgres treats NULLs
      // as distinct — so without this two identical public submissions both land.
      // This closes the double-submit and the repeat-pitch; it is a read-then-write,
      // so two SIMULTANEOUS posts can still slip through (the insert below still
      // catches a 23505 if a partial index is ever added).
      //
      // Unconditional since the date became required: the old `if (body.wantedDate)`
      // guard existed because a dateless ask had nothing to compare, and there is
      // no such ask any more. The ALTERNATES are deliberately not part of the key —
      // "I'd also take the 12th" is one ask, not four, and matching on them would
      // make two genuinely different pitches collide because they share a fallback.
      const [duplicate] = await database
        .select({ id: schema.bookingRequests.id })
        .from(schema.bookingRequests)
        .where(
          and(
            eq(schema.bookingRequests.targetProfileId, body.targetProfileId),
            eq(schema.bookingRequests.source, "public_form"),
            eq(schema.bookingRequests.status, "pending"),
            eq(schema.bookingRequests.wantedDate, body.wantedDate),
            sql`lower(${schema.bookingRequests.email}) = ${body.email}`,
          ),
        )
        .limit(1);
      if (duplicate) throw conflict("You already have a pending request for this date");

      let created: BookingRequestRow;
      try {
        const [inserted] = await database
          .insert(schema.bookingRequests)
          .values({
            source: "public_form",
            status: "pending",
            targetProfileId: body.targetProfileId,
            contactName: body.contactName,
            email: body.email,
            artistName: body.artistName,
            wantedDate: body.wantedDate,
            additionalDates: sortedAdditionalDates(body.additionalDates),
            pitch: body.pitch,
            offerFeeMin: body.offerFeeMin != null ? BigInt(body.offerFeeMin) : undefined,
            offerFeeMax: body.offerFeeMax != null ? BigInt(body.offerFeeMax) : undefined,
            currency: await venueCurrency(database, body.targetProfileId),
          })
          .returning();
        if (!inserted) throw new Error("booking request create failed");
        created = inserted;
      } catch (error) {
        // Same treatment the two `/offers` handlers give it: a dedup index is a
        // 409, never a 500. It cannot fire for an anonymous sender today (see the
        // note above), so this is the guard for the day that changes.
        if (isUniqueViolation(error)) {
          throw conflict("You already have a pending request for this date");
        }
        throw error;
      }

      // Realtime + feed: a request from the open web needs to reach the venue's
      // inbox. Best-effort — the request is already persisted and triageable, so a
      // delivery failure must never turn into a 500 for an anonymous sender.
      try {
        await notifyProfileMembers(database, created.targetProfileId, null, {
          type: "booking_request.received",
          title: `Booking request from ${created.artistName ?? created.contactName ?? "an artist"}`,
          body: datesAsked(created),
          link: "/requests",
          metadata: { bookingRequestId: created.id, source: created.source },
        });
      } catch (error) {
        request.log.error(
          { error, bookingRequestId: created.id },
          "booking-request notification failed",
        );
      }

      return reply.status(201).send({ id: created.id });
    },
  );

  // List the caller's booking requests. "incoming" (default) = requests targeting
  // any profile they are a member of; "outgoing" = requests/offers they have sent
  // from one of those profiles (fix-list #6). The membership set IS the
  // authorization either way; keyset paginated by `(created_at, id)`, optionally
  // filtered by status.
  app.get(
    "/booking-requests",
    { schema: { querystring: ListQuery, response: { 200: ListResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { cursor, limit, status, direction, unread } = request.query;

      const profileIds = principal.memberships.map((membership) => membership.profileId);
      if (profileIds.length === 0) {
        return { items: [], nextCursor: null };
      }

      // Incoming scopes on the target; outgoing scopes on the sender profile.
      const scope =
        direction === "outgoing"
          ? inArray(schema.bookingRequests.senderProfileId, profileIds)
          : inArray(schema.bookingRequests.targetProfileId, profileIds);

      // `read_at` is the RECIPIENT's state, so filtering an outgoing list by it
      // would answer "has the venue opened my offer yet?" — the read receipt the
      // payload deliberately withholds, asked sideways. Refused in words rather
      // than ignored, so a client that tries learns why.
      if (unread && direction === "outgoing") {
        throw badRequest("`unread` describes your own inbox — it does not apply to sent requests");
      }

      // Truncate to milliseconds so the JS-Date-round-tripped cursor stays exact
      // (same approach as events-list) and never re-emits the boundary row.
      const createdAtMillis = sql`date_trunc('milliseconds', ${schema.bookingRequests.createdAt})`;
      const decoded = cursor ? decodeCursor<BookingRequestCursor>(cursor) : null;
      const afterCursor = decoded
        ? sql`(${createdAtMillis}, ${schema.bookingRequests.id}) > (${decoded.createdAt}::timestamptz, ${decoded.id}::uuid)`
        : undefined;

      // The represented performer's name comes along in the same query — the inbox
      // has to name the ACT, and a second round trip per row would be absurd.
      const rows = await database
        .select({ request: schema.bookingRequests, onBehalfOfName: schema.profiles.name })
        .from(schema.bookingRequests)
        .leftJoin(
          schema.profiles,
          eq(schema.profiles.id, schema.bookingRequests.onBehalfOfProfileId),
        )
        .where(
          and(
            scope,
            status ? eq(schema.bookingRequests.status, status) : undefined,
            unread ? isNull(schema.bookingRequests.readAt) : undefined,
            afterCursor,
          ),
        )
        .orderBy(asc(createdAtMillis), asc(schema.bookingRequests.id))
        .limit(limit + 1);

      const { items, nextCursor } = paginate(rows, limit, (row) => ({
        createdAt: row.request.createdAt,
        id: row.request.id,
      }));

      return {
        items: items.map((row) =>
          serializeBookingRequest(row.request, row.onBehalfOfName, direction === "incoming"),
        ),
        nextCursor,
      };
    },
  );

  /**
   * Mark requests in the caller's inbox read, or unread again.
   *
   * WHO MAY: any ACTIVE member of the target profile, which is a wider set than
   * triage's owner/admin on purpose. Reading is not deciding — an editor who
   * opens the inbox has read it, and refusing to record that would leave the
   * badge lying to the rest of the team. The membership set IS the authorization,
   * folded into the UPDATE's WHERE: a request belonging to somebody else's
   * profile simply does not match, so the answer is `updated: 0` and never a
   * disclosure that the id exists.
   *
   * SENT requests are out of scope by the same predicate. Read state belongs to
   * the inbox that received the request; a sender marking their own offer read
   * would be marking the venue's inbox.
   *
   * NOT AUDITED. The audit log records decisions about someone else's business
   * (a status change, a spam report, a draft event); "I looked at it" is not one,
   * and every open of an inbox writing a row would drown the trail it protects.
   */
  app.post(
    "/booking-requests/read",
    { schema: { body: MarkReadBody, response: { 200: MarkReadResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const ids = request.body?.ids;
      const read = request.body?.read ?? true;
      if (ids && ids.length === 0) return { updated: 0 };

      const profileIds = principal.memberships.map((membership) => membership.profileId);
      if (profileIds.length === 0) return { updated: 0 };

      // Only rows that would actually CHANGE are touched, so `updated` is a true
      // count of the work done and re-marking is a cheap no-op rather than a
      // rewrite that moves the timestamp (and the name) of a read from last week.
      const scope = and(
        inArray(schema.bookingRequests.targetProfileId, profileIds),
        ids ? inArray(schema.bookingRequests.id, ids) : undefined,
        read ? isNull(schema.bookingRequests.readAt) : isNotNull(schema.bookingRequests.readAt),
      );

      const updated = await database
        .update(schema.bookingRequests)
        .set(
          read
            ? { readAt: new Date(), readByUserId: principal.userId }
            : // Both cleared together: "read by nobody at 14:02" is not a state.
              { readAt: null, readByUserId: null },
        )
        .where(scope)
        .returning({ id: schema.bookingRequests.id });

      return { updated: updated.length };
    },
  );

  // Triage a request — accept / decline / archive / flag. Authority is the caller's
  // role on the request's TARGET profile (owner/admin); a non-member gets a 404.
  app.patch(
    "/booking-requests/:id",
    {
      schema: {
        params: IdParams,
        body: UpdateStatusBody,
        response: { 200: BookingRequestResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      const [before] = await database
        .select()
        .from(schema.bookingRequests)
        .where(eq(schema.bookingRequests.id, id));
      if (!before) throw notFound("Booking request not found");

      requireProfileRole(request, before.targetProfileId, ["owner", "admin"]);

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.bookingRequests)
          .set({ status: request.body.status, updatedAt: new Date() })
          .where(eq(schema.bookingRequests.id, id))
          .returning();
        if (!after) throw notFound("Booking request not found");
        await writeAudit(tx, request, {
          capability: "event.view",
          action: "booking_request.update",
          targetKind: "booking_request",
          targetId: id,
          before,
          after,
        });
        return after;
      });

      // Realtime + feed: the sender is waiting on this answer. The same branch the
      // other two routes ask (`resolveBookingRequestSender`) — only an on-platform
      // sender has a feed to reach. A public-form sender is reachable by EMAIL and
      // is deliberately not mailed here: this route says nothing a decline email
      // could not say better, and "Make Offer" is the door that writes to them.
      // Stated rather than left implicit, because the shape makes the missing arm
      // visible instead of hiding it inside a truthiness check.
      const requester = resolveBookingRequestSender(updated);
      if (requester.channel === "profile") {
        try {
          await notifyProfileMembers(
            database,
            requester.senderProfileId,
            request.principal?.userId ?? null,
            {
              type: "booking_request.status_changed",
              title: `Your request was ${updated.status}`,
              body: `For ${updated.wantedDate}.`,
              link: "/requests",
              metadata: { bookingRequestId: updated.id, status: updated.status },
            },
          );
        } catch (error) {
          request.log.error({ error, bookingRequestId: updated.id }, "triage notification failed");
        }
      }

      return serializeBookingRequest(
        updated,
        await profileDisplayName(database, updated.onBehalfOfProfileId),
      );
    },
  );

  // A performer's outbound offer — a booking request the OTHER way. The partial
  // unique index on `(sender_user_id, target_profile_id, wanted_date) WHERE
  // status='pending'` makes a duplicate live offer a 23505 → 409.
  app.post(
    "/offers",
    { schema: { body: CreateOfferBody, response: { 201: BookingRequestResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const body = request.body;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      // An offer is sent AS a profile — needed to resolve the plan tier.
      const senderProfileId = principal.actingProfileId;
      if (!senderProfileId) throw badRequest("Select a profile to send the offer from");
      const senderMembership = principal.memberships.find(
        (membership) => membership.profileId === senderProfileId,
      );
      if (!senderMembership) throw badRequest("Select a profile to send the offer from");

      // Entitlement gate (decisions #4/§C): the free artist plan meters offers per
      // month. Composed AFTER authorization, always a fresh read — never conflated.
      const gate = await canUseFeature(database, senderProfileId, "send_offer");
      if (!gate.allowed) throw entitlementRequired("send_offer", gate);

      // Who the offer is FROM: the sending profile plus the person behind it. The
      // row must never be anonymous, so these are the fallbacks for the identity
      // fields the caller may omit.
      const [sender] = await database
        .select({
          profileName: schema.profiles.name,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(schema.profiles)
        .innerJoin(schema.users, eq(schema.users.id, principal.userId))
        .where(eq(schema.profiles.id, senderProfileId))
        .limit(1);
      if (!sender) throw badRequest("Select a profile to send the offer from");

      // An AGENT offers on behalf of an act it represents (decisions.md #14). Both
      // edges are required — the sending profile is an `agent`, AND a live
      // representation links it to that performer — and a failure is an explicit
      // 400: dropping the field silently would send the offer under the agency's
      // own name, which is exactly the anonymity this fixes.
      let onBehalfOfName: string | null = null;
      if (body.onBehalfOfProfileId) {
        if (senderMembership.kind !== "agent") {
          throw badRequest("Only an agent profile can offer on behalf of a performer");
        }
        const representation = await findActiveRepresentation(
          database,
          senderProfileId,
          body.onBehalfOfProfileId,
        );
        if (!representation) {
          throw badRequest("You have no active representation for that performer");
        }
        onBehalfOfName = await profileDisplayName(database, body.onBehalfOfProfileId);
        if (!onBehalfOfName) throw badRequest("That performer profile no longer exists");
      }

      // Defaults, not busywork: an omitted field is derived, never left null.
      // `artistName` is the ACT — the represented performer when an agent sends,
      // otherwise the sending profile itself.
      const contactName = body.contactName ?? sender.userName ?? sender.profileName;
      const email = body.email ?? sender.userEmail;
      const artistName = body.artistName ?? onBehalfOfName ?? sender.profileName;
      const senderType = senderMembership.kind === "agent" ? "agency" : "performer";

      let created: BookingRequestRow;
      // Resolved before the transaction: it is a read of the target venue, not part
      // of the write, and the offer's currency must be settled before the insert.
      const currency = await venueCurrency(database, body.targetProfileId);
      try {
        created = await database.transaction(async (tx) => {
          const [offer] = await tx
            .insert(schema.bookingRequests)
            .values({
              source: "performer_offer",
              status: "pending",
              targetProfileId: body.targetProfileId,
              senderUserId: principal.userId,
              senderProfileId,
              senderType,
              contactName,
              email,
              artistName,
              onBehalfOfProfileId: body.onBehalfOfProfileId,
              pitch: body.pitch,
              note: body.note,
              musicUrl: body.musicUrl,
              videoUrl: body.videoUrl,
              wantedDate: body.wantedDate,
              additionalDates: sortedAdditionalDates(body.additionalDates),
              offerFeeMin: body.offerFeeMin != null ? BigInt(body.offerFeeMin) : undefined,
              offerFeeMax: body.offerFeeMax != null ? BigInt(body.offerFeeMax) : undefined,
              currency,
            })
            .returning();
          if (!offer) throw new Error("offer create failed");
          await writeAudit(tx, request, {
            capability: "event.view",
            action: "offer.create",
            targetKind: "booking_request",
            targetId: offer.id,
            after: offer,
          });
          return offer;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("You already have a pending offer for this target and date");
        }
        throw error;
      }

      // Realtime + feed: an offer is a request with a known sender, so name them.
      try {
        await notifyProfileMembers(database, created.targetProfileId, principal.userId, {
          type: "offer.received",
          title: `Offer from ${artistName}`,
          body: onBehalfOfName
            ? `${contactName} is offering ${onBehalfOfName}. ${datesAsked(created)}`
            : `Offered to play. ${datesAsked(created)}`,
          link: "/requests",
          metadata: { bookingRequestId: created.id },
        });
      } catch (error) {
        request.log.error({ error, offerId: created.id }, "offer notification failed");
      }

      // `viewerIsRecipient: false` — this is the SENDER's copy of their own offer.
      // The row is a millisecond old and unread by definition, so nothing is
      // hidden here in practice; it keeps the one rule ("read state belongs to the
      // inbox") true on every path rather than only where it currently matters.
      return reply.status(201).send(serializeBookingRequest(created, onBehalfOfName, false));
    },
  );

  /**
   * Block a request: report the SENDER as spam and take the request out of the
   * inbox. Three things were wrong with the first version, all of them reachable
   * from the screen's "Block" button:
   *
   * 1. **It accused the wrong profile.** The flag was filed against
   *    `target_profile_id` — the request's RECIPIENT. `spam_flags.target_profile_id`
   *    is the ACCUSED (`canUseFeature(… "not_spam_suspended")` counts distinct
   *    reporters against exactly that column), so blocking a spammer accrued
   *    suspension against your own venue. The accused is the SENDER's profile; the
   *    represented act on an agent's offer is never accused, because the agency is
   *    the party that sent it.
   * 2. **Anyone could call it.** There was no authorization at all: any signed-in
   *    user who knew a request id could file a report and (now) change its status.
   *    Authority is the same as triage — owner/admin of the profile the request
   *    was sent TO.
   * 3. **It left the request pending.** The report was filed and the request sat
   *    in the inbox forever, while `flagged` — a status the screen has a filter
   *    chip for — was unreachable. Blocking now flags the request too.
   *
   * A second block of the same sender is not an error and not new information
   * (the count is DISTINCT reporters): the flag insert is idempotent and the
   * request is flagged either way. A public-form sender has no profile to accuse,
   * so nothing is filed — the request is still flagged, and the report is in the
   * audit trail. Reputation for anonymous senders (an email blocklist) is not
   * modelled; see the report rather than inventing it here.
   */
  app.post(
    "/booking-requests/:id/flag-spam",
    {
      schema: { params: IdParams, body: FlagSpamBody, response: { 201: FlagResponse } },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      if (!principal.actingProfileId) {
        throw badRequest("Select a profile (X-Profile-Id) to report as");
      }
      const reporterProfileId = principal.actingProfileId;

      const [before] = await database
        .select()
        .from(schema.bookingRequests)
        .where(eq(schema.bookingRequests.id, id));
      if (!before) throw notFound("Booking request not found");

      requireProfileRole(request, before.targetProfileId, ["owner", "admin"]);

      const reportedProfileId = before.senderProfileId;

      const flagged = await database.transaction(async (tx) => {
        if (reportedProfileId) {
          await tx
            .insert(schema.spamFlags)
            .values({
              targetProfileId: reportedProfileId,
              reporterProfileId,
              reporterUserId: principal.userId,
              kind: request.body.kind,
              contextKind: "booking_request",
              contextId: id,
            })
            // unique(target, reporter, kind) — the same reporter reporting the same
            // profile again adds nothing to a DISTINCT-reporter count, so it is a
            // no-op rather than a 409 the operator cannot act on.
            .onConflictDoNothing();
        }
        const [after] = await tx
          .update(schema.bookingRequests)
          .set({ status: "flagged", updatedAt: new Date() })
          .where(eq(schema.bookingRequests.id, id))
          .returning();
        if (!after) throw notFound("Booking request not found");
        await writeAudit(tx, request, {
          capability: "event.view",
          action: "spam.flag",
          targetKind: "booking_request",
          targetId: id,
          before,
          after: { ...after, reportedProfileId, kind: request.body.kind },
        });
        return after;
      });

      return reply
        .status(201)
        .send({ id, flagged: true as const, status: flagged.status, reportedProfileId });
    },
  );

  /**
   * "Create Draft" (§8): turn a request into a DRAFT EVENT. The request predates
   * the event and outlives it — `booking_requests.event_id` is the link the schema
   * already carries — so this is one operation, not "create an event and hope the
   * user remembers which request it came from".
   *
   * What it costs: NOTHING against the free-tier event cap. The cap counts events
   * in `confirmed`/`concluded` (`assertEventCapAllows`), and a draft is neither —
   * exactly like `POST /events`, which lands on the `draft` column default by
   * construction. The response carries the live counter so the screen can say
   * "confirming it later is what spends a slot" instead of guessing.
   *
   * What it does NOT do: accept the request. A draft is the recipient starting
   * work, not an answer to the sender — the request stays `pending` until someone
   * declines it or offers terms. And it creates no deal: the asked fee is written
   * into the event's notes, because the fee only becomes real when both parties
   * agree it, which is the deal flow.
   *
   * AND IT BRINGS THE PERSON WHO ASKED ONTO THE EVENT (Ran, 2026-08-31: "that
   * should create a draft event and invite the collaborator with their email").
   * Until now the only participant written was the host — the recipient's own
   * profile — so "Create Offer" produced a private event with no counterparty on
   * it, and the act found out nothing. Which of the two doors they come through is
   * `resolveBookingRequestSender`, the same branch triage and "Make Offer" use:
   *
   *   an account  → their profile joins as a participant and their feed says so.
   *   an email    → an unclaimed stub profile + a claim invitation + that email,
   *                 exactly the mechanic `POST /events/:id/participants/off-platform`
   *                 uses (`lib/off-platform.ts`), so signing up with that address
   *                 inherits this event.
   *
   * They join as `performer`, never `co_host`: they asked to PLAY. story.md is
   * explicit that operator is the party running the show and carrying the
   * residual, and handing a co-host seat to whoever wrote in would hand them the
   * budget. When an AGENT sent the offer the participant is the ACT they
   * represent, not the agency (decisions.md #14, story.md "a booking agent, not
   * the talent") — and the agent then reaches the event the normal way, through
   * `autoAssignAgentOnPerformerJoin`, which is the same door a performer added by
   * hand goes through.
   *
   * Status `invited`, not `confirmed`: nobody has agreed to anything yet, which is
   * the same reason the request stays `pending`.
   */
  app.post(
    "/booking-requests/:id/draft-event",
    {
      schema: {
        params: IdParams,
        body: CreateDraftEventBody,
        response: { 201: DraftEventResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;
      const body = request.body ?? {};
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const [bookingRequest] = await database
        .select()
        .from(schema.bookingRequests)
        .where(eq(schema.bookingRequests.id, id));
      if (!bookingRequest) throw notFound("Booking request not found");

      // Same authority as triage: this is the recipient acting on their own inbox.
      const membership = requireProfileRole(request, bookingRequest.targetProfileId, [
        "owner",
        "admin",
      ]);
      // The same rule `POST /events` enforces — an event is hosted by an operator
      // (story.md: the operator runs the show and carries the residual).
      if (membership.kind !== "operator") {
        throw forbidden("Only operator profiles can create events");
      }
      if (bookingRequest.eventId) {
        throw conflict("This request already has an event");
      }
      // The same question triage and "Make Offer" ask: can this sender be reached,
      // and if so as a profile or only as an address? One definition, three routes.
      const sender = resolveBookingRequestSender(bookingRequest);

      // Currency is not guessable: an event's `base_currency` is the money the
      // whole budget and settlement are denominated in, so a wrong default is
      // worse than a refusal. The request's own stamp comes first (it was taken
      // from the venue's country at creation), then the venue's country now.
      const baseCurrency =
        body.baseCurrency ??
        bookingRequest.currency ??
        (await venueCurrency(database, bookingRequest.targetProfileId));
      if (!baseCurrency) {
        throw badRequest(
          "Set a country on your profile's primary location, or pass a currency, before creating an event from a request",
        );
      }

      const [targetProfile] = await database
        .select({ name: schema.profiles.name, type: schema.profiles.type })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, bookingRequest.targetProfileId));

      // The draft is named after the ACT, which is what a venue's calendar shows —
      // falling back to the person who wrote in, and only then to a placeholder.
      const title =
        body.title ?? bookingRequest.artistName ?? bookingRequest.contactName ?? "Booking request";
      const eventDate = body.eventDate ?? bookingRequest.wantedDate ?? undefined;

      const created = await database.transaction(async (tx) => {
        const [permissionSet] = await tx
          .insert(schema.permissionSets)
          .values({
            profileId: bookingRequest.targetProfileId,
            name: "operator_full",
            capabilities: [...PRESET_PERMISSION_SETS.operator_full],
          })
          .returning();
        if (!permissionSet) throw new Error("permission set create failed");

        // A venue hosting its own show is its own venue; a promoter is not, and
        // stamping it would put the wrong address (and timezone) on the event.
        const venueProfileId =
          targetProfile?.type === "venue" ? bookingRequest.targetProfileId : undefined;
        const timezone = await resolveEventTimezone(tx, venueProfileId, undefined);

        const [event] = await tx
          .insert(schema.events)
          .values({
            hostProfileId: bookingRequest.targetProfileId,
            title,
            baseCurrency,
            eventDate,
            venueProfileId,
            venueName: venueProfileId ? (targetProfile?.name ?? undefined) : undefined,
            notes: draftEventNotes(bookingRequest),
            timezone,
            createdBy: principal.userId,
          })
          .returning();
        if (!event) throw new Error("draft event create failed");

        await tx.insert(schema.eventParticipants).values({
          eventId: event.id,
          profileId: bookingRequest.targetProfileId,
          role: "host",
          permissionSetId: permissionSet.id,
          status: "confirmed",
        });

        // The act joins the same event, through whichever of the two doors fits.
        const attached = await attachSenderToEvent(tx, {
          sender,
          event,
          operatorUserId: principal.userId,
          actingProfileId: principal.actingProfileId ?? null,
        });

        // THE LINK IS THE LOCK. Re-stating the `event_id IS NULL` check inside the
        // write is what makes a second call — or a second CLICK arriving while the
        // first is still in flight — impossible to double-invite with: the 409
        // above is a read-then-write and two concurrent requests can both pass it,
        // but only one can match this UPDATE. The loser rolls back the event, the
        // participants and the invitation together.
        const [linked] = await tx
          .update(schema.bookingRequests)
          .set({ eventId: event.id, updatedAt: new Date() })
          .where(and(eq(schema.bookingRequests.id, id), isNull(schema.bookingRequests.eventId)))
          .returning();
        if (!linked) throw conflict("This request already has an event");

        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "booking_request.draft_event",
          targetKind: "event",
          targetId: event.id,
          eventId: event.id,
          before: bookingRequest,
          after: { event, bookingRequestId: id, sender: attached },
        });
        await writeActivity(tx, request, {
          eventId: event.id,
          type: "event.created",
          targetKind: "event",
          targetId: event.id,
          summary: { title: event.title, fromBookingRequestId: id },
        });

        return { event, attached };
      });

      // Delivery, after the commit and best-effort: the act is ON the event and
      // the invitation is redeemable whatever happens here, so a mail outage or a
      // notification hiccup must never undo the work. Reported honestly in the
      // response instead (`sender.emailed`), which is what lets the operator send
      // the link themselves rather than believe a mail that never left. Note that
      // `pnpm dev` does not load BREVO_API_KEY: locally this lands in the no-op
      // sink and prints to the console.
      const senderOutcome = await deliverDraftEventInvitation(request, {
        sender,
        event: created.event,
        attached: created.attached,
      });

      // A FRESH read of the entitlement layer (decisions #4 — never conflated with
      // authorization, never cached): what the plan allows RIGHT NOW, so the
      // screen can name the consequence of confirming this draft later.
      const cap = await canUseFeature(database, bookingRequest.targetProfileId, "create_event");

      return reply.status(201).send({
        requestId: id,
        eventId: created.event.id,
        title: created.event.title,
        eventDate: created.event.eventDate ?? null,
        baseCurrency: created.event.baseCurrency,
        status: created.event.status,
        eventCap: {
          allowed: cap.allowed,
          used: cap.used ?? null,
          limit: cap.limit ?? null,
          chargedAtConfirm: true as const,
        },
        sender: senderOutcome,
      });
    },
  );

  /**
   * "Make Offer" (§8): the recipient's counter — terms sent back to whoever asked.
   *
   * WHY NOT `POST /offers`. That route is the performer→venue direction and it is
   * built out of that direction: it stamps `source = 'performer_offer'`, derives
   * `sender_type` from the sending profile as performer-or-agency, meters the
   * sender against the artist plan's `send_offer` entitlement, and — the part that
   * settles it — addresses its recipient by `target_profile_id`. A public-form
   * sender has NO profile (that is the whole point of the public form), so there
   * is nothing to address. Reusing it would file the venue's reply as a performer
   * offer FROM the venue and drop every anonymous requester on the floor.
   *
   * WHAT THIS IS INSTEAD, honestly stated: a counter-offer is a MESSAGE on the
   * request, delivered to the person who asked — their notification feed when they
   * have an account, their email when they came in off the public form — and
   * recorded in the audit trail with its numbers. The request's status does NOT
   * move: the ball is with the requester, and `pending` is the truth until they
   * answer. There is no threaded reply model for booking requests (no
   * `countered` status, no message table on the request), and inventing one is a
   * schema + product decision, not something to smuggle into a button.
   */
  app.post(
    "/booking-requests/:id/counter-offer",
    {
      schema: { params: IdParams, body: CounterOfferBody, response: { 201: CounterOfferResponse } },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;
      const body = request.body;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const [bookingRequest] = await database
        .select()
        .from(schema.bookingRequests)
        .where(eq(schema.bookingRequests.id, id));
      if (!bookingRequest) throw notFound("Booking request not found");

      requireProfileRole(request, bookingRequest.targetProfileId, ["owner", "admin"]);

      const [sender] = await database
        .select({ profileName: schema.profiles.name, userEmail: schema.users.email })
        .from(schema.profiles)
        .innerJoin(schema.users, eq(schema.users.id, principal.userId))
        .where(eq(schema.profiles.id, bookingRequest.targetProfileId))
        .limit(1);

      const offeredDate = body.wantedDate ?? bookingRequest.wantedDate ?? null;
      const terms = counterOfferTerms({
        offerFeeMin: body.offerFeeMin,
        offerFeeMax: body.offerFeeMax,
        currency: bookingRequest.currency,
        wantedDate: offeredDate,
      });
      const fromName = sender?.profileName ?? "the venue";

      // The audit row is the RECORD of the counter — written first, in its own
      // transaction, so a mail hiccup can never lose what was offered.
      await database.transaction(async (tx) => {
        await writeAudit(tx, request, {
          capability: "event.view",
          action: "booking_request.counter_offer",
          targetKind: "booking_request",
          targetId: id,
          after: {
            message: body.message,
            wantedDate: offeredDate,
            offerFeeMin: body.offerFeeMin ?? null,
            offerFeeMax: body.offerFeeMax ?? null,
            currency: bookingRequest.currency,
          },
        });
      });

      // Delivery. An on-platform requester gets it in their feed; a public-form
      // requester gets an email with the venue's address as reply-to, because that
      // email IS the only channel back to them. Failure is reported to the caller
      // (`delivered: false`) rather than swallowed: "I sent your terms" has to be
      // true, and the operator can act on a failure they can see.
      // The branch itself is `resolveBookingRequestSender` — one definition, shared
      // with triage above and "Create Draft" below, so the three cannot drift into
      // disagreeing about who is reachable and how.
      const requester = resolveBookingRequestSender(bookingRequest);
      let channel: "notification" | "email" | "none" = "none";
      let deliveredTo: string | null = null;
      let delivered = false;
      try {
        if (requester.channel === "profile") {
          channel = "notification";
          await notifyProfileMembers(database, requester.senderProfileId, principal.userId, {
            type: "booking_request.counter_offer",
            title: `${fromName} replied with terms`,
            body: terms ? `${terms} — ${body.message}` : body.message,
            link: "/requests",
            metadata: {
              bookingRequestId: id,
              wantedDate: offeredDate,
              offerFeeMin: body.offerFeeMin ?? null,
              offerFeeMax: body.offerFeeMax ?? null,
              currency: bookingRequest.currency,
            },
          });
          delivered = true;
        } else if (requester.channel === "email") {
          channel = "email";
          deliveredTo = requester.email;
          await request.server.emailSink.sendEmail({
            to: requester.email,
            subject: `${fromName} replied to your booking request`,
            text: [
              `${bookingRequest.contactName ?? "Hi"},`,
              "",
              `${fromName} has replied to your request${terms ? ` with ${terms}` : ""}:`,
              "",
              body.message,
              "",
              "Reply to this email to continue the conversation.",
            ].join("\n"),
            replyTo: sender?.userEmail ?? undefined,
          });
          delivered = true;
        }
      } catch (error) {
        request.log.error({ error, bookingRequestId: id }, "counter-offer delivery failed");
      }

      return reply.status(201).send({ requestId: id, channel, deliveredTo, delivered });
    },
  );

  // Hand an event off to a venue not yet on the platform: mint an UNCLAIMED stub
  // profile (claimed_at NULL) plus a `venue_handoff` invitation linking it to the
  // event. The claim flow (taking ownership of the stub) lives in the invitations
  // module. Authority is `event.edit` on the event being handed off.
  app.post(
    "/events/:id/handoff",
    { schema: { params: IdParams, body: HandoffBody, response: { 201: HandoffResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;
      const body = request.body ?? {};
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      await requireEventCapability(request, id, "event.edit");

      const created = await database.transaction(async (tx) => {
        const suffix = randomBytes(6).toString("hex");
        // A stub profile: owned by the current caller as a placeholder, but
        // claimed_at NULL marks it unclaimed — the recipient claims it later.
        const [stub] = await tx
          .insert(schema.profiles)
          .values({
            kind: "operator",
            ownerUserId: principal.userId,
            name: body.name ?? "Unclaimed venue",
            slug: `handoff-${suffix}`,
            claimedAt: null,
            createdBy: principal.userId,
          })
          .returning();
        if (!stub) throw new Error("handoff stub create failed");

        const [invitation] = await tx
          .insert(schema.invitations)
          .values({
            type: "event_participant",
            source: "venue_handoff",
            status: "pending",
            token: generateToken(),
            // 90 days, the number the handoff reaper has always used
            // (`apps/jobs/src/reapers.ts`) and now the number the column says
            // too. Read on every redemption, so the rule bites without waiting
            // for a sweep.
            expiresAt: invitationExpiresAt("venue_handoff", new Date()),
            recipientEmail: body.recipientEmail,
            targetEventId: id,
            targetProfileId: stub.id,
            role: "co_host",
            createdByUser: principal.userId,
            createdByProfile: principal.actingProfileId,
          })
          .returning();
        if (!invitation) throw new Error("handoff invitation create failed");

        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "event.handoff",
          targetKind: "event",
          targetId: id,
          eventId: id,
          after: { profileId: stub.id, invitationId: invitation.id },
        });
        // Handing a booking to another venue IS event history — the event exists,
        // and everyone standing on it should be able to see that it changed hands.
        // `invitation` is the target kind because the invitation is the thing that
        // was created, and it reads under `event.view` (ACTIVITY_KIND_CAPABILITY),
        // so the audience is exactly the event's participants.
        //
        // The other three writes in this file deliberately get NO activity row:
        // `booking_request.update` (triage) and `spam.flag` happen on the REQUEST,
        // and `offer.create` happens before any event exists — an activity row is
        // scoped to an event, so there would be nothing to attach them to.
        await writeActivity(tx, request, {
          eventId: id,
          type: "event.handoff",
          targetKind: "invitation",
          targetId: invitation.id,
          summary: { profileId: stub.id, invitationId: invitation.id, role: invitation.role },
        });

        return {
          profileId: stub.id,
          invitationId: invitation.id,
          token: invitation.token as string,
        };
      });

      // Mail the venue their link, when we were given an address. Best-effort and
      // swallowed, exactly like `POST /invitations`: the handoff is already
      // persisted and redeemable, and the token comes back in the response either
      // way — so a mail outage costs the sender a copy-paste, never the handoff.
      let emailed = false;
      if (body.recipientEmail) {
        try {
          const [event] = await database
            .select({ title: schema.events.title })
            .from(schema.events)
            .where(eq(schema.events.id, id));
          await request.server.emailSink.sendEmail({
            to: body.recipientEmail,
            ...renderInvitationEmail({
              recipientName: body.name,
              inviterName: request.firebaseUser?.name,
              targetName: event?.title,
              targetKind: "event",
              code: null,
              token: created.token,
            }),
          });
          emailed = true;
        } catch (error) {
          request.log.error({ error, invitationId: created.invitationId }, "handoff email failed");
        }
      }

      return reply.status(201).send({ ...created, emailed });
    },
  );
}
