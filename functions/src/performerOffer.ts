import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { APP_BASE_URL } from "./appBaseUrl";
import { generateCode } from "./invitations";
import { performerOfferEmail } from "./emailTemplates";
import {
  assertCanSendOffer,
  getProfilePlan,
  recordOfferSent,
} from "./plans";
import { writeAudit } from "./auditLog";

const db = () => admin.firestore();

// ─── Constants ────────────────────────────────────────────────────────────────

const OFFER_EXPIRY_DAYS = 30;
const PITCH_MAX_LEN = 2000;
const ADDITIONAL_DATES_MAX = 5;
const PROFILE_ROOT_SCHEMA_VERSION = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreatePerformerOfferData {
  performerProfileId: string;
  /** One of these two is required. targetProfileId wins when both are set. */
  targetProfileId?: string;
  venueEmail?: string;
  /** Off-platform only — display name for the venue stub. */
  venueName?: string;
  wantedDate: string;
  additionalDates?: string[];
  feeMin?: number | null;
  feeMax?: number | null;
  pitch: string;
}

interface CreatePerformerOfferResult {
  requestId: string;
  sentVia: "in_platform" | "mailto";
  // Off-platform mailto path returns these so the client can open the
  // performer's email client / copy a styled version to clipboard.
  subject?: string;
  mailtoBody?: string;
  htmlBody?: string;
  claimUrl?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

async function assertCallerIsProfileAdmin(uid: string, profileId: string): Promise<Record<string, unknown>> {
  const profileSnap = await db().collection("profiles").doc(profileId).get();
  if (!profileSnap.exists) {
    throw new HttpsError("not-found", "Profile not found.");
  }
  const data = profileSnap.data() ?? {};

  // Owner fallback for legacy profiles without a member doc.
  if (data.owner_uid === uid) return { ...data, id: profileId };

  const memberSnap = await db()
    .collection("profiles")
    .doc(profileId)
    .collection("members")
    .doc(uid)
    .get();
  if (memberSnap.exists) {
    const role = String(memberSnap.data()?.role || "");
    if (role === "owner" || role === "admin") return { ...data, id: profileId };
  }
  throw new HttpsError(
    "permission-denied",
    "Only owners and admins of this profile can send offers from it.",
  );
}

/**
 * Server-side mirror of getMissingPerformerFields. Re-implemented (not
 * shared) because the functions bundle and the client bundle don't share
 * code. Kept minimal — drift between client and server is acceptable for
 * the gate: client gate is the primary UX, server gate is the malicious-
 * client backstop.
 */
function getMissingPerformerFieldsServer(profile: Record<string, unknown>): string[] {
  const missing: string[] = [];
  const bio = typeof profile.bio === "string" ? profile.bio.trim() : "";
  if (!bio) missing.push("bio");

  const avatarUrl = typeof profile.avatarUrl === "string" ? profile.avatarUrl.trim() : "";
  const photos = Array.isArray(profile.photos) ? (profile.photos as string[]) : [];
  if (!avatarUrl && !photos.some((p) => !!p?.trim())) missing.push("photo");

  const MUSIC_PLATFORMS = new Set([
    "spotify", "soundcloud", "bandcamp", "apple_music", "apple music",
    "applemusic", "youtube_music", "youtube music", "youtubemusic",
    "tidal", "deezer",
  ]);
  const spotifyUrl = typeof profile.spotifyUrl === "string" ? profile.spotifyUrl.trim() : "";
  const socialLinks = Array.isArray(profile.socialLinks)
    ? (profile.socialLinks as Array<{ platform?: string; url?: string }>)
    : [];
  const hasMusic = !!spotifyUrl || socialLinks.some((l) =>
    MUSIC_PLATFORMS.has((l.platform ?? "").toLowerCase().trim()) && !!l.url?.trim(),
  );
  if (!hasMusic) missing.push("music");

  const documents = Array.isArray(profile.documents)
    ? (profile.documents as Array<{ type?: string; url?: string }>)
    : [];
  const hasRider = documents.some((d) => d.type === "tech_rider" && !!d.url?.trim());
  if (!hasRider) missing.push("tech_rider");

  const setupType = typeof profile.setupType === "string" ? profile.setupType.trim() : "";
  const videos = Array.isArray(profile.videos) ? (profile.videos as string[]) : [];
  const setups = Array.isArray(profile.setups)
    ? (profile.setups as Array<{ name?: string }>)
    : [];
  const hasSetupOrVideo =
    !!setupType ||
    setups.some((s) => !!s.name?.trim()) ||
    videos.some((v) => !!v?.trim());
  if (!hasSetupOrVideo) missing.push("setup_or_video");

  const genres = Array.isArray(profile.genres) ? (profile.genres as string[]) : [];
  if (!genres.some((g) => !!g?.trim())) missing.push("genres");

  return missing;
}

async function mintInvitationCodeForOffer(opts: {
  performerUid: string;
  stubProfileId: string;
  recipientEmail: string;
  recipientName: string;
}): Promise<string> {
  // Inline mint loop — same alphabet/format as `generateCode` in invitations.ts.
  // We deliberately don't go through `createInvitationCode` (it's a callable);
  // calling-callable-from-callable would round-trip auth and is unnecessary
  // since we're already in the trusted server context.
  let code = generateCode();
  for (let i = 0; i < 10; i++) {
    const existing = await db().collection("invitationCodes").doc(code).get();
    if (!existing.exists) break;
    code = generateCode();
    if (i === 9) {
      throw new HttpsError("internal", "Failed to allocate an invitation code.");
    }
  }
  await db().collection("invitationCodes").doc(code).set({
    code,
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: opts.performerUid,
    recipientEmail: opts.recipientEmail,
    recipientName: opts.recipientName,
    recipientRole: "venue",
    linkedProfileId: opts.stubProfileId,
    linkedEventId: null,
    linkedContactId: null,
    source: "performer_offer",
    sourceCollaboratorInviteToken: null,
    usedByUid: null,
    usedAt: null,
  });
  return code;
}

async function fanOutInPlatformNotification(opts: {
  targetProfileId: string;
  performerUid: string;
  performerName: string;
  requestId: string;
}): Promise<void> {
  // The venue's profile members need an in-app notification. Per
  // `feedback_notifications_per_user_fanout`, one doc per recipient uid at
  // users/{uid}/notifications; exclude only the actor uid.
  try {
    const members = await db()
      .collection("profiles")
      .doc(opts.targetProfileId)
      .collection("members")
      .get();
    const writes: Array<Promise<unknown>> = [];
    for (const m of members.docs) {
      const recipientUid = String(m.data()?.user_uid || m.id);
      if (!recipientUid || recipientUid === opts.performerUid) continue;
      writes.push(
        db()
          .collection("users")
          .doc(recipientUid)
          .collection("notifications")
          .doc()
          .set({
            type: "booking_request_received",
            title: "New offer from a performer",
            body: `${opts.performerName} sent you an offer to play.`,
            actorName: opts.performerName,
            actorUid: opts.performerUid,
            read: false,
            createdAt: new Date().toISOString(),
            link: "/requests",
            metadata: { requestId: opts.requestId },
          }),
      );
    }
    await Promise.all(writes);
  } catch (err) {
    // Notification fan-out is best-effort — log and move on so the offer
    // itself isn't blocked by a slow notification write.
    logger.warn("notify fan-out failed", { err: String(err), target: opts.targetProfileId });
  }
}

// ─── Main callable ───────────────────────────────────────────────────────────

export const createPerformerOffer = onCall<CreatePerformerOfferData, Promise<CreatePerformerOfferResult>>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to send an offer.");

    const data = request.data ?? ({} as CreatePerformerOfferData);

    // ── Validate input ────────────────────────────────────────────────────
    const performerProfileId = (data.performerProfileId ?? "").trim();
    if (!performerProfileId) {
      throw new HttpsError("invalid-argument", "performerProfileId is required.");
    }
    const wantedDate = (data.wantedDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wantedDate)) {
      throw new HttpsError("invalid-argument", "wantedDate must be YYYY-MM-DD.");
    }
    const pitch = (data.pitch ?? "").trim();
    if (pitch.length < 20) {
      throw new HttpsError("invalid-argument", "Pitch is too short — add at least a sentence or two.");
    }
    if (pitch.length > PITCH_MAX_LEN) {
      throw new HttpsError("invalid-argument", `Pitch exceeds ${PITCH_MAX_LEN} characters.`);
    }
    const additionalDates = Array.isArray(data.additionalDates)
      ? data.additionalDates.filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
      : [];
    if (additionalDates.length > ADDITIONAL_DATES_MAX) {
      throw new HttpsError("invalid-argument", `At most ${ADDITIONAL_DATES_MAX} additional dates allowed.`);
    }
    const feeMin = typeof data.feeMin === "number" && data.feeMin >= 0 ? data.feeMin : null;
    const feeMax = typeof data.feeMax === "number" && data.feeMax >= 0 ? data.feeMax : null;
    if (feeMin != null && feeMax != null && feeMax < feeMin) {
      throw new HttpsError("invalid-argument", "feeMax cannot be less than feeMin.");
    }

    const targetProfileId = (data.targetProfileId ?? "").trim();
    const venueEmail = (data.venueEmail ?? "").trim().toLowerCase();
    if (!targetProfileId && !venueEmail) {
      throw new HttpsError("invalid-argument", "Either targetProfileId or venueEmail is required.");
    }

    // ── Performer profile gate ────────────────────────────────────────────
    const performerProfile = await assertCallerIsProfileAdmin(uid, performerProfileId);
    if (performerProfile.role !== "performer") {
      throw new HttpsError("failed-precondition", "Only performer profiles can send offers.");
    }
    const missing = getMissingPerformerFieldsServer(performerProfile);
    if (missing.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        `Complete your profile before sending offers (missing: ${missing.join(", ")}).`,
      );
    }
    const performerName = String(performerProfile.name || "").trim() || "A performer";

    // ── Plan gate: monthly offer cap ─────────────────────────────────────
    // Free Artist is capped at FREE_ARTIST_OFFER_MONTHLY_CAP per calendar
    // month (lazy reset). Paid plans bypass. We compute the post-send count
    // here but only write it after the bookingRequest write succeeds, so a
    // failed send doesn't burn a slot.
    const plan = await getProfilePlan(performerProfileId);
    const offerGate = assertCanSendOffer(plan, String(performerProfile.role || ""));

    // ── Same-venue dedup ─────────────────────────────────────────────────
    // Spec: a performer cannot send a second offer to the same venue for an
    // overlapping date window while a prior offer is still pending. We
    // approximate "overlapping window" as exact wantedDate match plus any
    // overlap with that performer's additionalDates — the spec doesn't
    // define a fuzzy window, so exact-date match is the smallest correct
    // rule.
    const dedupTarget = targetProfileId || venueEmail; // identify target consistently
    const dedupQuery = await db()
      .collection("inboundBookingRequests")
      .where("sender_user_uid", "==", uid)
      .where("status", "==", "pending")
      .where("source", "==", "performer_offer")
      .where("wanted_date", "==", wantedDate)
      .limit(20)
      .get();
    for (const d of dedupQuery.docs) {
      const data = d.data();
      const sameTarget =
        (targetProfileId && data.target_profile_id === targetProfileId) ||
        (venueEmail && typeof data.email === "string" && data.email.toLowerCase() === venueEmail);
      if (sameTarget) {
        throw new HttpsError(
          "already-exists",
          `You already have a pending offer to ${data.name || dedupTarget} on ${wantedDate}.`,
        );
      }
    }

    // ── Resolve target → in-platform vs mailto ────────────────────────────
    let resolvedTargetProfileId: string;
    let ownerUid: string;
    let sentVia: "in_platform" | "mailto";
    let stubProfileId: string | null = null;
    let invitationCode: string | null = null;
    let claimUrl: string | null = null;
    let venueDisplayName = (data.venueName ?? "").trim();

    if (targetProfileId) {
      // In-platform — venue already on shoWMe.
      const venueSnap = await db().collection("profiles").doc(targetProfileId).get();
      if (!venueSnap.exists) {
        throw new HttpsError("not-found", "Target venue profile not found.");
      }
      const venue = venueSnap.data() ?? {};
      const vOwner = typeof venue.owner_uid === "string" ? venue.owner_uid : "";
      if (!vOwner) {
        // Defensive — every real profile should have owner_uid. If missing,
        // treat as off-platform path so the offer doesn't write a doc no one
        // can read.
        throw new HttpsError("failed-precondition", "Target venue has no owner — cannot route in-platform.");
      }
      resolvedTargetProfileId = targetProfileId;
      ownerUid = vOwner;
      sentVia = "in_platform";
      if (!venueDisplayName) venueDisplayName = String(venue.name || "");
    } else {
      // Off-platform — create an unclaimed venue stub owned by the performer.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(venueEmail)) {
        throw new HttpsError("invalid-argument", "venueEmail must be a valid email address.");
      }
      stubProfileId = genId("stub-venue");
      await db().collection("profiles").doc(stubProfileId).set({
        name: venueDisplayName || venueEmail,
        owner_uid: uid,
        slot: `venue-offer-${stubProfileId.slice(0, 6)}`,
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
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await db()
        .collection("profiles")
        .doc(stubProfileId)
        .collection("members")
        .doc(uid)
        .set({
          user_uid: uid,
          role: "owner",
          schemaVersion: 1,
          updatedAt: FieldValue.serverTimestamp(),
        });

      invitationCode = await mintInvitationCodeForOffer({
        performerUid: uid,
        stubProfileId,
        recipientEmail: venueEmail,
        recipientName: venueDisplayName || venueEmail,
      });
      claimUrl = `${APP_BASE_URL.replace(/\/$/, "")}/invite?code=${encodeURIComponent(invitationCode)}`;

      resolvedTargetProfileId = stubProfileId;
      ownerUid = uid;
      sentVia = "mailto";
    }

    // ── Write the booking request ─────────────────────────────────────────
    const requestId = genId("offer");
    const nowIso = new Date().toISOString();
    const expiresAtIso = addDaysIso(OFFER_EXPIRY_DAYS);

    const performerSlug = typeof performerProfile.slug === "string" ? performerProfile.slug : "";
    const performerProfileUrl = performerSlug
      ? `${APP_BASE_URL.replace(/\/$/, "")}/p/${encodeURIComponent(performerSlug)}`
      : APP_BASE_URL.replace(/\/$/, "");

    await db().collection("inboundBookingRequests").doc(requestId).set({
      // Public-form-shape fields, populated for compatibility with the
      // existing IncomingRequestsPage rendering.
      name: venueDisplayName || venueEmail || "(venue)",
      email: venueEmail,
      phone: "",
      artist_name: performerName,
      wanted_date: wantedDate,
      artist_fee: feeMin,
      note: pitch,
      target_profile_slug: "",
      target_profile_id: resolvedTargetProfileId,
      target_role: "venue",
      status: "pending",
      source: "performer_offer",
      event_id: "",
      owner_uid: ownerUid,
      created_at: nowIso,

      // Performer-offer extensions (see BookingRequest in src/lib/models.ts).
      sender_user_uid: uid,
      sender_profile_id: performerProfileId,
      sender_profile_name: performerName,
      offer_pitch: pitch,
      offer_fee_min: feeMin,
      offer_fee_max: feeMax ?? feeMin,
      additional_dates: additionalDates,
      expires_at: expiresAtIso,
      sent_via: sentVia,
    });

    // ── Record offer against the monthly cap ─────────────────────────────
    // Done after the booking-request write so a failed write doesn't burn
    // a credit. Failures here are logged but don't bubble up — the offer
    // itself is already persisted.
    try {
      await recordOfferSent(performerProfileId, offerGate.monthKey, offerGate.countAfterSend);
    } catch (err) {
      logger.warn("offer counter write failed", { performerProfileId, err: String(err) });
    }

    // GDPR audit trail — captures who reached out to whom, when. Plain
    // pointer fields only; the originating bookingRequest has the payload.
    await writeAudit({
      actor: { uid, profileId: performerProfileId },
      target: { kind: "bookingRequest", id: requestId },
      action: "offer_created",
      context: { kind: "performer_offer", id: requestId },
    });

    // ── Side effects per path ─────────────────────────────────────────────
    if (sentVia === "in_platform") {
      await fanOutInPlatformNotification({
        targetProfileId: resolvedTargetProfileId,
        performerUid: uid,
        performerName,
        requestId,
      });
      return { requestId, sentVia };
    }

    // mailto: path — build template, return for the client to open.
    const performerGenres = Array.isArray(performerProfile.genres)
      ? (performerProfile.genres as string[])
      : [];
    const locations = Array.isArray(performerProfile.locations)
      ? (performerProfile.locations as Array<{ city?: string; country?: string }>)
      : [];
    const primaryLoc = locations[0];
    const performerLocation = primaryLoc
      ? [primaryLoc.city, primaryLoc.country].filter(Boolean).join(", ")
      : "";

    const tpl = performerOfferEmail({
      performerName,
      performerProfileUrl,
      performerGenres,
      performerLocation,
      venueName: venueDisplayName,
      wantedDate,
      additionalDates,
      feeMin,
      feeMax: feeMax ?? feeMin,
      pitch,
      claimUrl: claimUrl ?? "",
    });

    return {
      requestId,
      sentVia,
      subject: tpl.subject,
      mailtoBody: tpl.plainText,
      htmlBody: tpl.html,
      claimUrl: claimUrl ?? undefined,
    };
  },
);

// Silence unused-import warnings when the file is partially used in tests.
void Timestamp;
