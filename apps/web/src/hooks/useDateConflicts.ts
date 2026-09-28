import { useGetApiV1EventsDateConflicts } from "@showme/api-client";

/**
 * IS THIS NIGHT ALREADY TAKEN, and what should we say about it?
 *
 * ClickUp 86cbceux0. The room-scoped rule has existed and been tested since the
 * calendar was built; nothing asked it while somebody was making a booking. This
 * is the asking, for the event wizard and the event's own date field.
 *
 * ── It warns. It never blocks. ──────────────────────────────────────────────
 * Nothing here can stop a submit, and nothing should. Ran was explicit that a
 * promoter may run several shows on one night and that an operator can open a
 * date deliberately. So the product rule is *tell them, then let them decide* —
 * and a warning that cannot be overridden is a refusal wearing a softer word.
 *
 * ── Only for a venue the caller runs ────────────────────────────────────────
 * The route is gated on membership of the venue profile, so booking into
 * somebody else's building answers nothing. That is deliberate: another
 * operator's calendar is not ours to show. The hook simply stays quiet, which is
 * the same thing the screen did before this existed.
 */
export interface DateConflicts {
  /** Something is worth saying. False while loading, and for a clean night. */
  hasWarning: boolean;
  /** The room asked about cannot take this night. The stronger of the two. */
  roomIsBusy: boolean;
  /** One sentence, ready to render. Null when there is nothing to say. */
  message: string | null;
  /** The shows already on that night, for a caller that wants to list them. */
  events: { id: string; title: string; status: string; stageName: string | null }[];
}

export interface UseDateConflictsInput {
  /** The venue profile the event is being placed at. Null asks nothing. */
  venueProfileId: string | null;
  /** `yyyy-mm-dd`. Null or empty asks nothing. */
  date: string | null;
  /** The room, when one is picked. Absent asks about the venue entire. */
  stageId?: string | null;
  /** The event being edited, so it never warns about clashing with itself. */
  excludeEventId?: string;
}

export function useDateConflicts({
  venueProfileId,
  date,
  stageId,
  excludeEventId,
}: UseDateConflictsInput): DateConflicts {
  // Both are required for the question to mean anything — a date with no venue
  // is a night at a place we know nothing about.
  const enabled = Boolean(venueProfileId) && Boolean(date);

  const query = useGetApiV1EventsDateConflicts(
    {
      venueProfileId: venueProfileId ?? "",
      date: date ?? "",
      ...(stageId ? { stageId } : {}),
      ...(excludeEventId ? { excludeEventId } : {}),
    },
    // A 403/404 is the ordinary answer for a venue the caller does not run, so
    // it must not retry and must not surface as an error state on a form.
    { query: { enabled, retry: false } },
  );

  const data = query.data;
  const events = data?.events ?? [];
  const blocks = data?.unavailability ?? [];
  const roomIsBusy = data?.roomIsBusy ?? false;

  /*
   * `roomWasAsked` is the hook's to answer, not each caller's (QA7-12).
   *
   * QA7-4 added the flag and wired it into the request inbox, which asks
   * `conflictMessage` directly. Every caller that comes through HERE kept the old
   * sentence, because the parameter defaults to true — so the Create New Event dialog
   * and the event workspace's banner both told an operator who had named no room that
   * "this room is still free". The fact was already in this function: `stageId` is null
   * exactly when nobody named a room.
   */
  const message = conflictMessage({
    roomIsBusy,
    events,
    blocks,
    roomWasAsked: Boolean(stageId),
  });

  return {
    // Follows the MESSAGE, so a caller gating on this can never render a warning
    // state with nothing in it (or hide one that has something to say).
    hasWarning: message !== null,
    roomIsBusy,
    events: events.map((event) => ({
      id: event.id,
      title: event.title,
      status: event.status,
      stageName: event.stageName ?? null,
    })),
    message,
  };
}

/**
 * The sentence. Named things, not counts — "the Main Hall already has Neon Tide"
 * is actionable in a way that "1 conflict" is not.
 *
 * ── THREE tiers, not two ────────────────────────────────────────────────────
 *
 * 1. **A block the operator set themselves.** Stated first when several apply:
 *    it is their own decision being handed back to them, and it outranks a clash
 *    they may not have noticed.
 * 2. **The room cannot take it** — the strong warning.
 * 3. **The room CAN take it, but the venue has a show that night anyway.**
 *
 * The third tier exists because leaving it silent was wrong, and driving this
 * live is what showed it: picking 21 September at a venue whose Main Room is
 * already sold said NOTHING, because the basement was free so the venue was not
 * "full". Technically correct, and useless — the operator wants to know there is
 * already a show in the building whether or not there is room for another. It is
 * phrased as a note rather than a warning, because nothing is wrong.
 */
export function conflictMessage(input: {
  roomIsBusy: boolean;
  events: { title: string; stageName: string | null }[];
  blocks: { reason: string | null }[];
  /**
   * Whether a ROOM was named in the question (QA sweep run 7, QA7-4, found while
   * proving it).
   *
   * `roomIsBusy` answers "is the room I asked about taken", so it is `false` both when
   * a named room is free AND when no room was named at all — and the two need different
   * sentences. The whole-venue question is now the common one: an ordinary public
   * booking request names the venue and leaves the room as "any", and the inbox asks
   * about the venue on its behalf.
   *
   * Defaulted true so every existing caller keeps the sentence it had; the inbox passes
   * false when the request named no room.
   */
  roomWasAsked?: boolean;
}): string | null {
  const blocked = input.blocks[0];
  if (blocked) {
    const because = blocked.reason ? ` (${blocked.reason})` : "";
    return `You marked this date unavailable${because}. You can still book it — the block is yours to change.`;
  }

  const [first, ...rest] = input.events;
  if (!first) {
    // Busy with nothing to name: a show the caller cannot read the title of.
    return input.roomIsBusy ? "This date is already taken." : null;
  }
  const others = rest.length > 0 ? ` and ${rest.length} more` : "";

  if (input.roomIsBusy) {
    const where = first.stageName ? `${first.stageName} already has` : "This date already has";
    return `${where} "${first.title}"${others} on this night. You can book it anyway.`;
  }

  // Room free, building not empty. Say where the other show is, so the reason
  // this is only a note rather than a clash is visible.
  const where = first.stageName ? ` in ${first.stageName}` : "";
  /*
   * "This room is still free" is only true of a room somebody ASKED about. On a
   * whole-venue question — which is what an ordinary booking request with no room
   * produces — it named no room, so the clause answered a question nobody put and left
   * the reader wondering which room it meant. The night's other business is the whole
   * of what can honestly be said.
   */
  if (input.roomWasAsked === false) {
    return `Already on this night: "${first.title}"${where}${others}.`;
  }
  return `Already on this night: "${first.title}"${where}${others}. This room is still free.`;
}
