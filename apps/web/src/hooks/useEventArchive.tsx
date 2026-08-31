import {
  deleteApiV1EventsId,
  getGetApiV1EventsQueryKey,
  postApiV1EventsIdArchive,
  postApiV1EventsIdUnarchive,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ConfirmDialogProps } from "../components/ConfirmDialog";
import { useConfirmDialog } from "../components/ConfirmDialog";
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
 * There is deliberately no "are you sure?" dialog on the ARCHIVE. A confirm
 * belongs to an action that cannot be taken back from the screen that asked
 * (`ConfirmDialog`'s own rule); archiving can be taken back from the toast it just
 * raised.
 *
 * **Deleting is the other kind, and it is offered only from the archive** — the
 * product owner's own sequence: *"move events into archive and then delete them
 * from there if they wish."* So the irreversible step is never the first one, it
 * asks in a dialog that names the show, and the server has the last word on
 * whether it is allowed at all (`apps/api/src/lib/event-delete.ts`: only while the
 * event is nobody's record but yours). The entry is offered rather than hidden
 * because the answer depends on facts a list row does not carry — a settlement, a
 * signed agreement, somebody else on the bill — and the refusal names which one,
 * which is more use than a menu that silently lacks the option.
 */
export interface EventArchiveActions {
  /** File it away. `title` only names it in the toast. */
  archive: (eventId: string, title: string) => void;
  /** Put it back. */
  unarchive: (eventId: string, title: string) => void;
  /**
   * The confirmation this hook raises before it deletes. The screen renders
   * `<ConfirmDialog {...confirmDialogProps} />` once, wherever the menu lives.
   */
  confirmDialogProps: ConfirmDialogProps;
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
  const confirmation = useConfirmDialog();
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

  /**
   * Delete, for real. No optimistic-lock version travels with it: the caller has
   * just been shown the show's name in a dialog and said yes to that show, and a
   * version mismatch would refuse them for an edit somebody made to a field they
   * were not asked about. Every rule that matters is a fact about the event's
   * relationships, and the server checks all of them.
   */
  const remove = useCallback(
    async (eventId: string, title: string) => {
      setPendingEventId(eventId);
      try {
        await deleteApiV1EventsId(eventId, {});
        refreshEventLists();
        toast.success(`"${title}" is gone.`);
      } catch (error) {
        // The server's sentence, verbatim — it names the settlement, the signed
        // agreement or the party that stands in the way, which is the only thing
        // that tells the operator what to do next.
        toast.error(errorMessage(error, `Couldn't delete "${title}".`));
      } finally {
        setPendingEventId(null);
      }
    },
    [refreshEventLists, toast],
  );

  const askToDelete = useCallback(
    (eventId: string, title: string) => {
      confirmation.ask({
        title: "Delete this event?",
        body: (
          <>
            <p style={{ margin: "0 0 10px" }}>
              <strong>{title}</strong> and everything on it — its deals, its budget, its riders, its
              schedule and its messages — are removed for good. This cannot be undone.
            </p>
            <p style={{ margin: 0 }}>
              If anyone else is on the bill, or the show has a signed agreement, a settlement or an
              invoice, it stays where it is: leave it archived instead.
            </p>
          </>
        ),
        confirmLabel: "Delete permanently",
        destructive: true,
        onConfirm: () => void remove(eventId, title),
      });
    },
    [confirmation, remove],
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
          {
            key: "delete",
            label: "Delete permanently…",
            onSelect: inFlight ? undefined : () => askToDelete(event.id, event.title),
            refusal: inFlight ? "Working on it…" : undefined,
            hint: inFlight
              ? undefined
              : "Removes the show and everything on it, for everyone. Only possible while nobody else is on it.",
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
    [archive, unarchive, askToDelete, pendingEventId],
  );

  return {
    archive: (eventId, title) => void archive(eventId, title),
    unarchive: (eventId, title) => void unarchive(eventId, title),
    confirmDialogProps: confirmation.dialogProps,
    pendingEventId,
    menuItems,
  };
}
