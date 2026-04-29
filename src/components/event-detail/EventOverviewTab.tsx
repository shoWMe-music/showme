import { useState } from "react";
import { FileText, Music, MapPin, Users, Ticket, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import SettlementBreakdownCards from "@/components/SettlementBreakdownCards";
import DocumentPreviewDialog from "@/components/DocumentPreviewDialog";
import type { Event, PartyBreakdown, DealStructure, Rider } from "@/lib/models";
import { riderTypeLabels } from "@/lib/models";

interface EventOverviewTabProps {
  event: Event;
  settlement?: unknown;
  partyBreakdowns: PartyBreakdown[];
  settlementTotal: number;
  totalRevenue: number;
  totalDeductions: number;
  netRevenue: number;
  deal?: DealStructure;
  riders?: Rider[];
  viewerIsPerformer?: boolean;
}

export function EventOverviewTab({
  event,
  settlement,
  partyBreakdowns,
  settlementTotal,
  totalRevenue,
  totalDeductions,
  netRevenue,
  deal,
  riders,
  viewerIsPerformer = false,
}: EventOverviewTabProps) {
  const [previewDoc, setPreviewDoc] = useState<{ name: string; url: string } | null>(null);
  const filteredRiders = riders?.filter(r => r.name || r.fileName) ?? [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="font-display text-lg font-semibold mb-4">Event Details</h3>
          <dl className="space-y-3">
            {[
              { icon: FileText, label: "Event ID", value: event.id },
              { icon: Music, label: "Performer", value: event.artist },
              { icon: MapPin, label: "Venue", value: event.venue },
              ...(event.roomStage ? [{ icon: MapPin, label: "Room / Stage", value: event.roomStage }] : []),
              { icon: Users, label: "Operator", value: `${event.operator} (${event.operatorType})` },
              { icon: Ticket, label: "Ticketing", value: event.ticketingProvider },
              { icon: Users, label: "Capacity", value: event.capacity.toLocaleString() },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon className="h-4 w-4" /> {label}
                </dt>
                <dd className="text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {filteredRiders.length > 0 && (
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" /> Riders & Documents
            </h3>
            <div className="space-y-3">
              {filteredRiders.map((rider) => (
                <div key={rider.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{rider.name}</span>
                    <div className="flex items-center gap-2">
                      {rider.fileName && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => {
                            if (rider.fileUrl && rider.fileName) {
                              setPreviewDoc({ name: rider.fileName, url: rider.fileUrl });
                            }
                          }}
                        >
                          <Download className="h-3 w-3" /> {rider.fileName}
                        </Button>
                      )}
                      <Badge variant="outline" className="text-xs">{riderTypeLabels[rider.type]}</Badge>
                    </div>
                  </div>
                  {rider.description && <p className="text-xs text-muted-foreground">{rider.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {settlement && (
        <SettlementBreakdownCards
          partyBreakdowns={partyBreakdowns}
          settlementTotal={settlementTotal}
          totalRevenue={totalRevenue}
          totalDeductions={totalDeductions}
          netRevenue={netRevenue}
          deal={deal}
          viewerIsPerformer={viewerIsPerformer}
        />
      )}

      <DocumentPreviewDialog
        open={!!previewDoc}
        onOpenChange={(o) => { if (!o) setPreviewDoc(null); }}
        fileName={previewDoc?.name}
        fileUrl={previewDoc?.url}
      />
    </div>
  );
}
