/**
 * Address lookup — turning what a venue types into a doorstep AND a map pin.
 *
 * It is a server-side sink for the same reason `LeadSink` and `EmailSink` are:
 * the credential belongs to the deployment, not to the browser bundle. The
 * previous app shipped its Mapbox token in client source
 * (`../showme-settle-fast/src/components/AddressAutocomplete.tsx`); this one
 * reads it from the environment (Secret Manager in production) and proxies the
 * query, which also gives us one place to rate-limit.
 *
 * When no token is configured the geocoder is NULL — the ordinary state on a
 * laptop and in every test. The route then answers 503 and the address field
 * stays an ordinary text box, exactly as it was before this existed. Same shape
 * as `createCalendarIntegration`.
 */

/** One candidate address, already split into the columns `profile_locations` holds. */
export interface GeocodeResult {
  /** The provider's id for the feature — a stable React key, nothing more. */
  id: string;
  /** The whole address on one line, as the picker shows it. */
  label: string;
  street: string | null;
  postcode: string | null;
  city: string | null;
  /** ISO-3166 alpha-2, uppercase — the same vocabulary `profile_locations.country` holds. */
  country: string | null;
  lat: number;
  lng: number;
}

export interface GeocodeQuery {
  query: string;
  limit: number;
  /** ISO-3166 alpha-2 to bias/restrict the search to, when the profile already has one. */
  country?: string;
}

export interface Geocoder {
  search(query: GeocodeQuery): Promise<GeocodeResult[]>;
}

interface MapboxContextEntry {
  id: string;
  text?: string;
  short_code?: string;
}

interface MapboxFeature {
  id?: string;
  place_name?: string;
  place_type?: string[];
  center?: [number, number];
  text?: string;
  address?: string;
  properties?: { address?: string; short_code?: string };
  context?: MapboxContextEntry[];
}

/**
 * Mapbox's `short_code` for a country is lowercase ("se"), and sometimes carries
 * a subdivision ("us-ny") on a region entry. `profile_locations.country` holds
 * two uppercase letters and the Zod body caps it at two, so anything else is
 * dropped rather than truncated into a wrong country.
 */
function isoCountry(shortCode: string | undefined): string | null {
  if (!shortCode) return null;
  const code = shortCode.split("-")[0]?.toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}

/**
 * Fold one Mapbox feature into our columns.
 *
 * The street is `text` (the street name) plus `address` (the number) in that
 * order — European, and the order the previous app used against the same
 * provider and the same real data.
 */
export function parseMapboxFeature(feature: MapboxFeature): GeocodeResult | null {
  const center = feature.center;
  if (!center || typeof center[0] !== "number" || typeof center[1] !== "number") return null;

  const context = feature.context ?? [];
  const contextText = (prefix: string) =>
    context.find((entry) => entry.id.startsWith(prefix))?.text ?? null;

  const isAddress = feature.place_type?.includes("address") ?? false;
  const houseNumber = feature.address ?? feature.properties?.address ?? "";
  const streetName = feature.text ?? "";
  // Only an address feature has a doorstep. A "place" (a city) or a "poi" whose
  // `text` is its NAME would otherwise write "Debaser Strand" into the street.
  const street = isAddress
    ? [streetName, houseNumber].filter(Boolean).join(" ").trim() || null
    : (feature.properties?.address ?? null);

  const countryEntry = context.find((entry) => entry.id.startsWith("country"));
  const country =
    isoCountry(countryEntry?.short_code) ??
    (feature.place_type?.includes("country") ? isoCountry(feature.properties?.short_code) : null);

  return {
    id: feature.id ?? `${center[0]},${center[1]}`,
    label: feature.place_name ?? streetName,
    street,
    postcode: contextText("postcode"),
    // `place` is the town/city; `locality` is the neighbourhood a small address
    // sometimes carries instead. A city feature is its own city.
    city:
      contextText("place") ??
      contextText("locality") ??
      (feature.place_type?.includes("place") ? (feature.text ?? null) : null),
    country,
    lat: center[1],
    lng: center[0],
  };
}

export interface MapboxGeocoderConfig {
  accessToken: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImplementation?: typeof fetch;
}

export function createMapboxGeocoder(config: MapboxGeocoderConfig): Geocoder {
  const doFetch = config.fetchImplementation ?? fetch;
  return {
    async search({ query, limit, country }) {
      const parameters = new URLSearchParams({
        access_token: config.accessToken,
        types: "address,poi,place",
        limit: String(limit),
        language: "en",
        autocomplete: "true",
      });
      if (country) parameters.set("country", country.toLowerCase());

      const response = await doFetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${parameters}`,
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Mapbox geocoding failed (${response.status}): ${detail.slice(0, 200)}`);
      }
      const body = (await response.json()) as { features?: MapboxFeature[] };
      return (body.features ?? [])
        .map(parseMapboxFeature)
        .filter((result): result is GeocodeResult => result !== null);
    },
  };
}

/**
 * The geocoder for this deployment, or null when it has no token. Null is not a
 * failure — it is a laptop, a test run, or a deployment that has chosen not to
 * pay for lookups, and everything except the address suggestions still works.
 */
export function createGeocoder(config: {
  mapboxAccessToken?: string;
  fetchImplementation?: typeof fetch;
}): Geocoder | null {
  if (!config.mapboxAccessToken) return null;
  return createMapboxGeocoder({
    accessToken: config.mapboxAccessToken,
    fetchImplementation: config.fetchImplementation,
  });
}
