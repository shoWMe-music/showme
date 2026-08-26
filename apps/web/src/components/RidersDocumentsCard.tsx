import { Button, Icon } from "@showme/design-system";
import { useState } from "react";
import { RiderPreviewModal } from "./RiderPreviewModal";
import { RiderUploadModal } from "./RiderUploadModal";
import styles from "./eventDetailsFields.module.css";
import { CardHeader, MonoPill, SectionCard } from "./eventUi";
import { Eyebrow } from "./primitives";
import { useRiderPreview } from "./useRiderPreview";
import { useRiderUpload } from "./useRiderUpload";

/**
 * One rider as this card draws it — its name, its kind, and whether there is
 * anything to READ behind it.  is null for a rider that is only written
 * down, which is what decides whether the row is a button at all.
 */
export interface RiderRow {
  id: string;
  name: string;
  type: string;
  description: string | null;
  file: { name: string; contentType: string | null; sizeBytes: number | null } | null;
}

export interface RidersDocumentsCardProps {
  eventId: string;
  riders: RiderRow[];
}

/**
 * The event's riders, and the button that adds one.
 *
 * The Upload button used to be permanently disabled with a tooltip explaining
 * that the flow "has no screen yet" — an honest note that had outlived its
 * honesty, because to a performer it read as "riders cannot upload". It now does
 * the real thing (`useRiderUpload`: file → library rider → attached instance).
 *
 * It is still disabled for the OPERATOR, and that part was always right: a rider
 * is the act's own document (decisions #12), so the host has none of their own to
 * submit and `rider.submit` is deliberately absent from their preset. The
 * difference is that the button is now disabled for a reason about WHO IS LOOKING
 * rather than about what the app hasn't built.
 */
export function RidersDocumentsCard({ eventId, riders }: RidersDocumentsCardProps) {
  const [open, setOpen] = useState(false);
  const preview = useRiderPreview(eventId, riders);
  const upload = useRiderUpload(eventId);

  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="file" size={17} />}
        iconColor="var(--brand-red)"
        title="Riders & Documents"
        action={
          <Button
            variant="ghost"
            disabled={!upload.canSubmit}
            title={
              upload.canSubmit
                ? "Attach a rider from a file"
                : "Riders are attached by the act on the bill — a performer, their agent, or their crew. As the operator you receive them, you don't submit them."
            }
            leftIcon={<Icon name="upload" size={14} />}
            onClick={() => setOpen(true)}
          >
            Upload
          </Button>
        }
      />
      {riders.length === 0 ? (
        <div style={{ color: "var(--dim)", fontSize: 13 }}>No riders or documents yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {riders.map((rider) => (
            <RiderListRow key={rider.id} rider={rider} onOpen={() => preview.open(rider.id)} />
          ))}
        </div>
      )}
      <RiderUploadModal open={open} onClose={() => setOpen(false)} view={upload} />
      <RiderPreviewModal
        rider={preview.rider}
        kind={preview.kind}
        url={preview.url}
        isPending={preview.isPending}
        error={preview.error}
        onClose={preview.close}
      />
    </SectionCard>
  );
}

const riderRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  textAlign: "left",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "13px 16px",
  background: "transparent",
  color: "var(--text)",
} as const;

/**
 * One rider in the list. It is a BUTTON when there is something to read — the
 * document, or the notes standing in for one — and a plain row when the rider
 * carries neither, because a control that opens an empty modal spends the
 * reader's trust for nothing (STYLE-GUIDE §7).
 */
function RiderListRow({ rider, onOpen }: { rider: RiderRow; onOpen: () => void }) {
  const readable = rider.file !== null || Boolean(rider.description);
  const label = (
    <>
      <Icon name="file" size={18} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{rider.name}</span>
      {rider.file === null && <Eyebrow>No file</Eyebrow>}
      <MonoPill>{rider.type}</MonoPill>
    </>
  );

  if (!readable) {
    return <div style={{ ...riderRowStyle, color: "var(--muted)" }}>{label}</div>;
  }
  return (
    <button type="button" className={styles.riderRow} style={riderRowStyle} onClick={onOpen}>
      {label}
    </button>
  );
}
