import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TAB_SECTIONS, type SelectionLevel } from "./types";

interface SectionSelectorProps {
  level: SelectionLevel;
  selectedTabs: Set<string>;
  selectedSections: Set<string>;
  expandedTabs: Set<string>;
  onToggleTab: (tabId: string) => void;
  onToggleSection: (sectionId: string, tabId: string) => void;
  onToggleExpandTab: (tabId: string) => void;
}

export function SectionSelector({
  level,
  selectedTabs,
  selectedSections,
  expandedTabs,
  onToggleTab,
  onToggleSection,
  onToggleExpandTab,
}: SectionSelectorProps) {
  return (
    <div className="space-y-1 border rounded-lg p-3 bg-muted/20 max-h-[250px] overflow-y-auto">
      {Object.entries(TAB_SECTIONS).map(([tabId, tab]) => (
        <div key={tabId}>
          <div className="flex items-center gap-2 py-1.5">
            {level === "sections" && (
              <button onClick={() => onToggleExpandTab(tabId)} className="p-0.5">
                {expandedTabs.has(tabId) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            )}
            <Checkbox id={`tab-${tabId}`} checked={selectedTabs.has(tabId)} onCheckedChange={() => onToggleTab(tabId)} />
            <Label htmlFor={`tab-${tabId}`} className="text-sm cursor-pointer font-medium">{tab.label}</Label>
          </div>
          {level === "sections" && expandedTabs.has(tabId) && (
            <div className="ml-8 space-y-1 pb-1">
              {tab.sections.map(sec => (
                <div key={sec.id} className="flex items-center gap-2 py-0.5">
                  <Checkbox id={`sec-${sec.id}`} checked={selectedSections.has(sec.id)} onCheckedChange={() => onToggleSection(sec.id, tabId)} />
                  <Label htmlFor={`sec-${sec.id}`} className="text-xs cursor-pointer">{sec.label}</Label>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
