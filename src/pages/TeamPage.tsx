import AppLayout from "@/components/AppLayout";
import { TeamMembersSection } from "@/components/team/TeamMembersSection";

export default function TeamPage() {
  return (
    <AppLayout>
      <div className="animate-fade-in max-w-4xl space-y-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground mt-1">Manage crew for your profiles.</p>
        </div>

        <TeamMembersSection />
      </div>
    </AppLayout>
  );
}
