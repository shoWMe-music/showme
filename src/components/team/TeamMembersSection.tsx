import { useState, useMemo } from "react";
import { useUser, type TeamMember } from "@/lib/user-context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Pencil, Plus, Trash2, Users, X } from "lucide-react";

const PRESET_ROLES: Record<string, string[]> = {
  performer: [
    "Lead Artist / Band Leader", "Band Member", "Booking Agent", "Artist Manager",
    "Tour Manager", "Production Manager", "Sound Engineer (FOH)", "Monitor Engineer",
    "Lighting Designer", "Stage Manager", "Backline Technician", "Merchandise Manager",
    "Content Creator / Videographer", "Publicist / PR", "Social Media Manager",
  ],
  promoter: [
    "Promoter", "Talent Buyer", "Event Producer", "Booking Agent",
    "Marketing Manager", "Digital Marketing Specialist", "PR / Press Relations",
    "Ticketing Manager", "Partnerships / Sponsorship Manager", "Finance / Budget Controller",
    "Operations Coordinator", "Runner / Logistics Assistant", "Guest List Manager",
  ],
  venue: [
    "Venue Owner", "General Manager", "Venue Booker", "Talent Buyer", "Event Manager",
    "Technical Manager", "Sound Engineer (House)", "Lighting Technician", "Bar Manager",
    "Bartender", "Host", "Door", "Tickets", "Guest List", "Merchandise",
    "Waiter / Waitress", "Staff Manager", "HR", "Box Office Manager",
    "Security Manager", "Security Guard", "Hospitality Manager", "Cleaning / Maintenance",
  ],
  organizer: [
    "Event Organizer / Producer", "Project Manager", "Scheduler / Planner",
    "Budget Manager", "Vendor Coordinator", "Artist Liaison", "Logistics Manager",
    "Accreditation Manager", "Volunteer Coordinator", "Health & Safety Officer",
    "Legal / Contracts Manager",
  ],
  festival: [
    "Festival Director", "Program Director / Curator", "Booking Team", "Artist Relations",
    "Production Director", "Stage Manager", "Technical Crew", "Operations Manager",
    "Site Manager", "Logistics & Transport", "Vendor / F&B Manager",
    "Sponsorship & Partnerships", "Marketing & PR", "Ticketing & Accreditation",
    "Volunteer Coordinator", "Security & Safety", "Finance",
  ],
};

type FormState = {
  name: string; email: string; phone: string;
  role: string; status: "active" | "inactive"; notes: string;
  profileIds: string[];
};
const emptyForm = (): FormState => ({
  name: "", email: "", phone: "", role: "Member", status: "active", notes: "", profileIds: [],
});

function initials(name: string) {
  const parts = name.trim().split(" ");
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

function RoleCombobox({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const filtered = options.filter(o => o.toLowerCase().includes(inputValue.toLowerCase()));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); onChange(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Type or select role…"
          className="mt-1"
        />
      </PopoverTrigger>
      {filtered.length > 0 && (
        <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start" onOpenAutoFocus={e => e.preventDefault()}>
          {filtered.map(r => (
            <button key={r} className={cn("w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted", r === value && "bg-muted font-medium")}
              onClick={() => { onChange(r); setInputValue(r); setOpen(false); }}>
              {r}
            </button>
          ))}
        </PopoverContent>
      )}
    </Popover>
  );
}

export function TeamMembersSection() {
  const { profiles, teamMembers, addTeamMember, updateTeamMember, addMemberToProfile, removeTeamMember, loaded } = useUser();
  const { user } = useAuth();

  const ownedProfiles = useMemo(() =>
    Object.entries(profiles).filter(
      ([, p]) => p.created && (p.owner_uid === user?.uid || p.id?.startsWith(`${user?.uid}__`)),
    ), [profiles, user?.uid]);

  const uniqueMembers = useMemo(() => {
    const map = new Map<string, { member: TeamMember; profileIds: string[] }>();
    for (const m of teamMembers) {
      if (map.has(m.id)) {
        if (m.profileId && !map.get(m.id)!.profileIds.includes(m.profileId))
          map.get(m.id)!.profileIds.push(m.profileId);
      } else {
        map.set(m.id, { member: m, profileIds: m.profileId ? [m.profileId] : [] });
      }
    }
    return Array.from(map.values());
  }, [teamMembers]);

  const [addOpen, setAddOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<{ member: TeamMember; profileIds: string[] } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const profileName = (pid: string) => {
    const entry = Object.entries(profiles).find(([, p]) => p.id === pid);
    return entry ? (entry[1].name ?? entry[0]) : pid;
  };

  const unassignedProfilesFor = (currentPids: string[]) =>
    ownedProfiles.filter(([s]) => !currentPids.includes(profiles[s]?.id || ""));

  const customRolesFromMembers = useMemo(() => {
    const allPresets = new Set(Object.values(PRESET_ROLES).flat().map(r => r.toLowerCase()));
    const custom = new Set<string>();
    for (const m of teamMembers) {
      for (const r of m.roles) {
        if (r && r !== "Member" && !allPresets.has(r.toLowerCase())) custom.add(r);
      }
    }
    return Array.from(custom);
  }, [teamMembers]);

  const resolvePresetKey = (entry: [string, (typeof profiles)[string]] | undefined): string => {
    if (!entry) return "";
    const role = entry[1]?.role as string;
    if (PRESET_ROLES[role]) return role;
    // Fallback: derive from slot key (handles "artist" → "performer", "venue_2" → "venue", etc.)
    const slot = entry[0];
    for (const key of Object.keys(PRESET_ROLES)) {
      if (slot.startsWith(key)) return key;
    }
    return role || slot;
  };

  const presetRoles = useMemo(() => {
    const roles = new Set<string>();
    form.profileIds.forEach(pid => {
      const entry = Object.entries(profiles).find(([, p]) => p.id === pid);
      (PRESET_ROLES[resolvePresetKey(entry)] ?? []).forEach(r => roles.add(r));
    });
    customRolesFromMembers.forEach(r => roles.add(r));
    return Array.from(roles);
  }, [form.profileIds, profiles, customRolesFromMembers]);

  const handleAdd = async () => {
    if (!form.name.trim() || form.profileIds.length === 0 || !user) return;
    const id = `TM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [firstPid, ...rest] = form.profileIds;
    const member: TeamMember = {
      id, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(),
      roles: [form.role], status: form.status, notes: form.notes.trim(), profileId: firstPid,
    };
    addTeamMember(member, firstPid);
    rest.forEach(pid => addMemberToProfile(id, pid));
    toast({ title: "Team member added" });
    setAddOpen(false);
    setForm(emptyForm());
  };

  const handleSaveEdit = () => {
    if (!editEntry) return;
    updateTeamMember(editEntry.member);
    setEditEntry(null);
    toast({ title: "Team member updated" });
  };

  const handleDeleteAll = () => {
    if (!deleteTarget) return;
    teamMembers.filter(m => m.id === deleteTarget.id && m.profileId)
      .forEach(m => removeTeamMember(m.id, m.profileId!));
    toast({ title: `${deleteTarget.name} removed` });
    setDeleteTarget(null);
  };

  if (!loaded) return (
    <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
  );

  if (ownedProfiles.length === 0) return (
    <div className="rounded-xl border bg-card p-12 text-center">
      <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
      <p className="text-muted-foreground text-sm">No profiles yet. Create a profile to manage your team.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Crew and contacts across your profiles.</p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setForm(emptyForm()); setAddOpen(true); }}>
          <Plus className="h-3.5 w-3.5" /> Add Member
        </Button>
      </div>

      {uniqueMembers.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
          No team members yet.
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <ul className="divide-y">
            {uniqueMembers.map(({ member, profileIds }) => {
              const toAdd = unassignedProfilesFor(profileIds);
              return (
                <li
                  key={member.id}
                  className="group grid grid-cols-[auto_1fr_1fr_auto] items-start gap-5 px-6 py-5 hover:bg-muted/20 transition-colors"
                >
                  {/* Avatar */}
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground mt-0.5 select-none">
                    {initials(member.name)}
                  </div>

                  {/* Identity */}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-tight">{member.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{member.roles[0]}</p>
                    {member.email && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{member.email}</p>
                    )}
                    <span className={cn(
                      "inline-block mt-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded",
                      member.status === "active"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-muted text-muted-foreground",
                    )}>
                      {member.status}
                    </span>
                  </div>

                  {/* Profile access */}
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Profile access
                    </p>
                    {profileIds.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">None</p>
                    )}
                    <ul className="space-y-1.5">
                      {profileIds.map(pid => (
                        <li key={pid} className="group/item flex items-center gap-2">
                          <span className="h-1 w-1 rounded-full bg-muted-foreground/40 shrink-0" />
                          <span className="text-sm leading-tight flex-1 truncate">{profileName(pid)}</span>
                          <button
                            onClick={() => removeTeamMember(member.id, pid)}
                            className="opacity-0 group-hover/item:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all shrink-0"
                            title="Remove from profile"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    {toAdd.length > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="mt-2.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                            <Plus className="h-3 w-3" />
                            Add profile
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-52 p-1.5" align="start">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 pt-1 pb-1.5">
                            Add to profile
                          </p>
                          {toAdd.map(([s, p]) => {
                            const pid = profiles[s]?.id || "";
                            return (
                              <button
                                key={pid}
                                onClick={() => { addMemberToProfile(member.id, pid); toast({ title: `Added to ${p.name ?? s}` }); }}
                                className="w-full text-left px-2 py-2 text-sm rounded hover:bg-muted transition-colors flex items-baseline justify-between gap-2"
                              >
                                <span>{p.name ?? s}</span>
                                <span className="text-xs text-muted-foreground capitalize shrink-0">{s}</span>
                              </button>
                            );
                          })}
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>

                  {/* Actions — hover only */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                    <button
                      onClick={() => setEditEntry({ member: { ...member }, profileIds })}
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget({ id: member.id, name: member.name })}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Add Dialog ── */}
      <Dialog open={addOpen} onOpenChange={o => { if (!o) setAddOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1 max-h-[65vh] overflow-y-auto pr-1">
            <div>
              <Label className="mb-2 block">Profiles *</Label>
              <div className="space-y-1.5">
                {ownedProfiles.map(([s, p]) => {
                  const pid = profiles[s]?.id || "";
                  const isSelected = form.profileIds.includes(pid);
                  return (
                    <label
                      key={pid}
                      className={cn(
                        "flex items-center gap-2.5 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors",
                        isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={isSelected}
                        onChange={e => setForm(prev => ({
                          ...prev,
                          profileIds: e.target.checked
                            ? [...prev.profileIds, pid]
                            : prev.profileIds.filter(id => id !== pid),
                        }))}
                      />
                      <span className="text-sm font-medium">{p.name ?? s}</span>
                      <span className="text-xs text-muted-foreground capitalize ml-auto">{s}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" type="email" className="mt-1" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+1 555…" className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Role</Label>
              <RoleCombobox
                value={form.role}
                onChange={v => setForm(p => ({ ...p, role: v }))}
                options={[...presetRoles, "Member"]}
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Any notes…" className="mt-1 min-h-[70px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!form.name.trim() || form.profileIds.length === 0}>Add Member</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ── */}
      <Dialog open={!!editEntry} onOpenChange={o => { if (!o) setEditEntry(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit Team Member</DialogTitle></DialogHeader>
          {editEntry && (
            <div className="space-y-4 py-1 max-h-[60vh] overflow-y-auto pr-1">
              <div>
                <Label>Name</Label>
                <Input value={editEntry.member.name} onChange={e => setEditEntry(p => p ? { ...p, member: { ...p.member, name: e.target.value } } : p)} className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Email</Label>
                  <Input value={editEntry.member.email} onChange={e => setEditEntry(p => p ? { ...p, member: { ...p.member, email: e.target.value } } : p)} type="email" className="mt-1" />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input value={editEntry.member.phone ?? ""} onChange={e => setEditEntry(p => p ? { ...p, member: { ...p.member, phone: e.target.value } } : p)} className="mt-1" />
                </div>
              </div>
              <div>
                <Label>Role</Label>
                <RoleCombobox
                  value={editEntry.member.roles[0] ?? ""}
                  onChange={v => setEditEntry(p => p ? { ...p, member: { ...p.member, roles: [v] } } : p)}
                  options={[...(() => {
                    const roles = new Set<string>();
                    editEntry.profileIds.forEach(pid => {
                      const entry = Object.entries(profiles).find(([, p]) => p.id === pid);
                      (PRESET_ROLES[resolvePresetKey(entry)] ?? []).forEach(r => roles.add(r));
                    });
                    customRolesFromMembers.forEach(r => roles.add(r));
                    return Array.from(roles);
                  })(), "Member"]}
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={editEntry.member.status} onValueChange={v => setEditEntry(p => p ? { ...p, member: { ...p.member, status: v as "active" | "inactive" } } : p)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea value={editEntry.member.notes ?? ""} onChange={e => setEditEntry(p => p ? { ...p, member: { ...p.member, notes: e.target.value } } : p)} className="mt-1 min-h-[70px]" />
              </div>

              {/* Profile access */}
              <div>
                <Label className="mb-3 block">Profile access</Label>
                <ul className="space-y-1.5 mb-3">
                  {editEntry.profileIds.map(pid => (
                    <li key={pid} className="group/item flex items-center gap-2.5 py-1.5 px-3 rounded-lg border bg-muted/30">
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/40 shrink-0" />
                      <span className="text-sm flex-1">{profileName(pid)}</span>
                      <button
                        onClick={() => {
                          removeTeamMember(editEntry.member.id, pid);
                          setEditEntry(p => p ? { ...p, profileIds: p.profileIds.filter(id => id !== pid) } : p);
                        }}
                        className="text-muted-foreground/50 hover:text-destructive transition-colors"
                        title="Remove from profile"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                  {editEntry.profileIds.length === 0 && (
                    <li className="text-xs text-muted-foreground italic px-1">No profile access</li>
                  )}
                </ul>
                {unassignedProfilesFor(editEntry.profileIds).length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <Plus className="h-3.5 w-3.5" /> Add to another profile
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-1.5" align="start">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 pt-1 pb-1.5">
                        Add to profile
                      </p>
                      {unassignedProfilesFor(editEntry.profileIds).map(([s, p]) => {
                        const pid = profiles[s]?.id || "";
                        return (
                          <button
                            key={pid}
                            onClick={() => {
                              addMemberToProfile(editEntry.member.id, pid);
                              setEditEntry(prev => prev ? { ...prev, profileIds: [...prev.profileIds, pid] } : prev);
                              toast({ title: `Added to ${p.name ?? s}` });
                            }}
                            className="w-full text-left px-2 py-2 text-sm rounded hover:bg-muted transition-colors flex items-baseline justify-between gap-2"
                          >
                            <span>{p.name ?? s}</span>
                            <span className="text-xs text-muted-foreground capitalize shrink-0">{s}</span>
                          </button>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {deleteTarget?.name} from all profiles? They can be re-added later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAll}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
