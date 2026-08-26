import { Button, Card, Icon, KeyValueRow, Modal } from "@showme/design-system";
import { Select } from "@showme/design-system";
import {
  FILING_FORMATS,
  type FilingFormat,
  MISSING_FILING_FIELDS,
  formatDurationClock,
  societyLabel,
  totalDurationSeconds,
} from "../lib/proFilingExport";
import { Eyebrow } from "./primitives";
import { ErrorState, LoadingState } from "./states";
import { type ProFilingTarget, useProFilingExport } from "./useProFilingExport";

export interface ProFilingExportModalProps {
  /** The setlist being filed, or null when the modal is closed. */
  target: ProFilingTarget | null;
  onClose: () => void;
}

/**
 * Export the performed-works report so the operator can send it to the society
 * that covers the show's territory — themselves, today.
 *
 * The modal exports; it never files. Nothing in here writes a submission record
 * and nothing changes the card's "Not filed" chip, because nothing has been
 * filed. The direct-submission block at the bottom is a stated intention, drawn
 * as one.
 */
export function ProFilingExportModal({ target, onClose }: ProFilingExportModalProps) {
  const { filing, file, format, setFormat, isPending, isError, error, download } =
    useProFilingExport(target);
  const society = societyLabel(filing?.society ?? null);

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={`Export the ${society} report`}
      width={660}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="cta" onClick={download} disabled={!file || isPending}>
            <Icon name="download" size={14} />
            Download {file ? file.fileName.split(".").pop()?.toUpperCase() : ""}
          </Button>
        </>
      }
    >
      {isPending ? (
        <LoadingState label="Preparing the report" />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't read this event" />
      ) : filing && file ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <FilingSummary
            society={society}
            territory={
              filing.society ? `${filing.society.countryName} (${filing.society.country})` : null
            }
            event={filing.eventTitle}
            date={filing.eventDate}
            venue={filing.venueName}
            performer={filing.performerName}
            workCount={filing.works.length}
            runtimeSeconds={totalDurationSeconds(filing.works)}
          />

          <IncompleteFilingNotice />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Select
              label="Format"
              value={format}
              onChange={(value) => setFormat(value as FilingFormat)}
              options={FILING_FORMATS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {FILING_FORMATS.find((option) => option.value === format)?.purpose}
            </div>
          </div>

          <FilePreview fileName={file.fileName} content={file.content} />

          <DirectSubmissionTeaser society={society} />
        </div>
      ) : null}
    </Modal>
  );
}

/** What the file will contain, before you download it. */
function FilingSummary({
  society,
  territory,
  event,
  date,
  venue,
  performer,
  workCount,
  runtimeSeconds,
}: {
  society: string;
  territory: string | null;
  event: string;
  date: string | null;
  venue: string | null;
  performer: string | null;
  workCount: number;
  runtimeSeconds: number | null;
}) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Eyebrow>The filing</Eyebrow>
      <KeyValueRow label="Society" value={society} />
      {/* Territory, not the operator's home country: the show's location decides
          the society (decisions.md #17). "—" when we can't place the venue. */}
      <KeyValueRow label="Territory" value={territory ?? "—"} />
      <KeyValueRow label="Event" value={event || "—"} />
      <KeyValueRow label="Date" value={date ?? "—"} />
      <KeyValueRow label="Venue" value={venue ?? "—"} />
      <KeyValueRow label="Performer" value={performer ?? "—"} />
      <KeyValueRow label="Works" value={String(workCount)} mono />
      <KeyValueRow
        label="Runtime"
        value={runtimeSeconds == null ? "—" : formatDurationClock(runtimeSeconds)}
        mono
      />
    </Card>
  );
}

/**
 * The fields a society requires that shoWMe cannot supply.
 *
 * Stated here as loudly as in the file itself: the screen's banner promises
 * "writer shares and ISWC codes from the performer's repertoire" and there is no
 * repertoire, so an operator who downloads this and files it unchanged files
 * short — and short filings cost the writers their royalties.
 */
function IncompleteFilingNotice() {
  return (
    <div
      style={{
        border: "1px solid color-mix(in srgb, var(--brand-amber) 45%, var(--border))",
        background: "color-mix(in srgb, var(--brand-amber) 10%, transparent)",
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        gap: 10,
      }}
    >
      <Icon name="alert" size={16} />
      <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.6 }}>
        <strong>Incomplete — add these before you file.</strong> The export carries the set, the
        durations and the show, but shoWMe does not hold the work credits a society needs. Each one
        is marked <code>NOT CAPTURED</code> in the file:
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--muted)" }}>
          {MISSING_FILING_FIELDS.map((gap) => (
            <li key={gap.field} style={{ marginBottom: 3 }}>
              <span style={{ color: "var(--text)" }}>{gap.field}</span> — {gap.why}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The literal bytes about to hit disk — no surprises after the click. */
function FilePreview({ fileName, content }: { fileName: string; content: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Eyebrow>{fileName}</Eyebrow>
      <pre
        style={{
          margin: 0,
          maxHeight: 190,
          overflow: "auto",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "12px 14px",
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          lineHeight: 1.6,
          color: "var(--muted)",
          whiteSpace: "pre",
        }}
      >
        {content}
      </pre>
    </div>
  );
}

/**
 * The one-click filing we intend to build, shown as a promise rather than a
 * button that lies. The control is disabled and labelled "Not available", the
 * copy says in words that nothing has been submitted, and no state anywhere
 * moves off "Not filed" — because clicking it does nothing at all.
 */
function DirectSubmissionTeaser({ society }: { society: string }) {
  return (
    <div
      style={{
        border: "1px dashed var(--border)",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: 0.85,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Eyebrow>Coming later</Eyebrow>
        <span
          style={{
            padding: "3px 9px",
            borderRadius: 999,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            background: "var(--shape-fill)",
            border: "1px solid var(--border)",
            color: "var(--dim)",
          }}
        >
          Not available
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
        Filing straight from shoWMe to {society} needs a connection to the society itself, and we
        have not built one yet. <strong>Nothing has been submitted</strong> — download the file
        above and send it to {society} yourself. This report stays “Not filed” either way.
      </div>
      <div>
        <Button variant="secondary" disabled aria-disabled="true">
          <Icon name="upload" size={14} />
          Send directly to {society}
        </Button>
      </div>
    </div>
  );
}
