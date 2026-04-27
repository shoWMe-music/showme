import { useState } from "react";
import { Check, ArrowRight, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { RevealSection } from "@/hooks/useScrollReveal";
import { AnimatedGradient } from "@/components/AnimatedBackground";
import { LandingNav, FinalCTASection, LandingFooter } from "./LandingPage";

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-muted-foreground">
      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function PricingCard({
  title,
  price,
  period,
  features,
  cta,
  badge: badgeText,
  highlighted,
}: {
  title: string;
  price: string;
  period?: string;
  features: string[];
  cta: React.ReactNode;
  badge?: string;
  highlighted?: boolean;
}) {
  return (
    <Card className={`relative flex flex-col h-full transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${highlighted ? "border-primary shadow-lg ring-2 ring-primary/20" : ""}`}>
      {badgeText && (
        <div className="absolute -top-3 left-6">
          <Badge variant="secondary" className="text-xs">{badgeText}</Badge>
        </div>
      )}
      <CardContent className="p-8 flex flex-col h-full gap-6">
        <div className="space-y-2">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-3xl font-bold">{price}</span>
            {period && <span className="text-sm text-muted-foreground">{period}</span>}
          </div>
        </div>
        <ul className="space-y-3 flex-1">
          {features.map((f) => (
            <Feature key={f}>{f}</Feature>
          ))}
        </ul>
        <div>{cta}</div>
      </CardContent>
    </Card>
  );
}

const CUSTOM_EVENT_STEPS = [60, 90, 120, 180, 210, 240, 270];

const ESSENTIAL_FEATURES = [
  "Unified calendar",
  "Basic event management",
  "Public Profile",
  "Receive booking requests",
  "Send booking requests",
  "In-app communication",
  "Basic notes, files & event status tracking",
  "Send & receive payments",
];

const ESSENTIAL_LIMITATIONS = [
  "No budgeting",
  "No settlements tools",
  "No agreements & contracting",
  "No internal team management & CRM",
  "No advanced analytics",
  "No additional users",
  "No advanced collaborator workflows",
];

const OPERATOR_FEATURES = [
  "Unified calendar",
  "Full event management",
  "Budgeting, Settlements & Payments",
  "Booking & scheduling tools",
  "Public Profile",
  "Receive Booking Requests",
  "In-app communication",
  "Multi-collaborators per event",
  "Internal team management & CRM",
  "Agreements & Contracting",
  "Analytics & Insights",
];

type BillingMode = "yearly" | "monthly";

function BillingToggle({ billing, setBilling }: { billing: BillingMode; setBilling: (b: BillingMode) => void }) {
  return (
    <div className="flex justify-center">
      <div className="inline-flex rounded-lg border border-border bg-muted p-1">
        <button
          onClick={() => setBilling("yearly")}
          className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
            billing === "yearly"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Pay yearly
        </button>
        <button
          onClick={() => setBilling("monthly")}
          className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
            billing === "monthly"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Pay monthly
        </button>
      </div>
    </div>
  );
}

function FixedPlanCard({
  title,
  events,
  users,
  monthlyYearly,
  annualTotal,
  monthlyInstallment,
  billing,
  highlighted,
}: {
  title: string;
  events: number;
  users: number;
  monthlyYearly: number;
  annualTotal: number;
  monthlyInstallment: number;
  billing: BillingMode;
  highlighted?: boolean;
}) {
  return (
    <Card className={`relative flex flex-col h-full transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${highlighted ? "border-primary shadow-lg ring-2 ring-primary/20" : ""}`}>
      {highlighted && (
        <div className="absolute -top-3 left-6">
          <Badge variant="secondary" className="text-xs">Most popular</Badge>
        </div>
      )}
      <CardContent className="p-8 flex flex-col h-full gap-6">
        <div className="space-y-1">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">Up to {events} events / year · {users} users</p>
        </div>

        <div className="space-y-1">
          {billing === "yearly" ? (
            <>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-3xl font-bold">€{monthlyYearly}</span>
                <span className="text-sm text-muted-foreground">/ month</span>
              </div>
              <p className="text-xs text-muted-foreground">Billed yearly · €{annualTotal} / year</p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-3xl font-bold">€{monthlyInstallment}</span>
                <span className="text-sm text-muted-foreground">/ month</span>
              </div>
              <p className="text-xs text-muted-foreground">Annual commitment, billed monthly</p>
            </>
          )}
        </div>

        <ul className="space-y-3 flex-1">
          <Feature>Up to {events} events per year</Feature>
          <Feature>{users} account users included</Feature>
          {OPERATOR_FEATURES.map((f) => (
            <Feature key={f}>{f}</Feature>
          ))}
        </ul>

        <Link to="/signup">
          <Button className="w-full" size="lg">
            Get started <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function CustomBuilderSection({ billing }: { billing: BillingMode }) {
  const [eventIndex, setEventIndex] = useState(0);
  const [users, setUsers] = useState(2);

  const events = CUSTOM_EVENT_STEPS[eventIndex];
  const eventAddon = ((events - 60) / 30) * 120;
  const userAddon = (users - 2) * 39;
  const annualPrice = 708 + eventAddon + userAddon;
  const monthlyAnnualTotal = Math.round(annualPrice * 1.18);
  const monthlyInstallment = Math.round(monthlyAnnualTotal / 12);

  return (
    <div className="max-w-3xl mx-auto">
      <Card className="border-border/50">
        <CardContent className="p-6 md:p-10 space-y-8">
          {/* Price display */}
          <div className="text-center space-y-1">
            {billing === "yearly" ? (
              <>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="font-display text-4xl lg:text-5xl font-bold">€{annualPrice}</span>
                  <span className="text-muted-foreground text-lg">/ year</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="font-display text-4xl lg:text-5xl font-bold">€{monthlyInstallment}</span>
                  <span className="text-muted-foreground text-lg">/ month</span>
                </div>
                <p className="text-xs text-muted-foreground">Annual commitment, billed monthly · €{monthlyAnnualTotal} / year</p>
              </>
            )}
          </div>

          {/* Sliders */}
          <div className="space-y-8">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Events per year</label>
                <span className="font-display text-lg font-bold text-primary">{events}</span>
              </div>
              <Slider
                value={[eventIndex]}
                onValueChange={([v]) => setEventIndex(v)}
                min={0}
                max={CUSTOM_EVENT_STEPS.length - 1}
                step={1}
                className="py-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>60</span>
                <span>270</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Users</label>
                <span className="font-display text-lg font-bold text-primary">{users}</span>
              </div>
              <Slider
                value={[users]}
                onValueChange={([v]) => setUsers(v)}
                min={2}
                max={10}
                step={1}
                className="py-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>2</span>
                <span>10</span>
              </div>
            </div>
          </div>

          {/* Breakdown */}
          <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Base bundle (60 events, 2 users)</span>
              <span className="font-medium">€708</span>
            </div>
            {eventAddon > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">+{events - 60} extra events</span>
                <span className="font-medium">€{eventAddon}</span>
              </div>
            )}
            {userAddon > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">+{users - 2} extra users</span>
                <span className="font-medium">€{userAddon}</span>
              </div>
            )}
            {billing === "monthly" ? (
              <>
                <div className="border-t border-border pt-2 flex justify-between">
                  <span className="text-muted-foreground">Annual subtotal</span>
                  <span className="font-medium">€{annualPrice}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monthly billing markup (18%)</span>
                  <span className="font-medium">€{monthlyAnnualTotal - annualPrice}</span>
                </div>
                <div className="border-t border-border pt-2 flex justify-between font-semibold">
                  <span>Annual total (billed monthly)</span>
                  <span>€{monthlyAnnualTotal}</span>
                </div>
                <div className="flex justify-between font-semibold text-primary">
                  <span>Monthly installment</span>
                  <span>€{monthlyInstallment}</span>
                </div>
              </>
            ) : (
              <div className="border-t border-border pt-2 flex justify-between font-semibold">
                <span>Annual total</span>
                <span>€{annualPrice}</span>
              </div>
            )}
          </div>

          {/* Features */}
          <div>
            <p className="text-sm font-medium mb-3">Includes all Event Operator features:</p>
            <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
              {OPERATOR_FEATURES.map((f) => (
                <Feature key={f}>{f}</Feature>
              ))}
            </ul>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Link to="/signup" className="flex-1">
              <Button className="w-full" size="lg">
                Get started <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
            <Button variant="outline" size="lg" className="flex-1">Contact us</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OperatorPricingSection() {
  const [billing, setBilling] = useState<BillingMode>("yearly");
  const [showCustom, setShowCustom] = useState(false);

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

        {/* Billing toggle */}
        <RevealSection delay={100}>
          <BillingToggle billing={billing} setBilling={setBilling} />
        </RevealSection>

        {/* Plan cards */}
        <RevealSection delay={150}>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <VenuesEssentialCard />
            <FixedPlanCard
              title="PRO"
              events={150}
              users={3}
              monthlyYearly={99}
              annualTotal={1188}
              monthlyInstallment={117}
              billing={billing}
            />
            <FixedPlanCard
              title="PRO+"
              events={300}
              users={10}
              monthlyYearly={199}
              annualTotal={2388}
              monthlyInstallment={235}
              billing={billing}
              highlighted
            />
          </div>
        </RevealSection>

        {/* Customize link */}
        <RevealSection delay={250}>
          <div className="text-center">
            <button
              onClick={() => setShowCustom(!showCustom)}
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
            >
              Customize your subscription
            </button>
          </div>
        </RevealSection>

        {/* Custom builder */}
        {showCustom && (
          <RevealSection delay={0}>
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="font-display text-xl font-semibold">Customize your subscription</h3>
                <p className="text-sm text-muted-foreground mt-1">Choose the event volume and team size that fit your operation.</p>
              </div>
              <CustomBuilderSection billing={billing} />
            </div>
          </RevealSection>
        )}

        {/* Payment fee comparison */}
        <RevealSection delay={300}>
          <PaymentFeeInfo />
        </RevealSection>

        {/* Features list */}
        <RevealSection delay={350}>
          <div className="max-w-3xl mx-auto">
            <p className="text-sm font-medium text-center mb-4">Included in every Event Operator plan</p>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
              {OPERATOR_FEATURES.map((f) => (
                <Feature key={f}>{f}</Feature>
              ))}
            </ul>
          </div>
        </RevealSection>

        {/* Billing terms */}
        <RevealSection delay={350}>
          <ul className="text-center text-xs text-muted-foreground space-y-1 max-w-3xl mx-auto">
            <li>Valid for 12 months from account creation</li>
            <li>Unused events roll over into the next year with renewal</li>
            <li>Need more events before renewal? Top up anytime with an event add-on bundle</li>
            <li>Monthly installments are based on an annual commitment</li>
          </ul>
        </RevealSection>
      </div>
    </section>
  );
}
function VenuesEssentialCard() {
  return (
    <Card className="border-border/50 flex flex-col h-full">
      <CardContent className="p-8 flex flex-col h-full gap-6">
        <div className="space-y-2">
          <h3 className="font-display text-lg font-semibold">Essential</h3>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-3xl font-bold">Free</span>
          </div>
          <p className="text-sm text-muted-foreground">Up to 30 events / year · 1 user</p>
        </div>

        <ul className="space-y-2 flex-1">
          {ESSENTIAL_FEATURES.map((f) => (
            <Feature key={f}>{f}</Feature>
          ))}
        </ul>

        <div className="border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Not included</p>
          <ul className="space-y-1.5">
            {ESSENTIAL_LIMITATIONS.map((l) => (
              <li key={l} className="flex items-start gap-2 text-xs text-muted-foreground/70">
                <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>

        <Link to="/signup">
          <Button variant="outline" className="w-full" size="lg">
            Get started
          </Button>
        </Link>

        <p className="text-xs text-center text-muted-foreground">
          Need more than 90 events, more users, or full workflow tools?{" "}
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="text-primary hover:underline font-medium">
            Upgrade to PRO
          </button>
        </p>
      </CardContent>
    </Card>
  );
}

function PaymentFeeInfo() {
  return (
    <div className="max-w-3xl mx-auto">
      <Card className="border-border/50 bg-muted/30">
        <CardContent className="p-6">
          <p className="text-sm font-medium mb-4 text-center">Payment fees</p>
          <div className="grid sm:grid-cols-3 gap-4 text-center text-sm">
            <div className="space-y-1">
              <p className="font-medium">Essential</p>
              <p className="text-muted-foreground text-xs">Standard shoWMe payment fee</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium">PRO & above</p>
              <p className="text-muted-foreground text-xs">Lower shoWMe payment fees</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium">All plans</p>
              <p className="text-muted-foreground text-xs">Third-party processing fees are fixed</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TopUpSection() {
  const proBundles = [
    { events: 30, price: 139 },
    { events: 60, price: 269 },
    { events: 150, price: 649 },
  ];

  const essentialBundles = [
    { events: 10, price: 19 },
    { events: 20, price: 35 },
    { events: 30, price: 49 },
  ];

  return (
    <section className="py-16 bg-foreground/[0.03]">
      <div className="max-w-6xl mx-auto px-6 space-y-12">
        <RevealSection>
          <h2 className="font-display text-2xl lg:text-3xl font-bold text-center">Need more events?</h2>
          <p className="text-center text-muted-foreground mt-2">Top up your bundle anytime during your subscription period.</p>
        </RevealSection>

        {/* PRO top-ups */}
        <RevealSection delay={100}>
          <div className="space-y-4">
            <p className="text-sm font-medium text-center">PRO & Custom plans</p>
            <div className="flex flex-wrap gap-6 justify-center">
              {proBundles.map((b) => (
                <Card key={b.events} className="transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                  <CardContent className="p-6 text-center space-y-2">
                    <p className="font-display text-2xl font-bold">€{b.price}</p>
                    <p className="text-sm text-muted-foreground">+{b.events} events</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <ul className="text-center text-xs text-muted-foreground space-y-1">
              <li>Valid for 12 months from account creation</li>
              <li>Unused events roll over into the next year with renewal</li>
              <li>Top up anytime — no need to wait for renewal</li>
            </ul>
          </div>
        </RevealSection>

        {/* Essential top-ups */}
        <RevealSection delay={200}>
          <div className="space-y-4">
            <p className="text-sm font-medium text-center">Essential</p>
            <div className="flex flex-wrap gap-6 justify-center">
              {essentialBundles.map((b) => (
                <Card key={b.events} className="transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                  <CardContent className="p-5 text-center space-y-2">
                    <p className="font-display text-xl font-bold">€{b.price}</p>
                    <p className="text-sm text-muted-foreground">+{b.events} events</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <ul className="text-center text-xs text-muted-foreground space-y-1">
              <li>Top-ups add events only · Do not unlock paid features or add users · Do not roll over</li>
              <li>Max 60 additional events per year</li>
            </ul>
            <p className="text-xs text-center text-muted-foreground">
              Need more than 90 total events per year?{" "}
              <Link to="/pricing" className="text-primary hover:underline font-medium">Upgrade to PRO</Link>
            </p>
          </div>
        </RevealSection>
      </div>
    </section>
  );
}

function EnterpriseSection() {
  return (
    <section className="py-16">
      <div className="max-w-6xl mx-auto px-6">
        <RevealSection>
          <Card className="max-w-2xl mx-auto">
            <CardContent className="p-8 text-center space-y-4">
              <h3 className="font-display text-xl font-bold">Enterprise</h3>
              <p className="font-display text-3xl font-bold">Custom</p>
              <ul className="space-y-2 text-sm text-muted-foreground text-left max-w-xs mx-auto">
                <Feature>Multi-team / multi-entity operations</Feature>
                <Feature>Everything in the standard bundle</Feature>
                <Feature>Custom workflows & integrations</Feature>
                <Feature>API access</Feature>
                <Feature>Dedicated support</Feature>
              </ul>
              <Button variant="outline" className="w-full max-w-xs">Contact us</Button>
            </CardContent>
          </Card>
        </RevealSection>
      </div>
    </section>
  );
}

type PricingView = "operators" | "artists";

export default function PricingPage() {
  const [view, setView] = useState<PricingView>("operators");

  return (
    <div className="min-h-screen bg-background">
      <LandingNav />

      {/* Hero */}
      <section className="relative bg-foreground text-background py-24 lg:py-32 overflow-hidden">
        <AnimatedGradient />
        <div className="max-w-6xl mx-auto px-6 text-center space-y-6 relative z-10">
          <RevealSection>
            <h1 className="font-display text-4xl lg:text-6xl font-bold tracking-tight">
              Built for <span className="text-primary">Events</span>. Benefits <span className="text-primary">Everyone</span>.
            </h1>
            <p className="text-lg lg:text-xl text-background/60 max-w-2xl mx-auto mt-4">
              Run Your Events, Not Your Inbox.
            </p>
          </RevealSection>

          <RevealSection delay={150}>
            <p className="text-lg lg:text-xl text-background/60 max-w-2xl mx-auto">
              Get a ready made subscription-package or customize your own based on your event volume and account users
            </p>
          </RevealSection>
        </div>
      </section>

      {/* Toggle Section */}
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

      {view === "artists" ? (
        <section className="py-16 bg-foreground/[0.03]">
          <div className="max-w-6xl mx-auto px-6 space-y-10">
            <RevealSection>
              <h2 className="font-display text-2xl lg:text-3xl font-bold text-center">Performers Only</h2>
            </RevealSection>
            <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
              <RevealSection>
                <PricingCard
                  title="Basic"
                  price="Free"
                  features={[
                    "Unified calendar",
                    "Public Profile (EPK) management",
                    "Receive offers from venues, promoters, organizers",
                    "Send booking requests to venues in the system",
                  ]}
                  cta={
                    <Link to="/signup">
                      <Button className="w-full">Get started</Button>
                    </Link>
                  }
                />
              </RevealSection>
              <RevealSection delay={150}>
                <PricingCard
                  title="PRO"
                  price="€9.99"
                  period="/ month"
                  badge="Coming soon"
                  features={[
                    "Unified calendar",
                    "Public Profile (EPK) management",
                    "Receive offers from venues, promoters, organizers",
                    "Send booking requests to venues in the system",
                    "Use our AI agent to send out requests to any venue",
                    "AI tour builder",
                    "Team Management & CRM",
                    "Manage & respond to booking requests",
                    "Invoicing & payments",
                  ]}
                  cta={
                    <Button className="w-full" disabled>Coming soon</Button>
                  }
                />
              </RevealSection>
            </div>
          </div>
        </section>
      ) : (
        <>
          <OperatorPricingSection />
          <TopUpSection />
          <EnterpriseSection />
        </>
      )}

      <FinalCTASection />
      <LandingFooter />
    </div>
  );
}
