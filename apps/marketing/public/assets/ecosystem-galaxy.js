/* Reactive 3D galaxy ecosystem, shoWMe core + 3 orbiting rings.
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
    #orbit { cursor: grab; touch-action: none; }
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
  // The full ecosystem, every party, role and industry node. Kept calm and
  // well-spread with gentle motion and generous orbits.
  const RINGS = [
    { // inner, the primary parties
      radius: 0.42, tilt: 0.5, speed: 0.016, size: 12, glow: '#EE5746',
      color: 'rgba(238,87,70,0.9)',
      nodes: ['Venues', 'Promoters', 'Performers', 'Agents', 'Festivals', 'Event Organizers'],
    },
    { // middle, the crew / working roles / teams
      radius: 0.73, tilt: 0.48, speed: -0.011, size: 8, glow: '#FFC266',
      color: 'rgba(255,194,102,0.85)',
      nodes: ['Venue Booker', 'Band Members', 'Sound Engineer', 'Lighting Engineer', 'Stage Manager', 'Tour Manager', 'Bartenders', 'Kitchen Staff', 'Door', 'Security', 'Production Crew', 'Manager', 'PR'],
      mobileNodes: ['Band Members', 'Sound Engineer', 'Stage Manager', 'Tour Manager', 'Production Crew', 'Security'],
    },
    { // outer, the wider industry
      radius: 0.99, tilt: 0.44, speed: 0.008, size: 8, glow: '#9CE2A5',
      color: 'rgba(156,226,165,0.8)',
      nodes: ['Audience', 'Labels', 'Publishers', 'PROs'],
      mobileNodes: ['Audience', 'Labels', 'PROs'],
    },
  ];

  let W, H, DPR = Math.min(window.devicePixelRatio || 1, 2);
  let cx, cy, unit, mobile = false;
  let allNodes = [], builtMobile = null;
  function resize() {
    W = host.clientWidth; H = host.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W / 2; cy = H / 2;
    // Fill the column: size to width but cap by height so it never clips top/bottom.
    // Width is the driver so the galaxy reads big; the outer labels still sit inside.
    // On phones pull the orbits in harder so the (many) outer labels stay on-canvas.
    mobile = W < 640;
    if (mobile !== builtMobile) buildNodes();
    // Phones: the disc is leaned more face-on (see `camX` in project) so it stands
    // tall in the portrait column, that lets it read bigger without the outer
    // labels clipping the narrow width. A touch more width + more height headroom.
    unit = Math.min(W * (mobile ? 0.68 : 0.86), H * (mobile ? 0.62 : 1.02));
  }
  resize();
  window.addEventListener('resize', resize);

  // Camera tilt is grab-and-spin: press and drag to rotate the globe, release to
  // let it coast on momentum. tiltY is yaw (around vertical), tiltX is pitch
  // (clamped so the disc never flips). At load everything is 0 and dragging is
  // false, so the first idle frame renders identically to a static globe.
  let tiltX = 0, tiltY = 0;
  let dragging = false, lastX = 0, lastY = 0;
  let spinVelY = 0, spinVelX = 0;
  const clampPitch = (v) => Math.max(-1.1, Math.min(1.1, v));
  host.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    spinVelY = 0; spinVelX = 0;
    try { host.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  });
  host.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    if (!dragging) return;
    const dx = (e.clientX - lastX) / r.width;
    const dy = (e.clientY - lastY) / r.height;
    lastX = e.clientX; lastY = e.clientY;
    tiltY += dx * 3.2;
    tiltX = clampPitch(tiltX + dy * 2.2);
    spinVelY = dx * 3.2;
    spinVelX = dy * 2.2;
    host.dataset.yaw = tiltY.toFixed(3);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try { host.releasePointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  };
  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);
  host.addEventListener('mouseleave', hideTip);

  // Starfield backdrop
  const stars = [];
  for (let i = 0; i < 64; i++) {
    stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.3, a: Math.random() * 0.5 + 0.2, p: Math.random() * 6.28 });
  }

  // Build node objects. On phones the middle/outer rings use their thinned
  // `mobileNodes` subsets so labels do not overlap in the narrow column; the
  // inner ring always keeps its full set. Rebuilt whenever we cross the width
  // breakpoint (see resize()).
  function buildNodes() {
    allNodes = [];
    RINGS.forEach((ring, ri) => {
      const source = mobile ? (ring.mobileNodes || ring.nodes) : ring.nodes;
      source.forEach((label, i) => {
        allNodes.push({
          ring: ri, label,
          angle: (i / source.length) * Math.PI * 2 + ri * 1.25 + 0.6,
        });
      });
    });
    builtMobile = mobile;
    host.dataset.nodeCount = String(allNodes.length);
  }
  buildNodes();

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
    // camera tilt X, on phones add a base lean so the disc faces the viewer more
    // (taller in portrait, labels spread vertically), gated to mobile only.
    const camX = tiltX + (mobile ? 0.42 : 0);
    let y2 = y1 * Math.cos(camX) - z1 * Math.sin(camX);
    let z2 = y1 * Math.sin(camX) + z1 * Math.cos(camX);
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
    // While not actively dragging, coast on release momentum and let it decay.
    // At load every term is 0, so the idle frame is byte-identical to a static globe.
    if (!dragging) {
      tiltY += spinVelY;
      tiltX = clampPitch(tiltX + spinVelX);
      spinVelY *= 0.94;
      spinVelX *= 0.94;
    }

    ctx.clearRect(0, 0, W, H);

    // ambient shine, a warm radial glow radiating from the core/logo at the
    // centre, so the whole galaxy sits in light that emanates from shoWMe.
    // Radius fades to 0 before the nearest canvas edge, so there's no box seam.
    const shineR = Math.min(cx, cy) * 0.92;
    const shine = ctx.createRadialGradient(cx, cy, 0, cx, cy, shineR);
    shine.addColorStop(0, 'rgba(255,150,92,0.15)');
    shine.addColorStop(0.42, 'rgba(238,112,76,0.06)');
    shine.addColorStop(1, 'rgba(238,87,70,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, W, H);

    // stars
    stars.forEach(st => {
      st.p += 0.006;
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
    });

    if (hovered) showTip(hovered.n, hovered.sx, hovered.sy); else hideTip();

    // ── core ──
    const coreR = unit * 0.058;
    const pulse = 1 + Math.sin(t * 0.8) * 0.02;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.7 * pulse);
    cg.addColorStop(0, 'rgba(238,87,70,0.38)');
    cg.addColorStop(0.5, 'rgba(255,194,102,0.1)');
    cg.addColorStop(1, 'rgba(238,87,70,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(cx, cy, coreR * 2.7 * pulse, 0, 6.28); ctx.fill();
    // clear a dark gap so the logo has breathing room from ring 1 (no ring outline)
    ctx.fillStyle = '#18100C';
    ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, 6.28); ctx.fill();
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

    // ── labels ──
    // Drawn last of all, above every node and the core, so nothing paints over
    // them and every label stays visible. Nodes that project onto the core get
    // their label pushed radially clear of it, and a light vertical nudge keeps
    // neighbouring labels from stacking. Nearest labels are placed first.
    const placed = [];
    const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const clear = coreR * 3;
    [...drawn].reverse().forEach(d => {
      if (hovered === d) return; // hovered node uses the tooltip instead
      const ring = d.ring;
      const r = ring.size * d.scale * (d.depth > 0 ? 1 : 0.82);
      const op = Math.min(0.98, Math.max(0.82, d.scale - 0.06));
      ctx.font = (ring === RINGS[0] ? (mobile ? '600 11.5px' : '600 14px') : (mobile ? '600 10px' : '600 12.5px')) + ' "Inter Tight", sans-serif';
      const text = d.n.label;
      const w = ctx.measureText(text).width;
      let lx = d.sx, ly = d.sy - r - 9;
      const cd = Math.hypot(d.sx - cx, d.sy - cy);
      if (cd < clear) { // push off the central mark, along the node's radial
        const ang = cd < 1 ? -Math.PI / 2 : Math.atan2(d.sy - cy, d.sx - cx);
        lx = cx + Math.cos(ang) * clear;
        ly = cy + Math.sin(ang) * clear - 6;
      }
      let fy = ly;
      for (const off of [0, -15, 15, -30, 30, -45, 45]) {
        const box = { x: lx - w / 2 - 2, y: ly + off - 12, w: w + 4, h: 16 };
        if (!placed.some(b => overlaps(box, b))) { fy = ly + off; placed.push(box); break; }
      }
      ctx.fillStyle = `rgba(247,240,231,${op})`;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(8,5,3,0.95)'; ctx.shadowBlur = 6;
      ctx.fillText(text, lx, fy);
      ctx.shadowBlur = 0;
    });

    requestAnimationFrame(frame);
  }
  frame();

  // Pinned scroll animation: as the pinned ecosystem section is scrolled, the
  // galaxy fades + scales in from the centre and the heading eases up, then both
  // hold, ties into the pinned chaos/feature sections above.
  const track = document.getElementById('eco-scroll');
  const ecoHead = document.getElementById('eco-head');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Phones run the SAME scroll-scrubbed reveal as desktop, the section stays
  // pinned (CSS) and the galaxy scales/fades in as it scrolls into view. The canvas
  // resize() already pulls the orbits in on narrow widths so labels stay on-canvas.
  if (track && !reduceMotion) {
    host.style.transformOrigin = 'center center';
    host.style.willChange = 'transform, opacity';
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2);
    const revealGalaxy = () => {
      const r = track.getBoundingClientRect();
      const vh = window.innerHeight;
      const dist = r.height - vh;
      if (dist <= 0) { // unpinned (short screens), just show it
        host.style.opacity = '1'; host.style.transform = 'none';
        if (ecoHead) { ecoHead.style.opacity = '1'; ecoHead.style.transform = 'none'; }
        return;
      }
      // Drive the reveal off the section's APPROACH (as it scrolls up into view),
      // not the pin, so the galaxy is already forming the moment the products
      // fade, no dead black gap between the two sections. `enter` runs 0 (section
      // top at viewport bottom) → 1 (section pinned, top:0), then holds at 1.
      const enter = clamp01((vh - r.top) / vh);
      const g = ease(clamp01((enter - 0.28) / 0.55));
      host.style.opacity = String(g);
      host.style.transform = `translateY(${((1 - g) * 30).toFixed(1)}px) scale(${(0.9 + g * 0.1).toFixed(3)})`;
      if (ecoHead) {
        const h = ease(clamp01((enter - 0.20) / 0.5));
        ecoHead.style.opacity = String(h);
        ecoHead.style.transform = `translateY(${((1 - h) * 26).toFixed(1)}px)`;
      }
    };
    revealGalaxy();
    window.addEventListener('scroll', revealGalaxy, { passive: true });
    window.addEventListener('resize', revealGalaxy, { passive: true });
  }
})();
