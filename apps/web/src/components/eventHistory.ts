/**
 * Turning one `activity_log` row into the sentence the Event History tab shows.
 *
 * Pure and React-free on purpose: it is the half of the tab with rules in it, and
 * the rules are worth reading (and checking) without a component around them. The
 * component stays a renderer.
 *
 * It adds NO visibility logic. Rows arrive already access-filtered by
 * `GET /activity`, whose WHERE clause is the single place "who may see this" is
 * decided — see `apps/api/src/lib/activity.ts` for the tiers.
 */
/**
 * The headline for each activity type the API writes. Keyed by `type`, because the
 * type IS the sentence — the summary carries the particulars, never the verb.
 *
 * An unlisted type falls back to a humanized version of its own name, so a new API
 * entry appears in the timeline the day it ships rather than waiting for this map.
 */
const ACTIVITY_TITLE: Record<string, string> = {
  "event.created": "Event created",
  "event.updated": "Event details changed",
  "event.status_changed": "Event status changed",
  "event.published": "Event published",
  "event.info_email_sent": "Info email sent to everyone on the bill",
  "event.handoff": "Event handed over",
  "hold.ranked": "Hold rank changed",
  "hold.confirmed": "Hold confirmed",
  "hold.declined": "Hold declined",
  "hold.lost": "Hold lost",
  "hold.promoted": "Hold promoted",
  "participant.added": "Participant added",
  "participant.updated": "Participant permissions changed",
  "participant.removed": "Participant removed",
  "group.assigned": "Crew group assigned",
  "group.unassigned": "Crew group removed",
  "invitation.sent": "Invitation sent",
  "invitation.accepted": "Invitation accepted",
  "invitation.declined": "Invitation declined",
  "invitation.claimed": "Profile claimed by its owner",
  "schedule.created": "Schedule item added",
  "schedule.updated": "Schedule item changed",
  "schedule.deleted": "Schedule item removed",
  "task.created": "Task added",
  "task.updated": "Task changed",
  "task.completed": "Task completed",
  "task.reopened": "Task reopened",
  "task.deleted": "Task removed",
  "rider.attached": "Rider submitted",
  "rider.removed": "Rider withdrawn",
  "setlist.updated": "Setlist updated",
  "setlist.shared": "Setlist shared",
  "setlist.unshared": "Setlist share revoked",
  "budget.created": "Budget created",
  "budget.assumptions_updated": "Budget assumptions changed",
  "budget.line_added": "Budget line added",
  "budget.line_updated": "Budget line changed",
  "budget.line_removed": "Budget line removed",
  "deal.created": "Deal created",
  "deal.updated": "Deal terms changed",
  "deal.sent": "Agreement sent for confirmation",
  "deal.party_confirmed": "A party confirmed the agreement",
  "deal.confirmed": "Agreement confirmed by all parties",
  "deal.reopened": "Agreement reopened",
  "deal.deleted": "Deal deleted",
  "settlement.overridden": "Settlement corrected by the operator",
  "settlement.confirmed": "Settlement signed off",
  "settlement.finalized": "Settlement finalized — figures locked",
  "transfer.state_changed": "Payment status changed",
  "share.created": "External share link created",
  "share.revoked": "External share link revoked",
  // Written by the off-platform share link (`routes/shares.ts`) rather than by the
  // in-app confirm — a second name for the same consent moment. Both are listed so
  // the timeline reads the same either way.
  "settlement.approved": "Settlement signed off",
  "booking_request.received": "Booking request received",
  "booking_request.status_changed": "Booking request status changed",
  "booking_request.counter_offer": "Counter-offer sent",
  "offer.received": "Offer received",
};

/** `on_hold` → `On hold`. Used for both statuses and unmapped activity types. */
function humanize(value: string): string {
  const spaced = value.replace(/[._]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringListField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/**
 * The detail lines under a headline, read out of the summary jsonb the API wrote.
 *
 * Deliberately a CURATED read rather than a dump of every key. Two reasons: the
 * summaries carry participant and row uuids that mean nothing to a reader, and the
 * API keeps money out of a summary on purpose (`lib/activity.ts`) — a renderer that
 * blindly printed whatever arrived would be one careless writer away from putting a
 * guarantee in front of a `view_only` participant. Anything not named here is not
 * shown.
 */
function activityDetailLines(record: Record<string, unknown>): string[] {
  const lines: string[] = [];

  const subject =
    stringField(record, "name") ??
    stringField(record, "title") ??
    stringField(record, "label") ??
    stringField(record, "groupName") ??
    stringField(record, "profileName") ??
    stringField(record, "recipientName");
  if (subject) lines.push(subject);

  const from = stringField(record, "from");
  const to = stringField(record, "to");
  const transition = Boolean(to);
  if (from && to) lines.push(`${humanize(from)} → ${humanize(to)}`);
  else if (to) lines.push(`→ ${humanize(to)}`);

  // A standing status, where there is no transition to show instead (a newly
  // created event says `draft`, and "Event created" alone is thinner than it needs
  // to be).
  const status = stringField(record, "status") ?? stringField(record, "agreementStatus");
  if (status && !transition) lines.push(`Status: ${humanize(status)}`);

  const scope = stringField(record, "scope");
  if (scope) lines.push(`${humanize(scope)} budget`);

  // The arrow above already says the status moved, so repeating it in the field
  // list is noise. Any OTHER field that moved alongside it still gets named.
  const fields = stringListField(record, "fields").filter(
    (field) => !(transition && field === "status"),
  );
  if (fields.length > 0) lines.push(`Changed: ${fields.join(", ")}`);

  const role = stringField(record, "role");
  if (role) lines.push(`Role: ${humanize(role)}`);

  const localDateTime = stringField(record, "localDateTime");
  if (localDateTime) lines.push(localDateTime.replace("T", " "));

  const dueDate = stringField(record, "dueDate");
  if (dueDate) lines.push(`Due ${dueDate}`);

  const riderType = stringField(record, "riderType");
  if (riderType) lines.push(`${humanize(riderType)} rider`);

  const lineKind = stringField(record, "lineKind");
  if (lineKind) lines.push(humanize(lineKind));

  const overriddenLabels = stringListField(record, "overriddenLabels");
  if (overriddenLabels.length > 0) lines.push(`Corrected: ${overriddenLabels.join(", ")}`);

  // The consent moments say how far along the signatures are, and whether THIS one
  // was the signature that froze the terms.
  const confirmedCount = record.confirmedCount;
  const signatoryCount = record.signatoryCount;
  if (typeof confirmedCount === "number" && typeof signatoryCount === "number") {
    lines.push(`${confirmedCount} of ${signatoryCount} parties confirmed`);
  }
  if (record.termsFrozen === true) lines.push("Terms frozen at this confirmation");

  const itemCount = record.itemCount;
  if (typeof itemCount === "number") lines.push(`${itemCount} songs`);

  const count = record.count;
  if (typeof count === "number") lines.push(`${count} people`);

  const version = record.version;
  if (typeof version === "number") lines.push(`Snapshot v${version}`);

  const reason = stringField(record, "reason");
  if (reason) lines.push(`Reason: ${reason}`);

  if (record.offPlatform === true) lines.push("Off-platform — entered by the operator");
  if (record.via === "share") lines.push("Via an external share link");

  return lines;
}

/**
 * Turn one activity row into a headline plus its particulars.
 *
 * The row arrives already access-filtered by `GET /activity` — the tab renders what
 * it is given and adds no visibility logic of its own, which is why there is exactly
 * one place (the API's WHERE clause) where "who may see this" is decided.
 */
export function describeActivity(
  type: string,
  summary: unknown,
): { title: string; lines: string[] } {
  const title = ACTIVITY_TITLE[type] ?? humanize(type);
  if (!summary || typeof summary !== "object") return { title, lines: [] };
  return { title, lines: activityDetailLines(summary as Record<string, unknown>) };
}
