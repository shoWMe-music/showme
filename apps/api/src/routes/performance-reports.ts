import { schema } from "@showme/db";
import {
  type ProCode,
  type SetlistWork,
  applyBasisPoints,
  isProCode,
  mergeSetlistWorks,
  societyForCountry,
} from "@showme/shared";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { resolveEventCountry } from "../lib/event-territory";

/**
 * The OPERATOR's half of the setlist module (decisions.md "Setlists", RESOLVED):
 * the performer authors the setlist, the operator files the performed-works
 * report derived from it with the collecting society that covers the territory.
 *
 * ## What "file" means here, precisely
 *
 * shoWMe does not submit to STIM, GEMA or anyone else — there is no integration
 * with a society, and `lib/proFilingExport.ts` says so in the file it writes. The
 * real workflow is that the operator downloads the works report and sends it
 * themselves. `POST` records THAT: the filing the operator made, when, in whose
 * name, and with the reference the society handed back. A `performance_reports`
 * row is a log of a real-world act, never a claim that the platform performed one.
 *
 * That distinction is the whole reason this can exist honestly today, and it is
 * why the response is careful never to say "submitted".
 *
 * ## The territory decides everything
 *
 * The society, the tariff and therefore the royalty estimate all follow from the
 * COUNTRY THE SHOW HAPPENED IN (decisions.md #17), resolved from the venue
 * profile's recorded address by `resolveEventCountry`. Not from the operator's own
 * country — a Swedish promoter's Berlin night owes GEMA — and emphatically not
 * from the venue's NAME: the design prototype picked its society with a regex over
 * the venue string, which is a prototype shortcut and is not reproduced.
 *
 * ## One filing per show
 *
 * `performance_reports` is unique on `event_id`. A society hears about a
 * performance once; a second report of the same night is an amendment, so re-
 * filing updates the row and every filing and re-filing leaves an `audit_log`
 * entry. That is what stops the screen offering to file the same thing twice
 * with no trace.
 */

const EventParams = z.object({ id: z.string().uuid() });

const FileReportBody = z.object({
  /**
   * The society's own receipt/reference, when it gave one. Optional and free
   * text: every society formats theirs differently, and a shape we invented
   * would refuse the real one.
   */
  reference: z.string().trim().min(1).max(200).nullish(),
});

const Work = z.object({
  position: z.number().int(),
  title: z.string(),
  durationSeconds: z.number().nullable(),
  performer: z.string().nullable(),
});

/** The society covering the territory, from the shared country → society register. */
const Society = z
  .object({
    name: z.string(),
    fullName: z.string(),
    country: z.string(),
    countryName: z.string(),
  })
  .nullable();

/** The configured tariff, or null when the territory has none (0018 seeds none). */
const Tariff = z
  .object({
    proCode: z.string(),
    proName: z.string(),
    rateBasisPoints: z.number(),
    sourceUrl: z.string().nullable(),
    sourceNote: z.string().nullable(),
  })
  .nullable();

const FiledReport = z
  .object({
    id: z.string(),
    filedAt: z.string(),
    filedByUserId: z.string(),
    filedByProfileId: z.string(),
    proCode: z.string(),
    proName: z.string(),
    country: z.string(),
    reference: z.string().nullable(),
    works: z.array(Work),
    /** Money crosses the JSON boundary as a STRING (money.md). Null = no tariff. */
    estimate: z.string().nullable(),
    estimateCurrency: z.string().nullable(),
    rateBasisPoints: z.number().nullable(),
    ticketRevenue: z.string().nullable(),
  })
  .nullable();

const PerformanceReportResponse = z.object({
  /**
   * The show itself, so the filing document can be assembled from ONE response.
   * `GET /events` carries no venue name and the works come from here anyway; a
   * second round trip to the event detail would only be a way for the two halves
   * of a filing to arrive out of step.
   */
  eventTitle: z.string(),
  eventDate: z.string().nullable(),
  venueName: z.string().nullable(),
  timezone: z.string().nullable(),
  /** ISO 3166-1 alpha-2 of where the show happened, or null when unplaceable. */
  country: z.string().nullable(),
  society: Society,
  tariff: Tariff,
  /**
   * The works about to be filed, as the setlists on this event stand RIGHT NOW —
   * the draft, not the record. The filed report keeps its own snapshot.
   */
  works: z.array(Work),
  /** How many performers have written a setlist. Zero means there is nothing to file. */
  setlistCount: z.number(),
  /** The basis the estimate is charged on, in the event's base currency. */
  ticketRevenue: z.string(),
  currency: z.string(),
  /**
   * The royalty estimate, or null when the territory has no configured tariff.
   *
   * NULL IS THE COMMON ANSWER AND THE CORRECT ONE. It is deliberately not the
   * Budget Planner's flat-6% `planning_default`: on a planning card a qualified
   * guess is useful, but here it would be a royalty figure attached to a named
   * society on a report somebody sends, and nobody published it.
   */
  estimate: z.string().nullable(),
  report: FiledReport,
});

type PerformanceReportRow = typeof schema.performanceReports.$inferSelect;

/** The works column is `jsonb`; it is written from `mergeSetlistWorks` and read back as such. */
function storedWorks(value: unknown): SetlistWork[] {
  return Array.isArray(value) ? (value as SetlistWork[]) : [];
}

function serializeReport(report: PerformanceReportRow) {
  return {
    id: report.id,
    filedAt: report.filedAt.toISOString(),
    filedByUserId: report.filedByUserId,
    filedByProfileId: report.filedByProfileId,
    proCode: report.proCode,
    proName: report.proName,
    country: report.country,
    reference: report.reference,
    works: storedWorks(report.works),
    estimate: report.estimate === null ? null : report.estimate.toString(),
    estimateCurrency: report.estimateCurrency,
    rateBasisPoints: report.rateBasisPoints,
    ticketRevenue: report.ticketRevenue === null ? null : report.ticketRevenue.toString(),
  };
}

/**
 * Everything the filing is derived from, resolved once so the preview and the
 * write can never disagree about what would be filed.
 */
interface FilingDraft {
  readonly eventTitle: string;
  readonly eventDate: string | null;
  readonly venueName: string | null;
  readonly timezone: string | null;
  readonly country: string | null;
  readonly tariff: typeof schema.performingRightsRates.$inferSelect | null;
  readonly works: SetlistWork[];
  readonly setlistCount: number;
  readonly ticketRevenue: bigint;
  readonly currency: string;
  readonly estimate: bigint | null;
}

async function resolveFilingDraft(request: FastifyRequest, eventId: string): Promise<FilingDraft> {
  const { database } = request.server;

  const [event] = await database
    .select({
      title: schema.events.title,
      eventDate: schema.events.eventDate,
      venueName: schema.events.venueName,
      timezone: schema.events.timezone,
      venueProfileId: schema.events.venueProfileId,
      baseCurrency: schema.events.baseCurrency,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  if (!event) throw notFound("Event not found");

  const country = await resolveEventCountry(database, event.venueProfileId);

  const [tariff] = country
    ? await database
        .select()
        .from(schema.performingRightsRates)
        .where(eq(schema.performingRightsRates.country, country))
    : [];

  // Every setlist on the show, merged into ONE running order: the filing is about
  // the performance, not about one act on the bill. Each set carries the act's
  // name so a support slot's songs are not filed under the headliner — the join
  // is to the PROFILE, because `event_participants.performer_tag` holds the slot
  // ("headliner"), not the artist a society needs named.
  const setlists = await database
    .select({ items: schema.setlists.items, performer: schema.profiles.name })
    .from(schema.setlists)
    .innerJoin(
      schema.eventParticipants,
      eq(schema.eventParticipants.id, schema.setlists.participantId),
    )
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
    .where(eq(schema.setlists.eventId, eventId))
    .orderBy(asc(schema.profiles.name));
  const works = mergeSetlistWorks(
    setlists.map((setlist) => ({
      performer: setlist.performer?.trim() || null,
      items: Array.isArray(setlist.items) ? setlist.items : [],
    })),
  );

  const ticketRevenue = await ticketRevenueForEvent(request, eventId, event.baseCurrency);

  return {
    eventTitle: event.title,
    eventDate: event.eventDate,
    venueName: event.venueName,
    timezone: event.timezone,
    country,
    tariff: tariff ?? null,
    works,
    setlistCount: setlists.length,
    ticketRevenue,
    currency: event.baseCurrency,
    // Only ever from a tariff a platform admin read off a published rate card.
    estimate: tariff ? applyBasisPoints(ticketRevenue, tariff.rateBasisPoints) : null,
  };
}

/**
 * What the PRO royalty is charged on: TICKET revenue, and nothing else.
 *
 * A performing-rights tariff is levied on the performance, so the bar take, a
 * sponsorship and a grant are outside it — the same rule
 * `estimatePerformingRightsFee` states for the planner. A ticket line is
 * identified by `details.basis`, exactly as the planner's own reader does
 * (`useBudgetEditor.ts`): matching on the label would break the moment somebody
 * renamed a tier, and a line written before the planner stored a breakdown has
 * no `basis` at all and is read as a ticket line, which is where it came from.
 *
 * Only the SHARED ledger, never a private budget: a co-operator's own sheet is
 * not the show's ticket income. And only lines in the event's base currency —
 * summing across currencies would produce a number in no currency at all. A
 * foreign-currency ticket line is therefore left out rather than mixed in, which
 * can only ever understate the estimate, never overstate it.
 */
async function ticketRevenueForEvent(
  request: FastifyRequest,
  eventId: string,
  baseCurrency: string,
): Promise<bigint> {
  const { database } = request.server;

  const lines = await database
    .select({
      amount: schema.budgetLines.amount,
      currency: schema.budgetLines.currency,
      details: schema.budgetLines.details,
    })
    .from(schema.budgetLines)
    .innerJoin(schema.budgets, eq(schema.budgets.id, schema.budgetLines.budgetId))
    .where(
      and(
        eq(schema.budgets.eventId, eventId),
        eq(schema.budgets.scope, "shared"),
        eq(schema.budgetLines.kind, "revenue"),
      ),
    );

  const NON_TICKET_BASES = new Set(["bar_spend", "other_revenue", "custom_revenue"]);

  return lines.reduce((total, line) => {
    const basis = (line.details as { basis?: string } | null)?.basis;
    if (basis && NON_TICKET_BASES.has(basis)) return total;
    if (line.currency && line.currency !== baseCurrency) return total;
    return total + line.amount;
  }, 0n);
}

/**
 * The operator profile the filing is made in the name of.
 *
 * A promoter who works for two venues stands on this event through one of them,
 * and the row has to say which — so it is read off the caller's own participation
 * rather than from `principal.actingProfileId`, which is a UI preference and can
 * name a profile that is not on this show at all.
 *
 * Only `host`/`co_host` rows count. That is the same set the authorization
 * ceiling restricts `performance_report.file` to, so by the time this runs the
 * caller is known to have one; a missing row would mean the two rules had
 * drifted, and it fails loudly rather than picking a profile.
 */
async function filingProfileId(request: FastifyRequest, eventId: string): Promise<string> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  const [participant] = await request.server.database
    .select({ profileId: schema.eventParticipants.profileId })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        inArray(schema.eventParticipants.role, ["host", "co_host"]),
        ne(schema.eventParticipants.status, "removed"),
        eq(schema.profileMembers.userId, principal.userId),
        eq(schema.profileMembers.status, "active"),
      ),
    );
  if (!participant) {
    throw new Error("filing capability held without a managing-operator participation");
  }
  // The inner join to `profile_members` above cannot match an erased participant
  // (migration 0032) — an equality join never matches a NULL `profile_id` — so
  // this states what the query already guarantees.
  if (!participant.profileId) {
    throw new Error("filing participation has no profile");
  }
  return participant.profileId;
}

async function loadReport(
  request: FastifyRequest,
  eventId: string,
): Promise<PerformanceReportRow | null> {
  const [report] = await request.server.database
    .select()
    .from(schema.performanceReports)
    .where(eq(schema.performanceReports.eventId, eventId));
  return report ?? null;
}

function draftResponse(draft: FilingDraft, report: PerformanceReportRow | null) {
  return {
    eventTitle: draft.eventTitle,
    eventDate: draft.eventDate,
    venueName: draft.venueName,
    timezone: draft.timezone,
    country: draft.country,
    society: societyForCountry(draft.country),
    tariff: draft.tariff
      ? {
          proCode: draft.tariff.proCode,
          proName: draft.tariff.proName,
          rateBasisPoints: draft.tariff.rateBasisPoints,
          sourceUrl: draft.tariff.sourceUrl,
          sourceNote: draft.tariff.sourceNote,
        }
      : null,
    works: draft.works,
    setlistCount: draft.setlistCount,
    ticketRevenue: draft.ticketRevenue.toString(),
    currency: draft.currency,
    estimate: draft.estimate === null ? null : draft.estimate.toString(),
    report: report ? serializeReport(report) : null,
  };
}

export async function performanceReportRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * The filing surface for one show: what WOULD be filed, and what already was.
   *
   * Gated on `budget.view`, alongside the two routes it sits between — the
   * setlist list an operator reads to file, and the territory rate the estimate
   * comes from. The ceiling restricts `budget.view` to the managing operator, so
   * a performer on the bill cannot read the operator's filing through this door.
   */
  app.get(
    "/events/:id/performance-report",
    { schema: { params: EventParams, response: { 200: PerformanceReportResponse } } },
    async (request) => {
      const eventId = request.params.id;
      await requireEventCapability(request, eventId, "budget.view");

      const draft = await resolveFilingDraft(request, eventId);
      return draftResponse(draft, await loadReport(request, eventId));
    },
  );

  /**
   * Record the filing. Upsert on the event — a re-file amends, it does not stack.
   *
   * THE CLIENT SENDS ONLY THE REFERENCE. The society, the territory, the works,
   * the rate and the estimate are all resolved here from the event, its venue,
   * its setlists and `performing_rights_rates`. A royalty figure the browser
   * computed and posted would be a number the server could not vouch for, and
   * this row is the record of what was reported to a rights body.
   */
  app.post(
    "/events/:id/performance-report",
    {
      schema: {
        params: EventParams,
        body: FileReportBody,
        response: { 200: PerformanceReportResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      await requireEventCapability(request, eventId, "performance_report.file");

      const draft = await resolveFilingDraft(request, eventId);

      // Both refusals name something the operator can go and fix, which is why
      // they are 400s with sentences rather than a silently empty filing.
      if (draft.country === null) {
        throw badRequest(
          "This show has no country, so there is no society to file with. Add a country to the venue profile's address and try again.",
        );
      }
      if (draft.works.length === 0) {
        throw badRequest(
          "There is nothing to report — no performer on this show has written a setlist yet.",
        );
      }

      // The tariff row's `pro_name` wins when a rate is configured, because it is
      // what an admin typed against this territory and what the Budget Planner
      // already prints. Otherwise the shared country → society register names the
      // society; unmapped territories (the US, Canada — several competing PROs,
      // see `pro-societies.ts`) file under the country itself rather than under a
      // society we would have had to guess.
      const society = societyForCountry(draft.country);
      const proName = draft.tariff?.proName ?? society?.name ?? draft.country;
      const proCode: ProCode =
        draft.tariff && isProCode(draft.tariff.proCode) ? draft.tariff.proCode : "none";

      const filedByProfileId = await filingProfileId(request, eventId);
      const reference = request.body.reference ?? null;

      const filed = await database.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.performanceReports)
          .where(eq(schema.performanceReports.eventId, eventId));

        const values = {
          eventId,
          proCode,
          proName,
          country: draft.country as string,
          filedAt: new Date(),
          filedByUserId: principal.userId,
          filedByProfileId,
          reference,
          works: draft.works,
          estimate: draft.estimate,
          // The three columns that make the estimate checkable travel with it, and
          // stay null together when there is no tariff (CHECK, migration 0023).
          estimateCurrency: draft.estimate === null ? null : draft.currency,
          rateBasisPoints: draft.tariff?.rateBasisPoints ?? null,
          ticketRevenue: draft.estimate === null ? null : draft.ticketRevenue,
        };

        const [report] = await tx
          .insert(schema.performanceReports)
          .values(values)
          .onConflictDoUpdate({ target: schema.performanceReports.eventId, set: values })
          .returning();
        if (!report) throw new Error("performance report upsert failed");

        await writeAudit(tx, request, {
          capability: "performance_report.file",
          // `.refile` when one already stood, so the trail reads as the amendment
          // history the single row cannot be.
          action: before ? "performance_report.refile" : "performance_report.file",
          targetKind: "performance_report",
          targetId: report.id,
          eventId,
          before: before ?? null,
          after: report,
        });
        return report;
      });

      // No activity-feed row. Adding an `ActivityTargetKind` obliges the read side
      // to grow a matching visibility rule (`lib/activity.ts` says so), and this
      // is operator-only news with a surface of its own that shows the filing and
      // its date. `audit_log` already carries the forensic trail.
      return draftResponse(draft, filed);
    },
  );
}
