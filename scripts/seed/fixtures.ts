/**
 * Firestore seed fixtures for `npm run seed` only — not part of the Vite app bundle.
 */
import {
  calculateSettlement,
  type Agreement,
  type CrewMember,
  type DealStructure,
  type DealType,
  type Event,
  type EventCollaborator,
  type EventStatus,
  type Contact,
  type Rider,
  type ScheduleItem,
  type Settlement,
  type SettlementStatus,
  type TicketRevenue,
} from "../../src/lib/models.ts";
import type { EventMeta } from "../../src/lib/db.ts";

/** Fixtures used by `npm run seed` and tests — not loaded by the app at runtime. */
export const seedEvents: Event[] = [
  {
    id: "EVT-001",
    name: "Neon Nights Festival",
    date: "2026-03-08",
    venue: "Paradiso, Amsterdam",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "Eventbrite", url: "https://tickets.example.com/evt-001" }],
    capacity: 1500,
    artist: "Aurora",
    eventStatus: "concluded",
    status: "finalized",
    amenities: ["backline", "sound_engineer", "lighting", "light_engineer", "parking", "catering"],
  },
  {
    id: "EVT-002",
    name: "Jazz at the Park",
    date: "2026-03-15",
    venue: "Vondelpark Theater",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "Ticketmaster", url: "https://tickets.example.com/evt-002" }],
    capacity: 800,
    artist: "GoGo Penguin",
    eventStatus: "concluded",
    status: "revised",
  },
  {
    id: "EVT-003",
    name: "Electronic Pulse",
    date: "2026-03-22",
    venue: "Melkweg, Amsterdam",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "DICE", url: "https://tickets.example.com/evt-003" }],
    capacity: 1200,
    artist: "Moderat",
    eventStatus: "concluded",
    status: "pending_review",
    amenities: ["sound_engineer", "lighting", "parking"],
  },
  {
    id: "EVT-004",
    name: "Indie Showcase",
    date: "2026-04-05",
    venue: "TivoliVredenburg, Utrecht",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "See Tickets", url: "https://tickets.example.com/evt-004" }],
    capacity: 2000,
    artist: "Fontaines D.C.",
    eventStatus: "concluded",
    status: "comments_received",
  },
  {
    id: "EVT-005",
    name: "Summer Beats Open Air",
    date: "2026-04-18",
    venue: "Zuiderpark, Den Haag",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "Paylogic", url: "https://tickets.example.com/evt-005" }],
    capacity: 5000,
    artist: "Bonobo",
    eventStatus: "suggested",
    status: "open",
  },
  {
    id: "EVT-006",
    name: "Acoustic Sessions",
    date: "2026-05-02",
    venue: "Paradiso, Amsterdam",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "Eventbrite", url: "https://tickets.example.com/evt-006" }],
    capacity: 400,
    artist: "José González",
    eventStatus: "pending",
    status: "open",
  },
  {
    id: "EVT-007",
    name: "Bass Culture",
    date: "2026-05-15",
    venue: "Melkweg, Amsterdam",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "DICE", url: "https://tickets.example.com/evt-007" }],
    capacity: 1000,
    artist: "Noisia",
    eventStatus: "on_hold",
    status: "open",
  },
  {
    id: "EVT-008",
    name: "Summer Cancelled Fest",
    date: "2026-06-01",
    venue: "Zuiderpark, Den Haag",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "Paylogic", url: "https://tickets.example.com/evt-008" }],
    capacity: 3000,
    artist: "Caribou",
    eventStatus: "cancelled",
    status: "open",
  },
  {
    id: "EVT-009",
    name: "Midnight Frequencies",
    date: "2026-04-25",
    venue: "The New Test Venue",
    operator: "The New Test Venue",
    operatorType: "venue",
    tickets: [{ provider: "DICE", url: "https://tickets.example.com/evt-009" }],
    capacity: 1200,
    artist: "Moderat",
    eventStatus: "confirmed",
    status: "open",
    published: true,
  },
  {
    id: "EVT-010",
    name: "Spring Equinox",
    date: "2026-05-09",
    venue: "Paradiso, Amsterdam",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "Eventbrite", url: "https://tickets.example.com/evt-010" }],
    capacity: 1500,
    artist: "Bonobo",
    eventStatus: "confirmed",
    status: "open",
    published: true,
  },
  {
    id: "EVT-011",
    name: "Deep House Sessions",
    date: "2026-06-14",
    venue: "The New Test Venue",
    operator: "The New Test Venue",
    operatorType: "venue",
    tickets: [{ provider: "DICE", url: "https://tickets.example.com/evt-011" }],
    capacity: 800,
    artist: "Aurora",
    eventStatus: "confirmed",
    status: "open",
    published: true,
  },
  {
    id: "EVT-012",
    name: "Summer Groove Festival",
    date: "2026-07-04",
    venue: "Zuiderpark, Den Haag",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "Paylogic", url: "https://tickets.example.com/evt-012" }],
    capacity: 5000,
    artist: "Noisia",
    eventStatus: "pending",
    status: "open",
    published: false,
  },
  {
    id: "EVT-013",
    name: "Jazz & Wine Night",
    date: "2026-07-18",
    venue: "The New Test Venue",
    operator: "The New Test Venue",
    operatorType: "venue",
    tickets: [{ provider: "Ticketmaster", url: "https://tickets.example.com/evt-013" }],
    capacity: 400,
    artist: "GoGo Penguin",
    eventStatus: "confirmed",
    status: "open",
    published: true,
  },
  {
    id: "EVT-014",
    name: "Aurora Live in Amsterdam",
    date: "2026-08-01",
    venue: "Melkweg, Amsterdam",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "DICE", url: "https://tickets.example.com/evt-014" }],
    capacity: 1200,
    artist: "Aurora",
    eventStatus: "confirmed",
    status: "open",
    published: true,
  },
  {
    id: "EVT-015",
    name: "Techno Warehouse",
    date: "2026-06-28",
    venue: "The New Test Venue",
    operator: "The New Test Venue",
    operatorType: "venue",
    tickets: [{ provider: "DICE", url: "https://tickets.example.com/evt-015" }],
    capacity: 1000,
    artist: "Moderat",
    eventStatus: "pending",
    status: "open",
    published: false,
  },
  {
    id: "EVT-016",
    name: "Acoustic Garden Party",
    date: "2026-08-15",
    venue: "Vondelpark Theater",
    operator: "shoWMe",
    operatorType: "promoter",
    tickets: [{ provider: "Ticketmaster", url: "https://tickets.example.com/evt-016" }],
    capacity: 600,
    artist: "José González",
    eventStatus: "suggested",
    status: "open",
    published: false,
  },
  // ─── Islandman events — hosted by The New Test Venue, artist profile as performer ───
  {
    id: "EVT-017",
    name: "Islandman — Live at The New Test Venue",
    date: "2026-05-23",
    venue: "The New Test Venue",
    operator: "The New Test Venue",
    operatorType: "venue",
    tickets: [{ provider: "DICE", url: "https://tickets.example.com/evt-017" }],
    capacity: 500,
    artist: "Islandman",
    eventStatus: "confirmed",
    status: "open",
    published: true,
    amenities: ["backline", "sound_engineer", "lighting", "parking", "catering"],
  },
  {
    id: "EVT-018",
    name: "Islandman Warm-Up Session",
    date: "2026-04-29",
    venue: "The New Test Venue",
    operator: "The New Test Venue",
    operatorType: "venue",
    tickets: [{ provider: "DICE", url: "https://tickets.example.com/evt-018" }],
    capacity: 500,
    artist: "Islandman",
    eventStatus: "pending",
    status: "open",
    published: false,
    amenities: ["sound_engineer", "lighting", "parking"],
  },
  // ─── 100 generated events across all days/months ───
  ...generateSeedEvents(),
];

function generateSeedEvents(): Event[] {
  const venues = [
    { name: "Paradiso, Amsterdam", operator: "shoWMe", opType: "promoter" as const, provider: "Eventbrite", cap: 1500 },
    { name: "Melkweg, Amsterdam", operator: "shoWMe", opType: "promoter" as const, provider: "DICE", cap: 1200 },
    { name: "Vondelpark Theater", operator: "shoWMe", opType: "promoter" as const, provider: "Ticketmaster", cap: 800 },
    { name: "TivoliVredenburg, Utrecht", operator: "shoWMe", opType: "promoter" as const, provider: "See Tickets", cap: 2000 },
    { name: "Zuiderpark, Den Haag", operator: "shoWMe", opType: "promoter" as const, provider: "Paylogic", cap: 5000 },
    { name: "The New Test Venue", operator: "The New Test Venue", opType: "venue" as const, provider: "DICE", cap: 1000 },
    { name: "Ziggo Dome", operator: "shoWMe", opType: "promoter" as const, provider: "Ticketmaster", cap: 17000 },
    { name: "AFAS Live", operator: "shoWMe", opType: "promoter" as const, provider: "Eventbrite", cap: 6000 },
    { name: "Patronaat, Haarlem", operator: "shoWMe", opType: "promoter" as const, provider: "See Tickets", cap: 750 },
    { name: "Effenaar, Eindhoven", operator: "shoWMe", opType: "promoter" as const, provider: "DICE", cap: 1100 },
  ];
  const artists = [
    "Aurora", "Moderat", "Bonobo", "GoGo Penguin", "Noisia", "Fontaines D.C.",
    "José González", "Caribou", "Parcels", "Snarky Puppy", "Khruangbin",
    "FKA twigs", "Floating Points", "Yussef Dayes", "BICEP", "Four Tet",
    "Arlo Parks", "Jamie xx", "Nils Frahm", "Tinariwen",
  ];
  const eventNames = [
    "Midnight Session", "Neon Dreams", "Pulse Night", "Sound Garden", "Bass Cathedral",
    "Groove Lab", "Velvet Lounge", "Rhythm & Soul", "Twilight Fest", "Echo Chamber",
    "Sonic Bloom", "Sunset Vibes", "Deep Dive", "Electric Garden", "Club Noir",
    "Harbour Beats", "Lunar Frequencies", "Daybreak Festival", "After Dark", "Crystal Waves",
  ];
  const statuses: EventStatus[] = ["suggested", "pending", "confirmed", "on_hold", "concluded", "cancelled"];
  const settlementStatuses: SettlementStatus[] = ["open", "pending_review", "comments_received", "revised", "finalized", "partly_paid", "paid"];

  const events: Event[] = [];
  // Start from March 16 2026, spread 100 events across ~7 months
  const startDate = new Date(2026, 2, 16); // March 16

  for (let i = 0; i < 100; i++) {
    const dayOffset = Math.floor(i * 2.1) + (i % 3); // spread across days
    const date = new Date(startDate);
    date.setDate(date.getDate() + dayOffset);
    const dateStr = date.toISOString().split("T")[0];

    const venue = venues[i % venues.length];
    const artist = artists[i % artists.length];
    const baseName = eventNames[i % eventNames.length];
    const suffix = i >= 20 ? ` ${Math.ceil((i + 1) / 20)}` : "";

    const statusIdx = i % statuses.length;
    const eventStatus = statuses[statusIdx];
    // Only confirmed events may be published.
    const isPublished = eventStatus === "confirmed" && i % 3 !== 2;

    const generatedId = `EVT-G${String(i + 1).padStart(3, "0")}`;
    events.push({
      id: generatedId,
      name: `${baseName}${suffix}`,
      date: dateStr,
      venue: venue.name,
      operator: venue.operator,
      operatorType: venue.opType,
      tickets: [{ provider: venue.provider, url: `https://tickets.example.com/${generatedId.toLowerCase()}` }],
      capacity: venue.cap,
      artist,
      eventStatus,
      status: statusIdx === 4 ? settlementStatuses[(i % 5) + 2] : "open",
      published: isPublished,
    });
  }
  return events;
}

export const seedDeals: Record<string, DealStructure> = {
  "EVT-001": {
    eventId: "EVT-001",
    dealType: "guarantee_vs_door",
    artistGuarantee: 8000,
    artistSplit: 70,
    promoterSplit: 20,
    venueSplit: 10,
    organizerSplit: 0,
    artistCostSplit: 0,
    promoterCostSplit: 60,
    venueCostSplit: 40,
    organizerCostSplit: 0,
    venueRental: 3500,
    commissions: [
      { key: "bookerAgent", label: "Booker/Agent", name: "WME Agency", percentage: 15 },
      { key: "management", label: "Management", name: "Starlight Mgmt", percentage: 10 },
    ],
  },
  "EVT-002": {
    eventId: "EVT-002",
    dealType: "guarantee",
    artistGuarantee: 5000,
    artistSplit: 100,
    promoterSplit: 0,
    venueSplit: 0,
    organizerSplit: 0,
    artistCostSplit: 0,
    promoterCostSplit: 50,
    venueCostSplit: 50,
    organizerCostSplit: 0,
    venueRental: 0,
    commissions: [
      { key: "bookerAgent", label: "Booker/Agent", name: "Paradigm Agency", percentage: 15 },
    ],
  },
  "EVT-003": {
    eventId: "EVT-003",
    dealType: "door_split",
    artistGuarantee: 0,
    artistSplit: 60,
    promoterSplit: 25,
    venueSplit: 15,
    organizerSplit: 0,
    artistCostSplit: 0,
    promoterCostSplit: 70,
    venueCostSplit: 30,
    organizerCostSplit: 0,
    venueRental: 2000,
    commissions: [
      { key: "bookerAgent", label: "Booker/Agent", name: "CAA", percentage: 15 },
      { key: "management", label: "Management", name: "Primary Talent", percentage: 10 },
    ],
  },
  "EVT-004": {
    eventId: "EVT-004",
    dealType: "guarantee_vs_door",
    artistGuarantee: 12000,
    artistSplit: 65,
    promoterSplit: 20,
    venueSplit: 15,
    organizerSplit: 0,
    artistCostSplit: 0,
    promoterCostSplit: 55,
    venueCostSplit: 45,
    organizerCostSplit: 0,
    venueRental: 5000,
    commissions: [
      { key: "bookerAgent", label: "Booker/Agent", name: "UTA", percentage: 15 },
      { key: "management", label: "Management", name: "Reeperbahn Mgmt", percentage: 10 },
    ],
  },
  "EVT-005": {
    eventId: "EVT-005",
    dealType: "door_split",
    artistGuarantee: 0,
    artistSplit: 55,
    promoterSplit: 30,
    venueSplit: 15,
    organizerSplit: 0,
    artistCostSplit: 0,
    promoterCostSplit: 65,
    venueCostSplit: 35,
    organizerCostSplit: 0,
    venueRental: 8000,
    commissions: [
      { key: "bookerAgent", label: "Booker/Agent", name: "WME Agency", percentage: 15 },
      { key: "management", label: "Management", name: "ATC Mgmt", percentage: 10 },
    ],
  },
  "EVT-017": {
    eventId: "EVT-017",
    dealType: "door_split",
    artistGuarantee: 0,
    artistSplit: 60,
    promoterSplit: 0,
    venueSplit: 40,
    organizerSplit: 0,
    artistCostSplit: 0,
    promoterCostSplit: 0,
    venueCostSplit: 100,
    organizerCostSplit: 0,
    venueRental: 0,
    commissions: [],
  },
  "EVT-018": {
    eventId: "EVT-018",
    dealType: "door_split",
    artistGuarantee: 0,
    artistSplit: 60,
    promoterSplit: 0,
    venueSplit: 40,
    organizerSplit: 0,
    artistCostSplit: 0,
    promoterCostSplit: 0,
    venueCostSplit: 100,
    organizerCostSplit: 0,
    venueRental: 0,
    commissions: [],
  },
};

// Generate deals for all events that don't have hardcoded ones
(function fillSeedDeals() {
  const dealTypes: DealType[] = ["guarantee", "door_split", "guarantee_vs_door", "rental"];
  const agencies = ["WME Agency", "CAA", "Paradigm Agency", "UTA", "ICM Partners"];
  const mgmts = ["Starlight Mgmt", "ATC Mgmt", "Primary Talent", "Reeperbahn Mgmt", "Red Light Mgmt"];

  seedEvents.forEach((event, idx) => {
    if (seedDeals[event.id]) return;
    const dt = dealTypes[idx % dealTypes.length];
    const hasGuarantee = dt === "guarantee" || dt === "guarantee_vs_door";
    const guarantee = hasGuarantee ? 3000 + (idx % 10) * 1500 : 0;
    const artistSplit = dt === "guarantee" ? 100 : 50 + (idx % 4) * 5;
    const promoterSplit = dt === "guarantee" ? 0 : Math.floor((100 - artistSplit) * 0.6);
    const venueSplit = dt === "guarantee" ? 0 : 100 - artistSplit - promoterSplit;

    seedDeals[event.id] = {
      eventId: event.id,
      dealType: dt,
      artistGuarantee: guarantee,
      artistSplit,
      promoterSplit,
      venueSplit,
      organizerSplit: 0,
      artistCostSplit: 0,
      promoterCostSplit: 55 + (idx % 3) * 5,
      venueCostSplit: 45 - (idx % 3) * 5,
      organizerCostSplit: 0,
      venueRental: dt === "rental" ? 2000 + (idx % 5) * 1000 : (idx % 3 === 0 ? 2500 : 0),
      commissions: [
        { key: "bookerAgent", label: "Booker/Agent", name: agencies[idx % agencies.length], percentage: 15 },
        ...(idx % 3 !== 0 ? [{ key: "management", label: "Management", name: mgmts[idx % mgmts.length], percentage: 10 }] : []),
      ],
    };
  });
})();

export const seedRevenue: Record<string, TicketRevenue> = {
  "EVT-001": {
    eventId: "EVT-001", ticketsSold: 1420, grossRevenue: 42600, ticketFees: 2840, tax: 7442, refunds: 450, doorSales: 1200, productionExpenses: 4500, additionalCosts: 800,
    ticketTypes: [{ name: "Early Bird", price: 25, sold: 400 }, { name: "Regular", price: 35, sold: 800 }, { name: "VIP", price: 55, sold: 220 }],
  },
  "EVT-002": {
    eventId: "EVT-002", ticketsSold: 750, grossRevenue: 22500, ticketFees: 1500, tax: 3937, refunds: 200, doorSales: 600, productionExpenses: 2000, additionalCosts: 500,
    ticketTypes: [{ name: "Standard", price: 30, sold: 650 }, { name: "Front Row", price: 45, sold: 100 }],
  },
  "EVT-003": {
    eventId: "EVT-003", ticketsSold: 980, grossRevenue: 34300, ticketFees: 1960, tax: 6002, refunds: 300, doorSales: 900, productionExpenses: 3500, additionalCosts: 600,
    ticketTypes: [{ name: "Standard", price: 35, sold: 980 }],
  },
  "EVT-004": {
    eventId: "EVT-004", ticketsSold: 1800, grossRevenue: 63000, ticketFees: 3600, tax: 11025, refunds: 700, doorSales: 1500, productionExpenses: 6000, additionalCosts: 1200,
    ticketTypes: [{ name: "Standing", price: 30, sold: 1200 }, { name: "Balcony", price: 40, sold: 400 }, { name: "VIP Package", price: 65, sold: 200 }],
  },
  "EVT-005": {
    eventId: "EVT-005", ticketsSold: 0, grossRevenue: 0, ticketFees: 0, tax: 0, refunds: 0, doorSales: 0, productionExpenses: 0, additionalCosts: 0,
  },
};

// Generate revenue for all events that don't have hardcoded ones
(function fillSeedRevenue() {
  seedEvents.forEach((event, idx) => {
    if (seedRevenue[event.id]) return;
    const isConcluded = event.eventStatus === "concluded";
    const cap = event.capacity;
    if (!isConcluded) {
      seedRevenue[event.id] = {
        eventId: event.id, ticketsSold: 0, grossRevenue: 0, ticketFees: 0, tax: 0, refunds: 0, doorSales: 0, productionExpenses: 0, additionalCosts: 0,
      };
    } else {
      const fillRate = 0.55 + (idx % 40) * 0.01; // 55-95%
      const sold = Math.round(cap * fillRate);
      const avgPrice = 25 + (idx % 6) * 5;
      const gross = sold * avgPrice;
      seedRevenue[event.id] = {
        eventId: event.id,
        ticketsSold: sold,
        grossRevenue: gross,
        ticketFees: Math.round(gross * 0.05),
        tax: Math.round(gross * 0.21),
        refunds: Math.round(gross * 0.01),
        doorSales: Math.round(sold * 0.08 * avgPrice),
        productionExpenses: Math.round(gross * 0.1),
        additionalCosts: Math.round(gross * 0.02),
        ticketTypes: [
          { name: "Regular", price: avgPrice, sold: Math.round(sold * 0.7) },
          { name: "VIP", price: Math.round(avgPrice * 1.8), sold: Math.round(sold * 0.3) },
        ],
      };
    }
  });
})();

function buildSeedSettlements(
  events: Event[],
  deals: Record<string, DealStructure>,
  revenueById: Record<string, TicketRevenue>,
): Record<string, Settlement> {
  const result: Record<string, Settlement> = {};
  for (const event of events) {
    const deal = deals[event.id];
    const revenue = revenueById[event.id];
    if (!deal || !revenue) continue;
    const calc = calculateSettlement(deal, revenue);
    result[event.id] = {
      ...calc,
      status: event.status,
      approvals: [
        { party: "Operator", approved: event.status !== "open", date: event.status !== "open" ? event.date : undefined },
        { party: "Performer", approved: event.status === "finalized" || event.status === "revised", date: event.status === "finalized" ? event.date : undefined },
        { party: "Venue", approved: event.status === "finalized", date: event.status === "finalized" ? event.date : undefined },
      ],
      comments: event.id === "EVT-004" ? [
        { party: "Performer Agent", message: "Production expenses seem inflated. Please provide itemized breakdown.", date: "2026-03-28" },
        { party: "Operator", message: "Itemized breakdown attached. Includes extra security costs due to venue requirements.", date: "2026-03-29" },
      ] : [],
      revisions: event.id === "EVT-002" ? [
        { date: "2026-03-12", by: "Operator", changes: "Adjusted production expenses from €2500 to €2000" },
      ] : [],
    };
  }
  return result;
}

export const seedSettlements = buildSeedSettlements(seedEvents, seedDeals, seedRevenue);

export const seedContacts: Contact[] = [
  { id: "P-001", name: "LiveNation NL", type: "promoter", contacts: [{ name: "Jan de Vries", email: "jan.livenation@showme.music", phone: "+31 20 555 0101" }], iban: "NL91ABNA0417164300", bankName: "ABN AMRO", vatId: "NL123456789B01", address: "Keizersgracht 100, 1015 Amsterdam", notes: "" },
  { id: "P-002", name: "MOJO Concerts", type: "promoter", contacts: [{ name: "Lisa Bakker", email: "lisa.mojo@showme.music", phone: "+31 20 555 0102" }], iban: "NL20INGB0001234567", bankName: "ING", vatId: "NL987654321B01", address: "Wibautstraat 150, 1091 Amsterdam", notes: "" },
  { id: "P-003", name: "ID&T", type: "promoter", contacts: [{ name: "Michiel de Boer", email: "michiel.idt@showme.music", phone: "+31 20 555 0103" }], iban: "NL39RABO0300065264", bankName: "Rabobank", vatId: "NL111222333B01", address: "Arena Boulevard 65, 1101 Amsterdam", notes: "Festival specialists" },
  { id: "P-004", name: "Paradiso, Amsterdam", type: "venue", contacts: [{ name: "Sophie van Dijk", email: "sophie.paradiso@showme.music", phone: "+31 20 555 0201" }], iban: "NL18RABO0123459876", bankName: "Rabobank", vatId: "NL444555666B01", address: "Weteringschans 6-8, 1017 Amsterdam", notes: "Historic concert venue" },
  { id: "P-005", name: "Vondelpark Theater", type: "venue", contacts: [{ name: "Kees Jansen", email: "kees.vondelpark@showme.music", phone: "+31 20 555 0202" }], iban: "NL91ABNA0417164301", bankName: "ABN AMRO", vatId: "NL777888999B01", address: "Vondelpark 3, 1071 Amsterdam", notes: "" },
  { id: "P-006", name: "Melkweg, Amsterdam", type: "venue", contacts: [{ name: "Anna Smit", email: "anna.melkweg@showme.music", phone: "+31 20 555 0203" }], iban: "NL20INGB0009876543", bankName: "ING", vatId: "NL112233445B01", address: "Lijnbaansgracht 234a, 1017 Amsterdam", notes: "" },
  { id: "P-007", name: "TivoliVredenburg, Utrecht", type: "venue", contacts: [{ name: "Pieter Groot", email: "pieter.tivoli@showme.music", phone: "+31 30 555 0301" }], iban: "NL39RABO0300065265", bankName: "Rabobank", vatId: "NL998877665B01", address: "Vredenburgkade 11, 3511 Utrecht", notes: "" },
  { id: "P-008", name: "Zuiderpark, Den Haag", type: "venue", contacts: [{ name: "Maria Visser", email: "maria.zuiderpark@showme.music", phone: "+31 70 555 0401" }], iban: "NL91ABNA0417164302", bankName: "ABN AMRO", vatId: "NL554433221B01", address: "Zuiderpark 1, 2531 Den Haag", notes: "Open air venue" },
  { id: "P-009", name: "Aurora", type: "performer", contacts: [{ name: "Aurora Aksnes", email: "mgmt.aurora@showme.music", phone: "+47 555 0101" }], iban: "NO9386011117947", bankName: "DNB", vatId: "", address: "Bergen, Norway", notes: "" },
  { id: "P-010", name: "GoGo Penguin", type: "performer", contacts: [{ name: "Chris Illingworth", email: "info.gogopenguin@showme.music", phone: "+44 161 555 0101" }], iban: "GB29NWBK60161331926819", bankName: "NatWest", vatId: "", address: "Manchester, UK", notes: "" },
  { id: "P-011", name: "Moderat", type: "performer", contacts: [{ name: "Sascha Ring", email: "booking.moderat@showme.music", phone: "+49 30 555 0101" }], iban: "DE89370400440532013000", bankName: "Commerzbank", vatId: "", address: "Berlin, Germany", notes: "" },
  { id: "P-012", name: "Fontaines D.C.", type: "performer", contacts: [{ name: "Grian Chatten", email: "info.fontainesdc@showme.music", phone: "+353 1 555 0101" }], iban: "IE29AIBK93115212345678", bankName: "AIB", vatId: "", address: "Dublin, Ireland", notes: "" },
  { id: "P-013", name: "Bonobo", type: "performer", contacts: [{ name: "Simon Green", email: "mgmt.bonobo@showme.music", phone: "+44 20 555 0102" }], iban: "GB29NWBK60161331926820", bankName: "NatWest", vatId: "", address: "London, UK", notes: "" },
  { id: "P-023", name: "José González", type: "performer", contacts: [{ name: "José González", email: "info.josegonzalez@showme.music", phone: "+46 31 555 0101" }], iban: "SE3550000000054910000003", bankName: "SEB", vatId: "", address: "Gothenburg, Sweden", notes: "" },
  { id: "P-024", name: "Noisia", type: "performer", contacts: [{ name: "Thijs de Vlieger", email: "booking.noisia@showme.music", phone: "+31 50 555 0101" }], iban: "NL39RABO0300065280", bankName: "Rabobank", vatId: "NL567890123B01", address: "Groningen, Netherlands", notes: "" },
  { id: "P-025", name: "Caribou", type: "performer", contacts: [{ name: "Dan Snaith", email: "mgmt.caribou@showme.music", phone: "+44 20 555 0601" }], iban: "GB82WEST12345698765450", bankName: "HSBC", vatId: "", address: "London, UK", notes: "" },
  { id: "P-026", name: "Islandman", type: "performer", contacts: [{ name: "Tolga Boyuk", email: "info.islandman@showme.music", phone: "+90 212 555 0101" }], iban: "TR330006100519786457841326", bankName: "Garanti BBVA", vatId: "", address: "Istanbul, Turkey", notes: "" },
  { id: "P-027", name: "Khruangbin", type: "performer", contacts: [{ name: "Mark Speer", email: "booking.khruangbin@showme.music", phone: "+1 713 555 0101" }], iban: "US98765432101234567890", bankName: "Bank of America", vatId: "", address: "Houston, TX, USA", notes: "" },
  { id: "P-014", name: "Eventbrite", type: "ticketing", contacts: [{ name: "Support NL", email: "support.eventbrite@showme.music", phone: "+31 20 555 0501" }], iban: "NL20INGB0005551234", bankName: "ING", vatId: "NL100200300B01", address: "Amsterdam, NL", notes: "" },
  { id: "P-015", name: "Ticketmaster", type: "ticketing", contacts: [{ name: "Account Team", email: "accounts.ticketmaster@showme.music", phone: "+31 20 555 0502" }], iban: "NL91ABNA0417164305", bankName: "ABN AMRO", vatId: "NL200300400B01", address: "Amsterdam, NL", notes: "" },
  { id: "P-016", name: "DICE", type: "ticketing", contacts: [{ name: "Partner Team", email: "partners.dice@showme.music", phone: "+44 20 555 0301" }], iban: "GB82WEST12345698765432", bankName: "HSBC", vatId: "", address: "London, UK", notes: "" },
  { id: "P-017", name: "See Tickets", type: "ticketing", contacts: [{ name: "NL Office", email: "nl.seetickets@showme.music", phone: "+31 20 555 0503" }], iban: "NL39RABO0300065270", bankName: "Rabobank", vatId: "NL300400500B01", address: "Utrecht, NL", notes: "" },
  { id: "P-018", name: "Paylogic", type: "ticketing", contacts: [{ name: "Sales", email: "sales.paylogic@showme.music", phone: "+31 20 555 0504" }], iban: "NL20INGB0005559876", bankName: "ING", vatId: "NL400500600B01", address: "Amsterdam, NL", notes: "" },
  { id: "P-019", name: "WME Agency", type: "agent", contacts: [{ name: "David Chen", email: "dchen.wme@showme.music", phone: "+1 310 555 0101" }], iban: "US12345678901234567890", bankName: "JPMorgan Chase", vatId: "", address: "Beverly Hills, CA, USA", notes: "Handles Aurora & Bonobo bookings" },
  { id: "P-020", name: "Paradigm Agency", type: "agent", contacts: [{ name: "Emma Wilson", email: "emma.paradigm@showme.music", phone: "+44 20 555 0401" }], iban: "GB29NWBK60161331926825", bankName: "NatWest", vatId: "", address: "London, UK", notes: "" },
  { id: "P-021", name: "Starlight Mgmt", type: "manager", contacts: [{ name: "Peter Hall", email: "peter.starlight@showme.music", phone: "+44 20 555 0501" }], iban: "GB82WEST12345698765440", bankName: "HSBC", vatId: "", address: "London, UK", notes: "Aurora management" },
  { id: "P-022", name: "ATC Mgmt", type: "manager", contacts: [{ name: "Sarah Jones", email: "sarah.atc@showme.music", phone: "+44 20 555 0502" }], iban: "GB29NWBK60161331926830", bankName: "NatWest", vatId: "", address: "London, UK", notes: "Bonobo management" },
];

// ── Standalone artist profiles (seeded into `profiles` collection) ───────────
// These are public artist profiles that appear in the PerformerSearch dropdown.
// Each uses a deterministic avatar from pravatar.cc.

export interface SeedArtistProfile {
  name: string;
  locations: { id: string; label: string; city: string; country: string }[];
  genres: string[];
  avatarUrl: string;
  bio: string;
}

export const seedArtistProfiles: SeedArtistProfile[] = [
  { name: "Aurora", locations: [{ id: "loc-1", label: "Primary", city: "Bergen", country: "Norway" }], genres: ["Pop", "Art Pop", "Electropop"], avatarUrl: "https://i.pravatar.cc/150?u=aurora-artist", bio: "Norwegian singer-songwriter known for ethereal vocals and atmospheric pop." },
  { name: "GoGo Penguin", locations: [{ id: "loc-1", label: "Primary", city: "Manchester", country: "UK" }], genres: ["Jazz", "Electronic", "Acoustic"], avatarUrl: "https://i.pravatar.cc/150?u=gogopenguin", bio: "Manchester-based acoustic-electronic jazz trio." },
  { name: "Moderat", locations: [{ id: "loc-1", label: "Primary", city: "Berlin", country: "Germany" }], genres: ["Electronic", "IDM", "Techno"], avatarUrl: "https://i.pravatar.cc/150?u=moderat", bio: "Berlin electronic supergroup combining Modeselektor and Apparat." },
  { name: "Fontaines D.C.", locations: [{ id: "loc-1", label: "Primary", city: "Dublin", country: "Ireland" }], genres: ["Post-Punk", "Indie Rock"], avatarUrl: "https://i.pravatar.cc/150?u=fontainesdc", bio: "Dublin post-punk band known for literary lyrics and raw energy." },
  { name: "Bonobo", locations: [{ id: "loc-1", label: "Primary", city: "London", country: "UK" }], genres: ["Electronic", "Downtempo", "House"], avatarUrl: "https://i.pravatar.cc/150?u=bonobo-artist", bio: "British musician, producer, and DJ known for textured electronic music." },
  { name: "José González", locations: [{ id: "loc-1", label: "Primary", city: "Gothenburg", country: "Sweden" }], genres: ["Indie Folk", "Acoustic"], avatarUrl: "https://i.pravatar.cc/150?u=josegonzalez", bio: "Swedish-Argentine singer-songwriter known for intimate acoustic performances." },
  { name: "Noisia", locations: [{ id: "loc-1", label: "Primary", city: "Groningen", country: "Netherlands" }], genres: ["Drum & Bass", "Electronic", "Bass"], avatarUrl: "https://i.pravatar.cc/150?u=noisia", bio: "Dutch electronic music trio and sound design pioneers." },
  { name: "Caribou", locations: [{ id: "loc-1", label: "Primary", city: "London", country: "UK" }], genres: ["Electronic", "Indie", "Psychedelic"], avatarUrl: "https://i.pravatar.cc/150?u=caribou-artist", bio: "Canadian musician and mathematician creating adventurous electronic pop." },
  { name: "Khruangbin", locations: [{ id: "loc-1", label: "Primary", city: "Houston", country: "USA" }], genres: ["Psychedelic", "Funk", "World"], avatarUrl: "https://i.pravatar.cc/150?u=khruangbin", bio: "Houston trio blending global psychedelia with funk and soul." },
  { name: "Floating Points", locations: [{ id: "loc-1", label: "Primary", city: "London", country: "UK" }], genres: ["Electronic", "Jazz", "Ambient"], avatarUrl: "https://i.pravatar.cc/150?u=floatingpoints", bio: "British electronic musician and neuroscientist." },
  { name: "Jamie xx", locations: [{ id: "loc-1", label: "Primary", city: "London", country: "UK" }], genres: ["Electronic", "House", "UK Bass"], avatarUrl: "https://i.pravatar.cc/150?u=jamiexx", bio: "English producer and DJ, member of The xx." },
  { name: "Four Tet", locations: [{ id: "loc-1", label: "Primary", city: "London", country: "UK" }], genres: ["Electronic", "Folktronica", "House"], avatarUrl: "https://i.pravatar.cc/150?u=fourtet", bio: "British electronic musician known for organic, textured productions." },
  { name: "BICEP", locations: [{ id: "loc-1", label: "Primary", city: "Belfast", country: "UK" }], genres: ["Electronic", "House", "Breakbeat"], avatarUrl: "https://i.pravatar.cc/150?u=bicep-artist", bio: "Belfast-born duo creating euphoric electronic music." },
  { name: "Nils Frahm", locations: [{ id: "loc-1", label: "Primary", city: "Berlin", country: "Germany" }], genres: ["Neo-Classical", "Ambient", "Electronic"], avatarUrl: "https://i.pravatar.cc/150?u=nilsfrahm", bio: "German musician and composer blending classical piano with electronics." },
  { name: "Arlo Parks", locations: [{ id: "loc-1", label: "Primary", city: "London", country: "UK" }], genres: ["Indie Pop", "Neo-Soul", "Poetry"], avatarUrl: "https://i.pravatar.cc/150?u=arloparks", bio: "British singer-songwriter and poet." },
  { name: "Yussef Dayes", locations: [{ id: "loc-1", label: "Primary", city: "London", country: "UK" }], genres: ["Jazz", "Broken Beat", "World"], avatarUrl: "https://i.pravatar.cc/150?u=yussefdays", bio: "South London drummer and producer at the forefront of UK jazz." },
];

// ── Event subcollection fixtures ──────────────────────────────────────────────
// Seeded into events/{id}/meta/main, riders/{id}, agreements/{id}, crew/{id},
// schedule/{id}, and collaborators/{id} subcollections.

export const seedEventMeta: Record<string, EventMeta> = {
  "EVT-001": {
    dealDescription: "Guarantee vs door split. Performer receives the higher of €8,000 guarantee or 70% of net revenue.",
    expenses: [
      { id: "EX-1", label: "Performer Fee", amount: 8000, currency: "EUR" },
      { id: "EX-2", label: "Production", amount: 2000, currency: "EUR" },
      { id: "EX-3", label: "Travel", amount: 1200, currency: "EUR" },
      { id: "EX-4", label: "Accommodation", amount: 800, currency: "EUR" },
      { id: "EX-5", label: "Marketing", amount: 1500, currency: "EUR" },
      { id: "EX-6", label: "Staffing", amount: 1200, currency: "EUR" },
      { id: "EX-7", label: "Venue Rental", amount: 3500, currency: "EUR" },
    ],
    proEstimate: {
      pro: "none",
      country: "Netherlands",
      eventType: "live_concert",
      ticketPrice: 35,
      vatMode: "inclusive",
      expectedTickets: 1420,
      compTickets: 30,
      venueCapacity: 1500,
      estimatedFee: 0,
      manualOverride: false,
      manualValue: 0,
      confidence: "high",
      tariffVersion: "2026",
    },
  },
  "EVT-003": {
    dealDescription: "Door split. 60% artist / 25% promoter / 15% venue after venue rental deduction.",
    expenses: [
      { id: "EX-8", label: "Performer Fee", amount: 0, currency: "EUR" },
      { id: "EX-9", label: "Production", amount: 1500, currency: "EUR" },
      { id: "EX-10", label: "Marketing", amount: 2000, currency: "EUR" },
    ],
    proEstimate: {
      pro: "gema",
      country: "Germany",
      eventType: "live_concert",
      ticketPrice: 35,
      vatMode: "inclusive",
      expectedTickets: 980,
      compTickets: 20,
      venueCapacity: 1200,
      estimatedFee: 0,
      manualOverride: false,
      manualValue: 0,
      confidence: "estimate_only",
      tariffVersion: "2026",
    },
  },
  "EVT-017": {
    dealDescription: "Door split. Islandman receives 60% of net door revenue; venue retains 40% to cover operational costs.",
    expenses: [
      { id: "EX-17-1", label: "Production", amount: 800, currency: "EUR" },
      { id: "EX-17-2", label: "Marketing", amount: 600, currency: "EUR" },
      { id: "EX-17-3", label: "Staffing", amount: 400, currency: "EUR" },
    ],
    proEstimate: {
      pro: "stim",
      country: "Sweden",
      eventType: "live_concert",
      ticketPrice: 25,
      vatMode: "inclusive",
      expectedTickets: 400,
      compTickets: 10,
      venueCapacity: 500,
      estimatedFee: 0,
      manualOverride: false,
      manualValue: 0,
      confidence: "estimate_only",
      tariffVersion: "2026",
    },
  },
  "EVT-018": {
    dealDescription: "Door split. Islandman receives 60% of net door revenue.",
    expenses: [
      { id: "EX-18-1", label: "Production", amount: 500, currency: "EUR" },
      { id: "EX-18-2", label: "Marketing", amount: 300, currency: "EUR" },
    ],
  },
};

export const seedRiders: Record<string, Rider[]> = {
  "EVT-001": [
    { id: "R-1", name: "Aurora Technical Rider", type: "technical", description: "Full band setup: drums, bass, keys, guitar, 2x vocal mics. In-ear monitors required." },
    { id: "R-2", name: "Hospitality Requirements", type: "hospitality", description: "Private dressing room, hot meals for 6 crew, vegetarian options required." },
    { id: "R-3", name: "Catering Rider", type: "catering", description: "Water, soft drinks, tea, coffee. No alcohol backstage." },
  ],
  "EVT-003": [
    { id: "R-4", name: "Moderat Technical Rider", type: "technical", description: "Electronic live setup: 3x tables, DI boxes, MIDI controllers. Subwoofers required." },
  ],
  "EVT-017": [
    { id: "R-17-1", name: "Islandman Technical Rider", type: "technical", description: "Electronic live setup: 2x tables, DI boxes, MIDI controllers, laptop stand. Stereo output." },
    { id: "R-17-2", name: "Hospitality", type: "hospitality", description: "Dressing room for 3, light catering, water, soft drinks." },
  ],
};

export const seedAgreements: Record<string, Agreement[]> = {
  "EVT-001": [
    { id: "AG-1", type: "collaboration", name: "Performance Agreement - Aurora", status: "signed" },
    { id: "AG-2", type: "rental", name: "Paradiso Venue Rental Agreement", status: "signed" },
  ],
  "EVT-003": [
    { id: "AG-3", type: "collaboration", name: "Performance Agreement - Moderat", status: "sent" },
  ],
  "EVT-017": [
    { id: "AG-17-1", type: "collaboration", name: "Performance Agreement - Islandman", status: "draft" },
  ],
};

export const seedCrew: Record<string, CrewMember[]> = {
  "EVT-001": [
    { id: "CR-1", name: "Tom Bakker", role: "Sound Engineer", email: "tom.soundpro@showme.music", phone: "+31 20 555 1001", collaborator: "Paradiso" },
    { id: "CR-2", name: "Eva Janssen", role: "Light Engineer", email: "eva.lights@showme.music", phone: "+31 20 555 1002", collaborator: "Paradiso" },
    { id: "CR-3", name: "Mike Strand", role: "Tour Manager", email: "mike.aurora@showme.music", phone: "+47 555 2001", collaborator: "Aurora" },
    { id: "CR-4", name: "Sarah Drums", role: "Drummer", email: "sarah.aurora@showme.music", collaborator: "Aurora" },
    { id: "CR-5", name: "Alex Keys", role: "Keys", email: "alex.aurora@showme.music", collaborator: "Aurora" },
  ],
  "EVT-003": [
    { id: "CR-6", name: "Hans Müller", role: "VJ / Visuals", email: "hans.moderat@showme.music", collaborator: "Moderat" },
  ],
  "EVT-017": [
    { id: "CR-17-1", name: "Lars Nilsson", role: "Sound Engineer", email: "lars.soundnl@showme.music", phone: "+31 20 555 2001", collaborator: "The New Test Venue" },
    { id: "CR-17-2", name: "Daniel Öhman", role: "Tour Manager", email: "daniel.islandman@showme.music", phone: "+46 70 555 0001", collaborator: "Islandman" },
  ],
};

export const seedSchedule: Record<string, ScheduleItem[]> = {
  "EVT-001": [
    { id: "SC-1", time: "14:00", label: "Get in", description: "Equipment arrival and stage setup" },
    { id: "SC-2", time: "16:00", label: "Soundcheck", description: "Full band soundcheck" },
    { id: "SC-3", time: "18:00", label: "Doors open" },
    { id: "SC-4", time: "19:00", label: "Support Act" },
    { id: "SC-5", time: "20:30", label: "Show start", description: "Main performance — 90 minutes" },
    { id: "SC-6", time: "22:00", label: "Curfew" },
    { id: "SC-7", time: "23:00", label: "Clear venue" },
  ],
  "EVT-003": [
    { id: "SC-8", time: "16:00", label: "Get in" },
    { id: "SC-9", time: "18:00", label: "Soundcheck" },
    { id: "SC-10", time: "20:00", label: "Doors open" },
    { id: "SC-11", time: "22:00", label: "Show start" },
    { id: "SC-12", time: "00:00", label: "Curfew" },
    { id: "SC-13", time: "01:00", label: "Clear venue" },
  ],
  "EVT-017": [
    { id: "SC-17-1", time: "17:00", label: "Get in" },
    { id: "SC-17-2", time: "18:30", label: "Soundcheck" },
    { id: "SC-17-3", time: "20:00", label: "Doors open" },
    { id: "SC-17-4", time: "21:00", label: "Support Act" },
    { id: "SC-17-5", time: "22:00", label: "Islandman show start", description: "90-minute live set" },
    { id: "SC-17-6", time: "23:30", label: "Curfew" },
    { id: "SC-17-7", time: "00:30", label: "Clear venue" },
  ],
};

export const seedCollaborators: Record<string, EventCollaborator[]> = {
  "EVT-001": [
    { id: "COL-1", email: "aurora.collab@showme.music", eventRole: "artist", name: "Aurora", status: "active", invitedAt: "2026-01-15" },
    { id: "COL-2", email: "sophie.paradiso@showme.music", eventRole: "venue", name: "Paradiso, Amsterdam", status: "active", invitedAt: "2026-01-15" },
    { id: "COL-3", email: "dchen.wme@showme.music", eventRole: "agent", name: "WME Agency", status: "active", invitedAt: "2026-01-16" },
  ],
  "EVT-003": [
    { id: "COL-4", email: "booking.moderat@showme.music", eventRole: "artist", name: "Moderat", status: "active", invitedAt: "2026-02-01" },
    { id: "COL-5", email: "anna.melkweg@showme.music", eventRole: "venue", name: "Melkweg, Amsterdam", status: "active", invitedAt: "2026-02-01" },
    { id: "COL-6", email: "caa.agency@showme.music", eventRole: "agent", name: "CAA", status: "pending", invitedAt: "2026-02-10" },
  ],
};
