/**
 * WHAT A SENDABLE OFFER IS — the rule behind the composer (QA sweep run 7, QA7-5).
 *
 * `POST /offers` has existed, resolved the acting profile, gated the free tier and
 * accepted a fee range, a pitch and an agent's `onBehalfOfProfileId` since it was
 * written — and **`usePostApiV1Offers` had no caller anywhere in `apps/web`**. A
 * signed-in act's only route to a venue was to leave the app, find that venue's public
 * page and fill in a stranger's form, which writes `source: public_form`,
 * `sender_profile_id: null`, no fee range and no agency attribution. The Outgoing tab
 * therefore listed seeded rows no user of this build could produce, and the free-tier
 * offer cap was unreachable code.
 *
 * The rule lives here rather than in the dialog for the usual reason: a composer that
 * disables its own button for the wrong reason is indistinguishable from one that works,
 * and this is the only part a test can hold.
 */

/** What the composer holds while somebody types into it. Every field a string. */
export interface OfferDraft {
  /** The venue's profile id, set by the picker — "" until one is chosen. */
  targetProfileId: string;
  /** `YYYY-MM-DD`, from the date control. */
  wantedDate: string;
  /** Major units as typed, or "" for "not saying". */
  feeMin: string;
  feeMax: string;
  pitch: string;
  /**
   * The act this offer is FOR, when the sender is an agent (#14). Empty for everybody
   * else, and empty is the correct value — the route refuses the key from a non-agent
   * rather than ignoring it.
   */
  onBehalfOfProfileId: string;
}

export type OfferProblem =
  | "no-venue"
  | "no-date"
  | "date-in-the-past"
  | "fee-not-a-number"
  | "fee-upside-down"
  | "no-act"
  | null;

/**
 * Why this draft cannot be sent, or null when it can.
 *
 * Asked in the order a person fills the form in, so the message names the first thing
 * they have not done rather than the last.
 *
 * @param today `YYYY-MM-DD` in the reader's own day — passed rather than read, because a
 *   rule that reads the clock cannot be tested at a boundary.
 * @param senderIsAnAgent an agent must name the act, because an offer sent by an agency
 *   on nobody's behalf is the "no agency attribution" defect inverted.
 */
export function offerProblem(
  draft: OfferDraft,
  options: { today: string; senderIsAnAgent: boolean },
): OfferProblem {
  if (draft.targetProfileId.trim() === "") return "no-venue";
  if (draft.wantedDate.trim() === "") return "no-date";
  // A string compare is a date compare in `YYYY-MM-DD`, and it needs no timezone.
  if (draft.wantedDate < options.today) return "date-in-the-past";
  if (options.senderIsAnAgent && draft.onBehalfOfProfileId.trim() === "") return "no-act";

  const min = feeNumber(draft.feeMin);
  const max = feeNumber(draft.feeMax);
  if (min === "invalid" || max === "invalid") return "fee-not-a-number";
  if (min !== null && max !== null && min > max) return "fee-upside-down";
  return null;
}

/** One sentence per problem, in the reader's words. Null for a sendable draft. */
export function offerProblemMessage(problem: OfferProblem): string | null {
  switch (problem) {
    case "no-venue":
      return "Choose the venue you are offering to.";
    case "no-date":
      return "Pick the date you want.";
    case "date-in-the-past":
      return "That date has already passed.";
    case "fee-not-a-number":
      return "A fee has to be a number, or left blank.";
    case "fee-upside-down":
      return "The lowest fee is above the highest.";
    case "no-act":
      return "Choose which of your acts this offer is for.";
    default:
      return null;
  }
}

/**
 * A typed fee as a number, `null` for "not saying", `"invalid"` for something that is
 * not a fee. Blank is a real answer: the route takes the key or takes nothing.
 */
function feeNumber(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return "invalid";
  return parsed;
}

/**
 * The body `POST /offers` should be sent, for a draft `offerProblem` has passed.
 *
 * Every optional key is OMITTED rather than sent empty — the route's Zod schema takes
 * the key or takes nothing, and an empty string is a value somebody typed.
 *
 * `majorToMinor` is not used here because the caller knows the currency and this does
 * not: fees are handed over as major-unit strings and converted at the edge, which keeps
 * this rule free of a currency it would have to guess.
 */
export function offerBody(
  draft: OfferDraft,
  toMinor: (majorUnits: string) => string,
): Record<string, unknown> {
  const pitch = draft.pitch.trim();
  const min = draft.feeMin.trim();
  const max = draft.feeMax.trim();
  const act = draft.onBehalfOfProfileId.trim();
  return {
    targetProfileId: draft.targetProfileId,
    /*
     * THE VENUE, NAMED AS WELL AS TARGETED — #25.1 and QA7-4.
     *
     * An offer's target IS the venue, so this is the same id twice — and it is worth
     * sending, because `booking_requests.venue_profile_id` is the column the operator's
     * double-booking check reads. `placeOfRequest` requires the two to agree ("A request
     * can only name the venue it is being sent to"), so this is the one value it can
     * legally be. Sending it means an offer arrives already comparable rather than relying
     * on the reader's fallback.
     */
    venueProfileId: draft.targetProfileId,
    wantedDate: draft.wantedDate,
    ...(min === "" ? {} : { offerFeeMin: toMinor(min) }),
    ...(max === "" ? {} : { offerFeeMax: toMinor(max) }),
    ...(pitch === "" ? {} : { pitch }),
    ...(act === "" ? {} : { onBehalfOfProfileId: act }),
  };
}
