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
  /** The draft event this request was turned into ("Create Draft"), if any. */
  draftEventId?: string;
  /**
   * Which half of the action bar applies. A request that has been declined,
   * archived or flagged is not triaged again — the only honest action left is
   * putting it back, and offering "Decline" on a declined request is noise.
   */
  canTriage?: boolean;
  canRestore?: boolean;
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
  /** Back to pending, from declined/archived/flagged. */
  onRestore?: (id: string) => void;
  /** Open the draft event this request already produced. */
  onOpenDraftEvent?: (eventId: string) => void;
}

export function RequestCard({
  request,
  onViewProfile,
  onCreateDraft,
  onMakeOffer,
  onDecline,
  onBlock,
  onArchive,
  onRestore,
  onOpenDraftEvent,
}: RequestCardProps) {
  // Default true so the existing callers (and the outgoing view, which passes no
  // handlers at all) keep behaving exactly as before.
  const canTriage = request.canTriage ?? true;
  const canRestore = request.canRestore ?? false;
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

      {request.draftEventId && (
        <button
          type="button"
          onClick={() => onOpenDraftEvent?.(request.draftEventId as string)}
          disabled={!onOpenDraftEvent}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            alignSelf: "flex-start",
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "var(--elevated)",
            color: "var(--text)",
            fontSize: 12.5,
            cursor: onOpenDraftEvent ? "pointer" : "default",
          }}
        >
          <Icon name="calendar" size={14} />
          Draft event created
        </button>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {canTriage && onCreateDraft && !request.draftEventId && (
          <Button variant="secondary" onClick={() => onCreateDraft(request.id)}>
            Create Draft
          </Button>
        )}
        {canTriage && onMakeOffer && (
          <Button variant="primary" onClick={() => onMakeOffer(request.id)}>
            Make Offer
          </Button>
        )}
        {canTriage && onDecline && (
          <Button variant="ghost" onClick={() => onDecline(request.id)}>
            Decline
          </Button>
        )}
        {canTriage && onBlock && (
          <Button variant="ghost" onClick={() => onBlock(request.id)}>
            Block
          </Button>
        )}
        {canTriage && onArchive && (
          <Button variant="ghost" onClick={() => onArchive(request.id)}>
            Archive
          </Button>
        )}
        {canRestore && onRestore && (
          <Button variant="secondary" onClick={() => onRestore(request.id)}>
            Restore
          </Button>
        )}
      </div>
    </Card>
  );
}
