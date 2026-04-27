import { useState, useRef, useEffect, useCallback } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { Combobox, ComboboxOption } from "@/components/ui/combobox";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string, coordinates?: { lat: number; lng: number }) => void;
  placeholder?: string;
  className?: string;
}

export default function AddressAutocomplete({ value, onChange, placeholder = "Search address…", className }: AddressAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setQuery(value); }, [value]);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 3) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=1`, {
          headers: { "Accept-Language": "en" },
        });
        const data: NominatimResult[] = await res.json();
        setResults(data);
        setOpen(data.length > 0);
      } catch { setResults([]); }
      setLoading(false);
    }, 400);
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
      {results.map(r => (
        <ComboboxOption
          key={r.place_id}
          onSelect={() => {
            setQuery(r.display_name);
            setOpen(false);
            onChange(r.display_name, { lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
          }}
        >
          <MapPin className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <span className="line-clamp-2">{r.display_name}</span>
        </ComboboxOption>
      ))}
    </Combobox>
  );
}
