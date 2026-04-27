import AppLayout from "@/components/AppLayout";
import { TeamMembersSection } from "@/components/team/TeamMembersSection";
import { ProfileAdminsTab } from "@/components/team/ProfileAdminsTab";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMyInvitationCodes, useRevokeInvitationCode } from "@/lib/queries/useInvitationCodes";
import { Copy, XCircle, Mail, Loader2 } from "lucide-react";
import { toast, copyToast } from "@/hooks/use-toast";

export default function TeamPage() {
  return (
    <AppLayout>
      <div className="animate-fade-in max-w-4xl space-y-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground mt-1">Manage crew and administrators for your profiles.</p>
        </div>

        <section>
          <h2 className="text-lg font-semibold mb-1">Team Members</h2>
          <TeamMembersSection />
        </section>

        <Separator />

        <PendingInvitationsSection />

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-1">Profile Access</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Invite collaborators who can manage your profiles and events via their own account.
          </p>
          <ProfileAdminsTab />
        </section>
      </div>
    </AppLayout>
  );
}

const statusColors: Record<string, string> = {
  active: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  used: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  revoked: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

function PendingInvitationsSection() {
  const { data: codes, isLoading } = useMyInvitationCodes();
  const revokeMutation = useRevokeInvitationCode();

  // Only show active invitations
  const activeCodes = codes?.filter((c) => c.status === "active") ?? [];
  const usedCodes = codes?.filter((c) => c.status === "used") ?? [];

  if (isLoading) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-1">Pending Invitations</h2>
        <div className="flex items-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      </section>
    );
  }

  if (activeCodes.length === 0 && usedCodes.length === 0) {
    return null; // Don't show section if no invitations
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">Invitations</h2>
      <p className="text-sm text-muted-foreground mb-4">
        People you've invited to collaborate on events.
      </p>
      <div className="rounded-xl border bg-card shadow-sm divide-y">
        {activeCodes.map((c) => (
          <div key={c.code} className="px-5 py-4 flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
              {(c.recipientName || c.recipientEmail || "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">
                  {c.recipientName || c.recipientEmail || "Unnamed invitation"}
                </p>
                <Badge variant="outline" className={`text-xs ${statusColors.active}`}>
                  Pending
                </Badge>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                {c.recipientEmail && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Mail className="h-3 w-3" /> {c.recipientEmail}
                  </span>
                )}
                {c.recipientRole && (
                  <span className="text-xs text-muted-foreground capitalize">{c.recipientRole}</span>
                )}
              </div>
            </div>
            <Badge variant="outline" className="text-xs font-mono shrink-0">
              {c.code}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(c.code);
                copyToast("Code copied to clipboard");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
              disabled={revokeMutation.isPending}
              onClick={() => revokeMutation.mutate(c.code)}
            >
              <XCircle className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {usedCodes.map((c) => (
          <div key={c.code} className="px-5 py-4 flex items-center gap-4 opacity-60">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-bold shrink-0">
              {(c.recipientName || c.recipientEmail || "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">
                  {c.recipientName || c.recipientEmail || "Unnamed invitation"}
                </p>
                <Badge variant="outline" className={`text-xs ${statusColors.used}`}>
                  Joined
                </Badge>
              </div>
              {c.recipientEmail && (
                <p className="text-xs text-muted-foreground mt-0.5">{c.recipientEmail}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
