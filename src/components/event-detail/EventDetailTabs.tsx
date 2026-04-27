export type EventDetailTab = "overview" | "deal" | "revenue" | "settlement" | "payout";

const tabs: { id: EventDetailTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "deal", label: "Deal Structure" },
  { id: "revenue", label: "Revenue" },
  { id: "settlement", label: "Settlement" },
  { id: "payout", label: "Payout" },
];

interface EventDetailTabsProps {
  activeTab: EventDetailTab;
  onTabChange: (tab: EventDetailTab) => void;
}

export function EventDetailTabs({ activeTab, onTabChange }: EventDetailTabsProps) {
  return (
    <div className="mb-6 flex gap-1 border-b">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeTab === tab.id
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
