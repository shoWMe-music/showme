import { useMemo, useState } from "react";
import { Check, ArrowRight, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { RevealSection } from "@/hooks/useScrollReveal";
import { AnimatedGradient } from "@/components/AnimatedBackground";
import { LandingNav, FinalCTASection, LandingFooter } from "./LandingPage";

// ─── Constants from the internal pricing PDF (May 2026) ──────────────────────
//
// Source: /docs/showme-pricing-internal.pdf — kept here as primary source
// of truth for the public page. Free Operator is 60 confirmed events/year +
// 1 seat. Operator Pro is €99/month billed yearly, 2 seats included, +€15
// per extra seat. Artist Pro is €9.99/month. All four account types have
// transaction fees on the Mollie payment rail; this page is subscription-only.

const FREE_OPERATOR_EVENT_CAP = 60;
const OPERATOR_PRO_BASE_PRICE = 99;
const OPERATOR_PRO_BASE_SEATS = 2;
const OPERATOR_PRO_EXTRA_SEAT = 15;
const ARTIST_PRO_PRICE = 9.99;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-muted-foreground">
      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function NotIncluded({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs text-muted-foreground/70">
      <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  );
}

// ─── Operator tier ───────────────────────────────────────────────────────────

const FREE_OPERATOR_FEATURES = [
  "1 seat, 1 workspace",
  `Up to ${FREE_OPERATOR_EVENT_CAP} confirmed events / year`,
  "Public Profile and EPK, visible in discovery and AI matching",
  "Multi-collaborator events — invite unlimited external collaborators per event",
  "In-event messaging — no volume limits inside an event",
  "Receive booking offers, respond, sign agreements, upload riders",
  "Settlement and payment processing (transaction fees apply)",
  "View and edit on invited events",
];

const FREE_OPERATOR_EXCLUDED = [
  "Internal team management & CRM",
  "Audience management and marketing tools",
  "Promoter and campaign tools",
  "API access and external integrations",
  "Admin role and permission management",
  "AI matching and AI tour builder",
  "Advanced analytics and reporting",
];

const OPERATOR_PRO_FEATURES = [
  "Unlimited events, no annual cap",
  "Internal team management and CRM",
  "Audience management and contact lists",
  "Marketing tools and promoter workflows",
  "AI matching and AI tour builder",
  "API access and integrations",
  "Advanced analytics and reporting",
  "Admin role and full permission management",
  "Priority onboarding and support",
];

function FreeOperatorCard() {
  return (
    <Card className="border-border/50 flex flex-col h-full">
      <CardContent className="p-8 flex flex-col h-full gap-6">
        <div className="space-y-2">
          <h3 className="font-display text-lg font-semibold">Free Operator</h3>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-3xl font-bold">Free</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Up to {FREE_OPERATOR_EVENT_CAP} confirmed events / year · 1 seat
          </p>
        </div>

        <ul className="space-y-2 flex-1">
          {FREE_OPERATOR_FEATURES.map((f) => (
            <Feature key={f}>{f}</Feature>
          ))}
        </ul>

        <div className="border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Not included</p>
          <ul className="space-y-1.5">
            {FREE_OPERATOR_EXCLUDED.map((l) => (
              <NotIncluded key={l}>{l}</NotIncluded>
            ))}
          </ul>
        </div>

        <Link to="/signup">
          <Button variant="outline" className="w-full" size="lg">
            Get started
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function operatorProAnnualPrice(seats: number): number {
  const extras = Math.max(0, seats - OPERATOR_PRO_BASE_SEATS);
  const monthly = OPERATOR_PRO_BASE_PRICE + extras * OPERATOR_PRO_EXTRA_SEAT;
  return monthly * 12;
}

function OperatorProCard() {
  const [seats, setSeats] = useState<number>(OPERATOR_PRO_BASE_SEATS);
  const annualPrice = useMemo(() => operatorProAnnualPrice(seats), [seats]);
  const monthlyEquivalent = annualPrice / 12;
  const extras = Math.max(0, seats - OPERATOR_PRO_BASE_SEATS);

  return (
    <Card className="border-primary shadow-lg ring-2 ring-primary/20 flex flex-col h-full">
      <div className="absolute -top-3 left-6">
        <Badge variant="secondary" className="text-xs">Most popular</Badge>
      </div>
      <CardContent className="p-8 flex flex-col h-full gap-6">
        <div className="space-y-2">
          <h3 className="font-display text-lg font-semibold">Operator Pro</h3>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-3xl font-bold">€{Math.round(monthlyEquivalent)}</span>
            <span className="text-sm text-muted-foreground">/ month</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Billed yearly · €{annualPrice.toLocaleString()} / year · {seats} {seats === 1 ? "seat" : "seats"}
          </p>
        </div>

        {/* Seat slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Team size</label>
            <span className="font-display text-lg font-bold text-primary">{seats}</span>
          </div>
          <Slider
            value={[seats]}
            onValueChange={([v]) => setSeats(v)}
            min={OPERATOR_PRO_BASE_SEATS}
            max={15}
            step={1}
            className="py-2"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>2 (included)</span>
            <span>15</span>
          </div>
          {extras > 0 && (
            <p className="text-xs text-muted-foreground">
              €{OPERATOR_PRO_BASE_PRICE} base + {extras} × €{OPERATOR_PRO_EXTRA_SEAT} per extra seat
            </p>
          )}
        </div>

        <ul className="space-y-2 flex-1">
          <Feature>Everything in Free Operator</Feature>
          {OPERATOR_PRO_FEATURES.map((f) => (
            <Feature key={f}>{f}</Feature>
          ))}
        </ul>

        <Link to="/signup">
          <Button className="w-full" size="lg">
            Get started <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
        <p className="text-xs text-center text-muted-foreground">
          Mollie self-serve is on its way. For now, sign up and contact us — we&apos;ll set it up.
        </p>
      </CardContent>
    </Card>
  );
}

function OperatorPricingSection() {
  return (
    <section className="py-16">
      <div className="max-w-6xl mx-auto px-6 space-y-10">
        <RevealSection>
          <h2 className="font-display text-2xl lg:text-3xl font-bold text-center">
            For Event Operators
          </h2>
          <p className="text-center text-muted-foreground mt-2">
            Venues, Promoters, Festivals, Event Organizers / Producers
          </p>
        </RevealSection>

        <RevealSection delay={100}>
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <FreeOperatorCard />
            <div className="relative">
              <OperatorProCard />
            </div>
          </div>
        </RevealSection>

        <RevealSection delay={200}>
          <PaymentRailInfo />
        </RevealSection>
      </div>
    </section>
  );
}

// ─── Artist tier ─────────────────────────────────────────────────────────────

const FREE_ARTIST_FEATURES = [
  "Public Profile (EPK) management",
  "Profile in discovery, eligible for AI matching",
  "Receive offers from venues, promoters, organizers",
  "Send booking requests to venues already in the system",
  "Sign agreements, upload riders, communicate within events",
  "Receive payments (transaction fees apply)",
];

const ARTIST_PRO_FEATURES = [
  "AI agent to send booking requests to any venue, including outside the network",
  "AI tour builder with route optimization and venue suggestions",
  "Full invoicing workflow (outbound invoices, expense tracking, statements)",
  "Multiple band members on one Artist account",
  "Analytics on profile views, offer rates, booking conversion",
];

function FreeArtistCard() {
  return (
    <Card className="border-border/50 flex flex-col h-full">
      <CardContent className="p-8 flex flex-col h-full gap-6">
        <div className="space-y-2">
          <h3 className="font-display text-lg font-semibold">Free Artist</h3>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-3xl font-bold">Free</span>
          </div>
        </div>
        <ul className="space-y-2 flex-1">
          {FREE_ARTIST_FEATURES.map((f) => (
            <Feature key={f}>{f}</Feature>
          ))}
        </ul>
        <Link to="/signup">
          <Button variant="outline" className="w-full" size="lg">
            Get started
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function ArtistProCard() {
  return (
    <Card className="border-primary shadow-lg ring-2 ring-primary/20 flex flex-col h-full">
      <CardContent className="p-8 flex flex-col h-full gap-6">
        <div className="space-y-2">
          <h3 className="font-display text-lg font-semibold">Artist Pro</h3>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-3xl font-bold">€{ARTIST_PRO_PRICE.toFixed(2)}</span>
            <span className="text-sm text-muted-foreground">/ month</span>
          </div>
          <p className="text-xs text-muted-foreground">For working musicians</p>
        </div>
        <ul className="space-y-2 flex-1">
          <Feature>Everything in Free Artist</Feature>
          {ARTIST_PRO_FEATURES.map((f) => (
            <Feature key={f}>{f}</Feature>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Team Management & CRM (managers, agents, tour managers) available as a separate add-on.
        </p>
        <Link to="/signup">
          <Button className="w-full" size="lg">
            Get started <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function ArtistPricingSection() {
  return (
    <section className="py-16 bg-foreground/[0.03]">
      <div className="max-w-6xl mx-auto px-6 space-y-10">
        <RevealSection>
          <h2 className="font-display text-2xl lg:text-3xl font-bold text-center">For Performers</h2>
          <p className="text-center text-muted-foreground mt-2">
            For working musicians. Discovery and respond-to-offers stay free forever.
          </p>
        </RevealSection>
        <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          <RevealSection>
            <FreeArtistCard />
          </RevealSection>
          <RevealSection delay={150}>
            <ArtistProCard />
          </RevealSection>
        </div>
        <RevealSection delay={250}>
          <PaymentRailInfo />
        </RevealSection>
      </div>
    </section>
  );
}

// ─── Payment-rail info ───────────────────────────────────────────────────────

function PaymentRailInfo() {
  return (
    <div className="max-w-3xl mx-auto">
      <Card className="border-border/50 bg-muted/30">
        <CardContent className="p-6 text-center space-y-2">
          <p className="text-sm font-medium">Integrated payments, powered by Mollie</p>
          <p className="text-xs text-muted-foreground">
            Settlement and payment processing is built in. Competitive transaction fees apply to every account
            type, with lower fees on Pro plans. No separate processor account needed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Top of page ─────────────────────────────────────────────────────────────

type PricingView = "operators" | "artists";

export default function PricingPage() {
  const [view, setView] = useState<PricingView>("operators");

  return (
    <div className="min-h-screen bg-background">
      <LandingNav />

      <section className="relative bg-foreground text-background py-24 lg:py-32 overflow-hidden">
        <AnimatedGradient />
        <div className="max-w-6xl mx-auto px-6 text-center space-y-6 relative z-10">
          <RevealSection>
            <h1 className="font-display text-4xl lg:text-6xl font-bold tracking-tight">
              Built for <span className="text-primary">Events</span>. Benefits <span className="text-primary">Everyone</span>.
            </h1>
            <p className="text-lg lg:text-xl text-background/60 max-w-2xl mx-auto mt-4">
              Two products, two business models. Free is its own product — not a stripped-down trial.
            </p>
          </RevealSection>
        </div>
      </section>

      <section className="py-12 bg-background border-b">
        <div className="max-w-6xl mx-auto px-6 text-center space-y-6">
          <RevealSection>
            <h2 className="font-display text-3xl lg:text-4xl font-bold">What describes you best?</h2>
          </RevealSection>
          <RevealSection delay={150}>
            <div className="inline-flex rounded-lg border border-border bg-muted p-1.5">
              <button
                onClick={() => setView("operators")}
                className={`px-8 py-3 rounded-md text-base font-medium transition-all ${
                  view === "operators"
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Event Operator
              </button>
              <button
                onClick={() => setView("artists")}
                className={`px-8 py-3 rounded-md text-base font-medium transition-all ${
                  view === "artists"
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Performer
              </button>
            </div>
          </RevealSection>
        </div>
      </section>

      {view === "artists" ? <ArtistPricingSection /> : <OperatorPricingSection />}

      <FinalCTASection />
      <LandingFooter />
    </div>
  );
}
