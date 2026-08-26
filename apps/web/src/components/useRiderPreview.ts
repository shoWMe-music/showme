import { useGetApiV1EventsIdRidersRidPreviewUrl } from "@showme/api-client";
import { useCallback, useState } from "react";
import type { DetailsRider } from "./EventDetailsTab";
import { type RiderPreviewKind, riderPreviewKind } from "./riderPreview";

export interface RiderPreview {
  /** The rider being read, or null when the preview is closed. */
  rider: DetailsRider | null;
  /** How its document should be shown — null when there is no document. */
  kind: RiderPreviewKind | null;
  /** A short-lived signed URL for the bytes; null until it has been issued. */
  url: string | null;
  isPending: boolean;
  error: unknown;
  open: (riderId: string) => void;
  close: () => void;
}

/**
 * Reading one rider's document. The URL is issued PER OPEN rather than carried
 * on the list, because it is a short-lived signed URL — one minted at page load
 * would be stale by the time anyone clicked, and every rider on the event would
 * be handing out bytes nobody asked to see.
 *
 * `/events/:id/riders/:rid/preview-url` re-derives the same visibility the list
 * used (decisions #12), so a rider the caller cannot reach 404s here too. The
 * modal therefore renders whatever the API says and never decides for itself who
 * may look.
 */
export function useRiderPreview(eventId: string, riders: DetailsRider[]): RiderPreview {
  const [openRiderId, setOpenRiderId] = useState<string | null>(null);
  const rider = riders.find((row) => row.id === openRiderId) ?? null;
  const file = rider?.file ?? null;

  const query = useGetApiV1EventsIdRidersRidPreviewUrl(eventId, openRiderId ?? "", {
    query: {
      enabled: rider !== null && file !== null,
      // The URL expires; keep it only for as long as this reading session.
      gcTime: 0,
      retry: false,
    },
  });

  const close = useCallback(() => setOpenRiderId(null), []);

  return {
    rider,
    kind: file ? riderPreviewKind(file) : null,
    url: query.data?.url ?? null,
    isPending: file !== null && query.isPending,
    error: query.error,
    open: setOpenRiderId,
    close,
  };
}
