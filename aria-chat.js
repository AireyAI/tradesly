// aria-chat.js — Tradesly homeowner chat widget.
//
// Drop-in component. The host page needs:
//   <div id="aria-chat" data-niche="heat-pumps"></div>
//   <script src="/aria-chat.js" defer></script>
//
// On mount: greets the homeowner, then has a 4-6 turn conversation that
// captures name/email/postcode/problem (+ timeframe + property_type for
// higher tier). Calls POST /api/aria-chat per turn. On completion: hides
// any sibling static form (graceful augmentation, not replacement).

(function () {
  'use strict';

  const ENDPOINT = '/api/aria-chat';
  const STORAGE_KEY_HISTORY = 'aria_history_v1';
  const STORAGE_KEY_SESSION = 'aria_session_v1';

  function makeId() {
    return 'sess-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function getSessionId() {
    let sid = localStorage.getItem(STORAGE_KEY_SESSION);
    if (!sid) {
      sid = makeId();
      try { localStorage.setItem(STORAGE_KEY_SESSION, sid); } catch (e) {}
    }
    return sid;
  }

  function loadHistory(niche) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISTORY + ':' + niche);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function saveHistory(niche, history) {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY + ':' + niche, JSON.stringify(history));
    } catch (e) {}
  }

  function clearHistory(niche) {
    try {
      localStorage.removeItem(STORAGE_KEY_HISTORY + ':' + niche);
      localStorage.removeItem(STORAGE_KEY_SESSION);
    } catch (e) {}
  }

  // Safe DOM creation — never accepts HTML strings, only text + child nodes.
  // This avoids any XSS risk from Aria's reply text being injected as markup.
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'class') node.className = props[k];
        else if (k === 'text') node.textContent = props[k];
        else if (k.startsWith('on') && typeof props[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), props[k]);
        } else if (props[k] !== null && props[k] !== undefined) {
          node.setAttribute(k, props[k]);
        }
      }
    }
    for (const c of children) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function mount(host) {
    const niche = host.getAttribute('data-niche');
    if (!niche) {
      console.warn('[aria-chat] data-niche attribute missing on host element');
      return;
    }

    // Track collected fields visually
    const fields = { name: null, email: null, postcode: null, problem: null,
                     timeframe: null, property_type: null };

    const messagesEl = el('div', { class: 'aria-messages' });
    const progressEl = el('div', { class: 'aria-progress' });
    const inputEl = el('input', {
      type: 'text',
      class: 'aria-input',
      placeholder: 'Type your reply...',
      autocomplete: 'off',
    });
    const sendBtn = el('button', { class: 'aria-send', type: 'button', text: 'Send' });
    const successEl = el('div', { class: 'aria-success', style: 'display:none' });

    const inputRow = el('div', { class: 'aria-input-row' }, inputEl, sendBtn);

    host.appendChild(el('div', { class: 'aria-widget' },
      el('div', { class: 'aria-header' },
        el('div', { class: 'aria-avatar', text: 'A' }),
        el('div', { class: 'aria-headline' },
          el('div', { class: 'aria-name', text: 'Aria' }),
          el('div', { class: 'aria-sub', text: 'Tradesly intake' })
        )
      ),
      messagesEl,
      progressEl,
      inputRow,
      successEl
    ));

    function appendMessage(role, text) {
      const bubble = el('div', { class: 'aria-msg aria-msg-' + role },
        el('div', { class: 'aria-msg-body', text }));
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setTyping(on) {
      let typing = messagesEl.querySelector('.aria-typing');
      if (on && !typing) {
        typing = el('div', { class: 'aria-msg aria-msg-assistant aria-typing' },
          el('div', { class: 'aria-msg-body' },
            el('span', { class: 'aria-dot' }),
            el('span', { class: 'aria-dot' }),
            el('span', { class: 'aria-dot' })
          ));
        messagesEl.appendChild(typing);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } else if (!on && typing) {
        typing.remove();
      }
    }

    function updateProgress(extracted) {
      if (extracted) {
        for (const k of Object.keys(fields)) {
          if (extracted[k]) fields[k] = extracted[k];
        }
      }
      // replaceChildren clears safely (no innerHTML — no XSS surface)
      progressEl.replaceChildren();
      const required = ['name', 'email', 'postcode', 'problem'];
      const bonus = ['timeframe', 'property_type'];
      const pill = (label, present, kind) => el('span', {
        class: 'aria-pill aria-pill-' + (present ? 'on' : 'off') + ' aria-pill-' + kind,
      }, present ? '✓ ' + label : label);
      for (const k of required) progressEl.appendChild(pill(k, !!fields[k], 'required'));
      for (const k of bonus) progressEl.appendChild(pill(k, !!fields[k], 'bonus'));
    }

    let busy = false;
    let history = loadHistory(niche);
    const sessionId = getSessionId();

    // Replay any prior history (e.g., user refreshed mid-conversation)
    for (const m of history) appendMessage(m.role === 'assistant' ? 'assistant' : 'user', m.content);

    async function sendTurn(content) {
      if (busy) return;
      busy = true;
      sendBtn.disabled = true;
      inputEl.disabled = true;

      if (content !== null) {
        appendMessage('user', content);
        history.push({ role: 'user', content });
        saveHistory(niche, history);
      }
      setTyping(true);

      let data;
      try {
        const r = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            niche_slug: niche,
            history,
            start: history.length === 0,
            page_url: location.href,
          }),
        });
        data = await r.json();
      } catch (err) {
        setTyping(false);
        appendMessage('assistant',
          'Sorry — connection hiccup. Try the form below instead and we\'ll still reach you.');
        busy = false;
        sendBtn.disabled = false;
        inputEl.disabled = false;
        return;
      }
      setTyping(false);

      if (data.error) {
        appendMessage('assistant',
          'Sorry — something went wrong on my end. The form below works as a backup.');
        console.error('[aria-chat] server error:', data);
        busy = false;
        sendBtn.disabled = false;
        inputEl.disabled = false;
        return;
      }

      const reply = data.reply || '(no reply)';
      appendMessage('assistant', reply);
      history.push({ role: 'assistant', content: reply });
      saveHistory(niche, history);
      updateProgress(data.extracted);

      // Stage handling
      if (data.stage === 'complete' && data.lead_id) {
        // Lead filed — show success state, hide form (safe DOM only)
        successEl.replaceChildren(
          el('div', { class: 'aria-success-icon', text: '✓' }),
          el('div', { class: 'aria-success-title',
            text: 'You\'re matched — we\'ll be in touch within 24 hours.' }),
          el('div', { class: 'aria-success-sub',
            text: 'Reference: ' + data.lead_id + (data.tier ? ' (tier ' + data.tier + ')' : '') })
        );
        successEl.style.display = 'block';
        inputRow.style.display = 'none';
        progressEl.style.display = 'none';

        // Hide the static form panel — Aria captured the lead, no need to duplicate
        const staticForm = document.querySelector('.lead-form');
        if (staticForm) staticForm.style.display = 'none';

        // Clear local history so a fresh visit starts over
        clearHistory(niche);
      } else if (data.stage === 'stopped') {
        successEl.replaceChildren(
          el('div', { class: 'aria-success-title',
            text: 'No problem — we won\'t contact you. Take care.' })
        );
        successEl.style.display = 'block';
        inputRow.style.display = 'none';
      }

      busy = false;
      sendBtn.disabled = false;
      inputEl.disabled = false;
      if (inputRow.style.display !== 'none') inputEl.focus();
    }

    sendBtn.addEventListener('click', () => {
      const text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = '';
      sendTurn(text);
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendBtn.click(); }
    });

    updateProgress(null);
    // Trigger Aria's opening message
    sendTurn(null);
  }

  function init() {
    const hosts = document.querySelectorAll('[id="aria-chat"], .aria-chat-mount');
    hosts.forEach(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
