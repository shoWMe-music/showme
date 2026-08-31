import { schema } from "@showme/db";
import { and, eq, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { assertGrantAdminAllows } from "../lib/entitlements";
import { assignGroupToEvent, unassignGroupFromEvent } from "../lib/group-assignment";

const GroupParams = z.object({ gid: z.string().uuid() });
const GroupMemberParams = z.object({ gid: z.string().uuid(), mid: z.string().uuid() });
const GroupProfileParams = z.object({ gid: z.string().uuid(), pid: z.string().uuid() });
const EventParams = z.object({ id: z.string().uuid() });
const EventGroupParams = z.object({ id: z.string().uuid(), gid: z.string().uuid() });

const CreateGroupBody = z.object({ name: z.string().min(1) });
const UpdateGroupBody = z.object({ name: z.string().min(1) });
const AddMemberBody = z
  .object({
    userId: z.string().optional(),
    email: z.string().email().optional(),
    roleLabel: z.string().optional(),
    defaultPermissionSetId: z.string().uuid().optional(),
  })
  .refine((body) => body.userId != null || body.email != null, {
    message: "A member needs a userId (on-platform) or an email (off-platform)",
  });
const LinkProfileBody = z.object({ profileId: z.string().uuid() });
const AssignGroupBody = z.object({
  groupId: z.string().uuid(),
  /** One permission set for every assigned member, overriding their per-member defaults. */
  permissionSetId: z.string().uuid().optional(),
});

const GroupMemberResponse = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  email: z.string().nullable(),
  roleLabel: z.string().nullable(),
  defaultPermissionSetId: z.string().nullable(),
});

const GroupResponse = z.object({
  id: z.string(),
  name: z.string(),
  ownerUserId: z.string(),
  members: z.array(GroupMemberResponse),
  profileIds: z.array(z.string()),
});

const AssignResponse = z.object({
  assigned: z.array(
    z.object({
      participantId: z.string(),
      profileId: z.string(),
      roleLabel: z.string().nullable(),
    }),
  ),
  skippedNoProfile: z.array(z.object({ memberId: z.string(), email: z.string().nullable() })),
  skippedExisting: z.array(z.object({ profileId: z.string() })),
});

/**
 * A crew member's IN-HOUSE block — the operator's own working notes on one
 * person, and the answer to "where do call times live?".
 *
 * NOT a `schedule_items` row, and that is the load-bearing decision here. A
 * run-of-show item is a moment in the day EVERY party coordinates around
 * ("Doors 19:00", "Soundcheck 16:00"), which is why `schedule.view` sits in the
 * performer floor AND the crew floor in `packages/auth/src/presets.ts` —
 * inviolable, so the operator cannot strip it. Nothing written into that table
 * can ever be operator-private; putting a call time there would publish it to
 * the bill and to the act's agent, which is the exact opposite of what the
 * In-House tab means (`docs/meeting-2026-08-settlements-and-deals.md`, 01:40:58).
 *
 * A call time is not a moment in the day either — it is a fact about ONE
 * person's engagement ("Priya is needed from five"), an instruction to an
 * individual rather than a slot on the day sheet. `docs/story.md` puts crew at
 * arm's length: they are booked to do a job, and how the operator staffs the
 * room is not the performer's business.
 *
 * So it lives where the data model always said it did:
 * `event_participants.details` — "crew_details (call_time, task, pay_note)
 * folded in" (`packages/db/src/schema/events.ts`). That column is ALREADY
 * redacted by `serializeParticipant`, and the redaction is backed by the
 * ceiling: `budget.view` may only ever be held by a `host`/`co_host`
 * (`isGrantable`), so no permission set an operator can write hands a THIRD
 * PARTY the key. That is why this needed no migration and no new privacy
 * primitive — it needed the one that was already there.
 *
 * The one exception is the person the note is ABOUT: a participant reading their
 * OWN row sees the keys addressed to them (`callTime`, `task`, `roleLabel` — see
 * `SELF_VISIBLE_DETAIL_KEYS`), because the crew member asked to be in the
 * building at five is the one party who has to be able to read "five". The
 * `privateNote` this route also writes is NOT among them and stays operator-only.
 */
const InHouseParams = z.object({ id: z.string().uuid(), pid: z.string().uuid() });

/** Wall-clock `HH:MM` on the event's own day, in the event's own timezone. */
const wallClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const UpdateInHouseBody = z.object({
  /**
   * Deliberately a time-of-day, not the offset-free local DATE-time
   * `schedule_items` stores. An operator says "call at five", and the day is the
   * show's day — the seeded shape (`"17:00"`) already says so. The cost is
   * honest and small: a load-in the NIGHT BEFORE cannot be expressed here, and
   * should not be — that is a genuine run-of-show item, on the schedule tab,
   * where everyone who has to be in the building can read it.
   *
   * Null clears it. Absent leaves it alone — the two are different acts.
   */
  callTime: wallClockTime.nullable().optional(),
  /** The operator's private note on this person. Null clears it. */
  privateNote: z.string().max(2000).nullable().optional(),
});

const InHouseResponse = z.object({
  participantId: z.string(),
  callTime: z.string().nullable(),
  privateNote: z.string().nullable(),
});

/** The two in-house fields, read out of the participant's `details` blob. */
function serializeInHouse(participant: {
  id: string;
  details: unknown;
}): z.infer<typeof InHouseResponse> {
  const details = (participant.details as Record<string, unknown> | null) ?? {};
  return {
    participantId: participant.id,
    callTime: typeof details.callTime === "string" ? details.callTime : null,
    privateNote: typeof details.privateNote === "string" ? details.privateNote : null,
  };
}

type GroupRow = typeof schema.groups.$inferSelect;
type GroupMemberRow = typeof schema.groupMembers.$inferSelect;

function serializeGroup(group: GroupRow, members: GroupMemberRow[], profileIds: string[]) {
  return {
    id: group.id,
    name: group.name,
    ownerUserId: group.ownerUserId,
    members: members.map((member) => ({
      id: member.id,
      userId: member.userId,
      email: member.email,
      roleLabel: member.roleLabel,
      defaultPermissionSetId: member.defaultPermissionSetId,
    })),
    profileIds,
  };
}

/** Load a group the caller OWNS (groups are user-owned, decisions #12), or 404. */
async function loadOwnedGroup(request: FastifyRequest, groupId: string): Promise<GroupRow> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const [group] = await request.server.database
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.id, groupId), eq(schema.groups.ownerUserId, principal.userId)));
  if (!group) throw notFound("Group not found");
  return group;
}

async function loadGroupDetail(request: FastifyRequest, group: GroupRow) {
  const { database } = request.server;
  const members = await database
    .select()
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, group.id));
  const profiles = await database
    .select({ profileId: schema.groupProfiles.profileId })
    .from(schema.groupProfiles)
    .where(eq(schema.groupProfiles.groupId, group.id));
  return serializeGroup(
    group,
    members,
    profiles.map((row) => row.profileId),
  );
}

/** The caller's own participant on an event, preferring the given roles (the sponsor). */
async function resolveSponsorParticipant(
  request: FastifyRequest,
  eventId: string,
  preferRoles: string[],
): Promise<{ id: string; role: string } | null> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const rows = await request.server.database
    .select({ id: schema.eventParticipants.id, role: schema.eventParticipants.role })
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
      ),
    );
  const preferred = rows.find((row) => preferRoles.includes(row.role));
  return preferred ?? rows[0] ?? null;
}

export async function groupRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List the caller's own groups (roster bundles are user-owned, decisions #12).
  app.get("/groups", { schema: { response: { 200: z.array(GroupResponse) } } }, async (request) => {
    const principal = request.principal;
    if (!principal) throw new Error("principal missing after authentication");
    const groups = await request.server.database
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.ownerUserId, principal.userId));
    return Promise.all(groups.map((group) => loadGroupDetail(request, group)));
  });

  // Create a group.
  app.post(
    "/groups",
    { schema: { body: CreateGroupBody, response: { 201: GroupResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const created = await database.transaction(async (tx) => {
        const [group] = await tx
          .insert(schema.groups)
          .values({ ownerUserId: principal.userId, name: request.body.name })
          .returning();
        if (!group) throw new Error("group create failed");
        await writeAudit(tx, request, {
          capability: "crew.manage",
          action: "group.create",
          targetKind: "group",
          targetId: group.id,
          after: { name: group.name },
        });
        return group;
      });
      return reply.status(201).send(serializeGroup(created, [], []));
    },
  );

  // Read one group the caller owns.
  app.get(
    "/groups/:gid",
    { schema: { params: GroupParams, response: { 200: GroupResponse } } },
    async (request) => {
      const group = await loadOwnedGroup(request, request.params.gid);
      return loadGroupDetail(request, group);
    },
  );

  // Rename a group.
  app.patch(
    "/groups/:gid",
    { schema: { params: GroupParams, body: UpdateGroupBody, response: { 200: GroupResponse } } },
    async (request) => {
      const { database } = request.server;
      const group = await loadOwnedGroup(request, request.params.gid);
      await database.transaction(async (tx) => {
        await tx
          .update(schema.groups)
          .set({ name: request.body.name })
          .where(eq(schema.groups.id, group.id));
        await writeAudit(tx, request, {
          capability: "crew.manage",
          action: "group.update",
          targetKind: "group",
          targetId: group.id,
          before: { name: group.name },
          after: { name: request.body.name },
        });
      });
      return loadGroupDetail(request, { ...group, name: request.body.name });
    },
  );

  // Delete a group (its members + profile links cascade).
  app.delete("/groups/:gid", { schema: { params: GroupParams } }, async (request, reply) => {
    const { database } = request.server;
    const group = await loadOwnedGroup(request, request.params.gid);
    await database.transaction(async (tx) => {
      await tx.delete(schema.groups).where(eq(schema.groups.id, group.id));
      await writeAudit(tx, request, {
        capability: "crew.manage",
        action: "group.delete",
        targetKind: "group",
        targetId: group.id,
        before: { name: group.name },
      });
    });
    return reply.status(204).send();
  });

  // Add a member to a group.
  app.post(
    "/groups/:gid/members",
    { schema: { params: GroupParams, body: AddMemberBody, response: { 200: GroupResponse } } },
    async (request) => {
      const { database } = request.server;
      const group = await loadOwnedGroup(request, request.params.gid);

      // A `userId` that names nobody used to reach the insert and come back as a
      // bare foreign-key 500 — and with `logger: false` that is an empty body the
      // caller cannot act on. Checked here so a typo reads as a typo. Deliberately
      // not an existence oracle: a group is the caller's own, and the id they are
      // passing is one they typed, not one they discovered.
      if (request.body.userId) {
        const [user] = await database
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.id, request.body.userId));
        if (!user)
          throw badRequest(
            "No such user — a group member needs a real userId, or an email for someone off-platform",
          );
      }
      if (request.body.defaultPermissionSetId) {
        const [permissionSet] = await database
          .select({ id: schema.permissionSets.id })
          .from(schema.permissionSets)
          .where(eq(schema.permissionSets.id, request.body.defaultPermissionSetId));
        if (!permissionSet) throw badRequest("No such permission set");
      }

      await database.transaction(async (tx) => {
        const [member] = await tx
          .insert(schema.groupMembers)
          .values({
            groupId: group.id,
            userId: request.body.userId,
            email: request.body.email,
            roleLabel: request.body.roleLabel,
            defaultPermissionSetId: request.body.defaultPermissionSetId,
          })
          .returning();
        if (!member) throw new Error("member add failed");
        await writeAudit(tx, request, {
          capability: "crew.manage",
          action: "group.member.add",
          targetKind: "group_member",
          targetId: member.id,
          after: member,
        });
      });
      return loadGroupDetail(request, group);
    },
  );

  // Remove a member from a group.
  app.delete(
    "/groups/:gid/members/:mid",
    { schema: { params: GroupMemberParams, response: { 200: GroupResponse } } },
    async (request) => {
      const { database } = request.server;
      const group = await loadOwnedGroup(request, request.params.gid);
      await database.transaction(async (tx) => {
        const [removed] = await tx
          .delete(schema.groupMembers)
          .where(
            and(
              eq(schema.groupMembers.id, request.params.mid),
              eq(schema.groupMembers.groupId, group.id),
            ),
          )
          .returning();
        if (!removed) throw notFound("Group member not found");
        await writeAudit(tx, request, {
          capability: "crew.manage",
          action: "group.member.remove",
          targetKind: "group_member",
          targetId: removed.id,
          before: removed,
        });
      });
      return loadGroupDetail(request, group);
    },
  );

  // Link a group to a profile it serves (a group is cross-profile, decisions #12).
  app.post(
    "/groups/:gid/profiles",
    { schema: { params: GroupParams, body: LinkProfileBody, response: { 200: GroupResponse } } },
    async (request) => {
      const { database } = request.server;
      const group = await loadOwnedGroup(request, request.params.gid);
      // Audited, not history: linking a group to a profile decides which events the
      // group can later be assigned to, so it is a real authority change — but it
      // touches no event, and an entry with a null `event_id` is a feed row nobody
      // can scope and nobody reads. The event-side consequence is audited AND
      // recorded as history where it happens: `group.assigned` on the event.
      await database.transaction(async (tx) => {
        await tx
          .insert(schema.groupProfiles)
          .values({ groupId: group.id, profileId: request.body.profileId })
          .onConflictDoNothing();
        await writeAudit(tx, request, {
          capability: "crew.manage",
          action: "group.profile.link",
          targetKind: "group",
          targetId: group.id,
          after: { profileId: request.body.profileId },
        });
      });
      return loadGroupDetail(request, group);
    },
  );

  // Unlink a profile.
  app.delete(
    "/groups/:gid/profiles/:pid",
    { schema: { params: GroupProfileParams, response: { 200: GroupResponse } } },
    async (request) => {
      const { database } = request.server;
      const group = await loadOwnedGroup(request, request.params.gid);
      await database.transaction(async (tx) => {
        await tx
          .delete(schema.groupProfiles)
          .where(
            and(
              eq(schema.groupProfiles.groupId, group.id),
              eq(schema.groupProfiles.profileId, request.params.pid),
            ),
          );
        await writeAudit(tx, request, {
          capability: "crew.manage",
          action: "group.profile.unlink",
          targetKind: "group",
          targetId: group.id,
          before: { profileId: request.params.pid },
        });
      });
      return loadGroupDetail(request, group);
    },
  );

  // Assign a group to an event → one crew participant per member (decisions #12).
  // ANYONE who may bring crew can: an operator (crew.manage/participants.manage)
  // sponsored by the event; or a performer / agent / crew-lead (crew.submit) bringing
  // their OWN crew, sponsored by themselves. The sponsor scopes what the crew sees, so
  // a bringer never exposes beyond their own reach.
  app.post(
    "/events/:id/groups",
    { schema: { params: EventParams, body: AssignGroupBody, response: { 200: AssignResponse } } },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const capabilities = await requireEventCapability(request, eventId, "event.view");
      const isOperator = capabilities.has("crew.manage") || capabilities.has("participants.manage");
      const canSubmit = capabilities.has("crew.submit");
      if (!isOperator && !canSubmit) {
        throw forbidden("You may not add crew to this event");
      }

      // The group must be the caller's own (owner-scoped management).
      const group = await loadOwnedGroup(request, request.body.groupId);

      // Sponsor = the caller's own participant. Operators land on host (→ all riders);
      // a self-bringer lands on their own row (performer/support/agent/crew-lead), which
      // is exactly what scopes their crew's visibility to that bringer's reach.
      const preferRoles = isOperator
        ? ["host", "co_host"]
        : ["performer", "support", "agent", "crew_lead"];
      const sponsor = await resolveSponsorParticipant(request, eventId, preferRoles);
      if (!sponsor) throw forbidden("You are not a participant on this event");

      // Entitlement gate (decisions #4/§C, PLAN.md:614): this assignment writes
      // `event_participants` rows carrying a permission set — the caller's override,
      // or (absent one) each member's stored default, exactly as `assignGroupToEvent`
      // resolves it. A set that confers ADMIN-GRADE authority is the same paid-plan
      // `grant_admin` grant as adding that participant by hand
      // (routes/participants.ts), so it runs through the same helper.
      //
      // Charged to the EVENT HOST's plan — never the crew-bringer's, who may be a
      // performer bringing their own crew and does not pay for this event. Composed
      // AFTER the authorization checks above, never conflated with them.
      const [event] = await database
        .select({ hostProfileId: schema.events.hostProfileId })
        .from(schema.events)
        .where(eq(schema.events.id, eventId));
      if (!event) throw notFound("Event not found");
      const overridePermissionSetId = request.body.permissionSetId ?? null;
      let grantedPermissionSetIds: string[];
      if (overridePermissionSetId) {
        grantedPermissionSetIds = [overridePermissionSetId];
      } else {
        const defaults = await database
          .select({ permissionSetId: schema.groupMembers.defaultPermissionSetId })
          .from(schema.groupMembers)
          .where(eq(schema.groupMembers.groupId, group.id));
        grantedPermissionSetIds = [
          ...new Set(
            defaults
              .map((member) => member.permissionSetId)
              .filter((permissionSetId): permissionSetId is string => permissionSetId != null),
          ),
        ];
      }
      for (const permissionSetId of grantedPermissionSetIds) {
        await assertGrantAdminAllows(database, {
          hostProfileId: event.hostProfileId,
          nextPermissionSetId: permissionSetId,
        });
      }

      const result = await database.transaction(async (tx) => {
        const assigned = await assignGroupToEvent(tx, group, eventId, {
          addedBy: principal.userId,
          sponsorParticipantId: sponsor.id,
          overridePermissionSetId: request.body.permissionSetId ?? null,
        });
        await writeAudit(tx, request, {
          capability: isOperator ? "crew.manage" : "crew.submit",
          action: "group.assign",
          targetKind: "event",
          targetId: eventId,
          eventId,
          after: { groupId: group.id, assigned: assigned.assigned.length },
        });
        await writeActivity(tx, request, {
          eventId,
          type: "group.assigned",
          targetKind: "event",
          targetId: eventId,
          summary: { groupName: group.name, count: assigned.assigned.length },
        });
        return assigned;
      });

      return result;
    },
  );

  // Unassign a group's crew from an event (the inverse) — soft-remove.
  app.delete(
    "/events/:id/groups/:gid",
    { schema: { params: EventGroupParams, response: { 200: z.object({ removed: z.number() }) } } },
    async (request) => {
      const { database } = request.server;
      const { id: eventId, gid } = request.params;

      const capabilities = await requireEventCapability(request, eventId, "event.view");
      const isOperator = capabilities.has("crew.manage") || capabilities.has("participants.manage");
      const canSubmit = capabilities.has("crew.submit");
      if (!isOperator && !canSubmit) {
        throw forbidden("You may not remove crew from this event");
      }
      // A performer may only pull back their OWN group's crew.
      if (!isOperator) await loadOwnedGroup(request, gid);

      const removed = await database.transaction(async (tx) => {
        const count = await unassignGroupFromEvent(tx, gid, eventId);
        await writeAudit(tx, request, {
          capability: isOperator ? "crew.manage" : "crew.submit",
          action: "group.unassign",
          targetKind: "event",
          targetId: eventId,
          eventId,
          after: { groupId: gid, removed: count },
        });
        // The mirror of `group.assigned` — a crew roster leaving is exactly as
        // much event news as one arriving.
        await writeActivity(tx, request, {
          eventId,
          type: "group.unassigned",
          targetKind: "event",
          targetId: eventId,
          summary: { count },
        });
        return count;
      });

      return { removed };
    },
  );

  // The In-House Management tab's write door: the call time and the private note
  // the operator keeps on one crew member. See `InHouseParams` above for why this
  // is not a schedule item.
  //
  // THERE IS NO MATCHING GET, on purpose. `GET /events/:id/participants` already
  // returns `details` — and returns it to the managing operators and nobody else,
  // through `serializeParticipant`. A second read path for the same column would
  // be a second place the redaction has to stay correct.
  app.patch(
    "/events/:id/crew/:pid/in-house",
    {
      schema: {
        params: InHouseParams,
        body: UpdateInHouseBody,
        response: { 200: InHouseResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id: eventId, pid } = request.params;

      // `crew.manage` and not `participants.manage`: this is the capability the
      // In-House tab itself is gated on in the web app, it is a MANAGEMENT
      // capability by name (so `roleFilter` strips it from an `editor`), and it
      // appears in no preset but `operator_full`. A performer, an agent and a crew
      // member each hold `event.view` and so get past the existence gate — and
      // each is refused here, which is the whole point of the surface.
      await requireEventCapability(request, eventId, "crew.manage");

      const [before] = await database
        .select()
        .from(schema.eventParticipants)
        .where(
          and(
            eq(schema.eventParticipants.id, pid),
            eq(schema.eventParticipants.eventId, eventId),
            ne(schema.eventParticipants.status, "removed"),
          ),
        );
      // 404 rather than 403: a participant of some other event is not this
      // caller's business to have confirmed the existence of — the same rule the
      // task assignee check states.
      if (!before) throw notFound("That person is not on this event");

      // CREW ROWS ONLY. Not squeamishness about scope: a PERFORMER's `details`
      // carries `delegatedToAgentProfileId`, which is live authorization state
      // (decisions #14 — it is what puts a represented act's participation in the
      // agent's hands). A route whose job is to edit notes has no business being
      // one bug away from that. Crew rows carry only `sponsorParticipantId`.
      if (before.role !== "crew" && before.role !== "crew_lead") {
        throw badRequest("In-house notes are kept on crew, not on the bill");
      }

      // MERGE, never replace. `details` is a shared blob: `sponsorParticipantId`
      // is written into it by `assignGroupToEvent` and by the participants route,
      // and it is what scopes a crew member's rider visibility to whoever brought
      // them (decisions #12). Overwriting the object would silently widen or
      // destroy that. An explicit `null` DELETES its key rather than storing one,
      // so a cleared field leaves the blob as it was before anyone typed in it.
      const details = { ...((before.details as Record<string, unknown> | null) ?? {}) };
      for (const field of ["callTime", "privateNote"] as const) {
        const value = request.body[field];
        if (value === undefined) continue;
        if (value === null) delete details[field];
        else details[field] = value;
      }

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.eventParticipants)
          .set({ details, updatedAt: new Date() })
          .where(eq(schema.eventParticipants.id, pid))
          .returning();
        if (!after) throw notFound("That person is not on this event");
        await writeAudit(tx, request, {
          capability: "crew.manage",
          action: "participant.in_house_update",
          targetKind: "event_participant",
          targetId: pid,
          eventId,
          before: before.details,
          after: details,
        });
        // DELIBERATELY NO `writeActivity`. The event feed is read by every
        // participant with `event.view`; a line saying the operator changed
        // Priya's call time would announce to the bill and to the act's agent
        // exactly the thing this column is redacted to hide. The forensic record
        // is `audit_log`, which is admin-only (routes/admin.ts).
        return after;
      });

      return serializeInHouse(updated);
    },
  );
}
