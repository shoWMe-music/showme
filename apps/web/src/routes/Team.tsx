import {
  type getApiV1Groups,
  getGetApiV1GroupsQueryKey,
  useDeleteApiV1GroupsGid,
  useGetApiV1Groups,
  useGetApiV1Profiles,
  usePatchApiV1GroupsGid,
  usePostApiV1Groups,
  usePostApiV1GroupsGidMembers,
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
  Select,
  Tag,
  TextField,
  useToast,
} from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, type FormEvent, type ReactNode, useMemo, useState } from "react";
import { GroupCard } from "../components";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import { errorMessage } from "../lib/errors";

type Group = Awaited<ReturnType<typeof getApiV1Groups>>[number];
type Member = Group["members"][number];

/** Deterministic dot colour + avatar tone, cycled by index (groups have no
 * stored colour yet — the prototype uses one per group). */
const GROUP_COLORS = ["#EE5746", "#F4A046", "#7C6FE0", "#4B9FE0", "#6FC97A"];
const PROFILE_COLORS = ["#EE5746", "#6FC97A", "#4B9FE0", "#7C6FE0", "#F4A046"];
const MEMBER_TONES: AvatarTone[] = ["brand", "amber", "purple", "blue", "green"];

/** No display-name field exists on a group member — derive a human label from
 * the email local-part rather than surfacing a raw address as the name. */
function deriveName(member: Member): string {
  const local = member.email?.split("@")[0];
  if (local) {
    const words = local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
    if (words.length > 0) return words.join(" ");
  }
  return member.roleLabel ?? "Member";
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

interface UniqueMember {
  key: string;
  name: string;
  email: string | null;
  tone: AvatarTone;
  onPlatform: boolean;
  roleTitle: string;
  accessLevel: string;
  groupNames: string[];
}

/** Collapse the per-group member lists into one deduplicated roster — a person
 * in several groups appears once, carrying all their group chips (matches the
 * prototype's flat member list under the group cards). */
function collectMembers(groups: Group[]): UniqueMember[] {
  const byKey = new Map<string, UniqueMember & { toneSeed: number }>();
  for (const group of groups) {
    for (const member of group.members) {
      const key = member.userId ?? member.email ?? member.id;
      const isOwner = member.userId != null && member.userId === group.ownerUserId;
      const existing = byKey.get(key);
      if (existing) {
        existing.groupNames.push(group.name);
        if (existing.roleTitle === "Member" && member.roleLabel)
          existing.roleTitle = member.roleLabel;
        if (isOwner) existing.accessLevel = "Owner";
        continue;
      }
      const onPlatform = member.userId != null;
      const seed = byKey.size;
      byKey.set(key, {
        key,
        toneSeed: seed,
        name: deriveName(member),
        email: member.email,
        tone: MEMBER_TONES[seed % MEMBER_TONES.length] ?? "brand",
        onPlatform,
        roleTitle: member.roleLabel ?? "Member",
        accessLevel: isOwner ? "Owner" : onPlatform ? "Member" : "Invited",
        groupNames: [group.name],
      });
    }
  }
  return [...byKey.values()];
}

export function Team() {
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
  const [groupModal, setGroupModal] = useState<{ mode: "create" | "rename"; gid?: string } | null>(
    null,
  );
  const [groupName, setGroupName] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteGid, setInviteGid] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");

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
  const addMember = usePostApiV1GroupsGidMembers({
    mutation: {
      onSuccess: () => {
        toast.success("Member invited");
        invalidateGroups();
        setInviteOpen(false);
        setInviteEmail("");
        setInviteRole("");
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't invite the member.")),
    },
  });

  const visibleGroups = selectedProfileId
    ? groups.filter((group) => group.profileIds.includes(selectedProfileId))
    : groups;
  const members = useMemo(() => collectMembers(visibleGroups), [visibleGroups]);

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
    setGroupModal({ mode: "rename", gid: group.id });
  }
  function submitGroup(formEvent: FormEvent) {
    formEvent.preventDefault();
    const name = groupName.trim();
    if (!name) return;
    if (groupModal?.mode === "rename" && groupModal.gid) {
      renameGroup.mutate({ gid: groupModal.gid, data: { name } });
    } else {
      createGroup.mutate({ data: { name } });
    }
  }
  function removeGroup(group: Group) {
    if (!window.confirm(`Remove the "${group.name}" group? Members stay in any other groups.`))
      return;
    deleteGroup.mutate({ gid: group.id });
  }

  function openInvite() {
    setInviteGid(groups[0]?.id ?? "");
    setInviteEmail("");
    setInviteRole("");
    setInviteOpen(true);
  }
  function submitInvite(formEvent: FormEvent) {
    formEvent.preventDefault();
    const email = inviteEmail.trim();
    if (!inviteGid || !email) return;
    addMember.mutate({
      gid: inviteGid,
      data: { email, ...(inviteRole.trim() ? { roleLabel: inviteRole.trim() } : {}) },
    });
  }

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
      <Button
        variant="primary"
        onClick={openInvite}
        disabled={groups.length === 0}
        leftIcon={<InviteIcon />}
      >
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
              description="Reusable rosters — Booking, Production, Marketing — appear here."
            />
          ) : (
            <>
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
                        initials: initials(deriveName(member)),
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

              {members.length === 0 ? (
                <Card padding="md">
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>No members yet.</span>
                </Card>
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
                      onToggleMenu={() =>
                        setOpenMenuKey((current) => (current === member.key ? null : member.key))
                      }
                    />
                  ))}
                </Card>
              )}
            </>
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

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite member"
        width={460}
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitInvite}
              disabled={!inviteGid || inviteEmail.trim().length === 0 || addMember.isPending}
              leftIcon={<InviteIcon />}
            >
              {addMember.isPending ? "Inviting…" : "Send invite"}
            </Button>
          </>
        }
      >
        <form onSubmit={submitInvite} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Eyebrow>Group</Eyebrow>
            <Select
              value={inviteGid}
              onChange={setInviteGid}
              options={groups.map((group) => ({ value: group.id, label: group.name }))}
              aria-label="Group"
            />
          </div>
          <TextField
            label="Email"
            type="email"
            value={inviteEmail}
            placeholder="name@example.com"
            onChange={(changeEvent) => setInviteEmail(changeEvent.target.value)}
            autoFocus
          />
          <TextField
            label="Role (optional)"
            value={inviteRole}
            placeholder="e.g. Production Manager"
            onChange={(changeEvent) => setInviteRole(changeEvent.target.value)}
          />
          <button type="submit" hidden aria-hidden />
        </form>
      </Modal>
    </>
  );
}

/** A member row (list view): avatar + name + account badge + email + group
 * chips, with a right-aligned role/access and an overflow menu. */
function MemberRow({
  member,
  first,
  menuOpen,
  onToggleMenu,
}: {
  member: UniqueMember;
  first: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
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
        {member.groupNames.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
            {member.groupNames.map((name) => (
              <Tag key={name} tone="muted">
                {name}
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
          onClick={onToggleMenu}
          style={menuButtonStyle}
        >
          <Icon name="dots-vertical" size={16} />
        </button>
        {menuOpen && (
          <div style={menuPopoverStyle}>
            <button type="button" disabled style={menuItemStyle} title="Coming soon">
              Edit member
            </button>
            <button type="button" disabled style={menuItemStyle} title="Coming soon">
              Remove member
            </button>
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
      {member.groupNames.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {member.groupNames.map((name) => (
            <Tag key={name} tone="muted">
              {name}
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

const menuPopoverStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  right: 0,
  zIndex: 10,
  minWidth: 160,
  padding: 5,
  borderRadius: 10,
  background: "var(--card)",
  border: "1px solid var(--border)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
};

const menuItemStyle: CSSProperties = {
  display: "flex",
  width: "100%",
  textAlign: "left",
  padding: "9px 11px",
  border: "none",
  borderRadius: 8,
  background: "transparent",
  color: "var(--dim)",
  fontSize: 13,
  cursor: "not-allowed",
};
