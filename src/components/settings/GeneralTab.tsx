import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { useUser } from "@/lib/user-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Camera, Loader2 } from "lucide-react";
import { uploadUserBinary } from "@/lib/firebaseStorageUpload";
import { upsertUserSettings } from "@/lib/db";
import { resizeImage } from "@/lib/resizeImage";
import { ChangeEmailDialog } from "./ChangeEmailDialog";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

export function GeneralTab() {
  const { currentUser, updateUser, updateUserLocal } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  const [pendingAvatarBlobUrl, setPendingAvatarBlobUrl] = useState<string | null>(null);
  const [pendingAvatarUploadPromise, setPendingAvatarUploadPromise] = useState<Promise<string> | null>(null);
  const [pendingAvatarRemove, setPendingAvatarRemove] = useState(false);
  // Covers the full resize → blob URL → <img> decode lifecycle so the spinner
  // stays up until the new photo is actually visible.
  const [avatarPreviewLoading, setAvatarPreviewLoading] = useState(false);

  // Revoke any blob URL we created when it's replaced or the component unmounts.
  useEffect(() => {
    return () => {
      if (pendingAvatarBlobUrl) URL.revokeObjectURL(pendingAvatarBlobUrl);
    };
  }, [pendingAvatarBlobUrl]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
      return;
    }
    setAvatarPreviewLoading(true);
    // Resize to 200×200 first so the preview decodes instantly even for huge phone photos.
    let resized: File;
    try {
      resized = await resizeImage(file, 200);
    } catch {
      resized = file;
    }
    if (pendingAvatarBlobUrl) URL.revokeObjectURL(pendingAvatarBlobUrl);
    setPendingAvatarBlobUrl(URL.createObjectURL(resized));
    // Kick the upload off in the background so Save click usually only awaits the settings write.
    // Pre-attach a no-op catch so an early failure doesn't surface as an unhandled rejection;
    // we await the same promise on Save and let onError surface any real error there.
    const uploadPromise = uploadUserBinary(`avatar/${Date.now()}-${resized.name}`, resized, resized.type);
    uploadPromise.catch(() => undefined);
    setPendingAvatarUploadPromise(uploadPromise);
    setPendingAvatarRemove(false);
    // Spinner stays up until the <img> onLoad fires below.
  };

  const handleRemovePhoto = () => {
    if (pendingAvatarBlobUrl) URL.revokeObjectURL(pendingAvatarBlobUrl);
    setPendingAvatarBlobUrl(null);
    // Drop reference to any in-flight upload — it may finish in the background; the orphan is harmless.
    setPendingAvatarUploadPromise(null);
    setPendingAvatarRemove(true);
    setAvatarPreviewLoading(false);
  };

  const saveDetails = useMutation({
    mutationFn: async () => {
      let avatarUrl: string | undefined = currentUser.avatarUrl;
      if (pendingAvatarRemove) {
        avatarUrl = undefined;
      } else if (pendingAvatarUploadPromise) {
        // Upload was kicked off when the photo was picked; usually already resolved by now.
        avatarUrl = await pendingAvatarUploadPromise;
      }
      await upsertUserSettings({
        name: currentUser.name,
        email: currentUser.email,
        initials: currentUser.initials,
        roles: currentUser.roles,
        currency: currentUser.currency,
        defaultRole: currentUser.defaultRole,
        companyName: currentUser.companyName,
        avatarUrl,
        dateFormat: currentUser.dateFormat,
        timeFormat: currentUser.timeFormat,
      });
      return avatarUrl;
    },
    onSuccess: (avatarUrl) => {
      const hadAvatarChange = pendingAvatarUploadPromise !== null || pendingAvatarRemove;
      if (hadAvatarChange) {
        // Avatar was already persisted by the mutation; just sync local state
        // without triggering another debounced write.
        updateUserLocal({ avatarUrl });
      }
      // Intentionally keep pendingAvatarBlobUrl alive: swapping the <img> src to
      // the freshly-uploaded storage URL causes a fetch + decode flash even
      // though the bytes are identical. The blob URL stays displayed; it gets
      // revoked on next photo pick or unmount via the useEffect cleanup.
      setPendingAvatarUploadPromise(null);
      setPendingAvatarRemove(false);
      toast({ title: "Settings saved", description: "Your details have been updated." });
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not save details. Try again.", variant: "destructive" });
    },
  });

  const isSaving = saveDetails.isPending;
  // What to show in the avatar circle: blob preview wins, then "removed" → fallback, then current.
  const displayedAvatar = pendingAvatarBlobUrl ?? (pendingAvatarRemove ? null : currentUser.avatarUrl ?? null);

  return (
    <div className="space-y-6">
      {/* Profile */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Profile</h3>
        <div className="flex items-center gap-4 mb-6">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSaving || avatarPreviewLoading}
            className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-bold overflow-hidden group shrink-0 disabled:cursor-not-allowed"
          >
            {displayedAvatar ? (
              <img
                src={displayedAvatar}
                alt={currentUser.name}
                className="h-full w-full object-cover"
                onLoad={() => setAvatarPreviewLoading(false)}
                onError={() => setAvatarPreviewLoading(false)}
              />
            ) : (
              currentUser.initials
            )}
            {avatarPreviewLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 className="h-5 w-5 text-white animate-spin" />
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="h-5 w-5 text-white" />
              </div>
            )}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          <div>
            <p className="font-medium">{currentUser.name}</p>
            <p className="text-sm text-muted-foreground">{currentUser.email}</p>
            <div className="flex items-center gap-2 mt-2">
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => fileInputRef.current?.click()} disabled={isSaving || avatarPreviewLoading}>
                Change Photo
              </Button>
              {displayedAvatar && (
                <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground" disabled={isSaving || avatarPreviewLoading} onClick={handleRemovePhoto}>
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
            <div className="mt-1 flex items-center gap-2">
              <Input value={currentUser.email} readOnly className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => setEmailDialogOpen(true)}>
                Change
              </Button>
            </div>
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
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setPasswordDialogOpen(true)}>
          Change Password
        </Button>
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
        <Button className="gap-2" disabled={isSaving} onClick={() => saveDetails.mutate()}>
          {isSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : "Save Details"}
        </Button>
      </div>

      <ChangeEmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        currentEmail={currentUser.email}
      />
      <ChangePasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
      />
    </div>
  );
}
