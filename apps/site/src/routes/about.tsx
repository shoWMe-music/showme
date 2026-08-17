import { Link, createFileRoute } from "@tanstack/react-router";
import { SiteFooter } from "../components/SiteFooter";
import { renderInlineMarkdown } from "../content/markdown";
import "./about.css";

const content = {
  hero: {
    eyebrow: "About shoWMe",
    titleLead: "Built by the industry,",
    titleEmph: "for the industry.",
    lede: "shoWMe started with a simple frustration: everyone in live events works hard, yet nobody works from the same page. We're building the shared operating system the industry never had.",
  },
  story: {
    kicker: "The origin",
    heading: "How shoWMe came about",
    paragraphs: [
      "Anyone who has ever booked, promoted or played a show knows the routine: a deal lives across a dozen email threads, a WhatsApp chat, a shared spreadsheet, a signed-somewhere PDF and a calendar invite nobody updated. **Every party works from a different version of the truth** — and someone always has to chase.",
      "shoWMe was born from decades spent inside that chaos. Not from a whiteboard idea about how events *should* work, but from real, first-hand experience of how they *actually* do. The conviction was simple: if venues, performers, promoters, agents and their crews could finally share one system — one calendar, one deal, one set of numbers — the whole industry would move faster, argue less, and get paid on time.",
      "That's what we're building. A collaborative, multi-role event based platform where information is entered once and shared with everyone who needs it, so nothing gets lost between inboxes and no one closes a deal on numbers they can't see.",
    ],
  },
  founder: {
    name: "Ran Nir",
    role: "Founder & CEO",
    bio: [
      "shoWMe is built on real problems from inside the industry — not assumptions. **Ran has spent over two decades working across every side of the live music business**, understanding how events are truly booked, managed and executed.",
      "A multi-platinum musician and producer, he co-founded and toured the world with **Asaf Avidan & the Mojos**, and has since worn nearly every hat in the business — artist, manager, booking agent, publisher and label owner. Today he also lectures on the music business and mentors the next generation of industry professionals.",
      "Having lived every side of the deal is exactly why shoWMe reflects how the industry really operates — not how it looks on paper.",
    ],
    facts: [
      "20+ years in live music",
      "Musician & producer",
      "Manager · agent · publisher · label",
      "Music-business lecturer",
    ],
  },
  cta: {
    titleLead: "Built for events.",
    titleEmph: "Benefits everyone.",
    sub: "Join the new ecosystem for the live industry and start saving time and money now.",
    buttonLabel: "Request early access",
  },
};

const DESCRIPTION =
  "How shoWMe came about, the story of founder Ran Nir, and the vision for a shared operating system for the live events industry.";
const TITLE = "shoWMe — About";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: "https://showme.example/about" },
      { property: "og:image", content: "https://showme.example/assets/photo.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: "https://showme.example/assets/photo.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://showme.example/about" }],
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
    ],
  }),
  component: About,
});

function About() {
  const { hero, story, founder, cta } = content;
  return (
    <>
      {/* ===== NAV ===== */}
      <header className="site-header">
        <div className="container site-header__row">
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
          <div className="site-header__actions">
            <Link to="/about" className="btn btn--ghost">
              About
            </Link>
            <a href="/#cta" className="btn btn--primary">
              Sign up
            </a>
          </div>
        </div>
      </header>

      {/* ===== HERO ===== */}
      <header className="about-hero">
        <div className="about-hero__glow" />
        <div className="container">
          <span className="eyebrow about-hero__eyebrow">{hero.eyebrow}</span>
          <h1 className="about-title">
            {hero.titleLead} <span className="emph">{hero.titleEmph}</span>
          </h1>
          <p className="about-lede">{hero.lede}</p>
        </div>
      </header>

      {/* ===== STORY ===== */}
      <section className="section story">
        <div className="container">
          <div className="story__grid">
            <div>
              <span className="story__kicker">{story.kicker}</span>
              <h2 className="story__h">{story.heading}</h2>
            </div>
            <div className="story__body">
              {story.paragraphs.map((paragraph, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable copy
                <p key={index}>{renderInlineMarkdown(paragraph)}</p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== FOUNDER ===== */}
      <section className="founder">
        <div className="container">
          <div className="founder__card">
            <div className="founder__portrait">
              <img
                className="founder__img"
                src="/assets/photo-6fa813.webp"
                alt="Ran Nir, founder and CEO of shoWMe"
                width={770}
                height={769}
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </div>
            <div>
              <span className="story__kicker">The founder</span>
              <h2 className="founder__name">{founder.name}</h2>
              <p className="founder__role">{founder.role}</p>
              <div className="founder__bio">
                {founder.bio.map((paragraph, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable copy
                  <p key={index}>{renderInlineMarkdown(paragraph)}</p>
                ))}
              </div>
              <div className="founder__facts">
                {founder.facts.map((fact, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable copy
                  <span className="founder__fact" key={index}>
                    {fact}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== BELIEFS / VISION ===== */}
      <section className="section beliefs">
        <div className="container">
          <div className="section__head">
            <span className="eyebrow section__eyebrow">The vision</span>
            <h2 className="section__title">
              Not another tool.
              <br />
              The <span className="emph">layer between</span> everyone.
            </h2>
            <p className="section__sub">
              Today's tools keep each side of an event in its own silo. shoWMe is the operational hub
              that connects them — and, over time, the foundation for a data-driven ecosystem across
              the whole live events industry.
            </p>
          </div>
          <div className="beliefs__grid">
            <div className="belief">
              <div className="belief__num">01</div>
              <h3 className="belief__h">One source of truth</h3>
              <p className="belief__b">
                Information is entered once and shared, in real time, with everyone the event
                touches. No re-typing, no mismatched versions.
              </p>
            </div>
            <div className="belief">
              <div className="belief__num">02</div>
              <h3 className="belief__h">Everyone approves</h3>
              <p className="belief__b">
                Every party on the financial side sees the same numbers and signs off before anything
                is booked, settled or paid.
              </p>
            </div>
            <div className="belief">
              <div className="belief__num">03</div>
              <h3 className="belief__h">Built for every role</h3>
              <p className="belief__b">
                Venues, performers, promoters, agents, organizers and their crews each get their own
                view — permission-based, and unified.
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
    </>
  );
}
