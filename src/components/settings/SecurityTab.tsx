import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { LogOut, ShieldCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface SecurityTabProps {
  onSignOut: () => void;
}

export function SecurityTab({ onSignOut }: SecurityTabProps) {
  const [tfaOpen, setTfaOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Security</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Two-Factor Authentication</p>
                  <Badge variant="outline" className="text-[10px]">Coming soon</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Add an extra layer of security to your account</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setTfaOpen(true)}>Enable</Button>
          </div>
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Active Sessions</p><p className="text-xs text-muted-foreground">Manage your logged-in devices</p></div>
            <Button variant="outline" size="sm" onClick={() => toast({ title: "Coming soon" })}>View</Button>
          </div>
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Sign out</p>
              <p className="text-xs text-muted-foreground">Leave shoWMe on this device</p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 gap-2 sm:self-center" onClick={onSignOut}>
              <LogOut className="h-3.5 w-3.5" />
              Log out
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={tfaOpen} onOpenChange={setTfaOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Two-Factor Authentication
            </DialogTitle>
            <DialogDescription>
              Protect your account with an authenticator app.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 text-center space-y-4">
            <div className="h-40 w-40 mx-auto rounded-lg bg-muted flex items-center justify-center border-2 border-dashed">
              <p className="text-xs text-muted-foreground">QR Code</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Two-factor authentication is not yet available. We'll notify you when this feature launches.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTfaOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
