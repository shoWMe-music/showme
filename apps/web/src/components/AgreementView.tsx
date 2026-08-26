import { Badge, Button, Card, Icon, KeyValueRow } from "@showme/design-system";
import { type ScheduleEntry, ScheduleList } from "./ScheduleList";
import { Eyebrow } from "./primitives";

/** The consolidated Deal / Agreement view (§3b, §15.A): event summary + deal
 * structure + production schedule. `frozen` renders the immutable "all parties
 * confirmed" record; otherwise the same layout reads as an editable draft.
 * Presentational — editing is delegated to the screen; this renders the record. */
export interface AgreementField {
  label: string;
  value: string;
}

export interface AgreementViewProps {
  /** Event summary grid — Event, Date, Performer, Venue, Capacity, Operator, Status. */
  summary: AgreementField[];
  /** Deal structure rows — Deal Type, Cost Split, etc. */
  dealStructure: AgreementField[];
  schedule?: ScheduleEntry[];
  frozen?: boolean;
  confirmationLabel?: string;
  /**
   * What the badge says while the terms are NOT frozen. Defaults to "Draft —
   * editable", which is only true of a deal nobody has been sent yet: once it is
   * out for confirmation the terms are still live, but calling that a draft
   * contradicts the agreement status shown beside it.
   */
  draftLabel?: string;
  onExportPdf?: () => void;
}

export function AgreementView({
  summary,
  dealStructure,
  schedule,
  frozen = false,
  confirmationLabel = "All parties confirmed",
  draftLabel = "Draft — editable",
  onExportPdf,
}: AgreementViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        {frozen ? (
          <Badge status="confirmed" dot>
            {confirmationLabel}
          </Badge>
        ) : (
          <Badge status="draft" dot>
            {draftLabel}
          </Badge>
        )}
        {onExportPdf && (
          <Button
            variant="secondary"
            leftIcon={<Icon name="download" size={14} />}
            onClick={onExportPdf}
          >
            Share & Export
          </Button>
        )}
      </div>

      <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Eyebrow>Event summary</Eyebrow>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "2px 24px",
          }}
        >
          {summary.map((field) => (
            <KeyValueRow key={field.label} label={field.label} value={field.value} />
          ))}
        </div>
      </Card>

      <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Eyebrow>Deal structure</Eyebrow>
        {dealStructure.map((field) => (
          <KeyValueRow key={field.label} label={field.label} value={field.value} />
        ))}
      </Card>

      {schedule && schedule.length > 0 && (
        <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Eyebrow>Production schedule</Eyebrow>
          <ScheduleList entries={schedule} />
        </Card>
      )}
    </div>
  );
}
