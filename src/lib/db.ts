import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  arrayUnion,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import type { QueryDocumentSnapshot } from "firebase/firestore";

import type { DocumentReference, SetOptions } from "firebase/firestore";
import { getFirestoreDb } from "@/integrations/firebase/app";

/** Wrapper around setDoc that strips `undefined` values (Firestore rejects them). */
function cleanData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function safeSetDoc(ref: DocumentReference, data: Record<string, unknown>, options?: SetOptions) {
  if (options) {
    await setDoc(ref, cleanData(data), options);
  } else {
    await setDoc(ref, cleanData(data));
  }
}
import { getAuthClient } from "@/lib/firebaseAuth";
import {
  PROFILE_COLLECTION,
  PROFILE_MEMBERS_SUBCOLLECTION,
  PROFILE_ROOT_SCHEMA_VERSION,
  deleteAllProfileMembers,
  ensureProfileOwnerMember,
  profileDocumentRef,
} from "@/lib/profiles";
import type {
  Agreement,
  CalendarItem,
  CrewMember,
  DealStructure,
  Event,
  EventActivity,
  EventActivityType,
  EventCollaborator,
  Contact,
  ProEstimate,
  Rider,
  ScheduleItem,
  Settlement,
  SettlementActivity,
  SettlementActivityType,
  TicketRevenue,
} from "./models";
import {
  legacyRoleToEventRole,
  normalizeCollaboratorStatus,
} from "./models";
import type { AppNotification, NotificationType } from "./models";
import type { BudgetCalculatorPersisted } from "./budget-types";
import type { OperatorRole, SharedProfile, TeamMember, ProfileLocation } from "./user-context";

// ── Collection names ──────────────────────────────────────────────────────────

const USERS = "users";
const TOP_EVENTS = "events";
const PUBLIC_SHARES = "publicShares";
const COLLAB_INVITES = "collaboratorInvites";
const COLLAB_WRITES = "collaboratorWrites";
const INBOUND_BOOKING_REQUESTS = "inboundBookingRequests";
const PUBLIC_BOOKING_REQUESTS_LEGACY = "publicBookingRequests";
const INVITATION_CODES = "invitationCodes";
const ADMINS = "admins";

// Event subcollections
const SUB_DEAL = "deal";
const SUB_SETTLEMENT = "settlement";
const SUB_REVENUE = "revenue";
const SUB_ACTIVITY = "activity";
const SUB_EVENT_ACTIVITY = "event_activity";
const SUB_RIDERS = "riders";
const SUB_AGREEMENTS = "agreements";
const SUB_CREW = "crew";
const SUB_SCHEDULE = "schedule";
const SUB_PARTICIPANTS = "participants";
const SUB_BUDGETS = "budgets";
const SUB_MESSAGES = "messages";
const SUB_COLLABORATORS = "collaborators";
const SUB_META = "meta";

// Profile subcollections
const PROFILE_TEMPLATES = "templates";

// ── Utilities ─────────────────────────────────────────────────────────────────

function requireUid(): string {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) throw new Error("You must be signed in to sync this data.");
  return uid;
}

function userDataCol(uid: string, name: string) {
  return collection(getFirestoreDb(), USERS, uid, name);
}

function userDataDoc(uid: string, name: string, id: string) {
  return doc(getFirestoreDb(), USERS, uid, name, id);
}

function eventDoc(eventId: string) {
  return doc(getFirestoreDb(), TOP_EVENTS, eventId);
}

function eventSubDoc(eventId: string, sub: string, docId: string) {
  return doc(getFirestoreDb(), TOP_EVENTS, eventId, sub, docId);
}

function eventSubCol(eventId: string, sub: string) {
  return collection(getFirestoreDb(), TOP_EVENTS, eventId, sub);
}

async function fetchEventSubdoc<T>(eventId: string, subcollection: string): Promise<T | null> {
  const snap = await getDoc(eventSubDoc(eventId, subcollection, "main"));
  if (!snap.exists()) return null;
  return snap.data() as T;
}

async function upsertEventSubdoc<T extends object>(
  eventId: string,
  subcollection: string,
  data: T,
): Promise<void> {
  await safeSetDoc(
    eventSubDoc(eventId, subcollection, "main"),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

async function fetchEventSubcollectionArray<T>(
  eventId: string,
  subcollection: string,
): Promise<(T & { id: string })[]> {
  const snap = await getDocs(eventSubCol(eventId, subcollection));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T & { id: string });
}

function stripUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ── Profile doc helpers (re-exported for consumers) ───────────────────────────


// ── User Settings ─────────────────────────────────────────────────────────────

export type DateFormatOption = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
export type TimeFormatOption = "24h" | "12h";

export interface UserSettings {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  initials?: string;
  avatarUrl?: string;
  roles?: OperatorRole[];
  currency?: string;
  default_role?: string;
  company_name?: string;
  country?: string;
  dateFormat?: DateFormatOption;
  timeFormat?: TimeFormatOption;
}

export async function fetchUserSettings(): Promise<UserSettings | null> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return null;
  const ref = doc(getFirestoreDb(), USERS, uid, "settings", "main");
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as UserSettings) : null;
}

export async function upsertUserSettings(settings: {
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  initials: string;
  roles: OperatorRole[];
  currency?: string;
  defaultRole?: string;
  companyName?: string;
  avatarUrl?: string;
  country?: string;
  dateFormat?: DateFormatOption;
  timeFormat?: TimeFormatOption;
}) {
  const uid = requireUid();
  const ref = doc(getFirestoreDb(), USERS, uid, "settings", "main");
  await safeSetDoc(
    ref,
    {
      ...settings,
      default_role: settings.defaultRole || "",
      company_name: settings.companyName || "",
      avatarUrl: settings.avatarUrl || null,
      dateFormat: settings.dateFormat || "YYYY-MM-DD",
      timeFormat: settings.timeFormat || "24h",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// ── Profiles ──────────────────────────────────────────────────────────────────

function profileSlotFromDocId(ownerUid: string, docId: string): string {
  const prefix = `${ownerUid}__`;
  return docId.startsWith(prefix) ? docId.slice(prefix.length) : docId;
}

export async function fetchProfiles(): Promise<Record<string, SharedProfile>> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return {};
  const result: Record<string, SharedProfile> = {};

  // Profiles owned by this user
  const ownedQ = query(
    collection(getFirestoreDb(), PROFILE_COLLECTION),
    where("owner_uid", "==", uid),
  );
  const ownedSnap = await getDocs(ownedQ);
  ownedSnap.forEach((d) => {
    const raw = d.data() as Record<string, unknown>;
    const owner_uid = typeof raw.owner_uid === "string" ? raw.owner_uid : uid;
    const slot =
      (typeof raw.slot === "string" && raw.slot) ||
      profileSlotFromDocId(owner_uid, d.id);
    result[slot] = { ...raw, id: d.id } as unknown as SharedProfile;
  });

  // Profiles where this user is a member (shared/team profiles)
  try {
    const memberSnap = await getDocs(
      query(
        collectionGroup(getFirestoreDb(), PROFILE_MEMBERS_SUBCOLLECTION),
        where("user_uid", "==", uid),
      ),
    );
    await Promise.all(
      memberSnap.docs.map(async (d) => {
        const profileRef = d.ref.parent.parent;
        if (!profileRef || !profileRef.path.startsWith(`${PROFILE_COLLECTION}/`)) return;
        const profileSnap = await getDoc(profileRef);
        if (!profileSnap.exists()) return;
        const raw = profileSnap.data() as Record<string, unknown>;
        const owner_uid = typeof raw.owner_uid === "string" ? raw.owner_uid : "";
        const slot =
          (typeof raw.slot === "string" && raw.slot) ||
          (owner_uid ? profileSlotFromDocId(owner_uid, profileSnap.id) : profileSnap.id);
        if (result[slot]) return;
        result[slot] = { ...raw, id: profileSnap.id } as unknown as SharedProfile;
      }),
    );
  } catch {
    // Collection-group query may fail in some emulator configs; owned profiles still load.
  }

  return result;
}

/** Public profile lookup by URL slug (unauthenticated). */
export async function fetchPublicProfileBySlug(
  slug: string,
): Promise<{ slot: string; profile: SharedProfile; owner_uid: string } | null> {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  const q = query(
    collection(getFirestoreDb(), PROFILE_COLLECTION),
    where("isPublic", "==", true),
    where("slug", "==", trimmed),
    limit(1),
  );
  const snap = await getDocs(q);
  const d = snap.docs[0];
  if (!d) return null;
  const raw = d.data() as Record<string, unknown>;
  const owner_uid = typeof raw.owner_uid === "string" ? raw.owner_uid : "";
  if (!owner_uid) return null;
  const slot =
    (typeof raw.slot === "string" && raw.slot) || profileSlotFromDocId(owner_uid, d.id);
  return { slot, profile: { ...raw, id: d.id } as unknown as SharedProfile, owner_uid };
}

export interface ArtistProfileResult {
  id: string;
  name: string;
  locations?: ProfileLocation[];
  genres?: string[];
  avatarUrl?: string;
}

export async function searchArtistProfiles(
  term: string,
  pageSize: number,
  cursor: QueryDocumentSnapshot | null,
): Promise<{ profiles: ArtistProfileResult[]; lastDoc: QueryDocumentSnapshot | null; hasMore: boolean }> {
  const db = getFirestoreDb();
  const trimmed = term.trim();

  if (!trimmed) {
    // No search term — return all public artist profiles
    const q = query(
      collection(db, PROFILE_COLLECTION),
      where("type", "==", "performer"),
      where("isPublic", "==", true),
      orderBy("name"),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageSize + 1),
    );
    const snap = await getDocs(q);
    const hasMore = snap.size > pageSize;
    const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
    return { profiles: docs.map(docToArtistProfile), lastDoc: docs[docs.length - 1] ?? null, hasMore };
  }

  // Firestore range queries are case-sensitive, so search multiple
  // casing variants to cover common patterns like "test art" → "Test Art".
  const titleCase = trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
  const variants = new Set([
    trimmed,
    trimmed.charAt(0).toUpperCase() + trimmed.slice(1),
    titleCase,
    trimmed.toLowerCase(),
  ]);

  const allDocs: QueryDocumentSnapshot[] = [];
  for (const variant of variants) {
    const q = query(
      collection(db, PROFILE_COLLECTION),
      where("type", "==", "performer"),
      where("isPublic", "==", true),
      where("name", ">=", variant),
      where("name", "<=", variant + "\uf8ff"),
      orderBy("name"),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageSize + 1),
    );
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      if (!allDocs.some((existing) => existing.id === d.id)) {
        allDocs.push(d);
      }
    }
  }

  // Sort by name and apply page size
  allDocs.sort((a, b) => (a.data().name as string).localeCompare(b.data().name as string));
  const hasMore = allDocs.length > pageSize;
  const docs = hasMore ? allDocs.slice(0, pageSize) : allDocs;

  return {
    profiles: docs.map(docToArtistProfile),
    lastDoc: docs[docs.length - 1] ?? null,
    hasMore,
  };
}

function docToArtistProfile(d: QueryDocumentSnapshot): ArtistProfileResult {
  const data = d.data();
  return {
    id: d.id,
    name: typeof data.name === "string" ? data.name : "",
    locations: Array.isArray(data.locations) ? (data.locations as ProfileLocation[]) : undefined,
    genres: Array.isArray(data.genres) ? (data.genres as string[]) : undefined,
    avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : undefined,
  };
}

export async function upsertProfile(role: string, profile: SharedProfile) {
  const uid = requireUid();
  const profileId = profile.id || doc(collection(getFirestoreDb(), PROFILE_COLLECTION)).id;
  const ref = profileDocumentRef(profileId);
  const { id: _stripId, ...profileData } = profile;
  await safeSetDoc(
    ref,
    {
      ...profileData,
      type: profile.role ?? role,
      owner_uid: uid,
      slot: role,
      schemaVersion: PROFILE_ROOT_SCHEMA_VERSION,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await ensureProfileOwnerMember(profileId, uid);
}

export async function deleteProfile(profileId: string) {
  await deleteAllProfileMembers(profileId);
  await deleteDoc(profileDocumentRef(profileId));
}

// ── Profile Members ───────────────────────────────────────────────────────────

const PROFILE_INVITES = "profileInvites";

/** Returns a deterministic doc ID for a profile invite: `{profileId}_{email}`. */
function profileInviteDocId(profileId: string, email: string): string {
  return `${profileId}_${email}`;
}

export interface ProfileMemberInfo {
  uid: string;
  role: import("@/lib/profiles").ProfileMemberRole;
  email?: string;
  displayName?: string;
}

export async function fetchProfileMembers(profileId: string): Promise<ProfileMemberInfo[]> {
  const snap = await getDocs(
    collection(getFirestoreDb(), PROFILE_COLLECTION, profileId, PROFILE_MEMBERS_SUBCOLLECTION),
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      uid: d.id,
      role: data.role as import("@/lib/profiles").ProfileMemberRole,
      email: typeof data.email === "string" ? data.email : undefined,
      displayName: typeof data.displayName === "string" ? data.displayName : undefined,
    };
  });
}

/**
 * Read the owner_uid from a public profile document.
 * Unlike fetchProfileMembers, this doesn't require being a member of the profile.
 */
export async function fetchProfileOwnerUid(profileId: string): Promise<string | null> {
  const snap = await getDoc(doc(getFirestoreDb(), PROFILE_COLLECTION, profileId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return typeof data.owner_uid === "string" ? data.owner_uid : null;
}

export interface ProfilePreviewData {
  id: string;
  name: string;
  type: string;
  avatarUrl?: string;
  slug?: string;
  city?: string;
  country?: string;
  isPublic?: boolean;
}

export async function fetchProfilePreview(profileId: string): Promise<ProfilePreviewData | null> {
  const snap = await getDoc(doc(getFirestoreDb(), PROFILE_COLLECTION, profileId));
  if (!snap.exists()) return null;
  const data = snap.data();
  const locations = Array.isArray(data.locations) ? data.locations : [];
  const primary = locations[0] as { city?: string; country?: string } | undefined;
  return {
    id: snap.id,
    name: typeof data.name === "string" ? data.name : "",
    type: typeof data.type === "string" ? data.type : "",
    avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : undefined,
    slug: typeof data.slug === "string" ? data.slug : undefined,
    city: primary?.city,
    country: primary?.country,
    isPublic: data.isPublic === true,
  };
}

export async function setProfileMemberRole(
  profileId: string,
  memberUid: string,
  role: "admin" | "editor",
) {
  await safeSetDoc(
    doc(getFirestoreDb(), PROFILE_COLLECTION, profileId, PROFILE_MEMBERS_SUBCOLLECTION, memberUid),
    { role, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function removeProfileMember(profileId: string, memberUid: string) {
  await deleteDoc(
    doc(getFirestoreDb(), PROFILE_COLLECTION, profileId, PROFILE_MEMBERS_SUBCOLLECTION, memberUid),
  );
}

export async function inviteProfileAdmin(
  profileId: string,
  profileName: string,
  email: string,
  role: "admin" | "editor",
): Promise<void> {
  const uid = requireUid();
  const inviteId = profileInviteDocId(profileId, email.toLowerCase().trim());
  await safeSetDoc(doc(getFirestoreDb(), PROFILE_INVITES, inviteId), {
    profileId,
    profileName,
    email: email.toLowerCase().trim(),
    role,
    invitedAt: new Date().toISOString(),
    invitedByUid: uid,
  });
}

export async function cancelProfileInvite(profileId: string, email: string): Promise<void> {
  const inviteId = profileInviteDocId(profileId, email.toLowerCase().trim());
  await deleteDoc(doc(getFirestoreDb(), PROFILE_INVITES, inviteId));
}

export async function fetchProfileInvites(
  profileId: string,
): Promise<import("@/lib/profiles").ProfileInviteRecord[]> {
  const snap = await getDocs(
    query(
      collection(getFirestoreDb(), PROFILE_INVITES),
      where("profileId", "==", profileId),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as import("@/lib/profiles").ProfileInviteRecord);
}

/**
 * Called on login: finds all pending profile invites for this email, creates the
 * member doc (using the self-claim Firestore rule), then deletes the invite.
 */
export async function claimProfileInvites(
  userEmail: string,
  displayName: string,
): Promise<number> {
  const uid = requireUid();
  const normalizedEmail = userEmail.toLowerCase().trim();

  const snap = await getDocs(
    query(
      collection(getFirestoreDb(), PROFILE_INVITES),
      where("email", "==", normalizedEmail),
    ),
  );
  if (snap.empty) return 0;

  let claimed = 0;
  for (const inviteDoc of snap.docs) {
    const invite = inviteDoc.data() as import("@/lib/profiles").ProfileInviteRecord;
    try {
      // Create member doc first (self-claim rule checks invite existence)
      await safeSetDoc(
        doc(getFirestoreDb(), PROFILE_COLLECTION, invite.profileId, PROFILE_MEMBERS_SUBCOLLECTION, uid),
        {
          user_uid: uid,
          role: invite.role,
          email: normalizedEmail,
          displayName,
          schemaVersion: 1,
          updatedAt: serverTimestamp(),
        },
      );
      // Then delete the invite
      await deleteDoc(inviteDoc.ref);
      claimed++;
    } catch {
      // Non-fatal — invite might have been cancelled or already claimed
    }
  }
  return claimed;
}

// ── Profile Templates ─────────────────────────────────────────────────────────

function profileTemplateCol(profileId: string, category: string) {
  return collection(
    getFirestoreDb(),
    PROFILE_COLLECTION,
    profileId,
    PROFILE_TEMPLATES,
    category,
    "items",
  );
}

export async function fetchProfileTemplates(profileId: string, category: string): Promise<Record<string, unknown>[]> {
  const snap = await getDocs(profileTemplateCol(profileId, category));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) =>
      String((b as Record<string, unknown>).created_at || "").localeCompare(String((a as Record<string, unknown>).created_at || "")),
    );
}

export async function upsertProfileTemplate(
  profileId: string,
  category: string,
  id: string,
  data: Record<string, unknown>,
) {
  const ref = doc(profileTemplateCol(profileId, category), id);
  await safeSetDoc(ref, { ...data, updated_at: serverTimestamp() }, { merge: true });
}

export async function deleteProfileTemplate(profileId: string, category: string, id: string) {
  await deleteDoc(doc(profileTemplateCol(profileId, category), id));
}

// ── Budget templates (profile-scoped) ────────────────────────────────────────

export async function fetchBudgetTemplates(profileId: string): Promise<Record<string, unknown>[]> {
  return fetchProfileTemplates(profileId, "budgets");
}

export async function insertBudgetTemplate(
  profileId: string,
  row: {
    name: string;
    type: string;
    revenue_fields: unknown;
    cost_fields: unknown;
    result_fields: unknown;
  },
) {
  const id = crypto.randomUUID();
  await upsertProfileTemplate(profileId, "budgets", id, {
    ...row,
    created_at: new Date().toISOString(),
  });
}

export async function deleteBudgetTemplate(profileId: string, id: string) {
  await deleteProfileTemplate(profileId, "budgets", id);
}

// ── Deal templates (profile-scoped) ──────────────────────────────────────────

export async function fetchDealTemplates(profileId: string): Promise<Record<string, unknown>[]> {
  return fetchProfileTemplates(profileId, "deals");
}

export async function insertDealTemplate(
  profileId: string,
  row: {
    name: string;
    dealType: string;
    artistGuarantee: number;
    artistSplit: number;
    promoterSplit: number;
    venueSplit: number;
    organizerSplit?: number;
    venueRental: number;
    commissions: unknown[];
    performanceBonusThreshold?: number;
    performanceBonusAmount?: number;
  },
) {
  const id = crypto.randomUUID();
  await upsertProfileTemplate(profileId, "deals", id, {
    ...row,
    created_at: new Date().toISOString(),
  });
}

export async function deleteDealTemplate(profileId: string, id: string) {
  await deleteProfileTemplate(profileId, "deals", id);
}

// ── Rider templates (profile-scoped) ─────────────────────────────────────────

export async function fetchRiderTemplates(profileId: string): Promise<Record<string, unknown>[]> {
  return fetchProfileTemplates(profileId, "riders");
}

export async function insertRiderTemplate(
  profileId: string,
  row: { name: string; riders: unknown[] },
) {
  const id = crypto.randomUUID();
  await upsertProfileTemplate(profileId, "riders", id, {
    ...row,
    created_at: new Date().toISOString(),
  });
}

export async function deleteRiderTemplate(profileId: string, id: string) {
  await deleteProfileTemplate(profileId, "riders", id);
}

// ── Terms templates (profile-scoped) ─────────────────────────────────────────

export async function fetchTermsTemplates(profileId: string): Promise<Record<string, unknown>[]> {
  return fetchProfileTemplates(profileId, "terms");
}

export async function insertTermsTemplate(
  profileId: string,
  row: { name: string; termsText: string },
) {
  const id = crypto.randomUUID();
  await upsertProfileTemplate(profileId, "terms", id, {
    ...row,
    created_at: new Date().toISOString(),
  });
}

export async function deleteTermsTemplate(profileId: string, id: string) {
  await deleteProfileTemplate(profileId, "terms", id);
}

// ── Profile Team Members ──────────────────────────────────────────────────────

const PROFILE_TEAM = "team";

function teamDocToMember(d: QueryDocumentSnapshot, profileId: string): TeamMember {
  const r = d.data() as Record<string, unknown>;
  return {
    id: d.id,
    name: (r.name as string) || "",
    email: (r.email as string) || "",
    roles: Array.isArray(r.roles) ? (r.roles as string[]) : ["Member"],
    status: r.status === "inactive" ? "inactive" : "active",
    phone: (r.phone as string) || "",
    notes: (r.notes as string) || "",
    profileId,
  };
}

export async function fetchProfileTeamMembers(profileId: string): Promise<TeamMember[]> {
  const snap = await getDocs(
    collection(getFirestoreDb(), PROFILE_COLLECTION, profileId, PROFILE_TEAM),
  );
  return snap.docs.map((d) => teamDocToMember(d, profileId));
}

/**
 * Loads team members from all profiles owned by the user (the flat array used
 * throughout the app). Each member has `profileId` set.
 */
export async function fetchAllProfileTeamMembers(
  uid: string,
  profiles: Record<string, import("./user-context").SharedProfile>,
): Promise<TeamMember[]> {
  if (!uid || Object.keys(profiles).length === 0) return [];
  const results = await Promise.all(
    Object.entries(profiles)
      .filter(([, p]) => p.id && (p.owner_uid === uid))
      .map(([, p]) => {
        return fetchProfileTeamMembers(p.id!).catch(() => [] as TeamMember[]);
      }),
  );
  return results.flat();
}

export async function upsertProfileTeamMember(profileId: string, member: TeamMember) {
  await safeSetDoc(
    doc(getFirestoreDb(), PROFILE_COLLECTION, profileId, PROFILE_TEAM, member.id),
    {
      name: member.name,
      email: member.email,
      roles: member.roles,
      status: member.status,
      phone: member.phone || "",
      notes: member.notes || "",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function deleteProfileTeamMember(profileId: string, memberId: string) {
  await deleteDoc(
    doc(getFirestoreDb(), PROFILE_COLLECTION, profileId, PROFILE_TEAM, memberId),
  );
}

// ── Events ────────────────────────────────────────────────────────────────────

function eventRowToEvent(r: Record<string, unknown>): Event {
  const id = r.id as string;
  return {
    id,
    name: r.name as string,
    date: r.date as string,
    startTime: r.startTime as string | undefined,
    endTime: r.endTime as string | undefined,
    doorTime: r.doorTime as string | undefined,
    curfew: r.curfew as string | undefined,
    venue: r.venue as string,
    operator: r.operator as string,
    operatorType: r.operatorType as Event["operatorType"],
    ticketingProvider: r.ticketingProvider as string,
    capacity: r.capacity as number,
    artist: r.artist as string,
    eventStatus: r.eventStatus as Event["eventStatus"],
    status: r.status as Event["status"],
    archived: Boolean(r.archived),
    published: Boolean(r.published),
    hostProfileId: typeof r.hostProfileId === "string" ? r.hostProfileId : undefined,
    accessProfileIds: Array.isArray(r.accessProfileIds) ? (r.accessProfileIds as string[]) : undefined,
    accessUids: Array.isArray(r.accessUids) ? (r.accessUids as string[]) : undefined,
    performerProfileId: typeof r.performerProfileId === "string" ? r.performerProfileId : undefined,
    isMultiPerformer: Boolean(r.isMultiPerformer),
    parentEventId: typeof r.parentEventId === "string" ? r.parentEventId : undefined,
    childEventIds: Array.isArray(r.childEventIds) ? (r.childEventIds as string[]) : [],
    roomStage: r.roomStage as string | undefined,
    stageCapacity: typeof r.stageCapacity === "number" ? r.stageCapacity : undefined,
    performerResponse: typeof r.performerResponse === "string" ? r.performerResponse as Event["performerResponse"] : undefined,
    holdRank: typeof r.holdRank === "number" ? r.holdRank : undefined,
    // Legacy fields — kept during transition
    owner_uid: typeof r.owner_uid === "string" ? r.owner_uid : undefined,
    primary_owner_uid: typeof r.primary_owner_uid === "string" ? r.primary_owner_uid : undefined,
    participant_uids: Array.isArray(r.participant_uids) ? (r.participant_uids as string[]) : undefined,
  };
}

function eventToFirestoreRow(event: Event): Record<string, unknown> {
  return {
    id: event.id,
    name: event.name,
    date: event.date,
    startTime: event.startTime ?? null,
    endTime: event.endTime ?? null,
    doorTime: event.doorTime ?? null,
    curfew: event.curfew ?? null,
    venue: event.venue,
    operator: event.operator,
    operatorType: event.operatorType,
    ticketingProvider: event.ticketingProvider,
    capacity: event.capacity,
    artist: event.artist,
    eventStatus: event.eventStatus,
    status: event.status,
    archived: event.archived || false,
    published: event.published || false,
    hostProfileId: event.hostProfileId ?? null,
    accessProfileIds: event.accessProfileIds ?? [],
    accessUids: event.accessUids ?? [],
    performerProfileId: event.performerProfileId ?? null,
    isMultiPerformer: event.isMultiPerformer || false,
    parentEventId: event.parentEventId ?? null,
    childEventIds: event.childEventIds ?? [],
    roomStage: event.roomStage ?? null,
    stageCapacity: event.stageCapacity ?? null,
    performerResponse: event.performerResponse ?? null,
    holdRank: event.holdRank ?? null,
    sourceRequestId: event.sourceRequestId ?? null,
    sourceRequestDate: event.sourceRequestDate ?? null,
    updatedAt: serverTimestamp(),
  };
}

/**
 * Fetch all events accessible to the current user.
 * Queries by accessUids (which includes host profile members + direct collaborators).
 */
export async function fetchEvents(profileIds?: string[]): Promise<Event[]> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return [];
  const byId = new Map<string, Event>();

  // Primary query: uid is in the denormalized accessUids array
  const accessQ = query(
    collection(getFirestoreDb(), TOP_EVENTS),
    where("accessUids", "array-contains", uid),
    orderBy("date", "desc"),
  );
  try {
    const snap = await getDocs(accessQ);
    snap.forEach((d) => {
      byId.set(d.id, eventRowToEvent({ id: d.id, ...d.data() }));
    });
  } catch {
    // Index may not exist yet; fallback below.
  }

  // Fallback: events where this uid is the legacy owner_uid
  const legacyOwnerQ = query(
    collection(getFirestoreDb(), TOP_EVENTS),
    where("owner_uid", "==", uid),
    orderBy("date", "desc"),
  );
  try {
    const snap = await getDocs(legacyOwnerQ);
    snap.forEach((d) => {
      if (!byId.has(d.id)) byId.set(d.id, eventRowToEvent({ id: d.id, ...d.data() }));
    });
  } catch {
    // Ignore — primary query already ran.
  }

  // Fallback: events where a user's profile is in accessProfileIds but uid wasn't in accessUids
  if (profileIds && profileIds.length > 0) {
    // array-contains-any supports up to 30 values
    const chunks = [];
    for (let i = 0; i < profileIds.length; i += 30) {
      chunks.push(profileIds.slice(i, i + 30));
    }
    for (const chunk of chunks) {
      try {
        const profileQ = query(
          collection(getFirestoreDb(), TOP_EVENTS),
          where("accessProfileIds", "array-contains-any", chunk),
          orderBy("date", "desc"),
        );
        const snap = await getDocs(profileQ);
        snap.forEach((d) => {
          if (!byId.has(d.id)) {
            byId.set(d.id, eventRowToEvent({ id: d.id, ...d.data() }));
            // Repair: add uid to accessUids so future queries find it
            updateDoc(d.ref, { accessUids: arrayUnion(uid) }).catch(() => {});
          }
        });
      } catch {
        // Index may not exist yet
      }
    }
  }

  return Array.from(byId.values()).filter(e => isDraftVisibleToUser(e, uid, profileIds));
}

/**
 * Determines whether a draft event should be visible to the current user.
 * Non-draft events always pass. Drafts pass if the user has direct uid access
 * (accessUids contains uid or owner_uid matches), or if they own the host
 * profile via profileIds. The direct-uid check guards against a load-order race
 * where the events query fires before profiles are hydrated into context.
 */
export function isDraftVisibleToUser(
  e: Pick<Event, "eventStatus" | "hostProfileId" | "accessUids" | "owner_uid">,
  uid: string | undefined,
  profileIds?: string[],
): boolean {
  if (e.eventStatus !== "draft") return true;
  if (uid && (e.accessUids?.includes(uid) || e.owner_uid === uid)) return true;
  if (!e.hostProfileId) return true;
  const myPids = new Set(profileIds || []);
  return myPids.has(e.hostProfileId);
}

/**
 * Paginated event fetch for list views.
 * Returns one page of events ordered by date descending, with a Firestore cursor.
 */
export interface EventPageFilters {
  status?: string;
  sortField?: "date" | "artist" | "venue";
  sortDir?: "asc" | "desc";
}

/**
 * Fetch all events within a date range (inclusive).
 * Used by the calendar to load only the visible window.
 */
export async function fetchEventsInRange(
  dateFrom: string,
  dateTo: string,
): Promise<Event[]> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return [];

  const constraints = [
    where("accessUids", "array-contains", uid),
    where("date", ">=", dateFrom),
    where("date", "<=", dateTo),
    orderBy("date", "asc"),
  ];

  try {
    const snap = await getDocs(query(collection(getFirestoreDb(), TOP_EVENTS), ...constraints));
    return snap.docs.map((d) => eventRowToEvent({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function fetchEventPage(
  pageSize: number,
  cursor: QueryDocumentSnapshot | null,
  filters?: EventPageFilters,
  profileIds?: string[],
): Promise<{ events: Event[]; lastDoc: QueryDocumentSnapshot | null; hasMore: boolean }> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return { events: [], lastDoc: null, hasMore: false };

  const sortField = filters?.sortField ?? "date";
  const sortDirection = filters?.sortDir ?? "desc";

  const constraints = [
    where("accessUids", "array-contains", uid),
    ...(filters?.status ? [where("eventStatus", "==", filters.status)] : []),
    orderBy(sortField, sortDirection),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(pageSize + 1),
  ];

  // On first page, also check for events reachable via profile but missing from accessUids
  if (!cursor && profileIds && profileIds.length > 0) {
    for (const chunk of chunkArray(profileIds, 30)) {
      try {
        const profileQ = query(
          collection(getFirestoreDb(), TOP_EVENTS),
          where("accessProfileIds", "array-contains-any", chunk),
          orderBy("date", "desc"),
          limit(200),
        );
        const snap = await getDocs(profileQ);
        snap.forEach((d) => {
          const data = d.data();
          const uids: string[] = Array.isArray(data.accessUids) ? data.accessUids : [];
          if (!uids.includes(uid)) {
            updateDoc(d.ref, { accessUids: arrayUnion(uid) }).catch(() => {});
          }
        });
      } catch { /* index may not exist */ }
    }
  }

  try {
    const snap = await getDocs(query(collection(getFirestoreDb(), TOP_EVENTS), ...constraints));
    const hasMore = snap.size > pageSize;
    const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;

    const events = docs
      .map((d) => eventRowToEvent({ id: d.id, ...d.data() }))
      .filter(e => isDraftVisibleToUser(e, uid, profileIds));

    return {
      events,
      lastDoc: docs[docs.length - 1] ?? null,
      hasMore,
    };
  } catch {
    // Index may not exist; return empty page
    return { events: [], lastDoc: null, hasMore: false };
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/** Published confirmed events for public calendars. */
export async function fetchPublishedEvents(limitCount = 50): Promise<Event[]> {
  const q = query(
    collection(getFirestoreDb(), TOP_EVENTS),
    where("published", "==", true),
    where("eventStatus", "==", "confirmed"),
    orderBy("date", "desc"),
    limit(limitCount),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => eventRowToEvent({ id: d.id, ...d.data() }))
    .filter((e) => !e.archived);
}

export async function upsertEvent(event: Event) {
  const uid = requireUid();
  const ref = eventDoc(event.id);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data() as Record<string, unknown>) : {};

  // Preserve and extend accessUids — always include current uid
  const existingUids: string[] = Array.isArray(existing.accessUids)
    ? (existing.accessUids as string[])
    : [];
  const accessUids = Array.from(new Set([...existingUids, uid]));
  if (event.accessUids) {
    for (const u of event.accessUids) accessUids.push(u);
  }

  // Preserve and extend accessProfileIds
  const existingPids: string[] = Array.isArray(existing.accessProfileIds)
    ? (existing.accessProfileIds as string[])
    : [];
  const accessProfileIds = Array.from(
    new Set([...existingPids, ...(event.accessProfileIds ?? [])]),
  );
  if (event.hostProfileId && !accessProfileIds.includes(event.hostProfileId)) {
    accessProfileIds.push(event.hostProfileId);
  }

  await safeSetDoc(
    ref,
    {
      ...eventToFirestoreRow(event),
      accessUids: Array.from(new Set(accessUids)),
      accessProfileIds,
      // Preserve legacy field for rules compatibility
      owner_uid: (existing.owner_uid as string) || uid,
      primary_owner_uid: (existing.primary_owner_uid as string) || uid,
    },
    { merge: true },
  );
}

// ── Deal ──────────────────────────────────────────────────────────────────────

export async function fetchDeal(eventId: string): Promise<DealStructure | null> {
  return fetchEventSubdoc<DealStructure>(eventId, SUB_DEAL);
}

export async function upsertDeal(eventId: string, deal: DealStructure) {
  return upsertEventSubdoc(eventId, SUB_DEAL, deal);
}

// ── Revenue ───────────────────────────────────────────────────────────────────

export async function fetchRevenue(eventId: string): Promise<TicketRevenue | null> {
  return fetchEventSubdoc<TicketRevenue>(eventId, SUB_REVENUE);
}

export async function upsertRevenue(eventId: string, revenue: TicketRevenue) {
  return upsertEventSubdoc(eventId, SUB_REVENUE, revenue);
}

// ── Settlement ────────────────────────────────────────────────────────────────

export async function fetchSettlement(eventId: string): Promise<Settlement | null> {
  return fetchEventSubdoc<Settlement>(eventId, SUB_SETTLEMENT);
}

export async function upsertSettlement(eventId: string, settlement: Settlement) {
  return upsertEventSubdoc(eventId, SUB_SETTLEMENT, settlement);
}

// ── Settlement Activity ───────────────────────────────────────────────────────

// Debounce registry: key → pending timer. Collapses rapid identical writes.
const _activityDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ACTIVITY_DEBOUNCE_MS = 2000;

export function appendSettlementActivity(
  eventId: string,
  type: SettlementActivityType,
  by: string,
  details?: Record<string, string>,
  onWritten?: () => void,
  profile?: string,
): void {
  const doWrite = () =>
    void addDoc(eventSubCol(eventId, SUB_ACTIVITY), {
      type, by, details: details ?? {},
      ...(profile ? { profile } : {}),
      timestamp: new Date().toISOString(),
      createdAt: serverTimestamp(),
    }).then(() => onWritten?.());

  // Only debounce high-frequency writes; discrete events fire immediately.
  const debounced = type === "revenue_updated" || type === "deal_updated";
  const key = `${eventId}:${type}`;

  if (debounced) {
    const existing = _activityDebounceTimers.get(key);
    if (existing) clearTimeout(existing);
    _activityDebounceTimers.set(key, setTimeout(() => {
      _activityDebounceTimers.delete(key);
      doWrite();
    }, ACTIVITY_DEBOUNCE_MS));
  } else {
    doWrite();
  }
}

export async function fetchSettlementActivity(eventId: string): Promise<SettlementActivity[]> {
  const q = query(eventSubCol(eventId, SUB_ACTIVITY), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    type: d.data().type as SettlementActivityType,
    timestamp: d.data().timestamp as string,
    by: d.data().by as string,
    ...(d.data().profile ? { profile: d.data().profile as string } : {}),
    details: (d.data().details ?? {}) as Record<string, string>,
  }));
}

// ── Event Activity ────────────────────────────────────────────────────────────

export function appendEventActivity(
  eventId: string,
  type: EventActivityType,
  by: string,
  details?: Record<string, string>,
  onWritten?: () => void,
  profile?: string,
  visibility?: "all" | "operator_only",
): void {
  void addDoc(eventSubCol(eventId, SUB_EVENT_ACTIVITY), {
    type, by, details: details ?? {},
    ...(profile ? { profile } : {}),
    ...(visibility && visibility !== "all" ? { visibility } : {}),
    timestamp: new Date().toISOString(),
    createdAt: serverTimestamp(),
  }).then(() => onWritten?.());
}

export async function fetchEventActivity(eventId: string): Promise<EventActivity[]> {
  const q = query(eventSubCol(eventId, SUB_EVENT_ACTIVITY), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    type: d.data().type as EventActivityType,
    timestamp: d.data().timestamp as string,
    by: d.data().by as string,
    ...(d.data().profile ? { profile: d.data().profile as string } : {}),
    details: (d.data().details ?? {}) as Record<string, string>,
    ...(d.data().visibility ? { visibility: d.data().visibility as "all" | "operator_only" } : {}),
  }));
}

// ── Riders ────────────────────────────────────────────────────────────────────

export async function fetchRiders(eventId: string): Promise<Rider[]> {
  return fetchEventSubcollectionArray<Rider>(eventId, SUB_RIDERS);
}

export async function upsertRider(eventId: string, rider: Rider) {
  await safeSetDoc(
    eventSubDoc(eventId, SUB_RIDERS, rider.id),
    { ...rider, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function deleteRider(eventId: string, riderId: string) {
  await deleteDoc(eventSubDoc(eventId, SUB_RIDERS, riderId));
}

// ── Agreements ────────────────────────────────────────────────────────────────

export async function fetchAgreements(eventId: string): Promise<Agreement[]> {
  return fetchEventSubcollectionArray<Agreement>(eventId, SUB_AGREEMENTS);
}

export async function upsertAgreement(eventId: string, agreement: Agreement) {
  await safeSetDoc(
    eventSubDoc(eventId, SUB_AGREEMENTS, agreement.id),
    { ...agreement, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function deleteAgreement(eventId: string, agreementId: string) {
  await deleteDoc(eventSubDoc(eventId, SUB_AGREEMENTS, agreementId));
}

// ── Crew ──────────────────────────────────────────────────────────────────────

export async function fetchCrew(eventId: string): Promise<CrewMember[]> {
  return fetchEventSubcollectionArray<CrewMember>(eventId, SUB_CREW);
}

export async function upsertCrewMember(eventId: string, member: CrewMember) {
  await safeSetDoc(
    eventSubDoc(eventId, SUB_CREW, member.id),
    { ...member, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function deleteCrewMember(eventId: string, memberId: string) {
  await deleteDoc(eventSubDoc(eventId, SUB_CREW, memberId));
}

// ── Schedule ──────────────────────────────────────────────────────────────────

export async function fetchSchedule(eventId: string): Promise<ScheduleItem[]> {
  const snap = await getDocs(
    query(eventSubCol(eventId, SUB_SCHEDULE), orderBy("time", "asc")),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ScheduleItem);
}

export async function upsertScheduleItem(eventId: string, item: ScheduleItem) {
  await safeSetDoc(
    eventSubDoc(eventId, SUB_SCHEDULE, item.id),
    { ...item, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function deleteScheduleItem(eventId: string, itemId: string) {
  await deleteDoc(eventSubDoc(eventId, SUB_SCHEDULE, itemId));
}

// ── Event Meta (misc per-event data: amenities, expenses, todos, crew notes, etc.) ─────
// Stored at events/{eventId}/meta/main — replaces the legacy users/{uid}/event_manager path.

export interface AgreementConfirmation {
  party: string;
  confirmedAt: string;
  confirmedBy: string;
  method: string;
  signature: string;
}

export interface AgreementReopenApproval {
  party: string;
  approvedAt: string;
  approvedBy: string;
}

export interface AgreementReopenRequest {
  requestedAt: string;
  requestedBy: string;
  /** The confirmation party the requester represents (empty if requester has no party stake). */
  requestedByParty: string;
  /** Parties whose approval is required to complete the reopen. */
  requiredParties: string[];
  approvals: AgreementReopenApproval[];
}

export interface TodoReminder {
  id: string;
  date: string;
  time: string;
  label?: string;
}

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  completedAt?: string;
  dueDate?: string;
  reminders: TodoReminder[];
  createdAt: string;
  budgetType?: "cost" | "revenue";
  budgetAmount?: number;
  description?: string;
  assignee?: string;
}

export interface DateChangeConfirmation {
  status: "pending" | "confirmed" | "declined";
  respondedAt?: string;
  respondedBy?: string;
  respondedByName?: string;
  role: "performer" | "venue";
  profileName: string;
  onPlatform: boolean;
}

export interface PendingDateChange {
  id: string;
  proposedBy: string;
  proposedByProfile?: string;
  proposedAt: string;
  previousValues: { date?: string; startTime?: string; endTime?: string };
  proposedValues: { date?: string; startTime?: string; endTime?: string };
  confirmations: Record<string, DateChangeConfirmation>;
}

export interface EventMeta {
  // Details tab
  amenities?: string[];
  expenses?: { id: string; label: string; amount: number; currency: string }[];
  guestList?: { enabled: boolean; total: number; names: string[] } | null;
  // Agreement tab
  dealDescription?: string;
  agreementConfirmations?: AgreementConfirmation[];
  agreementLastChangedAt?: string;
  agreementReopenRequest?: AgreementReopenRequest | null;
  // Budget tab
  proEstimate?: ProEstimate;
  budgetProfileId?: string;
  // Crew tab (internal notes/team schedule — distinct from production schedule subcollection)
  privateNotes?: { id: string; text: string; assignee: string }[];
  crewScheduleItems?: { id: string; time: string; label: string; assignee: string }[];
  memberSections?: Record<string, string[]>;
  // Todo tab
  todos?: Todo[];
  // Action item assignees keyed by action item id (e.g. "finalize-{eventId}")
  actionItemAssignees?: Record<string, string>;
  // Date change confirmation flow
  pendingDateChange?: PendingDateChange;
}

export async function fetchEventMeta(eventId: string): Promise<EventMeta> {
  const snap = await getDoc(eventSubDoc(eventId, SUB_META, "main"));
  if (!snap.exists()) return {};
  return snap.data() as EventMeta;
}

export async function upsertEventMeta(eventId: string, data: Partial<EventMeta>) {
  await safeSetDoc(
    eventSubDoc(eventId, SUB_META, "main"),
    { ...stripUndefined(data), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function clearPendingDateChange(eventId: string) {
  await safeSetDoc(
    eventSubDoc(eventId, SUB_META, "main"),
    { pendingDateChange: deleteField(), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

// ── Profile-scoped todos ──────────────────────────────────────────────────────
// Stored at events/{eventId}/meta/todos_{scopeId}
// scopeId = profileId (if user has a profile on this event) or user_{uid}

function todoDocId(scopeId: string) {
  return `todos_${scopeId}`;
}

export async function fetchProfileTodos(eventId: string, scopeId: string): Promise<Todo[]> {
  const snap = await getDoc(eventSubDoc(eventId, SUB_META, todoDocId(scopeId)));
  if (!snap.exists()) return [];
  return (snap.data().todos as Todo[]) || [];
}

export async function upsertProfileTodos(eventId: string, scopeId: string, todos: Todo[]) {
  // Strip undefined values — Firestore rejects them
  const clean = todos.map(t => JSON.parse(JSON.stringify(t)));
  await safeSetDoc(
    eventSubDoc(eventId, SUB_META, todoDocId(scopeId)),
    { todos: clean, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/**
 * Migrate legacy todos from meta/main into a profile-scoped document.
 * Reads meta/main.todos, writes them to the profile doc, then deletes
 * the todos field from meta/main. No-op if meta/main has no todos.
 */
export async function migrateMetaTodosToProfile(eventId: string, scopeId: string): Promise<Todo[]> {
  const metaSnap = await getDoc(eventSubDoc(eventId, SUB_META, "main"));
  if (!metaSnap.exists()) return [];
  const legacyTodos = (metaSnap.data().todos as Todo[]) || [];
  if (legacyTodos.length === 0) return [];

  // Write to profile-scoped doc
  await upsertProfileTodos(eventId, scopeId, legacyTodos);

  // Remove from meta/main
  await safeSetDoc(
    eventSubDoc(eventId, SUB_META, "main"),
    { todos: deleteField(), updatedAt: serverTimestamp() },
    { merge: true },
  );

  return legacyTodos;
}

// ── Event Participants (profiles) ─────────────────────────────────────────────

export interface EventParticipant {
  profileId: string;
  role: string;
  addedAt: string;
  addedBy: string;
}

export async function fetchEventParticipants(eventId: string): Promise<EventParticipant[]> {
  const snap = await getDocs(eventSubCol(eventId, SUB_PARTICIPANTS));
  return snap.docs.map((d) => ({ profileId: d.id, ...d.data() }) as EventParticipant);
}

export async function addEventParticipant(
  eventId: string,
  profileId: string,
  role: string,
  memberUids: string[],
) {
  const uid = requireUid();
  const db = getFirestoreDb();
  const batch = writeBatch(db);

  // Write participant doc
  batch.set(eventSubDoc(eventId, SUB_PARTICIPANTS, profileId), {
    profileId,
    role,
    addedAt: new Date().toISOString(),
    addedBy: uid,
  });

  // Expand profile members into accessUids and track profileId in accessProfileIds
  const evRef = eventDoc(eventId);
  const evSnap = await getDoc(evRef);
  if (evSnap.exists()) {
    const ev = evSnap.data() as Record<string, unknown>;
    const existingUids: string[] = Array.isArray(ev.accessUids) ? (ev.accessUids as string[]) : [];
    const existingPids: string[] = Array.isArray(ev.accessProfileIds) ? (ev.accessProfileIds as string[]) : [];
    const newUids = Array.from(new Set([...existingUids, ...memberUids]));
    const newPids = Array.from(new Set([...existingPids, profileId]));
    batch.update(evRef, {
      accessUids: newUids,
      accessProfileIds: newPids,
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

export async function removeEventParticipant(eventId: string, profileId: string) {
  await deleteDoc(eventSubDoc(eventId, SUB_PARTICIPANTS, profileId));
  // Note: accessUids cleanup requires knowing which uids came from this profile.
  // For now, we leave accessUids as-is (slightly permissive) — a Cloud Function
  // can handle full cleanup later.
}

// ── Budget per profile ─────────────────────────────────────────────────────────

export async function fetchEventBudgetCalculator(
  eventId: string,
  profileDocId: string,
): Promise<BudgetCalculatorPersisted | null> {
  const snap = await getDoc(eventSubDoc(eventId, SUB_BUDGETS, profileDocId));
  if (!snap.exists()) return null;
  const raw = snap.data() as { payload?: BudgetCalculatorPersisted };
  return raw.payload ?? null;
}

export async function saveEventBudgetCalculator(
  eventId: string,
  profileDocId: string,
  payload: BudgetCalculatorPersisted,
): Promise<void> {
  await safeSetDoc(
    eventSubDoc(eventId, SUB_BUDGETS, profileDocId),
    { profileDocId, payload, schemaVersion: 1, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

// ── Collaborators ─────────────────────────────────────────────────────────────

function eventCollaboratorsCol(eventId: string) {
  return eventSubCol(eventId, SUB_COLLABORATORS);
}

function collaboratorUiToFirestore(c: EventCollaborator): Record<string, unknown> {
  return {
    clientId: c.id,
    email: c.email,
    name: c.name,
    eventRole: c.eventRole,
    role: c.role || c.eventRole,
    status: c.status === "accepted" ? "active" : c.status === "invited" ? "pending" : c.status,
    invitedAt: c.invitedAt,
    userUid: c.userUid ?? null,
    profileId: c.profileId ?? null,
    inviteProfileSlug: c.inviteProfileSlug ?? null,
    schemaVersion: 1,
    updatedAt: serverTimestamp(),
  };
}

function collaboratorDocToUi(d: QueryDocumentSnapshot): EventCollaborator {
  const data = d.data() as Record<string, unknown>;
  const id = typeof data.clientId === "string" ? data.clientId : d.id;
  const eventRole =
    (data.eventRole as EventCollaborator["eventRole"]) ||
    legacyRoleToEventRole(String(data.role ?? "staff"));
  return {
    id,
    email: String(data.email ?? ""),
    name: String(data.name ?? ""),
    eventRole,
    role: typeof data.role === "string" ? data.role : undefined,
    status: normalizeCollaboratorStatus(String(data.status ?? "pending")),
    invitedAt: String(data.invitedAt ?? ""),
    userUid: typeof data.userUid === "string" ? data.userUid : undefined,
    profileId: typeof data.profileId === "string" ? data.profileId : undefined,
    inviteProfileSlug:
      typeof data.inviteProfileSlug === "string" ? data.inviteProfileSlug : undefined,
  };
}

/** Add a single collaborator to an event's collaborators subcollection. */
export async function addEventCollaborator(eventId: string, collaborator: EventCollaborator) {
  const ref = doc(eventCollaboratorsCol(eventId), collaborator.id);
  await safeSetDoc(ref, collaboratorUiToFirestore(collaborator));
}

export async function fetchEventCollaborators(eventId: string): Promise<EventCollaborator[]> {
  const snap = await getDocs(eventCollaboratorsCol(eventId));
  const rows = snap.docs.map(collaboratorDocToUi);
  rows.sort((a, b) => a.invitedAt.localeCompare(b.invitedAt));
  return rows;
}

/**
 * Full sync of collaborators for an event.
 * Also updates accessUids on the parent event doc to include all active collaborator uids.
 */
export async function syncEventCollaboratorsFromUi(
  eventId: string,
  hostProfileId: string,
  collabs: EventCollaborator[],
) {
  const db = getFirestoreDb();
  const colRef = eventCollaboratorsCol(eventId);
  const existing = await getDocs(colRef);
  const batch = writeBatch(db);

  existing.forEach((d) => batch.delete(d.ref));
  for (const c of collabs) {
    batch.set(doc(colRef, c.id), collaboratorUiToFirestore(c));
  }

  // Rebuild accessUids: host profile members (caller's uid) + active collaborator uids
  const evRef = eventDoc(eventId);
  const evSnap = await getDoc(evRef);
  if (evSnap.exists()) {
    const ev = evSnap.data() as Record<string, unknown>;
    // Start from existing accessUids to preserve host profile member uids
    const uidSet = new Set<string>(
      Array.isArray(ev.accessUids) ? (ev.accessUids as string[]) : [],
    );
    for (const c of collabs) {
      if (!c.userUid) continue;
      const st = normalizeCollaboratorStatus(String(c.status));
      if (st === "declined" || st === "revoked") continue;
      uidSet.add(c.userUid);
    }
    batch.update(evRef, { accessUids: Array.from(uidSet), updatedAt: serverTimestamp() });
  }

  await batch.commit();
}

// ── Messages ──────────────────────────────────────────────────────────────────

function eventMessagesCol(eventId: string) {
  return eventSubCol(eventId, SUB_MESSAGES);
}

export async function fetchMessagesForEvent(eventId: string): Promise<any[]> {
  const q = query(eventMessagesCol(eventId), orderBy("created_at", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function insertMessage(eventId: string, row: Record<string, unknown>) {
  const sender_uid = requireUid();
  const id = crypto.randomUUID();
  await safeSetDoc(doc(getFirestoreDb(), TOP_EVENTS, eventId, SUB_MESSAGES, id), {
    ...row,
    event_id: eventId,
    sender_uid,
    created_at: new Date().toISOString(),
  });
}

export function subscribeEventMessages(
  eventId: string,
  onRows: (rows: Record<string, unknown>[]) => void,
): () => void {
  const q = query(eventMessagesCol(eventId), orderBy("created_at", "asc"));
  return onSnapshot(q, (snap) => {
    onRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/** Move all messages from one event to another, then delete the originals. */
export async function moveMessages(fromEventId: string, toEventId: string): Promise<number> {
  const snap = await getDocs(eventMessagesCol(fromEventId));
  if (snap.empty) return 0;
  const db = getFirestoreDb();
  const CHUNK = 250; // 250 messages × 2 ops = 500 ops per batch (Firestore max)
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const chunk = snap.docs.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const d of chunk) {
      const data = d.data();
      batch.set(doc(db, TOP_EVENTS, toEventId, SUB_MESSAGES, d.id), {
        ...data,
        event_id: toEventId,
      });
      batch.delete(d.ref);
    }
    await batch.commit();
  }
  return snap.size;
}

// ── Contacts ─────────────────────────────────────────────────────────────────

export interface ContactPageFilters {
  type?: string;
}

export async function fetchContactPage(
  pageSize: number,
  cursor: QueryDocumentSnapshot | null,
  filters?: ContactPageFilters,
): Promise<{ contacts: Contact[]; lastDoc: QueryDocumentSnapshot | null; hasMore: boolean }> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return { contacts: [], lastDoc: null, hasMore: false };

  const constraints = [
    ...(filters?.type ? [where("type", "==", filters.type)] : []),
    orderBy("name", "asc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(pageSize + 1),
  ];

  try {
    const snap = await getDocs(query(userDataCol(uid, "contacts"), ...constraints));
    const hasMore = snap.size > pageSize;
    const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;

    return {
      contacts: docs.map((d) => {
        const r = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          name: r.name as string,
          type: r.type as string,
          contacts: Array.isArray(r.contacts) ? r.contacts : [],
          iban: r.iban as string | undefined,
          bankName: r.bankName as string | undefined,
          vatId: r.vatId as string | undefined,
          address: r.address as string | undefined,
          notes: r.notes as string | undefined,
        };
      }) as Contact[],
      lastDoc: docs[docs.length - 1] ?? null,
      hasMore,
    };
  } catch {
    return { contacts: [], lastDoc: null, hasMore: false };
  }
}

export async function fetchContacts(): Promise<Contact[]> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return [];
  const snap = await getDocs(userDataCol(uid, "contacts"));
  return snap.docs.map((d) => {
    const r = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      name: r.name as string,
      type: r.type as string,
      contacts: Array.isArray(r.contacts) ? r.contacts : [],
      iban: r.iban as string | undefined,
      bankName: r.bankName as string | undefined,
      vatId: r.vatId as string | undefined,
      address: r.address as string | undefined,
      notes: r.notes as string | undefined,
    };
  });
}

export async function upsertContact(contact: Contact) {
  const uid = requireUid();
  await safeSetDoc(
    userDataDoc(uid, "contacts", contact.id),
    { ...contact, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function deleteContactFromDb(id: string) {
  const uid = requireUid();
  await deleteDoc(userDataDoc(uid, "contacts", id));
}

// ── Calendar Items ────────────────────────────────────────────────────────────

function parseCalendarItemDoc(d: QueryDocumentSnapshot, profileId?: string): CalendarItem {
  const r = d.data() as Record<string, unknown>;
  return {
    id: d.id,
    type: r.type as CalendarItem["type"],
    title: r.title as string,
    date: r.date as string,
    description: r.description as string | undefined,
    startTime: r.startTime as string | undefined,
    endTime: r.endTime as string | undefined,
    calendarEntity: (r.calendarEntity as CalendarItem["calendarEntity"]) || undefined,
    profileId: profileId || undefined,
    assigneeUid: r.assigneeUid as string | undefined,
    assigneeName: r.assigneeName as string | undefined,
  };
}

/** Fetch user-level (personal) calendar items. */
export async function fetchCalendarItems(): Promise<CalendarItem[]> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return [];
  const snap = await getDocs(userDataCol(uid, "calendar_items"));
  return snap.docs.map((d) => parseCalendarItemDoc(d));
}

/** Fetch profile-level calendar items visible to all profile members. */
export async function fetchProfileCalendarItems(profileIds: string[]): Promise<CalendarItem[]> {
  if (profileIds.length === 0) return [];
  const all = await Promise.all(
    profileIds.map(async (pid) => {
      const snap = await getDocs(collection(getFirestoreDb(), PROFILE_COLLECTION, pid, "calendar_items"));
      return snap.docs.map((d) => parseCalendarItemDoc(d, pid));
    }),
  );
  return all.flat();
}

export async function upsertCalendarItem(item: CalendarItem) {
  const payload = {
    type: item.type,
    title: item.title,
    date: item.date,
    description: item.description || null,
    startTime: item.startTime || null,
    endTime: item.endTime || null,
    calendarEntity: item.calendarEntity || null,
    assigneeUid: item.assigneeUid || null,
    assigneeName: item.assigneeName || null,
    updatedAt: serverTimestamp(),
  };
  if (item.profileId) {
    await safeSetDoc(doc(getFirestoreDb(), PROFILE_COLLECTION, item.profileId, "calendar_items", item.id), payload);
  } else {
    const uid = requireUid();
    await safeSetDoc(userDataDoc(uid, "calendar_items", item.id), payload);
  }
}

export async function deleteCalendarItemFromDb(id: string, profileId?: string) {
  if (profileId) {
    await deleteDoc(doc(getFirestoreDb(), PROFILE_COLLECTION, profileId, "calendar_items", id));
  } else {
    const uid = requireUid();
    await deleteDoc(userDataDoc(uid, "calendar_items", id));
  }
}

// ── Unavailability ────────────────────────────────────────────────────────────

export async function fetchProfileUnavailability(profileId: string): Promise<string[]> {
  const snap = await getDoc(doc(getFirestoreDb(), PROFILE_COLLECTION, profileId, "unavailability", "main"));
  if (!snap.exists()) return [];
  return (snap.data().dates as string[]) || [];
}

export async function saveProfileUnavailability(profileId: string, dates: string[]): Promise<void> {
  await safeSetDoc(
    doc(getFirestoreDb(), PROFILE_COLLECTION, profileId, "unavailability", "main"),
    { dates, updatedAt: serverTimestamp() },
  );
}

// ── Share tokens ──────────────────────────────────────────────────────────────

export type SettlementShareSnapshot = {
  event: Event;
  deal: DealStructure;
  revenue: TicketRevenue;
  settlement: Settlement;
};

export async function upsertShareToken(
  token: string,
  eventId: string,
  parties: string[] | unknown,
  snapshot?: SettlementShareSnapshot,
) {
  const uid = requireUid();
  const createdAt = new Date().toISOString().slice(0, 10);
  await safeSetDoc(
    userDataDoc(uid, "share_tokens", token),
    { token, eventId, parties, createdAt },
    { merge: true },
  );
  await safeSetDoc(
    doc(getFirestoreDb(), PUBLIC_SHARES, token),
    {
      kind: "settlement_review",
      ownerUid: uid,
      eventId,
      parties,
      createdAt,
      snapshot: snapshot ? stripUndefined(snapshot) : null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * If a settlement-review share token already exists for this event, refresh
 * its public snapshot from the latest event/deal/revenue/settlement docs.
 * No-op if no share has been created yet.
 */
export async function refreshShareTokenIfExists(eventId: string): Promise<void> {
  const token = `review-${eventId}`;
  const ref = doc(getFirestoreDb(), PUBLIC_SHARES, token);
  const existing = await getDoc(ref);
  if (!existing.exists()) return;
  const existingData = existing.data() as { parties?: unknown; ownerUid?: string };

  const eventSnap = await getDoc(eventDoc(eventId));
  if (!eventSnap.exists()) return;
  const event = eventRowToEvent({ id: eventSnap.id, ...eventSnap.data() });

  const [deal, revenue, settlement] = await Promise.all([
    fetchDeal(eventId),
    fetchRevenue(eventId),
    fetchSettlement(eventId),
  ]);
  if (!deal || !revenue || !settlement) return;

  const snapshot: SettlementShareSnapshot = { event, deal, revenue, settlement };
  await safeSetDoc(
    ref,
    {
      snapshot: stripUndefined(snapshot),
      updatedAt: serverTimestamp(),
      ...(existingData.parties !== undefined ? {} : { parties: [] }),
    },
    { merge: true },
  );
}

export async function fetchShareTokens(): Promise<
  Record<string, { token: string; eventId: string; createdAt: string; parties: string[] }>
> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return {};
  const snap = await getDocs(userDataCol(uid, "share_tokens"));
  const result: Record<
    string,
    { token: string; eventId: string; createdAt: string; parties: string[] }
  > = {};
  snap.forEach((d) => {
    const r = d.data() as Record<string, unknown>;
    const token = (r.token as string) || d.id;
    result[token] = {
      token,
      eventId: r.eventId as string,
      createdAt: (r.createdAt as string) || "",
      parties: Array.isArray(r.parties) ? (r.parties as string[]) : [],
    };
  });
  return result;
}

export async function fetchPublicShareByToken(token: string) {
  const snap = await getDoc(doc(getFirestoreDb(), PUBLIC_SHARES, token));
  if (!snap.exists()) return null;
  const raw = snap.data() as Record<string, unknown>;
  const updatedAtRaw = raw.updatedAt as { toMillis?: () => number } | string | undefined;
  let updatedAtMs: number | null = null;
  if (updatedAtRaw && typeof updatedAtRaw === "object" && typeof updatedAtRaw.toMillis === "function") {
    updatedAtMs = updatedAtRaw.toMillis();
  } else if (typeof updatedAtRaw === "string") {
    const parsed = Date.parse(updatedAtRaw);
    if (!Number.isNaN(parsed)) updatedAtMs = parsed;
  }
  return {
    ...(raw as {
      kind?: string;
      ownerUid?: string;
      eventId?: string;
      parties?: unknown;
      snapshot?: SettlementShareSnapshot | null;
      recipients?: string[];
      snapshotData?: unknown;
      agreementConfirmations?: unknown[];
      createdAt?: string;
      approved?: boolean;
      approvedAt?: string;
    }),
    updatedAtMs,
  };
}

export async function updatePublicShareAgreementConfirmations(
  token: string,
  confirmations: unknown[],
) {
  await updateDoc(doc(getFirestoreDb(), PUBLIC_SHARES, token), {
    agreementConfirmations: confirmations,
    agreementUpdatedAt: serverTimestamp(),
  });
}

export async function approvePublicShare(token: string, party: string) {
  const db = getFirestoreDb();
  const shareRef = doc(db, PUBLIC_SHARES, token);
  const approvedAt = new Date().toISOString();
  const approvalDate = approvedAt.slice(0, 10);

  // Read share to find the linked event before opening transaction.
  const shareSnap = await getDoc(shareRef);
  if (!shareSnap.exists()) {
    // Still write the share-level approval so callers see consistent behaviour.
    await updateDoc(shareRef, { approved: true, approvedAt });
    return;
  }
  const shareData = shareSnap.data() as { eventId?: string };
  const eventId = shareData.eventId;

  // Update share doc + settlement doc atomically when we have an eventId.
  if (eventId) {
    const settlementRef = eventSubDoc(eventId, SUB_SETTLEMENT, "main");
    await runTransaction(db, async (tx) => {
      const settlementSnap = await tx.get(settlementRef);
      const existing = (settlementSnap.exists() ? (settlementSnap.data() as Settlement) : null);
      const existingApprovals = existing?.approvals ?? [];
      const idx = existingApprovals.findIndex((a) => a.party === party);
      const nextApprovals = [...existingApprovals];
      if (idx >= 0) {
        nextApprovals[idx] = { party, approved: true, date: approvalDate };
      } else {
        nextApprovals.push({ party, approved: true, date: approvalDate });
      }
      tx.set(
        settlementRef,
        { approvals: nextApprovals, updatedAt: serverTimestamp() },
        { merge: true },
      );
      tx.update(shareRef, { approved: true, approvedAt });
    });
    // Re-snapshot the share doc so subsequent fetches include the new approval state.
    await refreshShareTokenIfExists(eventId);
    return;
  }

  // Fallback: no linked event, just record share-level approval.
  await updateDoc(shareRef, { approved: true, approvedAt });
}

export type PublicEventSharePayload = {
  eventId: string;
  recipients: string[];
  snapshotData: unknown;
  sections: string[];
  tabs: string[];
  level: string;
  creatorName: string;
};

export async function createPublicEventShare(token: string, payload: PublicEventSharePayload) {
  const uid = requireUid();
  // Deeply strip undefined values from snapshotData and the rest of the payload —
  // Firestore rejects writes containing nested undefined values, which would
  // silently fail the share-link generation for any event with optional fields
  // unset (e.g. ticketingProvider on a draft).
  const cleanPayload = stripUndefined(payload);
  await safeSetDoc(doc(getFirestoreDb(), PUBLIC_SHARES, token), {
    kind: "event_snapshot",
    ownerUid: uid,
    ...cleanPayload,
    createdAt: new Date().toISOString(),
  });
}

export async function fetchShareTokenPartiesForBudget(token: string) {
  const data = await fetchPublicShareByToken(token);
  if (!data) return null;
  return data.parties;
}

export async function insertShareTokenRow(payload: {
  token: string;
  event_id: string;
  parties: unknown;
}) {
  const uid = requireUid();
  await safeSetDoc(userDataDoc(uid, "share_tokens", payload.token), {
    token: payload.token,
    eventId: payload.event_id,
    parties: payload.parties,
    createdAt: new Date().toISOString().slice(0, 10),
  });
  await safeSetDoc(
    doc(getFirestoreDb(), PUBLIC_SHARES, payload.token),
    {
      kind: "budget",
      ownerUid: uid,
      eventId: payload.event_id,
      parties: payload.parties,
      createdAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

// ── Collaborator invites ───────────────────────────────────────────────────────

export type CollaboratorInviteRecord = {
  token: string;
  event_id: string;
  role: string;
  eventRole?: string;
  permission: string;
  passwordHash: string | null;
  status: string;
  email: string;
  ownerUid: string;
};

export async function fetchCollaboratorInviteByToken(
  token: string,
): Promise<CollaboratorInviteRecord | null> {
  const snap = await getDoc(doc(getFirestoreDb(), COLLAB_INVITES, token));
  if (!snap.exists()) return null;
  return { ...(snap.data() as CollaboratorInviteRecord), token: snap.id };
}

export async function insertCollaboratorInvite(payload: {
  token: string;
  event_id: string;
  email: string;
  role: string;
  permission: string;
  eventRole?: string;
  message?: string;
}) {
  const uid = requireUid();
  await safeSetDoc(doc(getFirestoreDb(), COLLAB_INVITES, payload.token), {
    ...payload,
    eventRole: payload.eventRole ?? "staff",
    ownerUid: uid,
    passwordHash: null,
    status: "pending",
  });
}

export async function updateCollaboratorInviteCredentials(
  token: string,
  patch: { email?: string; status?: string },
) {
  await updateDoc(doc(getFirestoreDb(), COLLAB_INVITES, token), patch);
}

export async function saveCollaboratorAgreementDraft(
  inviteToken: string,
  ownerUid: string,
  eventId: string,
  agreementConfirmations: unknown[],
) {
  await safeSetDoc(
    doc(getFirestoreDb(), COLLAB_WRITES, inviteToken),
    { ownerUid, eventId, inviteToken, agreementConfirmations, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function fetchCollaboratorAgreementDraft(
  inviteToken: string,
): Promise<unknown[] | null> {
  const snap = await getDoc(doc(getFirestoreDb(), COLLAB_WRITES, inviteToken));
  if (!snap.exists()) return null;
  const v = (snap.data() as { agreementConfirmations?: unknown[] }).agreementConfirmations;
  return Array.isArray(v) ? v : null;
}

// ── Invitation codes ─────────────────────────────────────────────────────────

export interface InvitationCode {
  code: string;
  status: "active" | "used" | "revoked";
  createdAt: string;
  createdByUid: string;
  usedByUid?: string;
  usedAt?: string;
  expiresAt?: string;
  linkedProfileId?: string;
  linkedEventId?: string;
  source: "collaborator_invite" | "admin" | "team";
  sourceCollaboratorInviteToken?: string;
  recipientEmail?: string;
  recipientName?: string;
  recipientRole?: string;
}

export async function fetchInvitationCode(code: string): Promise<InvitationCode | null> {
  const snap = await getDoc(doc(getFirestoreDb(), INVITATION_CODES, code));
  if (!snap.exists()) return null;
  return { code: snap.id, ...snap.data() } as InvitationCode;
}

export async function fetchInvitationCodesByCreator(uid: string): Promise<InvitationCode[]> {
  const q = query(
    collection(getFirestoreDb(), INVITATION_CODES),
    where("createdByUid", "==", uid),
    orderBy("createdAt", "desc"),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ code: d.id, ...d.data() }) as InvitationCode);
}

export async function revokeInvitationCode(code: string): Promise<void> {
  await updateDoc(doc(getFirestoreDb(), INVITATION_CODES, code), { status: "revoked" });
}

export async function fetchAllInvitationCodes(
  pageSize: number,
  cursor: QueryDocumentSnapshot | null,
  statusFilter?: string,
): Promise<{ codes: InvitationCode[]; lastDoc: QueryDocumentSnapshot | null; hasMore: boolean }> {
  const constraints = [
    ...(statusFilter ? [where("status", "==", statusFilter)] : []),
    orderBy("createdAt", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(pageSize + 1),
  ];
  const q = query(collection(getFirestoreDb(), INVITATION_CODES), ...constraints);
  const snap = await getDocs(q);
  const hasMore = snap.docs.length > pageSize;
  const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
  return {
    codes: docs.map((d) => ({ code: d.id, ...d.data() }) as InvitationCode),
    lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore,
  };
}

export async function isUserAdmin(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(getFirestoreDb(), ADMINS, uid));
  return snap.exists();
}

// ── Booking requests ──────────────────────────────────────────────────────────

export interface BookingRequestPageFilters {
  status?: string;
}

export interface BookingRequestPage {
  requests: any[];
  lastDoc: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

export async function fetchBookingRequestPage(
  pageSize: number,
  cursor: QueryDocumentSnapshot | null,
  filters?: BookingRequestPageFilters,
): Promise<BookingRequestPage> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return { requests: [], lastDoc: null, hasMore: false };
  const constraints = [
    where("owner_uid", "==", uid),
    ...(filters?.status ? [where("status", "==", filters.status)] : []),
    orderBy("created_at", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(pageSize + 1),
  ];
  const q = query(collection(getFirestoreDb(), INBOUND_BOOKING_REQUESTS), ...constraints);
  const snap = await getDocs(q);
  const hasMore = snap.size > pageSize;
  const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
  const lastDoc = docs.length > 0 ? docs[docs.length - 1] : null;
  return {
    requests: docs.map((d) => ({ id: d.id, ...d.data() })),
    lastDoc,
    hasMore,
  };
}

export async function fetchBookingRequests(): Promise<any[]> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return [];
  const q = query(
    collection(getFirestoreDb(), INBOUND_BOOKING_REQUESTS),
    where("owner_uid", "==", uid),
    orderBy("created_at", "desc"),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchBookingRequestByEventId(eventId: string): Promise<{ id: string; wanted_date?: string } | null> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) return null;
  const q = query(
    collection(getFirestoreDb(), INBOUND_BOOKING_REQUESTS),
    where("owner_uid", "==", uid),
    where("event_id", "==", eventId),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, wanted_date: (d.data().wanted_date as string) ?? undefined };
}

export async function insertPublicBookingRequest(row: Record<string, unknown>) {
  const ownerUid = row.owner_uid;
  if (typeof ownerUid !== "string" || !ownerUid) {
    throw new Error("owner_uid is required.");
  }
  const id = crypto.randomUUID();
  await safeSetDoc(doc(getFirestoreDb(), INBOUND_BOOKING_REQUESTS, id), {
    ...row,
    owner_uid: ownerUid,
    status: "pending",
    created_at: new Date().toISOString(),
  });
}

export async function updateBookingRequest(id: string, update: Record<string, unknown>) {
  const ref = doc(getFirestoreDb(), INBOUND_BOOKING_REQUESTS, id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, update);
    return;
  }
  // Legacy fallback
  await updateDoc(doc(getFirestoreDb(), PUBLIC_BOOKING_REQUESTS_LEGACY, id), update);
}

// ── Collaborator event access (for CollaboratorEventView) ─────────────────────

export async function fetchEventRowForCollaborator(
  _ownerUid: string,
  eventId: string,
): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(eventDoc(eventId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// ── Notifications ─────────────────────────────────────────────────────────────

const SUB_NOTIFICATIONS = "notifications";

function notificationsCol(profileId: string) {
  return collection(getFirestoreDb(), PROFILE_COLLECTION, profileId, SUB_NOTIFICATIONS);
}

export function subscribeNotifications(
  profileIds: string[],
  onNotifications: (notifications: AppNotification[]) => void,
): () => void {
  if (profileIds.length === 0) {
    onNotifications([]);
    return () => {};
  }

  const allNotifs = new Map<string, AppNotification[]>();
  const unsubs: (() => void)[] = [];

  for (const profileId of profileIds) {
    const q = query(
      notificationsCol(profileId),
      orderBy("createdAt", "desc"),
      limit(50),
    );
    const unsub = onSnapshot(q, (snap) => {
      allNotifs.set(
        profileId,
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            type: data.type as NotificationType,
            title: (data.title as string) || "",
            body: (data.body as string) || "",
            eventId: data.eventId as string | undefined,
            eventName: data.eventName as string | undefined,
            actorName: (data.actorName as string) || "",
            actorUid: (data.actorUid as string) || "",
            profileId,
            read: !!data.read,
            createdAt: (data.createdAt as string) || new Date().toISOString(),
            link: data.link as string | undefined,
            metadata: data.metadata as Record<string, string> | undefined,
          };
        }),
      );
      // Merge & sort all profile notifications and push to callback
      const merged = Array.from(allNotifs.values())
        .flat()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onNotifications(merged);
    }, (err) => {
      // Permission-denied is expected for profiles without a member doc (e.g. stub profiles).
      // Silently skip — the profile simply won't contribute notifications.
      console.warn(`Notifications listener failed for profile ${profileId}:`, err.code);
    });
    unsubs.push(unsub);
  }

  return () => unsubs.forEach((fn) => fn());
}

export async function markNotificationRead(profileId: string, notificationId: string): Promise<void> {
  await updateDoc(
    doc(getFirestoreDb(), PROFILE_COLLECTION, profileId, SUB_NOTIFICATIONS, notificationId),
    { read: true },
  );
}

export async function markAllNotificationsRead(profileId: string): Promise<void> {
  const q = query(notificationsCol(profileId), where("read", "==", false));
  const snap = await getDocs(q);
  if (snap.empty) return;
  const batch = writeBatch(getFirestoreDb());
  snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
  await batch.commit();
}

export async function deleteNotification(profileId: string, notificationId: string): Promise<void> {
  await deleteDoc(
    doc(getFirestoreDb(), PROFILE_COLLECTION, profileId, SUB_NOTIFICATIONS, notificationId),
  );
}
