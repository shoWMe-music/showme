/* Feature visuals: calendar, contract, settlement, workflow */

(function() {
  /* ============ Calendar visual ============ */
  const cal = document.getElementById('calendar-visual');
  if (cal) {
    cal.innerHTML = `
      <div class="cal-wrap">
        <div class="cal-head">
          <div class="cal-month">April 2026</div>
          <div class="cal-legend">
            <span><i style="background:#EE5746"></i> Booked</span>
            <span><i style="background:#FFC266"></i> Available</span>
            <span><i style="background:#6FC97A"></i> Matched</span>
          </div>
        </div>
        <div class="cal-grid">
          ${['M','T','W','T','F','S','S'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
          ${[...Array(30)].map((_, i) => {
            const day = i + 1;
            const booked = [3, 8, 14, 21, 27].includes(day);
            const avail = [5, 11, 12, 17, 19, 24, 29].includes(day);
            const match = [12, 19].includes(day);
            const cls = match ? 'cal-match' : booked ? 'cal-booked' : avail ? 'cal-avail' : '';
            return `<div class="cal-day ${cls}"><span>${day}</span>${match ? '<i class="cal-dot"></i>' : ''}</div>`;
          }).join('')}
        </div>
        <div class="cal-matches">
          <div class="cal-match-card">
            <div class="cmc-line">
              <span class="cmc-avatar" style="background:linear-gradient(135deg,#EE5746,#FFC266)">MV</span>
              <div>
                <div class="cmc-name">Marlo Vance</div>
                <div class="cmc-meta">Indie · 1.2k cap</div>
              </div>
              <span class="cmc-day">Apr 12</span>
            </div>
          </div>
          <div class="cal-match-card">
            <div class="cmc-line">
              <span class="cmc-avatar" style="background:linear-gradient(135deg,#FFC266,#F4A046)">JD</span>
              <div>
                <div class="cmc-name">Juno Delacroix</div>
                <div class="cmc-meta">Jazz · 800 cap</div>
              </div>
              <span class="cmc-day">Apr 19</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ============ Contract visual ============ */
  const con = document.getElementById('contract-visual');
  if (con) {
    con.innerHTML = `
      <div class="con-wrap">
        <div class="con-doc">
          <div class="con-doc-head">
            <span class="con-tag">BOOKING AGREEMENT</span>
            <span class="con-status">● Signed</span>
          </div>
          <div class="con-line" style="width:80%"></div>
          <div class="con-line" style="width:60%"></div>
          <div class="con-line" style="width:90%"></div>
          <div class="con-line" style="width:40%"></div>
          <div class="con-sigs">
            <div class="con-sig">
              <svg width="60" height="22" viewBox="0 0 60 22" fill="none"><path d="M2 14 Q 8 4, 14 12 T 26 14 Q 34 4, 42 14 T 58 10" stroke="#FFC266" stroke-width="1.5" fill="none" class="con-sig-path"/></svg>
              <span>L. Voss · Venue</span>
            </div>
            <div class="con-sig">
              <svg width="60" height="22" viewBox="0 0 60 22" fill="none"><path d="M2 14 Q 10 2, 18 14 Q 28 20, 34 8 T 58 12" stroke="#FFC266" stroke-width="1.5" fill="none" class="con-sig-path2"/></svg>
              <span>M. Vance · Performer</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ============ Settlement visual ============ */
  const set = document.getElementById('settlement-visual');
  if (set) {
    set.innerHTML = `
      <div class="set-wrap">
        <div class="set-header">
          <span>Settlement · Apr 12</span>
          <span class="set-status">Pending approval</span>
        </div>
        <div class="set-bars">
          <div class="set-bar-row">
            <span>Ticket sales</span>
            <div class="set-bar"><div class="set-bar-fill" style="--w:84%; background:linear-gradient(90deg,#EE5746,#FFC266)"></div></div>
            <b>€21,175</b>
          </div>
          <div class="set-bar-row">
            <span>Bar / F&amp;B</span>
            <div class="set-bar"><div class="set-bar-fill" style="--w:42%; background:linear-gradient(90deg,#F4A046,#FFC266)"></div></div>
            <b>€4,380</b>
          </div>
          <div class="set-bar-row">
            <span>Costs</span>
            <div class="set-bar"><div class="set-bar-fill" style="--w:28%; background:linear-gradient(90deg,#6FC97A,#9CE2A5)"></div></div>
            <b>€2,100</b>
          </div>
        </div>
        <div class="set-approvals">
          <div class="set-approve on">
            <span class="set-check">✓</span>
            <div>
              <div class="set-approve-name">Venue</div>
              <div class="set-approve-tag">Approved 14:22</div>
            </div>
          </div>
          <div class="set-approve on">
            <span class="set-check">✓</span>
            <div>
              <div class="set-approve-name">Artist</div>
              <div class="set-approve-tag">Approved 14:38</div>
            </div>
          </div>
          <div class="set-approve">
            <span class="set-check set-check-wait"></span>
            <div>
              <div class="set-approve-name">Promoter</div>
              <div class="set-approve-tag">Reviewing…</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ============ Workflow visual ============ */
  const wf = document.getElementById('workflow-visual');
  if (wf) {
    const stages = ['Match', 'Offer', 'Contract', 'Advance', 'Showday', 'Settle'];
    wf.innerHTML = `
      <div class="wf-wrap">
        <div class="wf-line"><div class="wf-line-fill"></div></div>
        ${stages.map((st, i) => `
          <div class="wf-node ${i < 3 ? 'done' : i === 3 ? 'active' : ''}">
            <div class="wf-node-dot"></div>
            <div class="wf-node-label">${st}</div>
            <div class="wf-node-meta">${['2 Apr','3 Apr','6 Apr','9 Apr','12 Apr','13 Apr'][i]}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // inject styles
  const s = document.createElement('style');
  s.textContent = `
    /* Calendar */
    .cal-wrap { padding: 18px; background: rgba(10,6,4,.5); border-radius: 16px; border: 1px solid rgba(255,233,184,.08); }
    .cal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .cal-month { font-family: var(--font-display); font-size: 15px; font-weight: 500; }
    .cal-legend { display: flex; gap: 14px; font-size: 10px; color: var(--ink-400); font-family: var(--font-mono); }
    .cal-legend span { display: flex; align-items: center; gap: 5px; }
    .cal-legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; margin-bottom: 16px; }
    .cal-dow { text-align: center; font-size: 10px; color: var(--ink-500); font-family: var(--font-mono); padding: 6px 0; }
    .cal-day {
      aspect-ratio: 1;
      display: grid; place-items: center;
      font-size: 11px;
      color: var(--ink-400);
      background: rgba(255,233,184,.03);
      border-radius: 6px;
      position: relative;
      font-family: var(--font-mono);
    }
    .cal-booked { background: rgba(238,87,70,.3); color: var(--ink-100); box-shadow: inset 0 0 0 1px rgba(238,87,70,.5); }
    .cal-avail { background: rgba(255,194,102,.2); color: var(--ink-100); box-shadow: inset 0 0 0 1px rgba(255,194,102,.4); }
    .cal-match {
      background: linear-gradient(135deg, #6FC97A, #FFC266);
      color: var(--ink-1000);
      font-weight: 600;
      animation: matchPulse 2.2s ease-in-out infinite;
    }
    .cal-dot {
      position: absolute; top: 4px; right: 4px;
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--ink-1000);
    }
    @keyframes matchPulse {
      0%,100% { box-shadow: 0 0 0 0 rgba(111,201,122,.6); }
      50% { box-shadow: 0 0 0 6px rgba(111,201,122,0); }
    }
    .cal-matches { display: flex; flex-direction: column; gap: 6px; }
    .cal-match-card {
      background: rgba(255,233,184,.04);
      border: 1px solid rgba(255,233,184,.06);
      border-radius: 10px;
      padding: 8px 12px;
    }
    .cmc-line { display: flex; align-items: center; gap: 10px; }
    .cmc-avatar {
      width: 28px; height: 28px; border-radius: 50%;
      display: grid; place-items: center;
      font-size: 11px; font-weight: 600; color: var(--ink-1000);
    }
    .cmc-name { font-size: 13px; font-weight: 500; }
    .cmc-meta { font-size: 11px; color: var(--ink-400); }
    .cmc-day { margin-left: auto; font-size: 11px; color: var(--brand-gold); font-family: var(--font-mono); }

    /* Contract */
    .con-wrap { padding: 18px; display: grid; place-items: center; min-height: 220px; }
    .con-doc {
      width: 100%; max-width: 320px;
      background: rgba(250,243,231,.96);
      color: var(--ink-900);
      border-radius: 10px;
      padding: 20px;
      position: relative;
      transform: rotate(-2deg) translateZ(0);
      box-shadow: 0 30px 50px -20px rgba(0,0,0,.6), 0 4px 12px rgba(0,0,0,.3);
      animation: conFloat 5s ease-in-out infinite;
    }
    @keyframes conFloat {
      0%,100% { transform: rotate(-2deg) translateY(0); }
      50% { transform: rotate(-2deg) translateY(-6px); }
    }
    .con-doc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .con-tag { font-family: var(--font-mono); font-size: 9px; letter-spacing: .14em; color: var(--ink-500); }
    .con-status { font-size: 10px; color: #228B3E; font-weight: 600; }
    .con-line { height: 3px; background: rgba(24,16,12,.15); margin: 6px 0; border-radius: 2px; }
    .con-sigs { display: flex; justify-content: space-between; margin-top: 20px; gap: 20px; }
    .con-sig { display: flex; flex-direction: column; align-items: center; }
    .con-sig span { font-family: var(--font-mono); font-size: 9px; color: var(--ink-500); margin-top: 2px; }
    .con-sig-path, .con-sig-path2 {
      stroke-dasharray: 120;
      stroke-dashoffset: 120;
      animation: sign 2s var(--ease-out) .5s forwards;
    }
    .con-sig-path2 { animation-delay: 1.5s; }
    @keyframes sign { to { stroke-dashoffset: 0; } }

    /* Settlement */
    .set-wrap { padding: 18px; background: rgba(10,6,4,.5); border-radius: 16px; border: 1px solid rgba(255,233,184,.08); }
    .set-header { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 11px; color: var(--ink-400); margin-bottom: 16px; }
    .set-status { color: var(--brand-gold); }
    .set-bars { display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; }
    .set-bar-row { display: grid; grid-template-columns: 100px 1fr 72px; gap: 12px; align-items: center; font-size: 12px; }
    .set-bar-row span { color: var(--ink-300); }
    .set-bar-row b { color: var(--ink-100); font-weight: 500; font-variant-numeric: tabular-nums; text-align: right; }
    .set-bar {
      height: 8px; border-radius: 4px;
      background: rgba(255,233,184,.06);
      overflow: hidden;
    }
    .set-bar-fill {
      height: 100%;
      width: 0;
      border-radius: 4px;
      transition: width 1.4s var(--ease-out);
    }
    .set-bar.grow .set-bar-fill { width: var(--w); }
    .set-approvals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .set-approve {
      display: flex; gap: 8px; align-items: center;
      padding: 8px 10px;
      background: rgba(255,233,184,.03);
      border: 1px solid rgba(255,233,184,.06);
      border-radius: 10px;
    }
    .set-approve.on { background: rgba(111,201,122,.1); border-color: rgba(111,201,122,.25); }
    .set-check {
      width: 20px; height: 20px; border-radius: 50%;
      background: rgba(111,201,122,.3);
      display: grid; place-items: center;
      color: #9CE2A5;
      font-size: 11px;
      font-weight: 700;
    }
    .set-check-wait {
      background: rgba(255,233,184,.1);
      position: relative;
    }
    .set-check-wait::after {
      content: "";
      width: 8px; height: 8px;
      border: 2px solid var(--brand-gold);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin360 1s linear infinite;
    }
    @keyframes spin360 { to { transform: rotate(360deg); } }
    .set-approve-name { font-size: 12px; font-weight: 500; }
    .set-approve-tag { font-size: 10px; color: var(--ink-400); }

    /* Workflow */
    .wf-wrap {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 8px;
      padding: 40px 10px 30px;
      position: relative;
    }
    .wf-line {
      position: absolute;
      left: 8%; right: 8%; top: 64px;
      height: 2px;
      background: rgba(255,233,184,.1);
      border-radius: 2px;
    }
    .wf-line-fill {
      height: 100%;
      width: 0;
      background: linear-gradient(90deg, #EE5746, #FFC266);
      border-radius: 2px;
      transition: width 2s var(--ease-out);
    }
    .wf-line.grow .wf-line-fill { width: 58%; }
    .wf-node { display: flex; flex-direction: column; align-items: center; position: relative; }
    .wf-node-dot {
      width: 16px; height: 16px;
      border-radius: 50%;
      background: var(--ink-900);
      border: 2px solid rgba(255,233,184,.2);
      position: relative;
      z-index: 1;
    }
    .wf-node.done .wf-node-dot {
      background: linear-gradient(135deg, #EE5746, #FFC266);
      border-color: transparent;
      box-shadow: 0 0 12px rgba(238,87,70,.5);
    }
    .wf-node.active .wf-node-dot {
      background: var(--brand-cream);
      border-color: var(--brand-gold);
      animation: activeDot 2s ease-in-out infinite;
    }
    @keyframes activeDot {
      0%,100% { box-shadow: 0 0 0 0 rgba(255,194,102,.6); }
      50% { box-shadow: 0 0 0 10px rgba(255,194,102,0); }
    }
    .wf-node-label { font-size: 12px; margin-top: 10px; color: var(--ink-200); font-weight: 500; }
    .wf-node-meta { font-size: 10px; color: var(--ink-400); font-family: var(--font-mono); margin-top: 2px; }
  `;
  document.head.appendChild(s);

  // Animate bars + line when in view
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.querySelectorAll('.set-bar').forEach(b => b.classList.add('grow'));
        e.target.querySelectorAll('.wf-line').forEach(l => l.classList.add('grow'));
      }
    });
  }, { threshold: 0.3 });

  document.querySelectorAll('.feature').forEach(f => io.observe(f));
})();
