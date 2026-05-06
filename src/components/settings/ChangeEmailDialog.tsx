import { useState } from "react";
import { httpsCallable, type FunctionsError } from "firebase/functions";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
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
  currentEmail: string;
}

export function ChangeEmailDialog({ open, onOpenChange, currentEmail }: Props) {
  const { toast } = useToast();
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setNewEmail("");
      setCurrentPassword("");
      setLoading(false);
      setSentTo(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = getAuthClient().currentUser;
    if (!user?.email) {
      toast({ title: "Not signed in", variant: "destructive" });
      return;
    }
    const trimmed = newEmail.trim().toLowerCase();
    if (trimmed === user.email.toLowerCase()) {
      toast({ title: "That's already your email", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, cred);

      const fn = httpsCallable<{ newEmail: string }, { ok: true }>(
        getFirebaseFunctions(),
        "sendVerifyAndChangeEmail",
      );
      await fn({ newEmail: trimmed });
      setSentTo(trimmed);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      const fnMsg = (err as FunctionsError).message;
      let description = "Could not change email. Try again.";
      if (code.includes("wrong-password") || code.includes("invalid-credential")) {
        description = "Current password is incorrect.";
      } else if (code.includes("already-exists") || /already in use/i.test(fnMsg ?? "")) {
        description = "That email is already in use by another account.";
      } else if (code.includes("invalid-argument") && fnMsg) {
        description = fnMsg;
      } else if (code.includes("too-many-requests")) {
        description = "Too many attempts. Try again later.";
      } else if (code.includes("requires-recent-login")) {
        description = "Please sign out and back in, then retry.";
      }
      toast({ title: "Failed", description, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (sentTo) {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Check your inbox</DialogTitle>
            <DialogDescription>
              We sent a confirmation link to <strong>{sentTo}</strong>. Click it
              to finish the change. Until then keep using <strong>{currentEmail}</strong> to
              sign in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => close(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change email</DialogTitle>
          <DialogDescription>
            We'll send a confirmation link to your new address. Your sign-in
            email only changes after you click the link.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Current email</Label>
            <Input value={currentEmail} disabled className="mt-1" />
          </div>
          <div>
            <Label htmlFor="new-email">New email</Label>
            <Input
              id="new-email"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="reauth-password">Current password</Label>
            <Input
              id="reauth-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => close(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Sending..." : "Send confirmation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
