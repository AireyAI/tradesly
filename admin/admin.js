/* Tradesly admin dashboard — vanilla JS, no innerHTML.
 * Uses createElement + textContent for XSS-safe rendering.
 */

const fmtTs = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const diffMin = (now - d.getTime()) / 60000;
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return Math.floor(diffMin) + 'm ago';
  if (diffMin < 60 * 24) return Math.floor(diffMin / 60) + 'h ago';
  return d.toISOString().slice(0, 10);
};

function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.href) node.href = opts.href;
  if (opts.target) node.target = opts.target;
  if (opts.rel) node.rel = opts.rel;
  if (opts.id) node.id = opts.id;
  if (opts.title) node.title = opts.title;
  if (opts.style) node.setAttribute('style', opts.style);
  if (opts.onclick) node.addEventListener('click', opts.onclick);
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
    else node.appendChild(c);
  }
  return node;
}

function nicheTag(name) {
  return el('span', { class: 'niche-tag', text: name || '?' });
}

function tierTag(tier) {
  const t = (tier || 'T1').toLowerCase();
  return el('span', { class: 'tier-tag ' + t, text: tier || 'T1' });
}

function confTag(c) {
  if (c == null) return el('span', { text: '—' });
  const cls = c >= 0.7 ? 'high' : c >= 0.5 ? 'med' : 'low';
  return el('span', { class: 'conf ' + cls, text: c.toFixed(2) });
}

function emptyState(text) {
  return el('div', { class: 'empty', text });
}

function clear(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
  return container;
}

async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(url + ' returned ' + res.status);
  return res.json();
}

async function loadSummary() {
  try {
    const s = await fetchJson('/admin/api/summary');
    const t = s.totals;

    document.getElementById('stat-leads-today').textContent = t.leads_today;
    document.getElementById('stat-leads-week').textContent = t.leads_week;
    document.getElementById('stat-buyers').textContent = t.buyers_pending;
    document.getElementById('stat-buyers-active').textContent = t.buyers_active != null ? t.buyers_active : '—';
    document.getElementById('stat-signals').textContent = t.signals_today;
    document.getElementById('stat-proposals').textContent = t.reply_proposals;
    document.getElementById('stat-pitches').textContent = t.buyer_pitch_proposals;
    document.getElementById('stat-invoice-proposals').textContent = t.invoice_proposals || 0;
    document.getElementById('stat-deliveries-today').textContent = t.deliveries_today || 0;
    document.getElementById('stat-deliveries-week').textContent = t.deliveries_week || 0;
    document.getElementById('stat-deliveries-failed').textContent = t.deliveries_failed_today || 0;
    document.getElementById('stat-revenue-week').textContent = '£' + (t.revenue_delivered_week_gbp || 0);
    document.getElementById('stat-revenue-drafts').textContent = (t.revenue_drafted_open_gbp || 0);

    // Signals-by-niche breakdown
    const breakdown = document.getElementById('niche-breakdown');
    clear(breakdown);
    const nicheKeys = Object.keys(s.signals_today_by_niche || {});
    if (nicheKeys.length > 0) {
      nicheKeys
        .sort((a, b) => s.signals_today_by_niche[b] - s.signals_today_by_niche[a])
        .forEach(k => {
          const item = el('span', { class: 'item' },
            k + ' ',
            el('strong', { text: s.signals_today_by_niche[k] }),
          );
          breakdown.appendChild(item);
        });
      document.getElementById('niche-breakdown-section').style.display = '';
    }

    // Lead pipeline state breakdown
    const statusBreakdown = document.getElementById('lead-status-breakdown');
    clear(statusBreakdown);
    const statusKeys = Object.keys(s.leads_by_status || {});
    if (statusKeys.length > 0) {
      const order = ['captured', 'qualified', 'routed', 'delivered', 'disputed', 'stopped'];
      statusKeys
        .sort((a, b) => {
          const ai = order.indexOf(a); const bi = order.indexOf(b);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        })
        .forEach(k => {
          const item = el('span', { class: 'item' },
            k + ' ',
            el('strong', { text: s.leads_by_status[k] }),
          );
          statusBreakdown.appendChild(item);
        });
      document.getElementById('lead-status-section').style.display = '';
    }

    document.getElementById('last-updated').textContent = 'Updated ' + fmtTs(s.ts);
  } catch (e) {
    document.getElementById('last-updated').textContent = 'Error: ' + e.message;
  }
}

async function loadLeads() {
  const container = document.getElementById('leads-table');
  clear(container);
  try {
    const leads = await fetchJson('/admin/api/leads?limit=50');
    document.getElementById('leads-count').textContent = leads.length + ' shown';

    if (leads.length === 0) {
      container.appendChild(emptyState("No leads yet. They'll appear here once a real homeowner submits a form."));
      return;
    }

    const table = el('table');
    const thead = el('thead');
    const headerRow = el('tr');
    ['Created', 'Niche', 'Postcode', 'Email', 'Phone', 'Tier', 'Status', 'Problem'].forEach(h => {
      headerRow.appendChild(el('th', { text: h }));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    leads.forEach(l => {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'mono', text: fmtTs(l.created) }));

      const nicheTd = el('td');
      nicheTd.appendChild(nicheTag(l.niche_slug));
      tr.appendChild(nicheTd);

      tr.appendChild(el('td', { class: 'mono', text: l.postcode || '—' }));
      tr.appendChild(el('td', { text: l.email || '' }));
      tr.appendChild(el('td', { class: 'mono', text: l.phone || '—' }));

      const tierTd = el('td');
      tierTd.appendChild(tierTag(l.current_tier));
      tr.appendChild(tierTd);

      tr.appendChild(el('td', { class: 'mono', text: l.status || '—' }));

      const problem = (l.problem || '').slice(0, 200) + ((l.problem || '').length > 200 ? '…' : '');
      tr.appendChild(el('td', { class: 'problem-snippet', text: problem }));

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  } catch (e) {
    container.appendChild(emptyState('Failed to load: ' + e.message));
  }
}

async function loadBuyers() {
  const container = document.getElementById('buyers-table');
  clear(container);
  try {
    const buyers = await fetchJson('/admin/api/buyers-pending');
    document.getElementById('buyers-count').textContent = buyers.length + ' pending';

    if (buyers.length === 0) {
      container.appendChild(emptyState('No pending buyer applications.'));
      return;
    }

    const table = el('table');
    const thead = el('thead');
    const headerRow = el('tr');
    ['Submitted', 'Business', 'Contact', 'Niches', 'Postcodes', 'Cap', 'Tiers'].forEach(h => {
      headerRow.appendChild(el('th', { text: h }));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    buyers.forEach(b => {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'mono', text: fmtTs(b.submitted) }));

      const bizTd = el('td');
      bizTd.appendChild(el('strong', { text: b.business_name || '—' }));
      bizTd.appendChild(el('br'));
      bizTd.appendChild(el('span', { class: 'mono', style: 'color:var(--color-text-muted)', text: b.contact_name || '' }));
      tr.appendChild(bizTd);

      const contactTd = el('td');
      contactTd.appendChild(document.createTextNode(b.contact_email || ''));
      contactTd.appendChild(el('br'));
      contactTd.appendChild(el('span', { class: 'mono', style: 'color:var(--color-text-muted)', text: b.phone || '' }));
      tr.appendChild(contactTd);

      const nichesTd = el('td');
      (b.niches || []).forEach((n, i) => {
        if (i > 0) nichesTd.appendChild(document.createTextNode(' '));
        nichesTd.appendChild(nicheTag(n));
      });
      tr.appendChild(nichesTd);

      const pcsTd = el('td', { class: 'mono' });
      pcsTd.appendChild(document.createTextNode(`${b.postcodes_count || 0} postcodes`));
      pcsTd.appendChild(el('br'));
      const sample = (b.postcodes_sample || []).join(', ');
      const sampleText = sample.length > 60 ? sample.slice(0, 60) + '…' : sample;
      pcsTd.appendChild(el('span', { style: 'color:var(--color-text-subtle)', text: sampleText }));
      tr.appendChild(pcsTd);

      tr.appendChild(el('td', { class: 'mono', text: (b.daily_lead_cap || 0) + '/day' }));

      const tiersTd = el('td');
      (b.tier_acceptance || []).forEach((t, i) => {
        if (i > 0) tiersTd.appendChild(document.createTextNode(' '));
        tiersTd.appendChild(tierTag(t));
      });
      tr.appendChild(tiersTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  } catch (e) {
    container.appendChild(emptyState('Failed to load: ' + e.message));
  }
}

async function loadBuyersActive() {
  const container = document.getElementById('buyers-active-table');
  clear(container);
  try {
    const buyers = await fetchJson('/admin/api/buyers-active');
    document.getElementById('buyers-active-count').textContent = buyers.length + ' active';

    if (buyers.length === 0) {
      const empty = emptyState('');
      empty.appendChild(document.createTextNode('No active buyers yet. Approve pending applications with '));
      empty.appendChild(el('code', { text: 'python3 ~/jarvis/agents/ppl_office/verify_buyer.py' }));
      empty.appendChild(document.createTextNode('.'));
      container.appendChild(empty);
      return;
    }

    const table = el('table');
    const thead = el('thead');
    const headerRow = el('tr');
    ['Onboarded', 'Business', 'Contact', 'Niches', 'Postcodes', 'Cap', 'Tiers'].forEach(h => {
      headerRow.appendChild(el('th', { text: h }));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    buyers.forEach(b => {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'mono', text: fmtTs(b.onboarded) }));

      const bizTd = el('td');
      bizTd.appendChild(el('strong', { text: b.business_name || '—' }));
      bizTd.appendChild(el('br'));
      bizTd.appendChild(el('span', { class: 'mono', style: 'color:var(--color-text-muted)', text: b.id }));
      tr.appendChild(bizTd);

      const contactTd = el('td');
      contactTd.appendChild(document.createTextNode(b.contact_email || ''));
      contactTd.appendChild(el('br'));
      contactTd.appendChild(el('span', { class: 'mono', style: 'color:var(--color-text-muted)', text: b.phone || '' }));
      tr.appendChild(contactTd);

      const nichesTd = el('td');
      (b.niches || []).forEach((n, i) => {
        if (i > 0) nichesTd.appendChild(document.createTextNode(' '));
        nichesTd.appendChild(nicheTag(n));
      });
      tr.appendChild(nichesTd);

      const pcs = b.postcodes_covered || [];
      const pcsTd = el('td', { class: 'mono' });
      pcsTd.appendChild(document.createTextNode(`${pcs.length} postcodes`));
      pcsTd.appendChild(el('br'));
      const sample = pcs.slice(0, 8).join(', ');
      pcsTd.appendChild(el('span', { style: 'color:var(--color-text-subtle)', text: sample + (pcs.length > 8 ? '…' : '') }));
      tr.appendChild(pcsTd);

      tr.appendChild(el('td', { class: 'mono', text: (b.daily_lead_cap || 0) + '/day' }));

      const tiersTd = el('td');
      (b.tier_acceptance || []).forEach((t, i) => {
        if (i > 0) tiersTd.appendChild(document.createTextNode(' '));
        tiersTd.appendChild(tierTag(t));
      });
      tr.appendChild(tiersTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  } catch (e) {
    container.appendChild(emptyState('Failed to load: ' + e.message));
  }
}

async function loadDeliveries() {
  const container = document.getElementById('deliveries-table');
  clear(container);
  try {
    const rows = await fetchJson('/admin/api/deliveries?limit=50');
    document.getElementById('deliveries-count').textContent = rows.length + ' shown';

    if (rows.length === 0) {
      const empty = emptyState('');
      empty.appendChild(document.createTextNode('No deliveries yet. Once a routed lead exists, run '));
      empty.appendChild(el('code', { text: 'python3 ~/jarvis/agents/ppl_office/lead_delivery.py --send' }));
      empty.appendChild(document.createTextNode('.'));
      container.appendChild(empty);
      return;
    }

    const table = el('table');
    const thead = el('thead');
    const headerRow = el('tr');
    ['At', 'Lead', 'Buyer', 'Niche', 'Tier', 'Price', 'Status'].forEach(h => {
      headerRow.appendChild(el('th', { text: h }));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    rows.forEach(d => {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'mono', text: fmtTs(d.at) }));
      tr.appendChild(el('td', { class: 'mono', text: d.lead_id || '—' }));
      tr.appendChild(el('td', { class: 'mono', text: d.buyer_id || '—' }));

      const nicheTd = el('td');
      nicheTd.appendChild(nicheTag(d.niche));
      tr.appendChild(nicheTd);

      const tierTd = el('td');
      tierTd.appendChild(tierTag(d.tier));
      tr.appendChild(tierTd);

      tr.appendChild(el('td', { class: 'mono', text: '£' + (d.price || 0) }));

      const statusTd = el('td', { class: 'mono' });
      if (d.sent_ok === true) {
        statusTd.appendChild(el('span', { class: 'conf high', text: 'sent' }));
      } else if (d.sent_ok === false) {
        const span = el('span', { class: 'conf low', text: 'failed' });
        if (d.error) span.title = d.error;
        statusTd.appendChild(span);
      } else {
        statusTd.appendChild(el('span', { class: 'conf med', text: '?' }));
      }
      tr.appendChild(statusTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  } catch (e) {
    container.appendChild(emptyState('Failed to load: ' + e.message));
  }
}

async function loadInvoices() {
  const container = document.getElementById('invoices-table');
  clear(container);
  try {
    const rows = await fetchJson('/admin/api/invoices?limit=50');
    document.getElementById('invoices-count').textContent = rows.length + ' shown';

    if (rows.length === 0) {
      const empty = emptyState('');
      empty.appendChild(document.createTextNode('No invoices yet. After deliveries land, run '));
      empty.appendChild(el('code', { text: 'python3 ~/jarvis/agents/ppl_office/lead_billing.py --draft' }));
      empty.appendChild(document.createTextNode(' (weekly).'));
      container.appendChild(empty);
      return;
    }

    const table = el('table');
    const thead = el('thead');
    const headerRow = el('tr');
    ['Drafted', 'Invoice', 'Buyer', 'Period', 'Lines', 'Credits', 'Disputes', 'Total', 'Status'].forEach(h => {
      headerRow.appendChild(el('th', { text: h }));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    rows.forEach(i => {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'mono', text: fmtTs(i.drafted_at) }));
      tr.appendChild(el('td', { class: 'mono', text: i.invoice_id || '—' }));

      const buyerTd = el('td');
      buyerTd.appendChild(el('strong', { text: i.business_name || '—' }));
      buyerTd.appendChild(el('br'));
      buyerTd.appendChild(el('span', { class: 'mono', style: 'color:var(--color-text-muted)', text: i.buyer_id || '' }));
      tr.appendChild(buyerTd);

      const periodStart = (i.period_start || '').slice(0, 10);
      const periodEnd = (i.period_end || '').slice(0, 10);
      tr.appendChild(el('td', { class: 'mono', text: periodStart + ' → ' + periodEnd }));
      tr.appendChild(el('td', { class: 'mono', text: String(i.lines_count || 0) }));
      tr.appendChild(el('td', { class: 'mono', text: String(i.credits_applied_in_period || 0) }));
      tr.appendChild(el('td', { class: 'mono', text: String(i.disputes_excluded_in_period || 0) }));
      tr.appendChild(el('td', { class: 'mono', text: '£' + (i.total_gbp || 0) }));

      const statusTd = el('td', { class: 'mono' });
      const status = i.status || 'draft';
      const cls = status === 'draft' ? 'med' : status === 'void' ? 'low' : 'high';
      statusTd.appendChild(el('span', { class: 'conf ' + cls, text: status }));
      tr.appendChild(statusTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  } catch (e) {
    container.appendChild(emptyState('Failed to load: ' + e.message));
  }
}

async function loadSignals() {
  const container = document.getElementById('signals-table');
  clear(container);
  try {
    const signals = await fetchJson('/admin/api/signals?limit=50');
    document.getElementById('signals-count').textContent = signals.length + ' shown';

    if (signals.length === 0) {
      const empty = emptyState('');
      empty.appendChild(document.createTextNode('No signals yet today. Run '));
      empty.appendChild(el('code', { text: '~/jarvis/agents/ppl_office/run_daily.sh' }));
      empty.appendChild(document.createTextNode(' to harvest fresh signals.'));
      container.appendChild(empty);
      return;
    }

    signals.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    const table = el('table');
    const thead = el('thead');
    const headerRow = el('tr');
    ['Niche', 'Source', 'Conf', 'Status', 'Author', 'Snippet'].forEach(h => {
      headerRow.appendChild(el('th', { text: h }));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    signals.slice(0, 50).forEach(s => {
      const tr = el('tr', { class: 'signal-row' });

      const nicheTd = el('td');
      nicheTd.appendChild(nicheTag(s.niche_slug));
      tr.appendChild(nicheTd);

      const sourceTd = el('td', { class: 'mono' });
      if (s.source_url) {
        sourceTd.appendChild(el('a', { href: s.source_url, target: '_blank', rel: 'noopener', text: s.source }));
      } else {
        sourceTd.textContent = s.source || '';
      }
      tr.appendChild(sourceTd);

      const confTd = el('td');
      confTd.appendChild(confTag(s.confidence));
      tr.appendChild(confTd);

      tr.appendChild(el('td', { class: 'mono', text: s.reply_status || '' }));

      const authorTd = el('td', { class: 'mono' });
      authorTd.textContent = s.author || '—';
      if (s.age_h != null) {
        authorTd.appendChild(el('br'));
        authorTd.appendChild(el('span', { style: 'color:var(--color-text-subtle)', text: s.age_h + 'h ago' }));
      }
      tr.appendChild(authorTd);

      tr.appendChild(el('td', { class: 'problem-snippet', text: s.text_snippet || '' }));

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  } catch (e) {
    container.appendChild(emptyState('Failed to load: ' + e.message));
  }
}

async function loadAll() {
  document.getElementById('last-updated').textContent = 'Refreshing...';
  await Promise.all([
    loadSummary(),
    loadLeads(),
    loadBuyers(),
    loadBuyersActive(),
    loadDeliveries(),
    loadInvoices(),
    loadSignals(),
  ]);
}

document.getElementById('refresh-btn').addEventListener('click', loadAll);

loadAll();
setInterval(loadAll, 30000);
