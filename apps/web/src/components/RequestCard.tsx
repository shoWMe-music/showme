import {
  Avatar,
  type AvatarTone,
  Badge,
  Button,
  Card,
  Icon,
  type Status,
} from "@showme/design-system";
import { Eyebrow, FieldCell } from "./primitives";

/** A single inbound booking request, as rendered on the Incoming Requests
 * screen (§8). Everything is passed in — this component never fetches. */
export interface RequestCardData {
  id: string;
  /** Requesting profile / artist name (e.g. "Jon Hopkins"). */
  requester: string;
  initials: string;
  tone?: AvatarTone;
  /** "Sarah Voss · Paradigm Agency · 2h ago" sub-line, pre-composed by the screen. */
  contactLine?: string;
  status: Status;
  statusLabel: string;
  wantedDate: string;
  /** Where the request came in from (e.g. "Public form", "Performer offer"). */
  source: string;
  /** Pre-formatted fee (e.g. "€65,000"). */
  fee: string;
  email?: string;
  phone?: string;
  /** Pre-formatted capacity (e.g. "5,000"). */
  capacity?: string;
  message?: string;
}

export interface RequestCardProps {
  request: RequestCardData;
  onViewProfile?: (id: string) => void;
  onCreateDraft?: (id: string) => void;
  onMakeOffer?: (id: string) => void;
  onDecline?: (id: string) => void;
  onBlock?: (id: string) => void;
  onArchive?: (id: string) => void;
}

export function RequestCard({
  request,
  onViewProfile,
  onCreateDraft,
  onMakeOffer,
  onDecline,
  onBlock,
  onArchive,
}: RequestCardProps) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar initials={request.initials} tone={request.tone ?? "brand"} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--text)" }}>
              {request.requester}
            </span>
            <Badge status={request.status} dot>
              {request.statusLabel}
            </Badge>
          </div>
          {request.contactLine && (
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
              {request.contactLine}
            </div>
          )}
        </div>
        {onViewProfile && (
          <Button
            variant="ghost"
            rightIcon={<Icon name="arrow-right" size={14} />}
            onClick={() => onViewProfile(request.id)}
          >
            Profile
          </Button>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 14,
        }}
      >
        <FieldCell label="Wanted date" value={request.wantedDate} />
        <FieldCell label="Source" value={request.source} />
        <FieldCell label="Fee" value={request.fee} />
        {request.capacity && <FieldCell label="Capacity" value={request.capacity} />}
        {request.email && <FieldCell label="Email" value={request.email} />}
        {request.phone && <FieldCell label="Phone" value={request.phone} />}
      </div>

      {request.message && (
        <div
          style={{
            background: "var(--elevated)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <Eyebrow>Message</Eyebrow>
          <p style={{ margin: 0, color: "var(--text)", fontSize: 14, lineHeight: 1.5 }}>
            {request.message}
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {onCreateDraft && (
          <Button variant="secondary" onClick={() => onCreateDraft(request.id)}>
            Create Draft
          </Button>
        )}
        {onMakeOffer && (
          <Button variant="primary" onClick={() => onMakeOffer(request.id)}>
            Make Offer
          </Button>
        )}
        {onDecline && (
          <Button variant="ghost" onClick={() => onDecline(request.id)}>
            Decline
          </Button>
        )}
        {onBlock && (
          <Button variant="ghost" onClick={() => onBlock(request.id)}>
            Block
          </Button>
        )}
        {onArchive && (
          <Button variant="ghost" onClick={() => onArchive(request.id)}>
            Archive
          </Button>
        )}
      </div>
    </Card>
  );
}
