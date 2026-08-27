import {
  type GetApiV1EventsIdPerformanceReport200,
  getGetApiV1EventsIdPerformanceReportQueryKey,
  useGetApiV1EventsIdPerformanceReport,
  usePostApiV1EventsIdPerformanceReport,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { type SetlistWork, societyForCountry } from "@showme/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { errorMessage } from "../lib/errors";
import {
  type FilingDocument,
  type FilingFormat,
  buildFilingFile,
  downloadFilingFile,
} from "../lib/proFilingExport";

/**
 * One show's PRO filing: what would be reported, what already was, and the two
 * things the operator can do about it — download the works report, and record
 * that they filed it.
 *
 * WHY THE RECORDING STEP IS THE REAL FEATURE. shoWMe cannot submit to a
 * collecting society; there is no integration with one. The operator downloads
 * the file and sends it themselves, and before this hook existed that act left no
 * trace at all — every card on the Reports screen printed a hardcoded "Not filed"
 * chip forever, whether or not the show had been reported months ago. `POST`
 * writes the `performance_reports` row that says otherwise. It is a log of
 * something that happened outside the platform, never a claim the platform did it,
 * and the copy on the screen has to keep saying so.
 *
 * Everything derived lives here so the modal stays a rendering of values.
 */

export interface PerformanceReportTarget {
  readonly eventId: string;
}

export function usePerformanceReport(target: PerformanceReportTarget | null) {
  const eventId = target?.eventId ?? "";
  const toast = useToast();
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<FilingFormat>("csv");
  const [reference, setReference] = useState("");

  const query = useGetApiV1EventsIdPerformanceReport(eventId, {
    query: { enabled: Boolean(target) },
  });
  const data = query.data;

  const fileReport = usePostApiV1EventsIdPerformanceReport({
    mutation: {
      onSuccess: () => {
        setReference("");
        toast.success("Filing recorded.");
        queryClient.invalidateQueries({
          queryKey: getGetApiV1EventsIdPerformanceReportQueryKey(eventId),
        });
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't record the filing.")),
    },
  });

  const works = useMemo<SetlistWork[]>(
    () => (data?.works ?? []).map((work) => ({ ...work })),
    [data?.works],
  );

  /**
   * The acts on the bill, in running order and without repeats — the header line
   * of the export. Derived from the works rather than fetched separately, so it
   * can only ever name acts that actually contributed songs to the filing.
   */
  const performers = useMemo(
    () => [...new Set(works.map((work) => work.performer).filter((name) => name !== null))],
    [works],
  );

  const filing = useMemo<FilingDocument | null>(() => {
    if (!data) return null;
    return {
      // The society is named from the SERVER's country (the venue's recorded
      // address), never from the timezone or the venue's name.
      society: societyForCountry(data.country),
      eventTitle: data.eventTitle,
      eventDate: data.eventDate,
      venueName: data.venueName,
      timezone: data.timezone,
      performers,
      works,
    };
  }, [data, performers, works]);

  const file = useMemo(
    // No works, no file. An export of an empty set is a report that says a show
    // had no music in it, which is a claim, not an absence.
    () => (filing && works.length > 0 ? buildFilingFile(filing, format) : null),
    [filing, format, works.length],
  );

  const submit = useCallback(() => {
    if (!target) return;
    fileReport.mutate({
      id: target.eventId,
      data: { reference: reference.trim() || null },
    });
  }, [fileReport, reference, target]);

  return {
    filing,
    file,
    format,
    setFormat,
    works,
    performers,
    /** The society's short name for a heading, or a neutral word when unmapped. */
    societyName: data?.society?.name ?? data?.tariff?.proName ?? "PRO",
    territory: data?.society
      ? `${data.society.countryName} (${data.society.country})`
      : (data?.country ?? null),
    tariff: data?.tariff ?? null,
    /** Minor-unit strings straight from the API — money never becomes a number here. */
    estimate: data?.estimate ?? null,
    ticketRevenue: data?.ticketRevenue ?? null,
    currency: data?.currency ?? null,
    report: data?.report ?? null,
    /** Why filing is impossible right now, in words, or null when it is possible. */
    blockedReason: blockedReason(data),
    reference,
    setReference,
    isPending: Boolean(target) && query.isPending,
    isError: query.isError,
    error: query.error,
    isFiling: fileReport.isPending,
    submit,
    download: () => {
      if (file) downloadFilingFile(file);
    },
  };
}

/**
 * The two states in which there is nothing to file, said as a sentence the
 * operator can act on rather than as a disabled button with no explanation.
 *
 * Both are also refused server-side (`routes/performance-reports.ts`); this is
 * the same rule stated early so the affordance is never offered, per §7.
 */
function blockedReason(data: GetApiV1EventsIdPerformanceReport200 | undefined): string | null {
  if (!data) return null;
  if (data.works.length === 0) {
    return "No performer on this show has written a setlist yet, so there are no works to report.";
  }
  if (!data.country) {
    return "This show has no country, so there is no society to file with. Add a country to the venue profile's address.";
  }
  return null;
}
