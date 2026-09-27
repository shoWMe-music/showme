import { z } from "zod";

/**
 * A REAL CALENDAR DATE, `YYYY-MM-DD` — the shape every bare `date` column takes.
 *
 * The regex alone is not the check. `2026-02-30` and `2026-13-01` both match it and
 * neither exists, and Postgres answers a bad `date` with a 22008 that surfaces as a 500
 * rather than as the 400 it is. So the value is round-tripped through `Date` and compared
 * back to itself: anything the calendar does not contain fails here, with a message.
 *
 * It lived as a local const in `routes/inbound.ts` until a second module needed it
 * (`routes/profiles.ts`, for the dates in a shared availability snapshot). A validator
 * like this must not have two spellings — the copy that quietly accepts 30 February is a
 * data bug nobody sees until a settlement is denominated against it.
 */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a calendar date, e.g. 2026-09-01")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Not a real calendar date");
