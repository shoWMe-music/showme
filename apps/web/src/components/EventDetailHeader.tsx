import {
  Avatar,
  type AvatarTone,
  Badge,
  Button,
  Icon,
  Select,
  type Status,
  Toggle,
} from "@showme/design-system";
import { type EventStatusStage, EventStatusTimeline } from "./EventStatusTimeline";

/** The shared event-detail masthead (§3b): title + code + status pill, a
 * publish toggle, a currency select, invite/share actions, an identity sub-row
 * (performer · venue · date), and the status timeline — so every event tab
 * shares one header. Presentational; controls emit callbacks.
 *
 * NOTE — this composite is not the header the app renders. `routes/EventDetail.tsx`
 * draws its own masthead inline and never mounts this one, so `onShareExport`
 * here has no caller. The live Share & Export button, and the dialog behind it
 * (`ShareExportModal`), are in that file. Keeping the prop so the two headers
 * stay the same shape, but the wiring that matters is there, not here. */
export interface EventParty {
  name: string;
  initials: string;
  tone?: AvatarTone;
}

export interface EventDetailHeaderProps {
  title: string;
  code: string;
  status: Status;
  statusLabel: string;
  published: boolean;
  onPublishChange?: (next: boolean) => void;
  currency: string;
  currencyOptions?: string[];
  onCurrencyChange?: (currency: string) => void;
  performer?: EventParty;
  venue?: EventParty;
  dateLabel?: string;
  stages: EventStatusStage[];
  currentStage: string;
  onInviteCollaborator?: () => void;
  onShareExport?: () => void;
  onOverflow?: () => void;
}

export function EventDetailHeader({
  title,
  code,
  status,
  statusLabel,
  published,
  onPublishChange,
  currency,
  currencyOptions,
  onCurrencyChange,
  performer,
  venue,
  dateLabel,
  stages,
  currentStage,
  onInviteCollaborator,
  onShareExport,
  onOverflow,
}: EventDetailHeaderProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: 30,
                color: "var(--text)",
              }}
            >
              {title}
            </h1>
            <Badge status={status} dot>
              {statusLabel}
            </Badge>
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
            {code}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name={published ? "eye" : "eye-off"} size={16} />
            <Toggle
              checked={published}
              onChange={onPublishChange}
              label={published ? "Published" : "Unpublished"}
            />
          </span>
          <div style={{ width: 116 }}>
            <Select
              value={currency}
              onChange={(value) => onCurrencyChange?.(value)}
              options={currencyOptions ?? [currency]}
              aria-label="Display currency"
            />
          </div>
          {onInviteCollaborator && (
            <Button
              variant="secondary"
              leftIcon={<Icon name="user" size={14} />}
              onClick={onInviteCollaborator}
            >
              Invite
            </Button>
          )}
          {onShareExport && (
            <Button
              variant="secondary"
              leftIcon={<Icon name="share" size={14} />}
              onClick={onShareExport}
            >
              Share & Export
            </Button>
          )}
          {onOverflow && (
            <button
              type="button"
              aria-label="More actions"
              onClick={onOverflow}
              style={overflowButtonStyle}
            >
              <Icon name="dots-vertical" size={16} />
            </button>
          )}
        </div>
      </div>

      {(performer || venue || dateLabel) && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {performer && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Avatar initials={performer.initials} tone={performer.tone ?? "brand"} size={24} />
              <span style={{ color: "var(--text)", fontSize: 13 }}>{performer.name}</span>
            </span>
          )}
          {venue && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Avatar initials={venue.initials} tone={venue.tone ?? "amber"} size={24} />
              <span style={{ color: "var(--text)", fontSize: 13 }}>{venue.name}</span>
            </span>
          )}
          {dateLabel && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
              {dateLabel}
            </span>
          )}
        </div>
      )}

      <EventStatusTimeline stages={stages} current={currentStage} />
    </div>
  );
}

const overflowButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 34,
  height: 34,
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "var(--control-surface)",
  color: "var(--muted)",
  cursor: "pointer",
} as const;
