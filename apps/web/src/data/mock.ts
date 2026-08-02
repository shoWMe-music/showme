import type { Status } from "@showme/design-system";

/** Mock data stands in for the API (Phase 1–2 not wired yet). Party-scoped
 * visibility, real settlement math etc. land when apps/api is connected. */
export interface EventRow {
  id: string;
  artist: string;
  venue: string;
  city: string;
  date: string;
  status: Status;
  guarantee: number;
  ticketsSold: number;
  capacity: number;
}

export const events: EventRow[] = [
  { id: "EVT-G051", artist: "Marlo Vance", venue: "The Lantern Hall", city: "Berlin", date: "2026-04-12", status: "confirmed", guarantee: 4500, ticketsSold: 980, capacity: 1200 },
  { id: "EVT-G052", artist: "Velvet Coast", venue: "Warehouse 9", city: "London", date: "2026-04-19", status: "pending", guarantee: 3200, ticketsSold: 0, capacity: 800 },
  { id: "EVT-G053", artist: "Neon Harbor", venue: "Meridian Club", city: "Brixton", date: "2026-04-24", status: "hold", guarantee: 2600, ticketsSold: 0, capacity: 600 },
  { id: "EVT-G054", artist: "June Delacroix", venue: "Ironworks", city: "Bristol", date: "2026-03-28", status: "concluded", guarantee: 3000, ticketsSold: 742, capacity: 750 },
  { id: "EVT-G055", artist: "The Tidal Room", venue: "Astra", city: "Berlin", date: "2026-05-03", status: "suggested", guarantee: 5200, ticketsSold: 0, capacity: 1500 },
  { id: "EVT-G056", artist: "Halcyon Bloom", venue: "Columbia Theater", city: "Berlin", date: "2026-05-10", status: "draft", guarantee: 0, ticketsSold: 0, capacity: 3500 },
  { id: "EVT-G057", artist: "Ember & Oak", venue: "Slaktkyrkan", city: "Stockholm", date: "2026-05-16", status: "confirmed", guarantee: 4100, ticketsSold: 610, capacity: 900 },
  { id: "EVT-G058", artist: "Paper Lanterns", venue: "Debaser", city: "Stockholm", date: "2026-02-14", status: "cancelled", guarantee: 2200, ticketsSold: 0, capacity: 500 },
];

export const eur = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export function eventById(id: string): EventRow | undefined {
  return events.find((e) => e.id === id);
}
