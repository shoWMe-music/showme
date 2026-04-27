import { collection, doc } from "firebase/firestore";

import { getFirestoreDb } from "@/integrations/firebase/app";

/** Top-level Firestore collection for operator / org profiles. */
export const PROFILE_COLLECTION = "profiles";

/** Subcollection under each profile doc for ACL (multi-user admin). */
export const PROFILE_MEMBERS_SUBCOLLECTION = "members";

export function buildProfileDocId(ownerUid: string, roleSlot: string): string {
  const safeSlot = roleSlot.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${ownerUid}__${safeSlot}`;
}

/** Budget worksheet doc id when the user has no business profile row — `events/{eventId}/budgets/{uid}`. */
export function eventPersonalBudgetDocId(uid: string): string {
  return uid;
}

export function profileDocumentRef(profileId: string) {
  return doc(getFirestoreDb(), PROFILE_COLLECTION, profileId);
}

export function profileMembersCollectionRef(profileId: string) {
  return collection(getFirestoreDb(), PROFILE_COLLECTION, profileId, PROFILE_MEMBERS_SUBCOLLECTION);
}

export function profileMemberDocRef(profileId: string, userUid: string) {
  return doc(getFirestoreDb(), PROFILE_COLLECTION, profileId, PROFILE_MEMBERS_SUBCOLLECTION, userUid);
}
