/**
 * Seeds Firestore + Auth emulator from fixtures in `scripts/seed/` (not from the app bundle).
 *
 * Runs automatically after emulators are up when you use `npm run dev:local` or `npm run dev:emulators`.
 * Manual: start emulators, then `npm run seed`.
 *
 * Accounts seeded (password: 123456):
 *   daniel.islandman@showme.music   — venue + artist profiles, full event fixtures
 *   testvenueuser1@showme.music  — venue profile + 3 events
 *   testpromoteruser1@showme.music — promoter profile + 3 events
 *   testorganizeruser1@showme.music — organizer profile + 3 events
 *   testartistuser1@showme.music — artist profile
 *   testfestivaluser1@showme.music — festival profile + 3 events
 *
 * Override primary credentials via env or `.env.local`: SEED_EMAIL, SEED_PASSWORD, SEED_DISPLAY_NAME.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type WriteBatch } from "firebase-admin/firestore";

import {
  seedAgreements,
  seedArtistProfiles,
  seedCollaborators,
  seedCrew,
  seedDeals,
  seedEventMeta,
  seedEvents,
  seedContacts,
  seedRevenue,
  seedRiders,
  seedSchedule,
  seedSettlements,
} from "./seed/fixtures";
import { calculateSettlement } from "../src/lib/models.ts";
import { SEED_PROFILES, SEED_USER_SETTINGS } from "./seed/defaults";

// ── Config ────────────────────────────────────────────────────────────────────

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "showme-local";
const SEED_EMAIL = process.env.SEED_EMAIL ?? "daniel.islandman@showme.music";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "123456";
const SEED_DISPLAY_NAME = process.env.SEED_DISPLAY_NAME ?? "Daniel Islandman";
const SEED_USER_PASSWORD = "123456";

// Synthetic owner for the public seed-artist pool. Not a real auth account, so
// no live user has these in their owned-profiles list / profileIds claim.
const SEED_ARTIST_POOL_UID = "seed-artist-pool";

const DEFAULT_SHARE_PARTIES = ["Performer", "Agent", "Venue"];

// Test accounts — one per profile type, all password SEED_USER_PASSWORD
const TEST_USERS = [
  {
    email: "testvenueuser1@showme.music",
    displayName: "Venue Test One",
    role: "venue",
    profileName: "Test Venue One",
    locations: [{ id: "loc-1", label: "Primary", city: "London", country: "UK" }],
    bio: "A test venue account for local development.",
    capacity: 1200,
    events: [
      { id: "EVT-TU-V1", name: "Test Venue Showcase", date: "2026-05-10", artist: "Test Artist One", eventStatus: "confirmed" as const, status: "open" as const, published: true, capacity: 1200, tickets: [{ provider: "DICE", url: "https://tickets.example.com/evt-tu-v1" }] },
      { id: "EVT-TU-V2", name: "Test Venue Club Night", date: "2026-06-20", artist: "Floating Points", eventStatus: "pending" as const, status: "open" as const, published: false, capacity: 1200, tickets: [{ provider: "DICE", url: "https://tickets.example.com/evt-tu-v2" }] },
      { id: "EVT-TU-V3", name: "Test Venue Wrap Party", date: "2026-03-01", artist: "Jamie xx", eventStatus: "concluded" as const, status: "finalized" as const, published: false, capacity: 1200, tickets: [{ provider: "DICE", url: "https://tickets.example.com/evt-tu-v3" }] },
    ],
  },
  {
    email: "testpromoteruser1@showme.music",
    displayName: "Promoter Test One",
    role: "promoter",
    profileName: "Test Promoter One",
    locations: [{ id: "loc-1", label: "Primary", city: "Berlin", country: "DE" }],
    bio: "A test promoter account for local development.",
    events: [
      { id: "EVT-TU-P1", name: "Test Promoter Presents", date: "2026-05-17", artist: "Four Tet", eventStatus: "confirmed" as const, status: "open" as const, published: true, capacity: 2000, tickets: [{ provider: "Eventbrite", url: "https://tickets.example.com/evt-tu-p1" }] },
      { id: "EVT-TU-P2", name: "Test Promoter Festival", date: "2026-07-12", artist: "Bonobo", eventStatus: "suggested" as const, status: "open" as const, published: false, capacity: 5000, tickets: [{ provider: "Paylogic", url: "https://tickets.example.com/evt-tu-p2" }] },
      { id: "EVT-TU-P3", name: "Test Promoter Year End", date: "2026-03-05", artist: "BICEP", eventStatus: "concluded" as const, status: "revised" as const, published: false, capacity: 3000, tickets: [{ provider: "Eventbrite", url: "https://tickets.example.com/evt-tu-p3" }] },
    ],
  },
  {
    email: "testorganizeruser1@showme.music",
    displayName: "Organizer Test One",
    role: "organizer",
    profileName: "Test Organizer One",
    locations: [{ id: "loc-1", label: "Primary", city: "Stockholm", country: "SE" }],
    bio: "A test organizer account for local development.",
    events: [
      { id: "EVT-TU-O1", name: "Test Organizer Conference", date: "2026-06-05", artist: "Nils Frahm", eventStatus: "confirmed" as const, status: "open" as const, published: true, capacity: 800, tickets: [{ provider: "See Tickets", url: "https://tickets.example.com/evt-tu-o1" }] },
      { id: "EVT-TU-O2", name: "Test Organizer Showcase", date: "2026-04-22", artist: "Arlo Parks", eventStatus: "on_hold" as const, status: "open" as const, published: false, capacity: 600, tickets: [{ provider: "See Tickets", url: "https://tickets.example.com/evt-tu-o2" }] },
      { id: "EVT-TU-O3", name: "Test Organizer Season Finale", date: "2026-03-10", artist: "Yussef Dayes", eventStatus: "concluded" as const, status: "paid" as const, published: false, capacity: 700, tickets: [{ provider: "See Tickets", url: "https://tickets.example.com/evt-tu-o3" }] },
    ],
  },
  {
    email: "testartistuser1@showme.music",
    displayName: "Artist Test One",
    role: "performer",
    profileName: "Test Artist One",
    locations: [{ id: "loc-1", label: "Primary", city: "Paris", country: "FR" }],
    bio: "A test artist account for local development.",
    setupType: "Live band",
    setupSize: 4,
    events: [],
  },
  {
    email: "testfestivaluser1@showme.music",
    displayName: "Festival Test One",
    role: "festival",
    profileName: "Test Festival One",
    locations: [{ id: "loc-1", label: "Primary", city: "Copenhagen", country: "DK" }],
    bio: "A test festival account for local development.",
    capacity: 8000,
    events: [
      { id: "EVT-TU-F1", name: "Test Festival Main Stage", date: "2026-08-08", artist: "Aurora", eventStatus: "confirmed" as const, status: "open" as const, published: true, capacity: 8000, tickets: [{ provider: "Ticketmaster", url: "https://tickets.example.com/evt-tu-f1" }] },
      { id: "EVT-TU-F2", name: "Test Festival Side Stage", date: "2026-08-09", artist: "GoGo Penguin", eventStatus: "confirmed" as const, status: "open" as const, published: true, capacity: 2000, tickets: [{ provider: "Ticketmaster", url: "https://tickets.example.com/evt-tu-f2" }] },
      { id: "EVT-TU-F3", name: "Test Festival Preview Night", date: "2026-03-07", artist: "Khruangbin", eventStatus: "concluded" as const, status: "finalized" as const, published: false, capacity: 1500, tickets: [{ provider: "Ticketmaster", url: "https://tickets.example.com/evt-tu-f3" }] },
    ],
  },
] as const;

// ── Init ─────────────────────────────────────────────────────────────────────

function loadEnvFile() {
  try {
    const p = resolve(process.cwd(), ".env.local");
    const raw = readFileSync(p, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    // .env.local is optional
  }
}

loadEnvFile();

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8090";

initializeApp({ projectId: PROJECT_ID });

const auth = getAuth();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureUser(email: string, password: string, displayName: string): Promise<string> {
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password, displayName, emailVerified: true });
    return existing.uid;
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code?: string }).code)
        : "";
    if (code !== "auth/user-not-found") throw e;
    const created = await auth.createUser({ email, password, displayName, emailVerified: true });
    return created.uid;
  }
}

function profileDocId(uid: string, role: string): string {
  const safeSlot = role.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${uid}__${safeSlot}`;
}

/** Commit a batch and return a fresh one. */
async function flush(batch: WriteBatch): Promise<WriteBatch> {
  await batch.commit();
  return db.batch();
}

// ── Main seeding for daniel.islandman@showme.music ───────────────────────────────

async function seedMainUser(): Promise<void> {
  const uid = await ensureUser(SEED_EMAIL, SEED_PASSWORD, SEED_DISPLAY_NAME);
  const userRef = db.collection("users").doc(uid);

  // Profile doc IDs — used as hostProfileId / performerProfileId for seeded events.
  const venueProfileId = profileDocId(uid, "venue");
  const promoterProfileId = profileDocId(uid, "promoter");
  const artistProfileId = profileDocId(uid, "performer");

  // ── Batch 1: user settings, profiles, parties ─────────────────────────────
  let batch = db.batch();

  batch.set(
    userRef.collection("settings").doc("main"),
    {
      name: SEED_USER_SETTINGS.name,
      email: SEED_USER_SETTINGS.email,
      initials: SEED_USER_SETTINGS.initials,
      roles: SEED_USER_SETTINGS.roles,
      currency: SEED_USER_SETTINGS.currency,
      default_role: SEED_USER_SETTINGS.default_role,
      company_name: SEED_USER_SETTINGS.company_name,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  for (const [role, profile] of Object.entries(SEED_PROFILES)) {
    const pid = profileDocId(uid, role);
    const profileRef = db.collection("profiles").doc(pid);
    batch.set(profileRef, {
      ...(profile as Record<string, unknown>),
      // `type` must match `role` — Firestore rules check data.type for event host access.
      type: role,
      owner_uid: uid,
      slot: role,
      schemaVersion: 2,
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(profileRef.collection("members").doc(uid), {
      user_uid: uid,
      role: "owner",
      displayName: SEED_DISPLAY_NAME,
      email: SEED_EMAIL,
      schemaVersion: 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const p of seedContacts) {
    batch.set(userRef.collection("contacts").doc(p.id), {
      ...p,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await flush(batch);

  // ── Batch 2: explicit events (EVT-001 … EVT-018) + subcollections ─────────
  const explicitEvents = seedEvents.filter((ev) => /^EVT-0/.test(ev.id));

  batch = db.batch();
  for (const ev of explicitEvents) {
    const evRef = db.collection("events").doc(ev.id);

    // Assign profile based on operator: venue events → venue profile, promoter events → promoter profile.
    const isVenueEvent = ev.operatorType === "venue";
    const isPromoterEvent = ev.operatorType === "promoter";
    const isArtistEvent = ev.artist === "Islandman";
    const hostProfile = isVenueEvent ? venueProfileId : isPromoterEvent ? promoterProfileId : undefined;
    const accessProfileIds: string[] = [];
    if (hostProfile) accessProfileIds.push(hostProfile);
    if (isArtistEvent) accessProfileIds.push(artistProfileId);

    batch.set(evRef, {
      ...ev,
      archived: false,
      published: Boolean(ev.published),
      ...(hostProfile ? { hostProfileId: hostProfile } : {}),
      ...(isArtistEvent ? { performerProfileId: artistProfileId } : {}),
      accessProfileIds,
      accessUids: [uid],
      owner_uid: uid,
      primary_owner_uid: uid,
      isMultiPerformer: false,
      parentEventId: null,
      childEventIds: [],
      createdAt: ev.date,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const deal = (seedDeals as Record<string, unknown>)[ev.id];
    if (deal) {
      batch.set(evRef.collection("deal").doc("main"), { ...deal as object, updatedAt: FieldValue.serverTimestamp() });
    }

    const rev = (seedRevenue as Record<string, unknown>)[ev.id];
    if (rev) {
      batch.set(evRef.collection("revenue").doc("main"), { ...rev as object, updatedAt: FieldValue.serverTimestamp() });
    }

    const settlement = (seedSettlements as Record<string, unknown>)[ev.id];
    if (settlement) {
      batch.set(evRef.collection("settlement").doc("main"), { ...settlement as object, updatedAt: FieldValue.serverTimestamp() });
    }

    const meta = seedEventMeta[ev.id];
    if (meta) {
      batch.set(evRef.collection("meta").doc("main"), { ...meta, updatedAt: FieldValue.serverTimestamp() });
    }

    // Share token (stored in public collection and user subcollection)
    const token = `review-${ev.id}`;
    batch.set(userRef.collection("share_tokens").doc(token), {
      token,
      eventId: ev.id,
      parties: DEFAULT_SHARE_PARTIES,
      createdAt: ev.date,
    });
    batch.set(db.collection("publicShares").doc(token), {
      kind: "settlement_review",
      ownerUid: uid,
      eventId: ev.id,
      parties: DEFAULT_SHARE_PARTIES,
      createdAt: ev.date,
      snapshot: null,
    });
  }
  await flush(batch);

  // ── Batch 3: event subcollections (riders, agreements, crew, schedule, collaborators) ──
  batch = db.batch();
  for (const ev of explicitEvents) {
    const evRef = db.collection("events").doc(ev.id);

    for (const rider of seedRiders[ev.id] ?? []) {
      batch.set(evRef.collection("riders").doc(rider.id), { ...rider, updatedAt: FieldValue.serverTimestamp() });
    }
    for (const agreement of seedAgreements[ev.id] ?? []) {
      batch.set(evRef.collection("agreements").doc(agreement.id), { ...agreement, updatedAt: FieldValue.serverTimestamp() });
    }
    for (const member of seedCrew[ev.id] ?? []) {
      batch.set(evRef.collection("crew").doc(member.id), { ...member, updatedAt: FieldValue.serverTimestamp() });
    }
    for (const item of seedSchedule[ev.id] ?? []) {
      batch.set(evRef.collection("schedule").doc(item.id), { ...item, updatedAt: FieldValue.serverTimestamp() });
    }
    for (const collab of seedCollaborators[ev.id] ?? []) {
      batch.set(evRef.collection("collaborators").doc(collab.id), { ...collab, updatedAt: FieldValue.serverTimestamp() });
    }
  }
  await flush(batch);

  // ── Batches 4+: generated events (EVT-G001 … EVT-G100), 50 per batch ─────
  const generatedEvents = seedEvents.filter((ev) => /^EVT-G/.test(ev.id));
  const CHUNK = 50;

  for (let i = 0; i < generatedEvents.length; i += CHUNK) {
    batch = db.batch();
    const chunk = generatedEvents.slice(i, i + CHUNK);
    for (const ev of chunk) {
      const evRef = db.collection("events").doc(ev.id);
      const deal = (seedDeals as Record<string, unknown>)[ev.id];
      const rev = (seedRevenue as Record<string, unknown>)[ev.id];
      const settlement = (seedSettlements as Record<string, unknown>)[ev.id];

      // Assign profile based on operator type.
      const isVenueHosted = ev.operatorType === "venue";
      const hostProfile = isVenueHosted ? venueProfileId : promoterProfileId;

      batch.set(evRef, {
        ...ev,
        archived: false,
        published: Boolean(ev.published),
        hostProfileId: hostProfile,
        accessProfileIds: [hostProfile],
        accessUids: [uid],
        owner_uid: uid,
        primary_owner_uid: uid,
        isMultiPerformer: false,
        parentEventId: null,
        childEventIds: [],
        createdAt: ev.date,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (deal) batch.set(evRef.collection("deal").doc("main"), { ...deal as object, updatedAt: FieldValue.serverTimestamp() });
      if (rev) batch.set(evRef.collection("revenue").doc("main"), { ...rev as object, updatedAt: FieldValue.serverTimestamp() });
      if (settlement) batch.set(evRef.collection("settlement").doc("main"), { ...settlement as object, updatedAt: FieldValue.serverTimestamp() });
    }
    await flush(batch);
  }

  // ── Batch 5: standalone artist profiles (public, searchable) ───────────────
  // Owned by a synthetic pool uid (no real auth account) so they don't bloat the
  // main user's owned-profiles list — keeping their `profileIds` claim small.
  // Discovery (search-by-name, public profile pages) still works since those
  // paths don't gate on owner.
  batch = db.batch();
  const mainArtistName = SEED_PROFILES.performer.name; // skip if same as main user's profile
  let artistProfileCount = 0;
  for (const artist of seedArtistProfiles) {
    if (artist.name === mainArtistName) continue; // already seeded as main user's profile
    const slug = artist.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const docId = `seed-artist__${slug}`;
    batch.set(db.collection("profiles").doc(docId), {
      type: "performer",
      role: "performer",
      name: artist.name,
      locations: artist.locations,
      genres: artist.genres,
      bio: artist.bio,
      avatarUrl: artist.avatarUrl,
      slug,
      isPublic: true,
      created: true,
      owner_uid: SEED_ARTIST_POOL_UID,
      slot: "performer",
      schemaVersion: 2,
      updatedAt: FieldValue.serverTimestamp(),
    });
    artistProfileCount++;
  }
  await flush(batch);

  // ── Admin privileges ────────────────────────────────────────────────────────
  batch = db.batch();
  batch.set(db.collection("admins").doc(uid), {
    uid,
    email: SEED_EMAIL,
    addedAt: FieldValue.serverTimestamp(),
  });
  await flush(batch);

  console.log(`✓ Seeded main user ${SEED_EMAIL} (uid=${uid}), ${explicitEvents.length} explicit + ${generatedEvents.length} generated events, ${artistProfileCount} artist profiles, admin=true.`);
}

// Maps a profile role to the operatorType field on Event.
// Event.operatorType only allows "promoter" | "venue" | "organizer".
function toOperatorType(role: string): "promoter" | "venue" | "organizer" {
  if (role === "venue") return "venue";
  if (role === "organizer" || role === "festival") return "organizer";
  return "promoter";
}

// ── Test user seeding ─────────────────────────────────────────────────────────

async function seedTestUsers(): Promise<void> {
  // ── Pass 1: create all auth accounts + profiles, collect resolved IDs ───────
  const resolvedUids: Record<string, string> = {};    // email → uid
  const resolvedPids: Record<string, string> = {};    // email → profileDocId

  let batch = db.batch();

  for (const u of TEST_USERS) {
    const uid = await ensureUser(u.email, SEED_USER_PASSWORD, u.displayName);
    resolvedUids[u.email] = uid;
    const pid = profileDocId(uid, u.role);
    resolvedPids[u.email] = pid;

    const userRef = db.collection("users").doc(uid);
    const profileRef = db.collection("profiles").doc(pid);

    batch.set(
      userRef.collection("settings").doc("main"),
      {
        name: u.displayName,
        email: u.email,
        initials: u.displayName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2),
        roles: [u.role],
        currency: "EUR",
        default_role: u.role,
        company_name: "",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const profileSlug = u.profileName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    batch.set(profileRef, {
      role: u.role,
      // `type` field required by Firestore security rules for event host access checks.
      type: u.role,
      name: u.profileName,
      locations: u.locations,
      bio: u.bio,
      genres: [],
      socialLinks: [],
      ...("capacity" in u ? { capacity: u.capacity } : {}),
      ...("setupType" in u ? { setupType: u.setupType, setupSize: u.setupSize } : {}),
      ...(u.role === "performer" ? { avatarUrl: `https://i.pravatar.cc/150?u=${profileSlug}` } : {}),
      isPublic: true,
      created: true,
      owner_uid: uid,
      slot: u.role,
      schemaVersion: 2,
      updatedAt: FieldValue.serverTimestamp(),
    });

    batch.set(profileRef.collection("members").doc(uid), {
      user_uid: uid,
      role: "owner",
      displayName: u.displayName,
      email: u.email,
      schemaVersion: 1,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`  ○ Prepared test user ${u.email} (uid=${uid}), role=${u.role}`);
  }

  await flush(batch);

  // ── Pass 2: write events — now all profile IDs are known ────────────────────
  // Artist profile ID — used as performerProfileId when an event's artist
  // matches the seeded artist profile name.
  const artistEmail = "testartistuser1@showme.music";
  const artistPid = resolvedPids[artistEmail];
  const artistUid = resolvedUids[artistEmail];
  const artistProfileName = TEST_USERS.find((u) => u.email === artistEmail)!.profileName;

  for (const u of TEST_USERS) {
    if (u.events.length === 0) continue;

    const uid = resolvedUids[u.email];
    const pid = resolvedPids[u.email];

    batch = db.batch();

    for (const ev of u.events) {
      const evRef = db.collection("events").doc(ev.id);

      // If the event's artist matches the seeded artist profile, link it.
      const isArtistProfileEvent = ev.artist === artistProfileName;
      const accessProfileIds = isArtistProfileEvent ? [pid, artistPid] : [pid];
      const accessUids = isArtistProfileEvent ? [uid, artistUid] : [uid];

      batch.set(evRef, {
        id: ev.id,
        name: ev.name,
        date: ev.date,
        venue: u.role === "venue" ? u.profileName : `${u.profileName} Venue`,
        operator: u.profileName,
        operatorType: toOperatorType(u.role),
        tickets: ev.tickets,
        capacity: ev.capacity,
        artist: ev.artist,
        eventStatus: ev.eventStatus,
        status: ev.status,
        published: Boolean(ev.published),
        archived: false,
        hostProfileId: pid,
        ...(isArtistProfileEvent ? { performerProfileId: artistPid } : {}),
        accessProfileIds,
        accessUids,
        owner_uid: uid,
        primary_owner_uid: uid,
        isMultiPerformer: false,
        parentEventId: null,
        childEventIds: [],
        createdAt: ev.date,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Concluded events need deal, revenue, and a computed settlement.
      if (ev.eventStatus === "concluded") {
        const ticketsSold = Math.round(ev.capacity * 0.7);
        const avgPrice = 30;
        const grossRevenue = ticketsSold * avgPrice;
        const deal = {
          eventId: ev.id,
          dealType: "guarantee" as const,
          artistGuarantee: 3000,
          artistSplit: 100,
          promoterSplit: 0,
          venueSplit: 0,
          organizerSplit: 0,
          artistCostSplit: 0,
          promoterCostSplit: 60,
          venueCostSplit: 40,
          organizerCostSplit: 0,
          venueRental: 0,
          commissions: [],
        };
        const revenue = {
          eventId: ev.id,
          ticketsSold,
          grossRevenue,
          ticketFees: Math.round(grossRevenue * 0.05),
          tax: Math.round(grossRevenue * 0.21),
          refunds: Math.round(grossRevenue * 0.01),
          doorSales: 0,
          productionExpenses: Math.round(grossRevenue * 0.1),
          additionalCosts: 0,
        };
        const settlementCalc = calculateSettlement(deal, revenue);
        const settlement = {
          ...settlementCalc,
          status: ev.status,
          approvals: [
            { party: "Operator", approved: ev.status !== "open", date: ev.status !== "open" ? ev.date : undefined },
            { party: "Performer", approved: ev.status === "finalized" || ev.status === "revised" || ev.status === "paid", date: ev.status === "finalized" || ev.status === "paid" ? ev.date : undefined },
            { party: "Venue", approved: ev.status === "finalized" || ev.status === "paid", date: ev.status === "finalized" || ev.status === "paid" ? ev.date : undefined },
          ],
          comments: [],
          revisions: [],
        };

        batch.set(evRef.collection("deal").doc("main"), { ...deal, updatedAt: FieldValue.serverTimestamp() });
        batch.set(evRef.collection("revenue").doc("main"), { ...revenue, updatedAt: FieldValue.serverTimestamp() });
        batch.set(evRef.collection("settlement").doc("main"), { ...settlement, updatedAt: FieldValue.serverTimestamp() });
      }
    }

    await flush(batch);
    console.log(`  ○ Seeded events for ${u.email} (${u.events.length} events)`);
  }

  console.log(`✓ Seeded ${TEST_USERS.length} test users.`);
}

// ── Custom claims sync ────────────────────────────────────────────────────────
// The onProfileMemberClaimsSync trigger populates this in production. In the
// emulator the trigger can race against auth user creation (the seed creates
// member docs before/while the auth user is being committed, so the trigger's
// getUser() call fails). Populating claims directly here makes the emulator
// state deterministic — independent of trigger timing.

const PROFILE_IDS_CLAIM_CAP = 16;

async function syncClaimsForUser(uid: string, email: string): Promise<void> {
  const ids = new Set<string>();
  const ownerSnap = await db.collection("profiles").where("owner_uid", "==", uid).get();
  ownerSnap.forEach((d) => { if (d.id) ids.add(d.id); });
  const memberSnap = await db.collectionGroup("members").where("user_uid", "==", uid).get();
  memberSnap.forEach((m) => {
    const pid = m.ref.parent.parent?.id;
    if (pid) ids.add(pid);
  });
  const sorted = Array.from(ids).sort();
  const claims: Record<string, unknown> = {
    profileIds: sorted.slice(0, PROFILE_IDS_CLAIM_CAP),
  };
  if (sorted.length > PROFILE_IDS_CLAIM_CAP) claims.overflow = true;
  await auth.setCustomUserClaims(uid, claims);
  console.log(`  ○ Synced claims for ${email}: ${sorted.length} profileIds${sorted.length > PROFILE_IDS_CLAIM_CAP ? " (overflow)" : ""}`);
}

async function syncAllClaims(): Promise<void> {
  console.log("\nSyncing custom claims for all seeded users…");
  const list = await auth.listUsers(100);
  for (const u of list.users) {
    await syncClaimsForUser(u.uid, u.email ?? u.uid);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding local emulator database…");
  await seedMainUser();
  await seedTestUsers();
  await syncAllClaims();
  console.log("\nAll accounts use password: 123456");
  console.log("Main account:  daniel.islandman@showme.music");
  for (const u of TEST_USERS) {
    console.log(`Test account:  ${u.email}  (${u.role})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
