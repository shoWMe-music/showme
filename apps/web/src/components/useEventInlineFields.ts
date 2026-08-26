import {
  ApiError,
  getGetApiV1EventsIdQueryKey,
  type patchApiV1EventsId,
  usePatchApiV1EventsId,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../lib/errors";
import type { VenueChoice } from "./EventVenuePicker";

/** The body `PATCH /events/:id` accepts, taken from the generated client so a
 * regenerated contract fails the build instead of the request. */
type EventPatchBody = Parameters<typeof patchApiV1EventsId>[1];

/**
 * The six event fields the Event Information card lets an operator change in
 * place. The operator (host profile) and the performers (participants) are
 * deliberately absent — each is owned by another surface.
 */
export type EventInlineFieldName =
  | "title"
  | "eventDate"
  | "venueName"
  | "stageId"
  | "capacity"
  | "status";

/** What each field is called, in one place: the row's label, the control's
 * label, the aria-label of the closed row and the wording of a conflict all
 * have to say the same word or they read as different fields. */
export const EVENT_INLINE_FIELD_LABEL: Record<EventInlineFieldName, string> = {
  title: "Event Name",
  eventDate: "Date",
  venueName: "Venue",
  stageId: "Room / Stage",
  capacity: "Capacity",
  status: "Status",
};

/** The status vocabulary the API will actually accept, read off the generated
 * client — so a status added or dropped server-side fails the build, not a
 * request. */
type EventStatusValue = NonNullable<EventPatchBody["status"]>;

export interface EventStatusOption {
  value: EventStatusValue;
  label: string;
  description: string;
}

/**
 * The `event_status` enum (packages/db/src/schema/enums.ts) in the order an
 * event travels it, with what each stop MEANS — inferred from docs/story.md's
 * purpose/boundary for the operator, not from booking-industry convention.
 *
 * **Any status may be chosen, in any direction.** The status is the operator's
 * own record of where a booking stands, not a handshake: an operator working
 * alone — a venue running its own room, or anyone typing in the bookings they
 * already have — has to be able to move the event themselves. Onboarding is
 * mostly BACKWARDS moves (a booking typed in as confirmed, then corrected to
 * pending when the artist turns out not to have signed), and a one-way rail
 * would make the first mistake permanent.
 *
 * Counterparty consent is real and deliberately elsewhere: a DEAL freezes only
 * when every non-observer party has confirmed its own `deal_parties` row, and
 * an INVITATION grants nothing until the invitee accepts it. Neither is touched
 * here, and neither may ever be driven from this row.
 */
export const EVENT_STATUS_OPTIONS: EventStatusOption[] = [
  {
    value: "draft",
    label: "Draft",
    description: "Yours alone. Nothing has been put to anybody yet.",
  },
  {
    value: "suggested",
    label: "Suggested",
    description: "Floated as an idea. No date is being held and nothing is promised.",
  },
  { value: "pending", label: "Pending", description: "Offered, and waiting on an answer." },
  {
    value: "on_hold",
    label: "On hold",
    description:
      "The date is pencilled in a queue rather than booked. Set the priority from the hold flow; without one it queues first.",
  },
  {
    value: "confirmed",
    label: "Confirmed",
    description: "The booking is on. This is the status that counts against your plan.",
  },
  {
    value: "concluded",
    label: "Concluded",
    description: "The show happened. What is left is the settlement.",
  },
  {
    value: "cancelled",
    label: "Cancelled",
    description: "Called off. The event and its history stay, nothing is deleted.",
  },
];

export interface EditableEventInformation {
  id: string;
  title: string;
  status: string;
  eventDate: string | null;
  venueName: string | null;
  capacity: number | null;
  /** The room (`stages.id`) this show is placed in, or null for none set. */
  stageId: string | null;
  /** The venue PROFILE this event stands at, when one is linked. */
  venueProfileId?: string | null;
  version: number;
}

/** Every field is held as text: an editor must be able to hold "" (meaning
 * "cleared") and a half-typed number without the draft losing them. */
export type EventInlineFieldValues = Record<EventInlineFieldName, string>;

/** A save that lost the optimistic lock (decisions #8). Kept as state rather
 * than a toast: it has to name the field and quote what was thrown away, and it
 * has to stay on screen until the operator has read it. */
export interface EventInlineConflict {
  label: string;
  attempted: string;
}

/** A save the server refused outright — not a lost lock, but a rule: the free
 * plan's event limit is the one that bites here. Kept on the card in the API's
 * own words, exactly as the status control it replaces did. */
export interface EventInlineRefusal {
  label: string;
  message: string;
}

/** One room as the picker offers it. The empty id is "No room set" — a real
 * choice, not an absent one. */
export interface EventInlineRoom {
  id: string;
  name: string;
  /** How many the room holds, when the venue has recorded it. Null is silence,
   * not zero, and silence must never overwrite a capacity somebody set. */
  capacity: number | null;
}

/** Where the capacity on the card came from, when saving a room set it. The
 * card says this on the capacity row: a number that moves on its own is
 * startling, and the operator typed (or inherited) the one it replaced. */
export interface EventInlineCapacitySource {
  roomName: string;
  capacity: number;
}

export interface EventInlineFields {
  /** What the rows render: a value already written but not yet echoed by the
   * event query still shows as written, so a saved row never flickers back. */
  values: EventInlineFieldValues;
  editingField: EventInlineFieldName | null;
  /** The text the open editor holds. "" when no editor is open. */
  draft: string;
  /** Why the open draft cannot be saved yet, or null. */
  draftError: string | null;
  /** The open editor is holding something the server has not been told. */
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  conflict: EventInlineConflict | null;
  /** A save the server REFUSED, in its own words — a free-plan event limit,
   * mostly. On the card rather than only in a toast, because it is the answer to
   * the question the operator just asked and it is worth reading twice. */
  refusal: EventInlineRefusal | null;
  /** Set when saving a room moved the capacity with it, so the capacity row can
   * say where its number came from. Cleared the moment any editor opens. */
  capacityFromRoom: EventInlineCapacitySource | null;
  begin: (field: EventInlineFieldName) => void;
  changeDraft: (text: string) => void;
  /** Enter, focus leaving a typed field, or Save on a picker: write it if it
   * moved, then close. */
  commitDraft: () => void;
  /** Escape, Cancel, or a click outside a picker: throw the draft away and
   * close, changing nothing. */
  cancel: () => void;
  /** Save on the room picker: the room, and the capacity it states, in ONE
   * patch. */
  saveRoom: (room: EventInlineRoom) => void;
  /** A venue PROFILE picked; the server fills this event's blanks from it. */
  chooseVenueProfile: (choice: VenueChoice) => void;
  /** Typing over a linked venue: the name and the profile must never disagree
   * about which room this is, so the profile goes when the commit goes. */
  unlinkVenueProfileOnCommit: () => void;
  dismissConflict: () => void;
  dismissRefusal: () => void;
}

/** `yyyy-mm-dd` for the date input. The API serves a `date` column, which is
 * already in that shape; the slice only guards against a fuller timestamp. */
function toDateInputValue(eventDate: string | null): string {
  return eventDate ? eventDate.slice(0, 10) : "";
}

function serverValues(event: EditableEventInformation): EventInlineFieldValues {
  return {
    title: event.title,
    eventDate: toDateInputValue(event.eventDate),
    venueName: event.venueName ?? "",
    capacity: event.capacity != null ? String(event.capacity) : "",
    stageId: event.stageId ?? "",
    status: event.status,
  };
}

/** "" clears the capacity; anything that isn't a whole, non-negative number is
 * rejected here rather than by the API's Zod schema. */
function parseCapacity(raw: string): { valid: boolean; value: number | null } {
  const trimmed = raw.trim();
  if (trimmed === "") return { valid: true, value: null };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return { valid: false, value: null };
  return { valid: true, value: parsed };
}

/** Why this text cannot be saved into this field, or null when it can. */
function validate(field: EventInlineFieldName, text: string): string | null {
  if (field === "title" && text.trim() === "") return "An event needs a name.";
  if (field === "capacity" && !parseCapacity(text).valid) {
    return "Capacity must be a whole number, or empty for none.";
  }
  // Belt and braces on the one field whose value is an enum: the picker offers
  // nothing else, and this is what lets `patchForField` narrow it without a cast.
  if (field === "status" && !EVENT_STATUS_OPTIONS.some((option) => option.value === text)) {
    return "Pick one of the statuses.";
  }
  return null;
}

/**
 * One field's text turned into the narrowest patch that can express it.
 *
 * Narrow on purpose: a body carrying only the field that moved cannot re-write a
 * field somebody else edited between this card loading and this save, so the
 * optimistic lock is left to catch the one collision that is real.
 */
function patchForField(field: EventInlineFieldName, text: string): EventPatchBody {
  switch (field) {
    case "title":
      return { title: text.trim() };
    case "eventDate":
      return { eventDate: text.trim() === "" ? null : text.trim() };
    case "venueName":
      return { venueName: text.trim() === "" ? null : text.trim() };
    case "capacity":
      return { capacity: parseCapacity(text).value };
    case "stageId":
      // "" means "no room set" — sent as null, so clearing a room really clears
      // it rather than leaving the show wherever it was.
      return { stageId: text === "" ? null : text };
    case "status": {
      // `validate` has already refused anything that is not one of the options,
      // so the lookup is what NARROWS the string to the enum the client expects.
      const option = EVENT_STATUS_OPTIONS.find((entry) => entry.value === text);
      return option ? { status: option.value } : {};
    }
  }
}

/** The toast a saved field earns. Named, because on an inline card the only
 * other thing that changed is one line of text the eye may not have been on. */
const SAVED_MESSAGE: Record<EventInlineFieldName, string> = {
  title: "Event name saved",
  eventDate: "Date saved",
  venueName: "Venue saved",
  stageId: "Room saved",
  capacity: "Capacity saved",
  status: "Status saved",
};

/**
 * Inline editing for the Event Information card — the state machine and the
 * writes behind it. Replaces `useEventInformationEdit` (a modal draft of all
 * five fields with one Save button).
 *
 * **WHEN AN EDIT COMMITS.** One field at a time, and the act that finishes the
 * field is the act that saves it:
 *
 * - *Typed* fields (name, venue, capacity) commit on **Enter** or when focus
 *   leaves the editor, and only if the value actually moved. **Escape** throws
 *   the draft away.
 * - *Picked* fields (the day, the room) open a popover and commit on an explicit
 *   **Save**; **Cancel**, Escape and a click outside all leave the value as it
 *   was. Blur cannot decide for them: clicking a day inside a calendar is, in
 *   DOM terms, focus LEAVING the field, so blur-to-commit would either save
 *   before the operator had finished choosing or discard what they just picked.
 *   Two buttons say which they meant.
 * - The venue *profile* is still written the moment it is chosen: that picker
 *   closes itself on the choice and the server, not this card, decides what
 *   moves.
 *
 * Deliberately NOT a debounced autosave like `useBudgetEditor`. That card is one
 * form of many numbers whose intermediate states mean nothing; this one is five
 * discrete facts about a show, each of which is optimistically locked, bumps
 * `events.version` and writes a line into the event's history that every
 * participant can read. A timer firing mid-word would spend all three on a title
 * nobody meant to save yet. It is also why the budget's `holdDraft` guard has no
 * counterpart here: only one editor is ever open, it is seeded once when it
 * opens and never re-seeded from a refetch, so a background refetch has nothing
 * to clobber.
 *
 * **CONFLICTS.** Every write carries `expectedVersion` (decisions #8). Inline
 * editing makes a 409 likelier, not rarer — several fields, several saves, a
 * co-host on the same event — so the version is tracked from each PATCH
 * *response* rather than the last completed refetch (consecutive fields never
 * re-use a version), writes are queued one at a time, and a genuine 409 stops
 * the queue, refetches, and raises a notice that names the field and quotes the
 * value that was NOT saved. Nothing is ever re-sent without a fresh version.
 */
export function useEventInlineFields(event: EditableEventInformation): EventInlineFields {
  const toast = useToast();
  const queryClient = useQueryClient();
  const patchEvent = usePatchApiV1EventsId();

  const [editingField, setEditingField] = useState<EventInlineFieldName | null>(null);
  const [draft, setDraft] = useState("");
  const [conflict, setConflict] = useState<EventInlineConflict | null>(null);
  const [capacityFromRoom, setCapacityFromRoom] = useState<EventInlineCapacitySource | null>(null);
  const [refusal, setRefusal] = useState<EventInlineRefusal | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  /** Values we have written whose refetch has not landed yet, so a row that was
   * just saved keeps showing what was saved instead of blinking back. */
  const [written, setWritten] = useState<Partial<EventInlineFieldValues>>({});
  /** The version our last settled write produced; `written` may go once the
   * event query has caught up to it. */
  const [settledVersion, setSettledVersion] = useState<number | null>(null);
  /** The venue profile must be dropped by the same patch that saves the name. */
  const [unlinkVenueProfile, setUnlinkVenueProfile] = useState(false);

  /** The version the NEXT write must claim. Seeded from the loaded event and
   * advanced by every PATCH response, so consecutive writes never re-use one. */
  const versionRef = useRef(event.version);
  /** One write at a time, in the order the operator finished the fields. */
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  /** Bumped by a 409, so work queued against the losing version is dropped
   * rather than replayed on top of whoever won. */
  const epochRef = useRef(0);

  // An outside write (another tab, another user) that our refetch picked up.
  if (event.version > versionRef.current) versionRef.current = event.version;

  useEffect(() => {
    if (settledVersion !== null && event.version >= settledVersion) {
      setWritten({});
      setSettledVersion(null);
    }
  }, [event.version, settledVersion]);

  const invalidateEvent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(event.id) });
  }, [queryClient, event.id]);

  /**
   * Put one write on the queue. `label`/`attempted` are what a lost lock has to
   * be able to say, so they travel with the write rather than being reconstructed
   * from state that has moved on by the time the 409 comes back.
   */
  const enqueue = useCallback(
    (body: EventPatchBody, label: string, attempted: string, savedMessage: string) => {
      const epoch = epochRef.current;
      setPendingCount((count) => count + 1);
      queueRef.current = queueRef.current
        .then(async () => {
          if (epoch !== epochRef.current) return; // a 409 overtook this write
          const updated = await patchEvent.mutateAsync({
            id: event.id,
            data: { ...body, expectedVersion: versionRef.current },
          });
          versionRef.current = updated.version;
          setSettledVersion(updated.version);
          invalidateEvent();
          toast.success(savedMessage);
        })
        .catch((error) => {
          if (epoch !== epochRef.current) return;
          epochRef.current += 1;
          setWritten({});
          setSettledVersion(null);
          // Nothing was written, so nothing on the card came from a room.
          setCapacityFromRoom(null);
          invalidateEvent();
          if (error instanceof ApiError && error.status === 409) {
            setConflict({ label, attempted });
            return;
          }
          const message = errorMessage(error, `Couldn't save ${label.toLowerCase()}.`);
          setRefusal({ label, message });
          toast.error(message);
        })
        .finally(() => setPendingCount((count) => count - 1));
    },
    [event.id, patchEvent, invalidateEvent, toast],
  );

  // Memoised because it is a hook dependency of every commit path below: rebuilt
  // fresh each render it would make each of those callbacks new each render too.
  const values = useMemo<EventInlineFieldValues>(
    () => ({ ...serverValues(event), ...written }),
    [event, written],
  );

  const close = useCallback(() => {
    setEditingField(null);
    setDraft("");
    setUnlinkVenueProfile(false);
  }, []);

  const begin = useCallback(
    (field: EventInlineFieldName) => {
      setConflict(null);
      setRefusal(null);
      // Opening any editor supersedes the last "this came from a room" note —
      // including opening capacity itself to type over the number.
      setCapacityFromRoom(null);
      setUnlinkVenueProfile(false);
      setEditingField(field);
      setDraft(values[field]);
    },
    // `values` is rebuilt every render; reading it through the closure is
    // correct here — the editor must open on what the row currently SHOWS.
    [values],
  );

  const write = useCallback(
    (field: EventInlineFieldName, text: string, extra?: EventPatchBody) => {
      setWritten((current) => ({ ...current, [field]: text }));
      enqueue(
        { ...patchForField(field, text), ...extra },
        EVENT_INLINE_FIELD_LABEL[field],
        text.trim() === "" ? "(cleared)" : text.trim(),
        SAVED_MESSAGE[field],
      );
    },
    [enqueue],
  );

  const commitDraft = useCallback(() => {
    const field = editingField;
    if (field === null) return;
    if (validate(field, draft) !== null) return; // the editor stays open, saying why
    const moved = draft.trim() !== values[field].trim();
    if (moved || unlinkVenueProfile) {
      write(field, draft, unlinkVenueProfile ? { venueProfileId: null } : undefined);
    }
    close();
  }, [editingField, draft, values, unlinkVenueProfile, write, close]);

  /**
   * Save the room the picker is holding — and, with it, what that room holds.
   *
   * A room is a more specific statement than a building, so its capacity wins
   * over the one the venue profile filled in. Three rules make that safe:
   *
   * - **On Save only.** Highlighting a room in the picker changes nothing; this
   *   runs when the operator says Save, which is why Cancel leaves the capacity
   *   exactly as it was.
   * - **Silence is not zero.** A room that records no capacity says nothing
   *   about how many this show holds, and must not blank a real number.
   * - **One PATCH, never two.** Room and capacity are two fields of the same
   *   event under one `version`: sent as two writes, the second would claim the
   *   version the first is still spending and 409 against its own predecessor —
   *   the bug that killed `useEventVenueLink`.
   *
   * Clearing the room back to "No room set" deliberately leaves the capacity
   * alone. The number is the operator's field, and silently reverting it to the
   * venue's would be a second unexplained change on top of the one they asked
   * for.
   */
  const saveRoom = useCallback(
    (room: EventInlineRoom) => {
      const capacityMoves = room.capacity !== null && String(room.capacity) !== values.capacity;
      if (room.id === values.stageId && !capacityMoves) {
        close();
        return;
      }
      setWritten((current) => ({
        ...current,
        stageId: room.id,
        ...(capacityMoves ? { capacity: String(room.capacity) } : {}),
      }));
      enqueue(
        {
          stageId: room.id === "" ? null : room.id,
          ...(capacityMoves ? { capacity: room.capacity } : {}),
        },
        EVENT_INLINE_FIELD_LABEL.stageId,
        // The room's NAME, never its id: a conflict notice quoting a uuid tells
        // the operator nothing about what they were trying to save.
        room.id === "" ? "(cleared)" : room.name,
        capacityMoves
          ? `Room saved — capacity set to ${room.capacity?.toLocaleString("en-US")}`
          : SAVED_MESSAGE.stageId,
      );
      setCapacityFromRoom(
        capacityMoves && room.capacity !== null
          ? { roomName: room.name, capacity: room.capacity }
          : null,
      );
      close();
    },
    [values.stageId, values.capacity, enqueue, close],
  );

  const chooseVenueProfile = useCallback(
    (choice: VenueChoice) => {
      if (choice.profileId === (event.venueProfileId ?? null)) {
        close();
        return;
      }
      // Only the link is sent, and nothing is shown optimistically. The API
      // fills this event's BLANK fields from the venue — name, capacity, house
      // curfew, amenities, city — and leaves everything already typed exactly as
      // the operator left it (`apps/api/src/routes/events.ts`). Which of them
      // move is therefore the SERVER's answer, and pre-drawing the venue's name
      // over a name the operator had already typed would state the opposite of
      // what the rule does.
      enqueue(
        { venueProfileId: choice.profileId },
        "Venue",
        choice.name,
        `Linked to ${choice.name} — it filled in what this event had left blank`,
      );
      close();
    },
    [event.venueProfileId, enqueue, close],
  );

  const unlinkVenueProfileOnCommit = useCallback(() => setUnlinkVenueProfile(true), []);

  const draftError = editingField === null ? null : validate(editingField, draft);
  const hasUnsavedChanges =
    editingField !== null && (draft.trim() !== values[editingField].trim() || unlinkVenueProfile);

  return {
    values,
    editingField,
    draft,
    draftError,
    hasUnsavedChanges,
    isSaving: pendingCount > 0,
    conflict,
    refusal,
    capacityFromRoom,
    begin,
    changeDraft: setDraft,
    commitDraft,
    cancel: close,
    saveRoom,
    chooseVenueProfile,
    unlinkVenueProfileOnCommit,
    dismissConflict: () => setConflict(null),
    dismissRefusal: () => setRefusal(null),
  };
}
