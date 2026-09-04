import { Badge, Button, Icon, KeyValueRow, Select, TextField } from "@showme/design-system";
import type { TeamAccessView, TeamInvitation, TeamMember } from "../hooks/useTeamAccess";
import { TEAM_ROLES } from "../hooks/useTeamAccess";
import { DateText } from "./DateText";
import { Eyebrow } from "./primitives";

/**
 * Settings → Team Access, as a screen that does something.
 *
 * It was a shipped empty state — "Inviting teammates isn't available yet" — above
 * two read-only rows, and it stayed one long enough to be reported as broken
 * rather than unbuilt (ClickUp 86cbaxvqk, "access giving non functional"). The
 * confusing part was that per-EVENT invitation had worked the whole time, so the
 * account-level screen looked like a feature that had stopped working.
 *
 * Three lists, in the order the question gets asked: who is on the account, who
 * has been asked and not answered, and the form for asking somebody new.
 *
 * Dumb by design (CLAUDE.md): every decision — which roles exist, which rows may
 * be changed, what a refusal says — is in `useTeamAccess`.
 */
export function TeamAccessPanel({
  team,
  yourRole,
  accountKind,
}: {
  team: TeamAccessView;
  yourRole: string | null;
  accountKind: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <Eyebrow>Team Access</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
          {yourRole && <KeyValueRow label="Your role" value={roleLabel(yourRole)} />}
          {accountKind && <KeyValueRow label="Account kind" value={titleCase(accountKind)} />}
        </div>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Eyebrow>Members</Eyebrow>
        {team.members.length === 0 ? (
          <p style={noteStyle}>Nobody but you yet.</p>
        ) : (
          team.members.map((member) => <MemberRow key={member.id} member={member} team={team} />)
        )}
      </section>

      {/* Only when there ARE any: an "Invited" heading over nothing reads as a
          list that failed to load rather than an account nobody is waiting on. */}
      {team.invitations.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Eyebrow>Invited, not yet answered</Eyebrow>
          {team.invitations.map((invitation) => (
            <InvitationRow key={invitation.id} invitation={invitation} team={team} />
          ))}
        </section>
      )}

      {team.canManage && <InviteForm team={team} />}
    </div>
  );
}

const noteStyle = { color: "var(--dim)", fontSize: 13, margin: 0 } as const;

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "12px 14px",
} as const;

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

/** The role's own label where we have one, so the rail and the select agree. */
function roleLabel(role: string): string {
  return TEAM_ROLES.find((option) => option.value === role)?.label ?? titleCase(role);
}

/**
 * One member. Their role is a SELECT rather than a label plus an Edit button:
 * there is exactly one thing to change about a membership, and a dialog to change
 * one field is a dialog nobody needed.
 */
function MemberRow({ member, team }: { member: TeamMember; team: TeamAccessView }) {
  const refusal = team.refusalFor(member);
  const busy = team.isWriting(member.id);
  const label = member.displayName ?? member.email ?? "A member";

  return (
    <div style={rowStyle}>
      <Icon name="users" size={16} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5 }}>{label}</div>
        {member.displayName && member.email && (
          <div style={{ color: "var(--dim)", fontSize: 12 }}>{member.email}</div>
        )}
      </div>

      {/* A membership that has not been claimed is a real state — it is what an
          invited-by-email row looks like before the person signs up — so it is
          named rather than left to read as an ordinary member. */}
      {member.status && member.status !== "active" && <Badge>{titleCase(member.status)}</Badge>}

      {refusal ? (
        <span style={{ ...noteStyle, maxWidth: 260, textAlign: "right" }} title={refusal}>
          {roleLabel(member.role)}
        </span>
      ) : (
        <>
          <div style={{ width: 150 }}>
            <Select
              value={member.role}
              onChange={(value) => team.changeRole(member, value)}
              options={TEAM_ROLES.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              aria-label={`Role for ${label}`}
            />
          </div>
          <Button
            variant="ghost"
            onClick={() => team.removeMember(member)}
            disabled={busy}
            title="Take them off this account. Their own account is untouched."
          >
            Remove
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * One outstanding invitation. It is NOT a member row: nothing has been granted
 * until they answer, and drawing it as a member would be the app claiming an
 * access that does not exist yet.
 */
function InvitationRow({
  invitation,
  team,
}: {
  invitation: TeamInvitation;
  team: TeamAccessView;
}) {
  return (
    <div style={{ ...rowStyle, borderStyle: "dashed" }}>
      <Icon name="mail" size={16} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5 }}>
          {invitation.recipientName ?? invitation.recipientEmail ?? "Someone"}
        </div>
        <div style={{ color: "var(--dim)", fontSize: 12 }}>
          {/* `link={false}`: when an invitation was sent is not a day in the
              schedule, so the calendar has nothing to show for it. The house
              date FORMAT still applies — this is exactly the case `DateText`
              documents the flag for. */}
          Asked <DateText value={invitation.createdAt} link={false} />
          {invitation.role ? ` · as ${roleLabel(invitation.role)}` : ""}
        </div>
      </div>
      {team.canManage && (
        <Button
          variant="ghost"
          onClick={() => team.revokeInvitation(invitation)}
          disabled={team.isWriting(invitation.id)}
          title="Withdraw it. The link stops working and they are told it was withdrawn."
        >
          Withdraw
        </Button>
      )}
    </div>
  );
}

/**
 * Asking somebody new.
 *
 * Inline rather than behind a modal: it is three fields, it is the reason most
 * people open this screen, and a dialog would hide the members list the answer
 * is about to join.
 */
function InviteForm({ team }: { team: TeamAccessView }) {
  const { invite } = team;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Eyebrow>Invite someone</Eyebrow>
      <p style={noteStyle}>
        They get an email with a link. Nothing changes on this account until they accept it.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField
          label="Email"
          type="email"
          value={invite.email}
          onChange={(event) => invite.setEmail(event.target.value)}
          placeholder="them@example.com"
        />
        <TextField
          label="Name (optional)"
          value={invite.name}
          onChange={(event) => invite.setName(event.target.value)}
          placeholder="So the email greets them by name"
        />
        <div>
          <Eyebrow>Role</Eyebrow>
          <div style={{ marginTop: 6 }}>
            <Select
              value={invite.role}
              onChange={invite.setRole}
              options={TEAM_ROLES.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              aria-label="Role"
            />
          </div>
          {invite.selectedRole && (
            <span style={{ ...noteStyle, display: "block", marginTop: 6 }}>
              {invite.selectedRole.description}
              {/* Said BEFORE they choose. A seat is a thing the plan sells, so
                  running out of them should be a fact met on the way in rather
                  than a 403 met on the way out. */}
              {invite.selectedRole.consumesSeat && " This role uses one of the account's seats."}
            </span>
          )}
        </div>
      </div>

      {invite.refusal && (
        <p
          style={{
            color: "var(--brand-red)",
            fontSize: 13,
            margin: 0,
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          {invite.refusal}
        </p>
      )}

      <div>
        <Button variant="primary" onClick={invite.send} disabled={!invite.canSend}>
          {invite.sending ? "Sending…" : "Send invitation"}
        </Button>
      </div>
    </section>
  );
}
