import {
  ApiError,
  getGetApiV1EventsIdQueryKey,
  useGetApiV1EventsId,
  usePatchApiV1EventsId,
  usePostApiV1EventsIdPublish,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { publicSiteUrl } from "../lib/availabilityShareLink";
import { errorMessage } from "../lib/errors";

/**
 * Publishing an event — the state behind the "Public event page" panel in the
 * Event Information edit modal.
 *
 * WHY IT READS THE EVENT ITSELF instead of taking one as a prop: the flag it
 * shows (`published`) is not part of the shape the details tab passes down, and
 * a panel that reasons about a stale copy of `status`/`version` would offer to
 * publish an event that has since been cancelled, or lose the optimistic lock on
 * every second click. `GET /events/:id` is already in the query cache (the event
 * screen loads it), so this costs nothing and is always the live row.
 *
 * WHY PUBLISH AND UNPUBLISH GO TO DIFFERENT ROUTES: publishing is its own act
 * with its own capability (`event.publish`), its own preconditions and its own
 * audit + activity entry — `POST /events/:id/publish`. There is no unpublish
 * route, so taking a page down is a plain `PATCH { published: false }`
 * (`event.edit`). Going dark needs no precondition; going public does.
 */
export interface EventPublishing {
  /** The live event status — the A-22 precondition the panel has to explain. */
  status: string;
  published: boolean;
  hasDate: boolean;
  isLoading: boolean;
  /** True when the button may be pressed. */
  canPublish: boolean;
  /**
   * Why publishing is not offered right now, in the operator's language, or null
   * when it is. Shown BEFORE the click: A-22 means a published-but-unconfirmed
   * event has no public page at all, so a tick that silently does nothing would
   * be a trap.
   */
  blockedReason: string | null;
  publish: () => void;
  unpublish: () => void;
  isWorking: boolean;
  /** The address the public page lives at, once there is something to see. */
  publicUrl: string;
}

/**
 * The event statuses that actually have a public page — the mirror of
 * `PUBLICLY_VISIBLE_EVENT_STATUSES` in `apps/api/src/routes/public.ts`. Kept as
 * a UI-side copy on purpose: it is used only to EXPLAIN, never to authorize, and
 * the API refuses on its own terms regardless of what this says.
 */
const STATUSES_WITH_A_PUBLIC_PAGE = new Set(["confirmed", "concluded"]);

/** Human status wording, matching the labels the event screen shows. */
function describeStatus(status: string): string {
  return status.replace(/_/g, " ");
}

export function publicEventPageUrl(eventId: string): string {
  return `${publicSiteUrl().replace(/\/$/, "")}/event.html?event=${encodeURIComponent(eventId)}`;
}

export function useEventPublishing(
  eventId: string,
  { hasUnsavedChanges }: { hasUnsavedChanges: boolean },
): EventPublishing {
  const toast = useToast();
  const queryClient = useQueryClient();
  const eventQuery = useGetApiV1EventsId(eventId);
  const event = eventQuery.data;

  const invalidateEvent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(eventId) });
  }, [queryClient, eventId]);

  // A publish and an unpublish are the same promise to the user, so they report
  // the same way: the API's own message on failure (it is written for a person —
  // "Only a confirmed event can be published (this one is draft)"), never a
  // generic one that hides which precondition bit.
  const reportFailure = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.error("Someone else changed this event. Reload it and try again.");
        return;
      }
      toast.error(errorMessage(error, fallback));
    },
    [toast],
  );

  const publishEvent = usePostApiV1EventsIdPublish({
    mutation: {
      onSuccess: () => {
        toast.success("This event is live on the public internet");
        invalidateEvent();
      },
      onError: (error) => reportFailure(error, "Couldn't publish this event."),
    },
  });

  const patchEvent = usePatchApiV1EventsId({
    mutation: {
      onSuccess: () => {
        toast.success("The public page has been taken down");
        invalidateEvent();
      },
      onError: (error) => reportFailure(error, "Couldn't take the public page down."),
    },
  });

  const status = event?.status ?? "";
  const published = event?.published ?? false;
  const hasDate = Boolean(event?.eventDate);
  const isWorking = publishEvent.isPending || patchEvent.isPending;

  const blockedReason = ((): string | null => {
    if (!event) return null;
    if (published) return null;
    // The A-22 trap, said out loud. `concluded` is publishable in the read rule
    // but not in the publish route (only `confirmed` is), and that is the honest
    // thing to report — nobody announces a show that already happened.
    if (status !== "confirmed") {
      return STATUSES_WITH_A_PUBLIC_PAGE.has(status)
        ? `A ${describeStatus(status)} event can't be announced.`
        : `Only a confirmed event has a public page. This one is ${describeStatus(status)} — confirm the booking first.`;
    }
    if (!hasDate) return "A page with no date isn't an announcement. Give the event a date first.";
    // The publish route writes the row that is SAVED, not the draft in the form
    // above it — so an operator who publishes mid-edit would put the old title on
    // the internet and have no way to tell.
    if (hasUnsavedChanges) return "Save your changes first — the public page shows what's saved.";
    return null;
  })();

  const publish = useCallback(() => {
    if (!event) return;
    publishEvent.mutate({ id: eventId, data: { expectedVersion: event.version } });
  }, [event, eventId, publishEvent]);

  const unpublish = useCallback(() => {
    if (!event) return;
    patchEvent.mutate({
      id: eventId,
      data: { published: false, expectedVersion: event.version },
    });
  }, [event, eventId, patchEvent]);

  return {
    status,
    published,
    hasDate,
    isLoading: eventQuery.isPending,
    canPublish: Boolean(event) && !published && blockedReason === null && !isWorking,
    blockedReason,
    publish,
    unpublish,
    isWorking,
    publicUrl: publicEventPageUrl(eventId),
  };
}
