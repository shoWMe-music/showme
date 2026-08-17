/* Feature scroll, pinned swap, with a role picker.
   Pick who you are (Operator / Performer / Agent / Team and Crew) and the products
   shown reflect that role's feature set in the app. Each card holds, then swaps,
   with a laptop mockup. Damped rAF follow; fades out into the galaxy below. */

(function () {
  const stage = document.getElementById('feat-stage');
  const track = document.getElementById('feat-scroll');
  const tabsEl = document.getElementById('feat-tabs');
  const fill = document.getElementById('feat-bar-fill');
  const eyebrow = document.querySelector('.feat-eyebrow');
  const head = document.querySelector('.feat-head');
  const bar = document.querySelector('.feat-bar');
  const roleDesc = document.getElementById('feat-roledesc');
  if (!stage || !track) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Phones run the SAME 720vh pinned scroll-swap as desktop; the ≤600px CSS below
  // just restacks the stage (screenshot over text) and shrinks the laptop so the
  // exact scroll-driven feature swap fits the phone. Reduced motion stays static.

  // Each role, with a one-line explanation of what that account kind is, so a
  // visitor knows whether they're an operator, performer, agent or crew.
  const KINDS = [
    { key: 'operator', label: 'Operator', desc: 'Venues, promoters, organizers and festivals, the party that books the talent, runs the event and settles it.' },
    { key: 'performer', label: 'Performer', desc: 'The act being booked, a band, DJ or solo artist. Receive offers, negotiate your deal, perform and get paid.' },
    { key: 'agent', label: 'Agent', desc: 'A booking agent who represents performers, securing live work and negotiating deals on their behalf.' },
    { key: 'team_and_crew', label: 'Team and Crew', desc: 'Freelance crew and services (sound, lighting, stage, security) paid a fee to make the event happen.' },
  ];
  const descFor = (kind) => (KINDS.find((k) => k.key === kind) || KINDS[0]).desc;

  // Each role's real feature set. Screenshots are shared (the app views overlap);
  // the copy reflects what each account kind actually gets.
  const SETS = {
    operator: [
      { name: 'Calendar', t: 'One shared calendar for the whole event.', d: 'A single calendar every side reads from, month, week or day. Times live in the venue’s local wall-clock, so nothing shifts when a date moves.', img: 'light-03-calendar' },
      { name: 'Availability', t: 'Share your available dates with your partners.', d: 'Hold dates while deciding, and ranked holds promote automatically when one drops.', img: 'light-02-availability' },
      { name: 'Budget', t: 'Know the numbers, and who’s holding them.', d: 'Model the event live: tiers, costs, revenue and break-even. Every line records who collects the cash and who fronts it.', img: 'light-04-budget' },
      { name: 'Agreement', t: 'The deal is the agreement.', d: 'The terms you agreed become the contract, filled from the deal. Each party confirms; the moment the last one does, it freezes.', img: 'light-05-agreement' },
      { name: 'Collaborators', t: 'Every side of the event, and only their side.', d: 'Venue, performer, agent and promoter on one event, with visibility that follows the relationship.', img: 'light-07-collaborators' },
      { name: 'Reports', t: 'Every event makes you smarter.', d: 'Revenue, profit and margin per event, plus a projection across your confirmed pipeline. Setlists become the PRO report.', img: 'light-10-projections' },
      { name: 'Settlements', t: 'Everyone settles from the same numbers.', d: 'shoWMe works out who owes whom, earned under the deal, minus cash already collected or fronted. The nets always cancel.', img: 'light-08-settlement' },
      { name: 'Incoming Requests', t: 'Every booking request in one inbox.', d: 'Offers and requests land in one structured inbox. Duplicates collapse; offers nobody answers expire on their own.', img: 'light-01-requests' },
      { name: 'Team', t: 'Your team, your crew, and everything to do.', d: 'Bring your people, each with access to exactly what they need. Reusable groups assign a whole crew in one action.', img: 'light-06-team' },
      { name: 'Audience', t: 'Keep the crowd you earned.', d: 'Every published event collects RSVPs into a list that belongs to your profile, not a ticketing company.', img: 'light-09-audience' },
    ],
    performer: [
      { name: 'Availability', t: 'Share your available dates with your partners.', d: 'Manage dates on hold, and let competing holds rank themselves.', img: 'light-02-availability' },
      { name: 'Offers', t: 'Every offer, in and out, one inbox.', d: 'Offers land in one structured place, the date, the room and the fee at a glance. Reply, counter or pass, or send your own request to a venue.', img: 'light-01-requests' },
      { name: 'Calendar', t: 'Your shows, one calendar.', d: 'Every confirmed and pending date across all your promoters, in one calendar that can’t double-book you.', img: 'light-03-calendar' },
      { name: 'Agreement', t: 'Your deal, confirmed and stored.', d: 'The terms you agreed become the record, fee, split and date, and you confirm your own side. No lost PDFs.', img: 'light-05-agreement' },
      { name: 'Settlement', t: 'Your payout, from the same numbers.', d: 'See exactly what you earned and what you’re owed, settled from the same figures as everyone else on the event.', img: 'light-08-settlement' },
      { name: 'Audience', t: 'Keep the crowd you earned.', d: 'Every show collects RSVPs into a list that’s yours, the fans who keep turning up, wherever you play.', img: 'light-09-audience' },
    ],
    agent: [
      { name: 'Roster', t: 'Your performers, one roster.', d: 'Every act you represent in one place, their dates, their deals and their settlements, all under your eye.', img: 'light-07-collaborators' },
      { name: 'Offers', t: 'Every offer, in and out, for every act.', d: 'Incoming offers for all your performers in one inbox, plus the outgoing offers you send on their behalf, sorted by act, date and fee.', img: 'light-01-requests' },
      { name: 'Availability', t: 'Your acts’ open dates.', d: 'Publish and hold dates on your performers’ behalf, and route the right window to the right promoter.', img: 'light-02-availability' },
      { name: 'Agreement', t: 'Negotiate and sign on their behalf.', d: 'Draft, counter and confirm deals for your acts, the terms become the record the moment both sides agree.', img: 'light-05-agreement' },
      { name: 'Settlements', t: 'Their payouts, your commission.', d: 'Every act settles from the same numbers, and your cut is worked out on the same lines. Nothing to chase.', img: 'light-08-settlement' },
      { name: 'Calendar', t: 'Every act’s dates in one view.', d: 'The whole roster’s calendar in one place, who’s where, when, and what’s still open.', img: 'light-03-calendar' },
    ],
    team_and_crew: [
      { name: 'Availability', t: 'Share when you’re available, tied to the event.', d: 'Mark the dates you can work and shoWMe surfaces you to the operators who need crew, ready to assign you to the event on that date.', img: 'light-02-availability' },
      { name: 'Schedule', t: 'Your run-of-show, one schedule.', d: 'Get-in, soundcheck, doors, set and curfew for every event you’re on, in the venue’s local time.', img: 'light-03-calendar' },
      { name: 'Tasks', t: 'Your call sheet and to-dos.', d: 'Everything you need to do for each event, in one list, assigned, dated and checked off as you go.', img: 'light-06-team' },
      { name: 'Events', t: 'The events you’re on, only your part.', d: 'Join the events an operator brings you onto, and see exactly your slice: your schedule, your tasks, your pay.', img: 'light-07-collaborators' },
      { name: 'Settlement', t: 'Get paid from the same numbers.', d: 'Your fee settles from the same figures as everyone else on the event, transparent, and never in dispute.', img: 'light-08-settlement' },
    ],
  };

  const style = document.createElement('style');
  style.textContent = `
    .features.section { padding: 0; }
    .feat-scroll { position: relative; height: 720vh; }
    .feat-pin { position: sticky; top: 0; height: 100vh; overflow: hidden; display: grid; place-items: center; }
    .feat-head { position: absolute; top: clamp(24px,5vh,50px); left: clamp(24px,4vw,72px); right: clamp(24px,4vw,72px); z-index: 4; }
    .feat-eyebrow { display: block; font-family: var(--font-mono); font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: var(--brand-gold); margin-bottom: 14px; }
    .feat-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
    .feat-tab {
      padding: 8px 17px; border-radius: 999px; border: 1px solid rgba(255,233,184,.16);
      background: transparent; color: var(--ink-300); font-family: var(--font-sans); font-size: 13px; font-weight: 500;
      cursor: pointer; transition: color .2s, background .25s, border-color .2s, transform .15s;
    }
    .feat-tab:hover { color: var(--ink-100); border-color: rgba(255,233,184,.3); transform: translateY(-1px); }
    .feat-tab:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(255,194,102,.4); }
    .feat-tab[aria-selected="true"] { background: linear-gradient(135deg, var(--brand-red), var(--brand-amber)); color: #1A0B04; border-color: transparent; font-weight: 600; }
    .feat-roledesc { margin: 14px 0 0; max-width: 62ch; font-size: 14.5px; line-height: 1.5; color: var(--ink-300); transition: opacity .2s; }
    .feat-stage { position: relative; width: min(1180px, 92vw); height: min(600px, 72vh);
      display: grid; grid-template-columns: .9fr 1.1fr; gap: clamp(28px, 4vw, 72px);
      align-items: center; will-change: opacity, transform; }
    /* Text column — every feature's copy stacked in place; only the active one is
       written in. The laptop beside it never moves. */
    .feat-texts { position: relative; align-self: stretch; }
    .feat-text { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; opacity: 0; }
    .feat-text .w { display: inline-block; opacity: 0; will-change: opacity, transform; }
    .feat-name {
      display: block; margin-bottom: 14px; font-family: var(--font-display); font-weight: 600;
      font-size: clamp(30px, 3.6vw, 56px); line-height: 1; letter-spacing: -.02em;
    }
    .feat-name .w { background: linear-gradient(120deg, var(--brand-red), var(--brand-amber));
      -webkit-background-clip: text; background-clip: text; color: transparent; }
    .feat-title { margin: 0 0 16px; font-family: var(--font-display); font-weight: 500; font-size: clamp(25px, 3vw, 42px); line-height: 1.04; letter-spacing: -.02em; color: var(--ink-100); }
    .feat-detail { margin: 0; font-size: clamp(15px, 1.25vw, 18px); line-height: 1.55; color: var(--ink-300); max-width: 44ch; }
    .feat-shot { display: flex; align-items: center; justify-content: center; }
    .feat-shot .lap { width: 100%; max-width: 620px; }
    .feat-shot .lap__lid { position: relative; padding: 11px 11px 12px; border-radius: 18px;
      background: linear-gradient(160deg, #3b2d20, #1a120b 58%);
      box-shadow: 0 60px 110px -52px rgba(0,0,0,.96), 0 0 0 1px rgba(255,233,184,.07), inset 0 1px 0 rgba(255,233,184,.13); }
    .feat-shot .lap__cam { position: absolute; top: 4.5px; left: 50%; transform: translateX(-50%); width: 5px; height: 5px; border-radius: 50%; background: #55412f; }
    .feat-shot .lap__screen { position: relative; aspect-ratio: 16 / 10; border-radius: 9px; overflow: hidden; background: #0A0604; }
    .feat-shot .lap__screen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top center; opacity: 0; will-change: opacity; }
    .feat-shot .lap__screen::after { content: ""; position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(112deg, rgba(255,255,255,.075) 0 14%, rgba(255,255,255,.02) 26%, transparent 46%); }
    .feat-shot .lap__base { position: relative; height: 13px; margin: 0 -6.5%; border-radius: 0 0 15px 15px;
      background: linear-gradient(#2e2318, #130d08); box-shadow: 0 26px 44px -26px rgba(0,0,0,.95); }
    .feat-shot .lap__base::after { content: ""; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
      width: 16%; height: 6px; border-radius: 0 0 8px 8px; background: #0c0805; }
    .feat-bar { position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: rgba(255,233,184,.08); z-index: 3; }
    .feat-bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--brand-red), var(--brand-amber)); }
    @media (max-width: 860px) {
      .feat-stage { grid-template-columns: 1fr; gap: 20px; height: min(720px, 78vh); align-content: center; }
      .feat-shot { order: -1; }
      .feat-texts { min-height: 240px; align-self: auto; }
      .feat-head { top: 16px; }
    }
    /* Phones run the EXACT desktop 720vh pinned scroll-swap — the pin stays; this
       just fits it to the screen. The stage stacks (screenshot over text, like the
       ≤860 layout), the laptop shrinks, and the role description is dropped to save
       vertical room. The scroll loop below still drives the feature swap. */
    @media (max-width: 600px) {
      .feat-head { top: 12px; left: 20px; right: 20px; }
      .feat-roledesc { display: none; }
      .feat-stage { grid-template-columns: 1fr; gap: 14px; height: min(680px, 76vh);
        align-content: center; width: min(100% - 32px, 560px); }
      .feat-shot { order: -1; }
      .feat-shot .lap { max-width: 360px; margin: 0 auto; }
      .feat-texts { position: relative; min-height: 200px; align-self: auto; }
      .feat-name { font-size: clamp(26px, 8.5vw, 36px); margin-bottom: 10px; }
      .feat-title { font-size: clamp(19px, 5.6vw, 26px); margin-bottom: 12px; }
      .feat-detail { font-size: 14px; max-width: 100%; }
      .feat-tabs { gap: 6px; }
      .feat-tab { padding: 6px 13px; font-size: 12px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .feat-scroll { height: auto; }
      .feat-pin { position: static; height: auto; display: block; padding: 90px 0 30px; }
      /* Keep the head in flow so it doesn't overlap the first stacked feature. */
      .feat-head { position: static; padding: 0 clamp(24px,4vw,72px); margin-bottom: 8px; }
      .feat-stage { height: auto; display: block; }
      .feat-texts { position: static; display: flex; flex-direction: column; gap: 56px; margin-top: 32px; }
      .feat-text { position: static; inset: auto; opacity: 1; }
      .feat-text .w { opacity: 1; transform: none; }
      .feat-shot { display: none; }
      .feat-bar { display: none; }
    }
  `;
  document.head.appendChild(style);

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

  // ---- Build the role tabs ----
  let current = 'operator';
  let switchAlpha = 1, switchY = 0, switchState = null; // smooth role-switch crossfade
  KINDS.forEach((k) => {
    const btn = document.createElement('button');
    btn.className = 'feat-tab';
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.textContent = k.label;
    btn.setAttribute('aria-selected', String(k.key === current));
    btn.addEventListener('click', () => selectKind(k.key));
    tabsEl.appendChild(btn);
  });
  const tabButtons = [...tabsEl.children];

  // Split a name/title/detail into word spans (so they can write in one-by-one),
  // preserving the spaces between words. Same technique as the chaos-order story.
  function splitEl(el) {
    const words = el.textContent.match(/\S+/g) || [];
    el.innerHTML = '';
    const spans = [];
    words.forEach((word) => {
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = word;
      el.appendChild(s);
      el.appendChild(document.createTextNode(' '));
      spans.push(s);
    });
    return spans;
  }

  // One persistent laptop (fixed) with every feature's screenshot stacked inside
  // its screen, plus a text column with every feature's copy stacked in place.
  // Transitions only crossfade the screenshot + write the text — the laptop frame
  // itself never moves.
  let features = []; // [{ textEl, spans, img }]
  function buildStage(kind) {
    if (roleDesc) roleDesc.textContent = descFor(kind);
    stage.innerHTML = '';
    const texts = document.createElement('div');
    texts.className = 'feat-texts';
    const shot = document.createElement('div');
    shot.className = 'feat-shot';
    shot.innerHTML =
      `<div class="lap"><div class="lap__lid"><span class="lap__cam"></span>` +
      `<div class="lap__screen"></div></div><div class="lap__base"></div></div>`;
    const screen = shot.querySelector('.lap__screen');
    features = SETS[kind].map((f, i) => {
      const textEl = document.createElement('div');
      textEl.className = 'feat-text';
      textEl.innerHTML =
        `<span class="feat-name" data-split>${f.name}</span>` +
        `<h3 class="feat-title" data-split>${f.t}</h3>` +
        `<p class="feat-detail" data-split>${f.d}</p>`;
      texts.appendChild(textEl);
      const spans = [];
      textEl.querySelectorAll('[data-split]').forEach((el) => spans.push(...splitEl(el)));

      const img = document.createElement('img');
      img.src = `/assets/shots/${f.img}.webp`;
      img.width = 1760; img.height = 1100;
      img.loading = i < 2 ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.alt = `shoWMe, ${f.t}`;
      screen.appendChild(img);

      return { textEl, spans, img };
    });
    stage.appendChild(texts);
    stage.appendChild(shot);
  }

  const savedP = {}; // remembered scroll position (0..1) per role

  function scrollToP(pp) {
    const rect = track.getBoundingClientRect();
    const trackTop = window.scrollY + rect.top;
    const dist = rect.height - window.innerHeight;
    const y = trackTop + clamp(pp, 0, 1) * dist;
    const lenis = window.__lenis;
    if (lenis && lenis.scrollTo) lenis.scrollTo(y, { immediate: true, force: true });
    else window.scrollTo(0, y);
    shown = clamp(pp, 0, 1);
  }

  function selectKind(kind) {
    if (kind === current || switchState) return;
    savedP[current] = progress();                             // remember where we are in this role
    tabButtons.forEach((b, i) => b.setAttribute('aria-selected', String(KINDS[i].key === kind)));
    current = kind;
    const targetP = savedP[kind] != null ? savedP[kind] : 0;  // resume, or start at the top for a new role
    if (reduce) { buildStage(kind); return; }        // reduced motion → instant swap
    switchState = { phase: 'out', start: performance.now(), kind, targetP };
  }

  // Advance the role-switch crossfade (called each frame). Fades the current set
  // out (lifting slightly), rebuilds + jumps to the new role's remembered spot
  // while invisible, then fades it in — so the scroll jump is never seen.
  function tickSwitch() {
    if (!switchState) return;
    const DUR = 200;
    const e = easeInOut(clamp((performance.now() - switchState.start) / DUR, 0, 1));
    if (switchState.phase === 'out') {
      switchAlpha = 1 - e; switchY = -12 * e;
      if (e >= 1) {
        buildStage(switchState.kind);
        scrollToP(switchState.targetP);
        switchState = { phase: 'in', start: performance.now() };
        switchAlpha = 0; switchY = 14;
      }
    } else {
      switchAlpha = e; switchY = 14 * (1 - e);
      if (e >= 1) { switchAlpha = 1; switchY = 0; switchState = null; }
    }
  }

  buildStage(current);

  // Reveal a text block's words one-by-one as `wp` goes 0→1 — each word rises
  // into place. Matches the chaos-order story's write-in.
  function writeIn(spans, wp) {
    const n = spans.length, SOFT = 6;
    spans.forEach((s, k) => {
      const o = clamp((wp * (n + SOFT) - k) / SOFT, 0, 1);
      s.style.opacity = o.toFixed(3);
      s.style.transform = `translateY(${((1 - o) * 10).toFixed(1)}px)`;
    });
  }

  function render(p) {
    if (fill) fill.style.width = (p * 100).toFixed(1) + '%';
    const N = features.length;
    const seg = p * N;
    const i = Math.min(N - 1, Math.floor(seg));
    const HOLD = 0.5;
    const tr = clamp((seg - i - HOLD) / (1 - HOLD), 0, 1);
    const ef = Math.min(N - 1, i + easeInOut(tr));
    // Fade OUT into the galaxy below (the top is a cover, not a fade). Bar + head fade with it.
    const edge = clamp((1 - p) / 0.07, 0, 1);
    stage.style.opacity = (edge * switchAlpha).toFixed(3);
    stage.style.transform = `translateY(${switchY.toFixed(1)}px)`; // only role-switch/edge move the stage
    if (head) head.style.opacity = edge.toFixed(3);
    if (bar) bar.style.opacity = edge.toFixed(3);
    // Role description fades out/in with the role-switch crossfade (text swaps while hidden).
    if (roleDesc) roleDesc.style.opacity = switchAlpha.toFixed(3);
    features.forEach((ft, j) => {
      const dd = ef - j;
      const ad = Math.abs(dd);
      // Screenshot: a simple crossfade inside the fixed laptop — the frame never moves.
      ft.img.style.opacity = clamp(1 - ad, 0, 1).toFixed(3);
      // Text: words write in as the feature enters (dd −1→0), hold, then the whole
      // block fades out as the feature leaves (dd 0→~0.4).
      writeIn(ft.spans, clamp(dd + 1, 0, 1));
      const blockOp = dd <= 0 ? 1 : clamp(1 - dd / 0.28, 0, 1);
      ft.textEl.style.opacity = blockOp.toFixed(3);
      ft.textEl.style.pointerEvents = ad < 0.4 ? 'auto' : 'none';
    });
  }

  function progress() {
    const r = track.getBoundingClientRect();
    const dist = r.height - window.innerHeight;
    return dist <= 0 ? 0 : clamp(-r.top / dist, 0, 1);
  }

  if (reduce) return; // reduced motion → CSS shows a plain static stacked list

  let shown = progress();
  render(shown);
  (function loop() {
    tickSwitch();
    const target = progress();
    shown += (target - shown) * 0.12;
    if (Math.abs(target - shown) < 0.0003) shown = target;
    render(shown);
    requestAnimationFrame(loop);
  })();
  window.addEventListener('resize', () => render(progress()));
})();
