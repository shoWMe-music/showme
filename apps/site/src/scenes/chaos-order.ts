// @ts-nocheck
/* Chaos → Order, scroll-driven, told in three beats with dwell/freeze holds.
   The section pins; scroll scrubs 0→1 through:
     SCATTER  → (freeze) → LIST → (freeze) → COLUMNS (Requests · Events · Agreements · Settlements)
   The story writes in word-by-word, matches the site's title style (serif-italic emph),
   and is timed with the cards. Between each transition the state holds so you can read it.
   Damped rAF = smooth glide. Reduced motion → static columns. */

export function initChaosOrder() {
  const stage = document.getElementById('chaos-stage');
  const track = document.getElementById('chaos-scroll');
  if (!stage || !track) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const AMBER = '#F4A046', GREEN = '#6FC97A', RED = '#EE5746', GOLD = '#FFC266';
  const COLS = ['Requests', 'Events', 'Agreements', 'Settlements'];

  const CARDS = [
    { time: '09:12', type: 'Email',    title: 'RE: re: re: holding date', c: AMBER, col: 0 },
    { time: '09:00', type: 'Calendar', title: 'DOUBLE BOOKED ⚠',          c: RED,   col: 1 },
    { time: '10:30', type: 'PDF v7',   title: 'Contract_FINAL_v7.pdf',    c: RED,   col: 2 },
    { time: '15:20', type: 'Sheet',    title: 'Settlement_Q1.xlsx',       c: GOLD,  col: 3 },
    { time: '11:47', type: 'WhatsApp', title: 'is the 12th still free?',  c: GREEN, col: 0 },
    { time: '16:30', type: 'Note',     title: 'Soundcheck 16:00?',        c: GOLD,  col: 1 },
    { time: '10:31', type: 'PDF',      title: 'Rider_Vance.pdf',          c: RED,   col: 2 },
    { time: '02:14', type: 'WhatsApp', title: '“12k + hotel?”',           c: GREEN, col: 3 },
    { time: '15:02', type: 'Slack',    title: '@channel deal update?',    c: GREEN, col: 0 },
    { time: '18:05', type: 'DM',       title: 'capacity for the 12th?',   c: GOLD,  col: 1 },
    { time: '12:14', type: 'Email',    title: 'Terms attached — sign?',   c: AMBER, col: 2 },
    { time: '16:41', type: 'Invoice',  title: 'Invoice #0412 · overdue',  c: AMBER, col: 3 },
  ];

  const scatterN = [
    { x: 0.02, y: 0.02, r: -8 }, { x: 0.30, y: 0.00, r: 5 },  { x: 0.58, y: 0.06, r: -4 }, { x: 0.85, y: 0.02, r: 9 },
    { x: 0.10, y: 0.44, r: 6 },  { x: 0.40, y: 0.36, r: -6 }, { x: 0.66, y: 0.48, r: 4 },  { x: 0.90, y: 0.42, r: -7 },
    { x: 0.00, y: 0.86, r: 7 },  { x: 0.28, y: 0.94, r: -5 }, { x: 0.56, y: 0.82, r: 8 },  { x: 0.80, y: 0.90, r: -4 },
  ];

  const N = CARDS.length;
  // Bigger cards in scatter/columns; compact in the list so all 12 fit one column.
  const SCAT = { w: 320, h: 68 }, LIST_H = 46, COL_H = 66, GAP_LIST = 6, GAP_COL = 12;

  const rowOf = [];
  { const cnt = {}; CARDS.forEach((c, i) => { cnt[c.col] = cnt[c.col] || 0; rowOf[i] = cnt[c.col]++; }); }

  const els = CARDS.map((c) => {
    const el = document.createElement('div');
    el.className = 'chaos__card';
    el.style.setProperty('--c', c.c);
    el.innerHTML =
      `<span class="cc-time">${c.time}</span><span class="cc-type">${c.type}</span><span class="cc-title">${c.title}</span>`;
    stage.appendChild(el);
    return el;
  });

  const heads = COLS.map((label) => {
    const el = document.createElement('div');
    el.className = 'chaos__col';
    el.textContent = label;
    stage.appendChild(el);
    return el;
  });

  // Split a title/sub into word spans (keeping the emph word's gradient styling).
  function splitEl(el) {
    const nodes = [...el.childNodes], spans = [];
    el.innerHTML = '';
    nodes.forEach((node) => {
      const emph = node.nodeType === 1 && node.classList && node.classList.contains('emph');
      (node.textContent.match(/\S+/g) || []).forEach((word) => {
        const s = document.createElement('span');
        s.className = 'w' + (emph ? ' emph' : '');
        s.textContent = word;
        el.appendChild(s);
        el.appendChild(document.createTextNode(' '));
        spans.push(s);
      });
    });
    return spans;
  }
  const beats = [...document.querySelectorAll('.chaos__beat')].map((beat) => {
    const spans = [];
    beat.querySelectorAll('[data-split]').forEach((el) => spans.push(...splitEl(el)));
    return { beat, spans };
  });

  const style = document.createElement('style');
  style.textContent = `
    .chaos__card {
      position: absolute; top: 0; left: 0;
      display: flex; align-items: center; gap: 14px; padding: 0 22px;
      border-radius: 13px; border: 1px solid rgba(255,233,184,.1); border-left: 4px solid var(--c);
      background: rgba(24,16,12,.94); backdrop-filter: blur(9px);
      box-shadow: 0 22px 46px -22px rgba(0,0,0,.65); overflow: hidden;
      font-size: 15px; will-change: transform, width, height;
    }
    .chaos__card .cc-time { font-family: var(--font-mono); font-size: 12px; color: var(--ink-400); flex: none; font-variant-numeric: tabular-nums; }
    .chaos__card .cc-type { font-family: var(--font-mono); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--c); flex: none; }
    .chaos__card .cc-title { color: var(--ink-100); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
    .chaos__col {
      position: absolute; top: 0; left: 0; transform: translateX(-50%);
      font-family: var(--font-mono); font-size: 11.5px; letter-spacing: .16em; text-transform: uppercase;
      color: var(--brand-gold); white-space: nowrap; opacity: 0; will-change: opacity;
      padding-bottom: 11px; border-bottom: 1px solid rgba(255,194,102,.28); box-sizing: border-box;
    }
  `;
  document.head.appendChild(style);

  // On phones the scrubbed scatter→list→columns choreography can't fit (4 columns
  // of cards in ~360px, a scatter squeezed into a few px of travel). Bail out of
  // the scroll loop entirely: the cards and the closing story beat are laid out as
  // a static, readable single-column list by CSS (see index.css, ≤760). The `.w`
  // word-spans (opacity:0 for the write-in) are revealed by that same CSS.
  if (window.matchMedia('(max-width: 760px)').matches) return;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
  const lerpL = (a, b, t) => ({
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), r: lerp(a.r, b.r, t),
  });
  function segProg(t, lo, hi, i) {
    const dur = hi - lo, spread = 0.5, span = dur * (1 - spread);
    return clamp((t - (lo + dur * spread * (i / (N - 1)))) / span, 0, 1);
  }

  let A = [], B = [], C = [];
  function measure() {
    const W = stage.clientWidth, Hf = stage.clientHeight, pad = clamp(W * 0.04, 24, 72);

    const sTop = Hf * 0.40, sBot = Hf * 0.96;
    A = scatterN.map((s) => ({
      x: pad + SCAT.w / 2 + s.x * (W - 2 * pad - SCAT.w),
      y: sTop + SCAT.h / 2 + s.y * ((sBot - sTop) - SCAT.h),
      w: SCAT.w, h: SCAT.h, r: s.r,
    }));

    const leftW = Math.min(440, W * 0.40);
    const rStart = pad + leftW + 48, rEnd = W - pad;
    const listW = Math.min(520, rEnd - rStart), listCX = (rStart + rEnd) / 2;
    const totalB = N * LIST_H + (N - 1) * GAP_LIST, startB = (Hf - totalB) / 2 + LIST_H / 2;
    B = els.map((_, i) => ({ x: listCX, y: startB + i * (LIST_H + GAP_LIST), w: listW, h: LIST_H, r: 0 }));

    const nC = COLS.length, colGap = 18;
    const colW = (W - 2 * pad - (nC - 1) * colGap) / nC, colTop = Hf * 0.32;
    C = els.map((_, i) => {
      const left = pad + CARDS[i].col * (colW + colGap);
      return { x: left + colW / 2, y: colTop + 44 + rowOf[i] * (COL_H + GAP_COL) + COL_H / 2, w: colW, h: COL_H, r: 0 };
    });
    heads.forEach((h, c) => {
      h.style.left = (pad + c * (colW + colGap) + colW / 2) + 'px';
      h.style.top = colTop + 'px';
      h.style.width = colW + 'px';
    });
  }

  // Story windows — timed WITH the card transitions, holds between. Each beat:
  // op = [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd], wr = write-in [start, end].
  const STORY = [
    { op: [-1, -0.5, 0.16, 0.26], wr: [0.00, 0.11] },   // chaos: writes in on scroll, holds, fades as cards rise
    { op: [0.24, 0.32, 0.40, 0.48], wr: [0.25, 0.36] }, // list: appears as the list forms, holds
    { op: [0.46, 0.54, 0.60, 0.68], wr: [0.47, 0.58] }, // columns: appears as columns form, holds, then clears
    { op: [0.62, 0.70, 2, 3], wr: [0.63, 0.70] },       // the solution: rises, then a LONG hold (t .70–1) — stays full while the features scroll up and cover it
  ];
  function beatOp(t, w) {
    const inp = w[1] > w[0] ? clamp((t - w[0]) / (w[1] - w[0]), 0, 1) : 1;
    const out = w[3] > w[2] ? clamp((w[3] - t) / (w[3] - w[2]), 0, 1) : 1;
    return Math.min(inp, out);
  }
  function writeIn(spans, wp) {
    const n = spans.length, SOFT = 3;
    spans.forEach((s, k) => {
      const o = clamp((wp * (n + SOFT) - k) / SOFT, 0, 1);
      s.style.opacity = o;
      s.style.transform = `translateY(${((1 - o) * 10).toFixed(1)}px)`;
    });
  }

  function render(t) {
    beats.forEach(({ beat, spans }, b) => {
      beat.style.opacity = String(beatOp(t, STORY[b].op));
      writeIn(spans, clamp((t - STORY[b].wr[0]) / (STORY[b].wr[1] - STORY[b].wr[0]), 0, 1));
    });
    // Cards + column headers clear as the closing "solution" statement takes over.
    const cardOut = clamp((t - 0.58) / 0.08, 0, 1);
    heads.forEach((h) => { h.style.opacity = String(clamp((t - 0.44) / 0.1, 0, 1) * (1 - cardOut)); });
    els.forEach((el, i) => {
      // Transitions in [0.16,0.30] and [0.40,0.54]; the gaps are the freeze/dwell holds.
      // Everything finishes by t≈0.70 so the solution can hold (and be covered) through t .70–1.
      const L = t < 0.35
        ? lerpL(A[i], B[i], easeInOut(segProg(t, 0.16, 0.30, i)))
        : lerpL(B[i], C[i], easeInOut(segProg(t, 0.40, 0.54, i)));
      el.style.width = L.w + 'px';
      el.style.height = L.h + 'px';
      el.style.opacity = String(1 - cardOut);
      el.style.transform =
        `translate(${(L.x - L.w / 2).toFixed(1)}px, ${(L.y - L.h / 2).toFixed(1)}px) rotate(${L.r.toFixed(2)}deg)`;
    });
  }

  function progress() {
    const r = track.getBoundingClientRect();
    const dist = r.height - window.innerHeight;
    return dist <= 0 ? 0 : clamp(-r.top / dist, 0, 1);
  }

  measure();

  if (reduce) {
    render(0.55); // organized columns + their heading, static
    window.addEventListener('resize', () => { measure(); render(0.68); });
    return;
  }

  let shown = progress();
  render(shown);
  (function loop() {
    const target = progress();
    shown += (target - shown) * 0.12; // snappier follow, still smooth (less text-vs-card lag)
    if (Math.abs(target - shown) < 0.0003) shown = target;
    render(shown);
    requestAnimationFrame(loop);
  })();
  window.addEventListener('resize', () => { measure(); });
}
