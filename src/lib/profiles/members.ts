import { getDocs, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";

import { getFirestoreDb } from "@/integrations/firebase/app";

import { profileMemberDocRef, profileMembersCollectionRef } from "./paths";
import { PROFILE_MEMBER_SCHEMA_VERSION, type ProfileMemberRecord } from "./types";

/** Ensure the Firestore owner has a `members/{ownerUid}` row with role `owner` (idempotent). */
export async function ensureProfileOwnerMember(profileId: string, ownerUid: string): Promise<void> {
  const ref = profileMemberDocRef(profileId, ownerUid);
  await setDoc(
    ref,
    {
      user_uid: ownerUid,
      role: "owner" as const,
      schemaVersion: PROFILE_MEMBER_SCHEMA_VERSION,
      updatedAt: serverTimestamp(),
    } satisfies ProfileMemberRecord,
    { merge: true },
  );
}

/** Best-effort: remove all member docs then caller deletes the profile root (used on profile delete). */
export async function deleteAllProfileMembers(profileId: string): Promise<void> {
  const col = profileMembersCollectionRef(profileId);
  const snap = await getDocs(col);
  if (snap.empty) return;
  const batch = writeBatch(getFirestoreDb());
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
