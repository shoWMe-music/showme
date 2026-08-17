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

export const EventExtrasSchema = z
  .object({
    amenities: z.array(z.string()).optional(),
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
