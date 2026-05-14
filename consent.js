/**
 * Your Business Name — Cookie consent + GA4 loader
 * Include on every public page: <script src="consent.js" defer></script>
 *
 * Behaviour:
 * - First visit: shows banner at bottom with Accept / Decline / Settings
 * - On Accept:   loads Google Analytics 4, stores consent in localStorage
 * - On Decline:  stores 'declined' flag, no trackers load, banner dismissed
 * - Footer link "Cookie Settings" (optional): calls window.YBNShowConsent() to re-open
 * - Respects Do-Not-Track header → treats as declined
 *
 * To go live: replace GA_MEASUREMENT_ID below with Owner's actual G-XXXXXXXXXX ID
 * from https://analytics.google.com/
 */
(function () {
  'use strict';

  // =========================================================================
  // CONFIG — replace with Owner's real GA4 ID when live
  // =========================================================================
  const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX'; // TODO: replace before launch
  const STORAGE_KEY = 'ybn_consent_v1';     // bump suffix if policy changes

  // =========================================================================
  // HELPERS
  // =========================================================================
  function getConsent() { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } }
  function setConsent(v) { try { localStorage.setItem(STORAGE_KEY, v); } catch {} }
  function clearConsent() { try { localStorage.removeItem(STORAGE_KEY); } catch {} }
  const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.msDoNotTrack === '1';

  // =========================================================================
  // GA LOADER
  // =========================================================================
  function loadGA() {
    if (!GA_MEASUREMENT_ID || GA_MEASUREMENT_ID.indexOf('XXXXXXXXXX') !== -1) {
      console.info('[consent] GA skipped — placeholder measurement ID');
      return;
    }
    if (window.__YBN_GA_LOADED__) return;
    window.__YBN_GA_LOADED__ = true;

    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
  }

  // =========================================================================
  // BANNER
  // =========================================================================
  const style = document.createElement('style');
  style.textContent = `
    .rwr-consent {
      position: fixed; left: 20px; right: 20px; bottom: 20px; z-index: 9995;
      max-width: 640px; margin: 0 auto;
      background: #141414; color: #EDEDED;
      border: 1px solid #262626; border-radius: 18px;
      padding: 20px 24px;
      box-shadow: 0 30px 80px rgba(0,0,0,0.6);
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 13.5px; line-height: 1.6;
      display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
      transform: translateY(200%); opacity: 0;
      transition: transform 400ms cubic-bezier(.2,.9,.3,1.2), opacity 360ms ease;
    }
    .rwr-consent.show { transform: translateY(0); opacity: 1; }
    .rwr-consent-text { flex: 1 1 260px; color: rgba(237,237,237,0.85); }
    .rwr-consent-text strong { color: #EDEDED; }
    .rwr-consent-text a { color: #EC0A7E; text-decoration: underline; text-underline-offset: 2px; }
    .rwr-consent-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
    .rwr-consent button {
      font-family: inherit; font-weight: 600; font-size: 12.5px;
      letter-spacing: 0.04em; padding: 10px 18px; border-radius: 999px;
      cursor: pointer; transition: all 180ms ease; border: 1.5px solid transparent;
    }
    .rwr-consent .rwr-accept { background: #EC0A7E; color: #fff; border-color: #EC0A7E; }
    .rwr-consent .rwr-accept:hover { background: #ff2fa0; border-color: #ff2fa0; }
    .rwr-consent .rwr-decline { background: transparent; color: #EDEDED; border-color: #262626; }
    .rwr-consent .rwr-decline:hover { border-color: #EC0A7E; color: #EC0A7E; }
    @media (max-width: 520px) {
      .rwr-consent { left: 12px; right: 12px; bottom: 12px; padding: 16px 18px; font-size: 13px; }
      .rwr-consent-buttons { width: 100%; }
      .rwr-consent-buttons button { flex: 1; }
    }
  `;
  document.head.appendChild(style);

  function buildBanner() {
    const el = document.createElement('div');
    el.className = 'rwr-consent';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookie preferences');
    el.innerHTML = `
      <div class="rwr-consent-text">
        <strong>Cookies.</strong> We use a single analytics cookie so Owner can see how many people visit the site and which pages are popular.
        No personal data, no ads. <a href="privacy.html">Read more</a>.
      </div>
      <div class="rwr-consent-buttons">
        <button type="button" class="rwr-decline">Decline</button>
        <button type="button" class="rwr-accept">Accept</button>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector('.rwr-accept').addEventListener('click', () => {
      setConsent('granted');
      loadGA();
      hide(el);
    });
    el.querySelector('.rwr-decline').addEventListener('click', () => {
      setConsent('denied');
      hide(el);
    });
    // slight delay for mount + transition
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    return el;
  }

  function hide(el) {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 500);
  }

  // =========================================================================
  // ENTRY
  // =========================================================================
  function init() {
    const existing = getConsent();
    if (dnt) { setConsent('denied'); return; }
    if (existing === 'granted') { loadGA(); return; }
    if (existing === 'denied')  { return; }
    buildBanner();
  }

  // Expose a manual re-open for footer "Cookie Settings" link
  window.YBNShowConsent = function () {
    document.querySelectorAll('.rwr-consent').forEach(n => n.remove());
    clearConsent();
    buildBanner();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
