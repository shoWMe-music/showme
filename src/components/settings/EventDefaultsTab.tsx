import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useUser, operatorRoleLabels, type OperatorRole } from "@/lib/user-context";

const ASK_VALUE = "__ask__";

export function EventDefaultsTab() {
  const { currentUser, setDefaultRole, updateUser } = useUser();
  const value = currentUser.defaultRole ?? ASK_VALUE;

  const handleChange = (next: string) => {
    if (next === ASK_VALUE) {
      updateUser({ defaultRole: undefined });
    } else {
      setDefaultRole(next as OperatorRole);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-1">Event creation</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Defaults applied when you create a new event.
        </p>
        <div>
          <Label>Default role</Label>
          <Select value={value} onValueChange={handleChange}>
            <SelectTrigger className="mt-1 w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ASK_VALUE}>Always ask</SelectItem>
              {(Object.keys(operatorRoleLabels) as OperatorRole[]).map((role) => (
                <SelectItem key={role} value={role}>
                  {operatorRoleLabels[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-2">
            Pre-selects this role on the first step of the create-event dialog.
          </p>
        </div>
      </div>
    </div>
  );
}
