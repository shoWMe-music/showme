import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RevealSection } from "@/hooks/useScrollReveal";
import { FloatingShapes, FloatingParticles, AnimatedGradient } from "@/components/AnimatedBackground";
import { LandingNav, FinalCTASection, LandingFooter } from "./LandingPage";
import {
  Building2, Music, Megaphone, Users,
  Check, X, Zap, ShieldCheck, MessageCircle,
} from "lucide-react";

/* ─── Multi-user Collaboration ─── */
function CollaborationSection() {
  const roles = [
    { icon: Building2, title: "Venue", text: "Manage operations, budgets, and settlements from your side of the event." },
    { icon: Music, title: "Performer / Agent", text: "Handle deals, availability, and terms — all connected to the same event." },
    { icon: Megaphone, title: "Promoter", text: "Coordinate execution, track spend, and stay aligned with all parties." },
    { icon: Users, title: "Teams", text: "Assign internal roles, set permissions, and collaborate within your organization." },
  ];
  return (
    <section className="py-24 relative overflow-hidden">
      <FloatingShapes />
      <div className="max-w-6xl mx-auto px-6 space-y-16">
        <RevealSection>
          <div className="text-center space-y-4">
            <h2 className="font-display text-3xl lg:text-4xl font-bold text-foreground">
              Each party works their side.<br />Shares the same event.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              External collaborators and internal teams — everyone operates on the same event with role-based access.
            </p>
          </div>
        </RevealSection>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {roles.map((r, i) => (
            <RevealSection key={r.title} delay={i * 100}>
              <Card className="transition-all duration-300 hover:-translate-y-2 hover:shadow-xl hover:border-primary/30 h-full">
                <CardContent className="p-8 text-center space-y-4">
                  <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
                    <r.icon className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="font-display font-semibold text-lg">{r.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{r.text}</p>
                </CardContent>
              </Card>
            </RevealSection>
          ))}
        </div>
        <RevealSection delay={400}>
          <p className="text-center text-muted-foreground">Same event, different views per role</p>
        </RevealSection>
      </div>
    </section>
  );
}

/* ─── Work Faster ─── */
function WorkFasterSection() {
  const benefits = [
    { icon: Zap, title: "Work faster and with more ease", items: [
      "Create events in seconds with smart templates",
      "Auto-calculate budgets and splits",
      "One-click settlements and exports",
      "Everything in one place — no switching tools",
    ]},
    { icon: ShieldCheck, title: "Eliminate confusion & miscommunications", items: [
      "Everyone sees the same numbers",
      "Changes are tracked and visible in real time",
      "Conversations happen in the context of the event",
      "No more conflicting spreadsheet versions",
    ]},
  ];
  return (
    <section className="py-24 bg-foreground/[0.03] relative overflow-hidden">
      <FloatingParticles count={10} />
      <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-12">
        {benefits.map((b, i) => (
          <RevealSection key={b.title} delay={i * 200}>
            <Card className="h-full transition-all duration-300 hover:shadow-xl">
              <CardContent className="p-8 space-y-6">
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center">
                  <b.icon className="h-7 w-7 text-primary" />
                </div>
                <h3 className="font-display text-2xl font-bold text-foreground">{b.title}</h3>
                <ul className="space-y-3">
                  {b.items.map(item => (
                    <li key={item} className="flex items-start gap-3 text-muted-foreground">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </RevealSection>
        ))}
      </div>
    </section>
  );
}

/* ─── Positioning ─── */
function PositioningSection() {
  const rows = [
    { trad: "Built for one role", showme: "Built for the event" },
    { trad: "Emails + spreadsheets", showme: "One shared system" },
    { trad: "No real-time data", showme: "Live event data" },
    { trad: "Fragmented workflows", showme: "Connected workflow" },
  ];
  return (
    <section className="py-24">
      <RevealSection>
        <div className="max-w-4xl mx-auto px-6 space-y-10">
          <h2 className="font-display text-3xl lg:text-4xl font-bold text-foreground text-center">How shoWMe is different</h2>
          <div className="rounded-2xl border overflow-hidden shadow-lg">
            <div className="grid grid-cols-2">
              <div className="bg-muted px-6 py-4 font-display font-semibold text-sm text-muted-foreground">Traditional Tools</div>
              <div className="bg-primary/5 px-6 py-4 font-display font-semibold text-sm text-primary">shoWMe</div>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-2 border-t">
                <div className="px-6 py-4 flex items-center gap-3 text-sm text-muted-foreground">
                  <X className="h-4 w-4 text-destructive shrink-0" /> {r.trad}
                </div>
                <div className="px-6 py-4 flex items-center gap-3 text-sm text-foreground font-medium bg-primary/5">
                  <Check className="h-4 w-4 text-primary shrink-0" /> {r.showme}
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-muted-foreground">
            shoWMe connects your workflows instead of replacing everything
          </p>
        </div>
      </RevealSection>
    </section>
  );
}

/* ─── Solutions Page ─── */
export default function SolutionsPage() {
  return (
    <div className="min-h-screen bg-background">
      <LandingNav />
      <section className="relative bg-foreground text-background py-24 lg:py-32 overflow-hidden">
        <AnimatedGradient />
        <div className="max-w-6xl mx-auto px-6 text-center relative z-10">
          <RevealSection>
            <h1 className="font-display text-4xl lg:text-6xl font-bold tracking-tight">
              Solutions for every <span className="text-primary">role</span>
            </h1>
            <p className="text-lg text-background/70 mt-6 max-w-2xl mx-auto">
              Whether you're a venue, promoter, event organizer or performer — shoWMe adapts to how you work.
            </p>
          </RevealSection>
        </div>
      </section>
      <CollaborationSection />
      <WorkFasterSection />
      <PositioningSection />
      <FinalCTASection />
      <LandingFooter />
    </div>
  );
}
