// ── Public request-form enums (Wave 7) ──
//
// Sender-type and performer-type vocabularies surfaced on the public
// "Request a date" form. Centralised here so the form, persisted records,
// and any future filters share a single source of truth.

export const SENDER_TYPE_FOR_VENUE = [
  "performer",
  "agent",
  "promoter",
  "private_person",
  "company",
  "other",
] as const;

export type SenderTypeForVenue = (typeof SENDER_TYPE_FOR_VENUE)[number];

export const senderTypeForVenueLabels: Record<SenderTypeForVenue, string> = {
  performer: "Performer",
  agent: "Agent",
  promoter: "Promoter",
  private_person: "Private person",
  company: "Company",
  other: "Other",
};

export const SENDER_TYPE_FOR_PERFORMER = [
  "venue",
  "private_person",
  "company",
  "festival",
  "talent_buyer",
  "event_organizer",
  "other",
] as const;

export type SenderTypeForPerformer = (typeof SENDER_TYPE_FOR_PERFORMER)[number];

export const senderTypeForPerformerLabels: Record<SenderTypeForPerformer, string> = {
  venue: "Venue",
  private_person: "Private person",
  company: "Company",
  festival: "Festival",
  talent_buyer: "Talent buyer",
  event_organizer: "Event organizer",
  other: "Other",
};

export const PERFORMER_TYPE = [
  "original_music",
  "cover_band",
  "comedy",
  "dance",
  "theater",
  "performance_art",
  "magic",
  "drag_show",
  "other",
] as const;

export type PerformerType = (typeof PERFORMER_TYPE)[number];

export const performerTypeLabels: Record<PerformerType, string> = {
  original_music: "Original music",
  cover_band: "Cover band",
  comedy: "Comedy",
  dance: "Dance",
  theater: "Theater",
  performance_art: "Performance art",
  magic: "Magic",
  drag_show: "Drag show",
  other: "Other",
};
