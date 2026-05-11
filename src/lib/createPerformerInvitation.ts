import { collection, doc, getDocs, limit, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getFirestoreDb, getFirebaseFunctions } from "@/integrations/firebase/app";
import { PROFILE_ROOT_SCHEMA_VERSION } from "@/lib/profiles";
import { queryKeys } from "@/lib/queries/keys";
import type { QueryClient } from "@tanstack/react-query";
import type { EventCollaboratorRole } from "@/lib/models";

interface CreatePerformerInvitationParams {
  eventId: string;
  email: string;
  displayName: string;
  userUid: string;
  queryClient: QueryClient;
  role?: string;
  eventRole?: EventCollaboratorRole;
  permission?: string;
  message?: string;
  onCollaboratorAdded?: () => void;
}

/**
 * Creates a full performer invitation: collaborator invite token, stub profile,
 * invitation code (Cloud Function), and event collaborator entry.
 */
export async function createPerformerInvitation(
  params: CreatePerformerInvitationParams,
): Promise<{ url: string; code: string; token: string } | null> {
  const {
    eventId,
    email,
    displayName,
    userUid,
    queryClient,
    role = "Performer",
    eventRole = "performer",
    permission = "editor",
    message = "",
    onCollaboratorAdded,
  } = params;

  const trimmedEmail = email.trim();
  const trimmedMessage = message.trim();

  const db = getFirestoreDb();

  // Defense-in-depth: if an active invitation already exists for this
  // (event, email, creator), reuse it instead of writing duplicate docs.
  // Belt-and-braces with the dialog's link-state preservation.
  const existingQuery = query(
    collection(db, "invitationCodes"),
    where("createdByUid", "==", userUid),
    where("linkedEventId", "==", eventId),
    where("recipientEmail", "==", trimmedEmail),
    where("status", "==", "active"),
    limit(1),
  );
  const existingSnap = await getDocs(existingQuery);
  if (!existingSnap.empty) {
    const existingDoc = existingSnap.docs[0];
    const existingCode = existingDoc.id;
    const existingToken = (existingDoc.data() as { sourceCollaboratorInviteToken?: string }).sourceCollaboratorInviteToken ?? "";
    onCollaboratorAdded?.();
    return {
      url: `${window.location.origin}/invite?code=${existingCode}`,
      code: existingCode,
      token: existingToken,
    };
  }

  const token = `collab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stubProfileId = `stub-${eventId}-${token}`;
  const invitedAt = new Date().toISOString();

  const batch = writeBatch(db);

  // inlined into batch for atomicity — keep payload shape in sync with insertCollaboratorInvite
  batch.set(doc(db, "collaboratorInvites", token), {
    token,
    event_id: eventId,
    email: trimmedEmail,
    role,
    permission,
    eventRole,
    message: trimmedMessage,
    ownerUid: userUid,
    passwordHash: null,
    status: "pending",
  });

  batch.set(doc(db, "profiles", stubProfileId), {
    name: displayName,
    owner_uid: userUid,
    slot: role.toLowerCase(),
    role: role.toLowerCase(),
    type: role.toLowerCase(),
    unclaimed: true,
    schemaVersion: PROFILE_ROOT_SCHEMA_VERSION,
    linkedEventId: eventId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // inlined into batch for atomicity — keep payload shape in sync with addEventCollaborator
  batch.set(doc(db, "events", eventId, "collaborators", token), {
    clientId: token,
    email: trimmedEmail,
    name: displayName,
    eventRole,
    role,
    status: "pending",
    invitedAt,
    userUid: null,
    profileId: stubProfileId,
    inviteProfileSlug: null,
    schemaVersion: 1,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    console.error("Failed to commit performer invitation batch:", err);
    return null;
  }

  // Cloud Function runs AFTER batch commits: a code without supporting docs is
  // worse than docs without a code (a missing code is recoverable via retry).
  const createInvitationCodeFn = httpsCallable<
    {
      recipientEmail?: string;
      recipientName?: string;
      recipientRole?: string;
      linkedProfileId?: string;
      linkedEventId?: string;
      source: string;
      sourceCollaboratorInviteToken?: string;
    },
    { code: string }
  >(getFirebaseFunctions(), "createInvitationCode");

  let code: string;
  try {
    const result = await createInvitationCodeFn({
      source: "collaborator_invite",
      recipientEmail: trimmedEmail,
      recipientName: displayName,
      recipientRole: role.toLowerCase(),
      linkedProfileId: stubProfileId,
      linkedEventId: eventId,
      sourceCollaboratorInviteToken: token,
    });
    code = result.data.code;
    queryClient.invalidateQueries({ queryKey: queryKeys.myInvitationCodes(userUid) });
  } catch (err) {
    // Batch writes already committed — caller can retry just this step.
    // Do not delete the batch's docs; they remain valid for a retry.
    console.error("Failed to create invitation code:", err);
    return null;
  }

  onCollaboratorAdded?.();

  const url = `${window.location.origin}/invite?code=${code}`;
  return { url, code, token };
}

/**
 * Sends a performer invitation email via the sendInvitationEmail Cloud Function.
 */
export async function sendPerformerInvitationEmail(params: {
  code: string;
  recipientEmail: string;
  recipientName: string;
  eventName?: string;
  senderName: string;
  message?: string;
}): Promise<void> {
  const fn = httpsCallable<
    {
      code: string;
      recipientEmail: string;
      recipientName: string;
      eventName?: string;
      senderName: string;
      message?: string;
    },
    { ok: true }
  >(getFirebaseFunctions(), "sendInvitationEmail");

  try {
    await fn(params);
  } catch (err) {
    console.error("Failed to send invitation email:", err);
  }
}
