import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import NumberInput from "@/components/NumberInput";
import { PerformerSearch } from "@/components/PerformerSearch";
import { StageRoomSelect, type StageOption } from "@/components/StageRoomSelect";
import { getCurrencySymbol } from "@/lib/models";
import type { DealType } from "@/lib/models";

export type PerformerRoleTag = "headliner" | "support" | "special_guest" | "dj" | "opener";

export const PERFORMER_ROLE_TAG_LABELS: Record<PerformerRoleTag, string> = {
  headliner: "Headliner",
  support: "Support",
  special_guest: "Special Guest",
  dj: "DJ",
  opener: "Opener",
};

export interface PerformerFormValues {
  artistName: string;
  performerProfileId: string;
  performerRoleTag?: PerformerRoleTag;
  stageRoom: string;
  stageCapacity: string;
  dealType: DealType;
  artistGuarantee: string;
  artistSplit: string;
  promoterSplit: string;
  venueSplit: string;
}

interface PerformerFormFieldsProps {
  values: PerformerFormValues;
  onChange: (updates: Partial<PerformerFormValues>) => void;
  stageOptions: StageOption[];
  onStageCreated?: (name: string, capacity: string) => void;
  currency?: string;
}

export function PerformerFormFields({ values, onChange, stageOptions, onStageCreated, currency = "EUR" }: PerformerFormFieldsProps) {
  const showGuarantee = values.dealType === "guarantee" || values.dealType === "guarantee_vs_door";
  const showSplits = values.dealType !== "guarantee" && values.dealType !== "rental";
  const splitSum = (parseFloat(values.artistSplit) || 0) + (parseFloat(values.promoterSplit) || 0) + (parseFloat(values.venueSplit) || 0);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-xs">Performer Name</Label>
        <PerformerSearch
          value={values.artistName}
          onChange={(name, profile) => onChange({ artistName: name, performerProfileId: profile?.id || "" })}
          placeholder="Search or type artist name"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Role</Label>
        <Select value={values.performerRoleTag || ""} onValueChange={v => onChange({ performerRoleTag: (v || undefined) as PerformerRoleTag | undefined })}>
          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select role…" /></SelectTrigger>
          <SelectContent>
            {Object.entries(PERFORMER_ROLE_TAG_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StageRoomSelect
          stages={stageOptions}
          value={values.stageRoom}
          onValueChange={(stage, capacity) => {
            onChange({ stageRoom: stage, ...(capacity ? { stageCapacity: capacity } : {}) });
          }}
          onStageCreated={onStageCreated}
        />
        <div className="space-y-2">
          <Label className="text-xs">Stage Capacity</Label>
          <NumberInput
            value={values.stageCapacity}
            onChange={e => onChange({ stageCapacity: e.target.value })}
            placeholder="0"
            className="h-9 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-xs">Deal Type</Label>
          <Select value={values.dealType} onValueChange={v => onChange({ dealType: v as DealType })}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="guarantee">Guarantee</SelectItem>
              <SelectItem value="door_split">Door Split</SelectItem>
              <SelectItem value="guarantee_vs_door">Guarantee vs Door</SelectItem>
              <SelectItem value="rental">Rental</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className={cn("text-xs", !showGuarantee && "text-muted-foreground")}>
            Guarantee ({getCurrencySymbol(currency)})
          </Label>
          <NumberInput
            value={values.artistGuarantee}
            onChange={e => onChange({ artistGuarantee: e.target.value })}
            placeholder="0"
            disabled={!showGuarantee}
            className="h-9 text-xs"
          />
        </div>
      </div>

      {showSplits && (
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Performer %</Label>
            <NumberInput value={values.artistSplit} onChange={e => {
              const val = e.target.value;
              const p = parseFloat(values.promoterSplit) || 0;
              onChange({ artistSplit: val, venueSplit: String(Math.max(0, 100 - (parseFloat(val) || 0) - p)) });
            }} placeholder="70" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Promoter %</Label>
            <NumberInput value={values.promoterSplit} onChange={e => {
              const val = e.target.value;
              const a = parseFloat(values.artistSplit) || 0;
              onChange({ promoterSplit: val, venueSplit: String(Math.max(0, 100 - a - (parseFloat(val) || 0))) });
            }} placeholder="20" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Venue %</Label>
            <NumberInput value={values.venueSplit} onChange={e => {
              const val = e.target.value;
              const a = parseFloat(values.artistSplit) || 0;
              onChange({ venueSplit: val, promoterSplit: String(Math.max(0, 100 - a - (parseFloat(val) || 0))) });
            }} placeholder="10" className="h-8 text-xs" />
          </div>
          {splitSum !== 100 && (
            <p className="col-span-3 text-[10px] text-destructive">Split: {splitSum}% — must equal 100%</p>
          )}
        </div>
      )}
    </div>
  );
}
