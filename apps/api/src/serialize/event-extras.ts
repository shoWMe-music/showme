import { z } from "zod";

/**
 * The `events.extras` jsonb — the read-with-parent leaves the blueprint parks on
 * the event itself (PLAN.md: "amenities / catering / ticket links, read with the
 * event") rather than in their own tables, because none are queried across:
 * amenities, ticket tiers, and the operator's guest/comp list. Typed here so both
 * the route bodies (validation) and the response schema (shape) share one source.
 */

const TicketTier = z.object({
  id: z.string(),
  name: z.string(),
  /** Major-unit price for this tier (display-only; settlement money lives in budget lines). */
  price: z.number().nonnegative(),
  /** Inventory cap for this tier. */
  max: z.number().int().nonnegative(),
  /** Estimated sales for planning. */
  est: z.number().int().nonnegative(),
});

const GuestEntry = z.object({
  id: z.string(),
  name: z.string(),
  tickets: z.number().int().positive(),
  /** Free-text "invited by" attribution (performer / venue / promoter …). */
  invitedBy: z.string(),
});

/**
 * WHAT THE VENUE LENT THIS SHOW, and when — the receipt for a COPY.
 *
 * A venue writes its amenities, its catering and its load-in once, on its
 * profile; placing an event there copies them onto the event so nobody retypes
 * them (ClickUp 86cbaxvku). The copy is a copy: an agreement freezes at
 * confirmation, so a venue that sells its PA in March must not rewrite what it
 * promised in January. Nothing here is ever re-read from the profile.
 *
 * The stamp exists because a value that silently appeared and cannot be
 * explained is worse than a blank field. It names the room, the moment, and
 * exactly which leaves arrived that way — which is what lets the event screen
 * say "from The Lantern Hall's profile" and offer to take those, and only
 * those, back off again.
 *
 * `venueName` is stored rather than looked up for the same reason the values
 * are: it is what the room was CALLED when it lent them, and a rename later
 * must not rewrite the receipt.
 */
const VenueCarryOver = z.object({
  profileId: z.string(),
  venueName: z.string(),
  /** ISO instant the copy was taken. */
  copiedAt: z.string(),
  /** The leaf names filled by this copy — `extras` keys plus event columns. */
  fields: z.array(z.string()),
});

export const EventExtrasSchema = z
  .object({
    amenities: z.array(z.string()).optional(),
    /** House PA as the venue writes it ("d&b audiotechnik V-Series"). Copied. */
    soundSystem: z.string().nullable().optional(),
    cateringNotes: z.string().nullable().optional(),
    accommodationNotes: z.string().nullable().optional(),
    /** Load-in, back entrance, artist parking (decisions #16.7). Copied. */
    artistLogisticsNotes: z.string().nullable().optional(),
    /** Where the show stands. The event has no location column — the venue is it. */
    city: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    venueCarryOver: VenueCarryOver.optional(),
    ticketTiers: z.array(TicketTier).optional(),
    guestList: z
      .object({
        limitTotal: z.number().int().nonnegative().nullable().optional(),
        limitPerGuest: z.number().int().nonnegative().nullable().optional(),
        guests: z.array(GuestEntry).optional(),
      })
      .optional(),
    /** Ticketing-provider connection stamp ("ticket links" in the blueprint). */
    ticketing: z
      .object({
        provider: z.string().nullable().optional(),
        syncedAt: z.string().nullable().optional(),
      })
      .optional(),
  })
  // Forward-compatible: unknown future leaves survive a round-trip untouched.
  .passthrough();

export type EventExtras = z.infer<typeof EventExtrasSchema>;
