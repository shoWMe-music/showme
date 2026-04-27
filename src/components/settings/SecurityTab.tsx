import { Button } from "@/components/ui/button";

import { LogOut } from "lucide-react";

interface SecurityTabProps {
  onSignOut: () => void;
}

export function SecurityTab({ onSignOut }: SecurityTabProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Security</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Two-Factor Authentication</p><p className="text-xs text-muted-foreground">Add an extra layer of security</p></div>
            <Button variant="outline" size="sm">Enable</Button>
          </div>
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Active Sessions</p><p className="text-xs text-muted-foreground">Manage your logged-in devices</p></div>
            <Button variant="outline" size="sm">View</Button>
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
    </div>
  );
}
