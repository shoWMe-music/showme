import {
  type PatchApiV1ProfilesIdMembersMidBodyRole,
  type getApiV1ProfilesIdInvitations,
  type getApiV1ProfilesIdMembers,
  getGetApiV1ProfilesIdInvitationsQueryKey,
  getGetApiV1ProfilesIdMembersQueryKey,
  useDeleteApiV1ProfilesIdMembersMid,
  useGetApiV1ProfilesIdInvitations,
  useGetApiV1ProfilesIdMembers,
  usePatchApiV1ProfilesIdMembersMid,
  usePostApiV1Invitations,
  usePostApiV1InvitationsIdRevoke,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { errorMessage } from "../lib/errors";

/**
 * WHO IS ON THE ACCOUNT, AND WHO HAS BEEN ASKED.
 *
 * Settings → Team Access shipped as a "coming soon" empty state and stayed one:
 * an owner could read their own role and account kind, and there was no way to
 * invite a teammate to the ACCOUNT or to give anyone a role (ClickUp 86cbaxvqk,
 * "access giving non functional"). Per-EVENT invitation had worked the whole
 * time, which made the gap read as a broken feature rather than an unbuilt one.
 *
 * Nothing here is a new mechanism. It is the same `POST /invitations` the event
 * roster sends, with `type: "profile_member"` and a `targetProfileId` instead of
 * a `targetEventId`, plus the `profile_members` routes that have existed since
 * the schema did. The only piece that had to be built is
 * `GET /profiles/:id/invitations`, because an invitation writes NO member row
 * until it is answered — so before it, an owner who had just invited someone saw
 * a members list identical to the one before they asked.
 *
 * The hook owns every decision the panel would otherwise have to make: which
 * roles may be handed out, which rows may be changed, what an error says. The
 * panel takes values and emits events.
 */

export type TeamMember = Awaited<ReturnType<typeof getApiV1ProfilesIdMembers>>[number];
export type TeamInvitation = Awaited<ReturnType<typeof getApiV1ProfilesIdInvitations>>[number];

/** One role on offer, and the plain-language sentence describing what it buys. */
export interface TeamRoleOption {
  value: string;
  label: string;
  description: string;
  /**
   * Whether holding it occupies one of the plan's seats — `SEAT_CONSUMING_ROLES`
   * on the API. Shown on the option so running out is a fact the reader met
   * before they chose, not a 403 they met after.
   */
  consumesSeat: boolean;
}

/**
 * The roles an owner or admin may hand out.
 *
 * `owner` is deliberately absent. It is the account's own anchor — the API
 * refuses to change or remove that membership outright — so offering it would be
 * a select whose choice is a 403.
 *
 * The seat flags mirror `SEAT_CONSUMING_ROLES` in the API's entitlements module:
 * a role that can CHANGE the account costs a seat, one that can only look does
 * not. Free plans get one seat, which the owner already holds; a paid plan buys
 * a second. Daniel, 2026-09-01: *"Freemium gets one admin seat the rest are all
 * view roles (team/crew). Paid gets two account Admins."*
 */
export const TEAM_ROLES: TeamRoleOption[] = [
  {
    value: "admin",
    label: "Admin",
    description:
      "Runs the account alongside you: events, deals, budgets, settlements, and who else is on the team.",
    consumesSeat: true,
  },
  {
    value: "editor",
    label: "Editor",
    description: "Creates and changes the work — events, deals and budgets — but not the team.",
    consumesSeat: true,
  },
  {
    value: "viewer",
    label: "Viewer",
    description: "Reads the account's events and their details. Changes nothing.",
    consumesSeat: false,
  },
  {
    value: "crew",
    label: "Crew",
    description:
      "On the team for scheduling: their calls and their own details, not the account's money.",
    consumesSeat: false,
  },
];

const DEFAULT_ROLE = "viewer";

export interface TeamInviteForm {
  email: string;
  setEmail: (email: string) => void;
  name: string;
  setName: (name: string) => void;
  role: string;
  setRole: (role: string) => void;
  /** The selected role's sentence, and whether it will cost a seat. */
  selectedRole: TeamRoleOption | undefined;
  /** Enough typed to send. */
  canSend: boolean;
  sending: boolean;
  /** The API's own words when it refused — a plan refusal belongs on the form. */
  refusal: string | null;
  send: () => void;
  reset: () => void;
}

export interface TeamAccessView {
  members: TeamMember[];
  invitations: TeamInvitation[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** The caller may invite, change a role, and revoke — owner or admin only. */
  canManage: boolean;
  invite: TeamInviteForm;
  /** Change a member's role. Refused on the owner row by the API, and by us. */
  changeRole: (member: TeamMember, role: string) => void;
  /** Take a member off the account. Their own account is untouched. */
  removeMember: (member: TeamMember) => void;
  /** Withdraw an invitation nobody has answered. */
  revokeInvitation: (invitation: TeamInvitation) => void;
  /** True while any of the three writes is in flight, for the row being written. */
  isWriting: (rowId: string) => boolean;
  /** Why this member's row cannot be changed, or undefined when it can. */
  refusalFor: (member: TeamMember) => string | undefined;
}

export function useTeamAccess(profileId: string, canManage: boolean): TeamAccessView {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(DEFAULT_ROLE);
  const [refusal, setRefusal] = useState<string | null>(null);

  const enabled = Boolean(profileId);
  const members = useGetApiV1ProfilesIdMembers(profileId, { query: { enabled } });
  // The invitations route is owner/admin only, so asking without the standing to
  // read it would spend a request on a guaranteed refusal.
  const invitations = useGetApiV1ProfilesIdInvitations(profileId, {
    query: { enabled: enabled && canManage },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: getGetApiV1ProfilesIdMembersQueryKey(profileId),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetApiV1ProfilesIdInvitationsQueryKey(profileId),
    });
  }, [queryClient, profileId]);

  const createInvitation = usePostApiV1Invitations({
    mutation: {
      onSuccess: () => {
        refresh();
        setEmail("");
        setName("");
        setRole(DEFAULT_ROLE);
        toast.success("Invitation sent.");
      },
      // On the FORM, not only in a toast. "Your plan includes one administrator"
      // is the answer to the question just asked, and a toast that has faded is
      // no answer at all.
      onError: (error) => setRefusal(errorMessage(error, "Couldn't send that invitation.")),
    },
  });

  const patchMember = usePatchApiV1ProfilesIdMembersMid({
    mutation: {
      onSuccess: () => {
        refresh();
        toast.success("Role updated.");
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't change that role.")),
    },
  });

  const deleteMember = useDeleteApiV1ProfilesIdMembersMid({
    mutation: {
      onSuccess: () => {
        refresh();
        toast.success("Removed from the account.");
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't remove that member.")),
    },
  });

  const revoke = usePostApiV1InvitationsIdRevoke({
    mutation: {
      onSuccess: () => {
        refresh();
        toast.success("Invitation withdrawn.");
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't withdraw that invitation.")),
    },
  });

  const trimmedEmail = email.trim();

  return {
    members: members.data ?? [],
    invitations: invitations.data ?? [],
    isPending: members.isPending,
    isError: members.isError,
    error: members.error,
    canManage,
    invite: {
      email,
      setEmail,
      name,
      setName,
      role,
      setRole,
      selectedRole: TEAM_ROLES.find((option) => option.value === role),
      canSend: trimmedEmail.includes("@") && !createInvitation.isPending,
      sending: createInvitation.isPending,
      refusal,
      send: () => {
        if (!trimmedEmail) return;
        setRefusal(null);
        createInvitation.mutate({
          data: {
            // The SAME route the event roster sends through. `profile_member` and
            // a `targetProfileId` are the only difference — see the note at the
            // top of this file.
            type: "profile_member",
            source: "team",
            recipientEmail: trimmedEmail,
            ...(name.trim() ? { recipientName: name.trim() } : {}),
            targetProfileId: profileId,
            role,
          },
        });
      },
      reset: () => {
        setEmail("");
        setName("");
        setRole(DEFAULT_ROLE);
        setRefusal(null);
      },
    },
    changeRole: (member, nextRole) =>
      patchMember.mutate({
        id: profileId,
        mid: member.id,
        // TEAM_ROLES is a strict subset of the route's `memberRole` enum (it
        // drops `owner`, which the API refuses to assign anyway), so a selected
        // value is always one the API accepts — the enum is just not carried
        // through `Select`, which speaks plain strings.
        data: { role: nextRole as PatchApiV1ProfilesIdMembersMidBodyRole },
      }),
    removeMember: (member) => deleteMember.mutate({ id: profileId, mid: member.id }),
    revokeInvitation: (invitation) => revoke.mutate({ id: invitation.id }),
    isWriting: (rowId) =>
      (patchMember.isPending && patchMember.variables?.mid === rowId) ||
      (deleteMember.isPending && deleteMember.variables?.mid === rowId) ||
      (revoke.isPending && revoke.variables?.id === rowId),
    /**
     * The API's own rules restated, so the panel never offers a control whose
     * click is a 403:
     *
     *  - **The owner is the anchor.** `PATCH`/`DELETE` both refuse that row
     *    outright ("The owner membership cannot be changed"), because an account
     *    with no owner has nobody who can give it one.
     *  - **Without owner or admin standing there is nothing to offer at all** —
     *    the routes are gated on exactly that pair.
     */
    refusalFor: (member) => {
      if (!canManage) return "Only the account's owner or an admin can change this.";
      if (member.role === "owner") return "The owner anchors this account and cannot be changed.";
      return undefined;
    },
  };
}
