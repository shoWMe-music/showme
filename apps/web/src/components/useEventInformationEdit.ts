import {
  ApiError,
  getGetApiV1EventsIdQueryKey,
  type patchApiV1EventsId,
  usePatchApiV1EventsId,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { errorMessage } from "../lib/errors";

/** The body `PATCH /events/:id` accepts, taken from the generated client so a
 * regenerated contract fails the build instead of the request. */
type EventPatchBody = Parameters<typeof patchApiV1EventsId>[1];

/** The event fields the Event Information card lets an operator change. Status,
 * the operator (host profile), performers (participants) and the room/stage are
 * deliberately absent — each is owned by another surface. */
export interface EditableEventInformation {
  id: string;
  title: string;
  eventDate: string | null;
  venueName: string | null;
  capacity: number | null;
  version: number;
}

/** Every field is text: the inputs must be able to hold "" (meaning "cleared")
 * and a half-typed number without the draft losing them. */
export interface EventInformationFields {
  title: string;
  /** `yyyy-mm-dd`, or "" for no date. */
  eventDate: string;
  venueName: string;
  capacity: string;
}

/**
 * What the publish panel needs to know, riding along with the draft.
 *
 * It is here rather than in the modal's props because the modal is handed the
 * draft and nothing else — and publishing has to know WHICH event it is, and
 * whether the form above it is holding edits that the public page would not
 * show. Everything else about publishing (the flag, the status, the version) the
 * panel reads from the live event itself.
 */
export interface EventPublishingContext {
  eventId: string;
  hasUnsavedChanges: boolean;
}

/** The draft as the modal receives it: the editable fields plus that context. */
export interface EventInformationDraft extends EventInformationFields {
  publishing: EventPublishingContext;
}

export interface EventInformationEdit {
  draft: EventInformationDraft | null;
  open: () => void;
  close: () => void;
  change: (fields: Partial<EventInformationFields>) => void;
  save: () => void;
  /** Discard the stale draft and pull the event again after a conflict. */
  reload: () => void;
  isSaving: boolean;
  canSave: boolean;
  /** Someone else saved first — the draft is against a version that no longer exists. */
  hasConflict: boolean;
}

/** `yyyy-mm-dd` for the native date input. The API serves a `date` column, which
 * is already in that shape; the slice only guards against a fuller timestamp. */
function toDateInputValue(eventDate: string | null): string {
  return eventDate ? eventDate.slice(0, 10) : "";
}

function toDraft(event: EditableEventInformation): EventInformationFields {
  return {
    title: event.title,
    eventDate: toDateInputValue(event.eventDate),
    venueName: event.venueName ?? "",
    capacity: event.capacity != null ? String(event.capacity) : "",
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

/** Only the fields the user actually changed. A narrow patch cannot re-write a
 * field someone else edited between this card loading and the save. */
function changedFields(
  event: EditableEventInformation,
  draft: EventInformationFields,
): EventPatchBody {
  const body: EventPatchBody = {};

  const title = draft.title.trim();
  if (title !== event.title) body.title = title;

  const eventDate = draft.eventDate.trim() === "" ? null : draft.eventDate.trim();
  if (eventDate !== (event.eventDate === null ? null : toDateInputValue(event.eventDate))) {
    body.eventDate = eventDate;
  }

  const venueName = draft.venueName.trim() === "" ? null : draft.venueName.trim();
  if (venueName !== event.venueName) body.venueName = venueName;

  const { value: capacity } = parseCapacity(draft.capacity);
  if (capacity !== event.capacity) body.capacity = capacity;

  return body;
}

/**
 * Draft state + persistence for the Event Information card's Edit action.
 *
 * Saves through the same optimistic lock the rest of the event screen uses
 * (`expectedVersion`, decisions #8): a 409 means another writer got there first,
 * so the draft is held, the conflict surfaced, and saving blocked until the user
 * reloads — re-sending it without a version would silently overwrite them.
 */
export function useEventInformationEdit(event: EditableEventInformation): EventInformationEdit {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<EventInformationFields | null>(null);
  const [hasConflict, setHasConflict] = useState(false);

  const invalidateEvent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(event.id) });
  }, [queryClient, event.id]);

  const patchEvent = usePatchApiV1EventsId({
    mutation: {
      onSuccess: () => {
        toast.success("Event information updated");
        invalidateEvent();
        setFields(null);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) {
          setHasConflict(true);
          return;
        }
        toast.error(errorMessage(error, "Couldn't save the event information."));
      },
    },
  });

  const open = useCallback(() => {
    setHasConflict(false);
    setFields(toDraft(event));
  }, [event]);

  const close = useCallback(() => {
    setFields(null);
    setHasConflict(false);
  }, []);

  const change = useCallback((changes: Partial<EventInformationFields>) => {
    setFields((current) => (current ? { ...current, ...changes } : current));
  }, []);

  const reload = useCallback(() => {
    invalidateEvent();
    setFields(null);
    setHasConflict(false);
  }, [invalidateEvent]);

  const save = useCallback(() => {
    if (!fields || hasConflict) return;
    const body = changedFields(event, fields);
    // Nothing moved — closing is the honest outcome, not a no-op write that bumps
    // the version for everyone else.
    if (Object.keys(body).length === 0) {
      close();
      return;
    }
    patchEvent.mutate({ id: event.id, data: { ...body, expectedVersion: event.version } });
  }, [fields, hasConflict, event, patchEvent, close]);

  const canSave =
    fields !== null &&
    !hasConflict &&
    fields.title.trim().length > 0 &&
    parseCapacity(fields.capacity).valid;

  // The publish panel is told, on every render, whether the form is holding
  // edits — the public page renders the SAVED row, so publishing mid-edit would
  // announce a title the operator can see they have changed.
  const draft = useMemo<EventInformationDraft | null>(
    () =>
      fields
        ? {
            ...fields,
            publishing: {
              eventId: event.id,
              hasUnsavedChanges: Object.keys(changedFields(event, fields)).length > 0,
            },
          }
        : null,
    [fields, event],
  );

  return {
    draft,
    open,
    close,
    change,
    save,
    reload,
    isSaving: patchEvent.isPending,
    canSave,
    hasConflict,
  };
}
