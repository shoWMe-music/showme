import {
  Badge,
  Button,
  Card,
  Icon,
  KeyValueRow,
  Modal,
  Select,
  TextField,
} from "@showme/design-system";
import { formatDurationClock } from "@showme/shared";
import { formatDate, formatDay, formatMoney } from "../lib/format";
import { FILING_FORMATS, type FilingFormat, MISSING_FILING_FIELDS } from "../lib/proFilingExport";
import { Eyebrow } from "./primitives";
import { ErrorState, LoadingState } from "./states";
import { type PerformanceReportTarget, usePerformanceReport } from "./usePerformanceReport";

export interface PerformanceReportModalProps {
  /** The show being reported on, or null when the modal is closed. */
  target: PerformanceReportTarget | null;
  onClose: () => void;
}

/**
 * Report a show's performed works to the collecting society that covers where it
 * happened — the operator's half of the setlist module.
 *
 * TWO ACTS, IN ORDER, AND THE COPY KEEPS THEM APART. First you download the works
 * report and send it to the society yourself, because shoWMe has no connection to
 * one. Then you record here that you did, which is what a `performance_reports`
 * row is. Nothing in this modal transmits anything to STIM, and nothing in it
 * says otherwise.
 */
export function PerformanceReportModal({ target, onClose }: PerformanceReportModalProps) {
  const report = usePerformanceReport(target);

  return (
    <Modal
      dismissOnScrim={false}
      open={Boolean(target)}
      onClose={onClose}
      title={`Report to ${report.societyName}`}
      width={680}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="cta" onClick={report.download} disabled={!report.file}>
            <Icon name="download" size={14} />
            Download {report.file?.fileName.split(".").pop()?.toUpperCase() ?? ""}
          </Button>
        </>
      }
    >
      {report.isPending ? (
        <LoadingState label="Preparing the report" />
      ) : report.isError ? (
        <ErrorState error={report.error} title="Couldn't read this show's filing" />
      ) : report.filing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <FilingSummary report={report} />

          {report.blockedReason ? (
            <Notice tone="alert">{report.blockedReason}</Notice>
          ) : (
            <>
              <IncompleteFilingNotice />

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Select
                  label="Format"
                  value={report.format}
                  onChange={(value) => report.setFormat(value as FilingFormat)}
                  options={FILING_FORMATS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  {FILING_FORMATS.find((option) => option.value === report.format)?.purpose}
                </div>
              </div>

              {report.file && (
                <FilePreview fileName={report.file.fileName} content={report.file.content} />
              )}

              <RecordFiling report={report} />
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

type ReportState = ReturnType<typeof usePerformanceReport>;

/** What the filing covers — the show, the territory, and the royalty estimate. */
function FilingSummary({ report }: { report: ReportState }) {
  const runtime = report.works.reduce((total, work) => total + (work.durationSeconds ?? 0), 0);
  const anyDuration = report.works.some((work) => work.durationSeconds != null);

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Eyebrow>The filing</Eyebrow>
        <FilingStateBadge report={report} />
      </div>
      <KeyValueRow label="Society" value={report.societyName} />
      {/* Territory, not the operator's home country: the show's location decides
          the society (decisions.md #17). "—" when the venue has no address. */}
      <KeyValueRow label="Territory" value={report.territory ?? "—"} />
      <KeyValueRow label="Event" value={report.filing?.eventTitle || "—"} />
      <KeyValueRow label="Date" value={formatDay(report.filing?.eventDate)} />
      <KeyValueRow label="Venue" value={report.filing?.venueName ?? "—"} />
      <KeyValueRow
        label={report.performers.length === 1 ? "Performer" : "Performers"}
        value={report.performers.length > 0 ? report.performers.join(", ") : "—"}
      />
      <KeyValueRow label="Works" value={String(report.works.length)} mono />
      <KeyValueRow label="Runtime" value={anyDuration ? formatDurationClock(runtime) : "—"} mono />
      <RoyaltyEstimate report={report} />
    </Card>
  );
}

/**
 * The royalty estimate, or the reason there isn't one.
 *
 * NO FIGURE IS EVER INVENTED HERE. A number appears only when a platform admin
 * has entered the territory's published tariff into `performing_rights_rates`;
 * otherwise the row says which country has no configured tariff, which is both
 * true and fixable. The Budget Planner's flat-6% fallback is deliberately not
 * borrowed — a guess is fine on a planning card and is not fine on a line that
 * names a society and a show.
 */
function RoyaltyEstimate({ report }: { report: ReportState }) {
  if (!report.tariff || report.estimate === null || !report.currency) {
    return (
      <KeyValueRow
        label="Royalty estimate"
        value={
          report.territory
            ? `No published tariff on file for ${report.territory}`
            : "Unknown — the show has no territory"
        }
      />
    );
  }
  const percent = (report.tariff.rateBasisPoints / 100).toFixed(2).replace(/\.00$/, "");
  return (
    <>
      <KeyValueRow
        label="Royalty estimate"
        value={`${formatMoney(report.estimate, report.currency)} (estimate)`}
        mono
      />
      <div style={{ color: "var(--muted)", fontSize: 11.5, lineHeight: 1.6 }}>
        {percent}% of {formatMoney(report.ticketRevenue, report.currency)} ticket revenue, at{" "}
        {report.tariff.proName}'s configured tariff
        {report.tariff.sourceNote ? ` (${report.tariff.sourceNote})` : ""}. An estimate —{" "}
        {report.tariff.proName} charges what its own tariff says, not what this says.
        {report.tariff.sourceUrl ? (
          <>
            {" "}
            <a href={report.tariff.sourceUrl} target="_blank" rel="noreferrer">
              Published tariff
            </a>
          </>
        ) : null}
      </div>
    </>
  );
}

/** Filed or not — read from the row, never assumed. */
function FilingStateBadge({ report }: { report: ReportState }) {
  if (!report.report) return <Badge status="pending">Not filed</Badge>;
  return <Badge status="confirmed">Filed {formatDate(report.report.filedAt)}</Badge>;
}

/**
 * The second act: writing down that the operator filed.
 *
 * Deliberately BELOW the download and worded as a record of something already
 * done. The button that used to sit here was a disabled "Send directly to STIM"
 * teaser — an affordance that could never work (§7). This one does work, and does
 * something smaller and true.
 */
function RecordFiling({ report }: { report: ReportState }) {
  const filed = report.report;
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <Eyebrow>{filed ? "Filed" : "Once you have sent it"}</Eyebrow>
      {filed ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
          Reported to <strong>{filed.proName}</strong> on {formatDate(filed.filedAt)},{" "}
          {filed.works.length} work{filed.works.length === 1 ? "" : "s"}
          {filed.reference ? (
            <>
              , reference <code>{filed.reference}</code>
            </>
          ) : null}
          . Filing again replaces this record with an amended one; both are kept in the audit log.
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
          shoWMe cannot submit to {report.societyName} — download the report above and send it
          yourself. Then record it here so this show stops saying “Not filed”.{" "}
          <strong>Recording is a note to yourself; nothing is transmitted.</strong>
        </div>
      )}
      <TextField
        label={`${report.societyName} reference (optional)`}
        value={report.reference}
        onChange={(event) => report.setReference(event.target.value)}
        placeholder="The receipt number the society gave you"
      />
      <div>
        <Button variant="secondary" onClick={report.submit} disabled={report.isFiling}>
          <Icon name="check" size={14} />
          {filed ? "Record an amended filing" : `Record that I filed with ${report.societyName}`}
        </Button>
      </div>
    </div>
  );
}

/**
 * The fields a society requires that shoWMe cannot supply — stated as loudly on
 * the screen as in the file itself. An operator who downloads this and sends it
 * unchanged files short, and short filings cost the writers their royalties.
 */
function IncompleteFilingNotice() {
  return (
    <Notice tone="alert">
      <strong>Incomplete — add these before you file.</strong> The export carries the set, the
      durations and the show, but shoWMe does not hold the work credits a society needs. Each one is
      marked <code>NOT CAPTURED</code> in the file:
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--muted)" }}>
        {MISSING_FILING_FIELDS.map((gap) => (
          <li key={gap.field} style={{ marginBottom: 3 }}>
            <span style={{ color: "var(--text)" }}>{gap.field}</span> — {gap.why}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

function Notice({ tone, children }: { tone: "alert"; children: React.ReactNode }) {
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
      <Icon name={tone} size={16} />
      <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.6 }}>{children}</div>
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
