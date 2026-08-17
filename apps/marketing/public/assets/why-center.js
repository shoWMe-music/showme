/* ===== WHY: Make the event the center =====
   Ran's "event-center" concept, rebuilt as a self-contained vanilla module.
   A central glowing "Event" orb breathes while the four parties pulse around it,
   each sending a light pulse traveling inward to the Event node.
   Warm dark palette (bg #0A0604), coral #EE5746, gold #FFC266 / #FFE9B8.
   No build step, no external requests, no dependencies. */

(function () {
  const host = document.getElementById('why-center');
  if (!host) return;

  // The four parties that orbit the event. Order fixes their placement.
  const parties = [
    { label: 'Venue', tone: 'gold' },
    { label: 'Promoter', tone: 'coral' },
    { label: 'Performer & Agent', tone: 'coral' },
    { label: 'Team & Crew', tone: 'gold' },
  ];

  // Build the DOM: .stage > .node + 4 .chip + 4 .pulse
  const stage = document.createElement('div');
  stage.className = 'stage';

  const node = document.createElement('div');
  node.className = 'node';
  node.textContent = 'Event';
  stage.appendChild(node);

  const chips = parties.map((party) => {
    const chip = document.createElement('div');
    chip.className = 'chip chip--' + party.tone;
    chip.textContent = party.label;
    stage.appendChild(chip);
    return chip;
  });

  const pulses = parties.map((party) => {
    const pulse = document.createElement('div');
    pulse.className = 'pulse pulse--' + party.tone;
    stage.appendChild(pulse);
    return pulse;
  });

  host.appendChild(stage);

  // Scoped styles (appended once). The host needs only the div + this script.
  const style = document.createElement('style');
  style.textContent = `
    #why-center { display: block; width: 100%; }
    #why-center .stage {
      position: relative;
      width: 100%;
      max-width: 640px;
      margin: 0 auto;
      aspect-ratio: 1 / 1;
      max-height: 560px;
    }
    #why-center .node {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 34%;
      max-width: 190px;
      aspect-ratio: 1 / 1;
      transform: translate(-50%, -50%);
      display: grid;
      place-items: center;
      border-radius: 50%;
      font-family: var(--font-display, ui-serif, Georgia, serif);
      font-weight: 600;
      font-size: clamp(15px, 3.4vw, 24px);
      letter-spacing: -0.01em;
      color: #FFE9B8;
      text-align: center;
      background:
        radial-gradient(circle at 50% 42%, rgba(255,233,184,.42), rgba(238,87,70,.28) 46%, rgba(238,87,70,.06) 70%, transparent 78%);
      box-shadow:
        0 0 46px -6px rgba(238,87,70,.6),
        0 0 90px 6px rgba(255,194,102,.24),
        inset 0 0 30px rgba(255,233,184,.22);
      z-index: 3;
      animation: whyBreathe 4.8s ease-in-out infinite;
    }
    #why-center .node::before {
      content: "";
      position: absolute;
      inset: -14%;
      border-radius: 50%;
      border: 1px solid rgba(255,194,102,.22);
      animation: whyRing 4.8s ease-in-out infinite;
    }
    @keyframes whyBreathe {
      0%, 100% { transform: translate(-50%, -50%) scale(1); }
      50% { transform: translate(-50%, -50%) scale(1.055); }
    }
    @keyframes whyRing {
      0%, 100% { opacity: .35; transform: scale(1); }
      50% { opacity: .7; transform: scale(1.08); }
    }
    #why-center .chip {
      position: absolute;
      transform: translate(-50%, -50%);
      padding: 8px 15px;
      border-radius: 999px;
      white-space: nowrap;
      font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: clamp(10px, 2.1vw, 12.5px);
      letter-spacing: 0.01em;
      color: #FFE9B8;
      background: rgba(24,14,10,.82);
      border: 1px solid rgba(255,233,184,.16);
      box-shadow: 0 14px 30px -14px rgba(0,0,0,.7);
      backdrop-filter: blur(8px);
      z-index: 4;
      animation: whyChip 5.6s ease-in-out infinite;
    }
    #why-center .chip--coral { border-color: rgba(238,87,70,.4); }
    #why-center .chip--gold { border-color: rgba(255,194,102,.4); }
    #why-center .chip::after {
      content: "";
      position: absolute;
      left: 12px;
      top: 50%;
      width: 6px;
      height: 6px;
      margin-top: -3px;
      border-radius: 50%;
    }
    #why-center .chip { padding-left: 26px; }
    #why-center .chip--coral::after { background: #EE5746; box-shadow: 0 0 8px #EE5746; }
    #why-center .chip--gold::after { background: #FFC266; box-shadow: 0 0 8px #FFC266; }
    @keyframes whyChip {
      0%, 100% { box-shadow: 0 14px 30px -14px rgba(0,0,0,.7); }
      50% { box-shadow: 0 14px 34px -12px rgba(0,0,0,.7), 0 0 0 1px rgba(255,194,102,.14); }
    }
    #why-center .pulse {
      position: absolute;
      left: 0;
      top: 0;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 2;
      opacity: 0;
    }
    #why-center .pulse--coral { background: #EE5746; box-shadow: 0 0 10px 2px rgba(238,87,70,.85); }
    #why-center .pulse--gold { background: #FFC266; box-shadow: 0 0 10px 2px rgba(255,194,102,.85); }
    @media (prefers-reduced-motion: reduce) {
      #why-center .node,
      #why-center .node::before,
      #why-center .chip { animation: none; }
    }
  `;
  document.head.appendChild(style);

  // Radial placement of the four chips around the orb. Angles chosen so the
  // parties sit at the corners (upper-left, upper-right, lower-right, lower-left)
  // and never collide with the central node.
  const angles = [-135, -45, 45, 135].map((deg) => (deg * Math.PI) / 180);

  // Centers (in stage pixels) recomputed on layout. Pulses read these each frame.
  const chipCenters = parties.map(() => ({ x: 0, y: 0 }));
  const nodeCenter = { x: 0, y: 0 };

  function layout() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    nodeCenter.x = width / 2;
    nodeCenter.y = height / 2;

    // Place chips on an ellipse. Tighter horizontally on narrow widths so the
    // longest label ("Performer & Agent") never overflows the stage.
    const narrow = width < 440;
    const radiusX = width * (narrow ? 0.34 : 0.4);
    const radiusY = height * (narrow ? 0.4 : 0.38);

    angles.forEach((angle, index) => {
      const x = nodeCenter.x + Math.cos(angle) * radiusX;
      const y = nodeCenter.y + Math.sin(angle) * radiusY;
      chipCenters[index].x = x;
      chipCenters[index].y = y;
      chips[index].style.left = x + 'px';
      chips[index].style.top = y + 'px';
    });
  }

  const resizeObserver = new ResizeObserver(layout);
  resizeObserver.observe(stage);
  window.addEventListener('resize', layout);
  layout();

  // Pulses travel inward from each chip to the Event node, staggered so the
  // four parties feed the center in a gentle round.
  const DURATION = 2600; // ms per inward trip
  const start = performance.now();

  function frame(now) {
    const elapsed = now - start;
    for (let index = 0; index < pulses.length; index++) {
      const stagger = (index / pulses.length) * DURATION;
      const raw = ((elapsed + stagger) % DURATION) / DURATION; // 0 -> 1
      // Ease-in so the pulse accelerates toward the orb.
      const progress = raw * raw;
      const from = chipCenters[index];
      const to = nodeCenter;
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y + (to.y - from.y) * progress;
      // Fade in near the chip, fade out as it merges into the orb.
      const opacity = Math.sin(raw * Math.PI) * 0.9;
      const pulse = pulses[index];
      pulse.style.left = x + 'px';
      pulse.style.top = y + 'px';
      pulse.style.opacity = opacity.toFixed(3);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
