import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getAuthClient } from "@/lib/firebaseAuth";
import { getFirebaseFunctions } from "@/integrations/firebase/app";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function ChangePasswordDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({
        title: "Password too short",
        description: "Use at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    const user = getAuthClient().currentUser;
    if (!user?.email) {
      toast({ title: "Not signed in", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, newPassword);
      toast({ title: "Password updated" });
      close(false);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      let description = "Could not update password. Try again.";
      if (code.includes("wrong-password") || code.includes("invalid-credential")) {
        description = "Current password is incorrect.";
      } else if (code.includes("weak-password")) {
        description = "New password is too weak.";
      } else if (code.includes("too-many-requests")) {
        description = "Too many attempts. Try again in a few minutes.";
      } else if (code.includes("requires-recent-login")) {
        description = "Please sign out and back in, then retry.";
      }
      toast({ title: "Failed", description, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async () => {
    const user = getAuthClient().currentUser;
    if (!user?.email) return;
    setLoading(true);
    try {
      const fn = httpsCallable(getFirebaseFunctions(), "sendPasswordReset");
      await fn({ email: user.email });
      toast({
        title: "Reset link sent",
        description: `Check ${user.email} for a password reset email.`,
      });
      close(false);
    } catch {
      toast({ title: "Could not send reset email", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Enter your current password to confirm, then choose a new one.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="mt-1"
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={handleForgot}
            >
              Forgot password?
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => close(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Updating..." : "Update password"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
