import {
  serializeCommissionSnapshot,
  settleRepresentation,
  storeBreakdown,
} from "@showme/settlement";
import { E2E_ACCOUNTS } from "@showme/shared";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  REFERENCE_DOOR_SPLIT_SHARES,
  REFERENCE_DOOR_SPLIT_TERMS,
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
 * End-to-end test seed — a self-contained, deterministic Postgres dataset that
 * provisions ALL FOUR account kinds as real, cross-wired, log-in-able accounts so
 * the Playwright harness can validate every kind's flows, including two users
 * interacting on the same event.
 *
 * Run with a reachable Postgres:
 *   DATABASE_URL=postgres://user:pass@host:5432/db pnpm --filter @showme/db seed:e2e
 *
 * The linchpin (see `@showme/shared` e2e-accounts): Postgres stores the Firebase
 * uid as `users.id`, so each E2E account's `uid` IS its `users.id`. We use those
 * uids verbatim so this seed aligns with the Firebase Auth emulator users seeded
 * elsewhere. The five accounts own everything; every other row uses a
 * deterministic "e2e0…" id (analogous to seed.ts's "5eed…") so re-runs
 * delete-then-insert cleanly in FK-safe order and the script is idempotent.
 *
 * Mirrors seed.ts's client construction + clean shutdown (postgres-js directly,
 * closed in `finally`). It never deletes the five users — they are created only
 * if missing (they may already exist from a prior run / the auth emulator sync).
 *
 * The cross-wiring is the point (story.md boundaries):
 *   - operator hosts every event; performerA & performerB are two distinct
 *     performers so a test can exercise performer↔performer isolation on a shared
 *     split deal (each sees ONLY their own line);
 *   - the agent REPRESENTS performerA (a `representations` row) and, on
 *     performerA's in-region event, fans out into an `event_participants(role=agent)`
 *     while performerA's own participation is flagged delegated (view-only floor) —
 *     decisions.md #14 / the authorization skill;
 *   - the team_and_crew is booked as crew (schedule-only), never the budget.
 */

// ── The five E2E accounts (Firebase uid === users.id). Owners of everything. ──
const operatorUserId = E2E_ACCOUNTS.operator.uid;
const performerAUserId = E2E_ACCOUNTS.performerA.uid;
const performerBUserId = E2E_ACCOUNTS.performerB.uid;
const teamAndCrewUserId = E2E_ACCOUNTS.teamAndCrew.uid;
const agentUserId = E2E_ACCOUNTS.agent.uid;

// ── Deterministic ids (marker prefix "e2e0" = e2e) so re-runs are clean. ──────
const PROFILE_IDS = {
  operator: "e2e00000-0000-4000-8000-0000000000a1",
  performerA: "e2e00000-0000-4000-8000-0000000000a2",
  performerB: "e2e00000-0000-4000-8000-0000000000a3",
  teamAndCrew: "e2e00000-0000-4000-8000-0000000000a4",
  agent: "e2e00000-0000-4000-8000-0000000000a5",
} as const;

// The standing agent↔performerA representation (decisions.md #14).
const REPRESENTATION_ID = "e2e00000-0000-4000-8000-000000000001";

const EVENT_IDS = {
  albumRelease: "e2e00000-0000-4000-8000-0000000000e1", // confirmed, upcoming — full (2 performers + crew + agent)
  springWarmup: "e2e00000-0000-4000-8000-0000000000e2", // concluded, past — budget + finalized settlement
  openMic: "e2e00000-0000-4000-8000-0000000000e3", // draft, upcoming
  synthShowcase: "e2e00000-0000-4000-8000-0000000000e4", // on_hold, upcoming
  winterGala: "e2e00000-0000-4000-8000-0000000000e5", // cancelled
} as const;

// Event participants. `b1…b5` are the "full" confirmed event; `b6…b7` the
// concluded event; `b8…ba` are host-only on the lighter events (reachability =
// participation — without a host participant the operator can't reach its own event).
const PART = {
  albumHost: "e2e00000-0000-4000-8000-0000000000b1",
  albumPerformerA: "e2e00000-0000-4000-8000-0000000000b2",
  albumPerformerB: "e2e00000-0000-4000-8000-0000000000b3",
  albumCrew: "e2e00000-0000-4000-8000-0000000000b4",
  albumAgent: "e2e00000-0000-4000-8000-0000000000b5",
  springHost: "e2e00000-0000-4000-8000-0000000000b6",
  springPerformerA: "e2e00000-0000-4000-8000-0000000000b7",
  openMicHost: "e2e00000-0000-4000-8000-0000000000b8",
  synthHost: "e2e00000-0000-4000-8000-0000000000b9",
  winterHost: "e2e00000-0000-4000-8000-0000000000ba",
} as const;

// Permission sets — one per (profile, tier). Cascade with their owning profile on
// delete. Capabilities are the presets from @showme/auth, inlined to avoid a
// db→auth import cycle (mirrors seed.ts's inlined operator_full).
const PERMISSION_SET_IDS = {
  operatorFull: "e2e00000-0000-4000-8000-0000000000c1",
  performerAOwn: "e2e00000-0000-4000-8000-0000000000c2", // performerA's own set (concluded event)
  performerBOwn: "e2e00000-0000-4000-8000-0000000000c3", // performerB's own set (album split)
  crewScheduleOnly: "e2e00000-0000-4000-8000-0000000000c4", // team_and_crew (crew) on album
  agent: "e2e00000-0000-4000-8000-0000000000c5", // agent fan-out on album
} as const;

// PRESET_PERMISSION_SETS.operator_full (@showme/auth), inlined.
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

// PRESET_PERMISSION_SETS.performer (@showme/auth), inlined.
const PERFORMER_CAPABILITIES = [
  "event.view",
  "deal.view.own",
  "settlement.view.own",
  "settlement.confirm",
  "rider.submit",
  "schedule.view",
  "setlist.author",
  "message.post",
];

// PRESET_PERMISSION_SETS.crew_schedule_only (@showme/auth), inlined.
const CREW_SCHEDULE_ONLY_CAPABILITIES = ["event.view", "schedule.view"];

// PRESET_PERMISSION_SETS.agent (@showme/auth) — the fanned-out agent bundle:
// negotiate/approve on the performer's behalf; budget/pool caps are un-grantable
// to an arm's-length party (stripped by the ceiling) regardless.
const AGENT_CAPABILITIES = [
  "event.view",
  "deal.view.own",
  "deal.edit",
  "settlement.view.own",
  "agreement.manage",
  "agreement.confirm",
  "schedule.view",
  "message.post",
  "crew.submit",
];

const DEAL_IDS = {
  albumSplit: "e2e00000-0000-4000-8000-0000000000d1", // shared split: performerA + performerB
  springGuaranteeVsDoor: "e2e00000-0000-4000-8000-0000000000d2",
} as const;

// One budget per event that has money on it. The concluded event's is the settled
// record; the other two are the forward-looking ones the Financial Projections screen
// exists to roll up (see reference-settlement.ts for why each carries what it does).
const BUDGET_IDS = {
  springWarmup: "e2e00000-0000-4000-8000-0000000000f1", // shared — the settled reference event
  albumRelease: "e2e00000-0000-4000-8000-000000000f11", // shared — confirmed, upcoming
  synthShowcaseHold: "e2e00000-0000-4000-8000-000000000f12", // PRIVATE — the venue's own costing
} as const;

const SETTLEMENT_IDS = {
  springOperator: "e2e00000-0000-4000-8000-0000000000f2",
  springPerformerA: "e2e00000-0000-4000-8000-0000000000f3",
  albumRepresentation: "e2e00000-0000-4000-8000-0000000000f4", // private agent commission
} as const;

// Booking requests — the operator's inbox AND, via `senderProfileId`, the
// performers'/agent's outgoing view. Both directions read the same table
// (`direction=incoming` scopes on target, `outgoing` on sender), so every row
// here is deliberately either cross-wired to an E2E account or anonymous.
const BOOKING_REQUEST_IDS = {
  midnightEchoPending: "e2e00000-0000-4000-8000-0000000000f5", // anonymous public form → operator
  performerAOffer: "e2e00000-0000-4000-8000-0000000000f6", // performerA → operator (performerA's outgoing)
  agentOffer: "e2e00000-0000-4000-8000-0000000000f7", // agent → operator (agent's outgoing)
  performerBAccepted: "e2e00000-0000-4000-8000-0000000000f8", // performerB → operator, accepted
  frostbiteDeclined: "e2e00000-0000-4000-8000-0000000000f9", // anonymous, declined
  megaPromoFlagged: "e2e00000-0000-4000-8000-0000000000fa", // anonymous, flagged as spam
} as const;

// ── The operator's back office ───────────────────────────────────────────────
// Contacts, teams, bills and to-dos are not decoration: each is the ONLY table
// behind a whole sidebar destination (Contacts, Team, Bills & Invoices, Tasks). The
// e2e seed provisioned none of them, so four screens rendered their bare empty state
// on a fresh install and the dev stack could not be used to look at any of them. The
// dev seed (seed.ts) already told this story for a single operator; these rows tell
// the same one, re-cast so the on-platform people in it are the E2E accounts.
const CONTACT_IDS = {
  soundRentals: "e2e00000-0000-4000-8000-000000000201",
  agency: "e2e00000-0000-4000-8000-000000000202",
  performingRightsOrganization: "e2e00000-0000-4000-8000-000000000203",
  catering: "e2e00000-0000-4000-8000-000000000204",
  frontOfHouseEngineer: "e2e00000-0000-4000-8000-000000000205",
  security: "e2e00000-0000-4000-8000-000000000206",
} as const;

const GROUP_IDS = {
  coreCrew: "e2e00000-0000-4000-8000-000000000301",
  frontOfHouse: "e2e00000-0000-4000-8000-000000000302",
} as const;

const GROUP_MEMBER_IDS = [
  "e2e00000-0000-4000-8000-000000000311",
  "e2e00000-0000-4000-8000-000000000312",
  "e2e00000-0000-4000-8000-000000000313",
  "e2e00000-0000-4000-8000-000000000314",
  "e2e00000-0000-4000-8000-000000000315",
] as const;

const GROUP_PROFILE_IDS = [
  "e2e00000-0000-4000-8000-000000000321",
  "e2e00000-0000-4000-8000-000000000322",
] as const;

const INVOICE_IDS = {
  albumReleaseVenueHire: "e2e00000-0000-4000-8000-000000000401", // AR, sent
  springSoundRentalBill: "e2e00000-0000-4000-8000-000000000402", // AP, overdue
  springCoPromotionRecharge: "e2e00000-0000-4000-8000-000000000403", // AR, paid
} as const;

const TASK_IDS = [
  "e2e00000-0000-4000-8000-000000000501",
  "e2e00000-0000-4000-8000-000000000502",
  "e2e00000-0000-4000-8000-000000000503",
  "e2e00000-0000-4000-8000-000000000504",
  "e2e00000-0000-4000-8000-000000000505",
  "e2e00000-0000-4000-8000-000000000506",
] as const;

const CALENDAR_ITEM_IDS = [
  "e2e00000-0000-4000-8000-000000000601",
  "e2e00000-0000-4000-8000-000000000602",
  "e2e00000-0000-4000-8000-000000000603",
  "e2e00000-0000-4000-8000-000000000604",
] as const;

const SEK = "SEK";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required (e.g. DATABASE_URL=postgres://… pnpm --filter @showme/db seed:e2e)",
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
    // Children that FK-reference event_participants / representations with
    // NO ACTION (settlements, transfers, deal_parties, budget_lines) go FIRST,
    // before the events cascade removes their participants. Deleting events
    // cascades event_participants + setlists; deleting profiles cascades
    // profile_members, profile_locations, and permission_sets. The five users
    // are never deleted — they own the accounts and align with Firebase Auth.
    const eventIds = Object.values(EVENT_IDS);
    const dealIds = Object.values(DEAL_IDS);
    const profileIds = Object.values(PROFILE_IDS);
    const budgetIds = Object.values(BUDGET_IDS);

    // The back office goes FIRST: an invoice references a budget line and a settlement
    // transfer with NO ACTION, and tasks/calendar_items reference the operator profile
    // the same way, so every one of them blocks the deletes below until it is gone.
    await database
      .delete(schema.invoices)
      .where(inArray(schema.invoices.id, Object.values(INVOICE_IDS)));
    await database.delete(schema.tasks).where(inArray(schema.tasks.id, [...TASK_IDS]));
    await database
      .delete(schema.calendarItems)
      .where(inArray(schema.calendarItems.id, [...CALENDAR_ITEM_IDS]));
    await database
      .delete(schema.contacts)
      .where(inArray(schema.contacts.id, Object.values(CONTACT_IDS)));
    await database
      .delete(schema.groupProfiles)
      .where(inArray(schema.groupProfiles.id, [...GROUP_PROFILE_IDS])); // → profiles (no action)
    await database
      .delete(schema.groupMembers)
      .where(inArray(schema.groupMembers.id, [...GROUP_MEMBER_IDS])); // cascades with the group, but be explicit
    await database.delete(schema.groups).where(inArray(schema.groups.id, Object.values(GROUP_IDS)));

    await database
      .delete(schema.settlementTransfers)
      .where(inArray(schema.settlementTransfers.eventId, eventIds)); // → participants, representations (no action)
    await database.delete(schema.settlements).where(inArray(schema.settlements.eventId, eventIds)); // → participants, representations
    await database
      .delete(schema.budgetLines)
      .where(inArray(schema.budgetLines.budgetId, budgetIds)); // → participants, deals
    await database.delete(schema.budgets).where(inArray(schema.budgets.id, budgetIds));
    await database.delete(schema.dealParties).where(inArray(schema.dealParties.dealId, dealIds)); // → participants
    await database.delete(schema.deals).where(inArray(schema.deals.id, dealIds));
    await database
      .delete(schema.bookingRequests)
      .where(inArray(schema.bookingRequests.id, Object.values(BOOKING_REQUEST_IDS))); // → profiles (cascade), but delete by id so re-runs stay exact
    await database
      .delete(schema.representations)
      .where(inArray(schema.representations.id, [REPRESENTATION_ID])); // → profiles (no action)
    await database.delete(schema.events).where(inArray(schema.events.id, eventIds)); // cascades participants + setlists
    await database.delete(schema.profiles).where(inArray(schema.profiles.id, profileIds)); // cascades members, locations, permission_sets

    // ── 2. Users — one per E2E account. Create-if-missing; never overwrite. ─
    await database
      .insert(schema.users)
      .values([
        {
          id: operatorUserId,
          email: E2E_ACCOUNTS.operator.email,
          name: E2E_ACCOUNTS.operator.displayName,
          kind: "operator",
          currency: SEK,
          country: "SE",
          timezone: "Europe/Stockholm",
          isAdmin: true, // platform admin in dev
        },
        {
          id: performerAUserId,
          email: E2E_ACCOUNTS.performerA.email,
          name: E2E_ACCOUNTS.performerA.displayName,
          kind: "performer",
          currency: SEK,
          country: "SE",
          timezone: "Europe/Stockholm",
        },
        {
          id: performerBUserId,
          email: E2E_ACCOUNTS.performerB.email,
          name: E2E_ACCOUNTS.performerB.displayName,
          kind: "performer",
          currency: SEK,
          country: "SE",
          timezone: "Europe/Stockholm",
        },
        {
          id: teamAndCrewUserId,
          email: E2E_ACCOUNTS.teamAndCrew.email,
          name: E2E_ACCOUNTS.teamAndCrew.displayName,
          kind: "team_and_crew",
          currency: SEK,
          country: "SE",
          timezone: "Europe/Stockholm",
        },
        {
          id: agentUserId,
          email: E2E_ACCOUNTS.agent.email,
          name: E2E_ACCOUNTS.agent.displayName,
          kind: "agent",
          currency: SEK,
          country: "SE",
          timezone: "Europe/Stockholm",
        },
      ])
      .onConflictDoNothing();

    // ── 3. Profiles — one primary profile per account. ─────────────────────
    const profiles = await database
      .insert(schema.profiles)
      .values([
        {
          id: PROFILE_IDS.operator,
          kind: "operator",
          type: "venue",
          ownerUserId: operatorUserId,
          name: E2E_ACCOUNTS.operator.profileName,
          slug: "e2e-the-lantern-hall",
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
        },
        {
          id: PROFILE_IDS.performerA,
          kind: "performer",
          type: "band",
          ownerUserId: performerAUserId,
          name: E2E_ACCOUNTS.performerA.profileName,
          slug: "e2e-marlo-vance",
          isPublic: true,
          bio: "Indie-folk songwriter touring the Nordics. Represented by Astra Booking Agency.",
          claimedAt: new Date(),
          createdBy: performerAUserId,
        },
        {
          id: PROFILE_IDS.performerB,
          kind: "performer",
          type: "band",
          ownerUserId: performerBUserId,
          name: E2E_ACCOUNTS.performerB.profileName,
          slug: "e2e-neon-tide",
          isPublic: true,
          bio: "Synth-pop four-piece. Self-managed.",
          claimedAt: new Date(),
          createdBy: performerBUserId,
        },
        {
          id: PROFILE_IDS.teamAndCrew,
          kind: "team_and_crew",
          type: "crew",
          ownerUserId: teamAndCrewUserId,
          name: E2E_ACCOUNTS.teamAndCrew.profileName,
          slug: "e2e-priya-sound",
          isPublic: true,
          bio: "Freelance front-of-house engineer. Fee-for-labor, arm's-length.",
          claimedAt: new Date(),
          createdBy: teamAndCrewUserId,
        },
        {
          id: PROFILE_IDS.agent,
          kind: "agent",
          type: "agency",
          ownerUserId: agentUserId,
          name: E2E_ACCOUNTS.agent.profileName,
          slug: "e2e-astra-booking-agency",
          isPublic: true,
          bio: "Booking agency representing touring performers on commission.",
          claimedAt: new Date(),
          createdBy: agentUserId,
        },
      ])
      .returning({ id: schema.profiles.id });
    record("profiles", profiles);

    // Primary location for the operator (discovery queries read this).
    await database.insert(schema.profileLocations).values({
      profileId: PROFILE_IDS.operator,
      city: "Stockholm",
      country: "SE",
      isPrimary: true,
    });

    // ── 4. Profile members — each owner user owns their own profile. ───────
    const members = await database
      .insert(schema.profileMembers)
      .values([
        {
          profileId: PROFILE_IDS.operator,
          userId: operatorUserId,
          role: "owner",
          displayName: E2E_ACCOUNTS.operator.profileName,
          status: "active",
          seatConsumed: true,
          addedBy: operatorUserId,
        },
        {
          profileId: PROFILE_IDS.performerA,
          userId: performerAUserId,
          role: "owner",
          displayName: E2E_ACCOUNTS.performerA.profileName,
          status: "active",
          seatConsumed: true,
          addedBy: performerAUserId,
        },
        {
          profileId: PROFILE_IDS.performerB,
          userId: performerBUserId,
          role: "owner",
          displayName: E2E_ACCOUNTS.performerB.profileName,
          status: "active",
          seatConsumed: true,
          addedBy: performerBUserId,
        },
        {
          profileId: PROFILE_IDS.teamAndCrew,
          userId: teamAndCrewUserId,
          role: "owner",
          displayName: E2E_ACCOUNTS.teamAndCrew.profileName,
          status: "active",
          seatConsumed: true,
          addedBy: teamAndCrewUserId,
        },
        {
          profileId: PROFILE_IDS.agent,
          userId: agentUserId,
          role: "owner",
          displayName: E2E_ACCOUNTS.agent.profileName,
          status: "active",
          seatConsumed: true,
          addedBy: agentUserId,
        },
      ])
      .returning({ id: schema.profileMembers.id });
    record("profile_members", members);

    // ── 5. Representation — the agent (Astra) represents performerA (Marlo). ─
    // A standing, active, both-confirmed regional agreement (region: SE). On
    // performerA's in-region events it fans out into an agent participant while
    // performerA's own participation is flagged delegated (below). Commission
    // settles PRIVATELY per the representation, never as an event deal party.
    const representations = await database
      .insert(schema.representations)
      .values({
        id: REPRESENTATION_ID,
        agentProfileId: PROFILE_IDS.agent,
        performerProfileId: PROFILE_IDS.performerA,
        region: ["SE"],
        isWorldwide: false,
        commissionRate: 1000, // 10.00% (basis points)
        commissionableBasis: "deal_income",
        agentCollects: false, // performer collects, then pays the agent
        proposedBy: "agent",
        status: "active",
        // A year back, so the representation always predates every event it acts on —
        // an agreement that starts after the show it negotiated is not a fixture, it
        // is a contradiction, and a fixed date becomes one the moment the events move.
        startsAt: new Date(`${dateOffsetFromToday(-365)}T00:00:00Z`),
        confirmedByAgent: true,
        confirmedByPerformer: true,
      })
      .returning({ id: schema.representations.id });
    record("representations", representations);

    // ── 6. Permission sets — the transparency tiers per participant. ───────
    const permissionSets = await database
      .insert(schema.permissionSets)
      .values([
        {
          id: PERMISSION_SET_IDS.operatorFull,
          profileId: PROFILE_IDS.operator,
          name: "Operator — full",
          description: "Full operator control (operator_full preset).",
          capabilities: OPERATOR_FULL_CAPABILITIES,
        },
        {
          id: PERMISSION_SET_IDS.performerAOwn,
          profileId: PROFILE_IDS.performerA,
          name: "Performer — own slice",
          description: "Performer preset (own deal + settlement + confirms).",
          capabilities: PERFORMER_CAPABILITIES,
        },
        {
          id: PERMISSION_SET_IDS.performerBOwn,
          profileId: PROFILE_IDS.performerB,
          name: "Performer — own slice",
          description: "Performer preset (own deal + settlement + confirms).",
          capabilities: PERFORMER_CAPABILITIES,
        },
        {
          id: PERMISSION_SET_IDS.crewScheduleOnly,
          profileId: PROFILE_IDS.teamAndCrew,
          name: "Crew — schedule only",
          description: "Schedule-only crew tier (no budget, no pool).",
          capabilities: CREW_SCHEDULE_ONLY_CAPABILITIES,
        },
        {
          id: PERMISSION_SET_IDS.agent,
          profileId: PROFILE_IDS.agent,
          name: "Agent — represents performer",
          description: "Fanned-out agent bundle (negotiate/approve on behalf).",
          capabilities: AGENT_CAPABILITIES,
        },
      ])
      .returning({ id: schema.permissionSets.id });
    record("permission_sets", permissionSets);

    // ── 7. Events — all hosted by the operator; varied status. ─────────────
    // The dates are computed from the day the seed runs, not written down: a
    // fixture whose "upcoming" events quietly slide into the past stops being a
    // pipeline, and that is exactly what had happened to the draft below. The
    // offsets and the reasoning are in reference-settlement.ts.
    const eventDates = referenceEventDates();

    const events = await database
      .insert(schema.events)
      .values([
        {
          id: EVENT_IDS.albumRelease,
          hostProfileId: PROFILE_IDS.operator,
          title: "Marlo Vance — Album Release",
          status: "confirmed",
          eventDate: eventDates.albumRelease,
          doorTime: "19:00:00",
          startTime: "20:00:00",
          endTime: "23:00:00",
          curfew: "23:30:00",
          timezone: "Europe/Stockholm",
          venueProfileId: PROFILE_IDS.operator,
          venueName: E2E_ACCOUNTS.operator.profileName,
          capacity: 400,
          baseCurrency: SEK,
          published: true,
          notes: "Headline release show. Marlo Vance + Neon Tide, split deal.",
          createdBy: operatorUserId,
        },
        {
          id: EVENT_IDS.springWarmup,
          hostProfileId: PROFILE_IDS.operator,
          title: "Spring Warmup",
          status: "concluded",
          eventDate: eventDates.springWarmup,
          doorTime: "18:30:00",
          startTime: "19:30:00",
          endTime: "22:30:00",
          timezone: "Europe/Stockholm",
          venueProfileId: PROFILE_IDS.operator,
          venueName: E2E_ACCOUNTS.operator.profileName,
          capacity: 400,
          baseCurrency: SEK,
          published: true,
          notes: "Sold well — settlement finalized.",
          createdBy: operatorUserId,
        },
        {
          id: EVENT_IDS.openMic,
          hostProfileId: PROFILE_IDS.operator,
          title: "Open Mic Wednesdays",
          status: "draft",
          eventDate: eventDates.openMic,
          doorTime: "18:00:00",
          startTime: "19:00:00",
          timezone: "Europe/Stockholm",
          venueProfileId: PROFILE_IDS.operator,
          venueName: "The Lantern Hall (Back Room)",
          capacity: 80,
          baseCurrency: SEK,
          published: false,
          createdBy: operatorUserId,
        },
        {
          id: EVENT_IDS.synthShowcase,
          hostProfileId: PROFILE_IDS.operator,
          title: "Nordic Synth Showcase",
          status: "on_hold",
          eventDate: eventDates.synthShowcase,
          doorTime: "19:00:00",
          startTime: "20:00:00",
          timezone: "Europe/Stockholm",
          venueProfileId: PROFILE_IDS.operator,
          venueName: E2E_ACCOUNTS.operator.profileName,
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
          hostProfileId: PROFILE_IDS.operator,
          title: "Winter Gala",
          status: "cancelled",
          eventDate: eventDates.winterGala,
          timezone: "Europe/Stockholm",
          venueProfileId: PROFILE_IDS.operator,
          venueName: E2E_ACCOUNTS.operator.profileName,
          capacity: 400,
          baseCurrency: SEK,
          published: false,
          notes: "Cancelled — venue double-booked.",
          createdBy: operatorUserId,
        },
      ])
      .returning({ id: schema.events.id });
    record("events", events);

    // ── 8. Event participants. ─────────────────────────────────────────────
    // Album Release (the "full" event): host + two performers + crew + agent.
    // performerA is DELEGATED to the agent (details.delegatedToAgentProfileId) —
    // they keep the view-only floor; the action caps (confirm/approve) resolve
    // through the agent participant (decisions.md #14 / authorization skill). No
    // permission_set on the delegated performer: the auth module ignores the band.
    const participants = await database
      .insert(schema.eventParticipants)
      .values([
        {
          id: PART.albumHost,
          eventId: EVENT_IDS.albumRelease,
          profileId: PROFILE_IDS.operator,
          role: "host",
          permissionSetId: PERMISSION_SET_IDS.operatorFull,
          status: "confirmed",
          addedBy: operatorUserId,
        },
        {
          id: PART.albumPerformerA,
          eventId: EVENT_IDS.albumRelease,
          profileId: PROFILE_IDS.performerA,
          role: "performer",
          performerTag: "headliner",
          status: "confirmed",
          details: { delegatedToAgentProfileId: PROFILE_IDS.agent },
          addedBy: operatorUserId,
        },
        {
          id: PART.albumPerformerB,
          eventId: EVENT_IDS.albumRelease,
          profileId: PROFILE_IDS.performerB,
          role: "performer",
          performerTag: "support",
          permissionSetId: PERMISSION_SET_IDS.performerBOwn,
          status: "confirmed",
          addedBy: operatorUserId,
        },
        {
          id: PART.albumCrew,
          eventId: EVENT_IDS.albumRelease,
          profileId: PROFILE_IDS.teamAndCrew,
          role: "crew",
          permissionSetId: PERMISSION_SET_IDS.crewScheduleOnly,
          status: "confirmed",
          details: {
            call_time: "17:00",
            task: "Front-of-house sound",
            pay_note: "Fee invoiced separately",
          },
          addedBy: operatorUserId,
        },
        {
          id: PART.albumAgent,
          eventId: EVENT_IDS.albumRelease,
          profileId: PROFILE_IDS.agent,
          role: "agent",
          permissionSetId: PERMISSION_SET_IDS.agent,
          status: "confirmed",
          addedBy: operatorUserId,
        },
        // Spring Warmup (concluded): host + performerA (self-managed here).
        {
          id: PART.springHost,
          eventId: EVENT_IDS.springWarmup,
          profileId: PROFILE_IDS.operator,
          role: "host",
          permissionSetId: PERMISSION_SET_IDS.operatorFull,
          status: "confirmed",
          addedBy: operatorUserId,
        },
        {
          id: PART.springPerformerA,
          eventId: EVENT_IDS.springWarmup,
          profileId: PROFILE_IDS.performerA,
          role: "performer",
          performerTag: "headliner",
          permissionSetId: PERMISSION_SET_IDS.performerAOwn,
          status: "confirmed",
          addedBy: operatorUserId,
        },
        // Host-only participants so the operator reaches its lighter events.
        {
          id: PART.openMicHost,
          eventId: EVENT_IDS.openMic,
          profileId: PROFILE_IDS.operator,
          role: "host",
          permissionSetId: PERMISSION_SET_IDS.operatorFull,
          status: "confirmed",
          addedBy: operatorUserId,
        },
        {
          id: PART.synthHost,
          eventId: EVENT_IDS.synthShowcase,
          profileId: PROFILE_IDS.operator,
          role: "host",
          permissionSetId: PERMISSION_SET_IDS.operatorFull,
          status: "confirmed",
          addedBy: operatorUserId,
        },
        {
          id: PART.winterHost,
          eventId: EVENT_IDS.winterGala,
          profileId: PROFILE_IDS.operator,
          role: "host",
          permissionSetId: PERMISSION_SET_IDS.operatorFull,
          status: "confirmed",
          addedBy: operatorUserId,
        },
      ])
      .returning({ id: schema.eventParticipants.id });
    record("event_participants", participants);

    // ── 8b. Setlist — performerA's set on the Album Release (cascades w/ event). ─
    const setlists = await database
      .insert(schema.setlists)
      .values({
        eventId: EVENT_IDS.albumRelease,
        participantId: PART.albumPerformerA,
        items: [
          { title: "Neon Rooftops", duration: 245 },
          { title: "Paper Districts", duration: 198 },
          { title: "Ember (title track)", duration: 312 },
          { title: "Long Way Home", duration: 224 },
        ],
      })
      .returning({ id: schema.setlists.id });
    record("setlists", setlists);

    // ── 9. Deals + parties. ────────────────────────────────────────────────
    // Album Release: ONE shared split deal across performerA (60%) and performerB
    // (40%). Each performer is a `split_member` deal_party → the serializer shows
    // each performer ONLY their own line (deal-party visibility). The operator is
    // the payer party; the agent negotiates performerA's line (delegated).
    // Spring Warmup: performerA guarantee-vs-door — drives the finalized settlement.
    //
    // BOTH deals carry deal-level terms, because those are the ones the engine reads.
    // The split deal used to carry none — only the two party weights — so it sized to
    // 0% of the pool and paid both performers nothing (A-01's leftover, filed under
    // A-13). A party's `share` divides a deal; it never sizes one.
    const deals = await database
      .insert(schema.deals)
      .values([
        {
          id: DEAL_IDS.albumSplit,
          eventId: EVENT_IDS.albumRelease,
          type: "split",
          structure: REFERENCE_DOOR_SPLIT_TERMS.structure,
          currency: SEK,
          name: "Album Release — Door Split",
          payerParticipantId: PART.albumHost,
          paymentTiming: "at_settlement",
          // The two split members take the whole pool between them; the 60/40 below
          // divides it. Without this column the deal takes nothing out of the pool.
          splitBasisPoints: REFERENCE_DOOR_SPLIT_TERMS.splitBasisPoints, // 100.00% OF THE POOL
          agreementStatus: "confirmed",
          status: "confirmed",
          createdBy: operatorUserId,
        },
        {
          id: DEAL_IDS.springGuaranteeVsDoor,
          eventId: EVENT_IDS.springWarmup,
          type: "performance",
          structure: "guarantee_vs_door",
          currency: SEK,
          name: "Marlo Vance — Guarantee vs Door",
          payerParticipantId: PART.springHost,
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
        // Album Release split — payer (operator) + two split members.
        { dealId: DEAL_IDS.albumSplit, participantId: PART.albumHost, roleInDeal: "payer" },
        {
          dealId: DEAL_IDS.albumSplit,
          participantId: PART.albumPerformerA,
          roleInDeal: "split_member",
          confirmedAt: new Date(),
          confirmedBy: agentUserId, // the AGENT confirms on performerA's behalf (delegated)
          // 60.00% of the deal — 30 000.00 SEK at the reference 50 000.00 pool.
          share: {
            illustrativeAmount: REFERENCE_DOOR_SPLIT_SHARES.headlinerAmount.toString(),
            splitBasisPoints: REFERENCE_DOOR_SPLIT_SHARES.headlinerBasisPoints,
            currency: SEK,
          },
        },
        {
          dealId: DEAL_IDS.albumSplit,
          participantId: PART.albumPerformerB,
          roleInDeal: "split_member",
          confirmedAt: new Date(),
          confirmedBy: performerBUserId, // performerB is self-managed
          // 40.00% of the deal — 20 000.00 SEK at the reference 50 000.00 pool.
          share: {
            illustrativeAmount: REFERENCE_DOOR_SPLIT_SHARES.supportAmount.toString(),
            splitBasisPoints: REFERENCE_DOOR_SPLIT_SHARES.supportBasisPoints,
            currency: SEK,
          },
        },
        // Spring Warmup — payer (operator) + payee (performerA).
        {
          dealId: DEAL_IDS.springGuaranteeVsDoor,
          participantId: PART.springHost,
          roleInDeal: "payer",
        },
        {
          dealId: DEAL_IDS.springGuaranteeVsDoor,
          participantId: PART.springPerformerA,
          roleInDeal: "payee",
          confirmedAt: new Date(),
          confirmedBy: performerAUserId,
          share: {
            illustrativeAmount: REFERENCE_GUARANTEE_VS_DOOR_TERMS.guaranteeAmount.toString(),
            splitBasisPoints: REFERENCE_GUARANTEE_VS_DOOR_TERMS.splitBasisPoints,
            currency: SEK,
          },
        },
      ])
      .returning({ id: schema.dealParties.id });
    record("deal_parties", dealParties);

    // ── 10. Budgets — one settled record and TWO forward-looking projections. ─
    // The seed used to put a budget on the concluded event and nowhere else, which
    // left the Financial Projections screen — whose whole job is a forward-looking
    // P&L across the pipeline — with nothing to sum under either of its
    // forward-looking scopes ("Confirmed", "Upcoming"), so both rendered a dash.
    // A budget is what makes a projection projectable, so the two events that have
    // not happened yet and are still live now carry one:
    //   · Album Release  — SHARED: two performers are signed to a split of this pool,
    //                      so the budget is the thing they and the venue both read.
    //   · Synth Showcase — PRIVATE: nothing is signed on a hold, so there is no
    //                      counterparty to share with; it is the venue's own costing
    //                      of whether to confirm the date (visible only to its owner).
    // The draft and the cancelled event stay unbudgeted on purpose — "not costed
    // yet" and "abandoned" are true states, and they give the screen's
    // partial-coverage note ("2 of 3 events budgeted") something honest to report.
    const budgets = await database
      .insert(schema.budgets)
      .values([
        { id: BUDGET_IDS.springWarmup, eventId: EVENT_IDS.springWarmup, scope: "shared" },
        { id: BUDGET_IDS.albumRelease, eventId: EVENT_IDS.albumRelease, scope: "shared" },
        {
          id: BUDGET_IDS.synthShowcaseHold,
          eventId: EVENT_IDS.synthShowcase,
          scope: "private",
          ownerProfileId: PROFILE_IDS.operator, // required for `private`, and the point of it
        },
      ])
      .returning({ id: schema.budgets.id });
    record("budgets", budgets);

    // The external cash of the reference event: 78 000 door collected by the operator,
    // a 9 000 external supplier cost, and an 1 800 hotel booked FOR performerA (a
    // deductible, not a pool cost). Shared with seed.ts and with the settlement
    // derivation below — see reference-settlement.ts.
    const REFERENCE_SPINE = {
      hostParticipantId: PART.springHost,
      performerParticipantId: PART.springPerformerA,
      dealId: DEAL_IDS.springGuaranteeVsDoor,
    };

    // Every figure comes from reference-settlement.ts, never from here (audit A-13):
    // a number typed beside the data it describes drifts from the code that computes
    // it. The album release's lines are sized so its pool lands exactly on the pool
    // the door split's 60/40 lines are quoted at — so the 30 000.00 / 20 000.00 the
    // deal states, and the 3 000.00 commission derived from the first of them below,
    // are what the engine will actually pay on this event rather than a hopeful note.
    const budgetLines = await database
      .insert(schema.budgetLines)
      .values([
        ...referenceBudgetLines(REFERENCE_SPINE).map((line) => ({
          budgetId: BUDGET_IDS.springWarmup,
          source: "manual" as const,
          ...line,
        })),
        ...referenceAlbumReleaseBudgetLines({
          hostParticipantId: PART.albumHost,
          dealId: DEAL_IDS.albumSplit,
        }).map((line) => ({
          budgetId: BUDGET_IDS.albumRelease,
          source: "manual" as const,
          ...line,
        })),
        // No `dealId` on the hold's lines: there is no deal to assign them to yet.
        ...referenceHoldBudgetLines({ hostParticipantId: PART.synthHost }).map((line) => ({
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

    // ── 11. Settlement on the concluded event — ONE per participant, Σ net = 0. ─
    // DERIVED by the settlement engine from the deal and budget lines above, never
    // typed by hand (audit A-13): the hand arithmetic took 70% of gross revenue where
    // the engine takes 70% of the pool, so the reference settlement was 6 300.00 SEK
    // adrift from what the platform would actually pay. `computed` is the exact
    // `SerializedBreakdown` the API reads back — `participantId`/`held` present,
    // no `cashHeld` — so these rows satisfy `GET /events/:id/settlements`.
    //
    //   pool        = 78 000 door − 9 000 external cost                    = 69 000
    //                 (the 1 800 hotel names performerA, so it is a deductible,
    //                  not a pool cost — it comes off her entitlement instead)
    //   performerA  = max(18 000 guarantee, 70% × 69 000 = 48 300) − 1 800 = 46 500
    //   operator    = residual 69 000 − 48 300                             = 20 700
    //   held        = operator 78 000 − 10 800 = 67 200 · performerA 0
    //   net         = operator 20 700 − 67 200 = −46 500 · performerA +46 500 (Σ = 0)
    const referenceResult = referenceSettlement(REFERENCE_SPINE);

    const settlements = await database
      .insert(schema.settlements)
      .values([
        {
          id: SETTLEMENT_IDS.springOperator,
          eventId: EVENT_IDS.springWarmup,
          participantId: PART.springHost,
          status: "finalized",
          computed: storeBreakdown(
            breakdownFor(referenceResult, PART.springHost),
            referenceResult.ladder,
          ),
        },
        {
          id: SETTLEMENT_IDS.springPerformerA,
          eventId: EVENT_IDS.springWarmup,
          participantId: PART.springPerformerA,
          status: "finalized",
          computed: storeBreakdown(
            breakdownFor(referenceResult, PART.springPerformerA),
            referenceResult.ladder,
          ),
        },
      ])
      .returning({ id: schema.settlements.id });
    record("settlements", settlements);

    // The owed transfers the engine matched — one here: operator → performerA 46 500.
    const eventTransfers = await database
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
    record("settlement_transfers.event", eventTransfers);

    // ── 12. Private agent commission — a REPRESENTATION-scoped settlement. ──
    // NOT an event deal party: a separate settlement keyed to the representation
    // (decisions.md #14), private to agent + performerA. The operator never sees
    // it, so the event's Σ net = 0 has no hidden term. Commission = 10% of
    // performerA's Album Release line (30 000.00 guaranteed) = 3 000.00 SEK.
    // Direction performer → agent (agentCollects = false: performerA collects the
    // gross, then pays the agent) — `settleRepresentation` decides that, not this file.
    //
    // The snapshot goes through `serializeCommissionSnapshot` for the same reason the
    // event breakdowns do: the reader (`GET /events/:id/settlements`) matches on
    // `performerParticipantId`/`agentParticipantId` to decide who may see the row, and
    // the hand-written version named neither — so the seeded commission was invisible
    // to both of the two people it exists for.
    // performerA's Album Release line at the reference pool — the SAME constant the
    // split deal states her share with, so the commission cannot quote a figure the
    // deal no longer pays.
    const albumPerformerALine = REFERENCE_DOOR_SPLIT_SHARES.headlinerAmount; // 30 000.00 SEK
    const albumCommission = settleRepresentation({
      performerEntitlement: albumPerformerALine,
      commissionBasisPoints: 1000, // 10.00%, per the representation above
      agentCollects: false,
    });

    const representationSettlement = await database
      .insert(schema.settlements)
      .values({
        id: SETTLEMENT_IDS.albumRepresentation,
        eventId: EVENT_IDS.albumRelease,
        representationId: REPRESENTATION_ID,
        status: "open",
        computed: serializeCommissionSnapshot({
          performerParticipantId: PART.albumPerformerA,
          agentParticipantId: PART.albumAgent,
          performerEntitlement: albumPerformerALine,
          commission: albumCommission.commission,
          agentCollects: false,
        }),
      })
      .returning({ id: schema.settlements.id });
    record("settlements.representation", representationSettlement);

    const commissionTransfer = albumCommission.transfer;
    if (!commissionTransfer) {
      throw new Error("The reference commission settles to nothing — check the rate and the line.");
    }
    const participantOfCommissionParty = (party: "performer" | "agent") =>
      party === "performer" ? PART.albumPerformerA : PART.albumAgent;

    const representationTransfer = await database
      .insert(schema.settlementTransfers)
      .values({
        eventId: EVENT_IDS.albumRelease,
        fromParticipant: participantOfCommissionParty(commissionTransfer.from),
        toParticipant: participantOfCommissionParty(commissionTransfer.to),
        amount: commissionTransfer.amount, // 3 000.00 SEK commission
        currency: SEK,
        representationId: REPRESENTATION_ID, // → PRIVATE (operator never sees it)
        state: "owed",
      })
      .returning({ id: schema.settlementTransfers.id });
    record("settlement_transfers.representation", representationTransfer);

    // ── 13. Booking requests — the operator's inbox and the senders' outbox. ─
    // One table serves both directions of the Requests page: `direction=incoming`
    // scopes on `target_profile_id`, `outgoing` on `sender_profile_id`. So the
    // three rows carrying a sender profile are what makes performerA's, performerB's
    // and the agent's Outgoing view non-empty — without them the outgoing branch
    // renders the empty state and its filter is never exercised.
    // Statuses span the page's filter chips (pending / accepted / declined / flagged).
    // Note the `booking_requests_pending_dedup` unique index: among PENDING rows,
    // (sender_user_id, target_profile_id, wanted_date) must be distinct.
    const bookingRequests = await database
      .insert(schema.bookingRequests)
      .values([
        {
          // Anonymous public-form request — no sender account, so it appears in the
          // operator's Incoming only and in nobody's Outgoing.
          id: BOOKING_REQUEST_IDS.midnightEchoPending,
          source: "public_form",
          status: "pending",
          targetProfileId: PROFILE_IDS.operator,
          currency: SEK, // what the API stamps: the operator's primary location is SE
          contactName: "Anders Berg",
          email: "anders@midnightecho.example",
          phone: "+46 70 123 45 67",
          artistName: "The Midnight Echo",
          wantedDate: dateOffsetFromToday(38),
          artistFee: 3000000n, // 30 000.00 SEK asking fee
          pitch:
            "Four-piece indie rock, just wrapped a Nordic club tour. Would love a Friday slot.",
          note: "Self-booked, no agency.",
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
          // performerA (Marlo) pitching the operator — THE row that proves
          // `direction=outgoing` works for a performer.
          id: BOOKING_REQUEST_IDS.performerAOffer,
          source: "performer_offer",
          status: "pending",
          targetProfileId: PROFILE_IDS.operator,
          currency: SEK, // what the API stamps: the operator's primary location is SE
          senderUserId: performerAUserId,
          senderProfileId: PROFILE_IDS.performerA,
          contactName: E2E_ACCOUNTS.performerA.displayName,
          email: E2E_ACCOUNTS.performerA.email,
          artistName: E2E_ACCOUNTS.performerA.profileName,
          wantedDate: dateOffsetFromToday(53),
          offerFeeMin: 2000000n, // 20 000.00 SEK
          offerFeeMax: 2800000n, // 28 000.00 SEK
          pitch:
            "Second Stockholm date to support the new record. Flexible on the fee for a good room.",
          note: "Sent directly, not via Astra.",
          senderType: "performer",
          performerType: "solo",
          genres: ["indie-folk"],
          sentVia: "in_platform",
        },
        {
          // The agent pitching on behalf of the performer it represents — the
          // agent kind's own Outgoing view (decisions.md #14).
          id: BOOKING_REQUEST_IDS.agentOffer,
          source: "performer_offer",
          status: "pending",
          targetProfileId: PROFILE_IDS.operator,
          currency: SEK, // what the API stamps: the operator's primary location is SE
          senderUserId: agentUserId,
          senderProfileId: PROFILE_IDS.agent,
          contactName: E2E_ACCOUNTS.agent.displayName,
          email: E2E_ACCOUNTS.agent.email,
          // The act this offer is FOR — what makes `artistName` the performer's
          // and not the agency's. Backed by the active representation seeded above
          // (the same pairing POST /offers validates before accepting the field).
          onBehalfOfProfileId: PROFILE_IDS.performerA,
          artistName: E2E_ACCOUNTS.performerA.profileName,
          wantedDate: dateOffsetFromToday(73),
          offerFeeMin: 2500000n, // 25 000.00 SEK
          offerFeeMax: 3200000n, // 32 000.00 SEK
          pitch:
            "Astra representing Marlo Vance for a headline slot. Routing through Stockholm in November.",
          note: "Agency-sent on behalf of the represented performer.",
          senderType: "agency",
          performerType: "solo",
          genres: ["indie-folk"],
          sentVia: "in_platform",
        },
        {
          // performerB, already accepted — gives the Accepted chip a row in both
          // the operator's Incoming and performerB's Outgoing.
          id: BOOKING_REQUEST_IDS.performerBAccepted,
          source: "performer_offer",
          status: "accepted",
          targetProfileId: PROFILE_IDS.operator,
          currency: SEK, // what the API stamps: the operator's primary location is SE
          senderUserId: performerBUserId,
          senderProfileId: PROFILE_IDS.performerB,
          contactName: E2E_ACCOUNTS.performerB.displayName,
          email: E2E_ACCOUNTS.performerB.email,
          artistName: E2E_ACCOUNTS.performerB.profileName,
          wantedDate: dateOffsetFromToday(32),
          offerFeeMin: 1500000n, // 15 000.00 SEK
          pitch: "Synth-pop live set, seated show. Confirmed and looking forward to it.",
          senderType: "performer",
          performerType: "band",
          genres: ["synth-pop"],
          sentVia: "in_platform",
        },
        {
          id: BOOKING_REQUEST_IDS.frostbiteDeclined,
          source: "venue_handoff",
          status: "declined",
          targetProfileId: PROFILE_IDS.operator,
          currency: SEK, // what the API stamps: the operator's primary location is SE
          contactName: "DJ Frostbite",
          email: "frostbite@coldwax.example",
          artistName: "DJ Frostbite",
          // The very night the draft below occupies — which is WHY the note says it
          // clashes. Pinning it to the same computed date keeps the reason true.
          wantedDate: eventDates.openMic,
          artistFee: 800000n, // 8 000.00 SEK
          pitch: "Late-night techno set. Passed over from Klubb Nord.",
          note: "Declined, clashes with Open Mic night.",
          senderType: "performer",
          performerType: "dj",
          genres: ["techno"],
          sentVia: "mailto",
        },
        {
          id: BOOKING_REQUEST_IDS.megaPromoFlagged,
          source: "public_form",
          status: "flagged",
          targetProfileId: PROFILE_IDS.operator,
          currency: SEK, // what the API stamps: the operator's primary location is SE
          contactName: "MegaPromo Bookings",
          email: "deals@megapromo.example",
          artistName: "Various Artists",
          wantedDate: dateOffsetFromToday(80),
          pitch: "GUARANTEED SELLOUT!!! Book 20 of our acts now for a special rate, reply ASAP!!!",
          note: "Auto-flagged, bulk/spam pattern.",
          senderType: "agency",
          sentVia: "in_platform",
        },
      ])
      .returning({ id: schema.bookingRequests.id });
    record("booking_requests", bookingRequests);

    // ── 14. Contacts — the operator's address book. ────────────────────────
    // The Contacts screen reads this table and nothing else, so with none of these
    // rows it opened on its empty state forever. These are the counterparties the
    // budget lines above already name — the sound company behind "Sound &
    // production", the caterer behind "Green-room catering", the security firm
    // behind "Door & security staffing" — so the address book and the money agree
    // on who the venue does business with instead of describing two different venues.
    const contacts = await database
      .insert(schema.contacts)
      .values([
        {
          id: CONTACT_IDS.soundRentals,
          ownerProfileId: PROFILE_IDS.operator,
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
          // The agency is an E2E ACCOUNT, not an invention: the operator's address
          // book entry and the `representations` row above are the same relationship
          // seen from the two sides the product models it from.
          id: CONTACT_IDS.agency,
          ownerProfileId: PROFILE_IDS.operator,
          name: E2E_ACCOUNTS.agent.profileName,
          type: "agency",
          vatId: "SE556200100005",
          address: "Götgatan 15, 116 46 Stockholm",
          notes: "Represents Marlo Vance. Negotiates and confirms on her behalf.",
          persons: [
            {
              name: E2E_ACCOUNTS.agent.displayName,
              email: E2E_ACCOUNTS.agent.email,
              phone: "+46 70 900 80 70",
            },
          ],
        },
        {
          id: CONTACT_IDS.performingRightsOrganization,
          ownerProfileId: PROFILE_IDS.operator,
          name: "STIM",
          type: "authority",
          notes: "Performing-rights reporting (the Swedish PRO the setlists are filed to).",
          persons: [
            { name: "Reporting desk", email: "reporting@stim.example", phone: "+46 8 783 88 00" },
          ],
        },
        {
          id: CONTACT_IDS.catering,
          ownerProfileId: PROFILE_IDS.operator,
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
          // The crew ACCOUNT again — booked on the release as a participant, and
          // kept here as the venue's first-call engineer.
          id: CONTACT_IDS.frontOfHouseEngineer,
          ownerProfileId: PROFILE_IDS.operator,
          name: E2E_ACCOUNTS.teamAndCrew.profileName,
          type: "crew",
          notes: "Freelance FOH engineer — first call for seated shows. Fee invoiced separately.",
          persons: [
            {
              name: E2E_ACCOUNTS.teamAndCrew.displayName,
              email: E2E_ACCOUNTS.teamAndCrew.email,
              phone: "+46 76 300 40 50",
            },
          ],
        },
        {
          id: CONTACT_IDS.security,
          ownerProfileId: PROFILE_IDS.operator,
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

    // ── 15. Reusable teams (the Team screen) — groups, members, profile link. ─
    // The Team screen shows a roster AND the reusable work groups an operator
    // assigns to events. With no `groups` rows the roster listed exactly one person
    // (the owner) and the groups rail was empty, so the member-vs-group-only
    // distinction the screen is built around had nothing to distinguish.
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
        // Core Crew — two ON-PLATFORM members (so a group row links to real accounts)
        // and two off-platform ones (so the invite-by-email path has rows too).
        {
          id: GROUP_MEMBER_IDS[0],
          groupId: GROUP_IDS.coreCrew,
          userId: operatorUserId,
          email: E2E_ACCOUNTS.operator.email,
          roleLabel: "Venue Manager",
        },
        {
          id: GROUP_MEMBER_IDS[1],
          groupId: GROUP_IDS.coreCrew,
          userId: teamAndCrewUserId,
          email: E2E_ACCOUNTS.teamAndCrew.email,
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
          groupId: GROUP_IDS.frontOfHouse,
          email: "vera@lanternhall.example",
          roleLabel: "Bar Lead",
        },
        {
          id: GROUP_MEMBER_IDS[4],
          groupId: GROUP_IDS.frontOfHouse,
          email: "milo@lanternhall.example",
          roleLabel: "Box Office",
        },
      ])
      .returning({ id: schema.groupMembers.id });
    record("group_members", groupMembers);

    // Which profile each group belongs to — without this the groups exist but the
    // operator's Team screen cannot claim them.
    const groupProfiles = await database
      .insert(schema.groupProfiles)
      .values([
        {
          id: GROUP_PROFILE_IDS[0],
          groupId: GROUP_IDS.coreCrew,
          profileId: PROFILE_IDS.operator,
        },
        {
          id: GROUP_PROFILE_IDS[1],
          groupId: GROUP_IDS.frontOfHouse,
          profileId: PROFILE_IDS.operator,
        },
      ])
      .returning({ id: schema.groupProfiles.id });
    record("group_profiles", groupProfiles);

    // ── 16. Bills & invoices — money receivable and payable, varied state. ──
    // The fixture produced `owed` settlement transfers and a finalized settlement —
    // precisely the money a venue then invoices — and not one invoice to close the
    // loop, so the whole AR/AP screen sat at zero on both sides. One of each
    // direction and one of each state the ledger colours differently.
    //
    // The supplier bill is LINKED to the budget line it pays off (`budgetLineId`),
    // which is the join that makes a bill and a cost the same fact rather than two.
    // It is found by label rather than by position: the budget insert above spans
    // three events now, and an index into it would silently point at another event's
    // money the next time a line is added.
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
          id: INVOICE_IDS.albumReleaseVenueHire,
          ownerProfileId: PROFILE_IDS.operator,
          eventId: EVENT_IDS.albumRelease,
          direction: "issued", // AR — the venue billing the artist side
          recipientRef: `${E2E_ACCOUNTS.agent.profileName} (for ${E2E_ACCOUNTS.performerA.profileName})`,
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
          id: INVOICE_IDS.springSoundRentalBill,
          ownerProfileId: PROFILE_IDS.operator,
          eventId: EVENT_IDS.springWarmup,
          direction: "received", // AP — a supplier bill the venue owes
          issuerRef: "Nordic Sound Rentals AB",
          budgetLineId: soundProductionLine.id,
          number: "NSR-4471",
          currency: SEK,
          lineItems: [{ label: "PA + backline hire", quantity: 1, unitAmount: "720000" }],
          vat: { rate: 25, amount: "180000" },
          total: 900000n, // 9 000.00 SEK incl. VAT — the budget line it pays off
          issuedAt: new Date(`${dateOffsetFromToday(-128)}T09:00:00Z`),
          // Past due, which is what makes `overdue` an honest state rather than a
          // label contradicting its own date.
          dueDate: dateOffsetFromToday(-108),
          state: "overdue",
        },
        {
          id: INVOICE_IDS.springCoPromotionRecharge,
          ownerProfileId: PROFILE_IDS.operator,
          eventId: EVENT_IDS.springWarmup,
          direction: "issued", // AR — a co-promotion recharge, already settled
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

    // ── 17. Tasks — the to-do board, across all three of its scopes. ────────
    // `tasks` was another table with no rows at all, so the board showed "You're all
    // caught up" on a fresh install and none of its six filter chips had anything to
    // filter. One task per scope the schema allows (event / profile / personal) and
    // both completion states, so every chip resolves to something.
    const tasks = await database
      .insert(schema.tasks)
      .values([
        {
          id: TASK_IDS[0],
          eventId: EVENT_IDS.albumRelease,
          ownerProfileId: PROFILE_IDS.operator,
          title: "Confirm PA hire for the Album Release",
          description: "Get written confirmation from Nordic Sound Rentals for the night.",
          dueDate: dateOffsetFromToday(6),
          budgetType: "production",
          budgetAmount: 1200000n, // the "Sound & production" line it is chasing
          createdBy: operatorUserId,
        },
        {
          id: TASK_IDS[1],
          eventId: EVENT_IDS.albumRelease,
          ownerProfileId: PROFILE_IDS.operator,
          title: `Send the stage plot to ${E2E_ACCOUNTS.performerA.profileName}`,
          completed: true,
          completedAt: new Date(`${dateOffsetFromToday(-12)}T14:00:00Z`),
          createdBy: operatorUserId,
        },
        {
          // Personal scope — owned by the USER, not the profile.
          id: TASK_IDS[2],
          ownerUserId: operatorUserId,
          title: "Renew the venue's liability insurance",
          description: "Personal reminder — the policy lapses next month.",
          dueDate: dateOffsetFromToday(21),
          createdBy: operatorUserId,
        },
        {
          id: TASK_IDS[3],
          eventId: EVENT_IDS.springWarmup,
          ownerProfileId: PROFILE_IDS.operator,
          title: "Finalize the Spring Warmup settlement",
          completed: true,
          completedAt: new Date(`${dateOffsetFromToday(-123)}T18:30:00Z`),
          createdBy: operatorUserId,
        },
        {
          id: TASK_IDS[4],
          eventId: EVENT_IDS.openMic,
          ownerProfileId: PROFILE_IDS.operator,
          title: "Book door security for Open Mic",
          dueDate: dateOffsetFromToday(4),
          createdBy: operatorUserId,
        },
        {
          // The decision the hold's private budget above exists to inform.
          id: TASK_IDS[5],
          eventId: EVENT_IDS.synthShowcase,
          ownerProfileId: PROFILE_IDS.operator,
          title: "Confirm or release the Nordic Synth Showcase hold",
          description: "First hold. The costing says it clears — chase the artist or drop it.",
          dueDate: dateOffsetFromToday(30),
          createdBy: operatorUserId,
        },
      ])
      .returning({ id: schema.tasks.id });
    record("tasks", tasks);

    // ── 18. Calendar items — the operator's own agenda beside the events. ───
    // The Calendar screen falls back to plotting events when it finds no items, so
    // it never looked broken — it just never showed the half of the month that is
    // meetings, deadlines and notes rather than shows. All four sit inside the
    // weeks around today so the default month view is not empty.
    const calendarItems = await database
      .insert(schema.calendarItems)
      .values([
        {
          id: CALENDAR_ITEM_IDS[0],
          ownerProfileId: PROFILE_IDS.operator,
          ownerUserId: operatorUserId,
          type: "appointment",
          title: "Site visit — Nordic Synth Showcase",
          date: dateOffsetFromToday(3),
          startTime: "11:00:00",
          endTime: "12:30:00",
          entity: "Nordic Synth Showcase",
          assigneeUserId: operatorUserId,
          assigneeName: E2E_ACCOUNTS.operator.profileName,
        },
        {
          id: CALENDAR_ITEM_IDS[1],
          ownerProfileId: PROFILE_IDS.operator,
          ownerUserId: operatorUserId,
          type: "task",
          title: "Advance the Album Release with the artist",
          date: dateOffsetFromToday(10), // a week before the show
        },
        {
          id: CALENDAR_ITEM_IDS[2],
          ownerProfileId: PROFILE_IDS.operator,
          ownerUserId: operatorUserId,
          type: "appointment",
          title: `Meeting with ${E2E_ACCOUNTS.agent.profileName}`,
          date: dateOffsetFromToday(27),
          startTime: "15:00:00",
          endTime: "16:00:00",
          assigneeName: E2E_ACCOUNTS.agent.displayName,
        },
        {
          id: CALENDAR_ITEM_IDS[3],
          ownerProfileId: PROFILE_IDS.operator,
          ownerUserId: operatorUserId,
          type: "note",
          title: "STIM performance report deadline",
          date: dateOffsetFromToday(50),
        },
      ])
      .returning({ id: schema.calendarItems.id });
    record("calendar_items", calendarItems);

    // ── Summary ────────────────────────────────────────────────────────────
    console.log("\nE2E seed complete. Accounts (Firebase uid = users.id):");
    for (const account of Object.values(E2E_ACCOUNTS)) {
      console.log(
        `  ${account.kind.padEnd(13)} ${account.email.padEnd(30)} → ${account.profileName}`,
      );
    }
    console.log("\nInserted rows:");
    for (const [label, count] of Object.entries(counts)) {
      console.log(`  ${label.padEnd(32)} ${count}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("E2E seed failed:", error);
  process.exit(1);
});
