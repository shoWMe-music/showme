import { Plus, X, GripVertical, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import NumberInput from "@/components/NumberInput";
import ContactCombobox from "@/components/ContactCombobox";
import { getCurrencySymbol } from "@/lib/models";
import type { DealType } from "@/lib/models";
import type { PartyState } from "./types";
import { AVAILABLE_PARTIES } from "./types";

interface DealStructureStepProps {
  onBack: () => void;
  onSubmit: () => void;

  dealType: DealType;
  setDealType: (v: DealType) => void;

  artistGuarantee: string;
  setArtistGuarantee: (v: string) => void;

  artistSplit: string;
  promoterSplit: string;
  venueSplit: string;
  handleSplitChange: (field: "artist" | "promoter" | "venue", value: string) => void;

  costResponsibility: "none" | "split" | "me";
  setCostResponsibility: (v: "none" | "split" | "me") => void;

  artistCostSplit: string;
  setArtistCostSplit: (v: string) => void;
  promoterCostSplit: string;
  setPromoterCostSplit: (v: string) => void;
  venueCostSplit: string;
  setVenueCostSplit: (v: string) => void;

  venueRental: string;
  setVenueRental: (v: string) => void;
  venueRentalPaymentMode: "request_now" | "deduct_at_settlement";
  setVenueRentalPaymentMode: (v: "request_now" | "deduct_at_settlement") => void;

  parties: PartyState[];
  dragIndex: number | null;
  handleDragStart: (index: number) => void;
  handleDragOver: (e: React.DragEvent, index: number) => void;
  handleDragEnd: () => void;
  addParty: (key: string) => void;
  removeParty: (index: number) => void;
  updateParty: (index: number, field: "name" | "percentage", value: string) => void;

  isPromoter: boolean;
  isPerformer: boolean;
  isSubmitting: boolean;
}

export function DealStructureStep({
  onBack, onSubmit, isSubmitting,
  dealType, setDealType,
  artistGuarantee, setArtistGuarantee,
  artistSplit, promoterSplit, venueSplit, handleSplitChange,
  costResponsibility, setCostResponsibility,
  artistCostSplit, setArtistCostSplit,
  promoterCostSplit, setPromoterCostSplit,
  venueCostSplit, setVenueCostSplit,
  venueRental, setVenueRental,
  venueRentalPaymentMode, setVenueRentalPaymentMode,
  parties, dragIndex,
  handleDragStart, handleDragOver, handleDragEnd,
  addParty, removeParty, updateParty,
  isPromoter,
  isPerformer,
}: DealStructureStepProps) {
  const showRevenueSplit = dealType === "door_split" || dealType === "guarantee_vs_door";
  const showVenueRental = dealType === "rental";
  const splitSum = (parseFloat(artistSplit) || 0) + (parseFloat(promoterSplit) || 0) + (parseFloat(venueSplit) || 0);
  const costSplitSum = (parseFloat(artistCostSplit) || 0) + (parseFloat(promoterCostSplit) || 0) + (parseFloat(venueCostSplit) || 0);
  const availableToAdd = AVAILABLE_PARTIES.filter(ap => !parties.some(p => p.key === ap.key));
  const submitDisabled =
    (showRevenueSplit && splitSum !== 100) ||
    (costResponsibility === "split" && costSplitSum !== 100);

  return (
    <div className="space-y-4 mt-2">
      <div className="space-y-2">
        <Label>Deal Type</Label>
        <Select value={dealType} onValueChange={(v) => setDealType(v as DealType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="guarantee">Guarantee</SelectItem>
            <SelectItem value="door_split">Door Split</SelectItem>
            <SelectItem value="guarantee_vs_door">Guarantee vs Door</SelectItem>
            <SelectItem value="rental">Rental</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(dealType === "guarantee" || dealType === "guarantee_vs_door") && (
        <div className="space-y-2">
          <Label>Performer Guarantee ({getCurrencySymbol()})</Label>
          <Input
            type="number"
            value={artistGuarantee}
            onChange={e => setArtistGuarantee(e.target.value)}
            placeholder="0"
          />
        </div>
      )}

      {/* Revenue Split — only for door_split and guarantee_vs_door */}
      {showRevenueSplit && (
        <div className="space-y-2">
          <Label>Revenue Split (must total 100%)</Label>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Performer %</Label>
              <NumberInput value={artistSplit} onChange={e => handleSplitChange("artist", e.target.value)} placeholder="70" min="0" max="100" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Promoter %</Label>
              <NumberInput value={promoterSplit} onChange={e => handleSplitChange("promoter", e.target.value)} placeholder="20" min="0" max="100" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Venue %</Label>
              <NumberInput value={venueSplit} onChange={e => handleSplitChange("venue", e.target.value)} placeholder="10" min="0" max="100" />
            </div>
          </div>
          {splitSum !== 100 && (
            <p className="text-xs text-destructive">Split total: {splitSum}% — must equal 100%</p>
          )}
        </div>
      )}

      {/* Cost Responsibility */}
      <div className="space-y-3">
        {costResponsibility === "none" ? (
          <Button variant="outline" size="sm" onClick={() => setCostResponsibility("split")} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Costs Split
          </Button>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Label>Cost Responsibility</Label>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={() => { setCostResponsibility("none"); setPromoterCostSplit("50"); setVenueCostSplit("30"); setArtistCostSplit("20"); }}>
                <X className="h-3 w-3 mr-1" /> Remove
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setCostResponsibility("split")}
                className={cn(
                  "rounded-lg border-2 p-3 text-left text-sm transition-all",
                  costResponsibility === "split" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                )}
              >
                <p className="font-semibold">Split costs</p>
                <p className="text-xs text-muted-foreground mt-1">Split between collaborators</p>
              </button>
              <button
                type="button"
                onClick={() => { setCostResponsibility("me"); setPromoterCostSplit("100"); setVenueCostSplit("0"); setArtistCostSplit("0"); }}
                className={cn(
                  "rounded-lg border-2 p-3 text-left text-sm transition-all",
                  costResponsibility === "me" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                )}
              >
                <p className="font-semibold">All on me</p>
                <p className="text-xs text-muted-foreground mt-1">I bear all production costs</p>
              </button>
            </div>
          </>
        )}
      </div>

      {costResponsibility === "split" && (
        <div className="space-y-2">
          <Label>Costs Split — Performer / Promoter / Venue (must total 100%)</Label>
          <p className="text-xs text-muted-foreground -mt-1">How agreed upon production costs are shared. Additional costs (if any) are to be agreed upon and settled in the settlement stage.</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Performer %</Label>
              <NumberInput value={artistCostSplit} onChange={e => {
                setArtistCostSplit(e.target.value);
                const remaining = Math.max(0, 100 - (parseFloat(e.target.value) || 0));
                const pRatio = (parseFloat(promoterCostSplit) || 0) / Math.max(1, (parseFloat(promoterCostSplit) || 0) + (parseFloat(venueCostSplit) || 0));
                setPromoterCostSplit(String(Math.round(remaining * pRatio)));
                setVenueCostSplit(String(Math.round(remaining * (1 - pRatio))));
              }} placeholder="20" min="0" max="100" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Promoter %</Label>
              <NumberInput value={promoterCostSplit} onChange={e => {
                setPromoterCostSplit(e.target.value);
                const a = parseFloat(artistCostSplit) || 0;
                setVenueCostSplit(String(Math.max(0, 100 - a - (parseFloat(e.target.value) || 0))));
              }} placeholder="50" min="0" max="100" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Venue %</Label>
              <NumberInput value={venueCostSplit} onChange={e => {
                setVenueCostSplit(e.target.value);
                const a = parseFloat(artistCostSplit) || 0;
                setPromoterCostSplit(String(Math.max(0, 100 - a - (parseFloat(e.target.value) || 0))));
              }} placeholder="30" min="0" max="100" />
            </div>
          </div>
          {costSplitSum !== 100 && (
            <p className="text-xs text-destructive">Cost split total: {costSplitSum}% — must equal 100%</p>
          )}
        </div>
      )}

      {/* Venue Rental — only for rental deals */}
      {showVenueRental && (
        <div className="space-y-2">
          <Label>
            Venue Rental ({getCurrencySymbol()})
            {isPromoter
              ? <span className="text-xs text-muted-foreground ml-2">paid by you in advance</span>
              : <span className="text-xs text-muted-foreground ml-2">paid by artist in advance</span>
            }
          </Label>
          <NumberInput value={venueRental} onChange={e => setVenueRental(e.target.value)} placeholder="0" />
          {parseFloat(venueRental) > 0 && (
            <div className="mt-2 space-y-1.5">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="venueRentalPaymentMode" checked={venueRentalPaymentMode === "deduct_at_settlement"} onChange={() => setVenueRentalPaymentMode("deduct_at_settlement")} className="accent-primary" />
                Deduct at settlement
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="venueRentalPaymentMode" checked={venueRentalPaymentMode === "request_now"} onChange={() => setVenueRentalPaymentMode("request_now")} className="accent-primary" />
                Request payment now <span className="text-xs text-muted-foreground">(Mollie)</span>
              </label>
            </div>
          )}
        </div>
      )}

      {/* Draggable commission parties — only visible to performer operators */}
      {isPerformer && (
      <div className="space-y-3 pt-2">
        <Label className="text-sm font-semibold">Commissions from Performer Share</Label>
        <p className="text-xs text-muted-foreground -mt-1">
          Add commissions that are deducted from artist revenue. Drag to reorder — each % is calculated from the remainder after those above it.
        </p>

        {parties.map((party, index) => (
          <div
            key={party.key}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className={cn("rounded-lg border p-3 space-y-2 transition-opacity", dragIndex === index && "opacity-50")}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                <span className="text-sm font-medium">{party.label}</span>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeParty(index)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ContactCombobox
                contactType={party.key === "bookerAgent" ? "agent" : party.key === "management" ? "manager" : "promoter"}
                value={party.name}
                onChange={v => updateParty(index, "name", v)}
                placeholder="Search or type name"
              />
              <div className="relative">
                <NumberInput value={party.percentage} onChange={e => updateParty(index, "percentage", e.target.value)} placeholder="15" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %{index > 0 ? " after above" : ""}
                </span>
              </div>
            </div>
          </div>
        ))}

        {availableToAdd.length > 0 && (
          <div className="flex gap-2">
            {availableToAdd.map(ap => (
              <Button key={ap.key} variant="outline" size="sm" onClick={() => addParty(ap.key)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> {ap.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onSubmit} disabled={submitDisabled || isSubmitting}>
          {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : "Create Event"}
        </Button>
      </div>
    </div>
  );
}
