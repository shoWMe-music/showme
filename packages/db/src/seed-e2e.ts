import {
  serializeBreakdown,
  serializeCommissionSnapshot,
  settleRepresentation,
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
  referenceBudgetLines,
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

const BUDGET_ID = "e2e00000-0000-4000-8000-0000000000f1";
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

    await database
      .delete(schema.settlementTransfers)
      .where(inArray(schema.settlementTransfers.eventId, eventIds)); // → participants, representations (no action)
    await database.delete(schema.settlements).where(inArray(schema.settlements.eventId, eventIds)); // → participants, representations
    await database
      .delete(schema.budgetLines)
      .where(inArray(schema.budgetLines.budgetId, [BUDGET_ID])); // → participants, deals
    await database.delete(schema.budgets).where(inArray(schema.budgets.id, [BUDGET_ID]));
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
        startsAt: new Date("2026-01-01T00:00:00Z"),
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

    // ── 7. Events — all hosted by the operator; varied status (today ≈ 2026-08-09). ─
    const events = await database
      .insert(schema.events)
      .values([
        {
          id: EVENT_IDS.albumRelease,
          hostProfileId: PROFILE_IDS.operator,
          title: "Marlo Vance — Album Release",
          status: "confirmed",
          eventDate: "2026-09-12",
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
          eventDate: "2026-04-18",
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
          eventDate: "2026-08-20",
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
          eventDate: "2026-11-01",
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
          eventDate: "2026-12-05",
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

    // ── 10. Budget + lines on the concluded event. ─────────────────────────
    const budgets = await database
      .insert(schema.budgets)
      .values({ id: BUDGET_ID, eventId: EVENT_IDS.springWarmup, scope: "shared" })
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

    const budgetLines = await database
      .insert(schema.budgetLines)
      .values(
        referenceBudgetLines(REFERENCE_SPINE).map((line) => ({
          budgetId: BUDGET_ID,
          source: "manual" as const,
          ...line,
        })),
      )
      .returning({ id: schema.budgetLines.id });
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
          computed: serializeBreakdown(breakdownFor(referenceResult, PART.springHost)),
        },
        {
          id: SETTLEMENT_IDS.springPerformerA,
          eventId: EVENT_IDS.springWarmup,
          participantId: PART.springPerformerA,
          status: "finalized",
          computed: serializeBreakdown(breakdownFor(referenceResult, PART.springPerformerA)),
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
          wantedDate: "2026-10-03",
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
          wantedDate: "2026-10-18",
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
          wantedDate: "2026-11-07",
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
          wantedDate: "2026-09-27",
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
          wantedDate: "2026-08-29",
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
          wantedDate: "2026-11-14",
          pitch: "GUARANTEED SELLOUT!!! Book 20 of our acts now for a special rate, reply ASAP!!!",
          note: "Auto-flagged, bulk/spam pattern.",
          senderType: "agency",
          sentVia: "in_platform",
        },
      ])
      .returning({ id: schema.bookingRequests.id });
    record("booking_requests", bookingRequests);

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
