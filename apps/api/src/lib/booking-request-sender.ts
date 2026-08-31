import type { schema } from "@showme/db";

type BookingRequestRow = typeof schema.bookingRequests.$inferSelect;

/**
 * HOW A BOOKING REQUEST'S SENDER CAN BE REACHED — the one definition of a branch
 * three routes in `routes/inbound.ts` were each about to make for themselves.
 *
 * The question is always the same: the person who asked either has an account
 * (`sender_profile_id`, so they have a feed, a profile and members) or they came
 * in off the public form and are nothing but an email address. Triage answers it
 * to decide whether the status change reaches anyone; "Make Offer" answers it to
 * choose between a notification and a reply-to email; and "Create Draft" answers
 * it to choose between adding an existing profile to the event and minting an
 * unclaimed stub for a stranger to claim. Written out three times, the three
 * would drift — and the way they would drift is a sender who is silently dropped,
 * which is the failure this shape exists to make impossible to write.
 *
 * `actProfileId` is the part only an inbound route knows to ask for: when an
 * AGENT sends the offer, the sending profile is the agency and the act is the
 * performer it represents (decisions.md #14). The agency is who you REPLY to; the
 * performer is who goes on the bill (story.md — "a booking agent, not the
 * talent"). Anything that puts a profile on the event wants the second one.
 */
export type BookingRequestSender =
  | {
      channel: "profile";
      /** The profile that sent it — an agency when an agent is offering. */
      senderProfileId: string;
      /** The profile that would PLAY: the represented act, or the sender itself. */
      actProfileId: string;
      /** The act's name as the sender stated it, for copy. */
      name: string;
    }
  | { channel: "email"; email: string; name: string }
  /** Neither an account nor an address — nothing to answer. Rare, and not an error. */
  | { channel: "none" };

export function resolveBookingRequestSender(row: BookingRequestRow): BookingRequestSender {
  if (row.senderProfileId) {
    return {
      channel: "profile",
      senderProfileId: row.senderProfileId,
      actProfileId: row.onBehalfOfProfileId ?? row.senderProfileId,
      name: row.artistName ?? row.contactName ?? "the act",
    };
  }
  if (row.email) {
    return {
      channel: "email",
      email: row.email,
      // The ACT first: a stub profile minted from this is a performer profile, so
      // it should be named after the band, not the person who typed the form.
      name: row.artistName ?? row.contactName ?? "Unnamed act",
    };
  }
  return { channel: "none" };
}
