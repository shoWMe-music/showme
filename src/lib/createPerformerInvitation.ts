import { setDoc, doc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getFirestoreDb, getFirebaseFunctions } from "@/integrations/firebase/app";
import { insertCollaboratorInvite, addEventCollaborator } from "@/lib/db";
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
    eventRole = "artist",
    permission = "editor",
    message = "",
    onCollaboratorAdded,
  } = params;

  const token = `collab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 1. Create collaborator invite document
  try {
    await insertCollaboratorInvite({
      token,
      event_id: eventId,
      email: email.trim(),
      role,
      eventRole,
      permission,
      message: message.trim(),
    });
  } catch {
    return null;
  }

  // 2. Create stub profile for the invitee
  const stubProfileId = `stub-${eventId}-${token}`;
  try {
    await setDoc(doc(getFirestoreDb(), "profiles", stubProfileId), {
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
  } catch (err) {
    console.error("Failed to create stub profile:", err);
  }

  // 3. Generate invitation code via Cloud Function
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
      recipientEmail: email.trim(),
      recipientName: displayName,
      recipientRole: role.toLowerCase(),
      linkedProfileId: stubProfileId,
      linkedEventId: eventId,
      sourceCollaboratorInviteToken: token,
    });
    code = result.data.code;
    queryClient.invalidateQueries({ queryKey: queryKeys.myInvitationCodes(userUid) });
  } catch (err) {
    console.error("Failed to create invitation code:", err);
    return null;
  }

  // 4. Add collaborator to event
  try {
    await addEventCollaborator(eventId, {
      id: token,
      email: email.trim(),
      name: displayName,
      eventRole,
      role,
      status: "pending",
      invitedAt: new Date().toISOString(),
      profileId: stubProfileId,
    });
    onCollaboratorAdded?.();
  } catch (err) {
    console.error("Failed to add event collaborator:", err);
  }

  const url = `${window.location.origin}/signup?code=${code}`;
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
