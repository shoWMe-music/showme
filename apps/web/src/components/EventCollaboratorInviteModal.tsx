import { Button, Modal, Select, TextField } from "@showme/design-system";
import type { ReactNode } from "react";
import { Eyebrow } from "./primitives";
import {
  EVENT_COLLABORATOR_ROLES,
  type EventCollaboratorAccess,
  useEventCollaboratorInvite,
} from "./useEventCollaboratorInvite";

/**
 * The event workspace's "Invite Collaborator" — the Claude prototype's
 * `evModal:'invite'` panel (*"They'll get access to this event's workspace and
 * receive an email invite"*, name / email / role, Cancel · Send Invite), rebuilt
 * against the real contract. Two departures from the prototype, both forced by
 * what the platform actually is:
 *
 * 1. The prototype's role list is party KINDS (Venue, Promoter, Festival…). The
 *    real grant is an `event_participants` **role** — see the role catalogue in
 *    `useEventCollaboratorInvite`, which is the enum the API will accept.
 * 2. The prototype has a "From Contacts" tab. Picking a contact still has to end
 *    in an email address on this same body, so it is a second entry path to one
 *    flow rather than a second flow — left out here rather than half-built.
 *
 * Dumb by design: every decision lives in `useEventCollaboratorInvite`.
 */
export interface EventCollaboratorInviteModalProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  /** The admin-grade permission set "Full control" attaches; `null` hides the option. */
  fullControlPermissionSetId: string | null;
}

interface AccessOption {
  value: EventCollaboratorAccess;
  label: string;
  description: string;
}

/**
 * The two grants the web app can honestly offer. "Standard" attaches NO permission
 * set, which is not a downgrade — `baselineCapabilities` gives every role an
 * inalienable floor regardless (decisions #4). "Full control" attaches the host's
 * own admin-grade set, and its price is named in the label rather than discovered
 * as a 403 (audit A-21 — charged to the event host's plan, re-checked on accept).
 */
const ACCESS_OPTIONS: AccessOption[] = [
  {
    value: "standard",
    label: "Standard for the role",
    description:
      "What the role guarantees and nothing more: the event, their schedule, and their own money. Never anyone else's deal, never the budget.",
  },
  {
    value: "full_control",
    label: "Full control — paid plans only",
    description:
      "Everything the host can do on this event: the budget, the settlement, and inviting others. Charged to this event's host plan — a free plan is refused.",
  },
];

export function EventCollaboratorInviteModal({
  open,
  onClose,
  eventId,
  eventTitle,
  fullControlPermissionSetId,
}: EventCollaboratorInviteModalProps) {
  const invite = useEventCollaboratorInvite({ open, eventId, fullControlPermissionSetId });
  const selectedRole = EVENT_COLLABORATOR_ROLES.find((option) => option.value === invite.role);
  const selectedAccess = ACCESS_OPTIONS.find((option) => option.value === invite.access);
  const canSubmit = invite.email.trim().length > 0 && !invite.pending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={invite.sentTo ? "Invitation sent" : "Invite collaborator"}
      width={480}
      footer={
        invite.sentTo ? (
          <>
            <Button variant="ghost" onClick={invite.inviteAnother}>
              Invite someone else
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => invite.submit()} disabled={!canSubmit}>
              {invite.pending ? "Sending…" : "Send invite"}
            </Button>
          </>
        )
      }
    >
      {invite.sentTo ? (
        <p style={paragraphStyle}>
          <strong style={{ color: "var(--text)" }}>{invite.sentTo}</strong> has been invited to{" "}
          {eventTitle} as {selectedRole?.label.toLowerCase() ?? "a collaborator"}. They get an email
          with a join link, and appear on the Collaborators tab once they accept it — nothing is
          granted until they do.
        </p>
      ) : (
        <form
          onSubmit={invite.submit}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <p style={paragraphStyle}>
            They get access to this event's workspace and an email invite. Their own account is
            untouched — this is standing on{" "}
            <strong style={{ color: "var(--text)" }}>{eventTitle}</strong> only.
          </p>
          <TextField
            label="Email"
            type="email"
            value={invite.email}
            placeholder="name@example.com"
            onChange={(changeEvent) => invite.setEmail(changeEvent.target.value)}
            autoFocus
          />
          <TextField
            label="Name (optional)"
            value={invite.name}
            placeholder="Who are they?"
            onChange={(changeEvent) => invite.setName(changeEvent.target.value)}
          />
          <div style={fieldGroupStyle}>
            <Eyebrow>Role on this event</Eyebrow>
            <Select
              value={invite.role}
              onChange={invite.setRole}
              options={EVENT_COLLABORATOR_ROLES.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              aria-label="Role on this event"
            />
            {selectedRole && <span style={hintStyle}>{selectedRole.description}</span>}
          </div>
          {invite.canGrantFullControl && (
            <div style={fieldGroupStyle}>
              <Eyebrow>Access</Eyebrow>
              <Select
                value={invite.access}
                onChange={(value) => invite.setAccess(value as EventCollaboratorAccess)}
                options={ACCESS_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                aria-label="Access"
              />
              {selectedAccess && <span style={hintStyle}>{selectedAccess.description}</span>}
            </div>
          )}
          {invite.refusal && (
            <Callout>
              <span style={{ display: "block", fontWeight: 600 }}>{invite.refusal}</span>
              {invite.access === "full_control" && (
                <span style={{ display: "block", marginTop: 4 }}>
                  Full control is the one grant that costs a plan — it makes them an administrator
                  of this event. Standard access is included on every plan, and you can raise them
                  later once the host account is on a paid plan.
                </span>
              )}
            </Callout>
          )}
          <button type="submit" hidden aria-hidden />
        </form>
      )}
    </Modal>
  );
}

/** An inline refusal that stays put — the user must be able to read it twice. */
function Callout({ children }: { children: ReactNode }) {
  return (
    <output
      style={{
        display: "block",
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid color-mix(in srgb, var(--brand-red) 45%, transparent)",
        background: "color-mix(in srgb, var(--brand-red) 10%, transparent)",
        color: "var(--text)",
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      {children}
    </output>
  );
}

const paragraphStyle = {
  margin: 0,
  color: "var(--muted)",
  fontSize: 13,
  lineHeight: 1.55,
} as const;

const fieldGroupStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
} as const;

const hintStyle = {
  color: "var(--muted)",
  fontSize: 12,
  lineHeight: 1.45,
} as const;
