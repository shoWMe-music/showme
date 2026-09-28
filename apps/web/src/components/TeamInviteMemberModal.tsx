import { usePostApiV1GroupsGidMembers, usePostApiV1Invitations } from "@showme/api-client";
import { Button, Modal, Select, TextField } from "@showme/design-system";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  type MemberRole,
  TEAM_INVITE_DEFAULT_ROLE,
  TEAM_ROLES,
  seatRefusalHint,
} from "../hooks/useTeamAccess";
import { errorMessage } from "../lib/errors";
import { InviteNameFields, combineName } from "./InviteNameFields";
import { Eyebrow } from "./primitives";

/**
 * Inviting a person onto an ACCOUNT (a profile), which is the first of the three
 * layers in docs/decisions.md #12 — *member (roster) → group (bundle) →
 * participant (event assignment)*. A group is a reusable bundle OF members, so it
 * can never be a precondition for having one: `POST /invitations` with a
 * `targetProfileId` is happily accepted by an account that owns no group at all.
 * The group select here is therefore an optional extra, never a gate.
 *
 * The invitation — not a bare `profile_members` row — is what actually reaches
 * the person: it mints a token, emails it, and `POST /invitations/:token/accept`
 * is the write that confers the membership. An email-only member row would be a
 * contact nobody ever hears from (`claimStubsForEmail` only links UNCLAIMED stub
 * profiles, never a live account's roster).
 */

export interface TeamInviteProfile {
  id: string;
  name: string;
}

export interface TeamInviteGroup {
  id: string;
  name: string;
}

export interface TeamInviteMemberModalProps {
  open: boolean;
  onClose: () => void;
  /** The accounts this user may invite into — one entry for most operators. */
  profiles: TeamInviteProfile[];
  /** Existing roster bundles. May be empty; the invite works without one. */
  groups: TeamInviteGroup[];
  /** The profile already in focus on the screen, pre-selected for convenience. */
  defaultProfileId: string | null;
  /** Fired after a successful invite so the screen can refetch that account's roster. */
  onInvited: (invited: { email: string; profileId: string }) => void;
}

/*
 * THE ROLE CATALOGUE LIVES IN `useTeamAccess.ts`, AND ONLY THERE (QA7-15).
 *
 * This file used to hold a second copy, `ROLE_OPTIONS`, and the two had drifted into
 * three separate falsehoods: it defaulted to `editor` (the first role a free plan
 * refuses), it described Admin as the only role that costs a seat, and its refusal
 * footnote told the reader Editor was included on every plan — inside the message
 * explaining why Editor had just been refused. The API settles it:
 * `SEAT_CONSUMING_ROLES = ["owner", "admin", "editor"]`, one seat on Free, held by the
 * owner. CLAUDE.md's review gate calls this outcome by name: two copies eventually
 * disagree. `TEAM_ROLES` was the correct one, so the copy is gone and its consumers
 * read the catalogue.
 */

const NO_GROUP = "";

function useTeamMemberInvite({
  open,
  profiles,
  defaultProfileId,
  onInvited,
}: Pick<TeamInviteMemberModalProps, "open" | "profiles" | "defaultProfileId" | "onInvited">) {
  const [profileId, setProfileId] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // Widened to `MemberRole`, because the default is one literal and the `<Select>`
  // emits any of them.
  const [role, setRole] = useState<MemberRole>(TEAM_INVITE_DEFAULT_ROLE);
  const [groupId, setGroupId] = useState(NO_GROUP);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [groupProblem, setGroupProblem] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const createInvitation = usePostApiV1Invitations();
  const addGroupMember = usePostApiV1GroupsGidMembers();

  const fallbackProfileId = defaultProfileId ?? profiles[0]?.id ?? "";

  // Every open is a fresh invite — a refusal or a "sent" panel left over from
  // last time would describe someone who is no longer on screen.
  useEffect(() => {
    if (!open) return;
    setProfileId(fallbackProfileId);
    setEmail("");
    setFirstName("");
    setLastName("");
    setRole(TEAM_INVITE_DEFAULT_ROLE);
    setGroupId(NO_GROUP);
    setRefusal(null);
    setGroupProblem(null);
    setSentTo(null);
  }, [open, fallbackProfileId]);

  async function submit(formEvent?: FormEvent) {
    formEvent?.preventDefault();
    const recipientEmail = email.trim();
    if (!profileId || !recipientEmail) return;
    setRefusal(null);
    setGroupProblem(null);

    // Two fields, one column: `invitations.recipient_name` stores the whole name
    // (see InviteNameFields — the split is presentational).
    const recipientName = combineName(firstName, lastName);
    try {
      await createInvitation.mutateAsync({
        data: {
          type: "profile_member",
          source: "team",
          targetProfileId: profileId,
          recipientEmail,
          ...(recipientName ? { recipientName } : {}),
          role,
        },
      });
    } catch (error) {
      // Kept in the modal, with the typed values intact — the server's refusal is
      // the answer to a question the user just asked, not a toast to miss.
      setRefusal(errorMessage(error, "Couldn't send the invitation."));
      return;
    }

    // The optional bundle. Its failure must not read as the invite failing: the
    // membership is already granted-in-waiting by the time we get here.
    if (groupId) {
      try {
        await addGroupMember.mutateAsync({ gid: groupId, data: { email: recipientEmail } });
      } catch (error) {
        setGroupProblem(errorMessage(error, "Couldn't add them to the group."));
      }
    }

    setSentTo(recipientEmail);
    onInvited({ email: recipientEmail, profileId });
  }

  function inviteAnother() {
    setEmail("");
    setFirstName("");
    setLastName("");
    setSentTo(null);
    setGroupProblem(null);
  }

  return {
    profileId,
    setProfileId,
    email,
    setEmail,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    role,
    setRole,
    groupId,
    setGroupId,
    refusal,
    groupProblem,
    sentTo,
    submit,
    inviteAnother,
    pending: createInvitation.isPending || addGroupMember.isPending,
  };
}

export function TeamInviteMemberModal({
  open,
  onClose,
  profiles,
  groups,
  defaultProfileId,
  onInvited,
}: TeamInviteMemberModalProps) {
  const invite = useTeamMemberInvite({ open, profiles, defaultProfileId, onInvited });
  const selectedRole = TEAM_ROLES.find((option) => option.value === invite.role);
  const targetProfile = profiles.find((profile) => profile.id === invite.profileId);
  const canSubmit = Boolean(invite.profileId) && invite.email.trim().length > 0 && !invite.pending;

  return (
    <Modal
      dismissOnScrim={false}
      open={open}
      onClose={onClose}
      title={invite.sentTo ? "Invitation sent" : "Invite member"}
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
      {profiles.length === 0 ? (
        <p style={paragraphStyle}>
          You need a profile before anyone can be invited into it — a member is a member OF an
          account. Create one on the Profiles screen, then invite your team here.
        </p>
      ) : invite.sentTo ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={paragraphStyle}>
            <strong style={{ color: "var(--text)" }}>{invite.sentTo}</strong> has been invited to{" "}
            {targetProfile?.name ?? "your account"} as{" "}
            {selectedRole?.label.toLowerCase() ?? "a member"}. They get an email with a join link,
            and appear in the roster below once they accept it.
          </p>
          {invite.groupProblem && (
            <Callout tone="warning">
              The invitation was sent, but adding them to the group failed: {invite.groupProblem}
            </Callout>
          )}
        </div>
      ) : (
        <form
          onSubmit={invite.submit}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          {profiles.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Eyebrow>Account</Eyebrow>
              <Select
                value={invite.profileId}
                onChange={invite.setProfileId}
                options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
                aria-label="Account"
              />
            </div>
          )}
          <TextField
            label="Email"
            type="email"
            value={invite.email}
            placeholder="name@example.com"
            onChange={(changeEvent) => invite.setEmail(changeEvent.target.value)}
            autoFocus
          />
          <InviteNameFields
            firstName={invite.firstName}
            lastName={invite.lastName}
            onFirstNameChange={invite.setFirstName}
            onLastNameChange={invite.setLastName}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Eyebrow>Role</Eyebrow>
            <Select
              value={invite.role}
              // The options below ARE `TEAM_ROLES`, so every value this can emit is a
              // `MemberRole` — the narrowing is what lets the invite body satisfy the
              // API's enum without a cast at the request itself.
              onChange={(next) => invite.setRole(next as MemberRole)}
              options={TEAM_ROLES.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              aria-label="Role"
            />
            {selectedRole && (
              <span style={hintStyle}>
                {selectedRole.description}
                {/* Said BEFORE they choose, the same way the Team access panel says it:
                    a seat is a thing the plan sells, so running out should be a fact met
                    on the way in rather than a 403 met on the way out. */}
                {selectedRole.consumesSeat && " This role uses one of the account's seats."}
              </span>
            )}
          </div>
          {groups.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Eyebrow>Group (optional)</Eyebrow>
              <Select
                value={invite.groupId}
                onChange={invite.setGroupId}
                options={[
                  { value: NO_GROUP, label: "No group" },
                  ...groups.map((group) => ({ value: group.id, label: group.name })),
                ]}
                aria-label="Group"
              />
              <span style={hintStyle}>
                Groups are reusable rosters you assign to an event in one go. Optional — they can
                join one later.
              </span>
            </div>
          )}
          {invite.refusal && (
            <Callout tone="danger">
              <span style={{ display: "block", fontWeight: 600 }}>{invite.refusal}</span>
              {selectedRole?.consumesSeat && (
                <span style={{ display: "block", marginTop: 4 }}>{seatRefusalHint()}</span>
              )}
            </Callout>
          )}
          <button type="submit" hidden aria-hidden />
        </form>
      )}
    </Modal>
  );
}

/** An inline explanation that stays put — a refusal the user must be able to read twice. */
export function Callout({ tone, children }: { tone: "danger" | "warning"; children: ReactNode }) {
  const color = tone === "danger" ? "var(--brand-red)" : "var(--brand-amber)";
  return (
    <output
      style={{
        display: "block",
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
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

const hintStyle = {
  color: "var(--muted)",
  fontSize: 12,
  lineHeight: 1.45,
} as const;
