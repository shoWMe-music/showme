import {
  type getApiV1Groups,
  type getApiV1ProfilesIdMembers,
  getGetApiV1GroupsQueryKey,
  getGetApiV1ProfilesIdMembersQueryKey,
  getGetApiV1ProfilesIdMembersQueryOptions,
  useDeleteApiV1GroupsGid,
  useDeleteApiV1GroupsGidMembersMid,
  useDeleteApiV1ProfilesIdMembersMid,
  useGetApiV1Groups,
  useGetApiV1Profiles,
  usePatchApiV1GroupsGid,
  usePostApiV1Groups,
} from "@showme/api-client";
import {
  Avatar,
  type AvatarTone,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Modal,
  SectionHeader,
  Tag,
  TextField,
  useToast,
} from "@showme/design-system";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, type FormEvent, type ReactNode, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { GroupCard } from "../components";
import { TeamInviteMemberModal } from "../components/TeamInviteMemberModal";
import { TeamMemberEditModal, type TeamMemberEditTarget } from "../components/TeamMemberEditModal";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import { errorMessage } from "../lib/errors";

type Group = Awaited<ReturnType<typeof getApiV1Groups>>[number];
type GroupMember = Group["members"][number];
type ProfileMember = Awaited<ReturnType<typeof getApiV1ProfilesIdMembers>>[number];

/** An account member, carrying the name of the account they are a member of. */
type RosterEntry = ProfileMember & { profileName: string };

/** Deterministic dot colour + avatar tone, cycled by index (groups have no
 * stored colour yet — the prototype uses one per group). */
const GROUP_COLORS = ["#EE5746", "#F4A046", "#7C6FE0", "#4B9FE0", "#6FC97A"];
const PROFILE_COLORS = ["#EE5746", "#6FC97A", "#4B9FE0", "#7C6FE0", "#F4A046"];
const MEMBER_TONES: AvatarTone[] = ["brand", "amber", "purple", "blue", "green"];

/** What a `profile_members.role` is called on screen (docs/decisions.md #12). */
const ROLE_TITLES: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  crew: "Crew",
};

/** No display-name field exists on a group member — derive a human label from
 * the email local-part rather than surfacing a raw address as the name. */
function nameFromEmail(email: string | null | undefined): string | null {
  const local = email?.split("@")[0];
  if (!local) return null;
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(" ") : null;
}

/** A group member's on-screen label — their email local-part, else their role. */
function groupMemberLabel(member: GroupMember): string {
  return nameFromEmail(member.email) ?? member.roleLabel ?? "Member";
}

function initials(label: string): string {
  const parts = label
    .replace(/@.*/, "")
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  const last = parts[parts.length - 1];
  if (parts.length === 1 || !last) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

/** One group this person sits on, and the `group_members` row that puts them
 * there — the row a "remove from this group" must delete. */
interface GroupMembership {
  groupId: string;
  groupName: string;
  memberId: string;
}

/** The `profile_members` row behind an ACCOUNT member, and nothing else: a
 * group-only person has no such row, which is exactly why the two menu actions
 * mean different things for them (see `memberMenuItems`). */
interface AccountMembership {
  profileId: string;
  memberId: string;
  role: string;
  displayName: string | null;
}

interface UniqueMember {
  key: string;
  name: string;
  email: string | null;
  tone: AvatarTone;
  onPlatform: boolean;
  roleTitle: string;
  accessLevel: string;
  accountMembership: AccountMembership | null;
  groupMemberships: GroupMembership[];
}

/**
 * The roster shown on this screen — the ACCOUNT's members first (the "member"
 * layer of docs/decisions.md #12), then anyone who only appears in a group
 * bundle. Deduplicated by person, so someone who is both an account member and
 * in two groups is one row carrying both group chips.
 *
 * The distinction is load-bearing: a group-only person has a place on a reusable
 * roster but NO access to the account, which is why they read "Group only"
 * rather than being silently counted as a member.
 */
function collectMembers(
  roster: RosterEntry[],
  groups: Group[],
  showAccountName: boolean,
): UniqueMember[] {
  const byKey = new Map<string, UniqueMember>();
  const tone = () => MEMBER_TONES[byKey.size % MEMBER_TONES.length] ?? "brand";

  for (const entry of roster) {
    const key = entry.userId ?? entry.email ?? entry.id;
    if (byKey.has(key)) continue;
    const onPlatform = entry.userId != null;
    byKey.set(key, {
      key,
      // `GET /profiles/:id/members` carries no name for an ON-PLATFORM member (it
      // never joins `users.name`, and redeeming an invitation does not copy the
      // recipient's name onto the row) — so say "Team member" rather than invent one.
      name: entry.displayName ?? nameFromEmail(entry.email) ?? "Team member",
      email: entry.email,
      tone: tone(),
      onPlatform,
      roleTitle: ROLE_TITLES[entry.role] ?? entry.role,
      accessLevel: showAccountName ? entry.profileName : "Account member",
      accountMembership: {
        profileId: entry.profileId,
        memberId: entry.id,
        role: entry.role,
        displayName: entry.displayName,
      },
      groupMemberships: [],
    });
  }

  for (const group of groups) {
    for (const member of group.members) {
      const key = member.userId ?? member.email ?? member.id;
      const membership: GroupMembership = {
        groupId: group.id,
        groupName: group.name,
        memberId: member.id,
      };
      const existing = byKey.get(key);
      if (existing) {
        existing.groupMemberships.push(membership);
        continue;
      }
      byKey.set(key, {
        key,
        name: groupMemberLabel(member),
        email: member.email,
        tone: tone(),
        onPlatform: member.userId != null,
        roleTitle: member.roleLabel ?? "Crew",
        accessLevel: "Group only",
        accountMembership: null,
        groupMemberships: [membership],
      });
    }
  }

  return [...byKey.values()];
}

/** One entry in a member row's overflow menu. An item is either live (it has an
 * `onSelect`) or refused with a reason the reader can act on — never present and
 * inert, which is what a silently dead menu item is. */
interface MemberMenuItem {
  key: string;
  label: string;
  onSelect?: () => void;
  /** Why this action is not on offer. Rendered as the item's help text. */
  refusal?: string;
}

/**
 * What the overflow menu offers for one roster row.
 *
 * The two "member" actions are ACCOUNT actions — they touch the person's
 * `profile_members` row — so they only exist for someone who has one. A
 * group-only person sits on a reusable roster and holds no account access
 * (`collectMembers`), so "remove" for them can only mean leaving a group, and
 * there is no account role to edit. Offering "Remove member" there would delete
 * the wrong row, or nothing at all.
 *
 * The owner row is refused outright because the API refuses it too
 * (`PATCH`/`DELETE /profiles/:id/members/:mid` → 403 on `role === "owner"`).
 */
function memberMenuItems(
  member: UniqueMember,
  canManageAccount: boolean,
  handlers: {
    onEditMember: (membership: AccountMembership, name: string) => void;
    onRemoveMember: (membership: AccountMembership, name: string) => void;
    onLeaveGroup: (membership: GroupMembership, name: string) => void;
  },
): MemberMenuItem[] {
  const items: MemberMenuItem[] = [];
  const membership = member.accountMembership;

  if (!membership) {
    items.push({
      key: "edit",
      label: "Edit member",
      refusal:
        "They are only on a group roster, so there is no account role to change. Invite them to the account to give them one.",
    });
  } else if (membership.role === "owner") {
    items.push({
      key: "edit",
      label: "Edit member",
      refusal: "The account owner's membership cannot be changed.",
    });
    items.push({
      key: "remove",
      label: "Remove member",
      refusal: "The account owner cannot be removed. Transfer ownership first.",
    });
  } else if (!canManageAccount) {
    const refusal = "Only the account owner or an admin can manage members.";
    items.push({ key: "edit", label: "Edit member", refusal });
    items.push({ key: "remove", label: "Remove member", refusal });
  } else {
    items.push({
      key: "edit",
      label: "Edit member",
      onSelect: () => handlers.onEditMember(membership, member.name),
    });
    items.push({
      key: "remove",
      label: "Remove member",
      onSelect: () => handlers.onRemoveMember(membership, member.name),
    });
  }

  // Group membership is a separate row in a separate table, so it gets its own
  // action — named after the group, because someone on three of them needs to
  // know which one they are being taken off.
  for (const groupMembership of member.groupMemberships) {
    items.push({
      key: `group-${groupMembership.groupId}`,
      label: `Remove from ${groupMembership.groupName}`,
      onSelect: () => handlers.onLeaveGroup(groupMembership, member.name),
    });
  }

  return items;
}

export function Team() {
  const { session } = useAuth();
  const groupsQuery = useGetApiV1Groups();
  const profilesQuery = useGetApiV1Profiles();
  const queryClient = useQueryClient();
  const toast = useToast();

  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const profiles = profilesQuery.data ?? [];
  const profileName = useMemo(() => {
    const map = new Map<string, string>();
    for (const profile of profiles) map.set(profile.id, profile.name);
    return map;
  }, [profiles]);

  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [groupModal, setGroupModal] = useState<{
    mode: "create" | "rename";
    groupId?: string;
  } | null>(null);
  const [groupName, setGroupName] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMemberEditTarget | null>(null);

  const invalidateGroups = () =>
    queryClient.invalidateQueries({ queryKey: getGetApiV1GroupsQueryKey() });

  const createGroup = usePostApiV1Groups({
    mutation: {
      onSuccess: (group) => {
        toast.success(`"${group.name}" created`);
        invalidateGroups();
        setGroupModal(null);
        setGroupName("");
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't create the group.")),
    },
  });
  const renameGroup = usePatchApiV1GroupsGid({
    mutation: {
      onSuccess: () => {
        toast.success("Group renamed");
        invalidateGroups();
        setGroupModal(null);
        setGroupName("");
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't rename the group.")),
    },
  });
  const deleteGroup = useDeleteApiV1GroupsGid({
    mutation: {
      onSuccess: () => {
        toast.success("Group removed");
        invalidateGroups();
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't remove the group.")),
    },
  });
  // The account roster — one query per profile the user belongs to, so the count
  // in the header is the truth. Reading only group members used to report "0
  // members" to an owner who was, demonstrably, a member.
  const rosterQueries = useQueries({
    queries: profiles.map((profile) => getGetApiV1ProfilesIdMembersQueryOptions(profile.id)),
  });

  const visibleGroups = selectedProfileId
    ? groups.filter((group) => group.profileIds.includes(selectedProfileId))
    : groups;
  const visibleRoster: RosterEntry[] = profiles.flatMap((profile, index) => {
    if (selectedProfileId && profile.id !== selectedProfileId) return [];
    const rows = rosterQueries[index]?.data ?? [];
    return rows.map((row) => ({ ...row, profileName: profile.name }));
  });
  // Naming the account only earns its place when the user has more than one.
  const members = collectMembers(visibleRoster, visibleGroups, profiles.length > 1);

  /** The account an invite lands on: the one in focus, else the user's first. */
  const inviteProfileId = selectedProfileId ?? profiles[0]?.id ?? null;

  function refreshRoster(profileId: string) {
    queryClient.invalidateQueries({ queryKey: getGetApiV1ProfilesIdMembersQueryKey(profileId) });
    invalidateGroups();
  }

  function scopeLabel(group: Group): string {
    const count = group.profileIds.length;
    if (count === 0) return "No profiles";
    if (count === 1) {
      const first = group.profileIds[0];
      return (first && profileName.get(first)) ?? "1 profile";
    }
    return `${count} profiles`;
  }

  function openCreateGroup() {
    setGroupName("");
    setGroupModal({ mode: "create" });
  }
  function openRenameGroup(group: Group) {
    setGroupName(group.name);
    setGroupModal({ mode: "rename", groupId: group.id });
  }
  function submitGroup(formEvent: FormEvent) {
    formEvent.preventDefault();
    const name = groupName.trim();
    if (!name) return;
    if (groupModal?.mode === "rename" && groupModal.groupId) {
      renameGroup.mutate({ gid: groupModal.groupId, data: { name } });
    } else {
      createGroup.mutate({ data: { name } });
    }
  }
  function removeGroup(group: Group) {
    if (!window.confirm(`Remove the "${group.name}" group? Members stay in any other groups.`))
      return;
    deleteGroup.mutate({ gid: group.id });
  }

  // Managing the roster is owner/admin only — the same gate the API applies
  // (`requireProfileRole(..., MANAGE_ROLES)`), read off the session so a viewer
  // is told why rather than shown a button that 403s.
  const manageableProfileIds = useMemo(
    () =>
      new Set(
        (session?.memberships ?? [])
          .filter((membership) => membership.role === "owner" || membership.role === "admin")
          .map((membership) => membership.profileId),
      ),
    [session?.memberships],
  );

  const removeMember = useDeleteApiV1ProfilesIdMembersMid({
    mutation: {
      onSuccess: (_result, variables) => {
        toast.success("Member removed");
        refreshRoster(variables.id);
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't remove the member.")),
    },
  });
  const removeGroupMember = useDeleteApiV1GroupsGidMembersMid({
    mutation: {
      onSuccess: () => {
        toast.success("Removed from the group");
        invalidateGroups();
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't remove them from the group.")),
    },
  });

  const menuHandlers = {
    onEditMember: (membership: AccountMembership, name: string) => {
      setOpenMenuKey(null);
      setEditingMember({
        profileId: membership.profileId,
        memberId: membership.memberId,
        name,
        role: membership.role,
        displayName: membership.displayName,
      });
    },
    onRemoveMember: (membership: AccountMembership, name: string) => {
      setOpenMenuKey(null);
      // Losing account access is not undoable from this screen — it takes a
      // fresh invitation to put back — so it asks first.
      if (!window.confirm(`Remove ${name} from this account? They lose all access to it.`)) return;
      removeMember.mutate({ id: membership.profileId, mid: membership.memberId });
    },
    onLeaveGroup: (membership: GroupMembership, name: string) => {
      setOpenMenuKey(null);
      if (!window.confirm(`Take ${name} off the "${membership.groupName}" group?`)) return;
      removeGroupMember.mutate({ gid: membership.groupId, mid: membership.memberId });
    },
  };

  const groupModalBusy = createGroup.isPending || renameGroup.isPending;

  const headerActions = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={toggleWrapStyle}>
        <button
          type="button"
          aria-label="List view"
          aria-pressed={viewMode === "list"}
          onClick={() => setViewMode("list")}
          style={toggleButtonStyle(viewMode === "list")}
        >
          <ListIcon />
        </button>
        <button
          type="button"
          aria-label="Grid view"
          aria-pressed={viewMode === "grid"}
          onClick={() => setViewMode("grid")}
          style={toggleButtonStyle(viewMode === "grid")}
        >
          <Icon name="grid" size={16} />
        </button>
      </div>
      <Button variant="primary" onClick={() => setInviteOpen(true)} leftIcon={<InviteIcon />}>
        Invite Member
      </Button>
    </div>
  );

  return (
    <>
      <SectionHeader
        eyebrow="People"
        title="Team"
        subtitle={`${members.length} ${members.length === 1 ? "member" : "members"} · manage roles and access.`}
        actions={headerActions}
      />

      {groupsQuery.isPending ? (
        <LoadingState label="Loading team" />
      ) : groupsQuery.isError ? (
        <ErrorState error={groupsQuery.error} title="Couldn't load your team" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {profiles.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Eyebrow>Profiles</Eyebrow>
              <FilterChip
                active={selectedProfileId === null}
                onClick={() => setSelectedProfileId(null)}
              >
                All
              </FilterChip>
              {profiles.map((profile, index) => (
                <FilterChip
                  key={profile.id}
                  active={selectedProfileId === profile.id}
                  dot={PROFILE_COLORS[index % PROFILE_COLORS.length]}
                  onClick={() => setSelectedProfileId(profile.id)}
                >
                  {profile.name}
                </FilterChip>
              ))}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <Eyebrow>Groups</Eyebrow>
            <button type="button" onClick={openCreateGroup} style={newGroupButtonStyle}>
              <Icon name="plus" size={14} />
              New group
            </button>
          </div>

          {visibleGroups.length === 0 ? (
            <EmptyState
              icon={<Icon name="users" />}
              title={selectedProfileId ? "No groups on this profile" : "No groups yet"}
              description="Reusable rosters — Booking, Production, Marketing — appear here. Optional: people can join the team without one."
            />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 14,
              }}
            >
              {visibleGroups.map((group, groupIndex) => {
                const color = GROUP_COLORS[groupIndex % GROUP_COLORS.length] ?? "#EE5746";
                return (
                  <GroupCard
                    key={group.id}
                    name={group.name}
                    color={color}
                    members={group.members.map((member, index) => ({
                      id: member.id,
                      initials: initials(groupMemberLabel(member)),
                      tone: MEMBER_TONES[index % MEMBER_TONES.length],
                    }))}
                    memberCount={group.members.length}
                    scopeLabel={scopeLabel(group)}
                    onEdit={() => openRenameGroup(group)}
                    onRemove={() => removeGroup(group)}
                  />
                );
              })}
            </div>
          )}

          <Eyebrow>People</Eyebrow>

          {/* The roster stands on its own — it is the account's members, not a
              read-out of the group cards above, so it renders with or without one. */}
          {members.length === 0 ? (
            <EmptyState
              icon={<Icon name="users" />}
              title="No one here yet"
              description="Invite someone by email and pick what they may do — they join the account as soon as they accept."
              action={
                <Button
                  variant="primary"
                  onClick={() => setInviteOpen(true)}
                  leftIcon={<InviteIcon />}
                >
                  Invite Member
                </Button>
              }
            />
          ) : viewMode === "grid" ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 14,
              }}
            >
              {members.map((member) => (
                <MemberCard key={member.key} member={member} />
              ))}
            </div>
          ) : (
            <Card padding="none">
              {members.map((member, index) => (
                <MemberRow
                  key={member.key}
                  member={member}
                  first={index === 0}
                  menuOpen={openMenuKey === member.key}
                  menuItems={memberMenuItems(
                    member,
                    member.accountMembership != null &&
                      manageableProfileIds.has(member.accountMembership.profileId),
                    menuHandlers,
                  )}
                  onToggleMenu={() =>
                    setOpenMenuKey((current) => (current === member.key ? null : member.key))
                  }
                />
              ))}
            </Card>
          )}
        </div>
      )}

      <Modal
        open={groupModal !== null}
        onClose={() => setGroupModal(null)}
        title={groupModal?.mode === "rename" ? "Rename group" : "New group"}
        width={440}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGroupModal(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitGroup}
              disabled={groupName.trim().length === 0 || groupModalBusy}
            >
              {groupModalBusy ? "Saving…" : groupModal?.mode === "rename" ? "Save" : "Create group"}
            </Button>
          </>
        }
      >
        <form onSubmit={submitGroup} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <TextField
            label="Group name"
            value={groupName}
            placeholder="e.g. Booking"
            onChange={(changeEvent) => setGroupName(changeEvent.target.value)}
            autoFocus
          />
          <button type="submit" hidden aria-hidden />
        </form>
      </Modal>

      <TeamMemberEditModal
        open={editingMember !== null}
        member={editingMember}
        onClose={() => setEditingMember(null)}
        onSaved={({ profileId }) => {
          toast.success("Member updated");
          refreshRoster(profileId);
          setEditingMember(null);
        }}
      />

      <TeamInviteMemberModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        profiles={profiles.map((profile) => ({ id: profile.id, name: profile.name }))}
        groups={groups.map((group) => ({ id: group.id, name: group.name }))}
        defaultProfileId={inviteProfileId}
        onInvited={({ email, profileId }) => {
          toast.success(`Invitation sent to ${email}`);
          refreshRoster(profileId);
        }}
      />
    </>
  );
}

/** A member row (list view): avatar + name + account badge + email + group
 * chips, with a right-aligned role/access and an overflow menu. Presentational:
 * the parent decides what the menu offers and what each entry does. */
function MemberRow({
  member,
  first,
  menuOpen,
  menuItems,
  onToggleMenu,
}: {
  member: UniqueMember;
  first: boolean;
  menuOpen: boolean;
  menuItems: MemberMenuItem[];
  onToggleMenu: () => void;
}) {
  const [openUpward, setOpenUpward] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "14px 16px",
        borderTop: first ? "none" : "1px solid var(--border)",
      }}
    >
      <Avatar initials={initials(member.name)} tone={member.tone} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{member.name}</span>
          <Badge status={member.onPlatform ? "confirmed" : "pending"} dot>
            {member.onPlatform ? "On shoWMe" : "Contact"}
          </Badge>
        </div>
        {member.email && (
          <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 2 }}>{member.email}</div>
        )}
        {member.groupMemberships.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
            {member.groupMemberships.map((membership) => (
              <Tag key={membership.groupId} tone="muted">
                {membership.groupName}
              </Tag>
            ))}
          </div>
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
          {member.roleTitle}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{member.accessLevel}</div>
      </div>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          aria-label="Member menu"
          onClick={(clickEvent) => {
            // A menu that opens past the bottom of the window cannot be reached
            // — the roster's last row is exactly where these live — so measure
            // the trigger and flip the panel above it when there is no room.
            const rect = clickEvent.currentTarget.getBoundingClientRect();
            setOpenUpward(rect.bottom + estimatedMenuHeight(menuItems) > window.innerHeight);
            onToggleMenu();
          }}
          style={menuButtonStyle}
        >
          <Icon name="dots-vertical" size={16} />
        </button>
        {menuOpen && (
          <div style={menuPopoverStyle(openUpward)}>
            {menuItems.map((item) => (
              <button
                key={item.key}
                type="button"
                disabled={!item.onSelect}
                title={item.refusal}
                onClick={item.onSelect}
                style={menuItemStyle(!item.onSelect)}
                onMouseEnter={(mouseEvent) => {
                  if (item.onSelect) mouseEvent.currentTarget.style.background = "var(--elevated)";
                }}
                onMouseLeave={(mouseEvent) => {
                  mouseEvent.currentTarget.style.background = "transparent";
                }}
              >
                <span>{item.label}</span>
                {/* The reason travels WITH the refused item: a title attribute
                    alone is invisible to anyone who does not hover it, which is
                    how a disabled item comes to read as a broken one. */}
                {item.refusal && <span style={menuRefusalStyle}>{item.refusal}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A member card (grid view): the same fields stacked in a card. */
function MemberCard({ member }: { member: UniqueMember }) {
  return (
    <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <Avatar initials={initials(member.name)} tone={member.tone} size={40} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{member.name}</div>
          {member.email && (
            <div
              style={{
                color: "var(--muted)",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {member.email}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge status={member.onPlatform ? "confirmed" : "pending"} dot>
          {member.onPlatform ? "On shoWMe" : "Contact"}
        </Badge>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {member.roleTitle} · {member.accessLevel}
        </span>
      </div>
      {member.groupMemberships.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {member.groupMemberships.map((membership) => (
            <Tag key={membership.groupId} tone="muted">
              {membership.groupName}
            </Tag>
          ))}
        </div>
      )}
    </Card>
  );
}

function FilterChip({
  active,
  dot,
  onClick,
  children,
}: {
  active: boolean;
  dot?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 13px",
        borderRadius: 999,
        border: active ? "1px solid var(--brand-red)" : "1px solid var(--border)",
        background: active
          ? "color-mix(in srgb, var(--brand-red) 12%, transparent)"
          : "var(--elevated)",
        color: active ? "var(--brand-red)" : "var(--muted)",
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
      }}
    >
      {dot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />}
      {children}
    </button>
  );
}

function ListIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      role="img"
      aria-label="List view"
    >
      <title>List view</title>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function InviteIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      role="img"
      aria-label="Invite"
    >
      <title>Invite</title>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6" />
    </svg>
  );
}

const toggleWrapStyle: CSSProperties = {
  display: "inline-flex",
  gap: 4,
  padding: 3,
  borderRadius: 10,
  background: "var(--elevated)",
  border: "1px solid var(--border)",
};

function toggleButtonStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 26,
    border: "none",
    borderRadius: 7,
    background: active ? "var(--card)" : "transparent",
    color: active ? "var(--text)" : "var(--muted)",
    boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
    cursor: "pointer",
  };
}

const newGroupButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 13px",
  borderRadius: 10,
  border: "1px dashed var(--border-strong)",
  background: "transparent",
  color: "var(--muted)",
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
};

const menuButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
};

/** Roughly how tall the panel will be: a refused entry wraps its reason under
 * the label and runs about twice the height of a plain one. Only ever used to
 * choose a direction, so an estimate is enough. */
function estimatedMenuHeight(items: MemberMenuItem[]): number {
  return items.reduce((total, item) => total + (item.refusal ? 64 : 34), 10);
}

function menuPopoverStyle(openUpward: boolean): CSSProperties {
  return {
    position: "absolute",
    ...(openUpward ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
    right: 0,
    zIndex: 10,
    minWidth: 240,
    maxWidth: 300,
    padding: 5,
    borderRadius: 10,
    background: "var(--card)",
    border: "1px solid var(--border)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
  };
}

/** A live menu entry reads as text you may click; a refused one is visibly
 * greyed and wraps its reason underneath, so it never looks merely broken. */
function menuItemStyle(refused: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    width: "100%",
    textAlign: "left",
    padding: "9px 11px",
    border: "none",
    borderRadius: 8,
    background: "transparent",
    color: refused ? "var(--dim)" : "var(--text)",
    fontSize: 13,
    cursor: refused ? "not-allowed" : "pointer",
    opacity: refused ? 0.65 : 1,
  };
}

const menuRefusalStyle: CSSProperties = {
  color: "var(--dim)",
  fontSize: 11,
  lineHeight: 1.35,
  whiteSpace: "normal",
};
