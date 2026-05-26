import { useQuery } from "@tanstack/react-query";
import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "@/integrations/firebase/app";

/**
 * Mirror of the cap-state shape returned by `getEventCapStatus`. The
 * Cloud Function uses `Infinity` for `remaining` on unlimited plans; on the
 * wire that serializes as `null`, so the client coerces it back here.
 */
export interface EventCapState {
  count: number;
  cap: number;
  graceCap: number;
  /** Always finite on the client — unlimited plans use Number.POSITIVE_INFINITY. */
  remaining: number;
  inGrace: boolean;
  blocked: boolean;
  /** False when the cap doesn't apply (paid plan, performer profile, etc.). */
  applies: boolean;
}

interface RawCapStateOverWire {
  count: number;
  cap: number;
  graceCap: number;
  remaining: number | null;
  inGrace: boolean;
  blocked: boolean;
  applies: boolean;
}

function normalize(raw: RawCapStateOverWire): EventCapState {
  return {
    ...raw,
    remaining:
      raw.remaining === null || !Number.isFinite(raw.remaining)
        ? Number.POSITIVE_INFINITY
        : raw.remaining,
  };
}

/**
 * Fetch the rolling-12-month event-cap state for a profile. Used by the
 * billing portal (progress bar) and pre-flight checks before pushing an event
 * into `confirmed`.
 *
 * Stale for 30s — long enough to dedupe rapid re-renders, short enough that
 * cancelling 5 events feels responsive on the next refresh.
 */
export function useEventCapStatus(profileId: string | null | undefined) {
  return useQuery({
    queryKey: ["eventCapStatus", profileId ?? ""] as const,
    enabled: !!profileId,
    staleTime: 30_000,
    queryFn: async (): Promise<EventCapState> => {
      if (!profileId) {
        return {
          count: 0,
          cap: 60,
          graceCap: 66,
          remaining: Number.POSITIVE_INFINITY,
          inGrace: false,
          blocked: false,
          applies: false,
        };
      }
      const fn = httpsCallable<
        { profileId: string },
        RawCapStateOverWire
      >(getFirebaseFunctions(), "getEventCapStatus");
      const res = await fn({ profileId });
      return normalize(res.data);
    },
  });
}
