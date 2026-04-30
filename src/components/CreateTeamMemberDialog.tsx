/**
 * Reusable dialog for creating a new TeamMember from anywhere in the app
 * (Team page, Tasks page assignee picker, etc.).
 *
 * Extracted from TeamMembersSection so any context that needs to "+ Create
 * new" a team member can render the same form. The Edit dialog stays in
 * TeamMembersSection since editing happens only on the Team page.
 *
 * The component is a pure dialog: the parent owns `open` state and gets the
 * created member back via `onCreated`. We don't dedupe by name/email here —
 * callers can layer that on top with the same `findDuplicates` helper used
 * by ContactsPage if they want a soft-warn.
 */

import { useEffect, useMemo, useState } from "react";
import { useUser, type TeamMember } from "@/lib/user-context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Curated role options per profile type. Kept here so the dialog is fully
 * self-contained — TeamMembersSection imports the same constant.
 */
export const PRESET_ROLES: Record<string, string[]> = {
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
  name: string;
  email: string;
  phone: string;
  role: string;
  status: "active" | "inactive";
  notes: string;
  profileIds: string[];
};

const emptyForm = (): FormState => ({
  name: "", email: "", phone: "", role: "Member", status: "active", notes: "", profileIds: [],
});

interface RoleComboboxProps {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  savedCustoms?: string[];
  onSaveCustom?: (role: string) => void;
}

function RoleCombobox({ value, onChange, options, savedCustoms, onSaveCustom }: RoleComboboxProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [customMode, setCustomMode] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const optionsLower = new Set(options.map(o => o.toLowerCase()));
  const cleanedCustoms = (savedCustoms ?? []).filter(c => c && !optionsLower.has(c.toLowerCase()));
  const filteredPresets = options.filter(o => o.toLowerCase().includes(inputValue.toLowerCase()));
  const filteredCustoms = cleanedCustoms.filter(o => o.toLowerCase().includes(inputValue.toLowerCase()));

  useEffect(() => { setInputValue(value); }, [value]);

  const commitCustom = () => {
    const trimmed = customDraft.trim();
    if (!trimmed) return;
    onChange(trimmed);
    setInputValue(trimmed);
    onSaveCustom?.(trimmed);
    setCustomDraft("");
    setCustomMode(false);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setCustomMode(false); setCustomDraft(""); } }}>
      <PopoverTrigger asChild>
        <Input
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); onChange(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Type or select role…"
          className="mt-1"
        />
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-1 max-h-64 overflow-y-auto" align="start" onOpenAutoFocus={e => e.preventDefault()}>
        {filteredPresets.map(r => (
          <button key={r} className={cn("w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted", r === value && "bg-muted font-medium")}
            onClick={() => { onChange(r); setInputValue(r); setOpen(false); }}>
            {r}
          </button>
        ))}
        {filteredCustoms.length > 0 && (
          <>
            <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Your custom roles</div>
            {filteredCustoms.map(r => (
              <button key={`custom-${r}`} className={cn("w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted", r === value && "bg-muted font-medium")}
                onClick={() => { onChange(r); setInputValue(r); setOpen(false); }}>
                {r}
              </button>
            ))}
          </>
        )}
        {customMode ? (
          <div className="flex items-center gap-1 px-1 py-1.5 border-t mt-1">
            <Input
              value={customDraft}
              onChange={e => setCustomDraft(e.target.value)}
              placeholder="New role name…"
              className="h-7 text-xs flex-1"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter") commitCustom(); if (e.key === "Escape") { setCustomMode(false); setCustomDraft(""); } }}
            />
            <Button size="sm" className="h-7 px-2 text-xs" disabled={!customDraft.trim()} onClick={commitCustom}>Save</Button>
          </div>
        ) : (
          <button
            className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted text-primary border-t mt-1"
            onClick={() => { setCustomMode(true); setCustomDraft(inputValue); }}
          >
            + Custom role…
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Resolve which preset bucket applies to a profile slot. Mirrors the
 * defensive fallback in TeamMembersSection — handles legacy slot keys like
 * "artist", "venue_2", and missing role fields.
 */
function resolvePresetKey(entry: [string, { role?: string }] | undefined): string {
  if (!entry) return "";
  const role = entry[1]?.role as string;
  if (PRESET_ROLES[role]) return role;
  const slot = entry[0];
  for (const key of Object.keys(PRESET_ROLES)) {
    if (slot.startsWith(key)) return key;
  }
  return role || slot;
}

export interface CreateTeamMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional default profile selection. Useful when the dialog is opened
   * from a context where the profile is already known (e.g. the Tasks page
   * task-create form has a selected event → its host profile). When
   * omitted, the user picks profiles inside the dialog.
   */
  defaultProfileIds?: string[];
  /**
   * Fired after a successful create. Parent can use this to immediately
   * select the new member in an assignee picker, etc.
   */
  onCreated?: (member: TeamMember) => void;
}

export default function CreateTeamMemberDialog({
  open,
  onOpenChange,
  defaultProfileIds,
  onCreated,
}: CreateTeamMemberDialogProps) {
  const { profiles, teamMembers, addTeamMember, addMemberToProfile, saveProfile } = useUser();
  const { user } = useAuth();

  const ownedProfiles = useMemo(() =>
    Object.entries(profiles).filter(
      ([, p]) => p.created && (p.owner_uid === user?.uid || p.id?.startsWith(`${user?.uid}__`)),
    ), [profiles, user?.uid]);

  const [form, setForm] = useState<FormState>(emptyForm());

  // Reset form state every time the dialog opens, seeding profileIds with the
  // caller's default (if provided) so the user doesn't need to pick again.
  useEffect(() => {
    if (open) {
      const seeded = (defaultProfileIds ?? []).filter(pid =>
        ownedProfiles.some(([s]) => profiles[s]?.id === pid),
      );
      setForm({ ...emptyForm(), profileIds: seeded });
    }
  }, [open, defaultProfileIds, ownedProfiles, profiles]);

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

  /** Aggregate persisted custom roles across the supplied profile IDs. */
  const customRolesForProfiles = (profileIds: string[]): string[] => {
    const set = new Set<string>();
    for (const pid of profileIds) {
      const entry = Object.entries(profiles).find(([, p]) => p.id === pid);
      const list = ((entry?.[1] as unknown as { customRoles?: string[] } | undefined)?.customRoles) ?? [];
      list.forEach(r => set.add(r));
    }
    return Array.from(set);
  };

  /** Persist a custom role onto every supplied profile's customRoles array. */
  const persistCustomRoleToProfiles = (profileIds: string[], role: string) => {
    const trimmed = role.trim();
    if (!trimmed) return;
    for (const pid of profileIds) {
      const entry = Object.entries(profiles).find(([, p]) => p.id === pid);
      if (!entry) continue;
      const [slot, profile] = entry;
      const current = ((profile as unknown as { customRoles?: string[] }).customRoles) ?? [];
      if (current.some(r => r.toLowerCase() === trimmed.toLowerCase())) continue;
      const next = [...current, trimmed];
      saveProfile(slot, { ...profile, customRoles: next } as typeof profile);
    }
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

  const handleAdd = () => {
    if (!form.name.trim() || form.profileIds.length === 0 || !user) return;
    const id = `TM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [firstPid, ...rest] = form.profileIds;
    const member: TeamMember = {
      id,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      roles: [form.role],
      status: form.status,
      notes: form.notes.trim(),
      profileId: firstPid,
    };
    addTeamMember(member, firstPid);
    rest.forEach(pid => addMemberToProfile(id, pid));
    toast({ title: "Team member added" });
    onCreated?.(member);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1 max-h-[65vh] overflow-y-auto pr-1">
          <div>
            <Label className="mb-2 block">Profiles *</Label>
            {ownedProfiles.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                You have no profiles yet. Create a profile first before adding team members.
              </p>
            ) : (
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
            )}
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
              savedCustoms={customRolesForProfiles(form.profileIds)}
              onSaveCustom={(role) => persistCustomRoleToProfiles(form.profileIds, role)}
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Any notes…" className="mt-1 min-h-[70px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleAdd}
            disabled={!form.name.trim() || form.profileIds.length === 0}
          >
            Add Member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
