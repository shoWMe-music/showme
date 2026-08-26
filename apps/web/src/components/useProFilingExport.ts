import { useGetApiV1EventsId } from "@showme/api-client";
import { useMemo, useState } from "react";
import {
  type FilingDocument,
  type FilingFormat,
  type FilingWork,
  buildFilingFile,
  downloadFilingFile,
} from "../lib/proFilingExport";
import { societyForTimezone } from "../lib/proSocieties";

/** What the Reports card already knows; the venue comes from the event detail. */
export interface ProFilingTarget {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventDate: string | null;
  readonly timezone: string | null;
  readonly performerName: string | null;
  readonly works: readonly FilingWork[];
}

/**
 * Assembles the filing for one setlist and renders it in the chosen format.
 *
 * WHY it fetches the event: the list endpoint (`GET /events`) returns no
 * `venueName` — only `venueProfileId` — and a performed-works report without the
 * venue is not a report. The detail endpoint has it, so the modal asks for it
 * when it opens and only then (`enabled` on the target).
 */
export function useProFilingExport(target: ProFilingTarget | null) {
  const [format, setFormat] = useState<FilingFormat>("csv");
  const event = useGetApiV1EventsId(target?.eventId ?? "", {
    query: { enabled: Boolean(target) },
  });

  const filing = useMemo<FilingDocument | null>(() => {
    if (!target) return null;
    return {
      society: societyForTimezone(target.timezone),
      eventTitle: target.eventTitle,
      eventDate: target.eventDate,
      // The venue is the one field we wait on — null until the detail lands, and
      // still null (not invented) if the event genuinely has no venue name.
      venueName: event.data?.venueName ?? null,
      timezone: target.timezone,
      performerName: target.performerName,
      works: target.works,
    };
  }, [target, event.data?.venueName]);

  const file = useMemo(() => (filing ? buildFilingFile(filing, format) : null), [filing, format]);

  return {
    filing,
    file,
    format,
    setFormat,
    /** True while the venue name is still in flight — the download waits for it. */
    isPending: Boolean(target) && event.isPending,
    isError: event.isError,
    error: event.error,
    download: () => {
      if (file) downloadFilingFile(file);
    },
  };
}
