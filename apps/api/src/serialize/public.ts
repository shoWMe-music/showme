import type { schema } from "@showme/db";

type ProfileRow = typeof schema.profiles.$inferSelect;
type EventRow = typeof schema.events.$inferSelect;

/**
 * The public, unauthenticated projection of a profile — a hard allowlist, not a
 * redaction. Only the columns safe for anonymous viewers appear here; owner,
 * billing, `details`, membership, and every internal/financial field are omitted
 * by construction (they are never read, so they can never leak).
 */
export interface PublicProfile {
  id: string;
  name: string;
  type: string | null;
  kind: string;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
}

export function serializePublicProfile(profile: ProfileRow): PublicProfile {
  return {
    id: profile.id,
    name: profile.name,
    type: profile.type,
    kind: profile.kind,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    bannerUrl: profile.bannerUrl,
  };
}

/**
 * The public projection of a published event — the poster-level facts only.
 * Budget, notes, hold rank/auto-promote, participants, and their financials are
 * never selected here, so an anonymous viewer cannot see them.
 */
export interface PublicEvent {
  id: string;
  title: string;
  eventDate: string | null;
  venueName: string | null;
  doorTime: string | null;
  startTime: string | null;
}

export function serializePublicEvent(event: EventRow): PublicEvent {
  return {
    id: event.id,
    title: event.title,
    eventDate: event.eventDate,
    venueName: event.venueName,
    doorTime: event.doorTime,
    startTime: event.startTime,
  };
}
