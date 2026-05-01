import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser, operatorRoleLabels, operatorRoleDescriptions, type OperatorRole } from "@/lib/user-context";
import { canUserCreateEventsWithProfiles } from "@/lib/eventPermissions";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

interface RoleSelectionStepProps {
  selectedRole: OperatorRole | null;
  onRoleSelect: (role: OperatorRole) => void;
  onNext: () => void;
}

export function RoleSelectionStep({ selectedRole, onRoleSelect, onNext }: RoleSelectionStepProps) {
  const { currentUser, profiles } = useUser();

  const handleNext = () => {
    if (!canUserCreateEventsWithProfiles(profiles)) {
      toast({
        title: "Profile required",
        description:
          "Create a venue, organizer, promoter, or festival profile before you can create events.",
        variant: "destructive",
      });
      return;
    }
    onNext();
  };

  return (
    <div className="space-y-4 mt-2">
      <p className="text-sm text-muted-foreground">Which role are you taking for this event?</p>
      <div className="grid grid-cols-2 gap-3">
        {(Object.keys(operatorRoleLabels) as OperatorRole[]).map(role => (
          <button
            key={role}
            onClick={() => onRoleSelect(role)}
            className={cn(
              "relative rounded-xl border-2 p-4 text-left transition-all hover:shadow-md",
              selectedRole === role
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border hover:border-primary/50"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm">{operatorRoleLabels[role]}</p>
                  {currentUser.defaultRole === role && (
                    <span className="text-[10px] text-primary font-medium">Default</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{operatorRoleDescriptions[role]}</p>
              </div>
              {selectedRole === role && (
                <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
      <div className="flex justify-end pt-2">
        <Button onClick={handleNext} disabled={!selectedRole}>
          Next: Event Details
        </Button>
      </div>
    </div>
  );
}
