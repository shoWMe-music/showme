/**
 * Default user/profile documents for local emulator seeding only.
 * Not imported by the Vite app bundle.
 */

export const SEED_USER_SETTINGS = {
  name: "Daniel Islandman",
  email: "daniel.islandman@showme.music",
  initials: "DI",
  roles: ["venue", "performer", "promoter"],
  currency: "EUR",
  default_role: "venue",
  company_name: "",
};

export const SEED_PROFILES: Record<string, Record<string, unknown>> = {
  venue: {
    role: "venue",
    // `type` must equal `role` — Firestore rules check data.type for isEventHostProfileType().
    type: "venue",
    name: "The New Test Venue",
    locations: [{ id: "loc-1", label: "Primary", city: "Amsterdam", country: "NL" }],
    bio: "A legendary underground music venue in the heart of Amsterdam, known for hosting raw, electrifying live shows across rock, metal, punk, and indie. With a gritty industrial interior, state-of-the-art sound system, and intimate atmosphere, The New Test Venue has been a home for emerging artists and die-hard music fans since 2019.",
    genres: ["Rock", "Metal", "Punk", "Indie", "Alternative", "Hardcore"],
    socialLinks: [
      { platform: "Instagram", url: "https://instagram.com/thenewtestenvenue" },
      { platform: "Facebook", url: "https://facebook.com/thenewtestenvenue" },
      { platform: "Website", url: "https://thenewtestenvenue.nl" },
    ],
    capacity: 500,
    bannerUrl: "/assets/test-venue-banner.png",
    avatarUrl: "/assets/test-venue-square.png",
    photos: ["/assets/test-venue-banner.png", "/assets/test-venue-square.png"],
    videos: ["https://youtube.com/watch?v=dQw4w9WgXcQ"],
    amenities: [
      "Professional PA System",
      "In-house Backline",
      "Green Room",
      "Merch Area",
      "Bar & Kitchen",
      "Loading Dock",
      "Wheelchair Accessible",
      "Free Wi-Fi",
    ],
    subVenues: [
      { id: "SV-1", name: "Main Hall", type: "room", capacity: 350 },
      { id: "SV-2", name: "Club Room", type: "room", capacity: 120 },
      { id: "SV-3", name: "Rooftop Stage", type: "stage", capacity: 80 },
    ],
    dealTypes: ["Door Split", "Guarantee + Door Split", "Rental"],
    spotifyUrl: "",
    slug: "the-new-test-venue",
    isPublic: true,
    updatedAt: "2026-03-10T10:00:00Z",
    created: true,
  },
  promoter: {
    role: "promoter",
    type: "promoter",
    name: "shoWMe",
    locations: [{ id: "loc-1", label: "Primary", city: "Amsterdam", country: "NL" }],
    bio: "Independent concert promoter specialising in electronic music, jazz, and indie across the Netherlands. From intimate club shows to outdoor festivals, shoWMe curates unforgettable live experiences.",
    genres: ["Electronic", "Jazz", "Indie", "Alternative", "World"],
    socialLinks: [
      { platform: "Instagram", url: "https://instagram.com/showme_nl" },
      { platform: "Website", url: "https://showme.music" },
    ],
    slug: "showme",
    isPublic: true,
    updatedAt: "2026-03-10T10:00:00Z",
    created: true,
  },
  performer: {
    role: "performer",
    type: "performer",
    name: "Islandman",
    locations: [{ id: "loc-1", label: "Primary", city: "Stockholm", country: "SE" }],
    bio: "Electronic live act blending melodic house and organic percussion. Islandman tours clubs and festivals across Scandinavia and the Benelux, with a focus on extended live sets and immersive visuals.",
    genres: ["Electronic", "House", "Melodic Techno", "Live Act"],
    socialLinks: [
      { platform: "Instagram", url: "https://instagram.com/islandman" },
      { platform: "Spotify", url: "https://open.spotify.com/artist/example" },
      { platform: "Website", url: "https://islandman.example" },
    ],
    setupType: "Live electronic (controllers + hybrid drums)",
    setupSize: 3,
    bannerUrl: "/assets/test-venue-banner.png",
    avatarUrl: "https://i.pravatar.cc/150?u=islandman-artist",
    slug: "islandman",
    isPublic: true,
    updatedAt: "2026-03-10T10:00:00Z",
    created: true,
  },
};
