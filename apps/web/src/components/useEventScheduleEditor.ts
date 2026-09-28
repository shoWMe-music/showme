import {
  type getApiV1EventsIdSchedule,
  getGetApiV1EventsIdScheduleQueryKey,
  useDeleteApiV1EventsIdScheduleSid,
  useGetApiV1EventsIdSchedule,
  usePatchApiV1EventsIdScheduleSid,
  usePostApiV1EventsIdSchedule,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "../lib/errors";

/** One row of the event's run-of-show, as the API serves it. */
export type ScheduleItem = Awaited<ReturnType<typeof getApiV1EventsIdSchedule>>[number];

export type ScheduleCategory = "production" | "crew";

export interface NewScheduleItem {
  /** Offset-free local wall clock, `yyyy-mm-ddThh:mm` (decisions #10). */
  localDateTime: string | null;
  label: string;
  category: ScheduleCategory;
}

export interface ScheduleItemChange {
  localDateTime?: string | null;
  label?: string;
}

export interface EventScheduleEditor {
  items: ScheduleItem[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  add: (item: NewScheduleItem) => void;
  /**
   * Insert several rows at once — a starting point or a saved template
   * (ClickUp `123qy9rpvfq`).
   *
   * Sequential, not `Promise.all`: `POST /events/:id/schedule` is one insert per row
   * and ten parallel writes against the same event is ten chances for the list query to
   * refetch mid-flight and draw a half-applied run of show. Ten items in a row is fast
   * and the card shows its saving state throughout.
   *
   * It APPENDS. Replacing what is on screen is a different act with a different
   * consequence (somebody's typed times gone), and nothing in the ticket asks for it —
   * a template loaded onto a filled schedule is the operator's call to tidy up.
   */
  addMany: (items: readonly NewScheduleItem[]) => Promise<void>;
  /** Delete the named rows, in order and awaited — see the implementation. */
  removeMany: (scheduleItemIds: readonly string[]) => Promise<void>;
  update: (scheduleItemId: string, change: ScheduleItemChange) => void;
  remove: (scheduleItemId: string) => void;
  isSaving: boolean;
}

/**
 * The run-of-show behind the Event Schedule card.
 *
 * `schedule_items` is a real table with a full CRUD route
 * (`apps/api/src/routes/schedule.ts`, gated on `schedule.view` / `schedule.edit`),
 * so the card writes there — never into `events.extras`, which happens to be
 * writable but is for the read-with-parent leaves only.
 */
export function useEventScheduleEditor(eventId: string): EventScheduleEditor {
  const toast = useToast();
  const queryClient = useQueryClient();
  const schedule = useGetApiV1EventsIdSchedule(eventId);

  const invalidateSchedule = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdScheduleQueryKey(eventId) });
  }, [queryClient, eventId]);

  const onError = useCallback(
    (error: unknown) => toast.error(errorMessage(error, "Couldn't save the schedule.")),
    [toast],
  );

  const mutationOptions = { mutation: { onSuccess: invalidateSchedule, onError } };
  const createItem = usePostApiV1EventsIdSchedule(mutationOptions);
  const updateItem = usePatchApiV1EventsIdScheduleSid(mutationOptions);
  const deleteItem = useDeleteApiV1EventsIdScheduleSid(mutationOptions);

  const add = useCallback(
    (item: NewScheduleItem) => {
      createItem.mutate({
        id: eventId,
        data: {
          label: item.label,
          category: item.category,
          // Omitted rather than nulled: the create body takes no null (an item
          // with no time is "unscheduled", which the column already expresses).
          ...(item.localDateTime ? { localDateTime: item.localDateTime } : {}),
        },
      });
    },
    [createItem, eventId],
  );

  const addMany = useCallback(
    async (items: readonly NewScheduleItem[]) => {
      for (const item of items) {
        await createItem.mutateAsync({
          id: eventId,
          data: {
            label: item.label,
            category: item.category,
            ...(item.localDateTime ? { localDateTime: item.localDateTime } : {}),
          },
        });
      }
    },
    [createItem, eventId],
  );

  const update = useCallback(
    (scheduleItemId: string, change: ScheduleItemChange) => {
      updateItem.mutate({ id: eventId, sid: scheduleItemId, data: change });
    },
    [updateItem, eventId],
  );

  const remove = useCallback(
    (scheduleItemId: string) => {
      deleteItem.mutate({ id: eventId, sid: scheduleItemId });
    },
    [deleteItem, eventId],
  );

  /**
   * Clear every row, awaited — so a caller can replace a schedule rather than only
   * pile onto it (QA sweep run 5, QA5-12).
   *
   * `removeMany` rather than a route of its own: there is no bulk delete on the API and
   * inventing one for this would be a migration-scale answer to a button. It mirrors
   * `addMany` exactly — a loop of `mutateAsync`, in order, so the caller can await the
   * whole thing before adding — and the same argument applies: these are tens of rows,
   * not thousands.
   */
  const removeMany = useCallback(
    async (scheduleItemIds: readonly string[]) => {
      for (const scheduleItemId of scheduleItemIds) {
        await deleteItem.mutateAsync({ id: eventId, sid: scheduleItemId });
      }
    },
    [deleteItem, eventId],
  );

  return {
    items: schedule.data ?? [],
    isPending: schedule.isPending,
    isError: schedule.isError,
    error: schedule.error,
    add,
    addMany,
    removeMany,
    update,
    remove,
    isSaving: createItem.isPending || updateItem.isPending || deleteItem.isPending,
  };
}
