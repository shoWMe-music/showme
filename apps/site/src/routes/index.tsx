import { Link, createFileRoute } from "@tanstack/react-router";
import { Scenes } from "../components/Scenes";
import { SiteFooter } from "../components/SiteFooter";
import "./index.css";

const content = {
  hero: {
    titleLine1: "Run your events,",
    titleLine2: "not your inbox.",
    sub: "Book, manage, and settle events—all in one place. shoWMe connects venues, performers, promoters, and crews in a single collaborative platform. Shared financial data, automated permissions, and zero back-and-forth miscommunication.",
    ctaLabel: "Book a demo",
  },
  cta: {
    titleLead: "Built for events.",
    titleEmph: "Benefits everyone.",
    sub: "Join the new ecosystem for the live industry and start saving time and money now.",
    buttonLabel: "Request early access",
  },
};

const DESCRIPTION =
  "Plan, manage, negotiate, and settle every event in one shared system. Built for events. Benefits everyone.";
const TITLE = "shoWMe — Run your events, not your inbox";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: "https://showme.example/" },
      { property: "og:image", content: "https://showme.example/assets/photo.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: "https://showme.example/assets/photo.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://showme.example/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "shoWMe",
          url: "https://showme.example",
          logo: "https://showme.example/favicon.svg",
          description:
            "Booking + settlement for live events — one shared system for operators, performers, agents and crew.",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "shoWMe",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description: DESCRIPTION,
          offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
        }),
      },
    ],
  }),
  component: Home,
});

// Splits a hero title line into per-word `<span className="word">` spans for the
// rise-in animation, keeping the trailing `&nbsp;` between words. When
// `emphasizeLast` is set, the final word gets the `emph` class.
function HeroWords({ line, emphasizeLast = false }: { line: string; emphasizeLast?: boolean }) {
  const words = line.split(" ");
  return (
    <span className="line">
      {words.map((word, index) => {
        const isLast = index === words.length - 1;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable copy
          <span className={isLast && emphasizeLast ? "word emph" : "word"} key={index}>
            {isLast ? word : `${word} `}
          </span>
        );
      })}
    </span>
  );
}

// The pricing feature check-mark — identical markup, extracted to avoid repetition.
function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function Home() {
  const { hero, cta } = content;
  return (
    <>
      {/* ===== HERO ===== */}
      <header className="hero">
        <canvas id="hero-canvas" />
        <div className="hero__glow" />
        <div className="hero__grid" />

        <div className="container hero__header">
          <Link to="/" className="brand">
            <span className="brand__mark" aria-hidden="true">
              <svg viewBox="0 0 100 100" fill="none">
                <defs>
                  <linearGradient id="triG" x1="50%" y1="0%" x2="50%" y2="100%">
                    <stop offset="0%" stopColor="#FFF0C7" />
                    <stop offset="100%" stopColor="#FFC266" />
                  </linearGradient>
                </defs>
                <path d="M8 48 A42 42 0 0 1 92 48 L92 92 L8 92 Z" fill="#EE5746" />
                <path d="M50 14 L82 76 L18 76 Z" fill="url(#triG)" />
                <circle cx="50" cy="76" r="6" fill="#EE5746" />
                <circle cx="34" cy="76" r="5" fill="#EE5746" />
                <circle cx="66" cy="76" r="5" fill="#EE5746" />
                <circle cx="22" cy="76" r="4" fill="#EE5746" />
                <circle cx="78" cy="76" r="4" fill="#EE5746" />
              </svg>
            </span>
            <span>shoWMe</span>
          </Link>
          <div
            className="hero__header-actions"
            style={{ display: "flex", alignItems: "center", gap: "8px" }}
          >
            <Link to="/about" className="btn btn--ghost">
              About
            </Link>
            <a href="#cta" className="btn btn--primary">
              Sign up
            </a>
          </div>
        </div>

        <div className="container hero__inner">
          <div className="hero__copy">
            <h1 className="hero__title display">
              <HeroWords line={hero.titleLine1} />
              <HeroWords line={hero.titleLine2} emphasizeLast />
            </h1>

            <p className="hero__sub">{hero.sub}</p>

            <div className="hero__actions">
              <a href="#cta" className="btn btn--primary btn--lg">
                {hero.ctaLabel}
                <svg
                  className="btn__arrow"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
            </div>
          </div>

          <div className="hero__stage" id="hero-stage">
            {/* Live 3D product mock rendered here by JS */}
          </div>
        </div>
      </header>

      {/* ===== MARQUEE ===== */}
      <div className="marquee">
        <div className="marquee__track">
          <div className="marquee__item"><span className="marquee__dot" />Venues</div>
          <div className="marquee__item"><span className="marquee__dot" />Promoters</div>
          <div className="marquee__item"><span className="marquee__dot" />Performers</div>
          <div className="marquee__item"><span className="marquee__dot" />Booking agents</div>
          <div className="marquee__item"><span className="marquee__dot" />Tour managers</div>
          <div className="marquee__item"><span className="marquee__dot" />Festivals</div>
          <div className="marquee__item"><span className="marquee__dot" />Clubs</div>
          <div className="marquee__item"><span className="marquee__dot" />Producers</div>
          <div className="marquee__item"><span className="marquee__dot" />Venues</div>
          <div className="marquee__item"><span className="marquee__dot" />Promoters</div>
          <div className="marquee__item"><span className="marquee__dot" />Performers</div>
          <div className="marquee__item"><span className="marquee__dot" />Booking agents</div>
          <div className="marquee__item"><span className="marquee__dot" />Tour managers</div>
          <div className="marquee__item"><span className="marquee__dot" />Festivals</div>
          <div className="marquee__item"><span className="marquee__dot" />Clubs</div>
          <div className="marquee__item"><span className="marquee__dot" />Producers</div>
        </div>
      </div>

      {/* ===== CHAOS → ORDER (scroll-pinned, three-beat story) ===== */}
      <section className="section chaos" id="product">
        <div className="chaos-scroll" id="chaos-scroll">
          <div className="chaos-pin">
            <div className="chaos__field" id="chaos-stage">
              {/* cards + column headers rendered by JS */}
            </div>

            <div className="chaos__beat" data-beat="0">
              <span className="eyebrow section__eyebrow">The problem</span>
              <h2 className="chaos__title" data-split="">
                Buried in the <em className="emph">back-and-forth?</em>
              </h2>
              <p className="chaos__sub" data-split="">
                Emails, WhatsApp threads, spreadsheets, PDFs, calendar invites, follow-ups — every
                party working from a different version of the truth.
              </p>
            </div>
            <div className="chaos__beat" data-beat="1">
              <span className="eyebrow section__eyebrow">One place</span>
              <h2 className="chaos__title" data-split="">
                All of it, in <em className="emph">one place.</em>
              </h2>
              <p className="chaos__sub" data-split="">
                shoWMe gathers every message, file and number into a single shared record you can
                actually trust.
              </p>
            </div>
            <div className="chaos__beat" data-beat="2">
              <span className="eyebrow section__eyebrow">Start to finish</span>
              <h2 className="chaos__title" data-split="">
                Structured, <em className="emph">start to finish.</em>
              </h2>
              <p className="chaos__sub" data-split="">
                Every party — venue, artist, agent and crew — collaborating in order, from first
                enquiry to final settlement.
              </p>
            </div>
            <div className="chaos__beat" data-beat="3">
              <span className="eyebrow section__eyebrow">The solution</span>
              <h2 className="chaos__title" data-split="">
                Smart, seamless,
                <br />
                and <em className="emph">synchronized.</em>
              </h2>
              <p className="chaos__sub" data-split="">
                One operating system for live events. From first match to final settlement — every
                party, every deal, every payment in one shared place.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FEATURE SCROLL (pinned swap — cards built by feature-scroll.js) ===== */}
      <section className="section features" id="features">
        <div className="feat-scroll" id="feat-scroll">
          <div className="feat-pin">
            <div className="feat-head">
              <span className="feat-eyebrow">Everything you get</span>
              <div className="feat-tabs" id="feat-tabs" role="tablist" aria-label="Choose your role">
                {/* tabs injected by JS */}
              </div>
              <p className="feat-roledesc" id="feat-roledesc">
                {/* role description injected by JS */}
              </p>
            </div>
            <div className="feat-stage" id="feat-stage">
              {/* cards injected by JS */}
            </div>
            <div className="feat-bar">
              <i id="feat-bar-fill" />
            </div>
          </div>
        </div>
      </section>

      {/* ===== ECOSYSTEM ===== */}
      <section className="section ecosystem" id="ecosystem">
        <div className="eco-scroll" id="eco-scroll">
          <div className="eco-pin">
            <div className="container ecosystem__grid">
              <div className="section__head" id="eco-head">
                <span className="eyebrow section__eyebrow">Beyond the booking tool</span>
                <h2 className="section__title">
                  From booking tool
                  <br />
                  to <span className="emph">ecosystem.</span>
                </h2>
                <p className="section__sub">
                  The B2B platform is the foundation. It generates the operational and financial data
                  that unlocks the ultimate prize: a data-driven ecosystem across the live events
                  industry.
                </p>
              </div>

              <div className="ecosystem__orbit" id="orbit" />
            </div>
          </div>
        </div>
      </section>

      {/* ===== PRICING ===== */}
      <section className="section" id="pricing">
        <div className="container">
          <div className="section__head reveal">
            <span className="eyebrow section__eyebrow">Pricing</span>
            <h2 className="section__title">
              Start free.
              <br />
              Scale when you <span className="emph">grow.</span>
            </h2>
            <p className="section__sub">
              Every role gets a free plan to run real events for one profile. Upgrade when your
              volume, team, or roster grows and add extra seats for €15/month wherever you need them.
            </p>
          </div>

          <div className="price-group reveal">
            <div className="price-group__label">
              For event operators <span>venues · promoters · festivals · organizers</span>
            </div>
            <div className="pricing__grid pricing__grid--2">
              <div className="plan">
                <h3 className="plan__name">Basic</h3>
                <p className="plan__tag">
                  Best for operators with 60 or fewer events a year, low admin needs and a small 1–2
                  person team.
                </p>
                <div className="plan__price">
                  <span className="plan__price-num">Free</span>
                  <span className="plan__price-unit">freemium</span>
                </div>
                <ul>
                  <li>
                    <Check />
                    Unlimited events
                  </li>
                  <li>
                    <Check />
                    Multi-room calendar
                  </li>
                  <li>
                    <Check />
                    Events page &amp; incoming requests
                  </li>
                  <li>
                    <Check />
                    Settlements
                  </li>
                  <li>
                    <Check />
                    One profile per account
                  </li>
                  <li>
                    <Check />
                    Collaborators CRM
                  </li>
                  <li>
                    <Check />
                    Payments — receive &amp; send (transaction fees apply)
                  </li>
                  <li>
                    <Check />2 templates
                  </li>
                  <li>
                    <Check />
                    Dashboard + basic analytics
                  </li>
                  <li className="plan__seat">1 user · upgrade to Pro to add seats</li>
                </ul>
                <a
                  href="#cta"
                  className="btn btn--outline"
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Get started free
                </a>
              </div>

              <div className="plan plan--featured">
                <h3 className="plan__name">Pro</h3>
                <p className="plan__tag">
                  For operators with high event volume (60+ a year), intensive admin and/or teams of 3
                  or more.
                </p>
                <div className="plan__price">
                  <span className="plan__price-num">€99</span>
                  <span className="plan__price-unit">/ month</span>
                </div>
                <p className="plan__everything">Everything in Basic, plus:</p>
                <ul>
                  <li>
                    <Check />
                    Budget planner
                  </li>
                  <li>
                    <Check />
                    Internal team management
                  </li>
                  <li>
                    <Check />
                    Collaborators &amp; audience CRM
                  </li>
                  <li>
                    <Check />
                    API access &amp; integrations
                  </li>
                  <li>
                    <Check />
                    Advanced analytics &amp; reporting
                  </li>
                  <li>
                    <Check />
                    Full profile roles &amp; permissions
                  </li>
                  <li>
                    <Check />
                    Priority onboarding &amp; support
                  </li>
                  <li className="plan__seat">2 seats included · extra seats €15/mo</li>
                </ul>
                <a
                  href="#cta"
                  className="btn btn--primary"
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Start free trial
                </a>
              </div>
            </div>
          </div>

          <div className="price-group reveal">
            <div className="price-group__label">
              For performers &amp; agents <span>performers · bands · booking agents</span>
            </div>
            <div className="pricing__grid pricing__grid--2">
              <div className="plan">
                <h3 className="plan__name">Performer</h3>
                <p className="plan__tag">
                  Everything a performing act needs to book, confirm and settle shows — free.
                </p>
                <div className="plan__price">
                  <span className="plan__price-num">Free</span>
                  <span className="plan__price-unit">freemium</span>
                </div>
                <ul>
                  <li>
                    <Check />
                    Calendar &amp; events page
                  </li>
                  <li>
                    <Check />
                    Unlimited events
                  </li>
                  <li>
                    <Check />
                    Send up to 50 booking requests / month
                  </li>
                  <li>
                    <Check />
                    Receive unlimited booking requests
                  </li>
                  <li>
                    <Check />
                    Settlements &amp; payments (receive &amp; send)
                  </li>
                  <li>
                    <Check />2 templates
                  </li>
                  <li>
                    <Check />
                    Dashboard + basic analytics
                  </li>
                  <li className="plan__seat">Extra seats €15/mo</li>
                </ul>
                <a
                  href="#cta"
                  className="btn btn--outline"
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Get started free
                </a>
              </div>

              <div className="plan">
                <div className="plan__badge">Agents</div>
                <h3 className="plan__name">Agent</h3>
                <p className="plan__tag">Everything in Performer, built for managing a roster of acts.</p>
                <div className="plan__price">
                  <span className="plan__price-num">Free</span>
                  <span className="plan__price-unit">freemium</span>
                </div>
                <p className="plan__everything">Everything in Performer, plus:</p>
                <ul>
                  <li>
                    <Check />
                    Roster management{" "}
                    <span className="plan__note">(rostered performers need a shoWMe account)</span>
                  </li>
                  <li>
                    <Check />
                    Send unlimited booking requests
                  </li>
                  <li className="plan__seat">Extra seats €15/mo</li>
                </ul>
                <a
                  href="#cta"
                  className="btn btn--outline"
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Get started free
                </a>
              </div>
            </div>
            <p className="price-group__soon">Pro tier for agents &amp; performers — coming soon</p>
          </div>
        </div>
      </section>

      {/* ===== WHY ===== */}
      <section className="section" id="why" style={{ paddingTop: "20px" }}>
        <div className="container">
          <div className="section__head reveal">
            <span className="eyebrow section__eyebrow">Why shoWMe</span>
            <h2 className="section__title">
              Not another tool.
              <br />
              The <span className="emph">layer between</span> them.
            </h2>
          </div>

          <div className="why__grid reveal">
            <div className="why__card">
              <div className="why__num">01</div>
              <h3 className="why__title">Today's tools keep everyone apart</h3>
              <p className="why__body">
                There are systems in the industry to help manage events — but they're built in a way
                that limits collaboration. They keep each side working in its own silo, which
                perpetuates the very problems the industry runs on: miscommunication, no shared
                transparency, and a constant lack of trust between parties.
              </p>
            </div>
            <div className="why__card">
              <div className="why__num">02</div>
              <h3 className="why__title">No complete solution for every role</h3>
              <p className="why__body">
                A venue's tool doesn't speak to an agent's. A promoter's spreadsheet doesn't match the
                performer's. None of them give a complete solution for <em>all</em> the roles involved
                in a live event — so the truth fragments the moment a deal touches more than one
                party.
              </p>
            </div>
            <div className="why__card why__card--wide">
              <div className="why__num">03</div>
              <h3 className="why__title">shoWMe is the operational hub</h3>
              <p className="why__body">
                shoWMe is built to enhance your workflow, reduce your administration, and improve your
                collaborations. It's not here to become a ticketing company — it's an{" "}
                <strong>
                  operational layer
                </strong>
                , a hub between all sides of the live event, where venues, promoters, performers,
                agents and their crews finally work from one shared source of truth.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="cta" id="cta">
        <div className="cta__stage" />
        <div className="container">
          <h2 className="cta__title display">
            {cta.titleLead}
            <br />
            <span className="emph">{cta.titleEmph}</span>
          </h2>
          <p className="cta__sub">{cta.sub}</p>
          <div className="cta__actions">
            <a href="mailto:ran@showme.music" className="btn btn--primary btn--lg">
              {cta.buttonLabel}
              <svg
                className="btn__arrow"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <SiteFooter />

      <Scenes />
    </>
  );
}
