import { useGetApiV1EventsIdPerformingRightsRate } from "@showme/api-client";
import { type PerformingRightsTerritory, isProCode } from "@showme/shared";
import { useMemo } from "react";

/**
 * Which PRO rate governs this show — the half of the estimate the browser cannot
 * work out for itself.
 *
 * The API answers two things at once: WHERE the show is (resolved from the
 * venue's country, not the operator's — a Swedish promoter in a Berlin room owes
 * GEMA) and WHAT a platform admin configured for that territory. Either can be
 * null, and the two nulls mean different things on the card: an unplaceable show
 * versus a placeable one nobody has priced.
 *
 * While the query is in flight this returns `undefined`, which
 * `estimatePerformingRightsFee` reads as "no territory" and answers with the flat
 * planning estimate, labelled as such. A moment of honest caution is the right
 * thing to show before the answer arrives.
 */
export function usePerformingRightsTerritory(
  eventId: string,
): PerformingRightsTerritory | undefined {
  const { data } = useGetApiV1EventsIdPerformingRightsRate(eventId);

  return useMemo(() => {
    if (!data) return undefined;
    const { country, rate } = data;
    if (!rate) return { country, rate: null };
    return {
      country,
      rate: {
        // The rate's own country is the one it was looked up by, so the two
        // always agree; carrying it keeps the estimate self-describing.
        country: country ?? "",
        // The wire carries the filing code as a plain string. Anything not in the
        // four-value enum reads as `none` — which is what a society we cannot
        // file with means anyway, and the card names it from `proName` regardless.
        proCode: isProCode(rate.proCode) ? rate.proCode : "none",
        proName: rate.proName,
        rateBasisPoints: rate.rateBasisPoints,
        sourceUrl: rate.sourceUrl,
        sourceNote: rate.sourceNote,
      },
    };
  }, [data]);
}
