import { Button, Icon } from "@showme/design-system";
import { useState } from "react";
import { RiderUploadModal } from "./RiderUploadModal";
import { CardHeader, MonoPill, SectionCard } from "./eventUi";
import { useRiderUpload } from "./useRiderUpload";

/** One rider as this card draws it — name plus its kind, nothing more. */
export interface RiderRow {
  id: string;
  name: string;
  type: string;
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
  const upload = useRiderUpload(eventId);

  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="file" size={17} />}
        iconColor="#EE5746"
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
            <div
              key={rider.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "13px 16px",
              }}
            >
              <Icon name="file" size={18} />
              <span style={{ flex: 1, minWidth: 0, color: "var(--text)", fontSize: 13.5 }}>
                {rider.name}
              </span>
              <MonoPill>{rider.type}</MonoPill>
            </div>
          ))}
        </div>
      )}
      <RiderUploadModal open={open} onClose={() => setOpen(false)} view={upload} />
    </SectionCard>
  );
}
