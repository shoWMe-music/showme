import { schema } from "@showme/db";
import { and, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

/**
 * WHERE THE SHOW HAPPENS — the venue's country, and nothing else.
 *
 * Territory first, account second (decisions.md #17). A Swedish promoter putting
 * on a night in a Berlin room owes GEMA, not STIM, because the performance
 * happened in Germany; the host's own country is the single most tempting wrong
 * answer available and it is never consulted here.
 *
 * WHY IT IS A MODULE AND NOT A LOCAL FUNCTION: two routes now decide a territory,
 * and they must decide it the same way. `performing-rights.ts` resolves the
 * tariff the Budget Planner estimates against, and `performance-reports.ts`
 * stamps the country onto the filing that estimate ends up on. If those drifted,
 * an operator would budget against one society and file with another — and the
 * filing is the one that goes to a rights body.
 *
 * The primary location first, then any location the venue has recorded — a venue
 * that filled in an address without ticking "primary" is still in a country. When
 * the event has no venue profile, or that profile has recorded no country, this
 * returns null. That is a better answer than a guess, and it is one an operator
 * can fix: it means "tell us where your room is", which is a thing they can go
 * and do. The filing route refuses to write a row in that state for exactly that
 * reason — a filing whose society is unknown is not a filing.
 */
export async function resolveEventCountry(
  database: FastifyInstance["database"],
  venueProfileId: string | null,
): Promise<string | null> {
  if (!venueProfileId) return null;

  const locations = await database
    .select({
      country: schema.profileLocations.country,
      isPrimary: schema.profileLocations.isPrimary,
    })
    .from(schema.profileLocations)
    .where(
      and(
        eq(schema.profileLocations.profileId, venueProfileId),
        // A row with no country cannot place anything, and letting one win over a
        // secondary address that HAS a country would lose real information.
        // Filtering in SQL rather than after the fact keeps that from happening.
        isNotNull(schema.profileLocations.country),
      ),
    );

  const primary = locations.find((location) => location.isPrimary && location.country);
  const fallback = locations.find((location) => location.country);
  const country = primary?.country ?? fallback?.country ?? null;
  return country ? normalizeTerritory(country) : null;
}

/**
 * Uppercase alpha-2, or null. Mirrors `findPerformingRightsRate`'s normalization
 * so the lookup against `performing_rights_rates.country` (stored uppercase,
 * CHECK-constrained in migration 0018) can be a plain equality — and so the
 * `performance_reports.country` CHECK (0023) can never be handed a bad value.
 */
function normalizeTerritory(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}
