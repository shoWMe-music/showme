import { type EventRole, liveEventDelegations } from "@showme/auth";
import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { FastifyRequest } from "fastify";

/**
 * WHO IS IN WHICH THREAD — the rule behind the event's Messages tab.
 *
 * An event is not one conversation. story.md: "the event is the shared object where
 * every party meets; each person sees only **their slice** of it." The operator is
 * the hub — they book the talent, bring on crew, and take the residual — so the
 * conversation graph is hub-and-spoke, not a group chat: two performers on the same
 * bill are arm's-length to each other and have no relationship through the event.
 *
 * Three scopes, and nothing else:
 *   - **event room** (`all`)       — everyone with `event.view`. Doors at 7.
 *   - **operators**  (`operators`) — the managing operators' back office. decisions
 *     #4 makes co-operators transparent to each other (they are co-parties on the
 *     shared deals and share the budget), so they are ONE room, not one each.
 *   - **party thread** (`party` + a participant) — one per counterparty.
 *
 * A party thread is the conversation on **one edge of the event's booking graph**:
 * `(sponsor, counterparty)`. Every counterparty has exactly one other side — the
 * operator who booked them, or the party who brought them (`sponsorParticipantId`,
 * decisions #12: "the sponsor sets the scope … a bringer can never expose beyond
 * their own reach"). That single fact is what keeps a performer's private sub-hire
 * private: decisions #4, "a performer's private sub-hire (performer↔crew) is
 * invisible to the operator (not a party)". The previous `party` visibility — "the
 * operator, or the sender" — put exactly that conversation in front of the operator.
 *
 * The edge is **not transitive**. A crew lead brings their own crew; that crew's
 * thread is with the lead, and the host — the lead's own counterparty — is not in
 * it. Riders recurse the sponsor chain because a rider is a document the sponsor
 * vouched for; a conversation is not a document, and the honest reading of "each
 * person sees only their slice" is the one edge they actually stand on.
 *
 * Nothing here is stored. Membership is derived per request from the participation
 * graph, exactly as decisions #3 has it — "the WHERE *is* the rule". A `threads`
 * table with a member list would be a second access store that can drift from
 * `event_participants`: the `accessUids` fan-out this rebuild exists to delete.
 */

/** The three thread scopes. Mirrors the `message_visibility` enum on the message. */
export type ThreadScope = "all" | "operators" | "party";

/** The managing operators — one back office between them (decisions #4). */
const MANAGING_OPERATOR_ROLES: ReadonlySet<EventRole> = new Set<EventRole>(["host", "co_host"]);

/**
 * The roles that GET a thread of their own — the counterparties. Each holds a slice
 * of the event (their own deal, their own settlement) and meets the other side on
 * their own edge.
 *
 * `host`/`co_host` are absent because they ARE the other side; their room is the
 * operators back office. `agent` is absent for a different and load-bearing reason:
 * per decisions #14 and the authorization skill's INVARIANT, "an `agent`
 * participation is the PROJECTION of a representation, never a grant in its own
 * right", resolved per deal and never as a blanket event grant. An agent holds no
 * slice of the event — so there is no thread that could be theirs. They stand in the
 * threads of the performers they currently represent, and nowhere else.
 */
const COUNTERPARTY_ROLES: ReadonlySet<EventRole> = new Set<EventRole>([
  "performer",
  "support",
  "crew_lead",
  "crew",
]);

/** One participant, reduced to the four facts the thread rule needs. */
export interface ParticipantNode {
  id: string;
  profileId: string;
  profileName: string;
  role: EventRole;
  /** Who brought them (decisions #12). NULL means the operator booked them. */
  sponsorParticipantId: string | null;
}

/** A live agent→performer delegation on this event (representation-backed). */
export interface DelegationEdge {
  agentProfileId: string;
  performerProfileId: string;
}

/** Everything the rule reads. Loaded once, then the rule is pure. */
export interface EventThreadGraph {
  participants: ParticipantNode[];
  delegations: DelegationEdge[];
}

/** A thread the caller may read, named by its actual readers. */
export interface EventThread {
  key: string;
  scope: ThreadScope;
  /** The counterparty whose thread it is — NULL for the room and the back office. */
  participantId: string | null;
  title: string;
  readerParticipantIds: string[];
}

/**
 * The read-side operator signal. `budget.view` is the ceiling's own definition of a
 * MANAGING operator — decisions #4 makes it un-grantable to any arm's-length party,
 * so nobody but a host/co_host can hold it. One signal, defined once, used for the
 * back office both here and in the serializer.
 */
export function isOperatorViewer(capabilities: ReadonlySet<Capability>): boolean {
  return capabilities.has("budget.view");
}

/** `all` / `operators` are one thread each; a party thread is keyed by participant. */
export function threadKey(scope: ThreadScope, participantId: string | null): string {
  return scope === "party" ? `party:${participantId}` : scope;
}

function findParticipant(graph: EventThreadGraph, id: string | null): ParticipantNode | null {
  if (!id) return null;
  return graph.participants.find((participant) => participant.id === id) ?? null;
}

/** The managing operators on this event — the other side of every booked edge. */
function managingOperatorIds(graph: EventThreadGraph): string[] {
  return graph.participants
    .filter((participant) => MANAGING_OPERATOR_ROLES.has(participant.role))
    .map((participant) => participant.id);
}

/**
 * The agent participants standing behind `node` right now.
 *
 * SCOPE: the represented party's OWN edge, never every edge they stand on. An agent
 * is in the (operator ↔ performer) thread because that booking is the job. They are
 * NOT in the performer's thread with a sound engineer the performer sub-hired: that
 * is the performer's own labour arrangement, and decisions #14 draws the ceiling at
 * "in-region events/deals/approvals only — never the performer's profile identity,
 * billing" — story.md's "a booking agent, *not* a manager". The rider rule already
 * reads the same way: an agent's reach is the represented PERFORMER participants,
 * so a performer-sponsored crew's rider is outside it (decisions #12). An agent who
 * brings crew themselves is in that crew's thread as its SPONSOR, which is a
 * different and explicit edge.
 *
 * An agent joins a thread only where a LIVE representation puts them — resolved
 * against the representation, never the `delegatedToAgentProfileId` stamp alone.
 * The stamp is a materialized projection that outlives an effective-dated
 * termination until the `apps/jobs` sweep runs, and authorization must never wait
 * on a reaper (`packages/auth/src/delegation.ts`). So the instant the agreement
 * lapses the agent is out of the thread — past messages included. They keep the
 * commission they earned on deals closed while active (decisions #14, "commission
 * follows the closed deal"), because money earned is not access retained; the
 * performer "regains control of everything still open", and their conversation is
 * part of that. Messages the agent already POSTED stay in the thread, attributed to
 * them: the record stands, the access ends.
 */
function agentsStandingFor(graph: EventThreadGraph, node: ParticipantNode): string[] {
  return graph.participants
    .filter(
      (participant) =>
        participant.role === "agent" &&
        graph.delegations.some(
          (delegation) =>
            delegation.agentProfileId === participant.profileId &&
            delegation.performerProfileId === node.profileId,
        ),
    )
    .map((participant) => participant.id);
}

/**
 * The participants who may read one counterparty's thread:
 *
 *   {the counterparty}
 *   ∪ {their sponsor}                       — the other side of the edge
 *   ∪ {all managing operators}              — only when the operator IS that side
 *   ∪ {agents with a live representation over the counterparty}
 *
 * Returns an empty set for anything that has no thread (an operator, an agent, an
 * id that is not on this event) — the caller treats that as "no such thread".
 */
export function threadReaderParticipantIds(
  graph: EventThreadGraph,
  partyParticipantId: string,
): Set<string> {
  const party = findParticipant(graph, partyParticipantId);
  if (!party || !COUNTERPARTY_ROLES.has(party.role)) return new Set();

  const readers = new Set<string>([party.id]);
  const sponsor = findParticipant(graph, party.sponsorParticipantId);
  if (sponsor) readers.add(sponsor.id);
  // No sponsor stamp means the operator booked them directly — the default for
  // every performer today, since only crew carry a sponsor. Co-operators come in
  // with the host: decisions #4 makes them transparent to each other.
  if (!sponsor || MANAGING_OPERATOR_ROLES.has(sponsor.role)) {
    for (const operatorId of managingOperatorIds(graph)) readers.add(operatorId);
  }
  for (const agentId of agentsStandingFor(graph, party)) readers.add(agentId);
  return readers;
}

/** Every counterparty thread on the event, whether or not it holds any messages. */
export function allPartyThreads(graph: EventThreadGraph): EventThread[] {
  return graph.participants
    .filter((participant) => COUNTERPARTY_ROLES.has(participant.role))
    .map((participant) => ({
      key: threadKey("party", participant.id),
      scope: "party" as const,
      participantId: participant.id,
      title: participant.profileName,
      readerParticipantIds: [...threadReaderParticipantIds(graph, participant.id)],
    }));
}

/**
 * The threads one caller may read. `callerParticipantIds` are the rows they stand
 * behind on this event; `isManagingOperator` is the `budget.view` signal, which the
 * ceiling grants only to host/co_host — the same signal that has always gated the
 * back office.
 *
 * The event room is unconditional: the caller has already passed `event.view`.
 */
export function visibleThreads(
  graph: EventThreadGraph,
  callerParticipantIds: readonly string[],
  isManagingOperator: boolean,
): EventThread[] {
  const mine = new Set(callerParticipantIds);
  const threads: EventThread[] = [
    {
      key: "all",
      scope: "all",
      participantId: null,
      title: "Everyone",
      readerParticipantIds: graph.participants.map((participant) => participant.id),
    },
  ];
  if (isManagingOperator) {
    threads.push({
      key: "operators",
      scope: "operators",
      participantId: null,
      title: "Operators only",
      readerParticipantIds: managingOperatorIds(graph),
    });
  }
  for (const thread of allPartyThreads(graph)) {
    if (thread.readerParticipantIds.some((participantId) => mine.has(participantId))) {
      threads.push(thread);
    }
  }
  return threads;
}

/** Load the graph the rule runs on. Two keyed queries, both by `event_id`. */
export async function loadEventThreadGraph(
  database: Database,
  eventId: string,
  now: Date = new Date(),
): Promise<EventThreadGraph> {
  const rows = await database
    .select({
      id: schema.eventParticipants.id,
      profileId: schema.eventParticipants.profileId,
      profileName: schema.profiles.name,
      role: schema.eventParticipants.role,
      details: schema.eventParticipants.details,
    })
    .from(schema.eventParticipants)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );

  // The inner join to `profiles` above already drops erased participants
  // (migration 0032) — there is nobody behind a name-only row to hold a thread
  // with. The narrowing here is the type system catching up with that join.
  const participants: ParticipantNode[] = rows
    .filter((row): row is typeof row & { profileId: string } => row.profileId !== null)
    .map((row) => ({
      id: row.id,
      profileId: row.profileId,
      profileName: row.profileName,
      role: row.role as EventRole,
      sponsorParticipantId:
        (row.details as { sponsorParticipantId?: string } | null)?.sponsorParticipantId ?? null,
    }));

  // Only pay for the agent feature when an agent is actually here.
  const hasAgent = participants.some((participant) => participant.role === "agent");
  const delegations = hasAgent ? await liveEventDelegations(database, eventId, now) : [];

  return { participants, delegations };
}

/** The caller's standing in this event's threads — the input to every gate below. */
export interface ThreadAccess {
  graph: EventThreadGraph;
  /** The participant rows the caller stands behind themselves. */
  callerParticipantIds: string[];
  isManagingOperator: boolean;
  /** The party threads they may read, by the thread's participant id. */
  readableThreadParticipantIds: Set<string>;
  threads: EventThread[];
}

export async function resolveThreadAccess(
  request: FastifyRequest,
  eventId: string,
  capabilities: Set<Capability>,
): Promise<ThreadAccess> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const { database } = request.server;

  const graph = await loadEventThreadGraph(database, eventId);

  const mine = await database
    .select({ id: schema.eventParticipants.id })
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

  const callerParticipantIds = mine.map((row) => row.id);
  const isManagingOperator = isOperatorViewer(capabilities);
  const threads = visibleThreads(graph, callerParticipantIds, isManagingOperator);

  return {
    graph,
    callerParticipantIds,
    isManagingOperator,
    readableThreadParticipantIds: new Set(
      threads
        .filter((thread) => thread.scope === "party")
        .map((thread) => thread.participantId as string),
    ),
    threads,
  };
}

/**
 * The users to nudge over SSE when a message lands in a party thread — exactly the
 * thread's readers, minus the actor.
 *
 * This has to mirror the read rule, not approximate it. The old recipient rule sent
 * every non-`all` message to the managing operators, which under threads would tell
 * a host that a private sub-hire conversation is happening. The payload carries ids
 * only, so the recipient set IS the protection (`@showme/db/notify`).
 *
 * The event room and the back office keep their existing recipient rules — they are
 * unchanged by threading — so `routes/messages.ts` still calls `messageRecipients`
 * for those two and this only for `party`.
 */
export async function partyThreadRecipientUserIds(
  database: Database,
  eventId: string,
  actorUserId: string,
  threadParticipantId: string,
): Promise<string[]> {
  const graph = await loadEventThreadGraph(database, eventId);
  const readerIds = [...threadReaderParticipantIds(graph, threadParticipantId)];
  if (readerIds.length === 0) return [];

  const rows = await database
    .selectDistinct({ userId: schema.profileMembers.userId })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        inArray(schema.eventParticipants.id, readerIds),
        eq(schema.profileMembers.status, "active"),
        isNotNull(schema.profileMembers.userId),
        ne(schema.profileMembers.userId, actorUserId),
      ),
    );

  return rows
    .map((row) => row.userId)
    .filter((userId): userId is string => userId !== null)
    .sort();
}
