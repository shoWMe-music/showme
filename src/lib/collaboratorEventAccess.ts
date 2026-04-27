import { signInAnonymously } from "firebase/auth";
import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "@/integrations/firebase/app";
import { getAuthClient } from "@/lib/firebaseAuth";

/**
 * Password-based collaborators are not signed into Firebase by default.
 * Anonymous sign-in plus a callable adds their UID to the event's `participant_uids`
 * so they can use the same `events/{eventId}/messages` path and rules as workspace users.
 */
export async function ensureCollaboratorParticipantOnEvent(inviteToken: string): Promise<void> {
  const auth = getAuthClient();
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  const join = httpsCallable<{ token: string }, { ok: boolean }>(
    getFirebaseFunctions(),
    "joinEventAsCollaborator",
  );
  await join({ token: inviteToken });
}
