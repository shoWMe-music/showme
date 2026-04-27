import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function AppearanceTab() {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h3 className="font-display text-lg font-semibold mb-4">Appearance</h3>
      <div className="flex items-center justify-between">
        <div><p className="text-sm font-medium">Theme</p><p className="text-xs text-muted-foreground">Choose your preferred color scheme</p></div>
        <Select defaultValue="light">
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
