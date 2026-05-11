import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RevealSection } from "@/hooks/useScrollReveal";
import { BreathingGlow, FloatingShapes, AnimatedGradient, FloatingParticles } from "@/components/AnimatedBackground";
import logo from "@/assets/showme-logo.png";
import logoDark from "@/assets/showme-logo-dark.png";
import {
  MessageSquareOff, TrendingDown, Unplug,
  Check, ArrowRight, Menu, X,
} from "lucide-react";

const BOOK_DEMO_MAILTO =
  "mailto:contact@showme.music?subject=" + encodeURIComponent("Book a demo — shoWMe");

/* ─── Sticky Nav (exported for reuse) ─── */
export function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-border/50 bg-background" aria-label="Main">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex min-w-0 items-center gap-8">
          <Link to="/landing" className="shrink-0">
            <img src={logo} alt="shoWMe" className="h-16 object-contain" />
          </Link>
          <span className="hidden truncate text-sm text-muted-foreground lg:inline">
            Built for <span className="font-medium text-primary">events</span>. Benefits <span className="font-medium text-primary">everyone</span>.
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <div className="hidden items-center gap-6 md:flex">
            <Link to="/product" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Product</Link>
            <Link to="/solutions" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Solutions</Link>
            <Link to="/about" className="text-sm text-muted-foreground transition-colors hover:text-foreground">About</Link>
            {/* <Link to="/pricing" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Pricing</Link> */}
          </div>
          <Link to="/login" className="hidden md:inline-flex">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link to="/signup" className="hidden md:inline-flex">
            <Button size="sm">Start free trial</Button>
          </Link>
          <button
            type="button"
            className="rounded-lg p-2 transition-colors hover:bg-muted md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="animate-in space-y-3 border-t border-border/50 bg-background px-6 py-4 duration-200 slide-in-from-top-2 md:hidden">
          <Link to="/product" className="block text-sm text-muted-foreground transition-colors hover:text-foreground" onClick={() => setMobileOpen(false)}>Product</Link>
          <Link to="/solutions" className="block text-sm text-muted-foreground transition-colors hover:text-foreground" onClick={() => setMobileOpen(false)}>Solutions</Link>
          <Link to="/about" className="block text-sm text-muted-foreground transition-colors hover:text-foreground" onClick={() => setMobileOpen(false)}>About</Link>
          {/* <Link to="/pricing" className="block text-sm text-muted-foreground transition-colors hover:text-foreground" onClick={() => setMobileOpen(false)}>Pricing</Link> */}
          <div className="flex gap-3 pt-2">
            <Link to="/login" onClick={() => setMobileOpen(false)}>
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link to="/signup" onClick={() => setMobileOpen(false)}>
              <Button size="sm">Start free trial</Button>
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
/* ─── Final CTA (exported for reuse) ─── */
export function FinalCTASection() {
  return (
    <section className="relative bg-foreground text-background py-24 overflow-hidden">
      <AnimatedGradient />
      <RevealSection>
        <div className="max-w-6xl mx-auto px-6 text-center space-y-8">
          <h2 className="font-display text-3xl lg:text-5xl font-bold leading-tight">
            Run your next <span className="text-primary">event</span> inside shoWMe
          </h2>
          <p className="text-lg text-background/70">
            Built for <span className="text-primary">events</span>. Benefits <span className="text-primary">everyone</span>.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link to="/signup">
              <Button size="lg" className="font-semibold text-base px-8">30 days trial</Button>
            </Link>
            <Button variant="outline" size="lg" className="bg-transparent border-background/30 text-background hover:bg-background hover:text-foreground text-base px-8" asChild>
              <a href={BOOK_DEMO_MAILTO}>Book a demo</a>
            </Button>
          </div>
        </div>
      </RevealSection>
    </section>
  );
}

/* ─── Footer (exported for reuse) ─── */
export function LandingFooter() {
  return (
    <footer className="border-t py-10">
      <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src={logo} alt="shoWMe" className="h-6" />
          <span className="text-xs text-muted-foreground">
            Built for <span className="text-primary">events</span>. Benefits <span className="text-primary">everyone</span>.
          </span>
        </div>
        <div className="flex items-center gap-6">
          <Link to="/about" className="text-xs text-muted-foreground hover:text-foreground transition-colors">About</Link>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} shoWMe. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

/* ─── Hero (Dark) ─── */
function HeroSection() {
  return (
    <section className="relative bg-foreground text-background py-24 lg:py-32 overflow-hidden">
      <AnimatedGradient />
      <div className="max-w-6xl mx-auto px-6 text-center space-y-8 relative z-10">
        <RevealSection>
          <div className="flex justify-center mb-8">
            <div className="relative">
              <BreathingGlow />
              <img src={logoDark} alt="shoWMe" className="h-36 lg:h-48 relative z-10" />
            </div>
          </div>
          <h1 className="font-display text-5xl lg:text-7xl font-bold tracking-tight leading-[1.05]">
            Built for <span className="text-primary">events</span>.<br />
            Benefits <span className="text-primary">everyone</span>.
          </h1>
          <p className="text-lg lg:text-xl text-background/70 max-w-2xl mx-auto">
            Plan, manage, negotiate, and settle every event in one shared system — built for the event, not just one side of the industry.
          </p>
          <div className="flex flex-wrap gap-4 justify-center pt-4">
            <Link to="/signup">
              <Button size="lg" className="font-semibold text-base px-8">30 days free trial</Button>
            </Link>
            <Button variant="outline" size="lg" className="bg-transparent border-background/30 text-background hover:bg-background hover:text-foreground text-base px-8" asChild>
              <a href={BOOK_DEMO_MAILTO}>Book a demo</a>
            </Button>
          </div>
        </RevealSection>
      </div>
    </section>
  );
}

/* ─── Problem ─── */
function ProblemSection() {
  const problems = [
    { icon: MessageSquareOff, title: "Fragmented communication", text: "Emails, messages, and calls scattered everywhere" },
    { icon: TrendingDown, title: "No financial clarity", text: "You don't know if the event works until it's over" },
    { icon: Unplug, title: "Disconnected parties", text: "Everyone works separately on the same event" },
  ];
  return (
    <section className="py-24 relative overflow-hidden">
      <FloatingShapes />
      <div className="max-w-6xl mx-auto px-6 text-center space-y-12">
        <RevealSection>
          <h2 className="font-display text-3xl lg:text-4xl font-bold text-foreground">Events are managed across chaos</h2>
        </RevealSection>
        <div className="grid md:grid-cols-3 gap-6">
          {problems.map((p, i) => (
            <RevealSection key={p.title} delay={i * 150}>
              <Card className="text-left border-l-4 border-l-primary transition-all duration-300 hover:-translate-y-1 hover:shadow-xl h-full">
                <CardContent className="p-8 space-y-4">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <p.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-display font-semibold text-lg">{p.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.text}</p>
                </CardContent>
              </Card>
            </RevealSection>
          ))}
        </div>
        <RevealSection delay={450}>
          <p className="text-xl font-semibold text-foreground">
            You are not managing events. You are chasing information.
          </p>
        </RevealSection>
      </div>
    </section>
  );
}

/* ─── The Shift ─── */
function ShiftSection() {
  const nodes = [
    { label: "Venue", angle: -45 },
    { label: "Performer / Agent", angle: 45 },
    { label: "Promoter", angle: 135 },
    { label: "Team", angle: 225 },
  ];
  return (
    <section className="py-24 bg-foreground/[0.03] relative overflow-hidden">
      <FloatingParticles count={15} />
      <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
        <RevealSection>
          <div className="space-y-6">
            <h2 className="font-display text-3xl lg:text-4xl font-bold text-foreground">Make the event the center</h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              shoWMe turns every event into a shared workspace where all parties operate on the same information in real time.
            </p>
            <p className="text-muted-foreground font-medium">One system. One event. All parties.</p>
          </div>
        </RevealSection>
        <RevealSection delay={200}>
          <div className="flex items-center justify-center">
            <div className="relative w-80 h-80 rounded-2xl bg-foreground/[0.04] border border-border/50 p-4">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-28 w-28 rounded-full bg-primary/15 animate-pulse-ring" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-full bg-primary flex items-center justify-center text-primary-foreground font-display font-bold shadow-lg" style={{ width: 88, height: 88 }}>
                  Event
                </div>
              </div>
              {nodes.map((n) => {
                const rad = (n.angle * Math.PI) / 180;
                const r = 120;
                const cx = 152, cy = 152;
                const x = cx + r * Math.cos(rad) - 44;
                const y = cy + r * Math.sin(rad) - 16;
                return (
                  <div key={n.label}>
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
                      <line
                        x1={cx} y1={cy}
                        x2={x + 44} y2={y + 16}
                        stroke="hsl(var(--primary))" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.4"
                      />
                    </svg>
                    <div
                      className="absolute rounded-lg border bg-card px-4 py-2 text-xs font-medium text-foreground shadow-sm transition-all duration-300 hover:shadow-md hover:border-primary/50"
                      style={{ left: x, top: y, zIndex: 1 }}
                    >
                      {n.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </RevealSection>
      </div>
    </section>
  );
}

/* ─── Main Page (Home) ─── */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <LandingNav />
      <HeroSection />
      <ProblemSection />
      <ShiftSection />
      <FinalCTASection />
      <LandingFooter />
    </div>
  );
}
