import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Guard: Leaflet requires browser APIs — skip during SSR
if (typeof window !== "undefined") {
  delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
  });
}

interface VenueMapProps {
  lat: number;
  lng: number;
  className?: string;
  zoom?: number;
}

export default function VenueMap({ lat, lng, className = "w-full h-48 rounded-lg", zoom = 14 }: VenueMapProps) {
  // SSR: render a placeholder div — map initialises on the client via useEffect
  if (typeof window === "undefined") return <div className={className} style={{ minHeight: "8rem" }} />;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([lat, lng], zoom);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    L.marker([lat, lng]).addTo(map);
    L.control.attribution({ position: "bottomright" }).addTo(map);
    mapRef.current = map;

    // Ensure tiles render after container is sized
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, zoom]);

  return <div ref={containerRef} className={className} style={{ minHeight: "8rem" }} />;
}
