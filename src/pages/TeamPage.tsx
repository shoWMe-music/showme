import AppLayout from "@/components/AppLayout";
import { TeamMembersSection } from "@/components/team/TeamMembersSection";
import { ProfileAdminsTab } from "@/components/team/ProfileAdminsTab";
import { Separator } from "@/components/ui/separator";

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
