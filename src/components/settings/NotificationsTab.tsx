import { Switch } from "@/components/ui/switch";

const notificationItems = [
  "Settlement status updates",
  "New disputes",
  "Payout confirmations",
  "Event status changes",
  "Collaborator invitations",
  "New comments on settlements",
  "Team member activity",
  "Weekly summary email",
];

export function NotificationsTab() {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h3 className="font-display text-lg font-semibold mb-4">Notification Preferences</h3>
      <div className="space-y-4">
        {notificationItems.map((item) => (
          <div key={item} className="flex items-center justify-between">
            <span className="text-sm">{item}</span>
            <Switch defaultChecked />
          </div>
        ))}
      </div>
    </div>
  );
}
