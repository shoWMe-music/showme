

## Plan: Move Toggle Below Header + Add Subtitle

### Single file: `src/pages/PricingPage.tsx`

#### 1. Update hero section (lines 630-669)
- Remove the toggle (`RevealSection` at line 643-667) from inside the dark hero `<section>`
- Replace it with a subtitle under "Run Your Events, Not Your Inbox.": `"Get a ready made subscription-package or customize your own based on your event volume and account users"`

#### 2. Add toggle section after the hero
- Insert a new light-background section between the hero `</section>` and the `{view === "artists" ? (` conditional (line 671)
- Contains "What describes you best?" as a larger heading (`text-3xl lg:text-4xl font-display font-bold`)
- Toggle buttons styled bigger (`px-8 py-3 text-base`) with clear visual distinction
- Centered layout with comfortable spacing (`py-12`)

### Result
```
┌──────────────── Dark Hero ─────────────────┐
│  Built for Events. Benefits Everyone.      │
│  Run Your Events, Not Your Inbox.          │
│  Get a ready made subscription-package...  │
└────────────────────────────────────────────┘
┌──────────── Toggle Section ────────────────┐
│  What describes you best?                  │
│  [ Event Operator ]  [ Performer ]         │
└────────────────────────────────────────────┘
┌──────────── Plan Cards ────────────────────┐
```

