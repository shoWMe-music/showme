import {
  getGetApiV1EventsQueryKey,
  usePostApiV1EventsIdPublish,
  usePostApiV1EventsIdUnpublish,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "../lib/errors";

/**
 * PUBLISH OR UNPUBLISH FROM A QUICK ACTION — the calendar's day popover
 * (`123qy9rnk21`) and the events row menu (`123qy9rng56`).
 *
 * It was `useCalendarPublishToggle` for about an hour, until the second caller arrived
 * and the name started naming one of them. Both surfaces want the same thing: one press,
 * no form, and the lists refreshed afterwards.
 *
 * A hook at the leaf rather than a handler drilled down from the screen. For the popover
 * the chain is Calendar → month/week/day grid → day cell → chip → preview, and threading
 * one button through four layers of props that care about none of it is worse — which is
 * also what this codebase asks for: *"Fetching, mutation and derivation belong in a
 * `use*` hook; the component takes values and emits events."*
 *
 * It does NOT break the preview's "no fetch" rule. A mutation hook issues no request
 * until it is called, so a month grid with forty chips still makes zero extra requests;
 * only pressing the button does anything.
 *
 * The routes are the ones built for `123qy9rpe3q` this afternoon, which is why the
 * calendar can offer this at all: unpublishing used to be a `PATCH` under `event.edit`
 * — a capability this button's readers may not hold — and is now its own route gated on
 * `event.publish`, the same capability as its opposite.
 */
export interface PublishToggle {
  toggle: (eventId: string, published: boolean) => void;
  isPending: boolean;
}

export function usePublishToggle(): PublishToggle {
  const toast = useToast();
  const queryClient = useQueryClient();

  /**
   * Every events list, at every filter — the same prefix invalidation the archive
   * actions use. The calendar draws from `GET /events` too, so the chip's own
   * `published` flag is refreshed by this and the button cannot be left showing the
   * state it just changed.
   */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetApiV1EventsQueryKey() });
  }, [queryClient]);

  const publish = usePostApiV1EventsIdPublish({
    mutation: {
      onSuccess: () => {
        toast.success("Event published");
        refresh();
      },
      // The API's own sentence: it names the precondition that bit ("Only a confirmed
      // event can be published"), which is the only thing that tells the reader what
      // to do next.
      onError: (error: unknown) => toast.error(errorMessage(error, "Couldn't publish it.")),
    },
  });

  const unpublish = usePostApiV1EventsIdUnpublish({
    mutation: {
      onSuccess: () => {
        toast.success("Event unpublished");
        refresh();
      },
      onError: (error: unknown) => toast.error(errorMessage(error, "Couldn't unpublish it.")),
    },
  });

  return {
    toggle: useCallback(
      (eventId: string, published: boolean) => {
        // No `expectedVersion`. The reader pressed a button about a fact they can see on
        // the chip, and a version mismatch would refuse them because somebody else
        // edited a field they were not asked about — the same reasoning as the row
        // menu's delete.
        if (published) unpublish.mutate({ id: eventId, data: {} });
        else publish.mutate({ id: eventId, data: {} });
      },
      [publish, unpublish],
    ),
    isPending: publish.isPending || unpublish.isPending,
  };
}
