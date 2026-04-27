import { KeyboardEvent } from "react";
import { useUser, type OperatorRole, operatorRoleLabels, type SharedProfile, type ProfileLocation } from "@/lib/user-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Globe, Plus, X } from "lucide-react";

interface SharedProfileEditorDialogProps {
  editingProfile: OperatorRole | null;
  currentProfile: Partial<SharedProfile> | null;
  genreInput: string;
  setGenreInput: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
  onGenreKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onRemoveGenre: (genre: string) => void;
}

export function SharedProfileEditorDialog({
  editingProfile,
  currentProfile,
  genreInput,
  setGenreInput,
  onClose,
  onSave,
  onGenreKeyDown,
  onRemoveGenre,
}: SharedProfileEditorDialogProps) {
  const { setProfiles } = useUser();

  return (
    <Dialog open={editingProfile !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {currentProfile?.created ? "Edit" : "Create"} Shared Profile — {editingProfile ? operatorRoleLabels[editingProfile] : ""}
          </DialogTitle>
        </DialogHeader>
        {currentProfile && editingProfile && (
          <div className="space-y-4 py-2">
            <div>
              <Label>Display Name</Label>
              <Input value={currentProfile.name} onChange={(e) => setProfiles(prev => ({ ...prev, [editingProfile]: { ...prev[editingProfile], name: e.target.value } }))} placeholder="Your public name" className="mt-1" />
            </div>
            <div>
              <Label>Location</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <Input value={currentProfile.locations?.[0]?.city || ""} onChange={(e) => setProfiles(prev => {
                  const p = prev[editingProfile];
                  const loc = p.locations?.[0] || { id: "loc-primary", label: "Primary", city: "", country: "" };
                  return { ...prev, [editingProfile]: { ...p, locations: [{ ...loc, city: e.target.value }, ...(p.locations?.slice(1) || [])] } };
                })} placeholder="City" />
                <Input value={currentProfile.locations?.[0]?.country || ""} onChange={(e) => setProfiles(prev => {
                  const p = prev[editingProfile];
                  const loc = p.locations?.[0] || { id: "loc-primary", label: "Primary", city: "", country: "" };
                  return { ...prev, [editingProfile]: { ...p, locations: [{ ...loc, country: e.target.value }, ...(p.locations?.slice(1) || [])] } };
                })} placeholder="Country" />
              </div>
            </div>
            <div>
              <Label>Bio</Label>
              <Textarea value={currentProfile.bio} onChange={(e) => setProfiles(prev => ({ ...prev, [editingProfile]: { ...prev[editingProfile], bio: e.target.value } }))} placeholder="Tell others about yourself..." className="mt-1" rows={3} />
            </div>

            {editingProfile === "venue" && (
              <div>
                <Label>Capacity</Label>
                <Input type="number" value={currentProfile.capacity || ""} onChange={(e) => setProfiles(prev => ({ ...prev, [editingProfile]: { ...prev[editingProfile], capacity: parseInt(e.target.value) || 0 } }))} placeholder="Max capacity" className="mt-1" />
              </div>
            )}

            {editingProfile === "artist" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Setup Type</Label>
                  <Input value={currentProfile.setupType || ""} onChange={(e) => setProfiles(prev => ({ ...prev, [editingProfile]: { ...prev[editingProfile], setupType: e.target.value } }))} placeholder="e.g. Solo, Duo, Full Band" className="mt-1" />
                </div>
                <div>
                  <Label>Setup Size</Label>
                  <Input type="number" value={currentProfile.setupSize || ""} onChange={(e) => setProfiles(prev => ({ ...prev, [editingProfile]: { ...prev[editingProfile], setupSize: parseInt(e.target.value) || 1 } }))} placeholder="Number of performers" className="mt-1" />
                </div>
              </div>
            )}

            <div>
              <Label>Genres</Label>
              <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                {(currentProfile.genres || []).map((genre) => (
                  <Badge key={genre} variant="secondary" className="gap-1 pr-1">
                    {genre}
                    <button onClick={() => onRemoveGenre(genre)} className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <Input
                value={genreInput}
                onChange={(e) => setGenreInput(e.target.value)}
                onKeyDown={onGenreKeyDown}
                placeholder="Type a genre and press Enter or comma"
              />
            </div>

            <div>
              <Label className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Social Media Links
              </Label>
              <div className="space-y-2 mt-1">
                {(currentProfile.socialLinks || []).map((link, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={link.platform} onChange={(e) => {
                      const links = [...(currentProfile.socialLinks || [])];
                      links[i] = { ...links[i], platform: e.target.value };
                      setProfiles(prev => ({ ...prev, [editingProfile]: { ...prev[editingProfile], socialLinks: links } }));
                    }} placeholder="Platform" className="w-32" />
                    <Input value={link.url} onChange={(e) => {
                      const links = [...(currentProfile.socialLinks || [])];
                      links[i] = { ...links[i], url: e.target.value };
                      setProfiles(prev => ({ ...prev, [editingProfile]: { ...prev[editingProfile], socialLinks: links } }));
                    }} placeholder="https://..." className="flex-1" />
                    <Button variant="ghost" size="icon" onClick={() => {
                      const links = (currentProfile.socialLinks || []).filter((_, j) => j !== i);
                      setProfiles(prev => ({ ...prev, [editingProfile]: { ...prev[editingProfile], socialLinks: links } }));
                    }}><X className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                  const links = [...(currentProfile.socialLinks || []), { platform: "", url: "" }];
                  setProfiles(prev => ({ ...prev, [editingProfile]: { ...prev[editingProfile], socialLinks: links } }));
                }}><Plus className="h-3 w-3 mr-1" /> Add Link</Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              <strong>How Shared Profiles work:</strong> Your shared profile information becomes visible to other shoWMe users when you accept a collaborator invitation.
              Your details will automatically be added to their Contacts list, saving time on data entry.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave}>{currentProfile?.created ? "Save Changes" : "Create Profile"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
