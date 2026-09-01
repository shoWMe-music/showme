import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import {
  type IcsEntry,
  IcsParseError,
  type IcsParseResult,
  currencyForCountry,
  isKnownTimeZone,
  parseIcs,
} from "@showme/shared";
import { and, asc, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";
import { canUseFeature } from "../lib/entitlements";
import { resolveEventTimezone } from "../lib/event-timezone";
import { upsertExternalCalendarEvents } from "../lib/external-calendar";
import { type SerializedCalendarItem, serializeCalendarItem } from "../serialize/calendar";

const CalendarParams = z.object({ id: z.string().uuid() });

/**
 * The kinds a person may WRITE. `external` is absent on purpose: an external
 * event is not authored here, it arrives from somebody else's calendar through
 * `lib/external-calendar.ts`, which stamps its provenance at the same time. This
 * omission is what keeps `type = 'external'` and `external_source IS NOT NULL`
 * from ever disagreeing — see the enum's note in `schema/enums.ts`.
 */
const authoredCalendarItemType = z.enum(["task", "appointment", "note"]);

const CreateCalendarBody = z.object({
  type: authoredCalendarItemType,
  title: z.string().min(1),
  date: z.string().min(1),
  endDate: z.string().min(1).optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  ownerProfileId: z.string().uuid().optional(),
  ownerUserId: z.string().optional(),
  entity: z.string().optional(),
  assigneeUserId: z.string().optional(),
  assigneeName: z.string().optional(),
});

const UpdateCalendarBody = z.object({
  type: authoredCalendarItemType.optional(),
  title: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  endDate: z.string().min(1).nullable().optional(),
  startTime: z.string().min(1).nullable().optional(),
  endTime: z.string().min(1).nullable().optional(),
  entity: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
});

/** "Available anyway" — the user's override on an imported entry. */
const BlocksAvailabilityBody = z.object({ blocksAvailability: z.boolean() });

/**
 * Turn an imported entry into a real show. Everything is optional and derived
 * from the entry, exactly as `POST /booking-requests/:id/draft-event` derives
 * from the request — the body exists only so the user can correct it first.
 */
const PromoteEventBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    /** ISO 4217, upper-cased. Derived from the profile's country when omitted. */
    baseCurrency: z
      .string()
      .transform((value) => value.trim().toUpperCase())
      .pipe(z.string().length(3))
      .optional(),
  })
  .nullish();

const ListQuery = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
});

const CalendarResponse = z.object({
  id: z.string(),
  ownerProfileId: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  type: z.string(),
  /** "Busy" for an imported entry belonging to somebody else — see the serializer. */
  title: z.string(),
  titleWithheld: z.boolean(),
  date: z.string(),
  endDate: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  entity: z.string().nullable(),
  assigneeUserId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  externalSource: z.string().nullable(),
  externalId: z.string().nullable(),
  blocksAvailability: z.boolean(),
  promotedEventId: z.string().nullable(),
  /**
   * Set when this entry IS a task from the `tasks` table rather than a
   * `calendar_items` row — the id to open, mark done, or reassign.
   *
   * Null on every stored calendar item, which is most of them. It exists because
   * a task on the grid has to be clickable through to the task flow; without it
   * the calendar would show a deadline the reader cannot act on.
   */
  taskId: z.string().nullable(),
  /** A task's done state, so the grid can strike it through. Null for items. */
  completed: z.boolean().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * What promoting produces, with the plan consequence said out loud — the same
 * contract `DraftEventResponse` states, for the same reason. A promoted entry
 * lands as a DRAFT, and a draft costs nothing: the free-tier cap counts events in
 * `confirmed`/`concluded` (`assertEventCapAllows`), so it bites when the show is
 * confirmed. Returning the live counter lets the screen say that instead of
 * either hiding the cost or inventing one.
 */
const PromoteEventResponse = z.object({
  calendarItemId: z.string(),
  eventId: z.string(),
  title: z.string(),
  eventDate: z.string().nullable(),
  baseCurrency: z.string(),
  status: z.string(),
  eventCap: z.object({
    allowed: z.boolean(),
    used: z.number().nullable(),
    limit: z.number().nullable(),
    /** Always true: the cap bites when the event is confirmed, not now. */
    chargedAtConfirm: z.literal(true),
  }),
});

const DeleteResponse = z.object({ id: z.string(), deleted: z.boolean() });

/**
 * ── IMPORTING AN `.ics` ──────────────────────────────────────────────────────
 *
 * WHAT AN IMPORTED ENTRY BECOMES, which is the whole design question and was
 * the reason the button was a stub: a `calendar_item` of `type = 'external'`,
 * stamped `external_source = 'ics'` — exactly what a connected Google calendar
 * writes. NOT an `event`.
 *
 * An event is the object this app settles money against: it needs a host that
 * may create one, a base currency, a venue, participants and a plan slot, and
 * inventing those from a line in somebody's calendar file makes rows nobody can
 * settle. A `calendar_item` costs nothing if it is wrong — it occupies a night,
 * it can be deleted, and `POST /calendar/:id/promote-event` already exists for
 * the moment the user decides one of them really is a show. So the import lands
 * in the cheap, reversible place and the expensive, irreversible step stays a
 * deliberate act.
 *
 * Choosing `external` over `note`/`appointment` is not a detail either. Only
 * `external` blocks availability, only `external` may be promoted, only
 * `external` withholds its title from co-members, and only `external` carries an
 * identity a re-import can match on. An imported entry needs all four.
 *
 * IDEMPOTENCE comes from the identity, not from this route: `UID` is stored as
 * `external_id`, and `calendar_items_external_identity_idx` (migration 0009) is
 * UNIQUE over `(external_source, external_id, owner_user_id, owner_profile_id)`
 * with `NULLS NOT DISTINCT`. `upsertExternalCalendarEvents` writes through that
 * index, so importing the same file twice refreshes the same rows instead of
 * duplicating them — and it deliberately does not touch `blocks_availability`
 * or `promoted_event_id`, so a second import cannot undo "available anyway" or
 * orphan a show. No new column, and no migration.
 *
 * `commit: false` IS THE PREVIEW — the same code path, stopped before the write,
 * exactly as `POST /profiles/:id/contacts/import` does it. What the preview
 * promises is what the commit does, because there is only one implementation of
 * the rules to be right or wrong.
 */

/** One import is one calendar's worth of entries, not a migration. */
const MAX_IMPORT_ENTRIES = 500;

/**
 * The file itself, in characters. Comfortably under Fastify's 1 MiB body limit
 * once JSON-encoded, so an oversized file is refused with a sentence rather than
 * by a connection reset the screen cannot explain.
 */
const MAX_ICS_CHARACTERS = 512_000;

/** UIDs shoWMe's own export writes (`apps/web/src/lib/calendarIcsExport.ts`). */
const SHOWME_UID_SUFFIX = "@showme.music";

const ImportCalendarBody = z.object({
  /**
   * WHOSE AVAILABILITY these entries occupy. Required, not derived: availability
   * is profile-scoped, and an import with no profile would block nobody while
   * still looking like it had worked.
   */
  ownerProfileId: z.string().uuid(),
  /**
   * The IANA zone the file's absolute and foreign-zoned times are resolved INTO.
   * Optional; falls back to the caller's `users.timezone` and then to UTC —
   * never to the server's zone (Cloud Run is UTC, a laptop is not, and the same
   * file must not import differently in the two). Whatever was used comes back
   * in the response so the screen can name it.
   */
  timeZone: z.string().min(1).max(64).optional(),
  /** The raw file. Parsed HERE, so the preview and the commit read one text. */
  ics: z.string().min(1).max(MAX_ICS_CHARACTERS),
  commit: z.boolean().default(false),
});

const ImportCalendarResult = z.object({
  /** Position among the VEVENTs of the file, 0-based — so a verdict can be placed. */
  index: z.number().int(),
  uid: z.string().nullable(),
  title: z.string(),
  date: z.string().nullable(),
  endDate: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  outcome: z.enum(["imported", "updated", "skipped", "rejected"]),
  /** Always set for skipped/rejected, and for an entry worth a caveat. */
  reason: z.string().nullable(),
  calendarItemId: z.string().nullable(),
});

const ImportCalendarResponse = z.object({
  committed: z.boolean(),
  /** The zone the file's times were read in — named, never assumed. */
  timeZone: z.string(),
  calendarName: z.string().nullable(),
  imported: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  rejected: z.number().int(),
  results: z.array(ImportCalendarResult),
});

type ImportResult = z.infer<typeof ImportCalendarResult>;

type CalendarRow = typeof schema.calendarItems.$inferSelect;

/** Serialize for THIS reader — the title of an import is owner-only. */
function forViewer(item: CalendarRow, request: FastifyRequest) {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  return serializeCalendarItem(item, principal.userId);
}

/**
 * Owner-scoped access: a calendar item is reachable iff the caller owns it
 * directly or through a profile they belong to. Non-reachable is a 404.
 */
async function loadAccessibleItem(request: FastifyRequest, id: string): Promise<CalendarRow> {
  const { database } = request.server;
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  const [item] = await database
    .select()
    .from(schema.calendarItems)
    .where(eq(schema.calendarItems.id, id));
  if (!item) throw notFound("Calendar item not found");

  if (item.ownerUserId && item.ownerUserId === principal.userId) return item;
  if (
    item.ownerProfileId &&
    principal.memberships.some((m) => m.profileId === item.ownerProfileId)
  ) {
    return item;
  }
  throw notFound("Calendar item not found");
}

/** Validate the caller may create in the requested scope; throws 403 otherwise. */
function assertMayWriteScope(
  request: FastifyRequest,
  scope: { ownerUserId: string | null; ownerProfileId?: string },
): void {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  if (scope.ownerUserId && scope.ownerUserId !== principal.userId) {
    throw forbidden("Cannot create an item owned by another user");
  }
  if (
    scope.ownerProfileId &&
    !principal.memberships.some((m) => m.profileId === scope.ownerProfileId)
  ) {
    throw forbidden("You are not a member of that profile");
  }
}

/**
 * The currency to denominate a promoted event in, from the owning profile's
 * primary location. Mirrors what `routes/inbound.ts` does for a draft event —
 * an event's `base_currency` is what its whole budget and settlement are
 * denominated in, so a guess is worse than a refusal.
 */
async function profileCurrency(
  database: FastifyInstance["database"],
  profileId: string,
): Promise<string | null> {
  const [location] = await database
    .select({ country: schema.profileLocations.country })
    .from(schema.profileLocations)
    .where(
      and(
        eq(schema.profileLocations.profileId, profileId),
        eq(schema.profileLocations.isPrimary, true),
      ),
    )
    .limit(1);
  return currencyForCountry(location?.country);
}

/** A parsed entry's verdict, plus the row to write when the verdict says to. */
interface JudgedIcsEntry {
  result: ImportResult;
  /** Present iff this entry will be written; null for skipped and rejected. */
  write: IcsEntry | null;
}

/** What an entry from the file already is inside shoWMe, if anything. */
interface IcsImportContext {
  /** `UID` → the `calendar_items.id` a previous import of this file left behind. */
  alreadyImported: Map<string, string>;
  /** `UID` → what it already is here, for entries that came out of shoWMe itself. */
  ownExport: Map<string, string>;
}

/**
 * Decide, entry by entry, what an import does — the whole rule in one place,
 * used by both the preview and the commit.
 *
 * Four verdicts, and each one is a different question:
 *
 * - **rejected** — the parser could not read it (no UID, no date, a repeat, a
 *   cancellation). It never had a chance of being a row.
 * - **skipped** — readable, but writing it would be wrong: the file mentions the
 *   same UID twice, or the entry is shoWMe's own export of something this reader
 *   already has. Re-importing your own calendar must not shadow it with a copy.
 * - **updated** — this UID has been imported here before. The upsert refreshes
 *   its title and times and leaves "available anyway" and any promoted show
 *   alone. This is what makes importing the same file twice safe.
 * - **imported** — new.
 *
 * A duplicate UID within ONE file is not tidiness: Postgres refuses an
 * `ON CONFLICT` statement that would touch the same row twice, so a file
 * containing a UID twice would fail the whole batch rather than half of it.
 */
function judgeIcsEntries(parsed: IcsParseResult, context: IcsImportContext): JudgedIcsEntry[] {
  const judged: JudgedIcsEntry[] = parsed.rejected.map((rejection) => ({
    result: {
      index: rejection.index,
      uid: rejection.uid,
      title: rejection.title ?? "",
      date: null,
      endDate: null,
      startTime: null,
      endTime: null,
      outcome: "rejected" as const,
      reason: rejection.reason,
      calendarItemId: null,
    },
    write: null,
  }));

  /** UIDs claimed earlier in THIS file — a calendar can collide with itself. */
  const seenInFile = new Map<string, number>();

  for (const entry of parsed.entries) {
    const verdict = (
      outcome: ImportResult["outcome"],
      reason: string | null,
      calendarItemId: string | null,
    ): JudgedIcsEntry => ({
      result: {
        index: entry.index,
        uid: entry.uid,
        title: entry.title,
        date: entry.date,
        endDate: entry.endDate,
        startTime: entry.startTime,
        endTime: entry.endTime,
        outcome,
        reason,
        calendarItemId,
      },
      write: outcome === "imported" || outcome === "updated" ? entry : null,
    });

    const earlier = seenInFile.get(entry.uid);
    if (earlier !== undefined) {
      judged.push(verdict("skipped", `Same UID as entry ${earlier + 1} of this file.`, null));
      continue;
    }
    seenInFile.set(entry.uid, entry.index);

    const ownAs = context.ownExport.get(entry.uid);
    if (ownAs) {
      judged.push(
        verdict("skipped", `This is shoWMe's own export of ${ownAs} you already have.`, null),
      );
      continue;
    }

    const existingId = context.alreadyImported.get(entry.uid);
    if (existingId) {
      const refreshed = "Imported before — its title and times were refreshed, nothing else.";
      judged.push(
        verdict("updated", entry.caveat ? `${refreshed} ${entry.caveat}` : refreshed, existingId),
      );
      continue;
    }

    judged.push(verdict("imported", entry.caveat, null));
  }

  return judged.sort((left, right) => left.result.index - right.result.index);
}

/**
 * The uuid inside a UID this app wrote, or null.
 *
 * The export stamps `<row id>@showme.music`, and a multi-day entry stamps
 * `<row id>@<day>@showme.music` so each drawn day gets its own UID — so the id is
 * the FIRST segment, not everything before the domain.
 */
function showmeRowIdFromUid(uid: string): string | null {
  if (!uid.endsWith(SHOWME_UID_SUFFIX)) return null;
  const candidate = uid.slice(0, -SHOWME_UID_SUFFIX.length).split("@")[0] ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

/**
 * Which of these UIDs are shoWMe's own, describing something the CALLER can
 * already see.
 *
 * The reachability check is the point. A UID minted by this app proves only that
 * some shoWMe account exported it — a file handed from one operator to another
 * carries UIDs that are genuinely external to the recipient, and refusing those
 * would be refusing a real import. So a UID only counts as "already yours" when
 * the row it names is one the caller can actually reach.
 */
async function findOwnExportedEntries(
  database: FastifyInstance["database"],
  request: FastifyRequest,
  uids: readonly string[],
): Promise<Map<string, string>> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  const byRowId = new Map<string, string[]>();
  for (const uid of uids) {
    const rowId = showmeRowIdFromUid(uid);
    if (!rowId) continue;
    byRowId.set(rowId, [...(byRowId.get(rowId) ?? []), uid]);
  }
  if (byRowId.size === 0) return new Map();

  const rowIds = [...byRowId.keys()];
  const profileIds = principal.memberships.map((member) => member.profileId);

  const reachableItemFilters = [eq(schema.calendarItems.ownerUserId, principal.userId)];
  if (profileIds.length > 0) {
    reachableItemFilters.push(inArray(schema.calendarItems.ownerProfileId, profileIds));
  }
  const items = await database
    .select({ id: schema.calendarItems.id })
    .from(schema.calendarItems)
    .where(and(inArray(schema.calendarItems.id, rowIds), or(...reachableItemFilters)));

  const events =
    profileIds.length === 0
      ? []
      : await database
          .select({ id: schema.events.id })
          .from(schema.events)
          .innerJoin(
            schema.eventParticipants,
            eq(schema.eventParticipants.eventId, schema.events.id),
          )
          .where(
            and(
              inArray(schema.events.id, rowIds),
              inArray(schema.eventParticipants.profileId, profileIds),
            ),
          );

  const found = new Map<string, string>();
  for (const row of items) {
    for (const uid of byRowId.get(row.id) ?? []) found.set(uid, "a calendar entry");
  }
  for (const row of events) {
    for (const uid of byRowId.get(row.id) ?? []) found.set(uid, "a show");
  }
  return found;
}

/**
 * The caller's TASKS, projected onto the calendar grid on their due date.
 *
 * Ran asked for the calendar and the Tasks screen to be one thing; this is the
 * reading half of it. A task with a due date of the 14th was invisible on the
 * 14th, because `GET /calendar` only ever read `calendar_items`.
 *
 * A PROJECTION, NOT A MIRROR. The obvious alternative is to write a
 * `calendar_items` row beside every task — faster to read, and a standing
 * obligation to keep two rows saying the same thing through every edit, every
 * completion and every delete. That is the denormalization this rebuild exists to
 * delete (CLAUDE.md: "relational joins replace document denormalization"), so the
 * join happens at read time and there is exactly one row per task, forever.
 *
 * AND IT CANNOT REACH AVAILABILITY, by construction rather than by care. The
 * availability union reads `calendar_items` straight from the database
 * (`lib/availability.ts`, and the public page beyond it); these rows exist only in
 * this response and are never written anywhere. So a deadline can never make
 * somebody unbookable — which is the one way this feature could have done real
 * damage, and the reason it is built this way round.
 *
 * Scoped exactly like the items above: the caller's own tasks plus those of every
 * profile they belong to.
 */
async function taskCalendarEntries(
  request: FastifyRequest,
  range: { from?: string; to?: string },
): Promise<SerializedCalendarItem[]> {
  const { database } = request.server;
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  const profileIds = principal.memberships.map((membership) => membership.profileId);
  const ownerConditions = [eq(schema.tasks.ownerUserId, principal.userId)];
  if (profileIds.length > 0) {
    ownerConditions.push(inArray(schema.tasks.ownerProfileId, profileIds));
  }

  const rows = await database
    .select()
    .from(schema.tasks)
    .where(
      and(
        or(...ownerConditions),
        isNotNull(schema.tasks.dueDate),
        range.from ? gte(schema.tasks.dueDate, range.from) : undefined,
        range.to ? lte(schema.tasks.dueDate, range.to) : undefined,
      ),
    );

  return rows.map((task) => ({
    // Prefixed so it can never collide with a `calendar_items` id, and so a
    // client that keys by `id` cannot mistake one for the other.
    id: `task:${task.id}`,
    ownerProfileId: task.ownerProfileId,
    ownerUserId: task.ownerUserId,
    type: "task",
    title: task.title,
    titleWithheld: false,
    // Non-null by the `isNotNull` filter above; the fallback is for the types.
    date: task.dueDate ?? "",
    endDate: null,
    // A deadline is a day, not a window. Giving it hours would make it look like
    // an appointment and, worse, like something that occupies the evening.
    startTime: null,
    endTime: null,
    entity: null,
    assigneeUserId: null,
    assigneeName: null,
    externalSource: null,
    externalId: null,
    // Stated explicitly even though nothing reads it here: a task is a reminder,
    // never an occupied window.
    blocksAvailability: false,
    promotedEventId: null,
    taskId: task.id,
    completed: task.completed,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }));
}

export async function calendarRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List the caller's own + their profiles' items, optionally within a date range.
  app.get(
    "/calendar",
    { schema: { querystring: ListQuery, response: { 200: z.array(CalendarResponse) } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { from, to } = request.query;

      const profileIds = principal.memberships.map((m) => m.profileId);
      const ownerConditions = [eq(schema.calendarItems.ownerUserId, principal.userId)];
      if (profileIds.length > 0) {
        ownerConditions.push(inArray(schema.calendarItems.ownerProfileId, profileIds));
      }
      const ownerFilter = or(...ownerConditions);

      const rows = await database
        .select()
        .from(schema.calendarItems)
        .where(
          and(
            ownerFilter,
            from ? gte(schema.calendarItems.date, from) : undefined,
            to ? lte(schema.calendarItems.date, to) : undefined,
          ),
        )
        .orderBy(asc(schema.calendarItems.date), asc(schema.calendarItems.id));

      // Tasks join the grid here, at read time — see `taskCalendarEntries` for
      // why they are a projection rather than mirrored rows, and why that is what
      // keeps a deadline out of the availability union.
      const tasks = await taskCalendarEntries(request, { from, to });
      const entries = [...rows.map((row) => forViewer(row, request)), ...tasks];
      entries.sort((left, right) =>
        left.date === right.date
          ? left.id.localeCompare(right.id)
          : left.date.localeCompare(right.date),
      );
      return entries;
    },
  );

  // Create a personal / profile-scoped calendar item.
  app.post(
    "/calendar",
    { schema: { body: CreateCalendarBody, response: { 201: CalendarResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const body = request.body;

      const ownerUserId = body.ownerUserId ?? (body.ownerProfileId ? null : principal.userId);
      assertMayWriteScope(request, { ownerUserId, ownerProfileId: body.ownerProfileId });
      if (body.endDate && body.endDate < body.date) {
        throw badRequest("The end date is before the start date");
      }

      const created = await database.transaction(async (tx) => {
        const [item] = await tx
          .insert(schema.calendarItems)
          .values({
            ownerProfileId: body.ownerProfileId ?? null,
            ownerUserId,
            type: body.type,
            title: body.title,
            date: body.date,
            endDate: body.endDate ?? null,
            startTime: body.startTime ?? null,
            endTime: body.endTime ?? null,
            entity: body.entity ?? null,
            assigneeUserId: body.assigneeUserId ?? null,
            assigneeName: body.assigneeName ?? null,
          })
          .returning();
        if (!item) throw new Error("calendar item create failed");
        const serialized = forViewer(item, request);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "calendar.create",
          targetKind: "calendar_item",
          targetId: item.id,
          after: serialized,
        });
        return serialized;
      });

      return reply.status(201).send(created);
    },
  );

  // Update an item within the caller's scope.
  app.patch(
    "/calendar/:id",
    {
      schema: {
        params: CalendarParams,
        body: UpdateCalendarBody,
        response: { 200: CalendarResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const before = await loadAccessibleItem(request, id);
      const body = request.body;

      // An imported entry is a cached copy of somebody else's row: editing it here
      // would be overwritten by the very next sync, which is a worse experience
      // than being told no. "Available anyway" is the one thing that IS ours to
      // change, and it has its own route below.
      if (before.type === "external") {
        throw conflict(
          "This entry comes from a connected calendar — edit it there, or use 'available anyway'",
        );
      }

      const nextDate = body.date ?? before.date;
      const nextEndDate = body.endDate === undefined ? before.endDate : body.endDate;
      if (nextEndDate && nextEndDate < nextDate) {
        throw badRequest("The end date is before the start date");
      }

      const fields: Partial<typeof schema.calendarItems.$inferInsert> = { updatedAt: new Date() };
      if (body.type !== undefined) fields.type = body.type;
      if (body.title !== undefined) fields.title = body.title;
      if (body.date !== undefined) fields.date = body.date;
      if (body.endDate !== undefined) fields.endDate = body.endDate;
      if (body.startTime !== undefined) fields.startTime = body.startTime;
      if (body.endTime !== undefined) fields.endTime = body.endTime;
      if (body.entity !== undefined) fields.entity = body.entity;
      if (body.assigneeUserId !== undefined) fields.assigneeUserId = body.assigneeUserId;
      if (body.assigneeName !== undefined) fields.assigneeName = body.assigneeName;

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.calendarItems)
          .set(fields)
          .where(eq(schema.calendarItems.id, id))
          .returning();
        if (!after) throw notFound("Calendar item not found");
        const serialized = forViewer(after, request);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "calendar.update",
          targetKind: "calendar_item",
          targetId: id,
          before: forViewer(before, request),
          after: serialized,
        });
        return serialized;
      });

      return updated;
    },
  );

  /**
   * "Available anyway" — the user's override on an imported entry.
   *
   * Its own route rather than a field on the PATCH above for two reasons that both
   * matter: the PATCH refuses imported entries outright (their content belongs to
   * the far side), and this is the one decision about them that is genuinely ours.
   * A dedicated action also gives the audit trail a legible verb — a reader of the
   * log sees "this user re-opened that night", not "a boolean moved".
   *
   * It changes availability the moment it is written: `lib/availability.ts` reads
   * the flag, so the public page and the share window both follow on the next read.
   */
  app.patch(
    "/calendar/:id/availability",
    {
      schema: {
        params: CalendarParams,
        body: BlocksAvailabilityBody,
        response: { 200: CalendarResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const before = await loadAccessibleItem(request, id);

      if (before.type !== "external") {
        throw badRequest("Only an imported calendar entry blocks availability");
      }

      return database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.calendarItems)
          .set({
            blocksAvailability: request.body.blocksAvailability,
            updatedAt: new Date(),
          })
          .where(eq(schema.calendarItems.id, id))
          .returning();
        if (!after) throw notFound("Calendar item not found");
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: request.body.blocksAvailability
            ? "calendar.blocks_availability"
            : "calendar.available_anyway",
          targetKind: "calendar_item",
          targetId: id,
          before: { blocksAvailability: before.blocksAvailability },
          after: { blocksAvailability: after.blocksAvailability },
        });
        return forViewer(after, request);
      });
    },
  );

  /**
   * "Turn it into a show" — promote an imported entry into a real shoWMe event.
   *
   * This is the SAME operation as `POST /booking-requests/:id/draft-event` and it
   * is built the same way deliberately: a non-event becomes a DRAFT event, the two
   * stay linked by a column on the non-event (`promoted_event_id` here,
   * `booking_requests.event_id` there), the mutation is audited and posted to the
   * activity feed, and the plan consequence is reported rather than hidden. Two
   * shapes for one operation would be two sets of bugs.
   *
   * WHAT IT COSTS: nothing today. The free-tier cap counts `confirmed`/`concluded`
   * events, and this lands on the `draft` column default by construction — the
   * response carries the live counter so the screen can say "confirming it later
   * is what spends a slot".
   *
   * WHAT IT DOES NOT DO: stop the entry blocking. The commitment is still on the
   * user's real calendar and still occupies that night — now as a show as well.
   * The two do not double-count, because availability is a union of windows, not a
   * sum.
   */
  app.post(
    "/calendar/:id/promote-event",
    {
      schema: {
        params: CalendarParams,
        body: PromoteEventBody,
        response: { 201: PromoteEventResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;
      const body = request.body ?? {};
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const item = await loadAccessibleItem(request, id);

      if (item.type !== "external") {
        throw badRequest("Only an imported calendar entry can become a show");
      }
      if (item.promotedEventId) {
        throw conflict("This entry is already a show");
      }
      // An event is hosted by a profile, and availability is a profile's. An entry
      // that occupies nobody's profile calendar has no host to give the show.
      if (!item.ownerProfileId) {
        throw badRequest("Import this calendar into a profile before turning entries into shows");
      }

      const membership = principal.memberships.find((m) => m.profileId === item.ownerProfileId);
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        throw forbidden("Only an owner or admin of this profile can create an event");
      }
      // The same rule `POST /events` and the draft-event route enforce — an event
      // is hosted by an operator (story.md: the operator runs the show and carries
      // the residual). A performer's imported gig is still a booking somebody else
      // hosts, not an event they create.
      if (membership.kind !== "operator") {
        throw forbidden("Only operator profiles can create events");
      }

      const baseCurrency =
        body.baseCurrency ?? (await profileCurrency(database, item.ownerProfileId));
      if (!baseCurrency) {
        throw badRequest(
          "Set a country on your profile's primary location, or pass a currency, before turning a calendar entry into a show",
        );
      }

      const ownerProfileId = item.ownerProfileId;
      const [ownerProfile] = await database
        .select({ name: schema.profiles.name, type: schema.profiles.type })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, ownerProfileId));

      const created = await database.transaction(async (tx) => {
        const [permissionSet] = await tx
          .insert(schema.permissionSets)
          .values({
            profileId: ownerProfileId,
            name: "operator_full",
            capabilities: [...PRESET_PERMISSION_SETS.operator_full],
          })
          .returning();
        if (!permissionSet) throw new Error("permission set create failed");

        // A venue hosting its own show is its own venue; a promoter is not, and
        // stamping it would put the wrong address (and timezone) on the event.
        const venueProfileId = ownerProfile?.type === "venue" ? ownerProfileId : undefined;
        const timezone = await resolveEventTimezone(tx, venueProfileId, undefined);

        const [event] = await tx
          .insert(schema.events)
          .values({
            hostProfileId: ownerProfileId,
            title: body.title ?? item.title,
            baseCurrency,
            eventDate: item.date,
            // The imported window becomes the stage window. Door time is left
            // unset: a calendar entry says when the commitment runs, never when
            // the room opens, and inventing one puts a false fact on the event.
            startTime: item.startTime ?? undefined,
            endTime: item.endTime ?? undefined,
            venueProfileId,
            venueName: venueProfileId ? (ownerProfile?.name ?? undefined) : undefined,
            notes: promotedEventNotes(item),
            timezone,
            createdBy: principal.userId,
          })
          .returning();
        if (!event) throw new Error("promoted event create failed");

        await tx.insert(schema.eventParticipants).values({
          eventId: event.id,
          profileId: ownerProfileId,
          role: "host",
          permissionSetId: permissionSet.id,
          status: "confirmed",
        });

        const [linked] = await tx
          .update(schema.calendarItems)
          .set({ promotedEventId: event.id, updatedAt: new Date() })
          .where(eq(schema.calendarItems.id, id))
          .returning();
        if (!linked) throw notFound("Calendar item not found");

        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "calendar.promote_event",
          targetKind: "event",
          targetId: event.id,
          eventId: event.id,
          before: forViewer(item, request),
          after: { event, calendarItemId: id },
        });
        await writeActivity(tx, request, {
          eventId: event.id,
          type: "event.created",
          targetKind: "event",
          targetId: event.id,
          summary: { title: event.title, fromCalendarItemId: id },
        });

        return event;
      });

      // A FRESH read of the entitlement layer (decisions #4 — never conflated with
      // authorization, never cached): what the plan allows RIGHT NOW, so the screen
      // can name the consequence of confirming this draft later.
      const eventCap = await canUseFeature(database, ownerProfileId, "create_event");

      return reply.status(201).send({
        calendarItemId: id,
        eventId: created.id,
        title: created.title,
        eventDate: created.eventDate ?? null,
        baseCurrency: created.baseCurrency,
        status: created.status,
        eventCap: {
          allowed: eventCap.allowed,
          used: eventCap.used ?? null,
          limit: eventCap.limit ?? null,
          chargedAtConfirm: true as const,
        },
      });
    },
  );

  /**
   * Import an `.ics` file as calendar entries. `commit: false` is the preview.
   *
   * THE BAR IS OWNER OR ADMIN of the profile, the same one
   * `POST /integrations/calendar/google/connect` sets, for the same reason: this
   * takes nights OFF the profile's public availability, which is a decision about
   * what the outside world may book — not a personal preference. An editor may
   * see the entries; they may not decide the account is busy.
   */
  app.post(
    "/calendar/import",
    {
      schema: {
        body: ImportCalendarBody,
        response: { 200: ImportCalendarResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { ownerProfileId, ics, commit } = request.body;

      requireProfileRole(request, ownerProfileId, ["owner", "admin"]);

      // The frame the file's absolute and foreign-zoned times are read in. Asked
      // for, then stored, then UTC — never the server's own zone.
      const [user] = await database
        .select({ timezone: schema.users.timezone })
        .from(schema.users)
        .where(eq(schema.users.id, principal.userId));
      const requested = request.body.timeZone ?? user?.timezone ?? "UTC";
      const timeZone = isKnownTimeZone(requested) ? requested : "UTC";

      let parsed: IcsParseResult;
      try {
        parsed = parseIcs(ics, { timeZone });
      } catch (error) {
        if (error instanceof IcsParseError) throw badRequest(error.message);
        throw error;
      }
      if (parsed.entries.length > MAX_IMPORT_ENTRIES) {
        throw badRequest(
          `That file has ${parsed.entries.length} entries. One import takes ${MAX_IMPORT_ENTRIES}.`,
        );
      }

      const uids = parsed.entries.map((entry) => entry.uid);
      const alreadyImported = new Map<string, string>();
      if (uids.length > 0) {
        const existing = await database
          .select({ id: schema.calendarItems.id, externalId: schema.calendarItems.externalId })
          .from(schema.calendarItems)
          .where(
            and(
              eq(schema.calendarItems.externalSource, "ics"),
              eq(schema.calendarItems.ownerProfileId, ownerProfileId),
              eq(schema.calendarItems.ownerUserId, principal.userId),
              isNotNull(schema.calendarItems.externalId),
              inArray(schema.calendarItems.externalId, uids),
            ),
          );
        for (const row of existing) {
          if (row.externalId) alreadyImported.set(row.externalId, row.id);
        }
      }

      const judged = judgeIcsEntries(parsed, {
        alreadyImported,
        ownExport: await findOwnExportedEntries(database, request, uids),
      });

      if (commit) {
        const writes = judged.flatMap((row) => (row.write ? [row.write] : []));
        if (writes.length > 0) {
          // THE SEAM DOES THE WRITING (`lib/external-calendar.ts`) — one
          // `INSERT … ON CONFLICT DO UPDATE` through 0009's unique index, which
          // is what makes a second import of the same file an update rather than
          // a duplicate, and what keeps `blocks_availability` and
          // `promoted_event_id` out of the update set. A Google sync and an `.ics`
          // import are the same operation with different transport, so they are
          // deliberately the same write.
          await upsertExternalCalendarEvents(database, {
            provider: "ics",
            ownerProfileId,
            ownerUserId: principal.userId,
            events: writes.map((entry) => ({
              externalId: entry.uid,
              title: entry.title,
              date: entry.date,
              endDate: entry.endDate,
              startTime: entry.startTime,
              endTime: entry.endTime,
              location: entry.location,
            })),
          });

          // Read the ids back by identity rather than trusting the order rows come
          // out of a multi-row upsert — the mapping is what the response reports
          // and what the audit trail points at.
          const stored = await database
            .select({ id: schema.calendarItems.id, externalId: schema.calendarItems.externalId })
            .from(schema.calendarItems)
            .where(
              and(
                eq(schema.calendarItems.externalSource, "ics"),
                eq(schema.calendarItems.ownerProfileId, ownerProfileId),
                eq(schema.calendarItems.ownerUserId, principal.userId),
                isNotNull(schema.calendarItems.externalId),
                inArray(
                  schema.calendarItems.externalId,
                  writes.map((entry) => entry.uid),
                ),
              ),
            );
          const idByUid = new Map(
            stored.flatMap((row) => (row.externalId ? [[row.externalId, row.id] as const] : [])),
          );

          await database.transaction(async (tx) => {
            for (const row of judged) {
              if (!row.write) continue;
              const itemId = idByUid.get(row.write.uid) ?? null;
              row.result.calendarItemId = itemId;
              if (!itemId) continue;
              await writeAudit(tx, request, {
                capability: "profile.edit",
                action: "calendar.import",
                targetKind: "calendar_item",
                targetId: itemId,
                after: {
                  source: "ics",
                  uid: row.write.uid,
                  title: row.write.title,
                  date: row.write.date,
                  endDate: row.write.endDate,
                  startTime: row.write.startTime,
                  endTime: row.write.endTime,
                  // The frame the wall clocks above were read in. `calendar_items`
                  // has no zone column, so the trail is the only record of it.
                  readInTimeZone: timeZone,
                  refreshedExisting: row.result.outcome === "updated",
                },
              });
            }
          });
        }
      }

      const results = judged.map((row) => row.result);
      const count = (outcome: ImportResult["outcome"]) =>
        results.filter((result) => result.outcome === outcome).length;
      return {
        committed: commit,
        timeZone,
        calendarName: parsed.calendarName,
        imported: count("imported"),
        updated: count("updated"),
        skipped: count("skipped"),
        rejected: count("rejected"),
        results,
      };
    },
  );

  // Delete an item within the caller's scope.
  app.delete(
    "/calendar/:id",
    { schema: { params: CalendarParams, response: { 200: DeleteResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const before = await loadAccessibleItem(request, id);

      await database.transaction(async (tx) => {
        await tx.delete(schema.calendarItems).where(eq(schema.calendarItems.id, id));
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "calendar.delete",
          targetKind: "calendar_item",
          targetId: id,
          before: forViewer(before, request),
        });
      });

      return { id, deleted: true };
    },
  );
}

/**
 * What the draft carries over from the entry it came from. The provenance goes in
 * the notes rather than into a field of its own, exactly as a draft event records
 * the booking request it came from: it is context for whoever picks the draft up,
 * not structured data anything queries.
 */
function promotedEventNotes(item: CalendarRow): string {
  const lines = [`Created from a ${item.externalSource ?? "calendar"} entry: ${item.title}`];
  if (item.endDate && item.endDate !== item.date) {
    lines.push(`Runs ${item.date} → ${item.endDate}.`);
  }
  if (item.entity) lines.push(`Location on the original entry: ${item.entity}.`);
  return lines.join("\n");
}
