import { usePostApiV1Invitations } from "@showme/api-client";
import { type FormEvent, useEffect, useState } from "react";
import { errorMessage } from "../lib/errors";

/**
 * Inviting a person onto ONE EVENT — the third of the three layers in
 * docs/decisions.md #12 (*member → group → participant*), where
 * `TeamInviteMemberModal` covers the first. The target is an event, not an
 * account: `POST /invitations` with a `targetEventId`, and
 * `POST /invitations/:token/accept` writes the `event_participants` row that
 * actually confers the standing. Nothing is granted until they accept.
 */

export interface EventCollaboratorRoleOption {
  value: string;
  label: string;
  description: string;
}

/**
 * The event roles a collaborator may be invited AS — the `event_participants`
 * role enum (`apps/api/src/routes/participants.ts`) minus two, both deliberately:
 *
 * - **`host`** — the event already has one, and hosting is the account that
 *   created the event and carries the residual (story.md, Operator). A second
 *   host is not an invitation, it is a handover.
 * - **`agent`** — an agent participation is the PROJECTION of a representation
 *   (docs/decisions.md #14; the authorization skill). `effectiveEventCapabilities`
 *   skips an `agent` row that no live representation backs, so an invited agent
 *   would redeem into a participant row that grants *nothing* — not even
 *   `event.view`. Booking agents reach an event through their performer, never
 *   through this modal.
 *
 * Descriptions are the plain-language *floor* each role is guaranteed
 * (`baselineCapabilities`, `packages/auth/src/presets.ts`) — what they will see
 * even with no permission set attached, which is what "Standard" grants below.
 */
export const EVENT_COLLABORATOR_ROLES: EventCollaboratorRoleOption[] = [
  {
    value: "co_host",
    label: "Co-host",
    description: "Runs the show with you — another promoter, venue or organizer.",
  },
  {
    value: "performer",
    label: "Performer",
    description: "On the bill. Sees their own deal, settlement, schedule — never anyone else's.",
  },
  {
    value: "support",
    label: "Support act",
    description: "Also on the bill, below the headliner. Same own-slice visibility.",
  },
  {
    value: "crew_lead",
    label: "Crew lead",
    description: "Runs a crew team and may bring their own people. Schedule and their own fee.",
  },
  {
    value: "crew",
    label: "Crew",
    description: "Sound, lights, catering, security. Schedule and their own fee. No budget.",
  },
];

/** Least authority that still reads as "collaborating on this event". */
const DEFAULT_ROLE = "co_host";

export type EventCollaboratorAccess = "standard" | "full_control";

/**
 * Full control is offered ONLY for a co-host. The permission set behind it is the
 * host's own `operator_full` bundle, which carries `participants.manage` — and the
 * ceiling (`isGrantable`, decisions #4) refuses budget visibility to anyone who is
 * not host or co_host anyway, so handing it to a crew member would grant a
 * confusing partial set. PLAN.md:614 draws the paid-plan line at exactly this
 * grant: *"assign `operator_full`/admin permission set to a collaborator"*.
 */
export function allowsFullControl(role: string): boolean {
  return role === "co_host";
}

export interface UseEventCollaboratorInviteOptions {
  open: boolean;
  eventId: string;
  /**
   * The admin-grade permission set to attach when "Full control" is chosen — in
   * practice the host participant's own set, read off `GET /events/:id/participants`
   * (the serializer only returns `permissionSetId` to a caller who may manage the
   * roster). There is no route to LIST or CREATE permission sets, so this is the
   * only honest admin-grade bundle the web app can name. `null` hides the option.
   */
  fullControlPermissionSetId: string | null;
}

export function useEventCollaboratorInvite({
  open,
  eventId,
  fullControlPermissionSetId,
}: UseEventCollaboratorInviteOptions) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(DEFAULT_ROLE);
  const [access, setAccess] = useState<EventCollaboratorAccess>("standard");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const createInvitation = usePostApiV1Invitations();

  // Every open is a fresh invite — a refusal or a "sent" panel left over from last
  // time would describe someone who is no longer on screen.
  useEffect(() => {
    if (!open) return;
    setEmail("");
    setName("");
    setRole(DEFAULT_ROLE);
    setAccess("standard");
    setRefusal(null);
    setSentTo(null);
  }, [open]);

  const canGrantFullControl = allowsFullControl(role) && fullControlPermissionSetId != null;
  // A role that cannot carry full control silently drops back to standard, so the
  // submitted grant is always the one the form is currently describing.
  const effectiveAccess: EventCollaboratorAccess = canGrantFullControl ? access : "standard";

  async function submit(formEvent?: FormEvent) {
    formEvent?.preventDefault();
    const recipientEmail = email.trim();
    if (!recipientEmail) return;
    setRefusal(null);

    const recipientName = name.trim();
    const permissionSetId =
      effectiveAccess === "full_control" ? (fullControlPermissionSetId ?? undefined) : undefined;

    try {
      await createInvitation.mutateAsync({
        data: {
          type: "event_participant",
          source: "collaborator",
          targetEventId: eventId,
          recipientEmail,
          ...(recipientName ? { recipientName } : {}),
          role,
          ...(permissionSetId ? { permissionSetId } : {}),
        },
      });
    } catch (error) {
      // Kept in the modal with the typed values intact — the entitlement refusal
      // (A-21: admin on an event is a paid-plan grant, charged to the event HOST)
      // is the answer to the question the user just asked, not a toast to miss.
      setRefusal(errorMessage(error, "Couldn't send the invitation."));
      return;
    }

    setSentTo(recipientEmail);
  }

  function inviteAnother() {
    setEmail("");
    setName("");
    setSentTo(null);
  }

  return {
    email,
    setEmail,
    name,
    setName,
    role,
    setRole,
    access: effectiveAccess,
    setAccess,
    canGrantFullControl,
    refusal,
    sentTo,
    submit,
    inviteAnother,
    pending: createInvitation.isPending,
  };
}
