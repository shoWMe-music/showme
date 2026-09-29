import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { forbidden, notFound } from "../errors";
import { type DealViewer, isDealReachable } from "../serialize/deal";
import { countryInRegion } from "./agent-assignment";
import { eventCapabilities } from "./authorize";
import { isRepresentationActiveAt } from "./representation-rules";

type DealRow = typeof schema.deals.$inferSelect;
type DealPartyRow = typeof schema.dealParties.$inferSelect;

/**
 * The caller's standing on ONE event's deals.
 *
 * Two rules live here, and they are the same rule seen from two sides
 * (decisions #4 + #14):
 *
 * 1. **Visibility is party membership, resolved per deal.** Holding `budget.view`
 *    (being the host) is not itself a grant — the operator sees a deal because it
 *    is a party to it. A performer's private sub-hire has no operator party line,
 *    so the operator cannot see it.
 * 2. **An agent's authority resolves per deal via the `(agent, that deal's
 *    performer)` representation** — the `event_participants(role=agent)` row is
 *    only the reachability edge, never a blanket event-level grant. One agent row
 *    may carry several represented performers; on every other deal on the same
 *    event the agent is an outsider.
 */
export interface DealAuthority extends DealViewer {
  /** Participant rows the caller stands behind directly (their own memberships). */
  ownParticipantIds: string[];
  /**
   * Participant rows the caller stands behind AS AGENT: performers who have an
   * ACTIVE representation with this agent, whose participation on this event is
   * flagged delegated to it, on an in-region event. Resolved per performer.
   */
  representedParticipantIds: string[];
  /** True when every row the caller reaches this event through is an `agent` row. */
  actsOnlyAsAgent: boolean;
}

/** A resolved, authorized deal access: the caller's standing plus the deal's party lines. */
export interface DealAccess {
  authority: DealAuthority;
  parties: DealPartyRow[];
  capabilities: Set<Capability>;
}

/** The delegation flag written onto the performer's participation when an agent is assigned. */
function delegatedToAgentProfileId(details: unknown): string | null {
  return (
    (details as { delegatedToAgentProfileId?: string } | null)?.delegatedToAgentProfileId ?? null
  );
}

/**
 * The participant rows a caller acting as AGENT stands behind on this event.
 *
 * Both edges must hold, per performer: the performer's participation is flagged
 * delegated to this agent (the explicit, performer-chosen assignment — decisions
 * #14, 2026-07-21) AND the `(agent, performer)` representation is still ACTIVE and
 * covers the venue's country. Neither the participant row nor the representation
 * alone is authority.
 */
async function resolveRepresentedParticipants(
  request: FastifyRequest,
  eventId: string,
  agentProfileIds: string[],
): Promise<string[]> {
  const { database } = request.server;

  const participants = await database
    .select({
      id: schema.eventParticipants.id,
      profileId: schema.eventParticipants.profileId,
      details: schema.eventParticipants.details,
    })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );

  const delegated = participants
    .map((participant) => ({
      ...participant,
      agentProfileId: delegatedToAgentProfileId(participant.details),
    }))
    .filter(
      (participant) =>
        participant.agentProfileId != null && agentProfileIds.includes(participant.agentProfileId),
    );
  if (delegated.length === 0) return [];

  // `status = 'active'` is the SQL prefilter only: a representation working out an
  // agreed notice period is still `active`, and one whose effective moment has
  // passed is dead to every reader the instant it passes — swept or not (A-19).
  // `isRepresentationActiveAt` is the single answer to "is this live right now?".
  const now = new Date();
  const representations = (
    await database
      .select()
      .from(schema.representations)
      .where(
        and(
          inArray(schema.representations.agentProfileId, agentProfileIds),
          inArray(
            schema.representations.performerProfileId,
            // An erased participant (migration 0032) has no profile, so no
            // representation can name it as the performer being represented.
            delegated
              .map((participant) => participant.profileId)
              .filter((profileId): profileId is string => profileId !== null),
          ),
          eq(schema.representations.status, "active"),
        ),
      )
  ).filter((representation) => isRepresentationActiveAt(representation, now));
  if (representations.length === 0) return [];

  const venueCountry = await eventVenueCountry(request, eventId);

  const represented: string[] = [];
  for (const participant of delegated) {
    const representation = representations.find(
      (row) =>
        row.agentProfileId === participant.agentProfileId &&
        row.performerProfileId === participant.profileId,
    );
    // Scope ceiling: in-region only — the territory can shrink after assignment.
    if (!representation || !countryInRegion(venueCountry, representation)) continue;
    represented.push(participant.id);
  }
  return represented;
}

/** The country of the event's venue profile — the territory test for a representation. */
async function eventVenueCountry(request: FastifyRequest, eventId: string): Promise<string | null> {
  const { database } = request.server;
  const [event] = await database
    .select({ venueProfileId: schema.events.venueProfileId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  if (!event?.venueProfileId) return null;
  const [location] = await database
    .select({ country: schema.profileLocations.country })
    .from(schema.profileLocations)
    .where(eq(schema.profileLocations.profileId, event.venueProfileId));
  return location?.country ?? null;
}

/**
 * Resolve who the caller is, on this event's deals. `viewerParticipantIds` is the
 * union of the rows they stand behind themselves and the rows they stand behind as
 * an agent — the serializer and every gate below work off that one list.
 */
export async function resolveDealAuthority(
  request: FastifyRequest,
  eventId: string,
  capabilities: Set<Capability>,
): Promise<DealAuthority> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  const rows = await request.server.database
    .select({
      id: schema.eventParticipants.id,
      profileId: schema.eventParticipants.profileId,
      role: schema.eventParticipants.role,
    })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.profileMembers.userId, principal.userId),
        eq(schema.profileMembers.status, "active"),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );

  const ownParticipantIds = rows.map((row) => row.id);
  // The inner join to `profile_members` above already excludes erased
  // participants — an equality join never matches a NULL `profile_id` — so this
  // filter is the type system catching up with the query, not a second rule.
  const agentProfileIds = rows
    .filter((row) => row.role === "agent")
    .map((row) => row.profileId)
    .filter((profileId): profileId is string => profileId !== null);
  const representedParticipantIds =
    agentProfileIds.length > 0
      ? await resolveRepresentedParticipants(request, eventId, agentProfileIds)
      : [];

  return {
    ownParticipantIds,
    representedParticipantIds,
    viewerParticipantIds: [...ownParticipantIds, ...representedParticipantIds],
    actsOnlyAsAgent: rows.length > 0 && rows.every((row) => row.role === "agent"),
    isManagingOperator: capabilities.has("budget.view"),
    // Who is asking, for the one question party membership cannot answer: did they write this deal.
    callerUserId: principal.userId,
  };
}

/**
 * THE SAME ANSWER AS `resolveDealAuthority`, FOR MANY EVENTS AT ONCE (QA7-18).
 *
 * A cross-event question — *"which deals are waiting for my signature?"* — cannot call the
 * per-event resolver in a loop without becoming an N+1, and it must not carry a second copy
 * of the delegation rule, which is the subtle half of this module: both edges per performer
 * (the participation flagged delegated AND a live representation covering the venue's
 * country), and `status = 'active'` being only a prefilter because a representation working
 * out an agreed notice period is still active while one whose moment has passed is dead —
 * A-19, the caveat a second implementation would lose first.
 *
 * So: four queries, whatever the number of events, which is the standard `routes/activity.ts`
 * sets for a cross-event read (*"Two extra queries, whatever the number of events; no
 * N+1"*). The per-event resolver above is unchanged and remains the one every deal route
 * uses — this is the same rules over a wider `WHERE`, not a fork of them.
 */
export async function resolveDealAuthorityForEvents(
  request: FastifyRequest,
  eventIds: readonly string[],
  capabilitiesByEvent: Map<string, Set<Capability>>,
): Promise<Map<string, DealAuthority>> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const byEvent = new Map<string, DealAuthority>();
  if (eventIds.length === 0) return byEvent;
  const { database } = request.server;
  const events = [...eventIds];

  // 1. The caller's OWN standing on each event.
  const mine = await database
    .select({
      id: schema.eventParticipants.id,
      eventId: schema.eventParticipants.eventId,
      profileId: schema.eventParticipants.profileId,
      role: schema.eventParticipants.role,
    })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        inArray(schema.eventParticipants.eventId, events),
        eq(schema.profileMembers.userId, principal.userId),
        eq(schema.profileMembers.status, "active"),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );

  const ownByEvent = new Map<string, { id: string; role: string }[]>();
  const agentProfilesByEvent = new Map<string, string[]>();
  for (const row of mine) {
    const own = ownByEvent.get(row.eventId) ?? [];
    own.push({ id: row.id, role: row.role });
    ownByEvent.set(row.eventId, own);
    if (row.role === "agent" && row.profileId) {
      const agents = agentProfilesByEvent.get(row.eventId) ?? [];
      agents.push(row.profileId);
      agentProfilesByEvent.set(row.eventId, agents);
    }
  }

  /*
   * Only the events the caller reaches AS AGENT need the delegation graph at all, and on
   * most readers' dashboards that is none of them — so the three queries below are skipped
   * entirely rather than run over an empty set.
   */
  const agentEvents = [...agentProfilesByEvent.keys()];
  const delegatedByEvent = new Map<string, string[]>();
  if (agentEvents.length > 0) {
    const allAgentProfiles = [...new Set([...agentProfilesByEvent.values()].flat())];

    // 2. Every non-removed participation on those events, for its delegation flag.
    const participants = await database
      .select({
        id: schema.eventParticipants.id,
        eventId: schema.eventParticipants.eventId,
        profileId: schema.eventParticipants.profileId,
        details: schema.eventParticipants.details,
      })
      .from(schema.eventParticipants)
      .where(
        and(
          inArray(schema.eventParticipants.eventId, agentEvents),
          ne(schema.eventParticipants.status, "removed"),
        ),
      );
    const delegated = participants
      .map((participant) => ({
        ...participant,
        agentProfileId: delegatedToAgentProfileId(participant.details),
      }))
      .filter(
        (participant) =>
          participant.profileId != null &&
          participant.agentProfileId != null &&
          (agentProfilesByEvent.get(participant.eventId) ?? []).includes(
            participant.agentProfileId,
          ),
      );

    if (delegated.length > 0) {
      // 3. The representations behind those flags — `isRepresentationActiveAt` decides,
      //    never the column (A-19).
      const now = new Date();
      const representations = (
        await database
          .select()
          .from(schema.representations)
          .where(
            and(
              inArray(schema.representations.agentProfileId, allAgentProfiles),
              inArray(
                schema.representations.performerProfileId,
                delegated
                  .map((participant) => participant.profileId)
                  .filter((profileId): profileId is string => profileId !== null),
              ),
              eq(schema.representations.status, "active"),
            ),
          )
      ).filter((representation) => isRepresentationActiveAt(representation, now));

      // 4. The venue country per event — the territory ceiling, which can shrink after
      //    an assignment was made.
      const venues = await database
        .select({
          eventId: schema.events.id,
          country: schema.profileLocations.country,
        })
        .from(schema.events)
        .leftJoin(
          schema.profileLocations,
          eq(schema.profileLocations.profileId, schema.events.venueProfileId),
        )
        .where(inArray(schema.events.id, agentEvents));
      const countryByEvent = new Map(venues.map((row) => [row.eventId, row.country ?? null]));

      for (const participant of delegated) {
        const representation = representations.find(
          (row) =>
            row.agentProfileId === participant.agentProfileId &&
            row.performerProfileId === participant.profileId,
        );
        if (!representation) continue;
        if (!countryInRegion(countryByEvent.get(participant.eventId) ?? null, representation)) {
          continue;
        }
        const forEvent = delegatedByEvent.get(participant.eventId) ?? [];
        forEvent.push(participant.id);
        delegatedByEvent.set(participant.eventId, forEvent);
      }
    }
  }

  for (const eventId of events) {
    const own = ownByEvent.get(eventId) ?? [];
    const ownParticipantIds = own.map((row) => row.id);
    const representedParticipantIds = delegatedByEvent.get(eventId) ?? [];
    byEvent.set(eventId, {
      ownParticipantIds,
      representedParticipantIds,
      viewerParticipantIds: [...ownParticipantIds, ...representedParticipantIds],
      actsOnlyAsAgent: own.length > 0 && own.every((row) => row.role === "agent"),
      isManagingOperator: capabilitiesByEvent.get(eventId)?.has("budget.view") ?? false,
      // The same caller, whatever the event — this resolver answers for many at once.
      callerUserId: principal.userId,
    });
  }
  return byEvent;
}

/** Load a deal's party lines (unscoped — the serializer applies party-scoping). */
export async function loadDealParties(
  request: FastifyRequest,
  dealId: string,
): Promise<DealPartyRow[]> {
  return request.server.database
    .select()
    .from(schema.dealParties)
    .where(eq(schema.dealParties.dealId, dealId));
}

/**
 * The single gate for acting on an existing deal. Order matters:
 *
 *   event.view → 404 (no event-existence leak)
 *   not a party (per-deal, agent-resolved) → 404 (visibility is not an existence leak)
 *   missing the capability → 403
 *
 * Visibility precedes the capability check on purpose: a caller who cannot see the
 * deal must not learn it exists from a 403, and — the A-02 half — a capability
 * granted at event level (an agent's `deal.edit` / `agreement.manage`) must never
 * reach a deal the caller has no party line on.
 */
export async function requireDealAccess(
  request: FastifyRequest,
  deal: DealRow,
  capability: Capability,
): Promise<DealAccess> {
  const capabilities = await eventCapabilities(request, deal.eventId);
  if (!capabilities.has("event.view")) throw notFound("Deal not found");

  const authority = await resolveDealAuthority(request, deal.eventId, capabilities);
  const parties = await loadDealParties(request, deal.id);
  /*
   * A PARTY, OR THE PERSON WHO WROTE IT (run 13's BLOCKER). Party-scoping alone meant an operator
   * could author a deal between two other participants and then be answered 404 on every route that
   * could send, cancel or delete it — while the two accounts that COULD see it held neither
   * `deal.edit` nor `agreement.manage`. No account in the system could unstick it, and
   * `assertEveryAgreementSigned` refused every future compute on the night.
   */
  if (!isDealReachable(deal, parties, authority)) throw notFound("Deal not found");

  if (capability !== "event.view" && !capabilities.has(capability)) {
    throw forbidden(`Missing capability: ${capability}`);
  }
  return { authority, parties, capabilities };
}
