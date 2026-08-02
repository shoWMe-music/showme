import { schema } from "@showme/db";
import { zoneForCountry } from "@showme/time";
import { desc, eq } from "drizzle-orm";
import type { Transaction } from "./audit";

/**
 * Resolve the IANA timezone to SNAPSHOT onto an event (decisions #10). Precedence:
 *   1. an explicit timezone on the request (an operator override),
 *   2. the venue's primary LOCATION country → its default zone.
 * Null when nothing resolves — the event simply carries no local anchor yet. The
 * result is stored on `events.timezone`, so a later venue change is a re-snapshot,
 * never a retro-shift of already-entered local times.
 */
export async function resolveEventTimezone(
  tx: Transaction,
  venueProfileId: string | null | undefined,
  explicitTimezone: string | null | undefined,
): Promise<string | null> {
  if (explicitTimezone) return explicitTimezone;
  if (!venueProfileId) return null;

  const [location] = await tx
    .select({ country: schema.profileLocations.country })
    .from(schema.profileLocations)
    .where(eq(schema.profileLocations.profileId, venueProfileId))
    .orderBy(desc(schema.profileLocations.isPrimary))
    .limit(1);
  if (location?.country) return zoneForCountry(location.country);

  return null;
}
