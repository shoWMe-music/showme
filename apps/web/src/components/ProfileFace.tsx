import { Avatar, type AvatarTone } from "@showme/design-system";
import { publicProfileUrl } from "../lib/publicSite";

export interface ProfileFaceProps {
  avatarUrl: string | null | undefined;
  /** Null unless the profile is PUBLISHED — the serializer decides, not the caller. */
  publicSlug: string | null | undefined;
  name: string;
  tone?: AvatarTone;
  size?: number;
}

/** Someone's picture, and a way to reach them.
 *
 * A face on a roster answers "who is on this bill"; the natural next question is
 * "who ARE they", and until now there was no way to ask it — `publicProfileUrl`
 * had exactly one caller in the whole app while every roster drew people you
 * could not click. This pairs the two so a face is a door wherever there is a
 * page behind it.
 *
 * It is a plain `Avatar` when `publicSlug` is null, which covers both an
 * unpublished profile and an off-platform act with no shoWMe page at all. That
 * is the whole reason the API sends a slug only for published profiles: a link
 * built from a slug alone would 404 for everyone who has not published.
 *
 * Never use this inside an already-clickable row — a link within a link is not a
 * thing. Where the row itself opens something, draw the bare `Avatar`.
 */
export function ProfileFace({ avatarUrl, publicSlug, name, tone, size = 40 }: ProfileFaceProps) {
  const face = (
    <Avatar
      src={avatarUrl ?? undefined}
      alt=""
      initials={initialsOf(name)}
      tone={tone}
      size={size}
    />
  );
  if (!publicSlug) return face;
  return (
    <a
      href={publicProfileUrl(publicSlug)}
      target="_blank"
      rel="noreferrer"
      aria-label={`${name} — public profile`}
      style={{ display: "inline-flex", borderRadius: "50%", flexShrink: 0 }}
    >
      {face}
    </a>
  );
}

/** Two letters for the fallback the `Avatar` draws when a picture is missing or
 * its signed URL has expired. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${(parts[0] ?? "").charAt(0)}${(parts[1] ?? "").charAt(0)}`.toUpperCase();
}
