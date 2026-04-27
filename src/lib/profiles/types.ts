/**
 * Firestore profile domain — keep UI-facing shapes in `user-context` (`SharedProfile`).
 * This file is the contract for persisted profile + membership rows.
 */

export const PROFILE_ROOT_SCHEMA_VERSION = 2;
export const PROFILE_MEMBER_SCHEMA_VERSION = 1;

/** Who can act on behalf of a profile (beyond the legacy `owner_uid` on the root doc). */
export type ProfileMemberRole = "owner" | "admin" | "editor";

export interface ProfileMemberRecord {
  user_uid: string;
  role: ProfileMemberRole;
  /** Stored at invite/claim time so we can display it without resolving the UID. */
  email?: string;
  displayName?: string;
  updatedAt?: unknown;
  schemaVersion?: number;
}

/** A pending invite stored at `/profileInvites/{profileId}_{email}`. */
export interface ProfileInviteRecord {
  /** The Firestore document ID — `${profileId}_${email}`. */
  id?: string;
  profileId: string;
  profileName: string;
  email: string;
  role: "admin" | "editor";
  invitedAt: string;
  invitedByUid: string;
}
