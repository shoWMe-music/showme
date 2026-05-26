import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import type { QueryClient } from "@tanstack/react-query";

import { getFirebaseFunctions, getFirestoreDb } from "@/integrations/firebase/app";
import { getAuthClient } from "@/lib/firebaseAuth";
import { PROFILE_ROOT_SCHEMA_VERSION } from "@/lib/profiles";
import { queryKeys } from "@/lib/queries/keys";

/**
 * Performer-initiated draft event with a venue-handoff invitation.
 *
 * Pattern mirrors `createPerformerInvitation`: a single client write-batch
 * creates the stub venue profile, the draft event, and the collaborator row
 * for the originating performer. Then a Cloud Function mints the invitation
 * code and (optionally) sends the email.
 *
 * What lives where after this returns:
 *
 *   profiles/{stubVenueId}        — venue stub, owned by the performer's uid,
 *                                   unclaimed=true. Becomes the venue's real
 *                                   profile when they accept the code.
 *   events/{eventId}              — draft event, hostProfileId = stubVenueId,
 *                                   pendingHostHandoff = true.
 *   events/{eventId}/collaborators/{token}
 *                                  — performer's collaborator row, editor tier.
 *   collaboratorInvites/{token}   — invite metadata (for the collab system).
 *   invitationCodes/{code}        — SHOW-XXXX-XXXX, source=venue_handoff,
 *                                   linkedProfileId=stubVenueId, linkedEventId.
 *
 * When the venue accepts via `claimInvitationCode`, the stub profile transfers
 * to them and `hostProfileId` is repointed to their newly-created
 * `{venueUid}__venue` profile in one atomic update; the pending-handoff flag
 * is cleared at the same moment.
 */

interface CreateVenueHandoffDraftParams {
  /** The originating performer profile id (must be owned by the caller). */
  performerProfileId: string;
  /** Display name of the performer for the event + collaborator row. */
  performerName: string;
  /** Venue name to put on the stub profile. */
  venueName: string;
  /** Venue contact email — the handoff invitation is sent here. */
  venueEmail: string;
  /** Wanted date (yyyy-MM-dd) from the booking request. */
  date: string;
  /** Suggested fee from the booking request, if any. */
  artistFee?: number | null;
  /** Optional free-text message included with the email. */
  message?: string;
  /** Optional source booking-request id, stored on the event for traceability. */
  sourceRequestId?: string;
  queryClient: QueryClient;
}

export interface CreateVenueHandoffDraftResult {
  eventId: string;
  stubVenueId: string;
  code: string;
  inviteUrl: string;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createVenueHandoffDraft(
  params: CreateVenueHandoffDraftParams,
): Promise<CreateVenueHandoffDraftResult> {
  const {
    performerProfileId,
    performerName,
    venueName,
    venueEmail,
    date,
    artistFee,
    message = "",
    sourceRequestId,
    queryClient,
  } = params;

  const uid = getAuthClient().currentUser?.uid;
  if (!uid) {
    throw new Error("Sign in to create a draft event.");
  }

  const trimmedVenueName = venueName.trim();
  const trimmedVenueEmail = venueEmail.trim().toLowerCase();
  if (!trimmedVenueName) throw new Error("Venue name is required.");
  if (!trimmedVenueEmail) throw new Error("Venue email is required.");
  if (!performerProfileId) throw new Error("Performer profile is required.");

  const db = getFirestoreDb();

  const stubVenueId = genId("stub-venue");
  const eventId = `EVT-${String(Date.now()).slice(-6)}`;
  const collabToken = genId("collab");
  const eventName = `${performerName.trim() || "Performer"} @ ${trimmedVenueName}`;

  const batch = writeBatch(db);

  // 1. Stub venue profile — owned by the performer's account so they can
  //    create the event (rule requires isProfileAdmin(hostProfileId)). The
  //    `unclaimed: true` flag marks it as a placeholder; ownership transfers
  //    to the real venue when they accept the invitation code.
  batch.set(doc(db, "profiles", stubVenueId), {
    name: trimmedVenueName,
    owner_uid: uid,
    slot: `venue-handoff-${stubVenueId.slice(0, 6)}`,
    role: "venue",
    type: "venue",
    unclaimed: true,
    acquired: false,
    isPublic: false,
    created: true,
    locations: [],
    bio: "",
    genres: [],
    socialLinks: [],
    schemaVersion: PROFILE_ROOT_SCHEMA_VERSION,
    linkedEventId: eventId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 2. Owner-member row on the stub so isProfileMember() passes for the
  //    performer (some downstream rules check membership instead of ownership).
  batch.set(doc(db, "profiles", stubVenueId, "members", uid), {
    user_uid: uid,
    role: "owner",
    schemaVersion: 1,
    updatedAt: serverTimestamp(),
  });

  // 3. The draft event. hostProfileId = stub venue (performer is admin via
  //    profile ownership), eventStatus pinned to "draft" — the rule blocks
  //    transitions out of draft while pendingHostHandoff is true.
  batch.set(doc(db, "events", eventId), {
    id: eventId,
    name: eventName,
    date,
    venue: trimmedVenueName,
    operator: trimmedVenueName,
    operatorType: "venue",
    capacity: 0,
    artist: performerName.trim(),
    eventStatus: "draft",
    status: "open",
    hostProfileId: stubVenueId,
    performerProfileId,
    accessUids: [uid],
    accessProfileIds: [stubVenueId, performerProfileId],
    editorUids: [uid],
    pendingHostHandoff: true,
    pendingHostHandoffInviteEmail: trimmedVenueEmail,
    createdByProfileId: performerProfileId,
    owner_uid: uid,
    primary_owner_uid: uid,
    ...(sourceRequestId ? { sourceRequestId, sourceRequestDate: date } : {}),
    ...(artistFee != null ? {} : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 4. Collaborator invite + row for the venue. Pattern matches
  //    createPerformerInvitation so claimInvitationCode's existing collaborator-
  //    activation branch works without modification.
  batch.set(doc(db, "collaboratorInvites", collabToken), {
    token: collabToken,
    event_id: eventId,
    email: trimmedVenueEmail,
    role: "Venue",
    permission: "admin",
    eventRole: "venue",
    message: message.trim(),
    ownerUid: uid,
    passwordHash: null,
    status: "pending",
  });

  batch.set(doc(db, "events", eventId, "collaborators", collabToken), {
    clientId: collabToken,
    email: trimmedVenueEmail,
    name: trimmedVenueName,
    eventRole: "venue",
    role: "Venue",
    permission: "admin",
    status: "pending",
    invitedAt: new Date().toISOString(),
    userUid: null,
    profileId: stubVenueId,
    inviteProfileSlug: null,
    schemaVersion: 1,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  // 5. Mint the invitation code via Cloud Function (after the batch so a
  //    code can't outlive its supporting docs).
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

  const result = await createInvitationCodeFn({
    source: "venue_handoff",
    recipientEmail: trimmedVenueEmail,
    recipientName: trimmedVenueName,
    recipientRole: "venue",
    linkedProfileId: stubVenueId,
    linkedEventId: eventId,
    sourceCollaboratorInviteToken: collabToken,
  });

  queryClient.invalidateQueries({ queryKey: queryKeys.myInvitationCodes(uid) });

  const inviteUrl = `${window.location.origin}/invite?code=${result.data.code}`;
  return {
    eventId,
    stubVenueId,
    code: result.data.code,
    inviteUrl,
  };
}
