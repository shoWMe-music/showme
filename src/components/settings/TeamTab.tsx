import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function TeamTab() {
  return (
    <div className="rounded-xl border bg-card p-12 text-center">
      <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
      <p className="font-medium mb-1">Team management has moved</p>
      <p className="text-sm text-muted-foreground mb-4">
        Manage your crew and profile administrators from the dedicated Team page.
      </p>
      <Button asChild>
        <Link to="/team">Go to Team</Link>
      </Button>
    </div>
  );
}
