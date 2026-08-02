/* Chaos → Order.
   "Without shoWMe": scattered inbox chaos (sticky notes).
   "With shoWMe": the real event-manager UI — lifecycle stepper that advances + product tabs. */

(function () {
  const stage = document.getElementById('chaos-stage');
  if (!stage) return;

  const notes = [
    { type: 'Email', title: 'RE: re: re: holding date', meta: 'nova.mgmt@…', color: '#F4A046' },
    { type: 'WhatsApp', title: 'is the 12th still free?', meta: 'Nadia · promoter', color: '#6FC97A' },
    { type: 'PDF v7', title: 'Contract_FINAL_v7.pdf', meta: 'Signed? unclear', color: '#EE5746' },
    { type: 'Sheet', title: 'Settlement_Q1.xlsx', meta: 'Last edited 3h ago', color: '#FFC266' },
    { type: 'SMS', title: 'did you see my email?', meta: '+49 176 …', color: '#9CE2A5' },
    { type: 'Calendar', title: 'DOUBLE BOOKED ⚠', meta: 'Apr 12 · 2 holds', color: '#EE5746' },
    { type: 'Email', title: 'Invoice #0412', meta: '30 days overdue', color: '#F4A046' },
    { type: 'DM', title: 'who is the contact for…', meta: 'IG inbound', color: '#FFC266' },
    { type: 'Slack', title: '@channel deal update?', meta: '12 replies', color: '#9CE2A5' },
    { type: 'PDF', title: 'Rider_Vance.pdf', meta: 'Not attached', color: '#EE5746' },
  ];

  const chaosPos = [
    { x: '9%', y: '20%', rot: -6 }, { x: '30%', y: '28%', rot: 4 }, { x: '53%', y: '16%', rot: -3 },
    { x: '73%', y: '26%', rot: 8 }, { x: '88%', y: '52%', rot: -5 }, { x: '13%', y: '58%', rot: 10 },
    { x: '35%', y: '66%', rot: -4 }, { x: '58%', y: '58%', rot: 6 }, { x: '77%', y: '72%', rot: -7 },
    { x: '23%', y: '82%', rot: 3 },
  ];

  notes.forEach((n, i) => {
    const el = document.createElement('div');
    el.className = 'chaos__note';
    el.style.setProperty('--c', n.color);
    el.dataset.idx = i;
    el.innerHTML = `<div class="chaos__note-type" style="color:${n.color}">${n.type}</div>
      <div class="chaos__note-title">${n.title}</div><div class="chaos__note-meta">${n.meta}</div>`;
    stage.appendChild(el);
  });

  // ── The real event-manager panel ──────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'evm';
  panel.innerHTML = `
    <div class="evm__bar">
      <span class="evm__dot"></span><span class="evm__dot"></span><span class="evm__dot"></span>
      <span class="evm__crumb">shoWMe · Events · EVT-G051</span>
      <span class="evm__bell">🔔<i>2</i></span>
    </div>
    <div class="evm__body">
      <div class="evm__head">
        <div>
          <div class="evm__title">Marlo Vance <span class="evm__pill" id="evmPill">Confirmed</span></div>
          <div class="evm__sub">Marlo Vance · The Lantern Hall, Berlin · Fri 12 Apr 2026</div>
        </div>
        <div class="evm__avatars"><span>M</span><span>V</span><span>L</span></div>
      </div>

      <div class="evm__stepper" id="evmStepper">
        <div class="evm__track"><div class="evm__fill" id="evmFill"></div></div>
        <div class="evm__step" data-i="0"><i></i><span>Suggested</span></div>
        <div class="evm__step" data-i="1"><i></i><span>Pending</span></div>
        <div class="evm__step" data-i="2"><i></i><span>Confirmed</span></div>
        <div class="evm__step" data-i="3"><i></i><span>Concluded</span></div>
      </div>

      <div class="evm__tabs" id="evmTabs">
        <button data-t="todo">To&nbsp;Do</button>
        <button data-t="budget">Budget Planner</button>
        <button data-t="details">Event Details</button>
        <button data-t="agreement">Agreement</button>
        <button data-t="settlement" class="on">Settlement</button>
        <button data-t="messages">Messages</button>
      </div>

      <div class="evm__pane" id="evmPane"></div>
    </div>
  `;
  stage.appendChild(panel);

  const PANES = {
    settlement: `
      <div class="evm__cols">
        <div class="evm__box">
          <div class="evm__box-h">Overview</div>
          <div class="evm__line"><span>Total revenue</span><b>€21,175</b></div>
          <div class="evm__line"><span>Total deductions</span><b>€6,480</b></div>
          <div class="evm__line evm__line--sum"><span>Net revenue</span><b>€14,695</b></div>
          <div class="evm__box-h" style="margin-top:14px">Payouts</div>
          <div class="evm__line"><span>Performer (guarantee)</span><b>€4,500</b></div>
          <div class="evm__line"><span>Venue share</span><b>€3,275</b></div>
          <div class="evm__line evm__line--sum"><span>Your retained share</span><b class="evm__pos">€6,920</b></div>
        </div>
        <div class="evm__box">
          <div class="evm__box-h">Approval status <span class="evm__cnt">2/3</span></div>
          <div class="evm__appr on"><i>✓</i><div><b>Operator</b><span>Approved · 14:02</span></div></div>
          <div class="evm__appr on"><i>✓</i><div><b>Performer</b><span>Approved · 14:38</span></div></div>
          <div class="evm__appr"><i class="evm__wait"></i><div><b>Venue</b><span>Reviewing…</span></div></div>
          <div class="evm__wf">
            <button class="evm__btn evm__btn--p">Send for review</button>
            <button class="evm__btn">Export PDF</button>
          </div>
        </div>
      </div>`,
    budget: `
      <div class="evm__kpis">
        <div class="evm__kpi"><span>Total revenue</span><b>€21,175</b></div>
        <div class="evm__kpi"><span>Total costs</span><b>€9,860</b></div>
        <div class="evm__kpi"><span>Profit / loss</span><b class="evm__pos">+€11,315</b></div>
        <div class="evm__kpi"><span>Break-even</span><b>412 tix</b></div>
      </div>
      <div class="evm__box" style="margin-top:12px">
        <div class="evm__box-h">Break-even analysis</div>
        <svg class="evm__chart" viewBox="0 0 320 90" preserveAspectRatio="none">
          <line x1="0" y1="70" x2="320" y2="70" stroke="rgba(255,233,184,.12)"/>
          <polyline points="0,80 320,10" fill="none" stroke="#FFC266" stroke-width="2"/>
          <polyline points="0,40 320,40" fill="none" stroke="#EE5746" stroke-width="2" stroke-dasharray="4 4"/>
          <circle cx="180" cy="40" r="4" fill="#6FC97A"/>
        </svg>
      </div>`,
    todo: `
      <div class="evm__box">
        <div class="evm__box-h">To do <span class="evm__cnt">3 active</span></div>
        <div class="evm__todo done"><i>✓</i>Send offer to Marlo Vance management</div>
        <div class="evm__todo done"><i>✓</i>Confirm venue hold — Columbia Theater</div>
        <div class="evm__todo"><i></i>Finalize settlement for "Marlo Vance"</div>
        <div class="evm__todo"><i></i>Upload signed rider</div>
      </div>`,
    details: `
      <div class="evm__cols">
        <div class="evm__box">
          <div class="evm__box-h">Event information</div>
          <div class="evm__line"><span>Venue</span><b>The Lantern Hall</b></div>
          <div class="evm__line"><span>Capacity</span><b>1,200</b></div>
          <div class="evm__line"><span>Ticketing</span><b>Eventbrite</b></div>
          <div class="evm__line"><span>Operator</span><b>shoWMe (promoter)</b></div>
        </div>
        <div class="evm__box">
          <div class="evm__box-h">Financial deal</div>
          <div class="evm__line"><span>Deal type</span><b>Guarantee vs Door</b></div>
          <div class="evm__line"><span>Guarantee</span><b>€4,500</b></div>
          <div class="evm__line"><span>Split A / P / V</span><b>70 / 15 / 15</b></div>
          <div class="evm__line"><span>Venue rental</span><b>Deducted at settlement</b></div>
        </div>
      </div>`,
    agreement: `
      <div class="evm__box">
        <div class="evm__box-h">Agreement confirmation</div>
        <div class="evm__appr on"><i>✓</i><div><b>Performer</b><span>Confirmed on behalf of</span></div></div>
        <div class="evm__appr on"><i>✓</i><div><b>Promoter</b><span>Confirmed</span></div></div>
        <div class="evm__appr"><i class="evm__wait"></i><div><b>Venue</b><span>Not yet confirmed</span></div></div>
        <div class="evm__note-sm">Last modified 2h ago · Terms &amp; conditions saved</div>
      </div>`,
    messages: `
      <div class="evm__box">
        <div class="evm__box-h">Messages</div>
        <div class="evm__msg"><span class="evm__ava">L</span><div><b>Nadia · Promoter</b><p>Doors at 20:00 confirmed with production.</p></div></div>
        <div class="evm__msg"><span class="evm__ava" style="background:linear-gradient(135deg,#EE5746,#FFC266)">M</span><div><b>Mgmt</b><p>Rider uploaded — please review the hospitality section.</p></div></div>
      </div>`,
  };

  const pane = panel.querySelector('#evmPane');
  const tabs = panel.querySelectorAll('#evmTabs button');
  function setTab(t) {
    tabs.forEach(b => b.classList.toggle('on', b.dataset.t === t));
    pane.innerHTML = PANES[t] || PANES.settlement;
  }
  tabs.forEach(b => b.addEventListener('click', () => setTab(b.dataset.t)));
  setTab('settlement');

  // Stepper advance animation
  const steps = panel.querySelectorAll('.evm__step');
  const fill = panel.querySelector('#evmFill');
  function advance() {
    let i = 0;
    const go = () => {
      steps.forEach((s, k) => s.classList.toggle('active', k <= i));
      fill.style.width = (i / (steps.length - 1) * 100) + '%';
      i++;
      if (i < steps.length) setTimeout(go, 750);
    };
    go();
  }

  const s = document.createElement('style');
  s.textContent = `
    .chaos__note{border-left:3px solid var(--c,#EE5746);transform-origin:center;transition:all .7s cubic-bezier(.7,0,.3,1);}
    .evm{position:absolute;inset:58px 24px 24px;border-radius:16px;overflow:hidden;
      background:linear-gradient(180deg,#1b120d,#120b07);border:1px solid rgba(255,233,184,.12);
      box-shadow:0 40px 90px -30px rgba(0,0,0,.7);opacity:0;transform:translateY(24px) scale(.98);
      transition:opacity .6s var(--ease-out),transform .6s var(--ease-out);pointer-events:none;display:flex;flex-direction:column;}
    .evm.on{opacity:1;transform:none;pointer-events:auto;}
    .evm__bar{display:flex;align-items:center;gap:7px;padding:11px 16px;border-bottom:1px solid rgba(255,233,184,.08);
      font-family:var(--font-mono);font-size:11px;color:var(--ink-300);flex:none;}
    .evm__dot{width:9px;height:9px;border-radius:50%;background:#EE5746;}
    .evm__dot:nth-child(2){background:#FFC266}.evm__dot:nth-child(3){background:#6FC97A}
    .evm__crumb{margin-left:8px;color:var(--ink-200)}
    .evm__bell{margin-left:auto;position:relative;font-size:13px}
    .evm__bell i{position:absolute;top:-6px;right:-8px;background:#EE5746;color:#120903;font-style:normal;
      font-size:9px;font-weight:700;border-radius:999px;padding:1px 5px;font-family:var(--font-sans)}
    .evm__body{padding:18px 20px;overflow:auto;flex:1;}
    .evm__head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;}
    .evm__title{font-family:var(--font-display);font-size:21px;font-weight:600;letter-spacing:-.02em;display:flex;align-items:center;gap:10px;}
    .evm__pill{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px;
      background:rgba(111,201,122,.18);color:#9CE2A5;border:1px solid rgba(111,201,122,.35);font-family:var(--font-sans)}
    .evm__sub{font-size:12.5px;color:var(--ink-400);margin-top:4px}
    .evm__avatars{display:flex}
    .evm__avatars span{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;
      color:#120903;background:linear-gradient(135deg,#FFC266,#F4A046);border:2px solid #14100c;margin-left:-8px}
    .evm__avatars span:first-child{margin-left:0;background:linear-gradient(135deg,#EE5746,#FFC266)}
    .evm__stepper{position:relative;display:grid;grid-template-columns:repeat(4,1fr);margin:0 4px 20px;}
    .evm__track{position:absolute;left:8%;right:8%;top:9px;height:2px;background:rgba(255,233,184,.12);border-radius:2px;}
    .evm__fill{height:100%;width:0;background:linear-gradient(90deg,#EE5746,#FFC266);border-radius:2px;transition:width .7s var(--ease-out);}
    .evm__step{display:flex;flex-direction:column;align-items:center;gap:7px;position:relative;z-index:1;}
    .evm__step i{width:18px;height:18px;border-radius:50%;background:#241109;border:2px solid rgba(255,233,184,.22);transition:all .4s}
    .evm__step span{font-size:10.5px;color:var(--ink-400);font-family:var(--font-mono);letter-spacing:.02em}
    .evm__step.active i{background:linear-gradient(135deg,#EE5746,#FFC266);border-color:transparent;box-shadow:0 0 10px rgba(238,87,70,.5)}
    .evm__step.active span{color:var(--ink-100)}
    .evm__tabs{display:flex;gap:4px;border-bottom:1px solid rgba(255,233,184,.1);margin-bottom:16px;overflow:auto;}
    .evm__tabs button{padding:8px 12px;font-size:12.5px;color:var(--ink-400);white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .2s,border-color .2s;}
    .evm__tabs button:hover{color:var(--ink-200)}
    .evm__tabs button.on{color:var(--brand-gold);border-bottom-color:var(--brand-gold);font-weight:500}
    .evm__cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .evm__box{background:rgba(10,6,4,.45);border:1px solid rgba(255,233,184,.08);border-radius:12px;padding:14px 16px}
    .evm__box-h{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--brand-gold);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}
    .evm__cnt{color:var(--ink-400)}
    .evm__line{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;color:var(--ink-300);border-bottom:1px dashed rgba(255,233,184,.07)}
    .evm__line b{color:var(--ink-100);font-weight:500;font-variant-numeric:tabular-nums}
    .evm__line--sum{border-bottom:0;border-top:1px solid rgba(255,194,102,.2);margin-top:4px;padding-top:9px}
    .evm__line--sum b{color:var(--brand-gold)}
    .evm__pos{color:#9CE2A5!important}
    .evm__appr{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px dashed rgba(255,233,184,.07)}
    .evm__appr i{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;background:rgba(255,233,184,.08);color:var(--ink-400);flex:none;font-style:normal}
    .evm__appr.on i{background:rgba(111,201,122,.22);color:#9CE2A5}
    .evm__appr b{font-size:13px;font-weight:500;display:block}
    .evm__appr span{font-size:11px;color:var(--ink-400)}
    .evm__wait{position:relative}
    .evm__wait::after{content:"";position:absolute;width:9px;height:9px;border:2px solid var(--brand-gold);border-top-color:transparent;border-radius:50%;animation:evmspin 1s linear infinite}
    @keyframes evmspin{to{transform:rotate(360deg)}}
    .evm__wf{display:flex;gap:8px;margin-top:12px}
    .evm__btn{padding:8px 12px;border-radius:9px;font-size:12px;font-weight:500;border:1px solid rgba(255,233,184,.14);color:var(--ink-200);flex:1;transition:all .2s}
    .evm__btn--p{background:linear-gradient(135deg,#EE5746,#F4A046);color:#120903;border-color:transparent;font-weight:600}
    .evm__kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
    .evm__kpi{background:rgba(10,6,4,.45);border:1px solid rgba(255,233,184,.08);border-radius:11px;padding:12px}
    .evm__kpi span{font-size:11px;color:var(--ink-400);display:block;margin-bottom:5px}
    .evm__kpi b{font-family:var(--font-display);font-size:19px;font-weight:500;letter-spacing:-.02em}
    .evm__chart{width:100%;height:90px}
    .evm__todo{display:flex;align-items:center;gap:10px;padding:9px 0;font-size:13.5px;color:var(--ink-200);border-bottom:1px dashed rgba(255,233,184,.07)}
    .evm__todo i{width:18px;height:18px;border-radius:50%;border:1.5px solid rgba(255,233,184,.25);display:grid;place-items:center;font-size:10px;font-style:normal;flex:none}
    .evm__todo.done{color:var(--ink-400);text-decoration:line-through}
    .evm__todo.done i{background:rgba(111,201,122,.22);color:#9CE2A5;border-color:transparent}
    .evm__note-sm{font-size:11px;color:var(--ink-400);margin-top:10px}
    .evm__msg{display:flex;gap:10px;padding:9px 0}
    .evm__ava{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;color:#120903;background:linear-gradient(135deg,#6FC97A,#9CE2A5);flex:none}
    .evm__msg b{font-size:12.5px;display:block;margin-bottom:2px}
    .evm__msg p{margin:0;font-size:12.5px;color:var(--ink-300);line-height:1.4}
    @media(max-width:700px){.evm__cols,.evm__kpis{grid-template-columns:1fr}.evm{inset:58px 12px 12px}}
  `;
  document.head.appendChild(s);

  function apply(state) {
    stage.querySelectorAll('.chaos__note').forEach((el, i) => {
      if (state === 'chaos') {
        const p = chaosPos[i];
        el.style.left = p.x; el.style.top = p.y;
        el.style.transform = `translate(-50%,-50%) rotate(${p.rot}deg) scale(1)`;
        el.style.opacity = '1';
      } else {
        el.style.transform = `translate(-50%,-50%) rotate(0deg) scale(.6)`;
        el.style.opacity = '0';
      }
    });
    panel.classList.toggle('on', state === 'order');
    if (state === 'order') advance();
  }
  apply('chaos');

  stage.querySelectorAll('.chaos__toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      stage.querySelectorAll('.chaos__toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      apply(btn.dataset.state);
    });
  });

  let fired = false;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting && !fired) {
        fired = true;
        setTimeout(() => stage.querySelector('[data-state="order"]').click(), 1800);
      }
    });
  }, { threshold: 0.4 });
  io.observe(stage);
})();
