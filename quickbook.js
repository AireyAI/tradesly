/**
 * Your Business Name — Quick Book floating widget
 * Include on any page: <script src="quickbook.js" defer></script>
 *
 * Renders a floating "Quick Book" pill at bottom-left and a modal booking form.
 * Same webhook + slot-generation logic as the full homepage booking section,
 * but compressed into one fast modal.
 */
(function () {
  'use strict';

  // ─── CONFIG ──────────────────────────────────────────────────────────
  const BOOKING_WEBHOOK = 'https://aria-chatbot-production-12d0.up.railway.app/api/booking';
  const OWNER_EMAIL = 'owner@example.com';
  const OWNER_NAME  = 'Owner';
  const SITE_NAME   = 'Your Business Name';
  const BRAND = {
    brandColor:   '#EC0A7E',
    brandLogoUrl: 'https://aireyai.github.io/your-slug/brand_assets/logo.jpeg',
    brandTagline: 'Tagline · Goes · Here',
    siteUrl:      'https://aireyai.github.io/your-slug/',
    location:     'Your Street Address, Your City PC1 1PC (above Landmark Name)',
    mapUrl:       'https://www.google.com/maps/search/?api=1&query=1+Lonsdale+Street+Your City+CA1+1BJ'
  };
  const OPENING_HOURS = {
    0: null, 1: [8, 20], 2: [8, 17], 3: [8, 20], 4: [8, 18], 5: [8, 18], 6: [8, 12]
  };
  const SERVICES = [
    { value: 'Injury Assessment & Treatment', price: 50, duration: 60, label: 'Injury Assessment' },
    { value: 'Maintenance Massage',          price: 45, duration: 60, label: 'Maintenance' },
    { value: 'Pre-Event Massage',            price: 25, duration: 30, label: 'Pre-Event' },
    { value: 'Post-Event Massage',           price: 25, duration: 30, label: 'Post-Event' }
  ];

  // ─── STYLES ──────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .qb-fab {
      position: fixed; bottom: 24px; left: 24px; z-index: 9997;
      display: inline-flex; align-items: center; gap: 10px;
      padding: 14px 20px; border-radius: 999px;
      background: #EC0A7E; color: #fff; font-family: 'Inter', sans-serif;
      font-weight: 700; font-size: 14px; letter-spacing: 0.02em;
      border: none; cursor: pointer;
      box-shadow: 0 10px 30px rgba(236,10,126,0.4), 0 0 0 0 rgba(236,10,126,0.5);
      transition: transform 220ms cubic-bezier(.2,.9,.3,1.2), box-shadow 220ms ease, opacity 280ms ease;
      animation: qb-pulse 2.4s ease-in-out infinite;
      opacity: 0; pointer-events: none; transform: translateY(20px);
    }
    .qb-fab.qb-visible { opacity: 1; pointer-events: auto; transform: translateY(0); }
    .qb-fab:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 14px 40px rgba(236,10,126,0.55); animation: none; }
    .qb-fab svg { flex-shrink: 0; }
    @keyframes qb-pulse {
      0%, 100% { box-shadow: 0 10px 30px rgba(236,10,126,0.4), 0 0 0 0 rgba(236,10,126,0.4); }
      50%      { box-shadow: 0 10px 30px rgba(236,10,126,0.4), 0 0 0 14px rgba(236,10,126,0); }
    }
    @media (max-width: 640px) {
      .qb-fab { bottom: 18px; left: 18px; padding: 12px 16px; font-size: 13px; }
      .qb-fab .qb-label-long { display: none; }
    }
    @media (min-width: 641px) { .qb-fab .qb-label-short { display: none; } }

    .qb-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(5,5,5,0.82); backdrop-filter: blur(12px) saturate(1.2);
      display: none; align-items: center; justify-content: center;
      padding: 20px; opacity: 0; transition: opacity 240ms ease;
    }
    .qb-overlay.open { display: flex; opacity: 1; }
    body.qb-locked { overflow: hidden; }

    .qb-card {
      width: 100%; max-width: 560px; max-height: calc(100dvh - 40px);
      background: #0F0F0F; border: 1px solid #262626; border-radius: 24px;
      display: flex; flex-direction: column; overflow: hidden;
      transform: translateY(20px) scale(0.98);
      transition: transform 320ms cubic-bezier(.2,.9,.3,1.2);
      color: #EDEDED; font-family: 'Inter', system-ui, sans-serif;
    }
    .qb-overlay.open .qb-card { transform: translateY(0) scale(1); }

    .qb-header {
      position: sticky; top: 0; z-index: 2;
      padding: 22px 26px;
      background: linear-gradient(180deg, #141414 0%, #0F0F0F 100%);
      border-bottom: 1px solid #262626;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
    }
    .qb-title { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 28px; text-transform: uppercase; letter-spacing: 0.02em; line-height: 1; }
    .qb-title span { color: #EC0A7E; }
    .qb-sub { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.2em; color: #9A9A9E; margin-top: 4px; }
    .qb-close {
      width: 40px; height: 40px; border-radius: 50%;
      background: transparent; border: 1px solid #262626;
      color: #EDEDED; cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: border-color 180ms ease, color 180ms ease;
    }
    .qb-close:hover { border-color: #EC0A7E; color: #EC0A7E; }

    .qb-body { padding: 24px 26px 26px; overflow-y: auto; flex: 1; }
    .qb-body::-webkit-scrollbar { width: 6px; }
    .qb-body::-webkit-scrollbar-thumb { background: #262626; border-radius: 6px; }

    .qb-step { margin-bottom: 22px; }
    .qb-step-label {
      display: flex; align-items: center; gap: 10px;
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.2em; font-weight: 700;
      color: #EC0A7E; margin-bottom: 12px;
    }
    .qb-step-label-num { color: #EC0A7E; font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 0; }

    .qb-services { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .qb-svc {
      background: #1A1A1A; border: 1px solid #262626; border-radius: 12px;
      padding: 12px 14px; cursor: pointer; transition: all 180ms ease;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .qb-svc:hover { border-color: #EC0A7E; }
    .qb-svc input { display: none; }
    .qb-svc.selected { border-color: #EC0A7E; background: rgba(236,10,126,0.08); }
    .qb-svc-title { font-size: 13px; font-weight: 600; color: #EDEDED; }
    .qb-svc-meta { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.15em; color: #9A9A9E; margin-top: 2px; }
    .qb-svc-price { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #EC0A7E; line-height: 1; }

    .qb-input, .qb-select {
      width: 100%; background: #1A1A1A; color: #EDEDED;
      border: 1px solid #262626; border-radius: 10px;
      padding: 12px 14px; font-family: 'Inter', sans-serif; font-size: 14px;
      transition: border-color 180ms ease;
    }
    .qb-input:focus, .qb-select:focus { outline: none; border-color: #EC0A7E; }
    .qb-input::placeholder { color: #9A9A9E; }

    .qb-slots { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; max-height: 200px; overflow-y: auto; padding-right: 4px; }
    @media (max-width: 520px) { .qb-slots { grid-template-columns: repeat(3, 1fr); } }
    .qb-slot {
      padding: 10px 6px; background: #1A1A1A; border: 1px solid #262626;
      border-radius: 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px;
      font-weight: 700; color: #EDEDED; cursor: pointer; text-align: center;
      transition: all 160ms ease;
    }
    .qb-slot:hover { border-color: #EC0A7E; color: #EC0A7E; }
    .qb-slot.selected { background: #EC0A7E; border-color: #EC0A7E; color: #fff; }
    .qb-slot-empty { grid-column: 1/-1; text-align: center; padding: 18px; font-size: 12px; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.15em; color: #9A9A9E; border: 1px dashed #262626; border-radius: 10px; }
    .qb-slot-empty.closed { color: #EC0A7E; border-color: #EC0A7E; }

    .qb-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    @media (max-width: 520px) { .qb-row-2 { grid-template-columns: 1fr; } }

    .qb-footer {
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
      padding-top: 18px; border-top: 1px solid #262626; margin-top: 6px;
    }
    .qb-summary { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #9A9A9E; }
    .qb-summary b { color: #EDEDED; font-weight: 700; }
    .qb-submit {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 13px 22px; border-radius: 999px;
      background: #EC0A7E; color: #fff; font-family: 'Inter', sans-serif;
      font-weight: 700; font-size: 14px; letter-spacing: 0.02em;
      border: none; cursor: pointer; transition: background 200ms ease, transform 180ms ease;
    }
    .qb-submit:hover:not(:disabled) { background: #ff2fa0; transform: translateY(-1px); }
    .qb-submit:disabled { opacity: 0.5; cursor: not-allowed; }

    .qb-trust { display: flex; align-items: center; gap: 8px; font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em; color: #9A9A9E; margin-top: 10px; }
    .qb-trust svg { flex-shrink: 0; }

    .qb-success { text-align: center; padding: 20px 10px 10px; }
    .qb-success-title { font-family: 'Bebas Neue', sans-serif; font-size: 46px; text-transform: uppercase; color: #EC0A7E; line-height: 1; margin-bottom: 8px; }
    .qb-success-body { color: #EDEDED; opacity: 0.85; font-size: 14px; line-height: 1.6; max-width: 380px; margin: 0 auto 20px; }
  `;
  document.head.appendChild(style);

  // ─── MARKUP ──────────────────────────────────────────────────────────
  const servicesHtml = SERVICES.map((s, i) => `
    <label class="qb-svc" data-duration="${s.duration}" data-price="${s.price}">
      <input type="radio" name="qb-service" value="${s.value}" ${i === 0 ? 'required' : ''} aria-label="${s.value}, ${s.duration} minutes, £${s.price}" />
      <div>
        <div class="qb-svc-title">${s.label}</div>
        <div class="qb-svc-meta">${s.duration} min</div>
      </div>
      <div class="qb-svc-price">£${s.price}</div>
    </label>
  `).join('');

  const fab = document.createElement('button');
  fab.className = 'qb-fab';
  fab.setAttribute('aria-label', 'Open quick booking');
  fab.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
    <span class="qb-label-long">Quick Book</span>
    <span class="qb-label-short">Book</span>
  `;

  const overlay = document.createElement('div');
  overlay.className = 'qb-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'qbTitle');
  overlay.innerHTML = `
    <div class="qb-card">
      <div class="qb-header">
        <div>
          <div id="qbTitle" class="qb-title">Quick <span>Book</span></div>
          <div class="qb-sub">Tagline · Goes · Here</div>
        </div>
        <button class="qb-close" aria-label="Close quick book">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>

      <div class="qb-body" id="qbBody">
        <form id="qbForm" onsubmit="return false">

          <div class="qb-step">
            <div class="qb-step-label"><span class="qb-step-label-num">01</span> Treatment</div>
            <div class="qb-services">${servicesHtml}</div>
          </div>

          <div class="qb-step qb-row-2">
            <div>
              <div class="qb-step-label"><span class="qb-step-label-num">02</span> Date</div>
              <input type="date" id="qbDate" class="qb-input" required />
            </div>
            <div>
              <div class="qb-step-label"><span class="qb-step-label-num">03</span> Time</div>
              <div id="qbSlots" class="qb-slots" role="radiogroup" aria-label="Available time slots">
                <div class="qb-slot-empty">Pick a service & date</div>
              </div>
              <input type="hidden" id="qbTime" required />
            </div>
          </div>

          <div class="qb-step">
            <div class="qb-step-label"><span class="qb-step-label-num">04</span> Your Details</div>
            <div class="qb-row-2" style="margin-bottom:10px">
              <input type="text" id="qbName" class="qb-input" placeholder="Full name" required autocomplete="name" />
              <input type="tel" id="qbPhone" class="qb-input" placeholder="Phone" required autocomplete="tel" />
            </div>
            <input type="email" id="qbEmail" class="qb-input" placeholder="Email" required autocomplete="email" />
          </div>

          <div class="qb-footer">
            <div class="qb-summary" id="qbSummary">Pick a treatment to start</div>
            <button type="submit" class="qb-submit" id="qbSubmit">
              <span id="qbSubmitText">Confirm</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14m-6-6l6 6-6 6"/></svg>
            </button>
          </div>

          <div class="qb-trust">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#EC0A7E" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Goes straight to the Owner's calendar · Confirmation within the hour
          </div>
        </form>

        <div id="qbSuccess" class="qb-success" style="display:none">
          <div class="qb-success-title">Booked.</div>
          <p class="qb-success-body">Your session has been requested. You'll get a confirmation shortly — usually within the hour.</p>
          <button type="button" class="qb-submit" id="qbReset">Book another</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(overlay);

  // ─── REFERENCES ──────────────────────────────────────────────────────
  const card = overlay.querySelector('.qb-card');
  const closeBtn = overlay.querySelector('.qb-close');
  const form = overlay.querySelector('#qbForm');
  const success = overlay.querySelector('#qbSuccess');
  const dateEl = overlay.querySelector('#qbDate');
  const slotsEl = overlay.querySelector('#qbSlots');
  const timeEl = overlay.querySelector('#qbTime');
  const summaryEl = overlay.querySelector('#qbSummary');
  const submitBtn = overlay.querySelector('#qbSubmit');
  const submitTxt = overlay.querySelector('#qbSubmitText');

  // Default date: tomorrow
  const today = new Date();
  dateEl.min = today.toISOString().split('T')[0];
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  dateEl.value = tomorrow.toISOString().split('T')[0];

  // ─── LOGIC ───────────────────────────────────────────────────────────
  const fmtTime = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  function getService() {
    const checked = overlay.querySelector('input[name="qb-service"]:checked');
    if (!checked) return null;
    const label = checked.closest('.qb-svc');
    return { value: checked.value, duration: +label.dataset.duration, price: +label.dataset.price };
  }

  function renderSlots() {
    const svc = getService();
    const date = dateEl.value;
    slotsEl.innerHTML = '';
    timeEl.value = '';
    updateSummary();

    if (!svc || !date) { slotsEl.innerHTML = '<div class="qb-slot-empty">Pick a service & date</div>'; return; }

    const d = new Date(date + 'T00:00');
    const hours = OPENING_HOURS[d.getDay()];
    if (!hours) { slotsEl.innerHTML = '<div class="qb-slot-empty closed">Closed — pick another day</div>'; return; }

    const [openH, closeH] = hours;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const slots = [];
    for (let h = openH; h < closeH; h++) {
      for (let m = 0; m < 60; m += 30) {
        if (h * 60 + m + svc.duration > closeH * 60) continue;
        if (isToday) {
          const slot = new Date(d); slot.setHours(h, m, 0, 0);
          if (slot < new Date(now.getTime() + 60 * 60 * 1000)) continue;
        }
        slots.push({ h, m });
      }
    }
    if (!slots.length) { slotsEl.innerHTML = '<div class="qb-slot-empty closed">No slots left — try tomorrow</div>'; return; }

    slots.forEach(({ h, m }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qb-slot';
      btn.textContent = fmtTime(h, m);
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-label', `${fmtTime(h, m)}`);
      btn.addEventListener('click', () => {
        slotsEl.querySelectorAll('.qb-slot').forEach(s => s.classList.remove('selected'));
        btn.classList.add('selected');
        timeEl.value = fmtTime(h, m);
        updateSummary();
      });
      slotsEl.appendChild(btn);
    });
  }

  function updateSummary() {
    const svc = getService();
    if (!svc) { summaryEl.innerHTML = 'Pick a treatment to start'; return; }
    const parts = [`<b>${svc.value}</b>`, `£${svc.price}`];
    if (dateEl.value) parts.push(new Date(dateEl.value + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));
    if (timeEl.value) parts.push(`<b>${timeEl.value}</b>`);
    summaryEl.innerHTML = parts.join(' · ');
  }

  overlay.querySelectorAll('input[name="qb-service"]').forEach(r => r.addEventListener('change', () => {
    overlay.querySelectorAll('.qb-svc').forEach(s => s.classList.toggle('selected', s.contains(r) && r.checked));
    overlay.querySelectorAll('.qb-svc').forEach(s => {
      const input = s.querySelector('input');
      s.classList.toggle('selected', input.checked);
    });
    renderSlots();
  }));
  dateEl.addEventListener('change', renderSlots);

  // ─── OPEN / CLOSE ────────────────────────────────────────────────────
  let lastFocus = null;
  function open() {
    lastFocus = document.activeElement;
    overlay.classList.add('open');
    document.body.classList.add('qb-locked');
    setTimeout(() => overlay.querySelector('.qb-svc input').focus(), 100);
  }
  function close() {
    overlay.classList.remove('open');
    document.body.classList.remove('qb-locked');
    if (lastFocus) lastFocus.focus();
  }

  fab.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });

  // ─── SUBMIT ──────────────────────────────────────────────────────────
  async function submit(e) {
    e.preventDefault();
    if (!timeEl.value) { alert('Please pick a time slot.'); return; }
    const svc = getService();
    submitBtn.disabled = true;
    submitTxt.textContent = 'Sending…';

    const name  = overlay.querySelector('#qbName').value.trim();
    const phone = overlay.querySelector('#qbPhone').value.trim();
    const email = overlay.querySelector('#qbEmail').value.trim();

    // Human-readable datetime for Aria's email template
    const dateObj = new Date(dateEl.value + 'T' + timeEl.value);
    const datetime = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' at ' + timeEl.value;

    // Pack service + phone into notes so Owner sees them in the booking email
    const packedNotes = [
      `Service: ${svc.value} — ${svc.duration} min, £${svc.price}`,
      `Phone: ${phone}`,
      '(Booked via Quick Book popup)'
    ].join('\n');

    const payload = {
      ownerEmail: OWNER_EMAIL,
      ownerName:  OWNER_NAME,
      siteName:   SITE_NAME,
      botName:    OWNER_NAME,
      page:       'Quick Book popup',
      name:       name,
      email:      email,
      datetime:   datetime,
      notes:      packedNotes,
      service:            svc.value,
      duration_minutes:   svc.duration,
      price_gbp:          svc.price,
      date:               dateEl.value,
      time:               timeEl.value,
      phone:              phone,
      source:             'yourdomain.co.uk (quick-book)',
      ...BRAND
    };

    try {
      const res = await fetch(BOOKING_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: 'cors'
      });
      if (!res.ok) throw new Error('bad status');
    } catch (_) {
      // Fallback — email Owner so booking isn't lost
      const subj = encodeURIComponent(`Booking request — ${payload.service}`);
      const body = encodeURIComponent(
        `Booking from yourdomain.co.uk (Quick Book)\n\n${packedNotes}\nWhen: ${datetime}\nName: ${name}\nEmail: ${email}`
      );
      const a = document.createElement('a');
      a.href = `mailto:${OWNER_EMAIL}?subject=${subj}&body=${body}`;
      a.click();
    }

    form.style.display = 'none';
    success.style.display = 'block';
    submitBtn.disabled = false;
    submitTxt.textContent = 'Confirm';
  }
  form.addEventListener('submit', submit);

  overlay.querySelector('#qbReset').addEventListener('click', () => {
    form.reset();
    form.style.display = 'block';
    success.style.display = 'none';
    dateEl.value = tomorrow.toISOString().split('T')[0];
    renderSlots();
  });

  // Show FAB only after user has scrolled past the hero (keeps above-the-fold clean)
  const SHOW_THRESHOLD = 400;
  function updateFabVisibility() {
    if (window.scrollY > SHOW_THRESHOLD) fab.classList.add('qb-visible');
    else fab.classList.remove('qb-visible');
  }
  window.addEventListener('scroll', updateFabVisibility, { passive: true });
  updateFabVisibility();

  // Init
  renderSlots();
})();
