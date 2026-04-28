/**
 * Profile domain — top-level `profiles` collection + `members` subcollection.
 * Import from `@/lib/profiles` instead of scattering collection strings across the app.
 */

export {
  PROFILE_COLLECTION,
  PROFILE_MEMBERS_SUBCOLLECTION,
  eventPersonalBudgetDocId,
  profileDocumentRef,
  profileMembersCollectionRef,
  profileMemberDocRef,
} from "./paths";

export {
  PROFILE_ROOT_SCHEMA_VERSION,
  PROFILE_MEMBER_SCHEMA_VERSION,
  type ProfileMemberRole,
  type ProfileMemberRecord,
  type ProfileInviteRecord,
} from "./types";

export { ensureProfileOwnerMember, deleteAllProfileMembers } from "./members";
