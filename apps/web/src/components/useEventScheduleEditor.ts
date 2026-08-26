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

  return {
    items: schedule.data ?? [],
    isPending: schedule.isPending,
    isError: schedule.isError,
    error: schedule.error,
    add,
    update,
    remove,
    isSaving: createItem.isPending || updateItem.isPending || deleteItem.isPending,
  };
}
