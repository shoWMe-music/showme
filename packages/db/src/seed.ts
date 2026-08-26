import { storeBreakdown } from "@showme/settlement";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  REFERENCE_GUARANTEE_TERMS,
  REFERENCE_GUARANTEE_VS_DOOR_TERMS,
  breakdownFor,
  dateOffsetFromToday,
  referenceAlbumReleaseBudgetLines,
  referenceBudgetLines,
  referenceEventDates,
  referenceHoldBudgetLines,
  referenceSettlement,
} from "./reference-settlement";
import * as schema from "./schema";

/**
 * Development seed — inserts a coherent OPERATOR dataset so the web app's
 * dashboard, events list, and event/settlement screens render realistic data.
 *
 * Run with a reachable Postgres:
 *   DATABASE_URL=postgres://user:pass@host:5432/db pnpm --filter @showme/db seed
 *
 * Idempotent: every row uses a deterministic "5eed…" id (or a known text id), so
 * the script deletes its own prior rows first and can be re-run safely. It never
 * deletes or overwrites the target operator user — it only creates it if missing.
 *
 * Mirrors `createDatabase` (client.ts) but constructs the postgres-js client
 * directly so the connection can be closed cleanly at the end (like testing.ts).
 */

// ── The already-provisioned operator user (Firebase uid). Overridable via env. ──
const FALLBACK_OPERATOR_USER_ID = "wqqj6aOGXNUstBvNG8jPJF6ISTz1";
const operatorUserId = process.env.SEED_USER_ID ?? FALLBACK_OPERATOR_USER_ID;

// A second, synthetic user that owns the performer counterparty profile.
const PERFORMER_USER_ID = "seed-performer-user";

// ── Deterministic ids (marker prefix "5eed" = seed) so re-runs are clean. ──
const OPERATOR_PROFILE_ID = "5eed0000-0000-4000-8000-0000000000a1";
const PERFORMER_PROFILE_ID = "5eed0000-0000-4000-8000-0000000000a2";

const EVENT_IDS = {
  albumRelease: "5eed0000-0000-4000-8000-0000000000e1", // confirmed, upcoming — full
  springWarmup: "5eed0000-0000-4000-8000-0000000000e2", // concluded, past — full + settlement
  openMic: "5eed0000-0000-4000-8000-0000000000e3", // draft, upcoming
  synthShowcase: "5eed0000-0000-4000-8000-0000000000e4", // on_hold, upcoming
  winterGala: "5eed0000-0000-4000-8000-0000000000e5", // cancelled
} as const;

// Participants (host = operator, perf = performer) per full event.
const PART = {
  e1Host: "5eed0000-0000-4000-8000-0000000000b1",
  e1Perf: "5eed0000-0000-4000-8000-0000000000b2",
  e2Host: "5eed0000-0000-4000-8000-0000000000b3",
  e2Perf: "5eed0000-0000-4000-8000-0000000000b4",
  // Host-only participants so the operator reaches every event it hosts
  // (reachability = participation; without these the events are invisible).
  e3Host: "5eed0000-0000-4000-8000-0000000000b5",
  e4Host: "5eed0000-0000-4000-8000-0000000000b6",
  e5Host: "5eed0000-0000-4000-8000-0000000000b7",
} as const;

// The operator's permission set — attached to every host participant so the
// operator resolves `budget.view` (unlocking settlements, budgets, and every
// performer's setlist for the PRO-royalty screen). Mirrors
// PRESET_PERMISSION_SETS.operator_full in @showme/auth (inlined to avoid a
// db→auth import cycle). Cascades with the operator profile on delete.
const OPERATOR_PERMISSION_SET_ID = "5eed0000-0000-4000-8000-0000000000c1";
const OPERATOR_FULL_CAPABILITIES = [
  "event.view",
  "event.edit",
  "event.delete",
  "event.publish",
  "event.send_info_email",
  "participants.manage",
  "deal.view.own",
  "deal.edit",
  "budget.view",
  "budget.edit",
  "revenue.edit",
  "settlement.view.own",
  "settlement.edit",
  "settlement.confirm",
  "settlement.finalize",
  "schedule.view",
  "schedule.edit",
  "crew.manage",
  "agreement.manage",
  "agreement.confirm",
  "message.post",
];

const DEAL_IDS = {
  e1: "5eed0000-0000-4000-8000-0000000000d1",
  e2: "5eed0000-0000-4000-8000-0000000000d2",
};
// One budget per event that has money on it.
//
// Note the dev seed's album release runs a FLAT GUARANTEE rather than the e2e seed's
// door split, so the same budget lines settle differently here: the performer takes
// the 25 000.00 guarantee and the venue keeps the rest of the pool as its residual.
// Same cash, different agreement — which is the pair of fixtures doing its job.
//
// The concluded event's budget keeps the id it has always had, because a re-run
// against an existing dev database has to find and delete its own prior rows, and an
// id changed for tidiness is a row that never gets cleaned up again. (It reads the
// same as OPERATOR_PERMISSION_SET_ID above; different tables, so harmless.)
const BUDGET_IDS = {
  springWarmup: "5eed0000-0000-4000-8000-0000000000c1", // shared — the settled reference event
  albumRelease: "5eed0000-0000-4000-8000-0000000000c3", // shared — confirmed, upcoming
  synthShowcaseHold: "5eed0000-0000-4000-8000-0000000000c4", // PRIVATE — the venue's own costing
} as const;
// One settlement per participant (PLAN.md) — the operator's line is not optional:
// without it the host reads its own event and finds no line of its own.
const SETTLEMENT_IDS = {
  springOperator: "5eed0000-0000-4000-8000-0000000000f1",
  springPerformer: "5eed0000-0000-4000-8000-0000000000f2",
} as const;

// ── Operator "app furniture" ids (inbox, address book, team, bills, todos). ──
const BOOKING_REQUEST_IDS = [
  "5eed0000-0000-4000-8000-000000000101",
  "5eed0000-0000-4000-8000-000000000102",
  "5eed0000-0000-4000-8000-000000000103",
  "5eed0000-0000-4000-8000-000000000104",
  "5eed0000-0000-4000-8000-000000000105",
] as const;

const CONTACT_IDS = [
  "5eed0000-0000-4000-8000-000000000201",
  "5eed0000-0000-4000-8000-000000000202",
  "5eed0000-0000-4000-8000-000000000203",
  "5eed0000-0000-4000-8000-000000000204",
  "5eed0000-0000-4000-8000-000000000205",
  "5eed0000-0000-4000-8000-000000000206",
  "5eed0000-0000-4000-8000-000000000207",
  "5eed0000-0000-4000-8000-000000000208",
] as const;

const GROUP_IDS = {
  coreCrew: "5eed0000-0000-4000-8000-000000000301",
  frontOfHouse: "5eed0000-0000-4000-8000-000000000302",
} as const;

const GROUP_MEMBER_IDS = [
  "5eed0000-0000-4000-8000-000000000311",
  "5eed0000-0000-4000-8000-000000000312",
  "5eed0000-0000-4000-8000-000000000313",
  "5eed0000-0000-4000-8000-000000000314",
  "5eed0000-0000-4000-8000-000000000315",
  "5eed0000-0000-4000-8000-000000000316",
] as const;

const GROUP_PROFILE_IDS = [
  "5eed0000-0000-4000-8000-000000000321",
  "5eed0000-0000-4000-8000-000000000322",
] as const;

const INVOICE_IDS = [
  "5eed0000-0000-4000-8000-000000000401",
  "5eed0000-0000-4000-8000-000000000402",
  "5eed0000-0000-4000-8000-000000000403",
] as const;

const TASK_IDS = [
  "5eed0000-0000-4000-8000-000000000501",
  "5eed0000-0000-4000-8000-000000000502",
  "5eed0000-0000-4000-8000-000000000503",
  "5eed0000-0000-4000-8000-000000000504",
  "5eed0000-0000-4000-8000-000000000505",
  "5eed0000-0000-4000-8000-000000000506",
] as const;

const CALENDAR_ITEM_IDS = [
  "5eed0000-0000-4000-8000-000000000601",
  "5eed0000-0000-4000-8000-000000000602",
  "5eed0000-0000-4000-8000-000000000603",
  "5eed0000-0000-4000-8000-000000000604",
] as const;

const SEK = "SEK";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required (e.g. DATABASE_URL=postgres://… pnpm --filter @showme/db seed)",
    );
  }

  const client = postgres(connectionString);
  const database = drizzle(client, { schema });

  const counts: Record<string, number> = {};
  const record = (label: string, rows: readonly unknown[]) => {
    counts[label] = rows.length;
  };

  try {
    // ── 1. Clean prior seed rows (FK-safe order). ──────────────────────────
    // Deleting the events cascades their participants, deals, deal_parties,
    // budgets, budget_lines, settlements and transfers. Deleting the profiles
    // cascades their members. The operator user is never touched.
    // Delete children that FK-reference event_participants BEFORE the events
    // cascade removes those participants (deal_parties.participant_id and
    // settlements.participant_id are NO ACTION, so they'd otherwise block).
    const eventIds = Object.values(EVENT_IDS);
    const dealIds = Object.values(DEAL_IDS);
    const groupIds = Object.values(GROUP_IDS);
    // Operator "app furniture" first — invoices reference settlement transfers /
    // budget lines (NO ACTION), and tasks/calendar_items reference the operator
    // profile (NO ACTION), so they must be gone before those rows are removed.
    await database.delete(schema.invoices).where(inArray(schema.invoices.id, [...INVOICE_IDS]));
    await database
      .delete(schema.bookingRequests)
      .where(inArray(schema.bookingRequests.id, [...BOOKING_REQUEST_IDS]));
    await database.delete(schema.contacts).where(inArray(schema.contacts.id, [...CONTACT_IDS]));
    await database.delete(schema.tasks).where(inArray(schema.tasks.id, [...TASK_IDS]));
    await database
      .delete(schema.calendarItems)
      .where(inArray(schema.calendarItems.id, [...CALENDAR_ITEM_IDS]));
    await database
      .delete(schema.groupProfiles)
      .where(inArray(schema.groupProfiles.id, [...GROUP_PROFILE_IDS]));
    await database
      .delete(schema.groupMembers)
      .where(inArray(schema.groupMembers.id, [...GROUP_MEMBER_IDS])); // → groups (cascade, but explicit)
    await database.delete(schema.groups).where(inArray(schema.groups.id, groupIds));
    await database
      .delete(schema.settlementTransfers)
      .where(inArray(schema.settlementTransfers.eventId, eventIds)); // → event_participants (no action)
    await database.delete(schema.settlements).where(inArray(schema.settlements.eventId, eventIds)); // → event_participants
    const budgetIds = Object.values(BUDGET_IDS);
    await database
      .delete(schema.budgetLines)
      .where(inArray(schema.budgetLines.budgetId, budgetIds)); // → deals (no action)
    await database.delete(schema.budgets).where(inArray(schema.budgets.id, budgetIds));
    await database.delete(schema.dealParties).where(inArray(schema.dealParties.dealId, dealIds)); // → event_participants
    await database.delete(schema.deals).where(inArray(schema.deals.id, dealIds));
    await database.delete(schema.events).where(inArray(schema.events.id, eventIds)); // cascades event_participants
    await database
      .delete(schema.profiles)
      .where(inArray(schema.profiles.id, [OPERATOR_PROFILE_ID, PERFORMER_PROFILE_ID]));
    await database.delete(schema.users).where(inArray(schema.users.id, [PERFORMER_USER_ID]));

    // ── 2. Users. Operator: create only if missing (never overwrite). ──────
    await database
      .insert(schema.users)
      .values({
        id: operatorUserId,
        email: "claude-verify@showme.test",
        name: "The Lantern Hall (operator)",
        kind: "operator",
        currency: SEK,
        country: "SE",
        timezone: "Europe/Stockholm",
      })
      .onConflictDoNothing();

    await database.insert(schema.users).values({
      id: PERFORMER_USER_ID,
      email: "marlo.vance@showme.test",
      name: "Marlo Vance",
      kind: "performer",
      currency: SEK,
      country: "SE",
      timezone: "Europe/Stockholm",
    });

    // ── 3. Profiles: operator (venue/promoter) + performer counterparty. ───
    const operatorProfile = await database
      .insert(schema.profiles)
      .values({
        id: OPERATOR_PROFILE_ID,
        kind: "operator",
        type: "venue",
        ownerUserId: operatorUserId,
        name: "The Lantern Hall",
        slug: "the-lantern-hall",
        isPublic: true,
        bio: "A 400-cap live music venue in Södermalm, Stockholm.",
        claimedAt: new Date(),
        createdBy: operatorUserId,
        billing: {
          legal_name: "Lantern Hall AB",
          vat_id: "SE556000000001",
          vat_rate: 25,
          invoice_number_seq: 1,
        },
        details: { website: "https://lanternhall.example", instagram: "@lanternhall" },
      })
      .returning({ id: schema.profiles.id });
    record("profiles.operator", operatorProfile);

    const performerProfile = await database
      .insert(schema.profiles)
      .values({
        id: PERFORMER_PROFILE_ID,
        kind: "performer",
        type: "band",
        ownerUserId: PERFORMER_USER_ID,
        name: "Marlo Vance",
        slug: "marlo-vance",
        isPublic: true,
        bio: "Indie-folk songwriter touring the Nordics.",
        claimedAt: new Date(),
        createdBy: PERFORMER_USER_ID,
        details: { spotify: "https://open.spotify.example/marlo-vance" },
      })
      .returning({ id: schema.profiles.id });
    record("profiles.performer", performerProfile);

    // Primary location for the operator (discovery queries read this).
    await database.insert(schema.profileLocations).values({
      profileId: OPERATOR_PROFILE_ID,
      city: "Stockholm",
      country: "SE",
      isPrimary: true,
    });

    // ── 4. Profile members — make each owner user the profile owner. ───────
    const members = await database
      .insert(schema.profileMembers)
      .values([
        {
          profileId: OPERATOR_PROFILE_ID,
          userId: operatorUserId,
          role: "owner",
          displayName: "The Lantern Hall",
          status: "active",
          seatConsumed: true,
          addedBy: operatorUserId,
        },
        {
          profileId: PERFORMER_PROFILE_ID,
          userId: PERFORMER_USER_ID,
          role: "owner",
          displayName: "Marlo Vance",
          status: "active",
          seatConsumed: true,
          addedBy: PERFORMER_USER_ID,
        },
      ])
      .returning({ id: schema.profileMembers.id });
    record("profile_members", members);

    // ── 5. Events — varied status; dates computed from the day the seed runs. ─
    // Absolute dates rotted: the "upcoming" draft below had already slid into the
    // past, and with it the whole premise that this fixture shows a live pipeline.
    // The offsets and the reasoning are in reference-settlement.ts.
    const eventDates = referenceEventDates();

    const events = await database
      .insert(schema.events)
      .values([
        {
          id: EVENT_IDS.albumRelease,
          hostProfileId: OPERATOR_PROFILE_ID,
          title: "Marlo Vance — Album Release",
          status: "confirmed",
          eventDate: eventDates.albumRelease,
          doorTime: "19:00:00",
          startTime: "20:00:00",
          endTime: "23:00:00",
          curfew: "23:30:00",
          timezone: "Europe/Stockholm",
          venueProfileId: OPERATOR_PROFILE_ID,
          venueName: "The Lantern Hall",
          capacity: 400,
          baseCurrency: SEK,
          published: true,
          notes: "Headline release show. Support TBC.",
          createdBy: operatorUserId,
        },
        {
          id: EVENT_IDS.springWarmup,
          hostProfileId: OPERATOR_PROFILE_ID,
          title: "Spring Warmup",
          status: "concluded",
          eventDate: eventDates.springWarmup,
          doorTime: "18:30:00",
          startTime: "19:30:00",
          endTime: "22:30:00",
          timezone: "Europe/Stockholm",
          venueProfileId: OPERATOR_PROFILE_ID,
          venueName: "The Lantern Hall",
          capacity: 400,
          baseCurrency: SEK,
          published: true,
          notes: "Sold well — settlement completed.",
          createdBy: operatorUserId,
        },
        {
          id: EVENT_IDS.openMic,
          hostProfileId: OPERATOR_PROFILE_ID,
          title: "Open Mic Wednesdays",
          status: "draft",
          eventDate: eventDates.openMic,
          doorTime: "18:00:00",
          startTime: "19:00:00",
          timezone: "Europe/Stockholm",
          venueProfileId: OPERATOR_PROFILE_ID,
          venueName: "The Lantern Hall (Back Room)",
          capacity: 80,
          baseCurrency: SEK,
          published: false,
          createdBy: operatorUserId,
        },
        {
          id: EVENT_IDS.synthShowcase,
          hostProfileId: OPERATOR_PROFILE_ID,
          title: "Nordic Synth Showcase",
          status: "on_hold",
          eventDate: eventDates.synthShowcase,
          doorTime: "19:00:00",
          startTime: "20:00:00",
          timezone: "Europe/Stockholm",
          venueProfileId: OPERATOR_PROFILE_ID,
          venueName: "The Lantern Hall",
          capacity: 400,
          baseCurrency: SEK,
          published: false,
          holdRank: 1,
          holdAutoPromote: true,
          notes: "First hold — awaiting artist confirmation.",
          createdBy: operatorUserId,
        },
        {
          id: EVENT_IDS.winterGala,
          hostProfileId: OPERATOR_PROFILE_ID,
          title: "Winter Gala",
          status: "cancelled",
          eventDate: eventDates.winterGala,
          timezone: "Europe/Stockholm",
          venueProfileId: OPERATOR_PROFILE_ID,
          venueName: "The Lantern Hall",
          capacity: 400,
          baseCurrency: SEK,
          published: false,
          notes: "Cancelled — venue double-booked.",
          createdBy: operatorUserId,
        },
      ])
      .returning({ id: schema.events.id });
    record("events", events);

    // ── 5b. The operator's permission set (grants budget.view etc.). ───────
    await database.insert(schema.permissionSets).values({
      id: OPERATOR_PERMISSION_SET_ID,
      profileId: OPERATOR_PROFILE_ID,
      name: "Operator — full",
      description: "Full operator control (operator_full preset).",
      capabilities: OPERATOR_FULL_CAPABILITIES,
    });

    // ── 6. Event participants — host + performer on the two full events. ───
    const participants = await database
      .insert(schema.eventParticipants)
      .values([
        {
          id: PART.e1Host,
          eventId: EVENT_IDS.albumRelease,
          profileId: OPERATOR_PROFILE_ID,
          role: "host",
          permissionSetId: OPERATOR_PERMISSION_SET_ID,
          status: "confirmed",
          addedBy: operatorUserId,
        },
        {
          id: PART.e1Perf,
          eventId: EVENT_IDS.albumRelease,
          profileId: PERFORMER_PROFILE_ID,
          role: "performer",
          performerTag: "headliner",
          status: "confirmed",
          addedBy: operatorUserId,
        },
        {
          id: PART.e2Host,
          eventId: EVENT_IDS.springWarmup,
          profileId: OPERATOR_PROFILE_ID,
          role: "host",
          permissionSetId: OPERATOR_PERMISSION_SET_ID,
          status: "confirmed",
          addedBy: operatorUserId,
        },
        {
          id: PART.e2Perf,
          eventId: EVENT_IDS.springWarmup,
          profileId: PERFORMER_PROFILE_ID,
          role: "performer",
          performerTag: "headliner",
          status: "confirmed",
          addedBy: operatorUserId,
        },
        {
          id: PART.e3Host,
          eventId: EVENT_IDS.openMic,
          profileId: OPERATOR_PROFILE_ID,
          role: "host",
          permissionSetId: OPERATOR_PERMISSION_SET_ID,
          status: "confirmed",
          addedBy: operatorUserId,
        },
        {
          id: PART.e4Host,
          eventId: EVENT_IDS.synthShowcase,
          profileId: OPERATOR_PROFILE_ID,
          role: "host",
          permissionSetId: OPERATOR_PERMISSION_SET_ID,
          status: "confirmed",
          addedBy: operatorUserId,
        },
        {
          id: PART.e5Host,
          eventId: EVENT_IDS.winterGala,
          profileId: OPERATOR_PROFILE_ID,
          role: "host",
          permissionSetId: OPERATOR_PERMISSION_SET_ID,
          status: "confirmed",
          addedBy: operatorUserId,
        },
      ])
      .returning({ id: schema.eventParticipants.id });
    record("event_participants", participants);

    // ── 6b. Setlists — one per performer participant, so the operator's
    //        PRO-royalty screen (Performance Reports) has real songs to file.
    //        Cascades with the event on delete, so no separate cleanup needed.
    const setlists = await database
      .insert(schema.setlists)
      .values([
        {
          eventId: EVENT_IDS.albumRelease,
          participantId: PART.e1Perf,
          items: [
            { title: "Neon Rooftops", duration: 245 },
            { title: "Paper Districts", duration: 198 },
            { title: "Slow Return", duration: 276 },
            { title: "Ember (title track)", duration: 312 },
            { title: "Long Way Home", duration: 224 },
          ],
        },
        {
          eventId: EVENT_IDS.springWarmup,
          participantId: PART.e2Perf,
          items: [
            { title: "Opening Bloom", duration: 210 },
            { title: "Warm Front", duration: 188 },
            { title: "Aster", duration: 240 },
            { title: "Green Hour", duration: 205 },
          ],
        },
      ])
      .returning({ id: schema.setlists.id });
    record("setlists", setlists);

    // ── 7. Deals (+ parties) — operator pays performer. ────────────────────
    const deals = await database
      .insert(schema.deals)
      .values([
        {
          id: DEAL_IDS.e1,
          eventId: EVENT_IDS.albumRelease,
          type: "performance",
          structure: REFERENCE_GUARANTEE_TERMS.structure,
          currency: SEK,
          name: "Marlo Vance — Guarantee",
          payerParticipantId: PART.e1Host,
          paymentTiming: "at_settlement",
          // Deal-level, because that is what the engine reads to size a guarantee.
          guaranteeAmount: REFERENCE_GUARANTEE_TERMS.guaranteeAmount, // 25 000.00 SEK
          advanceAmount: 500000n, // 5 000.00 SEK paid in advance
          agreementStatus: "confirmed",
          status: "confirmed",
          createdBy: operatorUserId,
        },
        {
          id: DEAL_IDS.e2,
          eventId: EVENT_IDS.springWarmup,
          type: "performance",
          structure: "guarantee_vs_door",
          currency: SEK,
          name: "Marlo Vance — Guarantee vs Door",
          payerParticipantId: PART.e2Host,
          paymentTiming: "at_settlement",
          // The signed terms live in reference-settlement.ts, which is also what
          // derives the settlement below — one statement of the deal, not two.
          guaranteeAmount: REFERENCE_GUARANTEE_VS_DOOR_TERMS.guaranteeAmount, // 18 000.00 SEK floor
          splitBasisPoints: REFERENCE_GUARANTEE_VS_DOOR_TERMS.splitBasisPoints, // 70.00% OF THE POOL
          agreementStatus: "signed",
          status: "confirmed",
          createdBy: operatorUserId,
        },
      ])
      .returning({ id: schema.deals.id });
    record("deals", deals);

    const dealParties = await database
      .insert(schema.dealParties)
      .values([
        { dealId: DEAL_IDS.e1, participantId: PART.e1Host, roleInDeal: "payer" },
        {
          dealId: DEAL_IDS.e1,
          participantId: PART.e1Perf,
          roleInDeal: "payee",
          confirmedAt: new Date(),
          confirmedBy: PERFORMER_USER_ID,
          share: {
            illustrativeAmount: REFERENCE_GUARANTEE_TERMS.guaranteeAmount.toString(),
            currency: SEK,
          },
        },
        { dealId: DEAL_IDS.e2, participantId: PART.e2Host, roleInDeal: "payer" },
        {
          dealId: DEAL_IDS.e2,
          participantId: PART.e2Perf,
          roleInDeal: "payee",
          confirmedAt: new Date(),
          confirmedBy: PERFORMER_USER_ID,
          share: {
            illustrativeAmount: REFERENCE_GUARANTEE_VS_DOOR_TERMS.guaranteeAmount.toString(),
            splitBasisPoints: REFERENCE_GUARANTEE_VS_DOOR_TERMS.splitBasisPoints,
            currency: SEK,
          },
        },
      ])
      .returning({ id: schema.dealParties.id });
    record("deal_parties", dealParties);

    // ── 8. Budgets — the settled record, plus the two forward-looking ones. ─
    // A budget on the concluded event alone gave the Financial Projections screen
    // nothing to sum under either of its forward-looking scopes ("Confirmed",
    // "Upcoming"), so a screen whose whole job is a forward P&L across the pipeline
    // showed a dash. The two live future events therefore carry budgets too: the
    // confirmed release SHARED (its performer is signed to this money), the hold
    // PRIVATE (nothing is signed, so the costing is the venue's own). The draft and
    // the cancelled date stay unbudgeted — both are honest states, and they keep the
    // screen's partial-coverage note exercised.
    const budgets = await database
      .insert(schema.budgets)
      .values([
        { id: BUDGET_IDS.springWarmup, eventId: EVENT_IDS.springWarmup, scope: "shared" },
        { id: BUDGET_IDS.albumRelease, eventId: EVENT_IDS.albumRelease, scope: "shared" },
        {
          id: BUDGET_IDS.synthShowcaseHold,
          eventId: EVENT_IDS.synthShowcase,
          scope: "private",
          ownerProfileId: OPERATOR_PROFILE_ID, // required for `private`, and the point of it
        },
      ])
      .returning({ id: schema.budgets.id });
    record("budgets", budgets);

    // The external cash of the reference event: 78 000 door collected by the operator,
    // a 9 000 external supplier cost, and an 1 800 hotel booked FOR the performer (a
    // deductible, not a pool cost). Shared with seed-e2e.ts and with the settlement
    // derivation below — see reference-settlement.ts.
    const REFERENCE_SPINE = {
      hostParticipantId: PART.e2Host,
      performerParticipantId: PART.e2Perf,
      dealId: DEAL_IDS.e2,
    };

    // Every figure comes from reference-settlement.ts, never from here (audit A-13).
    const budgetLines = await database
      .insert(schema.budgetLines)
      .values([
        ...referenceBudgetLines(REFERENCE_SPINE).map((line) => ({
          budgetId: BUDGET_IDS.springWarmup,
          source: "manual" as const,
          ...line,
        })),
        ...referenceAlbumReleaseBudgetLines({
          hostParticipantId: PART.e1Host,
          dealId: DEAL_IDS.e1,
        }).map((line) => ({
          budgetId: BUDGET_IDS.albumRelease,
          source: "manual" as const,
          ...line,
        })),
        // No `dealId` on the hold's lines: there is no deal to assign them to yet.
        ...referenceHoldBudgetLines({ hostParticipantId: PART.e4Host }).map((line) => ({
          budgetId: BUDGET_IDS.synthShowcaseHold,
          source: "manual" as const,
          ...line,
        })),
      ])
      .returning({
        id: schema.budgetLines.id,
        budgetId: schema.budgetLines.budgetId,
        label: schema.budgetLines.label,
      });
    record("budget_lines", budgetLines);

    // One settlement per participant, DERIVED by the settlement engine from the deal
    // and the budget lines above — never typed by hand (audit A-13). `computed` is
    // the exact `SerializedBreakdown` the API reads back, so the seeded rows satisfy
    // `GET /events/:id/settlements` the same way a real compute would.
    //   pool 69 000 = 78 000 door − 9 000 external cost
    //   performer   max(18 000, 70% × 69 000 = 48 300) − 1 800 hotel = 46 500
    //   operator    residual 20 700 − 67 200 held = −46 500          (Σ net = 0)
    const referenceResult = referenceSettlement(REFERENCE_SPINE);

    const settlements = await database
      .insert(schema.settlements)
      .values([
        {
          id: SETTLEMENT_IDS.springOperator,
          eventId: EVENT_IDS.springWarmup,
          participantId: PART.e2Host,
          status: "finalized",
          computed: storeBreakdown(
            breakdownFor(referenceResult, PART.e2Host),
            referenceResult.ladder,
          ),
        },
        {
          id: SETTLEMENT_IDS.springPerformer,
          eventId: EVENT_IDS.springWarmup,
          participantId: PART.e2Perf,
          status: "finalized",
          computed: storeBreakdown(
            breakdownFor(referenceResult, PART.e2Perf),
            referenceResult.ladder,
          ),
        },
      ])
      .returning({ id: schema.settlements.id });
    record("settlements", settlements);

    // The owed transfers the engine matched — one here: operator → performer 46 500.
    const transfers = await database
      .insert(schema.settlementTransfers)
      .values(
        referenceResult.transfers.map((transfer) => ({
          eventId: EVENT_IDS.springWarmup,
          fromParticipant: transfer.fromParticipantId,
          toParticipant: transfer.toParticipantId,
          amount: transfer.amount,
          currency: SEK,
          state: "owed" as const,
        })),
      )
      .returning({ id: schema.settlementTransfers.id });
    record("settlement_transfers", transfers);

    // ── 9. Incoming booking requests (operator inbox). ─────────────────────
    const bookingRequests = await database
      .insert(schema.bookingRequests)
      .values([
        {
          id: BOOKING_REQUEST_IDS[0],
          source: "public_form",
          status: "pending",
          targetProfileId: OPERATOR_PROFILE_ID,
          contactName: "Anders Berg",
          email: "anders@midnightecho.example",
          phone: "+46 70 123 45 67",
          artistName: "The Midnight Echo",
          wantedDate: dateOffsetFromToday(38),
          artistFee: 3000000n, // 30 000.00 SEK asking fee
          pitch:
            "Four-piece indie rock, just wrapped a Nordic club tour. Would love a Friday slot.",
          note: "Self-booked — no agency.",
          senderType: "performer",
          performerType: "band",
          genres: ["indie rock", "post-punk"],
          websiteUrl: "https://midnightecho.example",
          socialLinks: {
            instagram: "@midnightecho",
            spotify: "https://open.spotify.example/midnightecho",
          },
          musicUrl: "https://open.spotify.example/midnightecho",
          sentVia: "in_platform",
        },
        {
          id: BOOKING_REQUEST_IDS[1],
          source: "performer_offer",
          status: "pending",
          targetProfileId: OPERATOR_PROFILE_ID,
          senderUserId: PERFORMER_USER_ID,
          senderProfileId: PERFORMER_PROFILE_ID,
          contactName: "Marlo Vance",
          email: "marlo.vance@showme.test",
          artistName: "Marlo Vance",
          wantedDate: dateOffsetFromToday(53),
          offerFeeMin: 2000000n, // 20 000.00 SEK
          offerFeeMax: 2800000n, // 28 000.00 SEK
          pitch:
            "Second Stockholm date to support the new record — flexible on the fee for a good room.",
          note: "Represented by Blue Owl Agency.",
          senderType: "performer",
          performerType: "solo",
          genres: ["indie-folk"],
          sentVia: "in_platform",
        },
        {
          id: BOOKING_REQUEST_IDS[2],
          source: "public_form",
          status: "accepted",
          targetProfileId: OPERATOR_PROFILE_ID,
          contactName: "Lena Fors",
          email: "booking@lenaforsquartet.example",
          phone: "+46 73 987 65 43",
          artistName: "Lena Fors Quartet",
          wantedDate: dateOffsetFromToday(32),
          artistFee: 1500000n, // 15 000.00 SEK
          pitch: "Acoustic jazz quartet, seated show. Confirmed and looking forward to it.",
          note: "Handled by Söder Live agency.",
          senderType: "performer",
          performerType: "band",
          genres: ["jazz", "acoustic"],
          sentVia: "in_platform",
        },
        {
          id: BOOKING_REQUEST_IDS[3],
          source: "venue_handoff",
          status: "declined",
          targetProfileId: OPERATOR_PROFILE_ID,
          contactName: "DJ Frostbite",
          email: "frostbite@coldwax.example",
          artistName: "DJ Frostbite",
          // The very night the Open Mic draft occupies — which is WHY the note below
          // says it clashes. Pinning it to the same computed date keeps the reason true.
          wantedDate: eventDates.openMic,
          artistFee: 800000n, // 8 000.00 SEK
          pitch: "Late-night techno set. Passed over from Klubb Nord.",
          note: "Declined — clashes with Open Mic night.",
          senderType: "performer",
          performerType: "dj",
          genres: ["techno"],
          sentVia: "mailto",
        },
        {
          id: BOOKING_REQUEST_IDS[4],
          source: "public_form",
          status: "flagged",
          targetProfileId: OPERATOR_PROFILE_ID,
          contactName: "MegaPromo Bookings",
          email: "deals@megapromo.example",
          artistName: "Various Artists",
          wantedDate: dateOffsetFromToday(80),
          pitch: "GUARANTEED SELLOUT!!! Book 20 of our acts now for a special rate, reply ASAP!!!",
          note: "Auto-flagged — bulk/spam pattern.",
          senderType: "agency",
          sentVia: "in_platform",
        },
      ])
      .returning({ id: schema.bookingRequests.id });
    record("booking_requests", bookingRequests);

    // ── 10. Address book — the operator's contacts. ────────────────────────
    const contacts = await database
      .insert(schema.contacts)
      .values([
        {
          id: CONTACT_IDS[0],
          ownerProfileId: OPERATOR_PROFILE_ID,
          name: "Nordic Sound Rentals AB",
          type: "supplier",
          iban: "SE45 5000 0000 0583 9825 7466",
          bankName: "SEB",
          vatId: "SE556200100001",
          address: "Industrigatan 4, 117 45 Stockholm",
          notes: "PA + backline hire. Net-30 terms.",
          persons: [
            { name: "Erik Sund", email: "erik@nordicsound.example", phone: "+46 8 555 010 20" },
          ],
        },
        {
          id: CONTACT_IDS[1],
          ownerProfileId: OPERATOR_PROFILE_ID,
          name: "Marlo Vance Management",
          type: "artist",
          vatId: "SE556200100002",
          notes: "Marlo's booking + settlement contact.",
          persons: [
            { name: "Marlo Vance", email: "marlo.vance@showme.test", phone: "+46 70 222 33 44" },
            {
              name: "Nora Ek (manager)",
              email: "nora@marlovance.example",
              phone: "+46 70 222 33 45",
            },
          ],
        },
        {
          id: CONTACT_IDS[2],
          ownerProfileId: OPERATOR_PROFILE_ID,
          name: "STIM",
          type: "authority",
          notes: "Performing-rights reporting (Swedish PRO).",
          persons: [
            { name: "Reporting desk", email: "reporting@stim.example", phone: "+46 8 783 88 00" },
          ],
        },
        {
          id: CONTACT_IDS[3],
          ownerProfileId: OPERATOR_PROFILE_ID,
          name: "Söder Catering",
          type: "supplier",
          iban: "SE35 5000 0000 0549 1000 0003",
          bankName: "Swedbank",
          vatId: "SE556200100003",
          address: "Hornsgatan 88, 118 21 Stockholm",
          notes: "Green-room hospitality + artist meals.",
          persons: [
            { name: "Amir Haddad", email: "amir@sodercatering.example", phone: "+46 8 640 11 22" },
          ],
        },
        {
          id: CONTACT_IDS[4],
          ownerProfileId: OPERATOR_PROFILE_ID,
          name: "Klara Nyström",
          type: "crew",
          notes: "Freelance FOH engineer — first call for seated shows.",
          persons: [
            { name: "Klara Nyström", email: "klara@foh.example", phone: "+46 76 300 40 50" },
          ],
        },
        {
          id: CONTACT_IDS[5],
          ownerProfileId: OPERATOR_PROFILE_ID,
          name: "City Print & Design",
          type: "supplier",
          iban: "SE12 8000 0000 0102 3456 7890",
          bankName: "Handelsbanken",
          vatId: "SE556200100004",
          address: "Sveavägen 21, 111 34 Stockholm",
          notes: "Posters, tickets, flyers.",
          persons: [
            { name: "Petra Holm", email: "petra@cityprint.example", phone: "+46 8 411 22 33" },
          ],
        },
        {
          id: CONTACT_IDS[6],
          ownerProfileId: OPERATOR_PROFILE_ID,
          name: "Blue Owl Agency",
          type: "agency",
          vatId: "SE556200100005",
          address: "Götgatan 15, 116 46 Stockholm",
          notes: "Booking agent — represents several touring acts.",
          persons: [
            { name: "Sofia Lind", email: "sofia@blueowl.example", phone: "+46 70 900 80 70" },
          ],
        },
        {
          id: CONTACT_IDS[7],
          ownerProfileId: OPERATOR_PROFILE_ID,
          name: "Security Partners AB",
          type: "supplier",
          iban: "SE99 9000 0000 0000 1234 5678",
          bankName: "Nordea",
          vatId: "SE556200100006",
          notes: "Door + crowd security staffing.",
          persons: [
            { name: "Jonas Ek", email: "jonas@securitypartners.example", phone: "+46 8 700 60 50" },
          ],
        },
      ])
      .returning({ id: schema.contacts.id });
    record("contacts", contacts);

    // ── 11. Reusable teams (Team screen) — groups + members + profile link. ─
    const groups = await database
      .insert(schema.groups)
      .values([
        { id: GROUP_IDS.coreCrew, ownerUserId: operatorUserId, name: "Core Crew" },
        { id: GROUP_IDS.frontOfHouse, ownerUserId: operatorUserId, name: "Front of House Team" },
      ])
      .returning({ id: schema.groups.id });
    record("groups", groups);

    const groupMembers = await database
      .insert(schema.groupMembers)
      .values([
        // Core Crew — one on-platform (the operator owner) + off-platform crew.
        {
          id: GROUP_MEMBER_IDS[0],
          groupId: GROUP_IDS.coreCrew,
          userId: operatorUserId,
          email: "claude-verify@showme.test",
          roleLabel: "Venue Manager",
        },
        {
          id: GROUP_MEMBER_IDS[1],
          groupId: GROUP_IDS.coreCrew,
          email: "klara@foh.example",
          roleLabel: "FOH Engineer",
        },
        {
          id: GROUP_MEMBER_IDS[2],
          groupId: GROUP_IDS.coreCrew,
          email: "tobias@stagehands.example",
          roleLabel: "Stage Manager",
        },
        {
          id: GROUP_MEMBER_IDS[3],
          groupId: GROUP_IDS.coreCrew,
          email: "jonas@securitypartners.example",
          roleLabel: "Head of Security",
        },
        // Front of House Team — off-platform bar staff.
        {
          id: GROUP_MEMBER_IDS[4],
          groupId: GROUP_IDS.frontOfHouse,
          email: "vera@lanternhall.example",
          roleLabel: "Bar Lead",
        },
        {
          id: GROUP_MEMBER_IDS[5],
          groupId: GROUP_IDS.frontOfHouse,
          email: "milo@lanternhall.example",
          roleLabel: "Box Office",
        },
      ])
      .returning({ id: schema.groupMembers.id });
    record("group_members", groupMembers);

    const groupProfiles = await database
      .insert(schema.groupProfiles)
      .values([
        { id: GROUP_PROFILE_IDS[0], groupId: GROUP_IDS.coreCrew, profileId: OPERATOR_PROFILE_ID },
        {
          id: GROUP_PROFILE_IDS[1],
          groupId: GROUP_IDS.frontOfHouse,
          profileId: OPERATOR_PROFILE_ID,
        },
      ])
      .returning({ id: schema.groupProfiles.id });
    record("group_profiles", groupProfiles);

    // ── 12. Bills & invoices — AR (issued) + AP (received), varied state. ──
    // Found by label, not by position: the budget insert above now spans three
    // events, so an index into it would silently point at another event's money the
    // next time a line is added.
    const soundProductionLine = budgetLines.find(
      (line) => line.budgetId === BUDGET_IDS.springWarmup && line.label === "Sound & production",
    );
    if (!soundProductionLine) {
      throw new Error(
        "The concluded event's 'Sound & production' line is missing — the supplier bill has nothing to settle against.",
      );
    }
    const invoices = await database
      .insert(schema.invoices)
      .values([
        {
          id: INVOICE_IDS[0],
          ownerProfileId: OPERATOR_PROFILE_ID,
          eventId: EVENT_IDS.albumRelease,
          direction: "issued", // AR — we're billing the artist side
          recipientRef: "Marlo Vance Management",
          number: "LH-2026-014",
          currency: SEK,
          lineItems: [{ label: "Venue hire — Album Release", quantity: 1, unitAmount: "4000000" }],
          vat: { rate: 25, amount: "1000000" },
          total: 5000000n, // 50 000.00 SEK incl. VAT
          issuedAt: new Date(`${dateOffsetFromToday(-10)}T09:00:00Z`),
          dueDate: dateOffsetFromToday(25), // shortly after the show
          state: "sent",
        },
        {
          id: INVOICE_IDS[1],
          ownerProfileId: OPERATOR_PROFILE_ID,
          eventId: EVENT_IDS.springWarmup,
          direction: "received", // AP — a supplier bill we owe
          issuerRef: "Nordic Sound Rentals AB",
          budgetLineId: soundProductionLine.id,
          number: "NSR-4471",
          currency: SEK,
          lineItems: [{ label: "PA + backline hire", quantity: 1, unitAmount: "720000" }],
          vat: { rate: 25, amount: "180000" },
          total: 900000n, // 9 000.00 SEK incl. VAT
          issuedAt: new Date(`${dateOffsetFromToday(-128)}T09:00:00Z`),
          // Past due, which is what makes `overdue` an honest state rather than a
          // label contradicting its own date.
          dueDate: dateOffsetFromToday(-108),
          state: "overdue",
        },
        {
          id: INVOICE_IDS[2],
          ownerProfileId: OPERATOR_PROFILE_ID,
          eventId: EVENT_IDS.springWarmup,
          direction: "issued", // AR — bar/hire recharge, already paid
          recipientRef: "Söder Live",
          number: "LH-2026-009",
          currency: SEK,
          lineItems: [{ label: "Co-promotion recharge", quantity: 1, unitAmount: "1000000" }],
          vat: { rate: 25, amount: "250000" },
          total: 1250000n, // 12 500.00 SEK incl. VAT
          issuedAt: new Date(`${dateOffsetFromToday(-125)}T09:00:00Z`),
          dueDate: dateOffsetFromToday(-95),
          state: "paid",
        },
      ])
      .returning({ id: schema.invoices.id });
    record("invoices", invoices);

    // ── 13. Tasks — event / profile / personal scope, varied done state. ───
    const tasks = await database
      .insert(schema.tasks)
      .values([
        {
          id: TASK_IDS[0],
          eventId: EVENT_IDS.albumRelease,
          ownerProfileId: OPERATOR_PROFILE_ID,
          title: "Confirm PA hire for Album Release",
          description: "Get written confirmation from Nordic Sound Rentals for the 12th.",
          dueDate: dateOffsetFromToday(6),
          budgetType: "production",
          budgetAmount: 900000n,
          createdBy: operatorUserId,
        },
        {
          id: TASK_IDS[1],
          eventId: EVENT_IDS.albumRelease,
          ownerProfileId: OPERATOR_PROFILE_ID,
          title: "Send stage plot to Marlo Vance",
          completed: true,
          completedAt: new Date(`${dateOffsetFromToday(-12)}T14:00:00Z`),
          createdBy: operatorUserId,
        },
        {
          id: TASK_IDS[2],
          ownerUserId: operatorUserId,
          title: "Renew venue liability insurance",
          description: "Personal reminder — policy lapses in September.",
          dueDate: dateOffsetFromToday(21),
          createdBy: operatorUserId,
        },
        {
          id: TASK_IDS[3],
          eventId: EVENT_IDS.springWarmup,
          ownerProfileId: OPERATOR_PROFILE_ID,
          title: "Finalize Spring Warmup settlement",
          completed: true,
          completedAt: new Date(`${dateOffsetFromToday(-123)}T18:30:00Z`),
          createdBy: operatorUserId,
        },
        {
          id: TASK_IDS[4],
          eventId: EVENT_IDS.openMic,
          ownerProfileId: OPERATOR_PROFILE_ID,
          title: "Book door security for Open Mic",
          dueDate: dateOffsetFromToday(4),
          createdBy: operatorUserId,
        },
        {
          id: TASK_IDS[5],
          eventId: EVENT_IDS.synthShowcase,
          ownerProfileId: OPERATOR_PROFILE_ID,
          title: "Chase artist confirmation on Synth Showcase hold",
          description: "First hold expires soon — confirm or release.",
          dueDate: dateOffsetFromToday(30),
          createdBy: operatorUserId,
        },
      ])
      .returning({ id: schema.tasks.id });
    record("tasks", tasks);

    // ── 14. Calendar items — operator's own agenda, Aug–Oct 2026. ──────────
    const calendarItems = await database
      .insert(schema.calendarItems)
      .values([
        {
          id: CALENDAR_ITEM_IDS[0],
          ownerProfileId: OPERATOR_PROFILE_ID,
          ownerUserId: operatorUserId,
          type: "appointment",
          title: "Site visit — Nordic Synth Showcase",
          date: dateOffsetFromToday(3),
          startTime: "11:00:00",
          endTime: "12:30:00",
          entity: "Nordic Synth Showcase",
          assigneeUserId: operatorUserId,
          assigneeName: "The Lantern Hall",
        },
        {
          id: CALENDAR_ITEM_IDS[1],
          ownerProfileId: OPERATOR_PROFILE_ID,
          ownerUserId: operatorUserId,
          type: "task",
          title: "Advance Album Release with the artist",
          date: dateOffsetFromToday(10), // a week before the show
        },
        {
          id: CALENDAR_ITEM_IDS[2],
          ownerProfileId: OPERATOR_PROFILE_ID,
          ownerUserId: operatorUserId,
          type: "appointment",
          title: "Meeting with Blue Owl Agency",
          date: dateOffsetFromToday(27),
          startTime: "15:00:00",
          endTime: "16:00:00",
          assigneeName: "Sofia Lind",
        },
        {
          id: CALENDAR_ITEM_IDS[3],
          ownerProfileId: OPERATOR_PROFILE_ID,
          ownerUserId: operatorUserId,
          type: "note",
          title: "STIM performance report deadline",
          date: dateOffsetFromToday(50),
        },
      ])
      .returning({ id: schema.calendarItems.id });
    record("calendar_items", calendarItems);

    // ── Summary ────────────────────────────────────────────────────────────
    console.log("\nSeed complete for operator user:", operatorUserId);
    console.log("Inserted rows:");
    for (const [label, count] of Object.entries(counts)) {
      console.log(`  ${label.padEnd(24)} ${count}`);
    }
    console.log(`\nOperator profile: ${OPERATOR_PROFILE_ID} (The Lantern Hall)`);
    console.log(`Performer profile: ${PERFORMER_PROFILE_ID} (Marlo Vance)`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
