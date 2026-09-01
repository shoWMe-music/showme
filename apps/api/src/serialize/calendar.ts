/**
 * Field-level serialization for calendar entries — the half of authorization that
 * decides WHAT you get back once you are allowed to read at all (PLAN.md
 * "Authorization engine"; the same job `serialize/settlement.ts` and
 * `serialize/message.ts` do for party-scoped money and messages).
 *
 * THE RULE: an IMPORTED entry shows its real title only to the person whose
 * calendar it came from. Everyone else — including co-members of the very profile
 * that owns the row — sees that the time is taken and nothing about what it is.
 *
 * WHY IT HAS TO BE HERE AND NOT IN THE CLIENT. A profile-scoped calendar is
 * readable by every member of the profile, and an import lands on a profile
 * because that is whose availability it occupies. So the row containing "Founder
 * Lunch", "MRI scan" or "interview at a competitor" is inside a payload several
 * other people are entitled to fetch. Hiding it in the UI leaves it in the JSON,
 * which is precisely the client-only-hiding gap this rebuild exists to close.
 *
 * WHAT NON-OWNERS SEE INSTEAD: the word **"Busy"** — Google's own convention for
 * a private entry, so it reads as a state rather than as a broken title — plus
 * `titleWithheld: true`, so a screen can say "hidden" honestly instead of
 * presenting a placeholder as if it were the name of the thing. The day, the
 * hours and whether it blocks are all still visible: that a night is taken is the
 * whole point of sharing a calendar, and it is what a booker needs.
 *
 * `entity` (the provider's location — a room, an address, a video link) is
 * withheld on the same rule and for the same reason: "Nordic Oncology Centre" is
 * the diagnosis.
 *
 * SHOWME-AUTHORED entries are untouched. A note or an appointment typed onto a
 * profile's calendar was put there on purpose, for the people who share it.
 */

export interface CalendarItemFields {
  id: string;
  ownerProfileId: string | null;
  ownerUserId: string | null;
  type: string;
  title: string;
  date: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  entity: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  externalSource: string | null;
  externalId: string | null;
  blocksAvailability: boolean;
  promotedEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SerializedCalendarItem {
  id: string;
  ownerProfileId: string | null;
  ownerUserId: string | null;
  type: string;
  title: string;
  /** True when `title` is the placeholder rather than what the entry is called. */
  titleWithheld: boolean;
  date: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  entity: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  externalSource: string | null;
  externalId: string | null;
  blocksAvailability: boolean;
  promotedEventId: string | null;
  /** Set only when the entry is a `tasks` row projected onto the grid. */
  taskId: string | null;
  /** A task's done state; null for stored calendar items. */
  completed: boolean | null;
  createdAt: string;
  updatedAt: string;
}

/** What a reader who is not the importing user is shown in place of the title. */
export const WITHHELD_CALENDAR_TITLE = "Busy";

/** Whether this viewer is the person whose calendar an imported entry came from. */
export function ownsImportedEntry(item: CalendarItemFields, viewerUserId: string): boolean {
  return item.ownerUserId !== null && item.ownerUserId === viewerUserId;
}

export function serializeCalendarItem(
  item: CalendarItemFields,
  viewerUserId: string,
): SerializedCalendarItem {
  const withhold = item.type === "external" && !ownsImportedEntry(item, viewerUserId);

  return {
    id: item.id,
    ownerProfileId: item.ownerProfileId,
    ownerUserId: item.ownerUserId,
    type: item.type,
    title: withhold ? WITHHELD_CALENDAR_TITLE : item.title,
    titleWithheld: withhold,
    date: item.date,
    endDate: item.endDate,
    startTime: item.startTime,
    endTime: item.endTime,
    entity: withhold ? null : item.entity,
    assigneeUserId: item.assigneeUserId,
    assigneeName: item.assigneeName,
    externalSource: item.externalSource,
    externalId: item.externalId,
    blocksAvailability: item.blocksAvailability,
    promotedEventId: item.promotedEventId,
    // A stored calendar item is never a task row — see `taskCalendarEntries` in
    // `routes/calendar.ts` for the entries that carry these.
    taskId: null,
    completed: null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
