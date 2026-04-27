import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";

type TicketRevenueRow =
  | { key: string; name: string; price: number; expectedSold: number; revenue: number; isLocal: false }
  | { key: string; name: string; price: number; expectedSold: number; revenue: number; isLocal: true; localId: string };

interface TicketRevenueSectionProps {
  ticketRevenueItems: TicketRevenueRow[];
  totalTicketRevenue: number;
  formatCurrency: (amount: number) => string;
  onUpdateLocalName: (localId: string, name: string) => void;
  onUpdateLocalPrice: (localId: string, price: number) => void;
  onUpdateExpectedSold: (item: TicketRevenueRow, value: number) => void;
  onRemoveTicket: (item: TicketRevenueRow) => void;
  onAddTicketType: () => void;
}

export function TicketRevenueSection({
  ticketRevenueItems,
  totalTicketRevenue,
  formatCurrency: fc,
  onUpdateLocalName,
  onUpdateLocalPrice,
  onUpdateExpectedSold,
  onRemoveTicket,
  onAddTicketType,
}: TicketRevenueSectionProps) {
  return (
    <div className="mb-2">
      <p className="text-xs font-semibold text-muted-foreground mb-2">Ticket revenue</p>
      {ticketRevenueItems.map((item) => (
        <div
          key={item.key}
          className="flex flex-col gap-2 rounded-lg border border-l-2 border-l-[hsl(var(--success))] p-2 transition-colors hover:bg-muted/30 sm:flex-row sm:items-end sm:gap-3 mb-1.5"
        >
          <div className="flex-1 min-w-0 space-y-1">
            {item.isLocal ? (
              <div className="space-y-1">
                <Label htmlFor={`ticket-name-${item.localId}`} className="text-xs text-muted-foreground">
                  Ticket type
                </Label>
                <Input
                  id={`ticket-name-${item.localId}`}
                  value={item.name}
                  onChange={(e) => onUpdateLocalName(item.localId, e.target.value)}
                  placeholder="e.g. VIP, Early bird"
                  className="h-9 text-sm"
                />
              </div>
            ) : (
              <p className="text-xs font-medium leading-tight">{item.name}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              {fc(item.price)} × {item.expectedSold} = {fc(item.revenue)}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2 sm:justify-end">
            {item.isLocal && (
              <div className="space-y-1">
                <Label htmlFor={`ticket-price-${item.localId}`} className="text-xs text-muted-foreground">
                  Price
                </Label>
                <Input
                  id={`ticket-price-${item.localId}`}
                  type="number"
                  value={item.price || ""}
                  onChange={(e) => onUpdateLocalPrice(item.localId, parseFloat(e.target.value) || 0)}
                  className="h-9 w-[5.5rem] text-sm text-right tabular-nums"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor={`ticket-sold-${item.key}`} className="text-xs text-muted-foreground">
                Expected sold
              </Label>
              <Input
                id={`ticket-sold-${item.key}`}
                type="number"
                value={item.expectedSold || ""}
                onChange={(e) => onUpdateExpectedSold(item, parseInt(e.target.value, 10) || 0)}
                className="h-9 w-[5.5rem] text-sm text-right tabular-nums"
              />
            </div>
            <div className="flex items-center gap-2 pb-0.5 sm:ml-1">
              <span className="text-xs font-semibold min-w-[4.5rem] text-right text-[hsl(var(--success))]">
                {fc(item.revenue)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => onRemoveTicket(item)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between rounded-lg bg-[hsl(var(--success))]/5 p-2 mt-1">
        <p className="text-xs font-semibold">Total Ticket Revenue</p>
        <p className="text-xs font-bold text-[hsl(var(--success))]">{fc(totalTicketRevenue)}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 gap-1.5 text-[11px] h-7"
        type="button"
        onClick={onAddTicketType}
      >
        <Plus className="h-3 w-3" /> Add ticket type
      </Button>
    </div>
  );
}
