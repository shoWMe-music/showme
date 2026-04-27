import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RevealSection } from "@/hooks/useScrollReveal";
import { FloatingParticles, AnimatedGradient } from "@/components/AnimatedBackground";
import { LandingNav, FinalCTASection, LandingFooter } from "./LandingPage";
import {
  Calculator, LayoutDashboard, MessageSquare, FileText,
  Eye, BarChart3, Check, Shield, LineChart,
  UserPlus, Globe,
} from "lucide-react";

/* ─── Product Walkthrough ─── */
function WalkthroughSection() {
  const blocks = [
    {
      title: "Plan before you commit",
      icon: Calculator,
      bullets: ["Build event budget", "Forecast revenue and costs", "Know your break-even"],
      mock: (
        <Card className="border shadow-lg transition-all duration-300 hover:shadow-xl rounded-xl overflow-hidden">
          <div className="bg-muted/50 px-6 py-3 border-b flex items-center justify-between">
            <p className="font-display font-semibold text-sm">Budget Simulator</p>
            <span className="text-[10px] text-muted-foreground font-medium px-2 py-0.5 rounded bg-muted">Summer Beats Festival</span>
          </div>
          <CardContent className="p-6 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Revenue</p>
            <div className="flex justify-between text-sm py-1.5"><span className="text-muted-foreground">Ticket Sales (500 × €36)</span><span className="text-success font-medium">€18,000</span></div>
            <div className="flex justify-between text-sm py-1.5"><span className="text-muted-foreground">Bar Revenue</span><span className="text-success font-medium">€4,200</span></div>
            <div className="flex justify-between text-sm py-1.5"><span className="text-muted-foreground">Sponsorship</span><span className="text-success font-medium">€2,500</span></div>
            <div className="h-px bg-border my-2" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-3">Costs</p>
            <div className="flex justify-between text-sm py-1.5"><span className="text-muted-foreground">Venue Hire</span><span className="text-destructive font-medium">-€5,500</span></div>
            <div className="flex justify-between text-sm py-1.5"><span className="text-muted-foreground">Performer Fee</span><span className="text-destructive font-medium">-€8,000</span></div>
            <div className="flex justify-between text-sm py-1.5"><span className="text-muted-foreground">Production</span><span className="text-destructive font-medium">-€3,200</span></div>
            <div className="flex justify-between text-sm py-1.5"><span className="text-muted-foreground">Marketing</span><span className="text-destructive font-medium">-€1,800</span></div>
            <div className="h-px bg-border my-2" />
            <div className="flex justify-between text-sm font-bold pt-2"><span>Net Result</span><span className="text-success">€6,200</span></div>
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>Budget Health</span><span>72%</span></div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-success" style={{ width: "72%" }} />
              </div>
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      title: "Manage everything in one place",
      icon: LayoutDashboard,
      bullets: ["Event timeline and status", "Team roles and permissions", "Real-time updates"],
      mock: (
        <Card className="border shadow-lg transition-all duration-300 hover:shadow-xl rounded-xl overflow-hidden">
          <div className="bg-muted/50 px-6 py-3 border-b flex items-center justify-between">
            <p className="font-display font-semibold text-sm">Events</p>
            <div className="flex gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground">All statuses</span>
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground">Search…</span>
            </div>
          </div>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1fr_0.7fr_0.7fr_0.6fr_0.5fr] px-4 py-2 border-b bg-muted/30 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              <span>Event</span><span>Performer</span><span>Venue</span><span>Date</span><span>Status</span>
            </div>
            {[
              { name: "Summer Beats Festival", artist: "Alva Ström", venue: "Solhem", date: "Jun 15", status: "Confirmed", cls: "event-confirmed" },
              { name: "Jazz Lounge Sessions", artist: "Kvartetten", venue: "Kustens Hus", date: "Jun 22", status: "Pending", cls: "event-pending" },
              { name: "Indie Rock Night", artist: "Havsbris", venue: "Ljuset", date: "Jul 1", status: "Draft", cls: "event-draft" },
              { name: "Electronic Showcase", artist: "Neonljus", venue: "Strandscenen", date: "Jul 8", status: "Suggested", cls: "event-suggested" },
              { name: "Acoustic Evening", artist: "Trästocken", venue: "Elden", date: "Jul 15", status: "On Hold", cls: "event-on-hold" },
            ].map(e => (
              <div key={e.name} className="grid grid-cols-[1fr_0.7fr_0.7fr_0.6fr_0.5fr] px-4 py-3 border-b last:border-b-0 items-center hover:bg-muted/20 transition-colors">
                <span className="text-sm font-medium truncate pr-2">{e.name}</span>
                <span className="text-xs text-muted-foreground truncate">{e.artist}</span>
                <span className="text-xs text-muted-foreground truncate">{e.venue}</span>
                <span className="text-xs text-muted-foreground">{e.date}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.cls}`}>{e.status}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ),
    },
    {
      title: "Negotiate inside the event",
      icon: MessageSquare,
      bullets: ["Conversations tied to the event", "Clear deal structure", "Changes tracked"],
      mock: (
        <Card className="border shadow-lg transition-all duration-300 hover:shadow-xl rounded-xl overflow-hidden">
          <div className="bg-muted/50 px-4 py-0 border-b flex items-center gap-0">
            {["Overview", "Deal", "Revenue", "Settlement", "Chat"].map((tab, i) => (
              <span key={tab} className={`text-[11px] font-medium px-3 py-3 border-b-2 ${i === 4 ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>{tab}</span>
            ))}
          </div>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <p className="font-display font-semibold text-sm">Summer Beats Festival — Chat</p>
              <span className="text-[10px] text-muted-foreground">3 participants</span>
            </div>
            <div className="rounded-xl bg-muted/50 p-4 space-y-4">
              {[
                { initials: "VM", name: "Venue Manager", text: "Can we adjust the split to 75/25?", color: "bg-primary/20 text-primary" },
                { initials: "AG", name: "Agent", text: "Let me check with the artist.", color: "bg-info/20 text-info" },
                { initials: "AG", name: "Agent", text: "Agreed. Updating the deal now.", color: "bg-info/20 text-info" },
              ].map((m, i) => (
                <div key={i} className="flex gap-3">
                  <div className={`h-8 w-8 rounded-full ${m.color} flex items-center justify-center text-[10px] font-bold shrink-0`}>{m.initials}</div>
                  <div className="text-sm">
                    <p className="font-medium text-xs">{m.name}</p>
                    <p className="text-muted-foreground text-xs">"{m.text}"</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      title: "Close events without confusion",
      icon: FileText,
      bullets: ["Final numbers in one place", "Calculate payouts", "Clear settlement overview"],
      mock: (
        <Card className="border shadow-lg transition-all duration-300 hover:shadow-xl rounded-xl overflow-hidden">
          <div className="bg-muted/50 px-6 py-3 border-b flex items-center justify-between">
            <p className="font-display font-semibold text-sm">Settlements</p>
            <div className="flex gap-1.5">
              {[
                { label: "Draft", cls: "status-draft" },
                { label: "Pending", cls: "status-pending-review" },
                { label: "Finalized", cls: "status-finalized" },
                { label: "Paid", cls: "status-paid" },
              ].map(s => (
                <span key={s.label} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold ${s.cls}`}>{s.label}</span>
              ))}
            </div>
          </div>
          <CardContent className="p-6 space-y-3">
            <div className="flex justify-between text-sm py-1.5"><span className="text-muted-foreground">Total Revenue</span><span className="font-medium">€24,700</span></div>
            <div className="flex justify-between text-sm py-1.5"><span className="text-muted-foreground">Total Costs</span><span className="text-destructive font-medium">-€18,500</span></div>
            <div className="h-px bg-border" />
            <div className="flex justify-between text-sm py-1.5"><span className="text-muted-foreground">Venue Share (30%)</span><span className="font-medium">€1,860</span></div>
            <div className="flex justify-between text-sm py-1.5"><span className="text-muted-foreground">Performer Share (70%)</span><span className="font-medium">€4,340</span></div>
            <div className="h-px bg-border" />
            <div className="flex justify-between text-sm font-bold pt-1"><span>Net Profit</span><span className="text-success">€6,200</span></div>
            <div className="flex items-center justify-between pt-2">
              <span className="text-[10px] text-muted-foreground">Settlement Status</span>
              <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold status-paid">Paid</span>
            </div>
          </CardContent>
        </Card>
      ),
    },
  ];

  return (
    <section className="py-24">
      <div className="max-w-6xl mx-auto px-6 space-y-20">
        {blocks.map((block, i) => (
          <RevealSection key={block.title}>
            <div className={`grid lg:grid-cols-2 gap-12 items-center ${i % 2 === 1 ? "lg:direction-rtl" : ""}`}>
              <div className={`space-y-5 ${i % 2 === 1 ? "lg:order-2" : ""}`}>
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <block.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-display text-2xl lg:text-3xl font-bold text-foreground">{block.title}</h3>
                <ul className="space-y-3">
                  {block.bullets.map(b => (
                    <li key={b} className="flex items-center gap-3 text-muted-foreground">
                      <Check className="h-4 w-4 text-primary shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={i % 2 === 1 ? "lg:order-1" : ""}>{block.mock}</div>
            </div>
          </RevealSection>
        ))}
      </div>
    </section>
  );
}

/* ─── Daily Usage ─── */
function DailyUsageSection() {
  return (
    <section className="py-24 bg-foreground/[0.03]">
      <div className="max-w-6xl mx-auto px-6 space-y-10">
        <RevealSection>
          <div className="text-center space-y-4">
            <h2 className="font-display text-3xl lg:text-4xl font-bold text-foreground">One place you open every day</h2>
            <ul className="max-w-lg mx-auto space-y-3 mt-8">
              {[
                "See every event status instantly",
                "Track financial changes live",
                "Communicate in context",
                "Keep everything in one system",
              ].map(b => (
                <li key={b} className="flex items-center gap-3 text-muted-foreground">
                  <Check className="h-4 w-4 text-primary shrink-0" /> {b}
                </li>
              ))}
            </ul>
            <p className="text-xl font-semibold text-foreground mt-8">
              If it's not in shoWMe, it doesn't exist
            </p>
          </div>
        </RevealSection>
        <RevealSection delay={200}>
          <Card className="max-w-2xl mx-auto shadow-xl border rounded-xl transition-all duration-300 hover:shadow-2xl">
            <CardContent className="p-6 space-y-4">
              <p className="font-display font-semibold text-lg">My Events</p>
              <div className="space-y-2">
                <div className="grid grid-cols-[0.4fr_1fr_0.5fr_0.5fr] px-4 py-2 border-b bg-muted/30 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <span>Date</span><span>Event</span><span>Venue</span><span>Status</span>
                </div>
                {[
                  { name: "Summer Beats Festival", venue: "Solhem", date: "Jun 15", status: "Confirmed", cls: "event-confirmed" },
                  { name: "Jazz Lounge Sessions", venue: "Kustens Hus", date: "Jun 22", status: "Pending", cls: "event-pending" },
                  { name: "Indie Rock Night", venue: "Ljuset", date: "Jul 1", status: "Draft", cls: "event-draft" },
                  { name: "Electronic Showcase", venue: "Strandscenen", date: "Jul 8", status: "Confirmed", cls: "event-confirmed" },
                ].map(e => (
                  <div key={e.name} className="grid grid-cols-[0.4fr_1fr_0.5fr_0.5fr] px-4 py-3 border-b last:border-b-0 items-center">
                    <span className="text-xs text-muted-foreground">{e.date}</span>
                    <span className="text-sm font-medium">{e.name}</span>
                    <span className="text-xs text-muted-foreground">{e.venue}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.cls}`}>{e.status}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </RevealSection>
      </div>
    </section>
  );
}

/* ─── Risk & Performance ─── */
function RiskPerformanceSection() {
  return (
    <section className="py-24 bg-foreground/[0.03]">
      <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-16">
        <RevealSection>
          <div className="space-y-5">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <h2 className="font-display text-2xl lg:text-3xl font-bold text-foreground">Reduce risk before the event</h2>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Understand if the event works financially</li>
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Adjust before committing</li>
            </ul>
          </div>
        </RevealSection>
        <RevealSection delay={200}>
          <div className="space-y-5">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <LineChart className="h-6 w-6 text-primary" />
            </div>
            <h2 className="font-display text-2xl lg:text-3xl font-bold text-foreground">Understand what actually happened</h2>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Compare planned vs real</li>
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Clear profit and loss</li>
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Learn for future events</li>
            </ul>
          </div>
        </RevealSection>
      </div>
    </section>
  );
}

/* ─── Multi-user Collaboration (Invitations) ─── */
function CollaborationInviteSection() {
  return (
    <section className="py-24 relative overflow-hidden">
      <FloatingParticles count={12} />
      <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center">
        <RevealSection>
          <div className="space-y-6">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <UserPlus className="h-6 w-6 text-primary" />
            </div>
            <h2 className="font-display text-2xl lg:text-3xl font-bold text-foreground">Invite collaborators to your events</h2>
            <p className="text-muted-foreground leading-relaxed">
              Share event access with venues, artists, agents, and team members. Each collaborator sees what's relevant to their role — no more forwarding spreadsheets.
            </p>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Role-based permissions</li>
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Secure invite links</li>
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Real-time shared updates</li>
            </ul>
          </div>
        </RevealSection>
        <RevealSection delay={200}>
          <Card className="border shadow-lg rounded-xl overflow-hidden">
            <div className="bg-muted/50 px-6 py-3 border-b">
              <p className="font-display font-semibold text-sm">Invite Collaborator</p>
            </div>
            <CardContent className="p-6 space-y-4">
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Email</div>
                <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">bookings@solhem.se</div>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Role</div>
                <div className="flex gap-2">
                  {["Venue", "Performer", "Promoter", "Viewer"].map((r, i) => (
                    <span key={r} className={`text-[11px] px-3 py-1.5 rounded-full border font-medium ${i === 0 ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground"}`}>{r}</span>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Permission</div>
                <div className="flex gap-2">
                  {["View only", "Can edit"].map((p, i) => (
                    <span key={p} className={`text-[11px] px-3 py-1.5 rounded-full border font-medium ${i === 1 ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground"}`}>{p}</span>
                  ))}
                </div>
              </div>
              <Button size="sm" className="w-full mt-2">Send Invitation</Button>
            </CardContent>
          </Card>
        </RevealSection>
      </div>
    </section>
  );
}

/* ─── Public Profiles ─── */
function PublicProfilesSection() {
  return (
    <section className="py-24 bg-foreground/[0.03]">
      <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center">
        <RevealSection delay={200}>
          <Card className="border shadow-lg rounded-xl overflow-hidden">
            <div className="bg-muted/50 px-6 py-3 border-b">
              <p className="font-display font-semibold text-sm">Public Profile — Höganäs Bryggeri</p>
            </div>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">HB</div>
                <div>
                  <p className="font-semibold">Höganäs Bryggeri</p>
                  <p className="text-xs text-muted-foreground">Venue · Höganäs, Sweden</p>
                </div>
              </div>
              <div className="text-sm text-muted-foreground leading-relaxed">
                Restaurant, brewery, and live music venue in Höganäs, Sweden. Hosting live events in a historic setting.
              </div>
              <div className="flex gap-2">
                <span className="text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">Live Music</span>
                <span className="text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">Singer-Songwriter</span>
                <span className="text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">Jazz</span>
              </div>
              <div className="border-t pt-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Upcoming Events</p>
                {[
                  { name: "Jazz & Wine Evening", date: "Jul 12" },
                  { name: "Acoustic Sessions", date: "Jul 19" },
                ].map(e => (
                  <div key={e.name} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{e.name}</span>
                    <span className="text-xs text-muted-foreground">{e.date}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </RevealSection>
        <RevealSection>
          <div className="space-y-6">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Globe className="h-6 w-6 text-primary" />
            </div>
            <h2 className="font-display text-2xl lg:text-3xl font-bold text-foreground">Public profiles for discovery</h2>
            <p className="text-muted-foreground leading-relaxed">
              Create a public profile for your venue, agency, or artist. Let others find you, see your event history, and connect directly through shoWMe.
            </p>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Shareable profile link</li>
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Public "Upcoming Events" page for all users</li>
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />"Book Performer" button on performer profiles</li>
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Upload photos and documents</li>
              <li className="flex items-center gap-3 text-muted-foreground"><Check className="h-4 w-4 text-primary shrink-0" />Build your reputation</li>
            </ul>
          </div>
        </RevealSection>
      </div>
    </section>
  );
}

/* ─── Analytics ─── */
function AnalyticsSection() {
  return (
    <section className="py-24 relative overflow-hidden">
      <FloatingParticles count={12} />
      <RevealSection>
        <div className="max-w-6xl mx-auto px-6 text-center space-y-8">
          <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
            <BarChart3 className="h-7 w-7 text-primary" />
          </div>
          <h2 className="font-display text-3xl lg:text-4xl font-bold text-foreground">Your event data becomes your advantage</h2>
          <ul className="max-w-md mx-auto space-y-3">
            {["Pre vs post event comparison", "Performance tracking", "Historical insights"].map(b => (
              <li key={b} className="flex items-center gap-3 text-muted-foreground justify-center">
                <Check className="h-4 w-4 text-primary shrink-0" /> {b}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            As you run more events, shoWMe helps you make better decisions
          </p>
        </div>
      </RevealSection>
    </section>
  );
}

/* ─── Product Page ─── */
export default function ProductPage() {
  return (
    <div className="min-h-screen bg-background">
      <LandingNav />
      <section className="relative bg-foreground text-background py-24 lg:py-32 overflow-hidden">
        <AnimatedGradient />
        <div className="max-w-6xl mx-auto px-6 text-center relative z-10">
          <RevealSection>
            <h1 className="font-display text-4xl lg:text-6xl font-bold tracking-tight">
              Everything you need to run <span className="text-primary">events</span>
            </h1>
            <p className="text-lg text-background/70 mt-6 max-w-2xl mx-auto">
              From budgeting to settlement, shoWMe covers the full lifecycle of every event.
            </p>
          </RevealSection>
        </div>
      </section>
      <WalkthroughSection />
      <DailyUsageSection />
      <RiskPerformanceSection />
      <CollaborationInviteSection />
      <PublicProfilesSection />
      <AnalyticsSection />
      <FinalCTASection />
      <LandingFooter />
    </div>
  );
}
