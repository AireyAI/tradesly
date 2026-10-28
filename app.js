import { LAUNCH, isLaunchPostcode, isLaunchOutward } from './launch-config.mjs';
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const menuButton = $('.menu-toggle');
  const navigation = $('#navigation');
  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    navigation.classList.toggle('open', open);
  });
  navigation?.addEventListener('click', event => {
    if (!event.target.closest('a, [data-request]')) return;
    navigation.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
  });
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    const badge = document.createElement('div');
    badge.className = 'preview-label';
    badge.textContent = 'Local design preview · enquiries are not sent';
    document.body.append(badge);
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && navigation.classList.contains('open')) {
      navigation.classList.remove('open'); menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Open navigation'); menuButton.focus();
    }
  });
  const dialog = $('#request-dialog');
  const form = $('#request-form');
  const steps = [...form.querySelectorAll('[data-step]')];
  const error = $('#request-error');
  const next = $('#request-next');
  const back = $('#request-back');
  const titles = ['Let’s start with your garden.', 'What’s on your garden list?', 'How can we reach you?', 'Does everything look right?'];
  const intros = ['A few details help us check for a suitable local partner.', 'A useful brief makes a better introduction.', 'Your details are used for this enquiry and one matched introduction.', 'Check your brief before sending. You can go back to change anything.'];
  let step = 0;
  let sending = false;
  let complete = false;
  let opener;

  function showError(message, field) {
    error.textContent = message;
    error.hidden = false;
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  }
  function clearError() {
    error.hidden = true;
    error.textContent = '';
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  }
  function renderStep(focus = true) {
    clearError();
    steps.forEach((element, index) => { element.hidden = index !== step; });
    $('#request-title').textContent = titles[step];
    $('#step-intro').textContent = intros[step];
    $('#step-label').textContent = `Your garden request · Step ${step + 1} of 4`;
    $('.dialog-progress span').style.width = `${(step + 1) * 25}%`;
    back.hidden = step === 0;
    next.textContent = step === 3 ? 'Send my garden request' : 'Continue';
    if (step === 3) renderReview();
    if (focus) { $('#request-title').focus(); dialog.scrollTop = 0; }
  }
  function values() { return Object.fromEntries(new FormData(form)); }
  function normalizedPostcode(value) {
    const raw = value.toUpperCase().replace(/\s/g, '');
    return raw.length > 3 ? `${raw.slice(0, -3)} ${raw.slice(-3)}` : raw;
  }
  function validateStep() {
    clearError();
    const f = form.elements;
    if (step === 0) {
      if (!f.job.value) { showError('Choose the kind of garden job you have in mind.', f.job); return false; }
      const postcode = normalizedPostcode(f.postcode.value.trim());
      if (!/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(postcode)) { showError('Enter a full UK postcode, for example BS6 5AA.', f.postcode); return false; }
      if (!isLaunchPostcode(postcode)) { showError('We’re starting with garden requests in BS postcodes. Email hello@tradesly.co.uk to suggest your area.', f.postcode); return false; }
      f.postcode.value = postcode;
    }
    if (step === 1) {
      if (f.problem.value.trim().length < 15) { showError('Add a little more detail about the job (at least 15 characters).', f.problem); return false; }
      if (!f.timeframe.value) { showError('Choose an approximate timeframe.', f.timeframe); return false; }
    }
    if (step === 2) {
      if (!f.email.value.trim() || !f.email.validity.valid) { showError('Enter an email address we can reach you on.', f.email); return false; }
      if (f.phone.value.trim() && !/^[+\d\s().-]{7,25}$/.test(f.phone.value.trim())) { showError('Check the phone number, or leave it blank.', f.phone); return false; }
      if (!f.consent.checked) { showError('Please confirm permission to use your enquiry for one matched introduction.', f.consent); return false; }
    }
    return true;
  }
  function renderReview() {
    const v = values();
    const list = $('#request-review');
    list.replaceChildren();
    for (const [label, text] of [['Your job', v.job], ['Garden postcode', v.postcode], ['The brief', v.problem], ['Timeframe', v.timeframe], ['Contact', `${v.email}${v.phone ? `\n${v.phone}` : ''}`]]) {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label; description.textContent = text;
      row.append(term, description); list.append(row);
    }
  }
  function openRequest(button, initial = {}) {
    opener = button;
    if (complete) {
      form.reset(); complete = false; step = 0;
      form.hidden = false; $('#request-success').hidden = true;
      $('#step-intro').hidden = false; $('.dialog-progress').hidden = false;
    }
    if (initial.job) form.elements.job.value = initial.job;
    if (initial.postcode) form.elements.postcode.value = initial.postcode;
    renderStep(false);
    dialog.showModal();
    $('#request-title').focus();
    dialog.scrollTop = 0;
  }
  document.querySelectorAll('[data-request]').forEach(button => button.addEventListener('click', () => openRequest(button, {job: button.dataset.job})));
  $('#start-form')?.addEventListener('submit', event => {
    event.preventDefault();
    openRequest(event.submitter, {job: $('#start-job').value, postcode: $('#start-postcode').value});
    if (validateStep()) { step = 1; renderStep(); }
  });
  function closeDialog() { if (!sending) dialog.close(); }
  $('.dialog-close', dialog).addEventListener('click', closeDialog);
  $('#request-done').addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', event => { if (sending) event.preventDefault(); });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(el => el.getClientRects().length && !el.closest('[hidden]'));
    const first = controls[0], last = controls.at(-1);
    if (!first) return;
    if (!controls.includes(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
  });
  dialog.addEventListener('close', () => { opener?.focus(); });
  back.addEventListener('click', () => { if (step > 0 && !sending) { step--; renderStep(); } });
  form.addEventListener('submit', event => { event.preventDefault(); next.click(); });
  form.addEventListener('input', clearError);

  async function postJSON(url, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: controller.signal});
      let data;
      try { data = await response.json(); } catch { throw new Error('invalid_response'); }
      if (!response.ok || data.ok !== true) throw new Error('request_failed');
      return data;
    } finally { clearTimeout(timeout); }
  }
  function attribution() {
    const params = new URLSearchParams(location.search);
    const out = {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ref']) {
      if (params.has(key)) out[key] = params.get(key).slice(0, 500);
    }
    if (document.referrer) out.referrer = document.referrer.slice(0, 2000);
    return out;
  }
  next.addEventListener('click', async () => {
    if (sending || !validateStep()) return;
    if (step < 3) { step++; renderStep(); return; }
    const v = values();
    sending = true; next.disabled = true; back.disabled = true;
    next.textContent = 'Sending your request…';
    const payload = {
      niche_slug: LAUNCH.niche, postcode: normalizedPostcode(v.postcode),
      email: v.email.trim(), phone: v.phone.trim() || null, whatsapp: null,
      problem: `Garden job: ${v.job}\n${v.problem.trim()}\nPreferred timeframe: ${v.timeframe}`,
      gdpr_consent: form.elements.consent.checked, gdpr_consent_at: new Date().toISOString(),
      consent_version: LAUNCH.consentVersion, matching_policy: LAUNCH.matchingPolicy,
      page_url: location.href, attribution: attribution()
    };
    try {
      const result = await postJSON('/api/lead', payload);
      if (!result.lead_id) throw new Error('missing_reference');
      complete = true;
      form.hidden = true; $('#request-success').hidden = false;
      $('#request-title').textContent = result.preview ? 'You’ve reached the final step.' : 'Your request is with us.';
      $('#step-label').textContent = result.preview ? 'Local preview complete' : 'Garden request received';
      $('#step-intro').hidden = true;
      $('.dialog-progress').hidden = true;
      $('#success-heading').textContent = result.preview ? 'Preview complete. Nothing has been sent.' : 'Thanks for telling us about your garden.';
      $('#success-copy').textContent = result.preview ? 'This local preview demonstrates the enquiry flow. It hasn’t created a lead, contacted a partner or sent an alert.' : 'We’ll check whether a suitable garden partner covers your job and postcode. This isn’t a confirmed match or booking. We’ll contact you with the next step.';
      $('#request-reference').textContent = `Reference: ${result.lead_id}`;
      $('#request-title').focus(); dialog.scrollTop = 0;
    } catch (failure) {
      showError(failure.name === 'AbortError' ? 'This is taking too long. Your request has not been confirmed. Your details are still here; try again or email hello@tradesly.co.uk.' : 'Your request hasn’t been confirmed. Your details are still here. Please try again, or email hello@tradesly.co.uk.');
    } finally {
      sending = false; next.disabled = false; back.disabled = false;
      next.textContent = 'Send my garden request';
    }
  });

  const partnerForm = $('#partner-form');
  partnerForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const errorNode = $('#partner-error');
    errorNode.hidden = true;
    if (!partnerForm.reportValidity()) return;
    const v = Object.fromEntries(new FormData(partnerForm));
    const postcodes = [...new Set(v.postcodes.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
    if (!postcodes.length || postcodes.some(p => !isLaunchOutward(p))) {
      errorNode.textContent = 'Enter BS outward postcode areas, for example BS3, BS6, BS8.';
      errorNode.hidden = false; partnerForm.elements.postcodes.focus(); return;
    }
    const button = $('button[type=submit]', partnerForm);
    if (button.disabled) return;
    button.disabled = true; button.textContent = 'Sending your application…';
    try {
      const result = await postJSON('/api/buyer-apply', {
        business_name: v.business_name.trim(), contact_name: v.contact_name.trim(), email: v.email.trim(), phone: v.phone.trim(),
        niches: [LAUNCH.niche], postcodes, daily_cap: Number(v.daily_cap), tiers: ['T1','T2','T3','T4'],
        website: v.website.trim() || null, credentials: v.credentials.trim(), terms_consent: partnerForm.elements.terms_consent.checked, terms_version: LAUNCH.consentVersion
      });
      if (!result.buyer_id) throw new Error('missing_reference');
      partnerForm.hidden = true;
      $('#partner-success').hidden = false;
      $('#partner-success-copy').textContent = result.preview ? 'Preview complete. No application has been sent, and no paid delivery has been enabled.' : 'Your application has been received for review. We’ll contact you about the next step. You aren’t enrolled in paid lead delivery yet.';
      $('#partner-reference').textContent = `Reference: ${result.buyer_id}`;
      $('#partner-success').setAttribute('tabindex', '-1'); $('#partner-success').focus();
    } catch (failure) {
      errorNode.textContent = 'Your application hasn’t been confirmed. Your details are still here; please try again or email hello@tradesly.co.uk.';
      errorNode.hidden = false;
    } finally { button.disabled = false; button.textContent = 'Send my application'; }
  });
})();
