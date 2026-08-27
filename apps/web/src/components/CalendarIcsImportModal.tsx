/**
 * Bringing a calendar in from an `.ics` file: pick → preview → commit.
 *
 * Presentational only. Every rule — what an entry becomes, what is refused and
 * why, which zone the times were read in — is the server's, and the preview is
 * that server's own answer with the write held back (`commit: false`). This file
 * decides nothing; it only says what came back.
 */
import { Badge, Button, DataTable, Icon, Modal } from "@showme/design-system";
import { useRef } from "react";
import { errorMessage } from "../lib/errors";
import { calendarEntryWhenLabel } from "./ExternalCalendarCard";
import { type IcsImportResult, useCalendarIcsImport } from "./useCalendarIcsImport";

export interface CalendarIcsImportModalProps {
  open: boolean;
  onClose: () => void;
}

/** Result hue and wording — a preview says what WILL happen, a report what did. */
const OUTCOME_BADGE: Record<
  IcsImportResult["outcome"],
  { status: "confirmed" | "pending" | "cancelled"; preview: string; done: string }
> = {
  imported: { status: "confirmed", preview: "Will import", done: "Imported" },
  updated: { status: "confirmed", preview: "Will refresh", done: "Refreshed" },
  skipped: { status: "pending", preview: "Will skip", done: "Skipped" },
  rejected: { status: "cancelled", preview: "Rejected", done: "Rejected" },
};

function ResultTable({ results, committed }: { results: IcsImportResult[]; committed: boolean }) {
  return (
    <DataTable<IcsImportResult>
      rows={results}
      getRowKey={(result) => String(result.index)}
      columns={[
        {
          header: "#",
          width: "48px",
          render: (result) => <span style={{ color: "var(--muted)" }}>{result.index + 1}</span>,
        },
        {
          header: "Entry",
          width: "1.6fr",
          render: (result) => result.title || <span style={{ color: "var(--muted)" }}>—</span>,
        },
        {
          header: "When",
          width: "1.5fr",
          render: (result) => {
            const date = result.date;
            // A rejected entry has no day at all — that is often WHY it was
            // rejected — so there is nothing to render but the reason beside it.
            if (!date) return <span style={{ color: "var(--muted)" }}>—</span>;
            return (
              <span style={{ fontSize: 12.5 }}>{calendarEntryWhenLabel({ ...result, date })}</span>
            );
          },
        },
        {
          header: "Result",
          width: "116px",
          render: (result) => {
            const badge = OUTCOME_BADGE[result.outcome];
            return (
              <Badge status={badge.status} dot>
                {committed ? badge.done : badge.preview}
              </Badge>
            );
          },
        },
        {
          header: "Why",
          width: "2fr",
          render: (result) => (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>{result.reason ?? ""}</span>
          ),
        },
      ]}
    />
  );
}

export function CalendarIcsImportModal({ open, onClose }: CalendarIcsImportModalProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const view = useCalendarIcsImport();
  const { preview, report, fileName, fileError } = view;
  const shown = report ?? preview;

  const close = () => {
    view.reset();
    onClose();
  };

  const willWrite = preview ? preview.imported + preview.updated : 0;

  const footer = report ? (
    <Button variant="primary" onClick={close}>
      Done
    </Button>
  ) : (
    <>
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
      <Button
        variant="primary"
        leftIcon={<Icon name="upload" />}
        onClick={view.commit}
        disabled={!preview || willWrite === 0 || view.isPending}
      >
        {view.isPending ? "Importing…" : `Import ${willWrite} entr${willWrite === 1 ? "y" : "ies"}`}
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={close} title="Import a calendar" width={820} footer={footer}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <input
          ref={fileInput}
          type="file"
          accept=".ics,text/calendar"
          hidden
          onChange={(changeEvent) => {
            const file = changeEvent.target.files?.[0];
            // Clearing the input lets the same file be re-picked after a reset;
            // otherwise the second pick fires no change event at all.
            changeEvent.target.value = "";
            if (file) void view.readFile(file);
          }}
        />

        {view.ownerProfileId === null ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Choose a profile first — an imported entry occupies a profile's availability, so it
            needs to know whose.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Button
                variant="secondary"
                leftIcon={<Icon name="file" />}
                onClick={() => fileInput.current?.click()}
              >
                {fileName ? "Choose another file" : "Choose an .ics file"}
              </Button>
              {fileName && (
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {fileName}
                  {shown?.calendarName ? ` · ${shown.calendarName}` : ""}
                </span>
              )}
            </div>

            {/* Said before anything is picked, because these are the things a user
                would otherwise only discover after importing. */}
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
              Entries arrive as <strong>calendar entries, not shows</strong> — they take their time
              off your availability and cost nothing. Turn one into a real show later from{" "}
              <strong>From your calendar</strong>. Importing the same file again{" "}
              <strong>refreshes</strong> what it brought before rather than duplicating it, and
              never undoes an “available anyway”. Times are read in{" "}
              <strong>{shown?.timeZone ?? view.browserTimeZone}</strong>.
            </p>
          </>
        )}

        {fileError && <div style={{ color: "var(--brand-red)", fontSize: 13 }}>{fileError}</div>}
        {view.error != null && (
          <div style={{ color: "var(--brand-red)", fontSize: 13 }} role="alert">
            {errorMessage(view.error, "Couldn't read that calendar file.")}
          </div>
        )}

        {shown && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {report
                ? `${report.imported} imported · ${report.updated} refreshed · ${report.skipped} skipped · ${report.rejected} rejected`
                : `${preview?.imported} to import · ${preview?.updated} to refresh · ${preview?.skipped} skipped · ${preview?.rejected} rejected`}
            </div>
            <ResultTable results={shown.results} committed={Boolean(report)} />
          </div>
        )}
      </div>
    </Modal>
  );
}
