import { useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { useUser } from "@/lib/user-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Camera } from "lucide-react";
import { uploadUserBinary } from "@/lib/firebaseStorageUpload";

export function GeneralTab() {
  const { currentUser, updateUser } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const url = await uploadUserBinary(`avatar/${Date.now()}-${file.name}`, file, file.type);
      updateUser({ avatarUrl: url });
      toast({ title: "Photo updated" });
    } catch {
      toast({ title: "Upload failed", description: "Could not upload photo. Try again.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      {/* Profile */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Profile</h3>
        <div className="flex items-center gap-4 mb-6">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-bold overflow-hidden group shrink-0"
          >
            {currentUser.avatarUrl ? (
              <img src={currentUser.avatarUrl} alt={currentUser.name} className="h-full w-full object-cover" />
            ) : (
              currentUser.initials
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="h-5 w-5 text-white" />
            </div>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          <div>
            <p className="font-medium">{currentUser.name}</p>
            <p className="text-sm text-muted-foreground">{currentUser.email}</p>
            <div className="flex items-center gap-2 mt-2">
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? "Uploading..." : "Change Photo"}
              </Button>
              {currentUser.avatarUrl && (
                <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground" onClick={() => updateUser({ avatarUrl: undefined })}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Full Name</Label>
            <Input value={currentUser.name} onChange={(e) => updateUser({ name: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={currentUser.email} onChange={(e) => updateUser({ email: e.target.value })} className="mt-1" />
          </div>
        </div>
        <div className="mt-4">
          <Label>Preferred Currency</Label>
          <Select value={currentUser.currency || "EUR"} onValueChange={(v) => updateUser({ currency: v })}>
            <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="USD">USD ($)</SelectItem>
              <SelectItem value="GBP">GBP (£)</SelectItem>
              <SelectItem value="SEK">SEK (kr)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <Label>Date Format</Label>
            <Select value={currentUser.dateFormat || "YYYY-MM-DD"} onValueChange={(v) => updateUser({ dateFormat: v as "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Time Format</Label>
            <Select value={currentUser.timeFormat || "24h"} onValueChange={(v) => updateUser({ timeFormat: v as "24h" | "12h" })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24-hour (14:00)</SelectItem>
                <SelectItem value="12h">12-hour (2:00 PM)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button variant="outline" size="sm" className="mt-4">Change Password</Button>
      </div>

      {/* Organization */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Organization</h3>
        <div>
          <Label>Company Name</Label>
          <Input className="mt-1" value={currentUser.companyName} onChange={(e) => updateUser({ companyName: e.target.value })} placeholder="Enter company name" />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button className="gap-2" onClick={() => toast({ title: "Settings saved", description: "Your details have been updated." })}>
          Save Details
        </Button>
      </div>
    </div>
  );
}
