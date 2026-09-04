import { usePatchApiV1ProfilesIdMembersMid } from "@showme/api-client";
import { Button, Modal, Select, TextField } from "@showme/design-system";
import { type FormEvent, useEffect, useState } from "react";
import { errorMessage } from "../lib/errors";
import { Callout, ROLE_OPTIONS } from "./TeamInviteMemberModal";
import { Eyebrow } from "./primitives";

/**
 * Editing an existing account member — the second half of the roster layer in
 * docs/decisions.md #12 (invite adds a row, this changes one). It edits exactly
 * what `PATCH /profiles/:id/members/:mid` accepts: the display name and the
 * role. Two server rules shape it:
 *
 * - The OWNER row is refused outright, so the caller never opens this on one.
 * - Promoting to `admin` runs the A-37 entitlement gate and will refuse on a
 *   free plan. The refusal is kept inline, with the typed values intact, for
 *   the same reason the invite modal keeps it: it answers a question the user
 *   just asked and must survive being read twice.
 */

export interface TeamMemberEditTarget {
  profileId: string;
  memberId: string;
  name: string;
  /** Their current `profile_members.role`, so the select opens on the truth. */
  role: string;
  /** The name shown on the roster row when the member row carries none. */
  displayName: string | null;
}

export interface TeamMemberEditModalProps {
  open: boolean;
  member: TeamMemberEditTarget | null;
  onClose: () => void;
  /** Fired after a successful save so the screen can refetch that roster. */
  onSaved: (saved: { profileId: string }) => void;
}

function useTeamMemberEdit({
  open,
  member,
  onSaved,
}: Pick<TeamMemberEditModalProps, "open" | "member" | "onSaved">) {
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const patchMember = usePatchApiV1ProfilesIdMembersMid();

  // Every open describes a different person — a refusal left over from the last
  // one would be an explanation of someone else's failed save.
  useEffect(() => {
    if (!open || !member) return;
    setDisplayName(member.displayName ?? "");
    setRole(member.role);
    setRefusal(null);
  }, [open, member]);

  async function submit(formEvent?: FormEvent) {
    formEvent?.preventDefault();
    if (!member) return;
    setRefusal(null);
    const trimmedName = displayName.trim();
    // The <Select> hands back a plain string; this is where it becomes a role
    // the API's enum accepts, or nothing at all.
    const nextRole = ROLE_OPTIONS.find((option) => option.value === role)?.value;
    try {
      await patchMember.mutateAsync({
        id: member.profileId,
        mid: member.memberId,
        data: {
          ...(nextRole && nextRole !== member.role ? { role: nextRole } : {}),
          // A cleared field means "no stored name", which the API models as null
          // — sending "" would fail its `min(1)`.
          ...(trimmedName !== (member.displayName ?? "")
            ? { displayName: trimmedName || null }
            : {}),
        },
      });
    } catch (error) {
      setRefusal(errorMessage(error, "Couldn't save the member."));
      return;
    }
    onSaved({ profileId: member.profileId });
  }

  const unchanged =
    member != null && role === member.role && displayName.trim() === (member.displayName ?? "");

  return {
    displayName,
    setDisplayName,
    role,
    setRole,
    refusal,
    submit,
    unchanged,
    pending: patchMember.isPending,
  };
}

export function TeamMemberEditModal({ open, member, onClose, onSaved }: TeamMemberEditModalProps) {
  const edit = useTeamMemberEdit({ open, member, onSaved });
  const selectedRole = ROLE_OPTIONS.find((option) => option.value === edit.role);
  const promotingToAdmin = edit.role === "admin" && member?.role !== "admin";

  return (
    <Modal
      dismissOnScrim={false}
      open={open && member !== null}
      onClose={onClose}
      title="Edit member"
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => edit.submit()}
            disabled={edit.pending || edit.unchanged}
          >
            {edit.pending ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <form onSubmit={edit.submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={paragraphStyle}>
          Changing what <strong style={{ color: "var(--text)" }}>{member?.name}</strong> may do on
          this account. They keep any group they are on either way.
        </p>
        <TextField
          label="Name"
          value={edit.displayName}
          placeholder="Who are they?"
          onChange={(changeEvent) => edit.setDisplayName(changeEvent.target.value)}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Eyebrow>Role</Eyebrow>
          <Select
            value={edit.role}
            onChange={edit.setRole}
            options={ROLE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            aria-label="Role"
          />
          {selectedRole && <span style={hintStyle}>{selectedRole.description}</span>}
        </div>
        {edit.refusal && (
          <Callout tone="danger">
            <span style={{ display: "block", fontWeight: 600 }}>{edit.refusal}</span>
            {promotingToAdmin && (
              <span style={{ display: "block", marginTop: 4 }}>
                Admin is the one role that consumes a seat. Viewer, Editor and Crew are included on
                every plan — pick one of those, or upgrade this account's plan.
              </span>
            )}
          </Callout>
        )}
        <button type="submit" hidden aria-hidden />
      </form>
    </Modal>
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
