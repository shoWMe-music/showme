import {
  ApiError,
  getGetApiV1EventsIdQueryKey,
  useGetApiV1EventsId,
  useGetApiV1EventsIdParticipants,
  usePostApiV1EventsIdPublish,
  usePostApiV1EventsIdUnpublish,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";
import { publicEventUrl } from "../lib/publicSite";

/**
 * Publishing an event — the state behind the "Public event page" panel at the
 * foot of the Event Information card.
 *
 * WHY IT READS THE EVENT ITSELF instead of taking one as a prop: the flag it
 * shows (`published`) is not part of the shape the details tab passes down, and
 * a panel that reasons about a stale copy of `status`/`version` would offer to
 * publish an event that has since been cancelled, or lose the optimistic lock on
 * every second click. `GET /events/:id` is already in the query cache (the event
 * screen loads it), so this costs nothing and is always the live row.
 *
 * WHY PUBLISH AND UNPUBLISH GO TO DIFFERENT ROUTES: each is its own act with its
 * own audit and activity entry, and both are gated on the same capability,
 * `event.publish` — `POST /events/:id/{publish,unpublish}`. Going dark needs no
 * precondition; going public needs a confirmed event with a date.
 *
 * Unpublishing used to be a plain `PATCH { published: false }`, which needs
 * `event.edit` — the title, the date, the venue, the capacity. That is a capability
 * a performer will never hold and must not, so under the old shape an act could put
 * its own show on the public internet and then not be able to take it off again
 * (ClickUp `123qy9rpe3q`). The API keeps honouring the PATCH for callers that still
 * use it, and notifies from there too.
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
  /**
   * WHO ELSE THIS IS PUBLIC FOR — the names Ran's sentence needs
   * (`123qy9rpe3q`): *"public on your profile and the {performer} or {Operator}
   * profile"*. Everybody publicly billed on the show except the profile the caller
   * is acting as, because one public page appears on every one of their profiles.
   * Empty while the roster loads, or on a show with nobody else on it — the panel
   * falls back to a sentence that names nobody rather than inventing a name.
   */
  otherSideNames: string[];
  /**
   * True from a successful publish until the panel is left. Ran asked for *"a UI
   * text, not a confirmation box"* saying what just happened and that the other
   * side will hear — which is a statement about the act just taken, so it is state,
   * not a property of the event.
   */
  justPublished: boolean;
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

/**
 * The roles whose PROFILE a published show appears on — the host and co-host who
 * run it, and the acts billed on it. Mirrors `PUBLICLY_BILLED_ROLES` plus the
 * operators (`apps/api/src/routes/public.ts`), and is used only to write a sentence:
 * the API decides what is actually public.
 */
const PUBLIC_FACING_ROLES = new Set(["host", "co_host", "performer", "support"]);

/** Participants who actually stand on the event — `invited` has agreed to nothing. */
const STANDING_STATUSES = new Set(["accepted", "confirmed"]);

/** Human status wording, matching the labels the event screen shows. */
function describeStatus(status: string): string {
  return status.replace(/_/g, " ");
}

/** The address of a show's public page. See `lib/publicSite.ts`. */
export const publicEventPageUrl = publicEventUrl;

export function useEventPublishing(
  eventId: string,
  { hasUnsavedChanges }: { hasUnsavedChanges: boolean },
): EventPublishing {
  const toast = useToast();
  const queryClient = useQueryClient();
  const eventQuery = useGetApiV1EventsId(eventId);
  const event = eventQuery.data;
  const participants = useGetApiV1EventsIdParticipants(eventId);

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

  const [justPublished, setJustPublished] = useState(false);

  const publishEvent = usePostApiV1EventsIdPublish({
    mutation: {
      onSuccess: () => {
        toast.success("Event published");
        setJustPublished(true);
        invalidateEvent();
      },
      onError: (error) => reportFailure(error, "Couldn't publish this event."),
    },
  });

  const unpublishEvent = usePostApiV1EventsIdUnpublish({
    mutation: {
      onSuccess: () => {
        toast.success("Event unpublished");
        setJustPublished(false);
        invalidateEvent();
      },
      onError: (error) => reportFailure(error, "Couldn't unpublish this event."),
    },
  });

  const status = event?.status ?? "";
  const published = event?.published ?? false;
  const hasDate = Boolean(event?.eventDate);
  const isWorking = publishEvent.isPending || unpublishEvent.isPending;

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
    unpublishEvent.mutate({ id: eventId, data: { expectedVersion: event.version } });
  }, [event, eventId, unpublishEvent]);

  /*
   * The bill, for the sentence only. A cache hit — the event screen already holds
   * this roster — and the acting profile is dropped from it because "your profile"
   * is the other half of Ran's sentence and naming yourself twice reads as a bug.
   *
   * `PUBLICLY_BILLED_ROLES` on the server decides whose page a show appears on
   * (`loadPublicShows`); this mirrors the ACT half of it plus the operators, which
   * is what "the other side" means in his ticket. Crew and agents are not on a
   * public page and are not named here.
   */
  const acting = getActiveProfileId();
  const otherSideNames = (participants.data ?? [])
    .filter(
      (party) =>
        party.profileId !== null &&
        party.profileId !== acting &&
        PUBLIC_FACING_ROLES.has(party.role) &&
        STANDING_STATUSES.has(party.status),
    )
    .map((party) => party.name ?? "")
    .filter((name) => name.length > 0);

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
    otherSideNames,
    justPublished,
    publicUrl: publicEventPageUrl(eventId),
  };
}
