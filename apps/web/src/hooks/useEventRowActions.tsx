import {
  deleteApiV1EventsId,
  getGetApiV1EventsQueryKey,
  patchApiV1EventsId,
  postApiV1EventsIdArchive,
  postApiV1EventsIdUnarchive,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import type { ConfirmDialogProps } from "../components/ConfirmDialog";
import { useConfirmDialog } from "../components/ConfirmDialog";
import type { EventCancelModalProps } from "../components/EventCancelModal";
import type { EventMenuItem } from "../components/EventRowMenu";
import { usePublishToggle } from "../components/usePublishToggle";
import { errorMessage } from "../lib/errors";
import { type EventRowMenuKey, eventRowMenuKeys } from "./eventRowMenu";

/**
 * What an event's own overflow menu does: file it away, take it back out, call it
 * off, destroy it.
 *
 * Named for the MENU rather than for archiving, because since `decisions.md` #25.3
 * the four are one ladder and the menu is where the rungs are chosen. Archiving
 * used to be the whole file; it is now the least consequential thing here.
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
/**
 * CANCELLING, and why it sits in this hook rather than beside the status field.
 *
 * `decisions.md` #25.3 makes cancel-then-delete one sequence: a cancelled show may
 * be deleted even with another party on the bill and a signed agreement on it,
 * because cancelling is what told them. Holding both in one place is what lets the
 * menu offer the second rung only once the first has happened — and keeps the two
 * sentences ("the bill is told why" / "this cannot be undone") from drifting apart.
 *
 * The reason is REQUIRED by the dialog and optional at the API, which is deliberate
 * and explained in `components/EventCancelModal.tsx`.
 */
/**
 * What the SCREEN needs to say about itself.
 *
 * `onDeleted` exists because a list can refresh in place and a workspace cannot: the
 * event manager is standing ON the row it just destroyed, and every query on that page
 * would 404 in turn while the operator watched. The list passes nothing; the manager
 * passes a navigation away (ClickUp `123qy9rng56`).
 */
export interface EventRowActionOptions {
  onDeleted?: (eventId: string) => void;
}

export interface EventRowActions {
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
  menuItems: (event: {
    id: string;
    title: string;
    status?: string;
    archived?: boolean;
    /** Whether the public page is up — decides which way the publish entry reads. */
    published?: boolean;
    /**
     * The caller's OWN capabilities on this event, off the list row
     * (`ListEventResponse`). Optional so a caller that has not got them yet — a
     * cached row from an older client — falls back to offering nothing it cannot
     * prove, rather than to offering everything.
     */
    capabilities?: readonly string[];
  }) => EventMenuItem[];
  /**
   * The cancel dialog this hook raises. The screen renders
   * `<EventCancelModal {...cancelModalProps} />` once, beside the ConfirmDialog.
   */
  cancelModalProps: EventCancelModalProps;
}

export function useEventRowActions({ onDeleted }: EventRowActionOptions = {}): EventRowActions {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const publishing = usePublishToggle();
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
        // Before anything else re-renders: see `EventRowActionOptions.onDeleted`.
        onDeleted?.(eventId);
      } catch (error) {
        // The server's sentence, verbatim — it names the settlement, the signed
        // agreement or the party that stands in the way, which is the only thing
        // that tells the operator what to do next.
        toast.error(errorMessage(error, `Couldn't delete "${title}".`));
      } finally {
        setPendingEventId(null);
      }
    },
    // `onDeleted` is destructured at the parameter rather than read off an `options`
    // object, so this dependency is the CALLBACK and not a fresh literal every render.
    [refreshEventLists, toast, onDeleted],
  );

  /**
   * CALL THE SHOW OFF — `PATCH { status: "cancelled", cancellationReason }`.
   *
   * One patch, and no `expectedVersion`: the operator is acting on a fact about the
   * night, not on a field somebody else might have edited, and a lost lock here
   * would refuse a cancellation for a title change. The API notifies every other
   * party (decisions #25.3) — this hook does not, and must not, decide who hears.
   */
  const cancelShow = useCallback(
    async (eventId: string, title: string, reason: string) => {
      setPendingEventId(eventId);
      try {
        await patchApiV1EventsId(eventId, { status: "cancelled", cancellationReason: reason });
        refreshEventLists();
        // What the operator most needs to know is that it was not silent.
        toast.success(`"${title}" is cancelled. Everyone on the bill has been told why.`);
      } catch (error) {
        toast.error(errorMessage(error, `Couldn't cancel "${title}".`));
      } finally {
        setPendingEventId(null);
      }
    },
    [refreshEventLists, toast],
  );

  /** The show the cancel dialog is asking about, and the reason typed into it. */
  const [cancelling, setCancelling] = useState<{ id: string; title: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const closeCancel = useCallback(() => {
    setCancelling(null);
    setCancelReason("");
  }, []);

  const askToCancel = useCallback((eventId: string, title: string) => {
    setCancelReason("");
    setCancelling({ id: eventId, title });
  }, []);

  const askToDelete = useCallback(
    (eventId: string, title: string) => {
      confirmation.ask({
        title: "Delete this event?",
        body: (
          <>
            <p style={{ margin: "0 0 10px" }}>
              <strong>{title}</strong> and everything on it — its deals, its budget, its riders, its
              schedule and its messages — are removed for good, for everyone who was on it. This
              cannot be undone.
            </p>
            {/* This paragraph used to say that anybody else on the bill, or a signed
                agreement, would stop the delete. Since decisions #25.3 neither does on
                a CANCELLED show — cancelling is what told them — so saying so would
                promise a refusal the server no longer makes. What does still refuse is
                money, and that is the half worth reading. */}
            <p style={{ margin: 0 }}>
              Anyone else still on the bill is told the show was deleted. A show with a settlement
              or an invoice cannot be deleted at all — those are financial records, and it stays
              archived instead.
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

  /**
   * THE MENU, in the order of the ladder: cancel, file away, destroy.
   *
   * THREE rules decide what appears, and each mirrors the server so the menu cannot
   * promise what the API would refuse:
   *
   *  - **Capability first.** Cancelling is a `PATCH` (`event.edit`) and deleting is
   *    `event.delete`; a reader holding neither is offered neither. This was missing
   *    and it was a real boundary leak on screen (QA sweep run 4, QA4-9): a performer
   *    was offered "Cancel show…" on a show they had merely played, and the 403 they
   *    got for pressing it says "this part of the event isn't shared with you", which
   *    is about sharing and not about authority. Nothing was ever damaged — the API
   *    refused every time — but an affordance that exists to be refused is a lie.
   *  - **Cancel** is otherwise offered on any show that is not already cancelled.
   *    Not narrowed by status beyond that: `EVENT_STATUS_OPTIONS` is explicit that
   *    any status may be chosen in any direction, and a menu that refused to cancel
   *    a concluded show would be a rule this app does not have.
   *  - **Delete** is offered once the show is cancelled OR archived — the server's
   *    clause 6 exactly. Among callers who HOLD `event.delete` it stays offered even
   *    when another clause might refuse it, because those refusals name which one
   *    (a settlement, an invoice) and that is more use than a missing entry. The
   *    capability is different in kind: it is not a fact about the show that the
   *    refusal can teach, it is a fact about the reader.
   */
  const menuItems = useCallback(
    (event: {
      id: string;
      title: string;
      status?: string;
      archived?: boolean;
      published?: boolean;
      capabilities?: readonly string[];
    }): EventMenuItem[] => {
      const inFlight = pendingEventId === event.id;
      const working = inFlight ? "Working on it…" : undefined;

      // WHICH entries, from the pure rule (`hooks/eventRowMenu.ts`); WHAT they say,
      // here, beside the callbacks they fire. The split is what let the rule be
      // tested after QA4-9 without dragging Firebase into the test run.
      const items: Record<EventRowMenuKey, EventMenuItem> = {
        // The two READS, from `123qy9rng56`'s list of quick actions. Neither asks a
        // question first: publishing is one press with its own capability, and the
        // settlement is a page.
        publish: {
          key: "publish",
          label: event.published ? "Unpublish" : "Publish",
          onSelect:
            inFlight || publishing.isPending
              ? undefined
              : () => publishing.toggle(event.id, event.published === true),
          refusal: inFlight || publishing.isPending ? "Working on it…" : undefined,
          hint:
            inFlight || publishing.isPending
              ? undefined
              : event.published
                ? "Takes the public event page down. The link keeps working and reads “not public”."
                : "Puts the public event page up. Anyone with the link can open it and RSVP.",
        },
        settlement: {
          key: "settlement",
          label: "Settlement",
          onSelect: () =>
            navigate({ to: "/events/$eventId/settlement", params: { eventId: event.id } }),
          hint: "The money for this night: what each party is owed, and what has moved.",
        },
        unarchive: {
          key: "unarchive",
          label: "Unarchive",
          onSelect: inFlight ? undefined : () => void unarchive(event.id, event.title),
          refusal: working,
        },
        cancel: {
          key: "cancel",
          label: "Cancel show…",
          onSelect: inFlight ? undefined : () => askToCancel(event.id, event.title),
          refusal: working,
          hint: inFlight
            ? undefined
            : "Marks it cancelled and tells everyone on the bill why. Nothing is deleted.",
        },
        archive: {
          key: "archive",
          label: "Archive",
          onSelect: inFlight ? undefined : () => void archive(event.id, event.title),
          refusal: working,
          // Said out loud, because "archive" reads as "delete" to plenty of
          // people, and this one deletes nothing and is nobody else's business.
          hint: inFlight ? undefined : "Hides it from your lists. Nobody else is affected.",
        },
        delete: {
          key: "delete",
          label: "Delete permanently…",
          onSelect: inFlight ? undefined : () => askToDelete(event.id, event.title),
          refusal: working,
          hint: inFlight
            ? undefined
            : "Removes the show and everything on it, for everyone. Refused once it has a settlement or an invoice.",
        },
      };

      return eventRowMenuKeys(event).map((key) => items[key]);
    },
    [archive, unarchive, askToCancel, askToDelete, pendingEventId, publishing, navigate],
  );

  return {
    archive: (eventId, title) => void archive(eventId, title),
    unarchive: (eventId, title) => void unarchive(eventId, title),
    confirmDialogProps: confirmation.dialogProps,
    pendingEventId,
    menuItems,
    cancelModalProps: {
      open: cancelling !== null,
      eventTitle: cancelling?.title ?? "",
      // The list row does not carry a roster count, and inventing one would be
      // worse than the general sentence the dialog falls back to.
      otherParties: null,
      reason: cancelReason,
      onReasonChange: setCancelReason,
      onClose: closeCancel,
      onConfirm: () => {
        if (cancelling) void cancelShow(cancelling.id, cancelling.title, cancelReason.trim());
        closeCancel();
      },
      pending: cancelling !== null && pendingEventId === cancelling.id,
    },
  };
}
