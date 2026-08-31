import { type GetApiV1Geocode200, useGetApiV1Geocode } from "@showme/api-client";
import { ApiError } from "@showme/api-client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

/** One candidate address, exactly as `GET /geocode` returns it. */
export type AddressSuggestion = GetApiV1Geocode200["results"][number];

/** Below this, the query is too vague to be worth a metered lookup. */
const MINIMUM_QUERY_LENGTH = 3;

export interface AddressSearchOptions {
  /** What the owner has typed into the address field. */
  query: string;
  /** The profile's country, when it has one — narrows the search to it. */
  countryHint?: string;
  /** False while the field is closed: no request goes out at all. */
  enabled: boolean;
}

export interface AddressSearch {
  suggestions: AddressSuggestion[];
  isSearching: boolean;
  /**
   * This deployment cannot geocode (no Mapbox token, or the provider is down).
   * The field must stay a working text box in that case — every venue in the
   * database today was entered without any of this.
   */
  isUnavailable: boolean;
}

/**
 * Address suggestions for the profile editor, debounced.
 *
 * The keystrokes stay in the component; the settled value comes here and becomes
 * one request to OUR API, which holds the Mapbox token (see
 * `apps/api/src/routes/geocode.ts`). Two guards keep the bill and the flicker
 * down: nothing fires under three characters, and the debounced value — not the
 * raw one — is what the query key is built from, so React Query dedupes and
 * caches repeat searches for free.
 */
export function useAddressSearch({
  query,
  countryHint,
  enabled,
}: AddressSearchOptions): AddressSearch {
  const term = useDebouncedValue(query.trim(), 300);
  const isLongEnough = term.length >= MINIMUM_QUERY_LENGTH;

  const lookup = useGetApiV1Geocode(
    { query: term, limit: 6, ...(countryHint ? { country: countryHint } : {}) },
    {
      query: {
        enabled: enabled && isLongEnough,
        // An address does not move. Keeping the answer means backspacing one
        // character and retyping it costs nothing.
        staleTime: 5 * 60_000,
        // 503 (unconfigured) and 502 (provider down) are settled facts about the
        // deployment, not blips — retrying them just delays the fallback.
        retry: false,
      },
    },
  );

  return {
    suggestions: lookup.data?.results ?? [],
    isSearching: lookup.isFetching,
    isUnavailable: lookup.error instanceof ApiError && lookup.error.status >= 500,
  };
}
