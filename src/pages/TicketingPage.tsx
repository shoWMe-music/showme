import { useState } from "react";
import { Link } from "@tanstack/react-router";
import AppLayout from "@/components/AppLayout";
import { formatCurrency } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Link2, RefreshCw, CheckCircle2, AlertCircle, Clock, ArrowRight, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ── Provider definitions ──

interface TicketingProvider {
  id: string;
  name: string;
  logo: string;
  status: "connected" | "available" | "coming_soon";
  description: string;
  apiVersion: string;
  lastSync?: string;
  supportedFields: string[];
  country?: string;
}

const initialProviders: TicketingProvider[] = [
  { id: "ticketmaster", name: "Ticketmaster", logo: "TM", status: "available", description: "Global ticketing platform for live events", apiVersion: "v2.1", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "tax", "refunds", "ticket_types"] },
  { id: "liveday", name: "Liveday", logo: "LD", status: "available", description: "Dutch ticketing and event management platform", apiVersion: "v3.0", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "tax", "refunds", "door_sales", "guest_list"] },
  // Available — International
  { id: "dice", name: "DICE", logo: "DC", status: "available", description: "Mobile-first ticketing with anti-tout technology", apiVersion: "v1.4", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "refunds"] },
  { id: "eventbrite", name: "Eventbrite", logo: "EB", status: "available", description: "Self-service ticketing platform for events of all sizes", apiVersion: "v3", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "tax", "refunds"] },
  // Available — Sweden
  { id: "tickster", name: "Tickster", logo: "TS", status: "available", description: "Swedish ticketing for concerts, festivals and cultural events", apiVersion: "v2.0", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "tax", "refunds"], country: "SE" },
  { id: "nortic", name: "Nortic", logo: "NT", status: "available", description: "Nordic event ticketing and visitor management platform", apiVersion: "v4.1", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "tax", "refunds", "guest_list"], country: "SE" },
  { id: "ticketco", name: "TicketCo", logo: "TC", status: "available", description: "Scandinavian ticketing with cashless event payments", apiVersion: "v2.3", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "tax", "refunds"], country: "SE" },
  { id: "biljettnu", name: "Biljett.nu", logo: "BN", status: "available", description: "Swedish online ticket sales for clubs, theaters and events", apiVersion: "v1.0", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "refunds"], country: "SE" },
  // Available — Germany
  { id: "eventim", name: "CTS Eventim", logo: "EV", status: "available", description: "Europe's leading ticketing and live entertainment company", apiVersion: "v5.2", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "tax", "refunds", "ticket_types"], country: "DE" },
  { id: "reservix", name: "Reservix", logo: "RX", status: "available", description: "German ticketing system for venues, theaters and festivals", apiVersion: "v3.1", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "tax", "refunds"], country: "DE" },
  { id: "ticketpay", name: "TicketPAY", logo: "TP", status: "available", description: "German self-service ticketing with integrated payment solutions", apiVersion: "v2.0", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "tax", "refunds", "door_sales"], country: "DE" },
  { id: "adticket", name: "ADticket", logo: "AD", status: "available", description: "German regional ticketing platform for concerts and events", apiVersion: "v1.5", supportedFields: ["tickets_sold", "gross_revenue", "ticket_fees", "refunds"], country: "DE" },
  // Coming soon
  { id: "seetickets", name: "See Tickets", logo: "ST", status: "coming_soon", description: "European ticketing platform for festivals and concerts", apiVersion: "—", supportedFields: [] },
  { id: "paylogic", name: "Paylogic", logo: "PL", status: "coming_soon", description: "Ticketing and access control for large-scale events", apiVersion: "—", supportedFields: [] },
];

interface SyncedTicketImportRow {
  providerId: string;
  eventRef: string;
  eventName: string;
  syncedAt: string;
  status: "synced" | "pending" | "error";
  data: {
    ticketsSold: number;
    grossRevenue: number;
    ticketFees: number;
    tax: number;
    refunds: number;
    ticketTypes: { name: string; sold: number; price: number }[];
  };
}

// ── Component ──

export default function TicketingPage() {
  const [providers, setProviders] = useState<TicketingProvider[]>(initialProviders);
  const [syncedImports] = useState<SyncedTicketImportRow[]>([]);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedTicketData, setSelectedTicketData] = useState<SyncedTicketImportRow | null>(null);

  // Credential connect flow
  const [connectingProvider, setConnectingProvider] = useState<TicketingProvider | null>(null);
  const [credCustomerId, setCredCustomerId] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  const connectedProviders = providers.filter(p => p.status === "connected");
  const availableProviders = providers.filter(p => p.status === "available");
  const comingSoon = providers.filter(p => p.status === "coming_soon");

  const getProviderData = (providerId: string) =>
    syncedImports.filter(d => d.providerId === providerId);

  const statusIcon = (status: SyncedTicketImportRow["status"]) => {
    if (status === "synced") return <CheckCircle2 className="h-4 w-4 text-success" />;
    if (status === "pending") return <Clock className="h-4 w-4 text-warning" />;
    return <AlertCircle className="h-4 w-4 text-destructive" />;
  };

  const handleProviderClick = (provider: TicketingProvider) => {
    setConnectingProvider(provider);
    setCredCustomerId("");
    setCredPassword("");
  };

  const handleConnect = () => {
    if (!connectingProvider) return;
    setIsConnecting(true);
    setTimeout(() => {
      setProviders(prev => prev.map(p =>
        p.id === connectingProvider.id
          ? { ...p, status: "connected" as const, lastSync: new Date().toISOString() }
          : p
      ));
      setIsConnecting(false);
      setConnectingProvider(null);
      setConnectDialogOpen(false);
      toast({ title: `${connectingProvider.name} connected!`, description: "Ticket data will begin syncing shortly." });
    }, 1500);
  };

  const countryLabel = (c?: string) => c === "SE" ? "🇸🇪 Sweden" : c === "DE" ? "🇩🇪 Germany" : null;

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <div className="mb-4">
          <Link to="/settings">
            <Button variant="ghost" size="sm" className="gap-1.5 mb-2 -ml-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back to Settings
            </Button>
          </Link>
        </div>
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Ticketing Companies Integration</h1>
            <p className="mt-1 text-muted-foreground">Manage ticketing provider connections and sync revenue data</p>
          </div>
          <Button onClick={() => { setConnectingProvider(null); setConnectDialogOpen(true); }} className="gap-2">
            <Link2 className="h-4 w-4" /> Connect Provider
          </Button>
        </div>

        {/* Connected Providers */}
        {connectedProviders.length > 0 && (
          <div className="mb-8">
            <h2 className="font-display text-lg font-semibold mb-4">Connected Providers</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {connectedProviders.map(provider => {
                const data = getProviderData(provider.id);
                const syncedCount = data.filter(d => d.status === "synced").length;
                return (
                  <div key={provider.id} className="rounded-xl border bg-card p-5 shadow-sm">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-display font-bold text-sm">
                          {provider.logo}
                        </div>
                        <div>
                          <h3 className="font-display font-semibold">{provider.name}</h3>
                          <p className="text-xs text-muted-foreground">API {provider.apiVersion}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-success border-success/30 bg-success/5">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between text-sm mb-4">
                      <span className="text-muted-foreground">
                        {syncedCount}/{data.length} events synced
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Last sync: {provider.lastSync ? new Date(provider.lastSync).toLocaleTimeString() : "—"}
                      </span>
                    </div>

                    {data.length === 0 ? (
                      <p className="text-sm text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center">
                        No synced events yet. Imports will appear here after your provider returns data.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {data.map(d => (
                          <button
                            key={d.eventRef}
                            onClick={() => { setSelectedTicketData(d); setDetailDialogOpen(true); }}
                            className="flex w-full items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5 text-left transition-colors hover:bg-muted"
                          >
                            <div className="flex items-center gap-2">
                              {statusIcon(d.status)}
                              <div>
                                <p className="text-sm font-medium">{d.eventName}</p>
                                <p className="text-xs text-muted-foreground font-mono">{d.eventRef}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold font-display">
                                {d.data.grossRevenue > 0 ? formatCurrency(d.data.grossRevenue) : "—"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {d.data.ticketsSold > 0 ? `${d.data.ticketsSold} tickets` : "Awaiting data"}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex gap-2">
                      <Button variant="outline" size="sm" className="gap-1.5">
                        <RefreshCw className="h-3.5 w-3.5" /> Sync Now
                      </Button>
                      <Button variant="ghost" size="sm" className="text-muted-foreground">
                        Settings
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Revenue Feed */}
        <div className="mb-8">
          <h2 className="font-display text-lg font-semibold mb-4">Revenue Feed</h2>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Provider</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Event</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reference</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tickets</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gross</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Net</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {syncedImports.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-sm text-muted-foreground">
                      No ticket imports yet. Connect a provider above; synced rows will appear here when available.
                    </td>
                  </tr>
                ) : (
                  syncedImports.map(d => {
                    const provider = providers.find(p => p.id === d.providerId);
                    const net = d.data.grossRevenue - d.data.ticketFees - d.data.tax - d.data.refunds;
                    return (
                      <tr
                        key={d.eventRef}
                        className="transition-colors hover:bg-muted/30 cursor-pointer"
                        onClick={() => { setSelectedTicketData(d); setDetailDialogOpen(true); }}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 text-primary text-xs font-bold">
                              {provider?.logo}
                            </div>
                            <span className="text-sm font-medium">{provider?.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium">{d.eventName}</td>
                        <td className="px-6 py-4 text-sm text-muted-foreground font-mono">{d.eventRef}</td>
                        <td className="px-6 py-4 text-sm text-right">{d.data.ticketsSold.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm font-semibold font-display text-right">
                          {d.data.grossRevenue > 0 ? formatCurrency(d.data.grossRevenue) : "—"}
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold font-display text-right">
                          {net > 0 ? formatCurrency(net) : "—"}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5">
                            {statusIcon(d.status)}
                            <span className="text-xs capitalize">{d.status}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Connect Provider Dialog */}
        <Dialog open={connectDialogOpen} onOpenChange={(v) => { setConnectDialogOpen(v); if (!v) setConnectingProvider(null); }}>
          <DialogContent className="max-w-lg">
            {!connectingProvider ? (
              <>
                <DialogHeader>
                  <DialogTitle>Connect Ticketing Provider</DialogTitle>
                  <DialogDescription>Choose a provider to connect and import ticket sales data</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 mt-2 max-h-[60vh] overflow-y-auto pr-1">
                  {/* Group by country */}
                  {availableProviders.filter(p => !p.country).length > 0 && (
                    <>
                      <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider pt-1">International</p>
                      {availableProviders.filter(p => !p.country).map(provider => (
                        <button key={provider.id} className="flex w-full items-center justify-between rounded-xl border p-4 text-left transition-colors hover:border-primary hover:bg-muted/30" onClick={() => handleProviderClick(provider)}>
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-display font-bold text-sm">{provider.logo}</div>
                            <div><p className="font-medium">{provider.name}</p><p className="text-xs text-muted-foreground">{provider.description}</p></div>
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                      ))}
                    </>
                  )}
                  {["SE", "DE"].map(country => {
                    const countryProviders = availableProviders.filter(p => p.country === country);
                    if (countryProviders.length === 0) return null;
                    return (
                      <div key={country}>
                        <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider pt-2">{countryLabel(country)}</p>
                        {countryProviders.map(provider => (
                          <button key={provider.id} className="flex w-full items-center justify-between rounded-xl border p-4 text-left transition-colors hover:border-primary hover:bg-muted/30 mt-2" onClick={() => handleProviderClick(provider)}>
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-display font-bold text-sm">{provider.logo}</div>
                              <div><p className="font-medium">{provider.name}</p><p className="text-xs text-muted-foreground">{provider.description}</p></div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    );
                  })}
                  {comingSoon.length > 0 && (
                    <>
                      <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider pt-2">Coming Soon</p>
                      {comingSoon.map(provider => (
                        <div key={provider.id} className="flex items-center justify-between rounded-xl border p-4 opacity-50">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground font-display font-bold text-sm">{provider.logo}</div>
                            <div><p className="font-medium">{provider.name}</p><p className="text-xs text-muted-foreground">{provider.description}</p></div>
                          </div>
                          <Badge variant="outline" className="text-muted-foreground">Coming Soon</Badge>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Connect to {connectingProvider.name}</DialogTitle>
                  <DialogDescription>Enter your {connectingProvider.name} API credentials to connect</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-display font-bold text-sm">{connectingProvider.logo}</div>
                    <div>
                      <p className="font-medium">{connectingProvider.name}</p>
                      <p className="text-xs text-muted-foreground">API {connectingProvider.apiVersion}</p>
                    </div>
                  </div>
                  <div>
                    <Label>Customer ID</Label>
                    <Input value={credCustomerId} onChange={e => setCredCustomerId(e.target.value)} placeholder="Enter your Customer ID..." className="mt-1" />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input type="password" value={credPassword} onChange={e => setCredPassword(e.target.value)} placeholder="Enter your password..." className="mt-1" />
                  </div>
                  <p className="text-xs text-muted-foreground">Your credentials are securely encrypted. We only use read-only API access to sync ticket data.</p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConnectingProvider(null)}>Back</Button>
                  <Button onClick={handleConnect} disabled={isConnecting} className="gap-2">
                    {isConnecting ? <><Loader2 className="h-4 w-4 animate-spin" /> Connecting...</> : "Connect"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Ticket Data Detail Dialog */}
        <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
          <DialogContent className="max-w-lg">
            {selectedTicketData && (
              <>
                <DialogHeader>
                  <DialogTitle>{selectedTicketData.eventName}</DialogTitle>
                  <DialogDescription>
                    {providers.find(p => p.id === selectedTicketData.providerId)?.name} · Ref: {selectedTicketData.eventRef}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">Tickets Sold</p>
                      <p className="text-lg font-bold font-display">{selectedTicketData.data.ticketsSold.toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">Gross Revenue</p>
                      <p className="text-lg font-bold font-display">{formatCurrency(selectedTicketData.data.grossRevenue)}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: "Ticket Fees", value: selectedTicketData.data.ticketFees },
                      { label: "Tax", value: selectedTicketData.data.tax },
                      { label: "Refunds", value: selectedTicketData.data.refunds },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium">- {formatCurrency(value)}</span>
                      </div>
                    ))}
                    <div className="border-t pt-2 flex justify-between">
                      <span className="font-semibold">Net Revenue</span>
                      <span className="font-bold font-display">
                        {formatCurrency(selectedTicketData.data.grossRevenue - selectedTicketData.data.ticketFees - selectedTicketData.data.tax - selectedTicketData.data.refunds)}
                      </span>
                    </div>
                  </div>
                  {selectedTicketData.data.ticketTypes.length > 0 && (
                    <div>
                      <h4 className="font-display font-semibold text-sm mb-2">Ticket Breakdown</h4>
                      <div className="space-y-2">
                        {selectedTicketData.data.ticketTypes.map(t => (
                          <div key={t.name} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                            <div><p className="text-sm font-medium">{t.name}</p><p className="text-xs text-muted-foreground">{formatCurrency(t.price)} per ticket</p></div>
                            <div className="text-right"><p className="text-sm font-semibold">{t.sold} sold</p><p className="text-xs text-muted-foreground">{formatCurrency(t.sold * t.price)}</p></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Last synced: {new Date(selectedTicketData.syncedAt).toLocaleString()}
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
