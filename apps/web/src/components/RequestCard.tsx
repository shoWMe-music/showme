import {
  Avatar,
  type AvatarTone,
  Badge,
  Button,
  Card,
  Icon,
  type Status,
} from "@showme/design-system";
import styles from "./RequestCard.module.css";
import { Eyebrow, FieldCell } from "./primitives";

/** One of the other nights the sender said would also work. `key` is the raw
 * `yyyy-mm-dd` the API takes back; `label` is what a person reads. */
export interface RequestAlternateDate {
  key: string;
  label: string;
}

/** A single booking request, as rendered on the Requests screen (§8).
 * Everything is passed in — this component never fetches. */
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
  /** The night asked for, pre-formatted. Every request names one. */
  wantedDate: string;
  /** "…or any of these", in calendar order. Up to five; usually none. */
  alternateDates: RequestAlternateDate[];
  /** Where the request came in from (e.g. "Public form", "Performer offer"). */
  source: string;
  /** Pre-formatted fee (e.g. "€65,000"). */
  fee: string;
  email?: string;
  /** The draft event this request was turned into ("Create Draft"), if any. */
  draftEventId?: string;
  /**
   * Which half of the action bar applies. A request that has been declined,
   * archived or flagged is not triaged again — the only honest action left is
   * putting it back, and offering "Decline" on a declined request is noise.
   */
  canTriage?: boolean;
  canRestore?: boolean;
  /**
   * Has nobody on this side opened it yet? `undefined` where there is no read
   * state to report at all — a sent offer, whose read mark belongs to the venue
   * that received it and is never disclosed.
   */
  unread?: boolean;
  message?: string;
}

export interface RequestCardProps {
  request: RequestCardData;
  /**
   * `card` — the considered decision, one per request, everything on show.
   * `row` — the same request as a line in a list, for when there are many.
   * The two share one body; only the head differs.
   */
  layout?: "card" | "row";
  /** Whether the body is showing. The screen owns it (`useCardExpansion`). */
  expanded?: boolean;
  onToggleExpanded?: (id: string) => void;
  /** Mark this one read / unread. Absent where there is no read state. */
  onSetRead?: (id: string, read: boolean) => void;
  /** Draft the show on one of the alternate nights the sender offered. */
  onUseAlternateDate?: (id: string, date: string) => void;
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
  layout = "card",
  expanded = true,
  onToggleExpanded,
  onSetRead,
  onUseAlternateDate,
  onViewProfile,
  onCreateDraft,
  onMakeOffer,
  onDecline,
  onBlock,
  onArchive,
  onRestore,
  onOpenDraftEvent,
}: RequestCardProps) {
  const bodyId = `request-body-${request.id}`;
  const body = expanded ? (
    <RequestBody
      id={bodyId}
      request={request}
      onUseAlternateDate={onUseAlternateDate}
      onCreateDraft={onCreateDraft}
      onMakeOffer={onMakeOffer}
      onDecline={onDecline}
      onBlock={onBlock}
      onArchive={onArchive}
      onRestore={onRestore}
      onOpenDraftEvent={onOpenDraftEvent}
    />
  ) : null;

  // Shared by both heads. The FOLD control is not: a row's whole summary line is
  // the disclosure, so only the card needs a chevron button of its own.
  const readToggle = <ReadToggle request={request} layout={layout} onSetRead={onSetRead} />;

  if (layout === "row") {
    return (
      <div className={styles.row}>
        <div className={styles.rowHead}>
          {/* The whole line is the disclosure control — a list is read by
              scanning it and opened by pointing at the line you stopped on.
              The read toggle sits OUTSIDE it, as a sibling: a button inside a
              button is invalid markup and unreachable by keyboard. */}
          <button
            type="button"
            className={`${styles.rowSummary} touch-target`}
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => onToggleExpanded?.(request.id)}
          >
            <Icon
              name="chevron-right"
              size={14}
              style={expanded ? { transform: "rotate(90deg)" } : undefined}
            />
            {/* LABELLED, not aria-hidden: the row has no visible "Unread" text
                for it to duplicate, so the dot is the only thing carrying the
                state — and it says so from inside the summary button, whose
                accessible name is built from its contents. (An sr-only span was
                tried first and is exactly what `mobile-audit` flags: a 1px box
                with `overflow: hidden` around 52px of text is indistinguishable
                from a real clipped row.) */}
            {request.unread && <span className={styles.unreadDot} role="img" aria-label="Unread" />}
            <span className={styles.rowDate}>{request.wantedDate}</span>
            <span className={styles.rowName}>{request.requester}</span>
            {request.alternateDates.length > 0 && (
              <span className={styles.rowAlternates}>+{request.alternateDates.length} dates</span>
            )}
            <Badge status={request.status} dot>
              {request.statusLabel}
            </Badge>
            <span className={styles.rowFee}>{request.fee}</span>
          </button>
          {readToggle}
        </div>
        {body}
      </div>
    );
  }

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className={styles.cardHead}>
        <Avatar initials={request.initials} tone={request.tone ?? "brand"} size={40} />
        <div className={styles.cardHeadBody}>
          {/* Wraps: the name and its status badge share a line for as long as
              there is one, and the badge drops beneath the name rather than
              carrying the card off the side of a phone. */}
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            {request.unread && <span className={styles.unreadDot} aria-hidden="true" />}
            <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--text)" }}>
              {request.requester}
            </span>
            <Badge status={request.status} dot>
              {request.statusLabel}
            </Badge>
            {request.unread && <span className={styles.unreadLabel}>Unread</span>}
          </div>
          {request.contactLine && (
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
              {request.contactLine}
            </div>
          )}
          {/* A folded card still has to say what it is about, or the reader has
              to open every one of them to find the night they are looking for. */}
          {!expanded && (
            <div className={styles.foldedSummary}>
              {request.wantedDate}
              {request.alternateDates.length > 0 && ` +${request.alternateDates.length}`} ·{" "}
              {request.fee}
            </div>
          )}
        </div>
        <div className={styles.cardHeadActions}>
          {onViewProfile && (
            <Button
              variant="ghost"
              rightIcon={<Icon name="arrow-right" size={14} />}
              onClick={() => onViewProfile(request.id)}
            >
              Profile
            </Button>
          )}
          {readToggle}
          <ExpandToggle
            request={request}
            expanded={expanded}
            bodyId={bodyId}
            onToggle={onToggleExpanded}
          />
        </div>
      </div>
      {body}
    </Card>
  );
}

/**
 * Read / unread, per request, as an explicit act.
 *
 * The screen does NOT mark on open, and the reason is in `Requests.tsx`. The
 * vocabulary is the notification bell's — "Mark all read" lives in the header
 * beside it — so the app has one way of saying this rather than two.
 */
function ReadToggle({
  request,
  layout,
  onSetRead,
}: {
  request: RequestCardData;
  layout: "card" | "row";
  onSetRead?: (id: string, read: boolean) => void;
}) {
  // No handler, or no read state at all (a sent offer): no control.
  if (!onSetRead || request.unread === undefined) return null;
  const label = request.unread ? "Mark read" : "Mark unread";
  return (
    <Button
      variant="ghost"
      aria-label={`${label} — ${request.requester}`}
      title={label}
      leftIcon={<Icon name={request.unread ? "eye" : "eye-off"} size={15} />}
      onClick={() => onSetRead(request.id, Boolean(request.unread))}
    >
      {layout === "card" ? label : undefined}
    </Button>
  );
}

/** The card's fold control. The row's is the whole line, so this is card-only. */
function ExpandToggle({
  request,
  expanded,
  bodyId,
  onToggle,
}: {
  request: RequestCardData;
  expanded: boolean;
  bodyId: string;
  onToggle?: (id: string) => void;
}) {
  if (!onToggle) return null;
  return (
    <Button
      variant="ghost"
      aria-expanded={expanded}
      aria-controls={bodyId}
      aria-label={`${expanded ? "Collapse" : "Expand"} the request from ${request.requester}`}
      title={expanded ? "Collapse" : "Expand"}
      onClick={() => onToggle(request.id)}
      leftIcon={
        <Icon
          name="chevron-right"
          size={15}
          style={expanded ? { transform: "rotate(90deg)" } : undefined}
        />
      }
    />
  );
}

/**
 * Everything below the fold, and the same in both layouts — the fields, the
 * nights on offer, the pitch, and the action bar. One body means a request
 * cannot say two different things depending on how the reader chose to list it.
 */
function RequestBody({
  id,
  request,
  onUseAlternateDate,
  onCreateDraft,
  onMakeOffer,
  onDecline,
  onBlock,
  onArchive,
  onRestore,
  onOpenDraftEvent,
}: {
  id: string;
  request: RequestCardData;
  onUseAlternateDate?: (id: string, date: string) => void;
  onCreateDraft?: (id: string) => void;
  onMakeOffer?: (id: string) => void;
  onDecline?: (id: string) => void;
  onBlock?: (id: string) => void;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onOpenDraftEvent?: (eventId: string) => void;
}) {
  // Default true so the outgoing view, which passes no handlers at all, keeps
  // behaving exactly as before.
  const canTriage = request.canTriage ?? true;
  const canRestore = request.canRestore ?? false;
  /**
   * An alternate is only worth CHOOSING while the show can still be drafted on
   * it. Once a draft exists the date is settled on the event, and once the
   * request is declined or archived there is nothing to draft — so the same
   * dates render as plain text rather than as a button that would either 409 or
   * quietly contradict the row's status.
   */
  const canChooseDate = Boolean(onUseAlternateDate) && canTriage && !request.draftEventId;

  return (
    <div id={id} className={styles.body}>
      <div className={styles.fields}>
        <FieldCell label="Wanted date" value={request.wantedDate} />
        <FieldCell label="Source" value={request.source} />
        <FieldCell label="Fee" value={request.fee} />
        {request.email && <FieldCell label="Email" value={request.email} />}
      </div>

      {request.alternateDates.length > 0 && (
        <div className={styles.alternates}>
          <Eyebrow>Would also work</Eyebrow>
          <div className={styles.alternateList}>
            {request.alternateDates.map((date) =>
              canChooseDate ? (
                <button
                  key={date.key}
                  type="button"
                  className={`${styles.alternate} ${styles.alternateAction} touch-target`}
                  title={`Draft the show on ${date.label}`}
                  onClick={() => onUseAlternateDate?.(request.id, date.key)}
                  data-testid="request-alternate-date"
                >
                  <Icon name="calendar" size={13} />
                  {date.label}
                </button>
              ) : (
                <span key={date.key} className={styles.alternate}>
                  <Icon name="calendar" size={13} />
                  {date.label}
                </span>
              ),
            )}
          </div>
          {canChooseDate && (
            <p className={styles.alternateHint}>
              Pick one to open Create Draft on that night instead.
            </p>
          )}
        </div>
      )}

      {request.message && (
        <div className={styles.message}>
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
          className={styles.draftLink}
          style={{ cursor: onOpenDraftEvent ? "pointer" : "default" }}
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
    </div>
  );
}
