import { useState } from "react";
import { Check } from "lucide-react";
import { useUser, operatorRoleLabels, type OperatorRole, type SharedProfile, type ProfileLocation } from "@/lib/user-context";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const ALL_ROLES: OperatorRole[] = ["venue", "promoter", "organizer", "performer", "festival"];

function nextSlot(profiles: Record<string, SharedProfile>, role: OperatorRole): string {
  if (!profiles[role]?.created) return role;
  let i = 2;
  while (profiles[`${role}_${i}`]?.created) i++;
  return `${role}_${i}`;
}

const ROLE_DESCRIPTIONS: Record<OperatorRole, string> = {
  venue: "Host events at your space",
  promoter: "Promote and book events",
  organizer: "Produce and manage events",
  artist: "Perform at venues and events",
  festival: "Run multi-stage festivals",
};

type Form = {
  name: string;
  city: string;
  country: string;
  bio: string;
  capacity: string;
  setupType: string;
};

const emptyForm = (): Form => ({ name: "", city: "", country: "", bio: "", capacity: "", setupType: "" });

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (role: string) => void;
}

export function CreateProfileDialog({ open, onOpenChange, onCreated }: Props) {
  const { profiles, currentUser, setProfiles, saveProfile, updateRoles } = useUser();

  const [step, setStep] = useState(0);
  const [selectedRole, setSelectedRole] = useState<OperatorRole | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());


  const reset = () => {
    setStep(0);
    setSelectedRole(null);
    setForm(emptyForm());
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleNext = () => {
    if (!selectedRole) return;
    setForm(f => ({ ...f, name: f.name || currentUser.name || "" }));
    setStep(1);
  };

  const handleCreate = () => {
    if (!selectedRole || !form.name.trim()) return;

    const slot = nextSlot(profiles, selectedRole);
    const slug = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || slot;
    const locations: ProfileLocation[] = form.city.trim() || form.country.trim()
      ? [{ id: "loc-primary", label: "Primary", city: form.city.trim(), country: form.country.trim() }]
      : [];
    const profile: SharedProfile = {
      role: selectedRole,
      name: form.name.trim(),
      locations,
      bio: form.bio.trim(),
      genres: [],
      socialLinks: [],
      capacity: form.capacity ? parseInt(form.capacity) : undefined,
      setupType: form.setupType.trim() || undefined,
      slug,
      isPublic: true,
      created: true,
    };

    if (!currentUser.roles.includes(selectedRole)) {
      updateRoles([...currentUser.roles, selectedRole]);
    }

    saveProfile(slot, profile);
    onCreated(slot);
    handleOpenChange(false);
  };

  const stepTitles = ["Choose Profile Type", "Profile Details"];
  const stepDesc = [
    "What type of profile do you want to create?",
    `Set up your ${selectedRole ? operatorRoleLabels[selectedRole] : ""} profile`,
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{stepTitles[step]}</DialogTitle>
          <DialogDescription>
            Step {step + 1} of 2 — {stepDesc[step]}
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              {ALL_ROLES.map(role => (
                  <button
                    key={role}
                    onClick={() => setSelectedRole(role)}
                    className={cn(
                      "relative rounded-xl border-2 p-4 text-left transition-all hover:shadow-md",
                      selectedRole === role
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm">{operatorRoleLabels[role]}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{ROLE_DESCRIPTIONS[role]}</p>
                      </div>
                      {selectedRole === role && (
                        <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  </button>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={handleNext} disabled={!selectedRole}>
                Next: Profile Details
              </Button>
            </div>
          </div>
        )}

        {step === 1 && selectedRole && (
          <div className="space-y-4 mt-2">
            <div>
              <Label>Display Name *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Your public name"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label>Location</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <Input
                  value={form.city}
                  onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                  placeholder="City"
                />
                <Input
                  value={form.country}
                  onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                  placeholder="Country"
                />
              </div>
            </div>
            <div>
              <Label>Bio</Label>
              <Textarea
                value={form.bio}
                onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                placeholder={selectedRole === "venue" ? "Tell artists about your venue…" : "Tell venues and promoters about yourself…"}
                className="mt-1"
                rows={3}
              />
            </div>
            {selectedRole === "venue" && (
              <div>
                <Label>Capacity</Label>
                <Input
                  type="number"
                  value={form.capacity}
                  onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                  placeholder="Max capacity"
                  className="mt-1"
                />
              </div>
            )}
            {selectedRole === "performer" && (
              <div>
                <Label>Setup Type</Label>
                <Input
                  value={form.setupType}
                  onChange={e => setForm(f => ({ ...f, setupType: e.target.value }))}
                  placeholder="e.g. Band, DJ, Solo"
                  className="mt-1"
                />
              </div>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
              <Button onClick={handleCreate} disabled={!form.name.trim()}>
                Create Profile
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
