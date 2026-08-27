import {
  type PatchApiV1EventsIdParticipantsPidBodyRole,
  getGetApiV1EventsIdParticipantsQueryKey,
  useDeleteApiV1EventsIdParticipantsPid,
  usePatchApiV1EventsIdParticipantsPid,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { ConfirmDialogProps } from "../components/ConfirmDialog";
import { useConfirmDialog } from "../components/ConfirmDialog";
import type { EventMenuItem } from "../components/EventRowMenu";
import {
  EVENT_COLLABORATOR_ROLES,
  type EventCollaboratorAccess,
  type EventCollaboratorRoleOption,
  allowsFullControl,
} from "../components/useEventCollaboratorInvite";
import { errorMessage } from "../lib/errors";

/**
 * Changing and removing the people already on an event — the other half of
 * `useEventCollaboratorInvite`, which only ever got them onto it.
 *
 * Both writes are `participants.manage` on the API (`routes/participants.ts`):
 * `PATCH /events/:id/participants/:pid` and a `DELETE` that soft-removes
 * (`status = 'removed'`, never a delete). This hook exists so the Collaborators
 * tab can stay a list of cards: it owns the mutations, the confirm, the edit
 * form's state, and — the part that matters — **which of the two actions is on
 * offer for a given person and why the other one is not**.
 *
 * The refusals are the API's own rules restated, not guesses:
 *
 *  - **The host is the anchor.** `events.host_profile_id` and a `host`
 *    participant row are the same fact, so the route refuses both a role change
 *    and a removal for them. Offering either would be a button whose click is a
 *    403, so the menu says so instead.
 *  - **An agent's standing is a projection.** A booking agent reaches the event
 *    through their representation of a performer (`docs/decisions.md` #14 and the
 *    authorization skill), never through a role somebody typed. Editing that row
 *    by hand would either orphan the delegation or hand an agent co-host
 *    authority the representation never granted, so it is refused here — the API
 *    would happily write it.
 *  - **A soft-removed row is done.** The route keeps no memory of the status it
 *    overwrote, so there is no honest "restore" to offer from this screen.
 */

/** The subset of a serialized participant these actions need. */
export interface EventCollaborator {
  id: string;
  profileId: string;
  role: string;
  status: string;
  /** Present only for a caller who may manage the roster (`serializeParticipant`). */
  permissionSetId?: string | null;
}

/** The open edit form. `null` when nothing is being edited. */
export interface EventCollaboratorEditor {
  /** Whether the modal is on screen — separate from `collaborator`, which
   * outlives the close so the panel is not blanked mid exit-tween. */
  open: boolean;
  displayName: string;
  roleOptions: EventCollaboratorRoleOption[];
  role: string;
  setRole: (role: string) => void;
  /** The selected role's plain-language floor — what they will see regardless. */
  roleDescription: string | null;
  access: EventCollaboratorAccess;
  setAccess: (access: EventCollaboratorAccess) => void;
  /** Whether "Full control" is a grant this role may be given at all. */
  canGrantFullControl: boolean;
  /** They are already on the host's admin bundle — and the route cannot take it
   * back (`permissionSetId` is optional, never nullable), so there is nothing to
   * change and the form says which one way the door swings. */
  hasFullControl: boolean;
  hasChanges: boolean;
  pending: boolean;
  /** The API's own words when it refused the save. */
  refusal: string | null;
  submit: () => void;
  close: () => void;
}

export interface EventCollaboratorActions {
  /** What the card's overflow menu offers for one person. */
  menuItemsFor: (collaborator: EventCollaborator, displayName: string) => EventMenuItem[];
  editor: EventCollaboratorEditor | null;
  confirmDialogProps: ConfirmDialogProps;
}

export interface UseEventCollaboratorsOptions {
  eventId: string;
  /** The event's anchor profile — its participant row is immutable. */
  hostProfileId: string;
  /** The caller holds `participants.manage`. Without it there are no actions. */
  canManage: boolean;
  /**
   * The admin-grade permission set "Full control" attaches — in practice the host
   * participant's own `operator_full` bundle, the only one the web app can name
   * (there is no route to list permission sets). `null` hides the option.
   */
  fullControlPermissionSetId: string | null;
}

export function useEventCollaborators({
  eventId,
  hostProfileId,
  canManage,
  fullControlPermissionSetId,
}: UseEventCollaboratorsOptions): EventCollaboratorActions {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirmation = useConfirmDialog();

  const [editing, setEditing] = useState<{
    collaborator: EventCollaborator;
    displayName: string;
  } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [role, setRole] = useState("");
  const [access, setAccess] = useState<EventCollaboratorAccess>("standard");
  const [refusal, setRefusal] = useState<string | null>(null);

  const refreshRoster = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: getGetApiV1EventsIdParticipantsQueryKey(eventId),
    });
  }, [queryClient, eventId]);

  const patch = usePatchApiV1EventsIdParticipantsPid({
    mutation: {
      onSuccess: () => {
        refreshRoster();
        setEditorOpen(false);
        toast.success("Collaborator updated.");
      },
      // On the form, not only in a toast: a plan refusal ("Full control is a paid
      // feature") is the answer to the question just asked and must stay readable.
      onError: (error) => setRefusal(errorMessage(error, "Couldn't update this collaborator.")),
    },
  });

  const remove = useDeleteApiV1EventsIdParticipantsPid({
    mutation: {
      onSuccess: () => {
        refreshRoster();
        toast.success("Removed from this event.");
      },
      onError: (error) =>
        toast.error(errorMessage(error, "Couldn't remove this collaborator from the event.")),
    },
  });

  // Every open is a fresh form — a role or a refusal left over from the last
  // person edited would describe somebody no longer on screen.
  const collaborator = editing?.collaborator ?? null;
  useEffect(() => {
    if (!editorOpen || !collaborator) return;
    setRole(collaborator.role);
    setAccess(
      collaborator.permissionSetId && collaborator.permissionSetId === fullControlPermissionSetId
        ? "full_control"
        : "standard",
    );
    setRefusal(null);
  }, [editorOpen, collaborator, fullControlPermissionSetId]);

  const openEditor = useCallback((next: EventCollaborator, displayName: string) => {
    setEditing({ collaborator: next, displayName });
    setEditorOpen(true);
  }, []);

  const askToRemove = useCallback(
    (next: EventCollaborator, displayName: string) =>
      confirmation.ask({
        title: "Remove from this event?",
        body: `${displayName} loses access to this event's workspace — its budget, deals, messages and files. Their own account and every other event they are on are untouched, and the history of what they did here stays on the Event History tab.`,
        confirmLabel: "Remove from event",
        destructive: true,
        onConfirm: () => remove.mutate({ id: eventId, pid: next.id }),
      }),
    [confirmation.ask, remove, eventId],
  );

  const menuItemsFor = useCallback(
    (next: EventCollaborator, displayName: string): EventMenuItem[] => {
      if (!canManage) return [];
      const isHost = next.profileId === hostProfileId;
      const isRemoved = next.status === "removed";
      const inFlight =
        (patch.isPending && editing?.collaborator.id === next.id) ||
        (remove.isPending && remove.variables?.pid === next.id);

      const editRefusal = isHost
        ? "The host anchors this event — their role and access are fixed."
        : next.role === "agent"
          ? "An agent stands on this event through the performer they represent, not through a role set here."
          : isRemoved
            ? "They have been removed from this event."
            : inFlight
              ? "Working on it…"
              : undefined;

      const removeRefusal = isHost
        ? "The host cannot be removed from their own event."
        : isRemoved
          ? "Already removed."
          : inFlight
            ? "Working on it…"
            : undefined;

      return [
        {
          key: "edit",
          label: "Edit",
          onSelect: editRefusal ? undefined : () => openEditor(next, displayName),
          refusal: editRefusal,
          hint: editRefusal
            ? undefined
            : "Change their role on this event, and what they may touch.",
        },
        {
          key: "remove",
          label: "Remove",
          onSelect: removeRefusal ? undefined : () => askToRemove(next, displayName),
          refusal: removeRefusal,
          hint: removeRefusal
            ? undefined
            : "Takes away their access. Nothing they did here is deleted.",
        },
      ];
    },
    [
      canManage,
      hostProfileId,
      patch.isPending,
      remove.isPending,
      remove.variables,
      editing,
      openEditor,
      askToRemove,
    ],
  );

  const editor: EventCollaboratorEditor | null = editing && {
    open: editorOpen,
    displayName: editing.displayName,
    // The invite modal's catalogue, so the two surfaces name the same roles the
    // same way. `host` and `agent` are absent from it by design — and both are
    // refused above, so an edit form never opens needing one.
    roleOptions: EVENT_COLLABORATOR_ROLES,
    role,
    setRole,
    roleDescription:
      EVENT_COLLABORATOR_ROLES.find((option) => option.value === role)?.description ?? null,
    access,
    setAccess,
    canGrantFullControl: allowsFullControl(role) && fullControlPermissionSetId !== null,
    hasFullControl:
      editing.collaborator.permissionSetId != null &&
      editing.collaborator.permissionSetId === fullControlPermissionSetId,
    hasChanges:
      role !== editing.collaborator.role ||
      (access === "full_control" &&
        editing.collaborator.permissionSetId !== fullControlPermissionSetId),
    pending: patch.isPending,
    refusal,
    submit: () => {
      setRefusal(null);
      patch.mutate({
        id: eventId,
        pid: editing.collaborator.id,
        data: {
          // The catalogue offered above is a strict subset of the route's role
          // enum (it drops `host` and `agent`), so a selected value is always one
          // the API accepts — the enum is just not carried through `Select`.
          ...(role !== editing.collaborator.role
            ? { role: role as PatchApiV1EventsIdParticipantsPidBodyRole }
            : {}),
          // Only ever SENT when it is being raised. The route takes
          // `permissionSetId` as optional-not-nullable, so "standard" is the
          // absence of a value rather than a value meaning none — sending the
          // current id back would just re-charge the same entitlement gate.
          ...(access === "full_control" && fullControlPermissionSetId
            ? { permissionSetId: fullControlPermissionSetId }
            : {}),
        },
      });
    },
    close: () => setEditorOpen(false),
  };

  return { menuItemsFor, editor, confirmDialogProps: confirmation.dialogProps };
}
