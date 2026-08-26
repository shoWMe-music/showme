import { useGetApiV1ProfilesId } from "@showme/api-client";
import { useMemo } from "react";

/**
 * What a venue profile already says about itself, ready to be OFFERED to an
 * event being placed there.
 *
 * A venue writes its capacity, its house curfew and its amenities down once, on
 * its profile (`venue_details`, migration 0010), and its city once, on
 * `profile_locations`. Until now none of it travelled: picking the venue on an
 * event carried the timezone across and nothing else, so a promoter re-typed the
 * same room's capacity onto every booking and the Amenities card started empty
 * every time.
 *
 * This is the CLIENT half of the fix, and it exists so the operator can SEE the
 * suggestion before it is saved — the wizard fills its own visible fields, which
 * are then as editable as anything else they typed. The server half
 * (`apps/api/src/routes/events.ts`, "Venue-profile prefill") is the backstop for
 * every other caller, and it only ever fills a field that is genuinely blank.
 */
export interface VenueProfileDefaults {
  name: string;
  city: string | null;
  country: string | null;
  capacity: number | null;
  curfew: string | null;
  amenities: string[];
}

/**
 * Read the chosen venue profile's own record. `null` while nothing is chosen or
 * the profile is still loading — a caller must never fill fields from a
 * half-loaded venue.
 */
export function useEventVenuePrefill(venueProfileId: string | null): VenueProfileDefaults | null {
  const profile = useGetApiV1ProfilesId(venueProfileId ?? "", {
    query: { enabled: Boolean(venueProfileId) },
  });

  const data = profile.data;
  // Memoized on the fetched row: a caller prefills from this inside an effect,
  // and a fresh object every render would re-run that effect every render.
  return useMemo(() => {
    if (!venueProfileId || !data) return null;
    return {
      name: data.name,
      city: data.location?.city ?? null,
      country: data.location?.country ?? null,
      capacity: data.venueDetails?.capacity ?? null,
      curfew: data.venueDetails?.curfew ?? null,
      amenities: data.venueDetails?.amenities ?? [],
    };
  }, [venueProfileId, data]);
}
