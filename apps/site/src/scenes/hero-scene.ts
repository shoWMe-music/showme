// @ts-nocheck
/* ===== HERO 3D scene =====
   A stylized "stage" with floating event cards, spotlight beams, and an audience grid.
   Built with plain canvas — no WebGL deps — pseudo-3D via perspective transforms. */

export function initHeroScene() {
  const canvas = document.getElementById('hero-canvas');
  const stage = document.getElementById('hero-stage');
  if (!canvas || !stage) return;

  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    // Original wrote `canvas.clientWidth = innerWidth` — a silent no-op in the
    // page's classic (sloppy-mode) script; the canvas is sized to fill via CSS
    // (#hero-canvas { width:100%; height:100% }). As an ES module this file is
    // strict mode, where assigning the read-only clientWidth throws, so read the
    // window dimensions directly (identical result, minus the dead assignment).
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // Background particles — "audience" specks + drifting light
  const particles = [];
  for (let i = 0; i < 90; i++) {
    particles.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.1 - 0.05,
      r: Math.random() * 1.6 + 0.4,
      a: Math.random() * 0.5 + 0.2,
      hue: Math.random() > 0.6 ? 'g' : 'r', // gold or red
      p: Math.random() * Math.PI * 2,
    });
  }

  // Spotlight beams from "above"
  const beams = [
    { x: 0.3, hue: 'gold', w: 180, rot: -8 },
    { x: 0.5, hue: 'cream', w: 240, rot: 0 },
    { x: 0.72, hue: 'red', w: 200, rot: 10 },
  ];

  let t = 0;
  let mx = 0.5, my = 0.5;
  window.addEventListener('mousemove', (e) => {
    mx = e.clientX / window.innerWidth;
    my = e.clientY / window.innerHeight;
  });

  function tick() {
    t += 0.016;
    ctx.clearRect(0, 0, W, H);

    // Beams
    beams.forEach((b, i) => {
      const cx = W * b.x + (mx - 0.5) * 30;
      ctx.save();
      ctx.translate(cx, 0);
      ctx.rotate((b.rot + Math.sin(t * 0.3 + i) * 1.2) * Math.PI / 180);
      const grad = ctx.createLinearGradient(0, 0, 0, H * 0.9);
      if (b.hue === 'gold') {
        grad.addColorStop(0, 'rgba(255,194,102,0.22)');
        grad.addColorStop(0.5, 'rgba(255,194,102,0.08)');
      } else if (b.hue === 'cream') {
        grad.addColorStop(0, 'rgba(255,233,184,0.22)');
        grad.addColorStop(0.5, 'rgba(255,233,184,0.06)');
      } else {
        grad.addColorStop(0, 'rgba(238,87,70,0.2)');
        grad.addColorStop(0.5, 'rgba(238,87,70,0.05)');
      }
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-20, 0);
      ctx.lineTo(20, 0);
      ctx.lineTo(b.w, H * 0.9);
      ctx.lineTo(-b.w, H * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });

    // Particles
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.p += 0.02;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      const tw = (Math.sin(p.p) + 1) / 2;
      ctx.fillStyle = p.hue === 'g'
        ? `rgba(255,194,102,${p.a * tw})`
        : `rgba(238,87,70,${p.a * tw})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });

    requestAnimationFrame(tick);
  }
  tick();

  /* ===== HERO product stack — floating 3D cards ===== */
  const STAGE_W = stage.clientWidth;
  const STAGE_H = stage.clientHeight;

  stage.innerHTML = `
    <div class="stage-3d">
      <!-- Back ambient ring -->
      <div class="ring ring-1"></div>
      <div class="ring ring-2"></div>

      <!-- Real product UI: Events view -->
      <div class="appwin" data-depth="0">
        <div class="aw-side">
          <div class="aw-brand">
            <svg viewBox="0 0 100 100" width="20" height="20"><path d="M8 48 A42 42 0 0 1 92 48 L92 92 L8 92 Z" fill="#EE5746"/><path d="M50 14 L82 76 L18 76 Z" fill="#FFE1A0"/><circle cx="50" cy="76" r="6" fill="#EE5746"/><circle cx="34" cy="76" r="5" fill="#EE5746"/><circle cx="66" cy="76" r="5" fill="#EE5746"/></svg>
            <span>shoWMe</span>
          </div>
          ${[['Dashboard','▦'],['Calendar','▤'],['Events','▥'],['Tasks','☑'],['Setlists','♫'],['Settlements','▤'],['Incoming Requests','↧']].map((n,i)=>`<div class="aw-nav${n[0]==='Events'?' on':''}"><span class="aw-ico">${n[1]}</span>${n[0]}${n[0]==='Incoming Requests'?'<span class="aw-badge">4</span>':''}</div>`).join('')}
        </div>
        <div class="aw-main">
          <div class="aw-eyebrow">All events</div>
          <div class="aw-h1">Events</div>
          <div class="aw-tabs">
            <span class="aw-tab on">All</span><span class="aw-tab">Pending</span><span class="aw-tab">On hold</span><span class="aw-tab">Concluded</span><span class="aw-tab">Draft</span>
          </div>
          <div class="aw-table">
            <div class="aw-thead"><span>Event / Artist</span><span>Venue</span></div>
            ${[['Marlo Vance','The Lantern Hall','The Lantern Hall · Berlin','#EE5746'],['Velvet Coast','Warehouse 9','Warehouse 9 · London','#F4A046'],['Neon Harbor','Meridian Club','Meridian Club · Brixton','#FFC266'],['June Delacroix','Ironworks','Ironworks · Bristol','#6FC97A']].map(r=>`<div class="aw-row"><span class="aw-ev"><span class="aw-dot" style="background:${r[3]}"></span><span><b>${r[0]}</b><i>${r[1]}</i></span></span><span class="aw-venue">${r[2]}</span></div>`).join('')}
          </div>
        </div>
      </div>

      <!-- Advancing timeline card (overlapping) -->
      <div class="tlcard" data-depth="50">
        <div class="tl-head"><span class="tl-name">Velvet Coast · Warehouse 9</span><span class="tl-stage">Contract</span></div>
        <div class="tl-track">
          <div class="tl-fill"></div>
          ${['Match','Offer','Contract','Advance','Settle'].map((st,i)=>`<div class="tl-node${i<2?' done':i===2?' active':''}"><span class="tl-dot"></span><span class="tl-lbl">${st}</span></div>`).join('')}
        </div>
      </div>

      <!-- Floating notification pills -->
      <div class="pill pill-1">
        <span class="pill-dot"></span>
        New request · The Tidal Room
      </div>
      <div class="pill pill-3">
        <span class="pill-dot pill-dot-green"></span>
        Settlement approved
      </div>

      <!-- Audience silhouette at base (brand echo) -->
      <svg class="audience" viewBox="0 0 600 80" preserveAspectRatio="none">
        <defs>
          <linearGradient id="audG" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#EE5746" stop-opacity="0.8"/>
            <stop offset="100%" stop-color="#EE5746" stop-opacity="0.3"/>
          </linearGradient>
        </defs>
        ${[...Array(12)].map((_, i) => {
          const cx = 30 + i * 48;
          const r = 12 + (i % 3) * 3;
          return `<circle cx="${cx}" cy="${40}" r="${r}" fill="url(#audG)"/>
                  <rect x="${cx - r}" y="${40}" width="${r*2}" height="40" fill="url(#audG)"/>`;
        }).join('')}
      </svg>
    </div>
  `;

  // Inline styles for stage (scoped)
  const s = document.createElement('style');
  s.textContent = `
    .appwin {
      position: absolute;
      top: 60px; left: 0; width: 540px; height: 420px;
      display: grid; grid-template-columns: 150px 1fr;
      background: #14100C;
      border: 1px solid rgba(255,233,184,.14);
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 50px 100px -25px rgba(0,0,0,.7), 0 12px 30px -12px rgba(238,87,70,.3), inset 0 1px 0 rgba(255,233,184,.08);
      transform: rotateY(-10deg) rotateX(5deg);
      transform-style: preserve-3d;
      animation: floatB 11s ease-in-out infinite;
      z-index: 2;
    }
    .aw-side { background: #0C0805; border-right: 1px solid rgba(255,233,184,.07); padding: 14px 10px; }
    .aw-brand { display:flex; align-items:center; gap:7px; font-family:var(--font-display); font-weight:600; font-size:14px; color:var(--brand-cream); padding: 2px 6px 14px; }
    .aw-nav { display:flex; align-items:center; gap:8px; padding:8px 9px; border-radius:8px; font-size:11.5px; color:var(--ink-300); margin-bottom:2px; }
    .aw-nav .aw-ico { color: var(--ink-500); font-size: 11px; width: 12px; text-align:center; }
    .aw-nav.on { background: linear-gradient(90deg, rgba(238,87,70,.25), rgba(238,87,70,.05)); color: var(--brand-cream); box-shadow: inset 0 0 0 1px rgba(238,87,70,.3); }
    .aw-nav.on .aw-ico { color: var(--brand-red-glow); }
    .aw-badge { margin-left:auto; background:var(--brand-red); color:#150a05; font-size:9px; font-weight:700; border-radius:999px; padding:1px 6px; }
    .aw-main { padding: 18px 18px 0; background:
      linear-gradient(rgba(255,233,184,.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,233,184,.03) 1px, transparent 1px), #14100C;
      background-size: 34px 34px, 34px 34px, auto; }
    .aw-eyebrow { font-family:var(--font-mono); font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--brand-gold); }
    .aw-h1 { font-family:var(--font-display); font-size:26px; font-weight:600; color:var(--ink-100); margin: 4px 0 14px; letter-spacing:-.02em; }
    .aw-tabs { display:flex; flex-wrap:nowrap; gap:6px; margin-bottom:14px; }
    .aw-tab { font-size:10.5px; padding:5px 11px; border-radius:999px; color:var(--ink-400); background:rgba(255,233,184,.05); white-space:nowrap; }
    .aw-tab.on { background:var(--brand-red); color:#150a05; font-weight:600; }
    .aw-table { background:var(--paper); border-radius:12px 12px 0 0; padding: 4px 14px; box-shadow:0 20px 40px -20px rgba(0,0,0,.5); }
    .aw-thead { display:flex; justify-content:space-between; font-family:var(--font-mono); font-size:8.5px; letter-spacing:.12em; text-transform:uppercase; color:#9a8574; padding:12px 0 8px; border-bottom:1px solid rgba(24,16,12,.08); }
    .aw-row { display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid rgba(24,16,12,.06); }
    .aw-ev { display:flex; align-items:center; gap:9px; }
    .aw-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
    .aw-ev b { display:block; font-size:12px; color:#1a120c; font-weight:600; }
    .aw-ev i { font-style:normal; font-size:10px; color:#8a7461; }
    .aw-venue { font-size:10.5px; color:#6a5546; }
    .tlcard {
      position:absolute; bottom:40px; right:0; width:300px;
      background: #1b140e;
      border:1px solid rgba(255,194,102,.38); border-radius:14px; padding:16px 18px;
      box-shadow: 0 30px 60px -20px rgba(0,0,0,.75), 0 0 0 1px rgba(0,0,0,.3), 0 0 30px rgba(238,87,70,.18);
      transform: translateZ(50px); z-index:4;
      animation: floatC 9s ease-in-out infinite;
    }
    .tl-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
    .tl-name { font-size:12px; font-weight:600; color:var(--ink-100); }
    .tl-stage { font-size:10px; color:var(--brand-gold); background:rgba(255,194,102,.14); padding:2px 8px; border-radius:999px; }
    .tl-track { display:flex; justify-content:space-between; position:relative; }
    .tl-track::before { content:""; position:absolute; left:6px; right:6px; top:5px; height:2px; background:rgba(255,233,184,.12); }
    .tl-fill { position:absolute; left:6px; top:5px; height:2px; width:0; background:linear-gradient(90deg,#EE5746,#FFC266); animation: tlGrow 2.4s var(--ease-out) .4s forwards; }
    @keyframes tlGrow { to { width: 52%; } }
    .tl-node { position:relative; display:flex; flex-direction:column; align-items:center; gap:7px; z-index:1; }
    .tl-dot { width:11px; height:11px; border-radius:50%; background:var(--ink-800); border:2px solid rgba(255,233,184,.2); }
    .tl-node.done .tl-dot { background:linear-gradient(135deg,#EE5746,#FFC266); border-color:transparent; }
    .tl-node.active .tl-dot { background:var(--brand-cream); border-color:var(--brand-gold); animation: activeDot 2s ease-in-out infinite; }
    .tl-lbl { font-size:9px; color:var(--ink-300); }
    .tl-node.active .tl-lbl, .tl-node.done .tl-lbl { color:var(--ink-100); }
    .stage-3d {
      position: absolute; inset: 0;
      perspective: 1400px;
      perspective-origin: 50% 40%;
      transform-style: preserve-3d;
    }
    .ring {
      position: absolute; top: 50%; left: 50%;
      border-radius: 50%;
      border: 1px solid rgba(255,194,102,.12);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .ring-1 { width: 120%; height: 120%; animation: spin 40s linear infinite; }
    .ring-2 { width: 90%; height: 90%; border-color: rgba(238,87,70,.14); animation: spin 60s linear infinite reverse; }
    @keyframes spin { to { transform: translate(-50%,-50%) rotate(360deg); } }

    .fcard {
      position: absolute;
      background: linear-gradient(180deg, rgba(34,24,18,.95), rgba(17,10,7,.92));
      border: 1px solid rgba(255,233,184,.14);
      border-radius: 18px;
      backdrop-filter: blur(22px);
      box-shadow:
        0 40px 80px -20px rgba(0,0,0,.6),
        0 10px 30px -10px rgba(238,87,70,.25),
        inset 0 1px 0 rgba(255,233,184,.08);
      overflow: hidden;
      transform-style: preserve-3d;
    }
    .fcard-bar {
      display: flex; align-items: center; gap: 6px;
      padding: 11px 14px;
      border-bottom: 1px solid rgba(255,233,184,.08);
      font-size: 12px; color: var(--ink-300);
      font-family: var(--font-mono);
    }
    .fdot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .fdot-red { background: #EE5746; }
    .fdot-gold { background: #FFC266; }
    .fdot-green { background: #6FC97A; }
    .fcard-ttl { margin-left: 8px; color: var(--ink-200); font-size: 11px; }

    .fcard-body { padding: 18px; }

    /* Back: calendar */
    .fcard-back {
      width: 300px;
      top: 40px; right: 30px;
      animation: floatA 8s ease-in-out infinite;
      transform: rotateY(-12deg) rotateX(8deg) translateZ(-60px);
    }
    .fcard-calendar {
      display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px;
    }
    .cday {
      aspect-ratio: 1;
      background: rgba(255,233,184,.06);
      border-radius: 4px;
    }
    .cday-on {
      background: rgba(238,87,70,.5);
      box-shadow: inset 0 0 0 1px rgba(238,87,70,.7);
    }
    .cday-match {
      background: linear-gradient(135deg, #FFC266, #EE5746);
      box-shadow: 0 0 12px rgba(255,194,102,.6);
      animation: calPulse 2s ease-in-out infinite;
    }
    @keyframes calPulse {
      0%,100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }

    /* Middle: match card */
    .fcard-mid {
      width: 360px;
      top: 130px; left: 20px;
      animation: floatB 10s ease-in-out infinite;
      transform: rotateY(8deg) rotateX(4deg) translateZ(0);
      z-index: 2;
    }
    .match-row {
      display: flex; gap: 12px; align-items: center;
      margin-bottom: 16px;
    }
    .avatar {
      width: 42px; height: 42px;
      border-radius: 50%;
      display: grid; place-items: center;
      font-weight: 600; font-size: 14px;
      color: var(--ink-1000);
    }
    .avatar-red {
      background: linear-gradient(135deg, #EE5746, #FFC266);
    }
    .match-name {
      font-weight: 500; font-size: 15px; color: var(--ink-100);
    }
    .match-tag {
      font-size: 10px;
      background: rgba(255,194,102,.15);
      color: var(--brand-gold);
      padding: 2px 7px;
      border-radius: 999px;
      margin-left: 6px;
      font-weight: 500;
    }
    .match-meta {
      font-size: 12px; color: var(--ink-400);
      margin-top: 2px;
    }
    .match-progress {
      display: flex; gap: 4px;
      margin-bottom: 16px;
    }
    .mstep {
      flex: 1;
      padding: 6px 0;
      text-align: center;
      font-size: 10px;
      background: rgba(255,233,184,.06);
      border-radius: 4px;
      color: var(--ink-400);
      font-family: var(--font-mono);
      letter-spacing: .04em;
    }
    .mstep-done {
      background: rgba(111,201,122,.15);
      color: #9CE2A5;
    }
    .mstep-active {
      background: linear-gradient(90deg, rgba(238,87,70,.3), rgba(255,194,102,.3));
      color: var(--brand-cream);
      animation: activePulse 1.8s ease-in-out infinite;
    }
    @keyframes activePulse {
      0%,100% { box-shadow: 0 0 0 0 rgba(255,194,102,.4); }
      50% { box-shadow: 0 0 0 4px rgba(255,194,102,0); }
    }
    .match-deal {
      padding: 12px;
      background: rgba(10,6,4,.4);
      border-radius: 10px;
      border: 1px solid rgba(255,233,184,.06);
    }
    .deal-row {
      display: flex; justify-content: space-between;
      padding: 4px 0;
      font-size: 13px;
      color: var(--ink-300);
    }
    .deal-val { color: var(--ink-100); font-weight: 500; font-variant-numeric: tabular-nums; }
    .deal-pill {
      background: rgba(255,194,102,.15);
      color: var(--brand-gold);
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
    }

    /* Front: settlement */
    .fcard-front {
      width: 280px;
      bottom: 80px; right: 40px;
      animation: floatC 9s ease-in-out infinite;
      transform: rotateY(-10deg) rotateX(-4deg) translateZ(40px);
      z-index: 3;
    }
    .settle-row {
      display: flex; justify-content: space-between;
      padding: 7px 0;
      font-size: 13px;
      color: var(--ink-300);
      border-bottom: 1px dashed rgba(255,233,184,.08);
    }
    .settle-row b { color: var(--ink-100); font-weight: 500; font-variant-numeric: tabular-nums; }
    .settle-row-sum {
      margin-top: 6px;
      border-bottom: 0;
      border-top: 1px solid rgba(255,194,102,.2);
      padding-top: 12px;
    }
    .settle-row-sum b { color: var(--brand-gold); font-size: 15px; }
    .settle-approve {
      display: flex; gap: 6px;
      margin-top: 14px;
    }
    .approve-chip {
      flex: 1;
      text-align: center;
      padding: 6px 0;
      font-size: 10px;
      border-radius: 6px;
      background: rgba(255,233,184,.04);
      color: var(--ink-400);
      border: 1px solid rgba(255,233,184,.06);
    }
    .approve-on {
      background: rgba(111,201,122,.15);
      color: #9CE2A5;
      border-color: rgba(111,201,122,.3);
    }

    /* Floating pills */
    .pill {
      position: absolute;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 14px;
      background: rgba(34,24,18,.9);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(255,233,184,.12);
      border-radius: 999px;
      font-size: 12px;
      color: var(--ink-100);
      box-shadow: 0 20px 40px -10px rgba(0,0,0,.5);
      transform-style: preserve-3d;
      white-space: nowrap;
    }
    .pill-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #EE5746;
      box-shadow: 0 0 8px #EE5746;
    }
    .pill-dot-gold { background: #FFC266; box-shadow: 0 0 8px #FFC266; }
    .pill-dot-green { background: #6FC97A; box-shadow: 0 0 8px #6FC97A; }
    .pill-1 {
      top: 20px; left: 180px;
      animation: floatP 7s ease-in-out infinite;
      transform: translateZ(60px);
    }
    .pill-2 {
      top: 380px; right: 280px;
      animation: floatP 8s ease-in-out infinite 1s;
      transform: translateZ(80px);
    }
    .pill-3 {
      bottom: 180px; left: 80px;
      animation: floatP 6s ease-in-out infinite 2s;
      transform: translateZ(50px);
    }

    /* Audience */
    .audience {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      width: 100%;
      height: 70px;
      opacity: .25;
      pointer-events: none;
    }

    @keyframes floatA {
      0%,100% { transform: rotateY(-12deg) rotateX(8deg) translateZ(-60px) translateY(0); }
      50% { transform: rotateY(-12deg) rotateX(8deg) translateZ(-60px) translateY(-14px); }
    }
    @keyframes floatB {
      0%,100% { transform: rotateY(8deg) rotateX(4deg) translateZ(0) translateY(0); }
      50% { transform: rotateY(8deg) rotateX(4deg) translateZ(0) translateY(-8px); }
    }
    @keyframes floatC {
      0%,100% { transform: rotateY(-10deg) rotateX(-4deg) translateZ(40px) translateY(0); }
      50% { transform: rotateY(-10deg) rotateX(-4deg) translateZ(40px) translateY(-10px); }
    }
    @keyframes floatP {
      0%,100% { transform: translateY(0) translateZ(60px); }
      50% { transform: translateY(-10px) translateZ(60px); }
    }

    @media (max-width: 1060px) {
      .fcard-back { top: 20px; right: 10px; width: 240px; }
      .fcard-mid { width: 300px; left: 10px; top: 120px; }
      .fcard-front { bottom: 40px; right: 20px; width: 240px; }
      .pill-1 { left: 80px; top: 0; }
      .pill-2 { right: 40px; top: 350px; }
      .pill-3 { bottom: 0; left: 40px; }
    }
  `;
  document.head.appendChild(s);

  // Parallax on mouse for the stage
  stage.addEventListener('mousemove', (e) => {
    const rect = stage.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    stage.querySelectorAll('[data-depth]').forEach(el => {
      const d = parseFloat(el.dataset.depth);
      el.style.setProperty('--px', `${nx * d * 0.2}px`);
      el.style.setProperty('--py', `${ny * d * 0.15}px`);
    });
    const s3d = stage.querySelector('.stage-3d');
    if (s3d) {
      s3d.style.transform = `rotateY(${nx * 3}deg) rotateX(${-ny * 2}deg)`;
    }
  });
}
