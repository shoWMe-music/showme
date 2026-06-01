import type { SharedProfile } from "@/lib/user-context";

/**
 * Required fields a performer profile must have before that performer can
 * send invites or offers to venues. Mirrors the freemium spec — when any of
 * these are missing, send buttons stay disabled and link to the missing
 * field.
 *
 * `fieldKey` is the SharedProfile property that owns the data (used for
 * deep-linking from a "Complete your profile" prompt back to the editor).
 */
export type PerformerProfileField =
  | "bio"
  | "photo"
  | "music"
  | "tech_rider"
  | "setup_or_video"
  | "genres";

export interface ProfileFieldRequirement {
  key: PerformerProfileField;
  label: string;
}

export const PERFORMER_REQUIRED_FIELDS: ReadonlyArray<ProfileFieldRequirement> = [
  { key: "bio", label: "Bio" },
  { key: "photo", label: "Profile photo" },
  { key: "music", label: "Music or audio link" },
  { key: "tech_rider", label: "Technical rider" },
  { key: "setup_or_video", label: "Stage setup or a live video" },
  { key: "genres", label: "Genre" },
];

const MUSIC_PLATFORM_KEYS = new Set([
  "spotify",
  "soundcloud",
  "bandcamp",
  "apple_music",
  "apple music",
  "applemusic",
  "youtube_music",
  "youtube music",
  "youtubemusic",
  "tidal",
  "deezer",
]);

function hasMusicLink(profile: SharedProfile): boolean {
  if (profile.spotifyUrl?.trim()) return true;
  for (const link of profile.socialLinks ?? []) {
    const platform = (link.platform || "").trim().toLowerCase();
    if (!platform || !link.url?.trim()) continue;
    if (MUSIC_PLATFORM_KEYS.has(platform)) return true;
  }
  return false;
}

function hasTechRider(profile: SharedProfile): boolean {
  return (profile.documents ?? []).some(
    (d) => d.type === "tech_rider" && !!d.url?.trim(),
  );
}

function hasPhoto(profile: SharedProfile): boolean {
  if (profile.avatarUrl?.trim()) return true;
  return (profile.photos ?? []).some((p) => !!p?.trim());
}

function hasSetupOrVideo(profile: SharedProfile): boolean {
  if (profile.setupType?.trim()) return true;
  if ((profile.setups ?? []).some((s) => !!s.name?.trim())) return true;
  return (profile.videos ?? []).some((v) => !!v?.trim());
}

/**
 * Returns the set of `PERFORMER_REQUIRED_FIELDS` that are missing from the
 * performer profile. Empty array → profile is complete and the performer is
 * cleared to send invites/offers.
 *
 * Defensive: if the profile is not a performer role the function returns []
 * — operators don't have a send-side gate, callers should only invoke this
 * for performer profiles.
 */
export function getMissingPerformerFields(
  profile: SharedProfile | null | undefined,
): PerformerProfileField[] {
  if (!profile) {
    return PERFORMER_REQUIRED_FIELDS.map((f) => f.key);
  }
  if (profile.role !== "performer") return [];

  const missing: PerformerProfileField[] = [];
  if (!profile.bio?.trim()) missing.push("bio");
  if (!hasPhoto(profile)) missing.push("photo");
  if (!hasMusicLink(profile)) missing.push("music");
  if (!hasTechRider(profile)) missing.push("tech_rider");
  if (!hasSetupOrVideo(profile)) missing.push("setup_or_video");
  if (!(profile.genres ?? []).some((g) => !!g?.trim())) missing.push("genres");
  return missing;
}

export function isPerformerProfileComplete(
  profile: SharedProfile | null | undefined,
): boolean {
  return getMissingPerformerFields(profile).length === 0;
}

export function performerFieldLabel(key: PerformerProfileField): string {
  return (
    PERFORMER_REQUIRED_FIELDS.find((f) => f.key === key)?.label ?? String(key)
  );
}
