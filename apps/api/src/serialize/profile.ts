import type { ProfileRole } from "@showme/auth";
import type { schema } from "@showme/db";

type ProfileRow = typeof schema.profiles.$inferSelect;

export interface SerializedProfile {
  id: string;
  kind: string;
  type: string | null;
  ownerUserId: string;
  name: string;
  slug: string;
  isPublic: boolean;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  details: unknown;
  /** Legal/tax/invoicing identity — owner/admin only. */
  billing?: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Roles that may see the profile's private billing identity. */
const BILLING_ROLES: ProfileRole[] = ["owner", "admin"];

/**
 * Shape a profile by the caller's per-profile role — the field-level serializer,
 * server-side (not UI hiding). Everyone with any membership sees the profile's
 * public face; only owner/admin see the private `billing` identity (legal name,
 * VAT, invoice sequence). `role` omitted → treat as unprivileged.
 */
export function serializeProfile(profile: ProfileRow, role?: ProfileRole): SerializedProfile {
  const base: SerializedProfile = {
    id: profile.id,
    kind: profile.kind,
    type: profile.type,
    ownerUserId: profile.ownerUserId,
    name: profile.name,
    slug: profile.slug,
    isPublic: profile.isPublic,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    bannerUrl: profile.bannerUrl,
    details: profile.details,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
  if (role && BILLING_ROLES.includes(role)) {
    base.billing = profile.billing;
  }
  return base;
}
