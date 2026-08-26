import {
  type getApiV1Calendar,
  getGetApiV1CalendarQueryKey,
  getGetApiV1ProfilesIdAvailabilityQueryKey,
  usePatchApiV1CalendarIdAvailability,
  usePostApiV1CalendarIdPromoteEvent,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";

/**
 * The two things a user may do to an entry that came from a connected calendar:
 * take its time back ("available anyway"), and turn it into a real show.
 *
 * Everything else about such an entry belongs to the calendar it came from —
 * `PATCH /calendar/:id` refuses to edit one, because the next sync would undo the
 * edit anyway and being told no is better than being quietly overwritten.
 *
 * The TITLE on these rows is whatever the API chose to show this reader: the real
 * one for the person whose account it was imported from, the placeholder "Busy"
 * for everyone else on the profile. `titleWithheld` says which, so the screen can
 * be honest about it rather than presenting a placeholder as a name. Nothing is
 * hidden here — by the time a row reaches this hook the redaction has already
 * happened server-side (`apps/api/src/serialize/calendar.ts`).
 */

type CalendarItem = Awaited<ReturnType<typeof getApiV1Calendar>>[number];

/** An imported entry, as the Calendar screen needs it. */
export interface ExternalCalendarEntry {
  id: string;
  /** The real name, or "Busy" when this reader may not see it. */
  title: string;
  titleWithheld: boolean;
  date: string;
  /** Last day inclusive; equals `date` for a single-day entry. */
  endDate: string;
  /** `HH:mm`, or null for an all-day entry. */
  startTime: string | null;
  endTime: string | null;
  /** Where it came from — "google", "ics". */
  source: string | null;
  blocksAvailability: boolean;
  /** The show it was turned into, if it has been. */
  promotedEventId: string | null;
  /** True when it takes the whole day rather than a window of it. */
  isAllDay: boolean;
}

/** `20:30:00` → `20:30`; null for anything unrecognisable, so nothing prints raw. */
function shortTime(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : null;
}

export interface ExternalCalendarEntriesView {
  /** Imported entries that touch the period on screen, soonest first. */
  entries: ExternalCalendarEntry[];
  /** True while any entry is mid-write, so the card can disable its controls. */
  isSaving: boolean;
  /** The last refusal from the API, verbatim. */
  error: string | null;
  /** Flip "blocks availability" ↔ "available anyway". */
  setBlocksAvailability: (entryId: string, blocks: boolean) => void;
  /** Turn the entry into a draft shoWMe event; calls back with the new event id. */
  promote: (entryId: string, onPromoted: (eventId: string) => void) => void;
}

/**
 * Filter the calendar feed down to the imported entries inside `from`..`to`.
 *
 * The filtering is done here rather than by a second request because the grid has
 * already fetched exactly these rows — an imported entry IS a calendar item, and
 * asking the server again for a subset of what is already in memory would be a
 * request per view change for no new information.
 */
export function useExternalCalendarEntries(
  items: CalendarItem[],
  range: { from: string; to: string },
): ExternalCalendarEntriesView {
  const toast = useToast();
  const queryClient = useQueryClient();
  const setAvailability = usePatchApiV1CalendarIdAvailability();
  const promoteEntry = usePostApiV1CalendarIdPromoteEvent();
  const [error, setError] = useState<string | null>(null);

  const entries = useMemo<ExternalCalendarEntry[]>(() => {
    return (
      items
        .filter((item) => item.type === "external")
        .map((item) => {
          const endDate = item.endDate ?? item.date;
          const startTime = shortTime(item.startTime);
          const endTime = shortTime(item.endTime);
          return {
            id: item.id,
            title: item.title,
            titleWithheld: item.titleWithheld,
            date: item.date,
            endDate,
            startTime,
            endTime,
            source: item.externalSource,
            blocksAvailability: item.blocksAvailability,
            promotedEventId: item.promotedEventId,
            // The same rule the API applies (`lib/availability.ts`): a window needs
            // both bounds on a single day, and anything else takes the whole day.
            isAllDay: endDate !== item.date || !startTime || !endTime,
          };
        })
        // Two inclusive ranges overlap iff each starts on or before the other ends.
        .filter((entry) => entry.date <= range.to && entry.endDate >= range.from)
        .sort((left, right) => left.date.localeCompare(right.date))
    );
  }, [items, range.from, range.to]);

  /** Both writes change what the world sees as free, so both refresh both reads. */
  const refreshCalendarAndAvailability = () => {
    void queryClient.invalidateQueries({ queryKey: getGetApiV1CalendarQueryKey() });
    const activeProfileId = getActiveProfileId();
    if (activeProfileId) {
      void queryClient.invalidateQueries({
        queryKey: getGetApiV1ProfilesIdAvailabilityQueryKey(activeProfileId),
      });
    }
  };

  return {
    entries,
    isSaving: setAvailability.isPending || promoteEntry.isPending,
    error,
    setBlocksAvailability: (entryId, blocks) => {
      setError(null);
      setAvailability.mutate(
        { id: entryId, data: { blocksAvailability: blocks } },
        {
          onSuccess: () => {
            refreshCalendarAndAvailability();
            toast.success(
              blocks
                ? "This time is blocked again."
                : "Marked available anyway — the time is free.",
            );
          },
          onError: (mutationError) => setError(errorMessage(mutationError)),
        },
      );
    },
    promote: (entryId, onPromoted) => {
      setError(null);
      promoteEntry.mutate(
        { id: entryId, data: {} },
        {
          onSuccess: (result) => {
            refreshCalendarAndAvailability();
            // The plan consequence, said out loud rather than discovered later:
            // a draft is free and confirming it is what spends a slot.
            const cap = result.eventCap;
            const remaining = cap.limit !== null && cap.used !== null ? cap.limit - cap.used : null;
            toast.success(
              remaining === null
                ? "Created as a draft show."
                : `Created as a draft show. Confirming it later uses 1 of your ${cap.limit} event slots (${remaining} left).`,
            );
            onPromoted(result.eventId);
          },
          onError: (mutationError) => setError(errorMessage(mutationError)),
        },
      );
    },
  };
}
