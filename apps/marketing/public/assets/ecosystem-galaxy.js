/* Reactive 3D galaxy ecosystem — shoWMe core + 3 orbiting rings.
   Pseudo-3D projected onto canvas; tilts/parallax follows the mouse. */

(function () {
  const host = document.getElementById('orbit');
  if (!host) return;

  host.innerHTML = '<canvas id="galaxy-canvas"></canvas><div class="galaxy-tooltip" id="galaxy-tip"></div>';
  const canvas = document.getElementById('galaxy-canvas');
  const tip = document.getElementById('galaxy-tip');
  const ctx = canvas.getContext('2d');

  const s = document.createElement('style');
  s.textContent = `
    #orbit { cursor: grab; }
    #orbit:active { cursor: grabbing; }
    #galaxy-canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }
    .galaxy-tooltip {
      position:absolute; pointer-events:none; transform:translate(-50%,-140%);
      background:rgba(24,16,12,.92); border:1px solid rgba(255,194,102,.3);
      color:var(--ink-100); font-size:12px; padding:6px 12px; border-radius:999px;
      white-space:nowrap; opacity:0; transition:opacity .18s; backdrop-filter:blur(8px);
      font-family:var(--font-sans); z-index:5;
    }
    .galaxy-tooltip.on { opacity:1; }
  `;
  document.head.appendChild(s);

  // ── Ring definitions ──────────────────────────────────────────
  const RINGS = [
    { // inner — the primary parties
      radius: 0.40, tilt: 0.55, speed: 0.10, size: 15, glow: '#EE5746',
      color: 'rgba(238,87,70,0.9)',
      nodes: ['Venues', 'Promoters', 'Performers', 'Agents', 'Festivals', 'Event Organizers'],
    },
    { // middle — the crew / working roles / teams
      radius: 0.70, tilt: 0.50, speed: -0.055, size: 10, glow: '#FFC266',
      color: 'rgba(255,194,102,0.85)',
      nodes: ['Venue Booker', 'Band Members', 'Sound Engineer', 'Lighting Engineer', 'Stage Manager', 'Tour Manager', 'Bartenders', 'Kitchen Staff', 'Door', 'Security', 'Production Crew', 'Manager', 'PR'],
    },
    { // outer — the wider industry
      radius: 0.96, tilt: 0.46, speed: 0.04, size: 9, glow: '#9CE2A5',
      color: 'rgba(156,226,165,0.8)',
      nodes: ['Audience', 'Labels', 'Publishers', 'PROs'],
    },
  ];

  let W, H, DPR = Math.min(window.devicePixelRatio || 1, 2);
  let cx, cy, unit;
  function resize() {
    W = host.clientWidth; H = host.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W / 2; cy = H / 2;
    unit = Math.min(W, H) * 1.02;
  }
  resize();
  window.addEventListener('resize', resize);

  // Camera tilt driven by mouse (with easing)
  let targetTiltX = 0, targetTiltY = 0, tiltX = 0, tiltY = 0;
  host.addEventListener('mousemove', (e) => {
    const r = host.getBoundingClientRect();
    targetTiltY = ((e.clientX - r.left) / r.width - 0.5) * 2.6;
    targetTiltX = ((e.clientY - r.top) / r.height - 0.5) * 1.8;
  });
  host.addEventListener('mouseleave', () => { targetTiltX = 0; targetTiltY = 0; hideTip(); });

  // Starfield backdrop
  const stars = [];
  for (let i = 0; i < 140; i++) {
    stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.3, a: Math.random() * 0.5 + 0.2, p: Math.random() * 6.28 });
  }

  // Build node objects
  const allNodes = [];
  RINGS.forEach((ring, ri) => {
    ring.nodes.forEach((label, i) => {
      allNodes.push({
        ring: ri, label,
        angle: (i / ring.nodes.length) * Math.PI * 2 + ri * 0.4,
      });
    });
  });

  let t = 0;
  let hovered = null;
  let mouse = { x: -999, y: -999 };
  host.addEventListener('mousemove', (e) => {
    const r = host.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  });

  function showTip(node, sx, sy) {
    tip.textContent = node.label;
    tip.style.left = sx + 'px';
    tip.style.top = sy + 'px';
    tip.classList.add('on');
  }
  function hideTip() { tip.classList.remove('on'); }

  // Project a point on a tilted ring to screen space
  function project(ring, angle) {
    const rr = ring.radius * unit * 0.5;
    // base ellipse (ring tilt) then camera tilt
    let x = Math.cos(angle) * rr;
    let z = Math.sin(angle) * rr;
    let y = 0;
    // ring's own tilt around X
    let y1 = y * Math.cos(ring.tilt) - z * Math.sin(ring.tilt);
    let z1 = y * Math.sin(ring.tilt) + z * Math.cos(ring.tilt);
    // camera tilt X
    let y2 = y1 * Math.cos(tiltX) - z1 * Math.sin(tiltX);
    let z2 = y1 * Math.sin(tiltX) + z1 * Math.cos(tiltX);
    // camera tilt Y (around vertical)
    let x2 = x * Math.cos(tiltY) - z2 * Math.sin(tiltY);
    let z3 = x * Math.sin(tiltY) + z2 * Math.cos(tiltY);
    const persp = 1 + z3 / (unit * 1.4);
    return { sx: cx + x2 * persp, sy: cy + y2 * persp, depth: z3, scale: persp };
  }

  function drawRingPath(ring) {
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.08) {
      const p = project(ring, a);
      if (a === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
    }
    ctx.strokeStyle = ring.color.replace(/[\d.]+\)$/, '0.14)');
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function frame() {
    t += 0.016;
    tiltX += (targetTiltX - tiltX) * 0.06;
    tiltY += (targetTiltY - tiltY) * 0.06;

    ctx.clearRect(0, 0, W, H);

    // stars
    stars.forEach(st => {
      st.p += 0.02;
      const tw = (Math.sin(st.p) + 1) / 2;
      ctx.fillStyle = `rgba(255,233,184,${st.a * tw * 0.6})`;
      ctx.beginPath();
      ctx.arc(st.x * W, st.y * H, st.r, 0, 6.28);
      ctx.fill();
    });

    // ring paths (back to front-ish; drawing all is fine)
    RINGS.forEach(drawRingPath);

    // compute node screen positions
    const drawn = [];
    allNodes.forEach(n => {
      const ring = RINGS[n.ring];
      const a = n.angle + t * ring.speed;
      const p = project(ring, a);
      drawn.push({ n, ring, ...p });
    });
    // sort by depth so nearer nodes draw on top
    drawn.sort((a, b) => a.depth - b.depth);

    // hover detection (nearest to mouse within radius)
    hovered = null; let best = 26;
    drawn.forEach(d => {
      const dist = Math.hypot(d.sx - mouse.x, d.sy - mouse.y);
      if (dist < best) { best = dist; hovered = d; }
    });

    // connective lines from core to inner ring
    drawn.forEach(d => {
      if (d.n.ring === 0) {
        const grad = ctx.createLinearGradient(cx, cy, d.sx, d.sy);
        grad.addColorStop(0, 'rgba(238,87,70,0.28)');
        grad.addColorStop(1, 'rgba(238,87,70,0)');
        ctx.strokeStyle = grad; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(d.sx, d.sy); ctx.stroke();
      }
    });

    // nodes
    drawn.forEach(d => {
      const ring = d.ring;
      const r = ring.size * d.scale * (d.depth > 0 ? 1 : 0.82);
      const isHover = hovered === d;
      // glow
      const g = ctx.createRadialGradient(d.sx, d.sy, 0, d.sx, d.sy, r * 3);
      g.addColorStop(0, ring.glow + (isHover ? 'cc' : '55'));
      g.addColorStop(1, ring.glow + '00');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(d.sx, d.sy, r * 3, 0, 6.28); ctx.fill();
      // core dot
      ctx.fillStyle = isHover ? '#fff' : ring.color;
      ctx.beginPath(); ctx.arc(d.sx, d.sy, r, 0, 6.28); ctx.fill();
      ctx.strokeStyle = ring.glow; ctx.lineWidth = 1.5;
      ctx.stroke();
      // label for every node — always visible, nearer nodes drawn on top
      if (!isHover) {
        const op = Math.min(0.96, Math.max(0.45, d.scale - 0.32));
        ctx.fillStyle = `rgba(245,237,227,${op})`;
        ctx.font = (ring === RINGS[0] ? '600 12.5px' : '500 11px') + ' "Inter Tight", sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(10,6,4,0.9)'; ctx.shadowBlur = 4;
        ctx.fillText(d.n.label, d.sx, d.sy - r - 8);
        ctx.shadowBlur = 0;
      }
    });

    if (hovered) showTip(hovered.n, hovered.sx, hovered.sy); else hideTip();

    // ── core ──
    const coreR = unit * 0.058;
    const pulse = 1 + Math.sin(t * 1.5) * 0.06;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3.4 * pulse);
    cg.addColorStop(0, 'rgba(238,87,70,0.55)');
    cg.addColorStop(0.5, 'rgba(255,194,102,0.18)');
    cg.addColorStop(1, 'rgba(238,87,70,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(cx, cy, coreR * 3.4 * pulse, 0, 6.28); ctx.fill();
    // clear a gap ring so the logo has breathing room from ring 1
    ctx.fillStyle = '#18100C';
    ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, 6.28); ctx.fill();
    ctx.strokeStyle = 'rgba(255,194,102,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    // core logo mark (stage arch + spotlight triangle), scaled to core
    const lg = coreR * 0.62;
    const lx = cx, ly = cy - coreR * 0.16;
    ctx.save();
    ctx.translate(lx, ly);
    // red arch
    ctx.fillStyle = '#EE5746';
    ctx.beginPath();
    ctx.arc(0, 0, lg, Math.PI, 0);
    ctx.lineTo(lg, lg * 0.95);
    ctx.lineTo(-lg, lg * 0.95);
    ctx.closePath(); ctx.fill();
    // cream triangle
    ctx.fillStyle = '#FFE1A0';
    ctx.beginPath();
    ctx.moveTo(0, -lg * 0.78);
    ctx.lineTo(lg * 0.72, lg * 0.6);
    ctx.lineTo(-lg * 0.72, lg * 0.6);
    ctx.closePath(); ctx.fill();
    // crowd dots
    ctx.fillStyle = '#EE5746';
    [0, -lg * 0.5, lg * 0.5].forEach((dx, i) => {
      ctx.beginPath(); ctx.arc(dx, lg * 0.6, lg * (i === 0 ? 0.14 : 0.11), 0, 6.28); ctx.fill();
    });
    ctx.restore();
    // core wordmark below logo
    ctx.fillStyle = '#FFE9B8';
    ctx.font = `600 ${Math.round(coreR * 0.34)}px "Clash Display", "Inter Tight", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('shoWMe', cx, cy + coreR * 0.62);
    ctx.textBaseline = 'alphabetic';

    requestAnimationFrame(frame);
  }
  frame();
})();
