import { useEffect } from "react";

/**
 * Open the event's invite modal on a role the caller already chose.
 *
 * The modal is reached from two places that mean different things. The header's
 * "Invite Collaborator" is an open question — who is joining, and as what — so it
 * opens on the default role. The Team / Crew tab's "+ Add Member" is not: the
 * operator is standing in the crew list and has already said crew. Making them
 * pick "Crew" out of the role list again is asking a question they answered by
 * pressing the button.
 *
 * It is a PRESET, not a lock: the role select is still there and still theirs to
 * change. Kept as its own hook so the modal stays presentational — the reset that
 * this rides on top of lives in `useEventCollaboratorInvite`, which runs its
 * effect first because it is called first.
 */
export function useEventInviteRolePreset(
  open: boolean,
  initialRole: string | undefined,
  setRole: (role: string) => void,
): void {
  useEffect(() => {
    if (!open || !initialRole) return;
    setRole(initialRole);
  }, [open, initialRole, setRole]);
}
