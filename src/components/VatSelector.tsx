import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { VatInfo } from "@/lib/models";
import { Receipt } from "lucide-react";

const VAT_PRESETS = [0, 6, 7, 19, 25];

interface VatSelectorProps {
  value?: VatInfo;
  onChange: (vat: VatInfo | undefined) => void;
}

export default function VatSelector({ value, onChange }: VatSelectorProps) {
  const [open, setOpen] = useState(false);
  const hasVat = value && value.rate > 0;

  const rateStr = value ? (VAT_PRESETS.includes(value.rate) ? String(value.rate) : "custom") : "0";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors border ${
            hasVat
              ? "bg-primary/10 text-primary border-primary/20"
              : "bg-muted/50 text-muted-foreground border-transparent hover:border-border"
          }`}
        >
          <Receipt className="h-3 w-3" />
          {hasVat ? `${value!.rate}% ${value!.mode === "included" ? "incl." : "on top"}` : "VAT"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3 space-y-3" align="end">
        <Label className="text-xs font-semibold">VAT Rate</Label>
        <Select
          value={rateStr}
          onValueChange={(v) => {
            if (v === "0") {
              onChange(undefined);
            } else if (v === "custom") {
              onChange({ rate: value?.rate || 21, mode: value?.mode || "included" });
            } else {
              onChange({ rate: parseInt(v), mode: value?.mode || "included" });
            }
          }}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">No VAT</SelectItem>
            {VAT_PRESETS.filter(r => r > 0).map(r => (
              <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
            ))}
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>

        {rateStr === "custom" && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Custom rate (%)</Label>
            <Input
              type="number"
              value={value?.rate || ""}
              onChange={(e) => onChange({ rate: parseFloat(e.target.value) || 0, mode: value?.mode || "included" })}
              className="h-8 text-xs mt-0.5"
              placeholder="21"
            />
          </div>
        )}

        {hasVat && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Mode</Label>
            <RadioGroup
              value={value?.mode || "included"}
              onValueChange={(v) => onChange({ rate: value!.rate, mode: v as "included" | "on_top" })}
              className="mt-1"
            >
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <RadioGroupItem value="included" className="h-3 w-3" />
                Included in amount
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <RadioGroupItem value="on_top" className="h-3 w-3" />
                Added on top
              </label>
            </RadioGroup>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
