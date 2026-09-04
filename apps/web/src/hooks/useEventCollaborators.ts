import {
  type PatchApiV1EventsIdParticipantsPidBodyRole,
  type PatchApiV1EventsIdParticipantsPidBodyStatus,
  getGetApiV1EventsIdParticipantsQueryKey,
  useDeleteApiV1EventsIdParticipantsPid,
  usePatchApiV1EventsIdParticipantsPid,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { confersAdminAuthority } from "@showme/shared";
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
 *  - **A soft-removed row can now come back.** It used to be a dead end: the route
 *    wrote `removed` over the previous status and kept no memory of it, so there
 *    was nothing to restore a row TO. `status_before_removal` (API migration 0037)
 *    keeps it, so Restore puts back the fact rather than guessing at one — and the
 *    menu offers it only when the API actually reported a target.
 */

/** The subset of a serialized participant these actions need. */
export interface EventCollaborator {
  id: string;
  /** Null once the profile behind the row has been erased (API migration 0032):
   *  a name kept on the bill, with no account left to manage. */
  profileId: string | null;
  role: string;
  status: string;
  /** Present only for a caller who may manage the roster (`serializeParticipant`). */
  permissionSetId?: string | null;
  /**
   * The set itself — what it is called and what it GRANTS. Authority is read off
   * `capabilities`, never off the id: two rows can carry the same list, and
   * comparing ids reported the co-host as having no special access at all.
   */
  permissionSet?: {
    id: string;
    name: string;
    capabilities: string[];
    isPreset: boolean;
  };
  /**
   * For a removed row, the status it held before — the restore target. Null on a
   * row that is not removed, and on one removed before the column existed, both
   * of which mean "no undo offered here".
   */
  statusBeforeRemoval?: string | null;
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
  /**
   * They currently hold an admin-grade set — read from what it GRANTS, not from
   * which row it is. Used to describe the standing they arrived with; it no
   * longer decides whether the select appears, because access can now be lowered.
   */
  hasFullControl: boolean;
  /** The name of the set they hold, when they hold one — so the panel can say
   *  "Northlight Presents full" rather than describing a uuid. */
  currentSetName: string | null;
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
   * The admin-grade permission set "Full control" attaches, from
   * `GET /events/:id/permission-sets` via `useEventPermissionSets`. `null` hides
   * the option — which is what a caller who may not read the list sees.
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

  /**
   * The undo. Its own mutation instance rather than a second `onSuccess` on
   * `patch`: react-query runs the hook-level and call-level callbacks BOTH, so
   * reusing `patch` would close the editor nobody opened and fire two toasts —
   * "Collaborator updated" followed by the one that actually says what happened.
   * A restore fails differently too: it belongs in a toast, because there is no
   * form on screen to put the refusal on.
   */
  const restoration = usePatchApiV1EventsIdParticipantsPid({
    mutation: {
      onSuccess: () => {
        refreshRoster();
        toast.success("Back on this event.");
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't restore this collaborator.")),
    },
  });

  // Every open is a fresh form — a role or a refusal left over from the last
  // person edited would describe somebody no longer on screen.
  const collaborator = editing?.collaborator ?? null;
  useEffect(() => {
    if (!editorOpen || !collaborator) return;
    setRole(collaborator.role);
    // From what the set GRANTS, not from which row it is. Comparing ids against
    // the host's called a co-host with an identical `operator_full` bundle
    // "Standard for the role" — see `EventCollaborator.permissionSet`.
    setAccess(
      confersAdminAuthority(collaborator.permissionSet?.capabilities) ? "full_control" : "standard",
    );
    setRefusal(null);
  }, [editorOpen, collaborator]);

  const openEditor = useCallback((next: EventCollaborator, displayName: string) => {
    setEditing({ collaborator: next, displayName });
    setEditorOpen(true);
  }, []);

  const askToRemove = useCallback(
    (next: EventCollaborator, displayName: string) =>
      confirmation.ask({
        title: "Remove from this event?",
        // It now says the removal can be undone, because it can. The dialog used
        // to present a reversible act as a permanent one — not out of caution but
        // because the route kept no memory of the status it overwrote, so there
        // was genuinely no way back (ClickUp 86cbazcc7, item 3).
        body: `${displayName} loses access to this event's workspace — its budget, deals, messages and files. Their own account and every other event they are on are untouched, and the history of what they did here stays on the Event History tab. You can put them back from this menu afterwards.`,
        confirmLabel: "Remove from event",
        destructive: true,
        onConfirm: () => remove.mutate({ id: eventId, pid: next.id }),
      }),
    [confirmation.ask, remove, eventId],
  );

  /**
   * Put a removed collaborator back at the status they held.
   *
   * `statusBeforeRemoval` is the API's own record of it, so this restores the
   * FACT rather than guessing at one — the difference between putting an
   * `invited` row back as invited and silently upgrading it to accepted, which is
   * an answer to an invitation that nobody gave.
   *
   * No confirm. Restoring is the reversible half of a pair whose other half is
   * already confirmed, and asking twice for the undo teaches people to click
   * through dialogs.
   */
  const restore = useCallback(
    (next: EventCollaborator) => {
      if (!next.statusBeforeRemoval) return;
      restoration.mutate({
        id: eventId,
        pid: next.id,
        // The status the API recorded, not one this screen picked. The route's
        // enum and `event_participant_status` are the same vocabulary; the cast
        // only carries that across a string field.
        data: { status: next.statusBeforeRemoval as PatchApiV1EventsIdParticipantsPidBodyStatus },
      });
    },
    [restoration, eventId],
  );

  const menuItemsFor = useCallback(
    (next: EventCollaborator, displayName: string): EventMenuItem[] => {
      if (!canManage) return [];
      const isHost = next.profileId === hostProfileId;
      const isRemoved = next.status === "removed";
      const inFlight =
        (patch.isPending && editing?.collaborator.id === next.id) ||
        (remove.isPending && remove.variables?.pid === next.id) ||
        (restoration.isPending && restoration.variables?.pid === next.id);

      const editRefusal = isHost
        ? "The operator anchors this event — their role and access are fixed."
        : next.role === "agent"
          ? "An agent stands on this event through the performer they represent, not through a role set here."
          : isRemoved
            ? "They have been removed from this event."
            : inFlight
              ? "Working on it…"
              : undefined;

      const removeRefusal = isHost
        ? "The operator cannot be removed from their own event."
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
        // Removed rows get the undo in place of the remove — the two are never
        // both on offer, and neither is a dead entry. `statusBeforeRemoval` is
        // absent on a row removed before the API kept it (migration 0037), and
        // there the menu says so rather than offering a restore to nowhere.
        isRemoved
          ? {
              key: "restore",
              label: "Restore",
              onSelect: next.statusBeforeRemoval && !inFlight ? () => restore(next) : undefined,
              refusal: inFlight
                ? "Working on it…"
                : next.statusBeforeRemoval
                  ? undefined
                  : "This one was removed before we started keeping track of what to put back. Invite them again.",
              hint: next.statusBeforeRemoval
                ? `Puts them back on this event as ${next.statusBeforeRemoval}.`
                : undefined,
            }
          : {
              key: "remove",
              label: "Remove",
              onSelect: removeRefusal ? undefined : () => askToRemove(next, displayName),
              refusal: removeRefusal,
              hint: removeRefusal
                ? undefined
                : "Takes away their access. Nothing they did here is deleted, and you can put them back.",
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
      restore,
      restoration.isPending,
      restoration.variables,
    ],
  );

  // What they walked in holding, so the form knows whether the access question has
  // been answered differently — in EITHER direction. Derived from capabilities, the
  // same way the effect above seeds the select.
  const heldAdminGrade = confersAdminAuthority(editing?.collaborator.permissionSet?.capabilities);
  const initialAccess: EventCollaboratorAccess = heldAdminGrade ? "full_control" : "standard";

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
    hasFullControl: heldAdminGrade,
    currentSetName: editing.collaborator.permissionSet?.name ?? null,
    hasChanges: role !== editing.collaborator.role || access !== initialAccess,
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
          // BOTH DIRECTIONS, now that the route takes `permissionSetId` as
          // nullable: an id raises access, an explicit `null` lowers it back to
          // the role's default. It used to be sent only when raising, because
          // "standard" was unsayable — which is what made access a one-way door.
          //
          // Sent only when the access actually CHANGED. Re-sending the id they
          // already hold would put the same grant back through the entitlement
          // gate for nothing.
          ...(access !== initialAccess
            ? {
                permissionSetId:
                  access === "full_control" ? (fullControlPermissionSetId ?? null) : null,
              }
            : {}),
        },
      });
    },
    close: () => setEditorOpen(false),
  };

  return { menuItemsFor, editor, confirmDialogProps: confirmation.dialogProps };
}
