import { useState, useRef, useEffect, useCallback } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { Combobox, ComboboxOption } from "@/components/ui/combobox";

const MAPBOX_TOKEN = import.meta.env.PROD
  ? "pk.eyJ1Ijoic2hvd21lLW11c2ljIiwiYSI6ImNtbDQyOHZnYjB2MXAzZXNhcGU2YTliZjcifQ.XsNWXkUUshPm-Zl2eftqaA"
  : "pk.eyJ1Ijoic2hvd21lLW11c2ljIiwiYSI6ImNtbDQyOWpncjB2MXUzZXNhYTVnMmNjcjQifQ.rHn5z4rYAxRS0RPr9571QQ";

export interface AddressResult {
  fullAddress: string;
  street?: string;
  city?: string;
  country?: string;
  postcode?: string;
  coordinates?: { lat: number; lng: number };
}

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  context?: Array<{ id: string; text: string; short_code?: string }>;
  address?: string;
  text?: string;
  properties?: { address?: string };
}

interface MapboxResponse {
  features: MapboxFeature[];
}

function parseFeature(feature: MapboxFeature): AddressResult {
  const ctx = feature.context || [];
  const getCtx = (prefix: string) => ctx.find((c) => c.id.startsWith(prefix))?.text;

  // street: combine address number + street name
  const streetNumber = feature.address || feature.properties?.address || "";
  const streetName = feature.text || "";
  const street = streetNumber ? `${streetName} ${streetNumber}` : streetName;

  return {
    fullAddress: feature.place_name,
    street: street || undefined,
    city: getCtx("place") || getCtx("locality") || undefined,
    country: getCtx("country") || undefined,
    postcode: getCtx("postcode") || undefined,
    coordinates: { lat: feature.center[1], lng: feature.center[0] },
  };
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string, result?: AddressResult) => void;
  placeholder?: string;
  className?: string;
}

export default function AddressAutocomplete({ value, onChange, placeholder = "Search address...", className }: AddressAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<MapboxFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 3) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&types=address,poi,place&limit=5&language=en`;
        const res = await fetch(url, { signal: controller.signal });
        const data: MapboxResponse = await res.json();
        setResults(data.features || []);
        setOpen((data.features || []).length > 0);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      }
      setLoading(false);
    }, 350);
  }, []);

  return (
    <Combobox
      value={query}
      onValueChange={(v) => {
        setQuery(v);
        search(v);
        onChange(v);
      }}
      placeholder={placeholder}
      className={className}
      open={open}
      onOpenChange={setOpen}
      inputPrefix={<MapPin className="h-4 w-4 text-muted-foreground" />}
      inputSuffix={loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : undefined}
    >
      {results.map((feature) => (
        <ComboboxOption
          key={feature.id}
          onSelect={() => {
            const parsed = parseFeature(feature);
            setQuery(parsed.fullAddress);
            setOpen(false);
            onChange(parsed.fullAddress, parsed);
          }}
        >
          <MapPin className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <span className="line-clamp-2">{feature.place_name}</span>
        </ComboboxOption>
      ))}
    </Combobox>
  );
}
