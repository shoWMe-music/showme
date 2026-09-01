import { getGetApiV1CalendarQueryKey, usePostApiV1Calendar } from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";

/**
 * Creating an **appointment** or a **note** from the calendar's day popover.
 *
 * These are `calendar_items` — the same table `GET /calendar` already feeds the
 * grid from — so the write is `POST /calendar` and nothing new is needed on the
 * API. The row is scoped to the **acting profile** rather than the user, so it
 * belongs to the account the calendar is being read as: everyone on that
 * profile's roster sees it, which is what "put it in the calendar" means to a
 * venue with three people running it. (`POST /calendar` sets `ownerUserId` only
 * when no `ownerProfileId` is given, so a user with no profile still gets a
 * personal item.)
 *
 * TASK is deliberately NOT handled here even though `calendar_items` has a
 * `task` kind: real tasks live in the `tasks` table with assignees, due dates
 * and a board. Two different "tasks" reachable from one menu would be a trap.
 *
 * 2026-09-01: the day popover DOES offer "Task" now — Ran asked for it — and it
 * opens `TaskFormModal`, the Tasks screen's own dialog, writing a real `tasks`
 * row with the clicked day pre-filled as its due date. The rule above survives
 * intact, which is the point: the affordance was added WITHOUT adding a second
 * kind of task. Nothing writes `calendar_items.type = 'task'`; that value now
 * exists only for rows imported before this, and the grid's task entries are
 * projected from `tasks` at read time (`routes/calendar.ts`).
 */

/** What the day popover can create through this modal. The generated request
 * model's `type` union is not re-exported from the api-client barrel, so the two
 * kinds are named here; they are checked against it structurally at the call. */
export type CalendarItemKind = "appointment" | "note";

const KIND_LABEL: Record<CalendarItemKind, string> = {
  appointment: "appointment",
  note: "note",
};

export interface CalendarItemCreateView {
  kind: CalendarItemKind;
  /** `yyyy-mm-dd` the popover was opened on. */
  date: string;
  setDate: (value: string) => void;
  title: string;
  setTitle: (value: string) => void;
  /** Notes have no clock — only an appointment offers times. */
  startTime: string;
  setStartTime: (value: string) => void;
  endTime: string;
  setEndTime: (value: string) => void;
  isSaving: boolean;
  error: string | null;
  canSubmit: boolean;
  submit: () => void;
}

export function useCalendarItemCreate(
  open: boolean,
  kind: CalendarItemKind,
  initialDate: string,
  onCreated: () => void,
): CalendarItemCreateView {
  const toast = useToast();
  const queryClient = useQueryClient();
  const createItem = usePostApiV1Calendar();

  const [date, setDate] = useState(initialDate);
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Each open is a fresh entry on the day that was clicked — a title left over
  // from the last one would silently attach to a different date.
  useEffect(() => {
    if (!open) return;
    setDate(initialDate);
    setTitle("");
    setStartTime("");
    setEndTime("");
    setError(null);
  }, [open, initialDate]);

  const trimmedTitle = title.trim();

  const submit = () => {
    if (!trimmedTitle || !date) return;
    setError(null);
    if (kind === "appointment" && endTime && startTime && endTime < startTime) {
      setError("The end time is before the start time.");
      return;
    }
    const activeProfileId = getActiveProfileId();
    createItem.mutate(
      {
        data: {
          type: kind,
          title: trimmedTitle,
          date,
          // A note is a thing written on a day, not at a time.
          startTime: kind === "appointment" && startTime ? startTime : undefined,
          endTime: kind === "appointment" && endTime ? endTime : undefined,
          ownerProfileId: activeProfileId ?? undefined,
        },
      },
      {
        onSuccess: () => {
          // The grid reads `GET /calendar?from=&to=`; the range varies with the
          // view, so invalidate every variant of that key rather than one.
          void queryClient.invalidateQueries({ queryKey: getGetApiV1CalendarQueryKey() });
          toast.success(`${trimmedTitle} added as ${KIND_LABEL[kind]}.`);
          onCreated();
        },
        onError: (mutationError) => setError(errorMessage(mutationError)),
      },
    );
  };

  return {
    kind,
    date,
    setDate,
    title,
    setTitle,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    isSaving: createItem.isPending,
    error,
    canSubmit: Boolean(trimmedTitle) && Boolean(date) && !createItem.isPending,
    submit,
  };
}
