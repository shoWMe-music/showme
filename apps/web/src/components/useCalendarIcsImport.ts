import {
  customFetch,
  getGetApiV1CalendarQueryKey,
  getGetApiV1ProfilesIdAvailabilityQueryKey,
} from "@showme/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";

/**
 * "Import" on the Calendar toolbar — the read half of `useCalendarIcsExport`.
 *
 * THE FILE IS NEVER PARSED HERE. It is posted verbatim to `POST /calendar/import`
 * and read by `parseIcs` in `@showme/shared` on the server, which is also where
 * every rule about what an entry becomes lives. So the preview is not a
 * simulation: it is the import endpoint called with `commit: false`, one code
 * path, and the verdict beside each row is the verdict that row will get. A
 * second implementation of the rules on this side is exactly the thing that
 * drifts.
 *
 * WHAT ARRIVES: `calendar_item` rows of `type = 'external'` — the same kind a
 * connected Google calendar writes. They occupy the profile's availability, they
 * can be handed back with "available anyway", and one can be turned into a real
 * show later from the "From your calendar" card. Nothing lands as an event, and
 * nothing costs a plan slot, which is what makes a wrong row free to delete.
 *
 * THE ZONE. A `.ics` can express a time three ways and only one of them is
 * unambiguous on its own, so the request names the zone the file's absolute and
 * foreign-zoned times should be read in — the browser's, sent explicitly rather
 * than left for the server to assume (`docs/timezones.md`). The response echoes
 * the zone actually used, so the screen states it instead of implying one.
 */

/** Matches the server's `MAX_ICS_CHARACTERS` — refused here with a sentence. */
const MAX_ICS_CHARACTERS = 512_000;

export type IcsImportOutcome = "imported" | "updated" | "skipped" | "rejected";

/** What the API says happened (or would happen) to one entry of the file. */
export interface IcsImportResult {
  index: number;
  uid: string | null;
  title: string;
  date: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  outcome: IcsImportOutcome;
  reason: string | null;
  calendarItemId: string | null;
}

export interface IcsImportReport {
  committed: boolean;
  timeZone: string;
  calendarName: string | null;
  imported: number;
  updated: number;
  skipped: number;
  rejected: number;
  results: IcsImportResult[];
}

export interface CalendarIcsImportView {
  /** The profile the entries would occupy, or null when none is active. */
  ownerProfileId: string | null;
  fileName: string | null;
  /** The zone the browser is in — what the file's absolute times will be read as. */
  browserTimeZone: string;
  preview: IcsImportReport | null;
  report: IcsImportReport | null;
  /** A problem with the file itself, as opposed to with one of its entries. */
  fileError: string | null;
  error: unknown;
  isPending: boolean;
  readFile: (file: File) => Promise<void>;
  commit: () => void;
  reset: () => void;
}

export function useCalendarIcsImport(): CalendarIcsImportView {
  const queryClient = useQueryClient();
  const ownerProfileId = getActiveProfileId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [ics, setIcs] = useState<string | null>(null);
  const [preview, setPreview] = useState<IcsImportReport | null>(null);
  const [report, setReport] = useState<IcsImportReport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const submit = useMutation({
    mutationFn: ({ contents, commit }: { contents: string; commit: boolean }) =>
      customFetch<IcsImportReport>({
        url: "/api/v1/calendar/import",
        method: "POST",
        data: { ownerProfileId, timeZone: browserTimeZone, ics: contents, commit },
      }),
    onSuccess: (result) => {
      if (!result.committed) {
        setPreview(result);
        return;
      }
      setReport(result);
      // Both reads change: the grid draws these entries, and the availability the
      // outside world sees is a union that now includes them.
      void queryClient.invalidateQueries({ queryKey: getGetApiV1CalendarQueryKey() });
      if (ownerProfileId) {
        void queryClient.invalidateQueries({
          queryKey: getGetApiV1ProfilesIdAvailabilityQueryKey(ownerProfileId),
        });
      }
    },
  });

  function reset() {
    setFileName(null);
    setIcs(null);
    setPreview(null);
    setReport(null);
    setFileError(null);
    submit.reset();
  }

  async function readFile(file: File) {
    reset();
    setFileName(file.name);
    const contents = await file.text();
    if (contents.length > MAX_ICS_CHARACTERS) {
      setFileError("That file is too large to import in one go — export a shorter period.");
      return;
    }
    setIcs(contents);
    // Straight to the preview: there is nothing to configure between picking a
    // calendar file and finding out what is in it.
    submit.mutate({ contents, commit: false });
  }

  return {
    ownerProfileId,
    fileName,
    browserTimeZone,
    preview,
    report,
    fileError,
    error: submit.error,
    isPending: submit.isPending,
    readFile,
    commit: () => {
      if (ics) submit.mutate({ contents: ics, commit: true });
    },
    reset,
  };
}
