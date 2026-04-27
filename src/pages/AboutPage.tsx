import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { RevealSection } from "@/hooks/useScrollReveal";
import { BreathingGlow, FloatingShapes, AnimatedGradient, FloatingParticles } from "@/components/AnimatedBackground";
import logoDark from "@/assets/showme-logo-dark.png";
import { ArrowRight, Heart, Palette, Leaf, UsersRound } from "lucide-react";
import { LandingNav, FinalCTASection, LandingFooter } from "./LandingPage";


/* ─── Values data ─── */
const values = [
  {
    icon: Heart,
    title: "Fairness",
    description:
      "Performers and venues deserve transparency and equitable opportunities. We've built shoWMe to reduce the barriers, biases, and inequities that exist in the booking process.",
  },
  {
    icon: Palette,
    title: "Diversity",
    description:
      "From emerging talents to seasoned professionals, we celebrate the unique styles, sounds, and stories of artists from all walks of life.",
  },
  {
    icon: Leaf,
    title: "Sustainability",
    description:
      "A thriving live music industry benefits everyone: artists, venues, and audiences. By increasing income potential for all parties, we're paving the way for a sustainable, long-term future.",
  },
  {
    icon: UsersRound,
    title: "Community",
    description:
      "Music connects us, and our platform is here to strengthen those connections by fostering collaboration, respect, and shared success.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingNav />

      {/* ── SECTION 1: Hero (Dark) ── */}
      <section className="relative bg-foreground text-background py-24 lg:py-32 overflow-hidden">
        <AnimatedGradient />
        <div className="max-w-4xl mx-auto px-6 relative z-10">
          <RevealSection>
            <div className="space-y-6 text-center">
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <BreathingGlow />
                  <img src={logoDark} alt="shoWMe" className="h-36 lg:h-48 relative z-10" />
                </div>
              </div>
              <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1]">
                Why we built <span className="text-primary">shoWMe</span>
              </h1>
              <p className="text-lg text-background/70 leading-relaxed max-w-2xl mx-auto">
                shoWMe's founder is Ran Nir, a musician and industry professional who has worked as an artist, booker, artist manager, and within venues.
              </p>
              <p className="text-lg text-background/70 leading-relaxed max-w-2xl mx-auto">
                Across all these roles, he kept running into the same issue:
                <br />
                not a lack of talent or effort, but a system that makes collaboration harder than it should be.
              </p>
              <Link to="/landing">
                <Button variant="outline" className="mt-4 gap-2 bg-transparent border-background/30 text-background hover:bg-background hover:text-foreground">
                  See how it works <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </RevealSection>
        </div>
      </section>

      {/* ── SECTION 2: The Problem ── */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <RevealSection>
            <div className="space-y-6">
              <h2 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold">What we see</h2>
              <div className="space-y-4 text-muted-foreground leading-relaxed max-w-2xl">
                <p>An event starts with a simple idea.<br />A date, a venue, an artist.</p>
                <p>Then everything spreads across emails, messages, spreadsheets, and calls.</p>
                <p>
                  Details change, but not everyone sees it.<br />
                  Important information lives in different places.<br />
                  Budgets stay unclear until the last moment.<br />
                  Conversations disappear in threads.
                </p>
                <p>
                  Everyone is working on the same event, but from different places, with different information.
                </p>
                <p className="font-medium text-foreground text-xl">Not truly together.</p>
              </div>
            </div>
          </RevealSection>
        </div>
      </section>

      {/* ── Minimal Diagram ── */}
      <section className="py-24 bg-foreground/[0.03] relative overflow-hidden">
        <FloatingShapes />
        <div className="max-w-4xl mx-auto px-6">
          <RevealSection>
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-8 md:gap-12">
                {/* Fragmented side */}
                <div className="flex flex-col items-end gap-3 text-sm text-muted-foreground">
                  <span className="rounded-lg border bg-card px-4 py-2 shadow-sm">Emails</span>
                  <span className="rounded-lg border bg-card px-4 py-2 shadow-sm">Spreadsheets</span>
                  <span className="rounded-lg border bg-card px-4 py-2 shadow-sm">Messages</span>
                </div>

                {/* Arrow */}
                <div className="flex flex-col items-center gap-1">
                  <div className="w-px h-6 bg-border" />
                  <ArrowRight className="h-5 w-5 text-primary" />
                  <div className="w-px h-6 bg-border" />
                </div>

                {/* Center: Event node with glow */}
                <div className="relative">
                  <div className="absolute inset-0 -m-4 rounded-full bg-primary/15 blur-xl animate-pulse-ring" />
                  <div className="relative h-20 w-20 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-display font-bold shadow-lg">
                    Event
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex flex-col items-center gap-1">
                  <div className="w-px h-6 bg-border" />
                  <ArrowRight className="h-5 w-5 text-primary" />
                  <div className="w-px h-6 bg-border" />
                </div>

                {/* Connected side */}
                <div className="text-left">
                  <span className="rounded-xl border-2 border-primary/30 bg-primary/5 px-5 py-3 font-display font-semibold text-foreground shadow-sm inline-block">
                    Shared workflow
                  </span>
                </div>
              </div>
              <div className="flex justify-center mt-8 gap-28 text-sm text-muted-foreground">
                <span>Fragmented</span>
                <span className="text-primary font-medium">Connected</span>
              </div>
            </div>
          </RevealSection>
        </div>
      </section>

      {/* ── SECTION 3: Impact ── */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <RevealSection>
            <div className="space-y-6">
              <h2 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold">What that leads to</h2>
              <p className="text-muted-foreground leading-relaxed max-w-2xl text-lg">
                When people don't share the same structure or visibility, trust becomes harder.
              </p>
              <ul className="space-y-4 text-muted-foreground">
                <li className="flex items-start gap-3">
                  <span className="mt-2 h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                  <span className="text-lg">Misalignment grows</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-2 h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                  <span className="text-lg">Decisions get delayed</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-2 h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                  <span className="text-lg">Transparency is limited</span>
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed max-w-2xl">
                The industry operates more like a chain of handovers than real collaboration.
              </p>
            </div>
          </RevealSection>
        </div>
      </section>

      {/* ── SECTION 4: Belief ── */}
      <section className="py-24 bg-foreground/[0.03]">
        <div className="max-w-4xl mx-auto px-6">
          <RevealSection>
            <div className="space-y-6">
              <h2 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold">What we believe</h2>
              <p className="text-muted-foreground leading-relaxed text-lg">
                We believe the live industry can work differently.
              </p>
              <ul className="space-y-4 text-muted-foreground">
                <li className="flex items-start gap-3">
                  <span className="mt-2 h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                  <span className="text-lg">More <span className="font-medium text-foreground">fair</span>, through clearer structure and expectations</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-2 h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                  <span className="text-lg">More <span className="font-medium text-foreground">diverse</span>, by lowering the barrier to operate</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-2 h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                  <span className="text-lg">More <span className="font-medium text-foreground">transparent</span>, by making information visible and shared</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-2 h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                  <span className="text-lg">More <span className="font-medium text-foreground">connected</span>, by bringing people into the same workflow</span>
                </li>
              </ul>
            </div>
          </RevealSection>
        </div>
      </section>

      {/* ── SECTION 5: Solution ── */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <RevealSection>
            <div className="space-y-6">
              <h2 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold">Why shoWMe exists</h2>
              <div className="space-y-4 text-muted-foreground leading-relaxed max-w-2xl text-lg">
                <p>That is why we built shoWMe.</p>
                <p>
                  A system designed to bring the different sides of the industry into one shared way of working around each event.
                </p>
                <p>
                  Not to replace relationships,
                  <br />
                  but to support them with more clarity, transparency, and trust.
                </p>
              </div>
            </div>
          </RevealSection>
        </div>
      </section>

      {/* ── Our Values ── */}
      <section className="py-24 bg-foreground/[0.03] relative overflow-hidden">
        <FloatingParticles count={15} />
        <div className="max-w-4xl mx-auto px-6 space-y-12 relative z-10">
          <RevealSection>
            <h2 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold">Our Values</h2>
          </RevealSection>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {values.map((v, i) => (
              <RevealSection key={v.title} delay={i * 100}>
                <div className="rounded-xl border bg-card p-8 space-y-4 transition-all duration-300 hover:-translate-y-2 hover:shadow-xl hover:border-primary/30 group h-full">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 transition-colors group-hover:bg-primary/20">
                      <v.icon className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-display text-xl font-semibold text-foreground">{v.title}</h3>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{v.description}</p>
                </div>
              </RevealSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 6: Closing (Dark) ── */}
      <section className="relative bg-foreground text-background py-24 overflow-hidden">
        <AnimatedGradient />
        <div className="max-w-4xl mx-auto px-6">
          <RevealSection>
            <div className="space-y-6 text-center">
              <h2 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold">Built from experience</h2>
              <p className="text-background/70 leading-relaxed max-w-2xl mx-auto text-lg">
                shoWMe is built from lived experience, and from a belief that the industry can work better when it actually works together.
              </p>
              <p className="text-lg">
                Built for <span className="text-primary font-semibold">events</span>. Benefits <span className="text-primary font-semibold">everyone</span>.
              </p>
            </div>
          </RevealSection>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
