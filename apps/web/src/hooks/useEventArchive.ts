import {
  getGetApiV1EventsQueryKey,
  postApiV1EventsIdArchive,
  postApiV1EventsIdUnarchive,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { EventMenuItem } from "../components/EventRowMenu";
import { errorMessage } from "../lib/errors";

/**
 * Filing an event away, and taking it back out.
 *
 * Archiving is NOT a status (see `apps/api/src/routes/events.ts`): the event's
 * `status` says where the booking got to, archiving says whether the acting
 * profile still wants to look at it. It is written on the caller's own
 * `event_participants` row, so it hides the show from THEIR lists and from
 * nobody else's — the performer on the bill keeps the booking on their calendar
 * when the venue files it.
 *
 * Two things this hook owes the reader, because a hide is easy to mistake for a
 * delete:
 *
 *  - **Undo, in the toast.** The reversal is one click away in the same place the
 *    confirmation appears, so nobody has to go looking for what they just did.
 *  - **Where it went.** The message names the Archived filter, so even a reader
 *    who lets the toast pass knows there is a shelf and where it is.
 *
 * There is deliberately no "are you sure?" dialog. A confirm belongs to an action
 * that cannot be taken back from the screen that asked (`ConfirmDialog`'s own
 * rule); this one can be taken back from the toast it just raised.
 */
export interface EventArchiveActions {
  /** File it away. `title` only names it in the toast. */
  archive: (eventId: string, title: string) => void;
  /** Put it back. */
  unarchive: (eventId: string, title: string) => void;
  /** The event a call is in flight for, so a row can disable its own menu entry. */
  pendingEventId: string | null;
  /**
   * What the overflow menu offers for one event. Here rather than in each screen
   * so the wording, the disabled state and the direction of the toggle are
   * decided ONCE — the events list, the board and the calendar all draw the same
   * menu, and a row that says "Archive" while the API would unarchive it is the
   * bug this closes by construction.
   */
  menuItems: (event: { id: string; title: string; archived?: boolean }) => EventMenuItem[];
}

export function useEventArchive(): EventArchiveActions {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);

  /**
   * Every events list, at every filter, on every screen.
   *
   * The key prefix is the path (`/api/v1/events`) and the params follow it, so one
   * prefix invalidation reaches the Events list, its Archived view AND the
   * Calendar's drained `useAllEvents` — three cache entries holding the same fact.
   * Archiving changes which list a show belongs to, so leaving any of them stale
   * would put the same event in two places at once.
   */
  const refreshEventLists = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetApiV1EventsQueryKey() });
  }, [queryClient]);

  const unarchive = useCallback(
    async (eventId: string, title: string) => {
      setPendingEventId(eventId);
      try {
        await postApiV1EventsIdUnarchive(eventId);
        refreshEventLists();
        toast.success(`"${title}" is back in your events.`);
      } catch (error) {
        toast.error(errorMessage(error, `Couldn't bring "${title}" back.`));
      } finally {
        setPendingEventId(null);
      }
    },
    [refreshEventLists, toast],
  );

  const archive = useCallback(
    async (eventId: string, title: string) => {
      setPendingEventId(eventId);
      try {
        await postApiV1EventsIdArchive(eventId);
        refreshEventLists();
        toast(`Archived "${title}" — it's under the Archived filter.`, {
          action: { label: "Undo", onClick: () => void unarchive(eventId, title) },
        });
      } catch (error) {
        toast.error(errorMessage(error, `Couldn't file "${title}" away.`));
      } finally {
        setPendingEventId(null);
      }
    },
    [refreshEventLists, toast, unarchive],
  );

  const menuItems = useCallback(
    (event: { id: string; title: string; archived?: boolean }): EventMenuItem[] => {
      const inFlight = pendingEventId === event.id;
      if (event.archived) {
        return [
          {
            key: "unarchive",
            label: "Unarchive",
            onSelect: inFlight ? undefined : () => void unarchive(event.id, event.title),
            refusal: inFlight ? "Working on it…" : undefined,
          },
        ];
      }
      return [
        {
          key: "archive",
          label: "Archive",
          onSelect: inFlight ? undefined : () => void archive(event.id, event.title),
          refusal: inFlight ? "Working on it…" : undefined,
          // Said out loud, because "archive" reads as "delete" to plenty of
          // people, and this one deletes nothing and is nobody else's business.
          hint: inFlight ? undefined : "Hides it from your lists. Nobody else is affected.",
        },
      ];
    },
    [archive, unarchive, pendingEventId],
  );

  return {
    archive: (eventId, title) => void archive(eventId, title),
    unarchive: (eventId, title) => void unarchive(eventId, title),
    pendingEventId,
    menuItems,
  };
}
