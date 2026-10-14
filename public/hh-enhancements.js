/* HEAVEN & HELL — portal enhancements (additive module).
 *
 * Loaded after the legacy portal script in heaven-hell.html. Every legacy screen and
 * button keeps working; this module wraps a few legacy functions and adds:
 *   Admin  — Command Center: overview, lead inbox, cross-client progress tracker,
 *            diet plan publisher (templates, multi-assign, version history).
 *   Client — check-in form (kg/lbs + date picker), live diet viewer, one-click copy.
 *
 * Live data: each client gets a Firestore doc `clientPortals/{accessCode}` that the
 * admin publishes on every save. Clients read it (live) and append check-ins to it;
 * the admin dashboard absorbs those check-ins into the shared portal database.
 * See firestore.rules for the matching security rules.
 */
(function () {
  'use strict';
  if (window.__hhxLoaded) return;
  window.__hhxLoaded = true;

  const PORTALS = 'clientPortals';
  const KG_PER_LB = 0.45359237;
  const DAY = 864e5;
  // Categorical slots (dark-surface steps), assigned in fixed order.
  const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  const MEALS = ['Waking Up', 'Breakfast', 'Mid-morning', 'Lunch', 'Evening', 'Dinner', 'Before Bed', 'Water', 'Notes'];
  const LEAD_STATUSES = ['New', 'Contacted', 'Converted', 'Not interested'];
  const BUILTIN_TEMPLATES = [
    { id: 'fatloss-nv', name: 'Fat loss · Non-veg (~1600 kcal)', text:
      'Daily targets: ~1600 kcal · 120 g protein · 3 L water\n• Waking Up: Warm water with lemon + 5 soaked almonds\n• Breakfast: 1 whole egg + 3 egg whites omelette, 1 multigrain toast\n• Mid-morning: 1 fruit (apple / guava / orange)\n• Lunch: 150 g grilled chicken + 100 g cooked rice + salad + curd\n• Evening: Green tea + 30 g roasted chana\n• Dinner: 150 g fish or chicken + sautéed vegetables\n• Before Bed: 150 ml warm low-fat turmeric milk\n• Notes: 8–10k steps daily. No sugary drinks or fried snacks.' },
    { id: 'fatloss-veg', name: 'Fat loss · Vegetarian (~1500 kcal)', text:
      'Daily targets: ~1500 kcal · 90 g protein · 3 L water\n• Waking Up: Warm water + 1 tsp soaked chia seeds\n• Breakfast: Moong dal chilla (2) with mint chutney\n• Mid-morning: 1 fruit + 10 peanuts\n• Lunch: 2 phulka + 1 bowl dal + 100 g paneer bhurji + salad\n• Evening: Buttermilk + 1 bowl sprouts chaat\n• Dinner: 100 g tofu/paneer stir-fry + 1 bowl vegetable soup\n• Before Bed: Chamomile tea\n• Notes: Keep oil to 3 tsp per day. Walk after meals.' },
    { id: 'muscle', name: 'Muscle gain (~2600 kcal)', text:
      'Daily targets: ~2600 kcal · 160 g protein · 4 L water\n• Waking Up: Banana + 10 almonds + black coffee\n• Breakfast: 4 egg omelette + 2 toast + 1 glass milk\n• Mid-morning: Greek yogurt + oats (40 g) + honey\n• Lunch: 200 g chicken + 150 g rice + dal + salad\n• Evening (pre-workout): Peanut butter sandwich + fruit\n• Post-workout: 1 scoop whey + banana\n• Dinner: 200 g fish/paneer + 2 roti + vegetables\n• Before Bed: 200 g curd or casein shake\n• Notes: Train 4–5 days/week. Sleep 7–8 hours.' },
    { id: 'maintain', name: 'Maintenance / general fitness', text:
      'Daily targets: ~2000 kcal · 110 g protein · 3 L water\n• Waking Up: Warm water + 5 soaked almonds\n• Breakfast: Poha / upma with peanuts (1 plate) + 2 boiled eggs\n• Mid-morning: 1 seasonal fruit\n• Lunch: 2 roti + 1 cup rice + dal + 150 g chicken/paneer + salad\n• Evening: Tea + roasted makhana (1 bowl)\n• Dinner: Vegetable soup + 150 g grilled protein + vegetables\n• Before Bed: Warm milk (optional)\n• Notes: Stay active — 7–8k steps daily.' },
    { id: 'blank', name: 'Blank structure', text: '• Waking Up: \n• Breakfast: \n• Lunch: \n• Evening: \n• Dinner: ' },
  ];

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
  };

  const S = {
    tab: store.get('hhxTab', 'overview'),
    unit: store.get('hhxUnit', 'kg') === 'lbs' ? 'lbs' : 'kg',
    leads: [], leadsLoaded: false, knownLeadIds: null,
    lead: { q: '', status: 'all', goal: 'all', sort: 'newest' },
    tr: { client: 'all', who: 'all', from: '', to: '', q: '', sort: 'date', dir: 'desc', view: 'table' },
    pub: { key: '', text: '', loaded: '', also: [] },
    templates: store.get('hhxTemplates', []),
    unsubLeads: null, unsubPortals: null, unsubClient: null, leadsPoll: null,
    portalDocs: [], absorbing: false, absorbAgain: false, publishedAll: false,
    clientCode: null, clientDoc: null,
  };

  /* ---------- small helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const pad = (n) => String(n).padStart(2, '0');
  const toDMY = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const shortDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const validKey = (k) => typeof k === 'string' && k.length > 0 && k.length < 300 && !k.includes('/') && k !== '.' && k !== '..' && !/^__.*__$/.test(k);
  const plain = (obj) => JSON.parse(JSON.stringify(obj));
  const fsValue = () => firebase.firestore.FieldValue;

  function parseDate(value) {
    const s = String(value || '').trim();
    let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return null;
  }
  function ago(iso) {
    const t = Date.parse(iso);
    if (!t) return '';
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    const d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }
  const conv = (kg, unit = S.unit) => (unit === 'lbs' ? kg / KG_PER_LB : kg);
  const fmtW = (kg, unit = S.unit) => (kg == null || !Number.isFinite(kg) ? '—' : `${conv(kg, unit).toFixed(1)} ${unit}`);
  function fmtDelta(kg, unit = S.unit) {
    if (kg == null || !Number.isFinite(kg)) return '—';
    const v = conv(kg, unit);
    const sign = v > 0.04 ? '+' : v < -0.04 ? '−' : '±';
    return `${sign}${Math.abs(v).toFixed(1)} ${unit}`;
  }
  function phoneDigits(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.length === 10) d = '91' + d; // local Indian mobile numbers
    return d.length >= 11 ? d : '';
  }
  function downloadFile(name, text, type = 'text/plain') {
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function toCSV(rows) {
    return rows.map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
  }
  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('Copy unavailable');
  }
  function toast(message, kind = 'ok') {
    let host = document.getElementById('hhx-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'hhx-toasts';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.className = `hhx-toast hhx-toast--${kind}`;
    t.textContent = message;
    host.appendChild(t);
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 300); }, kind === 'error' || kind === 'warn' ? 6500 : 3400);
  }
  function formatDietHTML(text) {
    const lines = String(text || '').split('\n').filter((l) => l.trim());
    if (!lines.length) return '<p class="hhx-muted">No diet plan yet.</p>';
    return lines.map((line) => {
      const m = line.match(/^\s*[•\-*]?\s*([^:]{1,40}):\s*(.*)$/);
      if (m) return `<div class="hhx-meal"><span class="hhx-meal-name">${esc(m[1].trim())}</span><span class="hhx-meal-value">${esc(m[2]) || '<em class="hhx-muted">—</em>'}</span></div>`;
      return `<p class="hhx-meal-note">${esc(line.replace(/^\s*[•\-*]\s*/, ''))}</p>`;
    }).join('');
  }

  /* ---------- icons + text polish ---------- */
  const ICONS = {
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    left: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  };
  const icon = (name) => `<svg class="hh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const PICTO = /\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\uFE0F|\u200D/gu;
  const RENAME = {
    'Dynamic Client Profile Registry': 'Client profiles', 'Submitted Client Forms History': 'Submitted forms',
    'Save All Dynamic Changes': 'Save all changes', 'Add New Client Profile': 'Add client', 'Customized Meal Plan Strategy': 'Diet plan',
    'Client Display Name': 'Name', 'Access Password': 'Access code', 'Click to View': 'View', 'Click to Hide': 'Hide', 'Delete Form': 'Delete',
  };
  const sentenceCase = (t) => t.toLowerCase().replace(/^(\s*)(\S)/, (m, sp, c) => sp + c.toUpperCase());
  // Strip emoji and SHOUTING from the legacy markup's system text (never from client data or editors).
  function polishText(root) {
    if (!root) return;
    root.querySelectorAll('summary, h4, h5, label, button, [id^="logs-list-"] span, .progress-tracker-content div[style*="max-height"] span, #hh-intake-history > div > div:first-child span').forEach((el) => {
      if (el.closest('.hhx-root, [id^="details-"], textarea')) return;
      const heading = /^(SUMMARY|H4|H5)$/.test(el.tagName);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((n) => {
        let t = n.nodeValue.replace(PICTO, '').replace(/\s+\|\s+/g, ' · ').replace(/\s{2,}/g, ' ');
        if (!n.previousSibling) t = t.replace(/^\s+/, '');
        if (heading && /[A-Z]{3}/.test(t) && t === t.toUpperCase()) t = sentenceCase(t);
        const key = t.trim();
        if (RENAME[key]) t = t.replace(key, RENAME[key]);
        if (t !== n.nodeValue) n.nodeValue = t;
      });
    });
  }

  /* ---------- portal database helpers ---------- */
  const readDb = () => { try { return getDatabase() || {}; } catch { return {}; } };
  const slotOf = (key, rec) => (rec && rec.originalSlot) || key;
  function clientList(d = readDb()) {
    return Object.keys(d).map((key, i) => ({ key, rec: d[key], slot: slotOf(key, d[key]), n: i + 1, name: (d[key] && d[key].name) || 'Unnamed client' }));
  }
  function findBySlot(d, slot) {
    for (const k in d) if (slotOf(k, d[k]) === slot) return { key: k, rec: d[k] };
    return null;
  }
  function sortedLogs(rec) {
    return (rec && rec.progress ? rec.progress : [])
      .map((l, idx) => ({ ...l, idx, d: parseDate(l.date), kg: Number(l.weight) }))
      .filter((l) => Number.isFinite(l.kg) && l.kg > 0)
      .sort((a, b) => ((a.d ? a.d.getTime() : 0) - (b.d ? b.d.getTime() : 0)) || String(a.enteredAt || '').localeCompare(String(b.enteredAt || '')));
  }
  function mergeCheckins(rec, list) {
    rec.progress = rec.progress || [];
    const ids = new Set(rec.progress.map((p) => p && p.id).filter(Boolean));
    let added = 0;
    for (const c of list || []) {
      if (!c || !c.id || ids.has(c.id) || !Number.isFinite(Number(c.weight))) continue;
      rec.progress.push({
        date: c.date, weight: Number(c.weight), waist: c.waist === '' || c.waist == null ? '' : Number(c.waist),
        unit: c.unit || 'kg', note: c.note || '', enteredBy: 'Client', enteredAt: c.enteredAt || new Date().toISOString(), id: c.id,
      });
      ids.add(c.id);
      added++;
    }
    return added;
  }
  function effectiveTarget(data) {
    const clientNewer = data.clientTargetAt && (!data.targetSetAt || data.clientTargetAt > data.targetSetAt) && Number(data.clientTargetWeight) > 0;
    return clientNewer ? Number(data.clientTargetWeight) : (data.targetWeight || null);
  }
  function hasUnsavedCardEdits() {
    const d = readDb();
    for (const c of clientList(d)) {
      const name = document.getElementById('edit-name-' + c.slot);
      const pwd = document.getElementById('edit-pwd-' + c.slot);
      const diet = document.getElementById('edit-diet-' + c.slot);
      if ((name && name.value.trim() !== (c.rec.name || '').trim()) || (pwd && pwd.value.trim() !== c.key) || (diet && diet.value !== (c.rec.diet || ''))) return true;
    }
    return false;
  }

  /* ---------- save pipeline: keep extra fields, stamp diet versions, publish client docs ---------- */
  const CARRY = ['targetWeight', 'targetSetAt', 'dietUpdatedAt', 'dietHistory', 'createdAt', 'email', 'phone', 'goal', 'leadId', 'accessEmailSentAt', 'accessEmailTo'];
  function enrich(next, prior) {
    const now = new Date().toISOString();
    for (const k in next) {
      const rec = next[k];
      if (!rec || typeof rec !== 'object') continue;
      const before = findBySlot(prior, slotOf(k, rec));
      if (!before) {
        rec.createdAt = rec.createdAt || now;
        rec.dietUpdatedAt = rec.dietUpdatedAt || now;
        continue;
      }
      // The legacy "Save All" rebuilds records with only name/diet/progress — keep everything else.
      for (const f of CARRY) if (rec[f] === undefined && before.rec[f] !== undefined) rec[f] = before.rec[f];
      if ((before.rec.diet || '') !== (rec.diet || '')) {
        const history = before.rec.diet ? [{ diet: before.rec.diet, at: before.rec.dietUpdatedAt || null }] : [];
        rec.dietHistory = [...history, ...(rec.dietHistory || [])].slice(0, 10);
        rec.dietUpdatedAt = now;
      }
      if (rec.targetWeight != null && rec.targetWeight !== before.rec.targetWeight) rec.targetSetAt = now;
    }
  }
  function portalPayload(key, rec) {
    return plain({
      name: rec.name || 'Client', diet: rec.diet || '', slot: slotOf(key, rec),
      dietUpdatedAt: rec.dietUpdatedAt || null, targetWeight: rec.targetWeight || null, targetSetAt: rec.targetSetAt || null,
      progress: (rec.progress || []).map((p) => ({
        date: p.date ?? '', weight: p.weight ?? '', waist: p.waist ?? '', enteredBy: p.enteredBy || '',
        enteredAt: p.enteredAt || '', id: p.id || '', note: p.note || '', unit: p.unit || '',
      })),
    });
  }
  async function carryPendingCheckins(next, prior) {
    // An access code was renamed: move check-ins waiting on the old doc to the record before it is deleted.
    for (const k in prior) {
      if (next[k] || !validKey(k)) continue;
      const moved = findBySlot(next, slotOf(k, prior[k]));
      if (!moved) continue;
      try {
        const snap = await hhFirestore.collection(PORTALS).doc(k).get();
        if (snap.exists) mergeCheckins(moved.rec, snap.data().checkins || []);
      } catch (e) { console.warn('Could not read pending check-ins for renamed code', e); }
    }
  }
  async function publishPortals(next, prior, all) {
    if (!hhIsAdmin()) return;
    const col = hhFirestore.collection(PORTALS);
    const ops = [];
    for (const k in next) {
      if (!validKey(k) || !next[k]) continue;
      const payload = portalPayload(k, next[k]);
      const before = prior && prior[k];
      if (!all && before && JSON.stringify(portalPayload(k, before)) === JSON.stringify(payload)) continue;
      ops.push((b) => b.set(col.doc(k), { ...payload, updatedAt: fsValue().serverTimestamp() }, { merge: true }));
    }
    for (const k in (prior || {})) {
      if (!next[k] && validKey(k)) ops.push((b) => b.delete(col.doc(k)));
    }
    for (let i = 0; i < ops.length; i += 400) {
      const batch = hhFirestore.batch();
      ops.slice(i, i + 400).forEach((op) => op(batch));
      await batch.commit();
    }
  }

  const legacySync = window.hhQueueDatabaseSync;
  window.hhQueueDatabaseSync = async function (database) {
    const prior = store.get('heavenHellDatabase', {}) || {};
    enrich(database, prior);
    if (hhIsAdmin()) await carryPendingCheckins(database, prior);
    const result = await legacySync(database);
    try {
      await publishPortals(database, prior, !S.publishedAll);
      S.publishedAll = true;
    } catch (e) {
      console.error('Client portal publish failed:', e);
      toast('Saved. Clients\' live view could not be refreshed — publish the rules in firestore.rules (clientPortals).', 'warn');
    }
    refreshAdminPanel();
    return result;
  };

  /* ---------- legacy function wrappers ---------- */
  const legacyCheck = window.checkPassword;
  window.checkPassword = async function () {
    const email = (($('#admin-email') || {}).value || '').trim();
    let code = (($('#client-pwd') || {}).value || '').trim();
    // Client IDs are case-insensitive for people typing them: "hh4k7p2q" → "HH-4K7P2Q".
    if (!email && APPLICANT_ID.test(code)) { code = formatApplicantId(code); $('#client-pwd').value = code; }
    const loginSection = $('#login-section:not(.hidden)');
    // Test logins switch the page into the sandbox (see hh-testmode.js).
    const T = window.hhTestMode;
    let testCoach = false;
    if (T && loginSection) {
      const isTestClient = loginSection.dataset.mode === 'client' && code.toLowerCase() === T.credentials.clientCode;
      testCoach = loginSection.dataset.mode === 'coach' && email.toLowerCase() === T.credentials.coachLogin;
      if (!T.active && (isTestClient || testCoach)) {
        if (testCoach && code !== T.credentials.coachPassword) {
          const err = $('#login-error');
          if (err) { err.textContent = 'Email or password is incorrect.'; err.style.display = 'block'; }
          return;
        }
        T.enter({ mode: testCoach ? 'coach' : 'client', code: testCoach ? '' : T.credentials.clientCode });
        return;
      }
    }
    if (loginSection && loginSection.dataset.mode === 'coach' && !email) {
      const err = $('#login-error');
      if (err) { err.textContent = 'Enter your coach email and password.'; err.style.display = 'block'; }
      $('#admin-email')?.focus();
      return;
    }
    if (loginSection && loginSection.dataset.mode === 'client' && !code) {
      const err = $('#login-error');
      if (err) { err.textContent = 'Enter your access code.'; err.style.display = 'block'; }
      $('#client-pwd')?.focus();
      return;
    }
    const loginBtn = $('#login-section:not(.hidden) > button');
    if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = 'Signing in…'; }
    let result;
    try {
      if (!email && code) await hydrateClient(code);
      // Show the legacy "invalid code" alert as an inline error on the login card instead.
      const nativeAlert = window.alert;
      if (loginSection) {
        window.alert = (message) => {
          if (/invalid access password/i.test(String(message))) {
            const err = $('#login-error');
            if (err) { err.textContent = "That access code wasn't recognised. Check it and try again, or message your coach."; err.style.display = 'block'; }
            $('#client-pwd')?.select();
          } else nativeAlert.call(window, message);
        };
      }
      // The sandbox coach signs in as the portal's admin account.
      const emailField = $('#admin-email');
      if (testCoach && emailField) emailField.value = HH_ADMIN_EMAIL;
      try { result = await legacyCheck.apply(this, arguments); } finally {
        window.alert = nativeAlert;
        if (testCoach && emailField) emailField.value = email;
      }
    } finally {
      if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = loginBtn.dataset.label || 'Unlock Dashboard'; }
    }
    const section = $('#diet-section');
    const visible = section && !section.classList.contains('hidden');
    const adminView = $('#admin-container-view');
    const dietContent = $('#diet-content');
    if (visible && adminView && adminView.innerHTML.trim() && hhIsAdmin()) {
      store.set('hhCoachEmail', email);
      mountAdmin();
    } else if (visible && !email && code && dietContent && !dietContent.classList.contains('hidden') && dietContent.innerHTML.trim()) {
      const remember = document.getElementById('hh-remember');
      if (remember && remember.checked) store.set('hhClientCode', code);
      else if (remember) { try { localStorage.removeItem('hhClientCode'); } catch { /* storage unavailable */ } }
      mountClient(code);
    }
    return result;
  };

  const legacyAddLog = window.addManualLog;
  window.addManualLog = async function (activeKey, slotId, isClientMode = false) {
    if (!isClientMode || hhIsAdmin()) return legacyAddLog.apply(this, arguments);
    // Clients cannot write the shared admin database; their entries go in as live check-ins instead.
    const val = (id) => ((document.getElementById(id) || {}).value || '').trim();
    const d = parseDate(val('client-manual-date-' + slotId));
    if (!d) { alert('Please enter the date as DD/MM/YYYY.'); return; }
    const ok = await submitCheckin({ date: d, weight: val('client-manual-weight-' + slotId), unit: 'kg', waist: val('client-manual-waist-' + slotId), note: '' });
    if (ok) ['client-manual-weight-', 'client-manual-waist-'].forEach((p) => { const el = document.getElementById(p + slotId); if (el) el.value = ''; });
  };

  const legacySaveTarget = window.saveTargetWeight;
  window.saveTargetWeight = async function (activeKey, slotId, isClientMode = false) {
    if (!isClientMode || hhIsAdmin()) return legacySaveTarget.apply(this, arguments);
    const el = document.getElementById('client-target-weight-' + slotId);
    const tw = Number(el ? el.value : '');
    if (!Number.isFinite(tw) || tw < 20 || tw > 400) { alert('Enter a valid target weight in kg.'); return; }
    try {
      await hhFirestore.collection(PORTALS).doc(activeKey).update({ clientTargetWeight: tw, clientTargetAt: new Date().toISOString() });
      toast('Target saved — your coach can see it.');
    } catch (e) {
      console.error('Client target save failed:', e);
      toast(portalErrorMessage(e), 'error');
    }
  };

  ['editLog', 'deleteLog'].forEach((fn) => {
    const legacy = window[fn];
    window[fn] = function () {
      if (!hhIsAdmin() && S.clientCode) { alert('Only your coach can change saved entries. Message your coach if something needs fixing.'); return; }
      return legacy.apply(this, arguments);
    };
  });

  const legacyCopy = window.copyDietPlan;
  window.copyDietPlan = async function () {
    if (!S.clientCode || hhIsAdmin()) return legacyCopy.apply(this, arguments);
    const rec = readDb()[S.clientCode];
    if (!rec || !rec.diet || !rec.diet.trim()) { alert('Diet plan content is empty.'); return; }
    const btn = document.getElementById('hhx-copy-plan') || document.getElementById('copy-diet-btn');
    try {
      await copyText(dietPlainText(rec));
      if (btn && !btn.classList.contains('is-done')) { const old = btn.innerHTML; btn.innerHTML = icon('check') + 'Copied'; btn.classList.add('is-done'); setTimeout(() => { btn.innerHTML = old; btn.classList.remove('is-done'); }, 1800); }
      toast('Full diet plan copied to your clipboard.');
    } catch {
      alert('Copy was blocked by the browser. Please select the diet text and copy it manually.');
    }
  };

  function portalErrorMessage(e) {
    const code = e && e.code ? e.code : '';
    if (code === 'not-found') return 'Your online check-ins are not active yet — ask your coach to open the admin dashboard once.';
    if (code === 'permission-denied') return 'Check-in was blocked by the database rules. Please tell your coach.';
    if (code === 'unavailable' || !navigator.onLine) return 'You appear to be offline. Connect to the internet and try again.';
    return 'Could not save right now. Please try again.';
  }

  /* =====================================================================
   * CLIENT PORTAL
   * ===================================================================== */
  function applyPortalDoc(code, data) {
    const d = readDb();
    const rec = { ...(d[code] || {}) };
    rec.name = data.name || rec.name || 'Client';
    rec.diet = data.diet || '';
    rec.originalSlot = data.slot || rec.originalSlot || code;
    rec.progress = Array.isArray(data.progress) ? data.progress.slice() : (rec.progress || []);
    mergeCheckins(rec, data.checkins || []);
    rec.targetWeight = effectiveTarget(data);
    rec.dietUpdatedAt = data.dietUpdatedAt || null;
    d[code] = rec;
    localStorage.setItem('heavenHellDatabase', JSON.stringify(d));
    S.clientDoc = data;
    return rec;
  }
  async function hydrateClient(code) {
    if (!validKey(code)) return;
    try {
      const snap = await hhFirestore.collection(PORTALS).doc(code).get();
      if (snap.exists) applyPortalDoc(code, snap.data());
    } catch (e) {
      console.warn('Live client data unavailable; using this device\'s copy.', e);
    }
  }
  function dietPlainText(rec) {
    const updated = rec.dietUpdatedAt ? ` (updated ${toDMY(new Date(rec.dietUpdatedAt))})` : '';
    return `HEAVEN & HELL — Diet plan for ${rec.name}${updated}\n\n${String(rec.diet || '').trim()}\n\n— Coach Kavi`;
  }

  function mountClient(code) {
    stopAdmin();
    S.clientCode = code;
    const host = $('#diet-content');
    const rec = readDb()[code];
    if (!host || !rec) return;
    const dietBox = host.firstElementChild;
    if (!dietBox) return;
    host.querySelectorAll('.hhx-client-block').forEach((el) => el.remove());

    const stats = document.createElement('section');
    stats.className = 'hhx-root hhx-client-block';
    stats.id = 'hhx-client-stats';
    host.insertBefore(stats, dietBox);

    // Enhance the legacy diet card in place: live badge, last-updated stamp, extra actions.
    dietBox.classList.add('hhx-diet-live');
    const legacyText = dietBox.querySelector('p');
    if (legacyText) {
      const dietText = document.createElement('div');
      dietText.id = 'hhx-diet-text';
      legacyText.replaceWith(dietText);
    }
    const heading = dietBox.querySelector('h4');
    const meta = document.createElement('div');
    meta.className = 'hhx-root hhx-client-block hhx-diet-meta';
    meta.innerHTML = `<span class="hhx-diet-status"><span class="hhx-live" title="This plan updates automatically when your coach publishes changes"><i></i>Live</span>
      <span id="hhx-diet-updated" class="hhx-muted"></span><span id="hhx-diet-new" class="hhx-pill hhx-pill--new" hidden>New</span></span>
      <span class="hhx-diet-actions">
        <button type="button" class="hhx-btn hhx-btn--primary hhx-btn--sm" id="hhx-copy-plan" data-hhx="client-copy">${icon('copy')}Copy plan</button>
        <button type="button" class="hhx-btn hhx-btn--ghost hhx-btn--sm hhx-btn--icon" data-hhx="client-download" title="Download as text" aria-label="Download as text">${icon('download')}</button>
        <button type="button" class="hhx-btn hhx-btn--ghost hhx-btn--sm hhx-btn--icon" data-hhx="client-share" title="Share" aria-label="Share">${icon('share')}</button>
        <button type="button" class="hhx-btn hhx-btn--ghost hhx-btn--sm hhx-btn--icon" data-hhx="client-print" title="Print" aria-label="Print">${icon('print')}</button>
      </span>`;
    if (heading) { heading.textContent = 'Your diet plan'; heading.after(meta); } else dietBox.prepend(meta);
    host.querySelector('.progress-tracker-details')?.parentElement.classList.add('hh-tracker-card');
    polishText(host);

    const checkin = document.createElement('section');
    checkin.className = 'hhx-root hhx-client-block hhx-card';
    checkin.id = 'hhx-checkin';
    dietBox.after(checkin);
    renderCheckinForm();

    if (!$('#hhx-client-signout')) {
      const out = document.createElement('button');
      out.type = 'button';
      out.id = 'hhx-client-signout';
      out.className = 'hhx-root';
      out.innerHTML = icon('logout') + 'Sign out';
      out.dataset.hhx = 'client-signout';
      const welcome = $('#client-welcome');
      if (welcome) welcome.after(out);
    }

    const seenKey = 'hhxSeenDiet:' + code;
    const seen = store.get(seenKey, null);
    S.clientDietIsNew = !!(rec.dietUpdatedAt && seen && seen !== rec.dietUpdatedAt);
    store.set(seenKey, rec.dietUpdatedAt || null);
    renderClientLive(rec);
    watchClient(code);
  }

  function renderClientLive(rec) {
    const dietText = document.getElementById('hhx-diet-text');
    if (dietText && dietText.dataset.diet !== (rec.diet || '')) { dietText.innerHTML = formatDietHTML(rec.diet); dietText.dataset.diet = rec.diet || ''; }
    const updated = document.getElementById('hhx-diet-updated');
    if (updated) updated.textContent = rec.dietUpdatedAt ? `Updated ${ago(rec.dietUpdatedAt)} · ${toDMY(new Date(rec.dietUpdatedAt))}` : '';
    const badge = document.getElementById('hhx-diet-new');
    if (badge) badge.hidden = !S.clientDietIsNew;
    renderClientStats(rec);
    const slot = slotOf(S.clientCode, rec);
    if (document.getElementById('progress-graph-' + slot)) renderProgressGraph(rec.progress || [], 'progress-graph-' + slot, rec.targetWeight || null);
  }

  function renderClientStats(rec) {
    const host = document.getElementById('hhx-client-stats');
    if (!host) return;
    const logs = sortedLogs(rec);
    const first = logs[0];
    const last = logs[logs.length - 1];
    const target = Number(rec.targetWeight) || null;
    const change = first && last ? last.kg - first.kg : null;
    const toGo = last && target ? last.kg - target : null;
    let pct = null;
    if (first && last && target && Math.abs(first.kg - target) > 0.05) pct = Math.max(0, Math.min(1, (first.kg - last.kg) / (first.kg - target)));
    const lastAt = last ? (last.enteredAt || (last.d && last.d.toISOString())) : null;
    const monthCount = logs.filter((l) => l.d && Date.now() - l.d.getTime() < 30 * DAY).length;
    host.innerHTML = `
      <div class="hhx-stats-head">
        <h4>Your progress</h4>
        ${unitToggle()}
      </div>
      <div class="hhx-tiles">
        <div class="hhx-tile"><span class="hhx-tile-label">Current</span><strong>${fmtW(last ? last.kg : null)}</strong><small>${last ? esc(last.date) : 'No check-ins yet'}</small></div>
        <div class="hhx-tile"><span class="hhx-tile-label">Since start</span><strong>${fmtDelta(change)}</strong><small>${first ? 'from ' + fmtW(first.kg) : '—'}</small></div>
        <div class="hhx-tile"><span class="hhx-tile-label">To target</span><strong>${toGo == null ? '—' : fmtW(Math.abs(toGo))}</strong><small>${target ? 'target ' + fmtW(target) : 'Set a target below'}</small></div>
        <div class="hhx-tile"><span class="hhx-tile-label">Check-ins</span><strong>${logs.length}</strong><small>${monthCount} in last 30 days${lastAt ? ' · last ' + ago(lastAt) : ''}</small></div>
      </div>
      ${pct == null ? '' : `<div class="hhx-goalbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct * 100)}" aria-label="Progress to target">
        <div class="hhx-goalbar-track"><div class="hhx-goalbar-fill" style="width:${(pct * 100).toFixed(1)}%"></div></div>
        <span>${Math.round(pct * 100)}% of the way to your target</span></div>`}`;
  }

  function renderCheckinForm() {
    const host = document.getElementById('hhx-checkin');
    if (!host) return;
    const today = toISODate(new Date());
    host.innerHTML = `
      <div class="hhx-card-head"><h4>Log a check-in</h4><p class="hhx-muted">Your coach sees it right away.</p></div>
      <form id="hhx-checkin-form" novalidate>
        <div class="hhx-form-grid">
          <div class="hhx-field">
            <label class="hhx-label" for="hhx-ci-date">Date</label>
            <input id="hhx-ci-date" name="date" type="date" value="${today}" max="${today}" required>
          </div>
          <div class="hhx-field">
            <label class="hhx-label" for="hhx-ci-weight">Weight</label>
            <div class="hhx-input-unit">
              <input id="hhx-ci-weight" name="weight" type="number" step="0.1" min="1" inputmode="decimal" placeholder="${S.unit === 'lbs' ? 'e.g. 165.0' : 'e.g. 75.0'}" required>
              <div class="hhx-seg" role="radiogroup" aria-label="Weight unit">
                <button type="button" role="radio" data-hhx="ci-unit" data-unit="kg" aria-checked="${S.unit === 'kg'}">kg</button>
                <button type="button" role="radio" data-hhx="ci-unit" data-unit="lbs" aria-checked="${S.unit === 'lbs'}">lbs</button>
              </div>
            </div>
          </div>
          <div class="hhx-field">
            <label class="hhx-label" for="hhx-ci-waist">Waist (cm) <em>optional</em></label>
            <input id="hhx-ci-waist" name="waist" type="number" step="0.1" min="1" inputmode="decimal" placeholder="e.g. 88">
          </div>
          <div class="hhx-field hhx-field--wide">
            <label class="hhx-label" for="hhx-ci-note">How are you feeling? <em>optional</em></label>
            <input id="hhx-ci-note" name="note" type="text" maxlength="200" placeholder="Energy, hunger, sleep, cravings…">
          </div>
        </div>
        <p class="hhx-form-msg" id="hhx-ci-msg" role="status"></p>
        <button type="submit" class="hhx-btn hhx-btn--primary hhx-btn--block">Submit check-in</button>
      </form>`;
  }

  async function submitCheckin({ date, weight, unit, waist, note }) {
    const code = S.clientCode;
    const say = (text, kind) => { const msg = document.getElementById('hhx-ci-msg'); if (msg) { msg.textContent = text; msg.dataset.kind = kind; } else if (kind === 'error') alert(text); };
    const w = Number(weight);
    const kg = unit === 'lbs' ? w * KG_PER_LB : w;
    if (!date || date.getTime() > Date.now()) { say('Pick today or an earlier date.', 'error'); return false; }
    if (!Number.isFinite(w) || kg < 20 || kg > 400) { say(`Enter a valid weight in ${unit}.`, 'error'); return false; }
    const waistNum = waist === '' || waist == null ? '' : Number(waist);
    if (waistNum !== '' && (!Number.isFinite(waistNum) || waistNum < 30 || waistNum > 250)) { say('Enter a valid waist in cm, or leave it blank.', 'error'); return false; }
    const rec = readDb()[code];
    const dmy = toDMY(date);
    if (rec && (rec.progress || []).some((p) => p.date === dmy) && !confirm(`You already logged a weight for ${dmy}. Add another entry?`)) return false;
    const entry = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      date: dmy, weight: Math.round(kg * 10) / 10, waist: waistNum, unit, enteredWeight: w,
      note: String(note || '').slice(0, 200), enteredBy: 'Client', enteredAt: new Date().toISOString(),
    };
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { code: 'unavailable' });
      await hhFirestore.collection(PORTALS).doc(code).update({ checkins: fsValue().arrayUnion(entry), lastCheckinAt: entry.enteredAt });
      const d = readDb();
      if (d[code]) { mergeCheckins(d[code], [entry]); localStorage.setItem('heavenHellDatabase', JSON.stringify(d)); }
      // Re-render the whole client view so the legacy log list shows the new entry too.
      await window.checkPassword();
      say(`✓ Saved: ${fmtW(entry.weight)} on ${dmy}. Your coach can see it now.`, 'ok');
      toast('Check-in saved');
      return true;
    } catch (e) {
      console.error('Check-in failed:', e);
      say(portalErrorMessage(e), 'error');
      return false;
    }
  }

  function watchClient(code) {
    stopClientWatch();
    if (!validKey(code)) return;
    let lastDietAt = (readDb()[code] || {}).dietUpdatedAt || null;
    S.unsubClient = hhFirestore.collection(PORTALS).doc(code).onSnapshot((snap) => {
      if (!snap.exists || S.clientCode !== code) return;
      const rec = applyPortalDoc(code, snap.data());
      if (rec.dietUpdatedAt && lastDietAt && rec.dietUpdatedAt !== lastDietAt) {
        S.clientDietIsNew = true;
        toast('Your coach just updated your diet plan.');
        store.set('hhxSeenDiet:' + code, rec.dietUpdatedAt);
      }
      lastDietAt = rec.dietUpdatedAt || lastDietAt;
      const welcome = $('#client-welcome');
      if (welcome) welcome.innerText = 'Welcome back, ' + rec.name;
      renderClientLive(rec);
    }, (e) => console.warn('Live diet updates unavailable:', e));
  }
  function stopClientWatch() {
    if (S.unsubClient) { S.unsubClient(); S.unsubClient = null; }
  }
  function clientSignOut() {
    stopClientWatch();
    S.clientCode = null;
    $('#hhx-client-signout')?.remove();
    $('#diet-section')?.classList.add('hidden');
    $('#login-section')?.classList.remove('hidden');
    const pwd = $('#client-pwd');
    if (pwd) pwd.value = '';
    const dietContent = $('#diet-content');
    if (dietContent) dietContent.innerHTML = '';
    goLogin('client');
  }
  function printDiet(rec) {
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to print your plan.'); return; }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Diet plan — ${esc(rec.name)}</title>
      <style>body{font-family:system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;color:#111;line-height:1.6}
      h1{font-size:1.4rem;margin:0 0 4px}p.m{color:#555;margin:0 0 20px}.hhx-meal{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #ddd}
      .hhx-meal-name{font-weight:700}.hhx-meal-note{margin:10px 0}</style></head>
      <body><h1>HEAVEN &amp; HELL — Diet plan for ${esc(rec.name)}</h1>
      <p class="m">${rec.dietUpdatedAt ? 'Updated ' + toDMY(new Date(rec.dietUpdatedAt)) + ' · ' : ''}Coach Kavi</p>${formatDietHTML(rec.diet)}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  }

  /* =====================================================================
   * ADMIN COMMAND CENTER
   * ===================================================================== */
  function mountAdmin() {
    stopClientWatch();
    S.clientCode = null;
    $('#hhx-client-signout')?.remove();
    const container = $('#admin-container-view');
    if (!container) return;
    let root = $('#hhx-admin');
    if (!root) {
      root = document.createElement('section');
      root.id = 'hhx-admin';
      root.className = 'hhx-root';
      container.prepend(root);
    }
    const welcome = $('#client-welcome');
    if (welcome) welcome.textContent = 'Coach dashboard';
    const signout = $('#hh-admin-signout');
    if (signout && !signout.querySelector('svg')) signout.innerHTML = icon('logout') + 'Sign out';
    const clientCount = Object.keys(readDb()).length;
    root.innerHTML = `
      <div class="hhx-tabs-row">
        <nav class="hhx-tabs" role="tablist" aria-label="Dashboard sections">
          ${ADMIN_TABS.map(([id, label]) => `
            <button type="button" role="tab" class="hhx-tab" id="hhx-tab-${id}" data-hhx="tab" data-tab="${id}" aria-selected="${S.tab === id}" aria-controls="hhx-panel">
              ${label}${id === 'leads' ? ' <span class="hhx-count" id="hhx-lead-count"></span>' : id === 'clients' ? ` <span class="hhx-count hhx-count--muted">${clientCount}</span>` : ''}</button>`).join('')}
        </nav>
        <div class="hhx-head-tools"><span class="hhx-live" id="hhx-sync-state"><i></i>Live</span>${unitToggle()}</div>
      </div>
      <div id="hhx-panel" role="tabpanel"></div>`;
    // The original client registry and form history become their own tabs.
    const legacyClients = document.createElement('div');
    legacyClients.id = 'hhx-legacy-clients';
    const legacyForms = document.createElement('div');
    legacyForms.id = 'hhx-legacy-forms';
    [...container.children].forEach((node) => {
      if (node === root) return;
      (node.id === 'hh-intake-history' ? legacyForms : legacyClients).append(node);
    });
    container.append(legacyClients, legacyForms);
    polishText(container);
    renderPanel();
    updateLeadCount();
    watchLeads();
    watchPortals();
    loadTemplates();
    if (!S.publishedAll) {
      publishPortals(readDb(), null, true).then(() => { S.publishedAll = true; }).catch((e) => {
        console.error('Initial client portal publish failed:', e);
        toast('Client live portals are not active yet. Publish firestore.rules (clientPortals) in Firebase, then sign in again.', 'warn');
        setSyncState(false);
      });
    }
  }
  function stopAdmin() {
    if (S.unsubLeads) { S.unsubLeads(); S.unsubLeads = null; }
    if (S.unsubPortals) { S.unsubPortals(); S.unsubPortals = null; }
    if (S.leadsPoll) { clearInterval(S.leadsPoll); S.leadsPoll = null; }
    S.publishedAll = false;
    S.knownLeadIds = null;
    $('#hhx-admin')?.remove();
  }
  function setSyncState(ok) {
    const el = document.getElementById('hhx-sync-state');
    if (!el) return;
    el.classList.toggle('is-off', !ok);
    el.lastChild.textContent = ok ? 'Live' : 'Offline';
  }
  function refreshAdminPanel() {
    if (!document.getElementById('hhx-admin')) return;
    // Background updates must not steal focus from a field the coach is typing in.
    const active = document.activeElement;
    if (active && active.closest && active.closest('#hhx-panel') && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
      if (S.tab === 'tracker') renderTrackerResults();
      else if (S.tab === 'leads') renderLeadResults();
      return;
    }
    renderPanel();
  }
  function unitToggle() {
    return `<div class="hhx-seg" role="radiogroup" aria-label="Display unit">
      <button type="button" role="radio" data-hhx="unit" data-unit="kg" aria-checked="${S.unit === 'kg'}">kg</button>
      <button type="button" role="radio" data-hhx="unit" data-unit="lbs" aria-checked="${S.unit === 'lbs'}">lbs</button></div>`;
  }
  const ADMIN_TABS = [['overview', 'Overview'], ['leads', 'Leads'], ['clients', 'Clients'], ['tracker', 'Progress'], ['publisher', 'Diet plans'], ['forms', 'Form archive']];
  function renderPanel() {
    const panel = document.getElementById('hhx-panel');
    if (!panel) return;
    if (!ADMIN_TABS.some(([id]) => id === S.tab)) S.tab = 'overview';
    document.querySelectorAll('#hhx-admin .hhx-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === S.tab)));
    const legacyClients = document.getElementById('hhx-legacy-clients');
    const legacyForms = document.getElementById('hhx-legacy-forms');
    if (legacyClients) legacyClients.hidden = S.tab !== 'clients';
    if (legacyForms) legacyForms.hidden = S.tab !== 'forms';
    panel.hidden = S.tab === 'clients' || S.tab === 'forms';
    if (panel.hidden) { panel.innerHTML = ''; return; }
    if (S.tab === 'leads') renderLeads(panel);
    else if (S.tab === 'tracker') renderTracker(panel);
    else if (S.tab === 'publisher') renderPublisher(panel);
    else renderOverview(panel);
  }

  /* ---------- live listeners ---------- */
  function normalizeLead(id, data) { return { ...data, _id: id }; }
  function watchLeads() {
    if (S.unsubLeads || S.leadsPoll) return;
    const onRecords = (records) => {
      const ids = new Set(records.map((r) => r._id));
      if (S.knownLeadIds) {
        const fresh = records.filter((r) => !S.knownLeadIds.has(r._id));
        fresh.forEach((r) => toast(`New lead: ${r['1_Full_Name'] || 'Unknown'}`));
      }
      S.knownLeadIds = ids;
      S.leads = records;
      S.leadsLoaded = true;
      updateLeadCount();
      if (S.tab === 'leads') renderLeadResults();
      else if (S.tab === 'overview') refreshAdminPanel();
    };
    S.unsubLeads = hhFirestore.collection('clientIntakes').onSnapshot((snap) => {
      const records = [];
      snap.forEach((doc) => records.push(normalizeLead(doc.id, doc.data())));
      onRecords(records);
    }, (e) => {
      console.warn('Live lead updates unavailable, polling instead:', e);
      S.unsubLeads = null;
      const poll = () => hhGetIntakeRecords().then((rs) => onRecords(rs.map((r) => normalizeLead(r._firebaseKey, r)))).catch(() => {});
      poll();
      S.leadsPoll = setInterval(poll, 15000);
    });
  }
  function watchPortals() {
    if (S.unsubPortals) return;
    S.unsubPortals = hhFirestore.collection(PORTALS).onSnapshot((snap) => {
      setSyncState(true);
      S.portalDocs = snap.docs;
      absorbCheckins();
    }, (e) => {
      console.warn('Live check-in updates unavailable:', e);
      S.unsubPortals = null;
      setSyncState(false);
    });
  }
  async function absorbCheckins() {
    if (S.absorbing) { S.absorbAgain = true; return; }
    S.absorbing = true;
    try {
      const d = readDb();
      const clear = [];
      const names = [];
      let added = 0;
      let targetChanged = false;
      for (const doc of S.portalDocs) {
        const data = doc.data();
        const rec = d[doc.id];
        if (!rec) continue;
        const list = Array.isArray(data.checkins) ? data.checkins : [];
        const n = mergeCheckins(rec, list);
        if (n) { added += n; names.push(rec.name); }
        if (data.clientTargetAt && (!rec.targetSetAt || data.clientTargetAt > rec.targetSetAt) && Number(data.clientTargetWeight) > 0
            && Number(data.clientTargetWeight) !== Number(rec.targetWeight)) {
          rec.targetWeight = Number(data.clientTargetWeight);
          targetChanged = true;
        }
        if (list.length) clear.push({ id: doc.id, list });
      }
      if (added || targetChanged) await window.hhQueueDatabaseSync(d);
      if (clear.length) {
        const batch = hhFirestore.batch();
        clear.forEach(({ id, list }) => batch.update(hhFirestore.collection(PORTALS).doc(id), { checkins: fsValue().arrayRemove(...list) }));
        await batch.commit();
      }
      if (added) {
        toast(`${added} new check-in${added === 1 ? '' : 's'} from ${[...new Set(names)].join(', ')}`);
        refreshCardLogs();
      }
    } catch (e) {
      console.error('Syncing client check-ins failed:', e);
    } finally {
      S.absorbing = false;
      if (S.absorbAgain) { S.absorbAgain = false; absorbCheckins(); }
    }
  }
  // Keep the legacy per-client cards (log list + graph) current without a full re-render.
  function refreshCardLogs() {
    const d = readDb();
    for (const c of clientList(d)) {
      const list = document.getElementById('logs-list-' + c.slot);
      if (list) {
        const logs = c.rec.progress || [];
        const k = esc(JSON.stringify(c.key));
        list.innerHTML = logs.length ? logs.map((log, i) => `
          <div style="border-bottom: 1px solid rgba(255,255,255,0.05); padding: 6px 0; color: #34d399; font-weight: 600; display: flex; justify-content: space-between; align-items: center;">
            <span>📅 ${esc(log.date)} | ⚖️ ${esc(log.weight)} kg${log.waist !== '' && log.waist != null ? ` | 📏 ${esc(log.waist)} cm` : ''}<small style="display:block;color:#cbd5e1;font-weight:500">Entered by: ${esc(log.enteredBy || 'Legacy entry')}</small></span>
            <div>
              <button type="button" onclick="editLog(${k}, ${i})" style="background:#eab308; border:none; color:black; padding:2px 6px; border-radius:4px; font-size:0.75rem; cursor:pointer; font-weight:bold;">Edit</button>
              <button type="button" onclick="deleteLog(${k}, ${i})" style="background:#ef4444; border:none; color:white; padding:2px 6px; border-radius:4px; font-size:0.75rem; cursor:pointer; font-weight:bold; margin-left:4px;">Delete</button>
            </div>
          </div>`).join('') : '<span style="color: #94a3b8; font-style: italic;">No progress logged yet.</span>';
      }
      polishText(list);
      if (document.getElementById('admin-progress-graph-' + c.slot)) renderProgressGraph(c.rec.progress || [], 'admin-progress-graph-' + c.slot, c.rec.targetWeight || null);
    }
  }

  /* ---------- tracker rows (shared by overview + tracker) ---------- */
  function trackerRows() {
    const rows = [];
    for (const c of clientList()) {
      let prev = null;
      for (const l of sortedLogs(c.rec)) {
        rows.push({
          key: c.key, slot: c.slot, name: c.name, n: c.n, idx: l.idx, d: l.d, date: l.date, kg: l.kg,
          waist: l.waist === '' || l.waist == null ? null : Number(l.waist), by: l.enteredBy || 'Legacy entry',
          note: l.note || '', enteredAt: l.enteredAt || '', change: prev ? l.kg - prev.kg : null,
        });
        prev = l;
      }
    }
    return rows;
  }
  const rowTime = (r) => (r.d ? r.d.getTime() : (Date.parse(r.enteredAt) || 0));

  /* ---------- Overview ---------- */
  // True when the plan is empty or only has meal labels with nothing after them.
  const isBlankDiet = (diet) => String(diet || '').split('\n').every((l) => !l.trim() || /^\s*[•\-*]?\s*[^:]{1,40}:\s*$/.test(l));
  const leadStatusOf = (lead) => lead.leadStatus || store.get('hhxLeadStatus', {})[lead._id] || 'New';
  function renderOverview(panel) {
    const now = Date.now();
    const clients = clientList();
    const rows = trackerRows();
    const recent = rows.slice().sort((a, b) => (Date.parse(b.enteredAt) || rowTime(b)) - (Date.parse(a.enteredAt) || rowTime(a))).slice(0, 6);
    const checkins7 = rows.filter((r) => now - (Date.parse(r.enteredAt) || rowTime(r)) < 7 * DAY).length;
    const leads7 = S.leads.filter((l) => now - Date.parse(l.submittedAt) < 7 * DAY).length;
    const newLeads = S.leads.filter((l) => leadStatusOf(l) === 'New').length;
    const changes = clients.map((c) => sortedLogs(c.rec)).filter((l) => l.length >= 2).map((l) => l[l.length - 1].kg - l[0].kg);
    const avgChange = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null;
    const attention = [];
    for (const c of clients) {
      const logs = sortedLogs(c.rec);
      const last = logs[logs.length - 1];
      const days = last && last.d ? Math.floor((now - last.d.getTime()) / DAY) : null;
      if (!last) attention.push({ c, why: 'No check-ins yet' });
      else if (days >= 7) attention.push({ c, why: `Last check-in ${days} days ago` });
      if (isBlankDiet(c.rec.diet)) attention.push({ c, why: 'Diet plan not written yet', diet: true });
    }
    panel.innerHTML = `
      <div class="hhx-tiles hhx-tiles--4">
        <div class="hhx-tile"><span class="hhx-tile-label">Active clients</span><strong>${clients.length}</strong><small>${clients.filter((c) => sortedLogs(c.rec).length).length} with check-ins</small></div>
        <div class="hhx-tile"><span class="hhx-tile-label">New leads</span><strong>${S.leadsLoaded ? newLeads : '…'}</strong><small>${S.leadsLoaded ? `${leads7} this week · ${S.leads.length} total` : 'Loading…'}</small></div>
        <div class="hhx-tile"><span class="hhx-tile-label">Check-ins · 7 days</span><strong>${checkins7}</strong><small>${rows.length} logged in total</small></div>
        <div class="hhx-tile"><span class="hhx-tile-label">Avg change / client</span><strong>${fmtDelta(avgChange)}</strong><small>${changes.length} client${changes.length === 1 ? '' : 's'} with 2+ logs</small></div>
      </div>
      <div class="hhx-split">
        <section class="hhx-card">
          <div class="hhx-card-head"><h4>Recent check-ins</h4><button type="button" class="hhx-link" data-hhx="tab" data-tab="tracker">Open tracker →</button></div>
          ${recent.length ? `<ul class="hhx-list">${recent.map((r) => `
            <li><span class="hhx-avatar">${esc((r.name || '?').charAt(0).toUpperCase())}</span>
              <span class="hhx-list-main"><strong>${esc(r.name)}</strong><small>${esc(r.date)} · ${esc(r.by)}${r.note ? ' · “' + esc(r.note) + '”' : ''}</small></span>
              <span class="hhx-list-num">${fmtW(r.kg)}<small class="${r.change < 0 ? 'is-down' : r.change > 0 ? 'is-up' : ''}">${r.change == null ? 'first entry' : fmtDelta(r.change)}</small></span></li>`).join('')}</ul>`
            : '<p class="hhx-empty">No check-ins yet. When clients log their weight it appears here instantly.</p>'}
        </section>
        <section class="hhx-card">
          <div class="hhx-card-head"><h4>Needs attention</h4></div>
          ${attention.length ? `<ul class="hhx-list">${attention.slice(0, 8).map(({ c, why, diet }) => `
            <li><span class="hhx-avatar">${esc(c.name.charAt(0).toUpperCase())}</span>
              <span class="hhx-list-main"><strong>${esc(c.name)}</strong><small>${esc(why)}</small></span>
              ${diet ? `<button type="button" class="hhx-btn hhx-btn--ghost hhx-btn--sm" data-hhx="open-publisher" data-key="${esc(c.key)}">Write plan</button>`
                : c.rec.phone && phoneDigits(c.rec.phone) ? `<a class="hhx-btn hhx-btn--ghost hhx-btn--sm" target="_blank" rel="noopener" href="https://wa.me/${phoneDigits(c.rec.phone)}?text=${encodeURIComponent(`Hi ${c.name}, quick reminder to log your weight check-in on the Heaven & Hell portal.`)}">Remind</a>` : ''}</li>`).join('')}</ul>`
            : '<p class="hhx-empty">All clients are on track.</p>'}
        </section>
      </div>`;
  }

  /* ---------- Leads ---------- */
  function updateLeadCount() {
    const el = document.getElementById('hhx-lead-count');
    if (!el) return;
    const n = S.leads.filter((l) => leadStatusOf(l) === 'New').length;
    el.textContent = n ? String(n) : '';
    el.hidden = !n;
  }
  const leadEmail = (l) => l['5_Gmail_ID'] || l.email || '';
  const leadNotes = (l) => [l['53_Additional_Info'], l['54_Top_3_Goals'], l['52_Trainer_Expectations'], l.notes].filter((v) => v && String(v).trim()).join(' · ');
  function renderLeads(panel) {
    const goals = [...new Set(S.leads.map((l) => l['44_Primary_Goal']).filter(Boolean))].sort();
    panel.innerHTML = `
      <div class="hhx-toolbar">
        <input type="search" class="hhx-grow" placeholder="Search name, phone, email, notes…" value="${esc(S.lead.q)}" data-hhx-input="lead-q" aria-label="Search leads">
        <select data-hhx-input="lead-status" aria-label="Filter by status">
          <option value="all">All statuses</option>${LEAD_STATUSES.map((s) => `<option ${S.lead.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select data-hhx-input="lead-goal" aria-label="Filter by goal">
          <option value="all">All goals</option>${goals.map((g) => `<option ${S.lead.goal === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
        </select>
        <select data-hhx-input="lead-sort" aria-label="Sort leads">
          <option value="newest" ${S.lead.sort === 'newest' ? 'selected' : ''}>Newest first</option>
          <option value="oldest" ${S.lead.sort === 'oldest' ? 'selected' : ''}>Oldest first</option>
          <option value="name" ${S.lead.sort === 'name' ? 'selected' : ''}>Name A–Z</option>
        </select>
        <button type="button" class="hhx-btn hhx-btn--ghost" data-hhx="lead-export">${icon('download')}Export CSV</button>
      </div>
      <div id="hhx-lead-results"></div>`;
    renderLeadResults();
  }
  function filteredLeads() {
    const q = S.lead.q.toLowerCase();
    let list = S.leads.filter((l) => {
      if (S.lead.status !== 'all' && leadStatusOf(l) !== S.lead.status) return false;
      if (S.lead.goal !== 'all' && l['44_Primary_Goal'] !== S.lead.goal) return false;
      if (!q) return true;
      return [l.applicantId, l['1_Full_Name'], l['4_Phone_Number'], leadEmail(l), leadNotes(l), l['45_Specific_Goal'], l['7_Current_Location']].join(' ').toLowerCase().includes(q);
    });
    list = list.slice().sort((a, b) => {
      if (S.lead.sort === 'name') return String(a['1_Full_Name'] || '').localeCompare(String(b['1_Full_Name'] || ''));
      const diff = (Date.parse(b.submittedAt) || 0) - (Date.parse(a.submittedAt) || 0);
      return S.lead.sort === 'oldest' ? -diff : diff;
    });
    return list;
  }
  function renderLeadResults() {
    const host = document.getElementById('hhx-lead-results');
    if (!host) return;
    if (!S.leadsLoaded) { host.innerHTML = '<p class="hhx-empty">Loading submissions…</p>'; return; }
    const list = filteredLeads();
    if (!list.length) {
      host.innerHTML = `<p class="hhx-empty">${S.leads.length ? 'No leads match these filters.' : 'No form submissions yet. New ones appear here the moment they are sent.'}</p>`;
      return;
    }
    host.innerHTML = `<p class="hhx-result-meta">${list.length} of ${S.leads.length} submission${S.leads.length === 1 ? '' : 's'}</p>` + list.map((l) => {
      const status = leadStatusOf(l);
      const phone = l['4_Phone_Number'] || '';
      const wa = phoneDigits(phone);
      const email = leadEmail(l);
      const notes = leadNotes(l);
      const goal = [l['44_Primary_Goal'], l['45_Specific_Goal']].filter(Boolean).join(' — ');
      const at = l.submittedAt ? new Date(l.submittedAt) : null;
      const details = Object.keys(l).filter((k) => !k.startsWith('_') && !['leadStatus', 'leadStatusAt'].includes(k)).map((k) =>
        `<div><dt>${esc(k.replace(/^\d+_/, '').replace(/_/g, ' '))}</dt><dd>${esc(l[k] || '—')}</dd></div>`).join('');
      return `<article class="hhx-lead" data-status="${esc(status)}">
        <div class="hhx-lead-main">
          <div class="hhx-lead-title"><strong>${esc(l['1_Full_Name'] || 'Unknown')}</strong>${l.applicantId ? `<code class="hhx-id">${esc(l.applicantId)}</code>` : ''}<span class="hhx-pill hhx-pill--${esc(status.toLowerCase().replace(/\s+/g, '-'))}">${esc(status)}</span></div>
          <div class="hhx-lead-contact">
            ${phone ? `<a href="tel:${esc(phone)}">${icon('phone')}${esc(phone)}</a>` : ''}
            ${email ? `<a href="mailto:${esc(email)}">${icon('mail')}${esc(email)}</a>` : ''}
            ${l['7_Current_Location'] ? `<span>${icon('pin')}${esc(l['7_Current_Location'])}</span>` : ''}
          </div>
          ${goal ? `<p class="hhx-lead-goal"><span class="hhx-muted">Goal</span> ${esc(goal)}${l['46_Goal_Timeline'] ? ` <span class="hhx-muted">· ${esc(l['46_Goal_Timeline'])}</span>` : ''}</p>` : ''}
          ${notes ? `<p class="hhx-lead-notes">${esc(notes)}</p>` : ''}
        </div>
        <div class="hhx-lead-side">
          <time datetime="${esc(l.submittedAt || '')}">${at ? `${ago(l.submittedAt)}<small>${toDMY(at)}</small>` : '—'}</time>
          <select data-hhx-input="lead-set-status" data-id="${esc(l._id)}" aria-label="Lead status">${LEAD_STATUSES.map((s) => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <div class="hhx-lead-actions">
            ${wa ? `<a class="hhx-btn hhx-btn--ghost hhx-btn--sm" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(`Hi ${l['1_Full_Name'] || ''}, this is Coach Kavi from Heaven & Hell Fitness. Thanks for filling in the form!`)}">WhatsApp</a>` : ''}
            <button type="button" class="hhx-btn hhx-btn--ghost hhx-btn--sm" data-hhx="lead-toggle" aria-expanded="false">Details</button>
            ${status === 'Converted' ? '' : `<button type="button" class="hhx-btn hhx-btn--primary hhx-btn--sm" data-hhx="lead-convert" data-id="${esc(l._id)}">Make client</button>`}
          </div>
        </div>
        <dl class="hhx-lead-details" hidden>${details}</dl>
      </article>`;
    }).join('');
  }
  async function setLeadStatus(id, status) {
    const local = store.get('hhxLeadStatus', {});
    local[id] = status;
    store.set('hhxLeadStatus', local);
    const lead = S.leads.find((l) => l._id === id);
    if (lead) lead.leadStatus = status;
    updateLeadCount();
    try {
      await hhFirestore.collection('clientIntakes').doc(id).update({ leadStatus: status, leadStatusAt: new Date().toISOString() });
    } catch (e) {
      console.warn('Lead status kept on this device only:', e);
      toast('Status saved on this device only. Publish firestore.rules to share it across devices.', 'warn');
    }
  }
  function exportLeads() {
    const list = filteredLeads();
    if (!list.length) { toast('No leads to export.', 'warn'); return; }
    const head = ['Client ID', 'Name', 'Phone', 'Email', 'Location', 'Primary goal', 'Specific goal', 'Timeline', 'Notes', 'Status', 'Submitted'];
    const rows = list.map((l) => [l.applicantId || '', l['1_Full_Name'], l['4_Phone_Number'], leadEmail(l), l['7_Current_Location'], l['44_Primary_Goal'], l['45_Specific_Goal'], l['46_Goal_Timeline'], leadNotes(l), leadStatusOf(l), l.submittedAt]);
    downloadFile(`heaven-hell-leads-${toISODate(new Date())}.csv`, toCSV([head, ...rows]), 'text/csv');
  }
  function templateForGoal(goal) {
    const g = String(goal || '').toLowerCase();
    if (g.includes('fat')) return BUILTIN_TEMPLATES[0].text;
    if (g.includes('muscle') || g.includes('strength')) return BUILTIN_TEMPLATES[2].text;
    return BUILTIN_TEMPLATES[3].text;
  }
  async function convertLead(id) {
    const lead = S.leads.find((l) => l._id === id);
    if (!lead) return;
    if (hasUnsavedCardEdits() && !confirm('You have unsaved edits in the client cards below. Adding a client reloads the dashboard and those edits will be lost. Continue?')) return;
    const name = String(lead['1_Full_Name'] || 'New client').trim();
    const d = readDb();
    const base = (name.split(/\s+/)[0] || 'client').toLowerCase().replace(/[^a-z]/g, '') || 'client';
    // Their client ID (received after applying) doubles as their login, so they only ever need one code.
    let suggestion = lead.applicantId && !d[lead.applicantId] ? lead.applicantId : '';
    if (!suggestion) do suggestion = base + Math.floor(1000 + Math.random() * 9000); while (d[suggestion]);
    const code = (prompt(`Access code for ${name}.\nThey will use this to log in to the client portal${suggestion === lead.applicantId ? ' (this is the client ID they received after applying)' : ''}:`, suggestion) || '').trim();
    if (!code) return;
    if (!validKey(code)) { alert('Access codes cannot contain "/" and must not be empty.'); return; }
    if (d[code]) { alert('That access code is already used by another client.'); return; }
    const used = new Set(Object.keys(d).flatMap((k) => [k, slotOf(k, d[k])]));
    let i = Object.keys(d).length + 1;
    while (used.has('fitclient' + i)) i++;
    const startKg = Number(lead['9_Weight']);
    const at = lead.submittedAt ? new Date(lead.submittedAt) : new Date();
    d[code] = {
      name, diet: templateForGoal(lead['44_Primary_Goal']), originalSlot: 'fitclient' + i,
      progress: startKg >= 20 && startKg <= 400 ? [{ date: toDMY(at), weight: startKg, waist: Number(lead['10_Waist_cm']) || '', enteredBy: 'Intake form', enteredAt: at.toISOString(), id: 'intake-' + id }] : [],
      phone: lead['4_Phone_Number'] || '', email: leadEmail(lead), goal: lead['44_Primary_Goal'] || '', leadId: id,
    };
    try {
      await window.hhQueueDatabaseSync(d);
      await setLeadStatus(id, 'Converted');
      toast(`${name} added as a client (code: ${code}). Review their starter plan.`);
      await deliverAccessCode(code);
      S.tab = 'publisher';
      store.set('hhxTab', S.tab);
      S.pub = { key: code, text: d[code].diet, loaded: d[code].diet, also: [] };
      await window.checkPassword();
    } catch (e) {
      console.error('Lead conversion failed:', e);
      alert('The client could not be saved to the shared database.');
    }
  }

  /* ---------- access code emails ---------- */
  const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
  // Sends the client their access code through /api/sendAccessCode (coach-only, fixed template).
  async function emailAccessCode(key) {
    const d = readDb();
    const rec = d[key];
    if (!rec) throw new Error('Client not found.');
    const to = String(rec.email || '').trim();
    if (!EMAIL_RE.test(to)) throw Object.assign(new Error('No valid email address on file for this client.'), { code: 'no-email' });
    if (window.hhTestMode && window.hhTestMode.active) {
      await new Promise((r) => setTimeout(r, 300));
    } else {
      const user = hhAuth.currentUser;
      if (!user || !hhIsAdmin()) throw new Error('Sign in as the coach to send emails.');
      const token = await user.getIdToken();
      let resp;
      try {
        resp = await fetch('/api/sendAccessCode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ to, name: rec.name || 'there', code: key }),
        });
      } catch {
        throw new Error('Could not reach the email service. Check your connection.');
      }
      if (!resp.ok) {
        const info = await resp.json().catch(() => ({}));
        if (resp.status === 404) throw new Error('The email service is only available on the deployed site.');
        throw new Error(info.error || `Email service error (${resp.status}).`);
      }
    }
    rec.accessEmailSentAt = new Date().toISOString();
    rec.accessEmailTo = to;
    await window.hhQueueDatabaseSync(d);
    return to;
  }
  // Emails the code and reports the outcome; never blocks client creation.
  async function deliverAccessCode(key) {
    const rec = readDb()[key] || {};
    try {
      const to = await emailAccessCode(key);
      const test = window.hhTestMode && window.hhTestMode.active;
      toast(test ? `Test mode: access code email to ${to} simulated (not actually sent).` : `Access code emailed to ${to}.`);
      return true;
    } catch (e) {
      console.warn('Access code email not sent:', e);
      toast(e.code === 'no-email'
        ? `No email address for ${rec.name || 'this client'}. Add one in Diet plans → Client login, or share the code on WhatsApp.`
        : `Access code not emailed: ${e.message}`, 'warn');
      return false;
    }
  }

  // "Add client" opens a proper form (name, email, phone, code) instead of a blank placeholder profile.
  function openNewClientDialog() {
    if (hasUnsavedCardEdits() && !confirm('You have unsaved edits in the client cards. Adding a client reloads the dashboard and those edits will be lost. Continue?')) return;
    let dialog = document.getElementById('hh-new-client');
    if (!dialog) {
      dialog = html(`<dialog id="hh-new-client" class="hh-dialog" aria-labelledby="hh-new-client-title">
        <form method="dialog" class="hh-dialog-body" novalidate>
          <header><h3 id="hh-new-client-title">Add client</h3><p>Creates their portal and emails them the access code.</p></header>
          <div class="hh-dialog-grid">
            <div class="hh-field-wide"><label for="hh-nc-name">Full name</label><input id="hh-nc-name" name="ncName" required maxlength="80" autocomplete="off"></div>
            <div><label for="hh-nc-email">Email</label><input id="hh-nc-email" name="email" type="email" maxlength="254" placeholder="client@example.com" autocomplete="off"></div>
            <div><label for="hh-nc-phone">Phone <span class="hh-optional">optional</span></label><input id="hh-nc-phone" name="phone" type="tel" maxlength="20" autocomplete="off"></div>
            <div class="hh-field-wide"><label for="hh-nc-code">Access code</label>
              <div class="hh-inline-input"><input id="hh-nc-code" name="code" maxlength="64" autocomplete="off" spellcheck="false"><button type="button" class="hh-btn--ghost" data-nc="regen">New code</button></div></div>
          </div>
          <label class="hh-check-inline hh-nc-send"><input type="checkbox" name="send" checked> Email the access code to the client now</label>
          <p class="hh-step-error" role="alert" hidden></p>
          <footer><button type="button" class="hh-btn--ghost" data-nc="cancel">Cancel</button><button type="submit" class="hh-btn">Create client</button></footer>
        </form></dialog>`);
      document.body.append(dialog);
      const form = dialog.querySelector('form');
      dialog.querySelector('[data-nc="cancel"]').addEventListener('click', () => dialog.close());
      dialog.querySelector('[data-nc="regen"]').addEventListener('click', () => { form.code.value = newApplicantId(); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = form.querySelector('.hh-step-error');
        const name = form.ncName.value.trim();
        const email = form.email.value.trim();
        const code = form.code.value.trim();
        const d = readDb();
        const problem = !name ? 'Enter the client\'s name.'
          : email && !EMAIL_RE.test(email) ? 'That email address doesn\'t look right.'
          : form.send.checked && !email ? 'Add an email address, or untick "Email the access code".'
          : !validKey(code) ? 'Access codes cannot be empty or contain "/".'
          : d[code] ? 'That access code is already used by another client.' : '';
        err.hidden = !problem;
        err.textContent = problem;
        if (problem) return;
        const submit = form.querySelector('[type=submit]');
        submit.disabled = true;
        submit.textContent = 'Creating…';
        const used = new Set(Object.keys(d).flatMap((k) => [k, slotOf(k, d[k])]));
        let i = Object.keys(d).length + 1;
        while (used.has('fitclient' + i)) i++;
        d[code] = { name, diet: BUILTIN_TEMPLATES.find((t) => t.id === 'blank').text, originalSlot: 'fitclient' + i, progress: [], email, phone: form.phone.value.trim() };
        try {
          await window.hhQueueDatabaseSync(d);
          dialog.close();
          toast(`${name} added as a client (code: ${code}).`);
          if (form.send.checked) await deliverAccessCode(code);
          S.tab = 'publisher';
          store.set('hhxTab', S.tab);
          S.pub = { key: code, text: d[code].diet, loaded: d[code].diet, also: [] };
          await window.checkPassword();
        } catch (e2) {
          console.error('Add client failed:', e2);
          err.textContent = 'The client could not be saved. Check your connection and try again.';
          err.hidden = false;
        } finally {
          submit.disabled = false;
          submit.textContent = 'Create client';
        }
      });
    }
    const form = dialog.querySelector('form');
    form.reset();
    form.code.value = newApplicantId();
    form.querySelector('.hh-step-error').hidden = true;
    dialog.showModal();
    form.ncName.focus();
  }
  window.addNewClientSlot = openNewClientDialog;

  /* ---------- Progress tracker ---------- */
  function renderTracker(panel) {
    const clients = clientList();
    const t = S.tr;
    if (t.client !== 'all' && !clients.some((c) => c.key === t.client)) t.client = 'all';
    panel.innerHTML = `
      <div class="hhx-toolbar">
        <select data-hhx-input="tr-client" aria-label="Client">
          <option value="all">All clients</option>${clients.map((c) => `<option value="${esc(c.key)}" ${t.client === c.key ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        <select data-hhx-input="tr-who" aria-label="Entered by">
          <option value="all">Anyone</option>
          ${['Client', 'Admin', 'Intake form'].map((w) => `<option value="${w}" ${t.who === w ? 'selected' : ''}>${w === 'Admin' ? 'Coach (admin)' : w === 'Client' ? 'Client check-ins' : w}</option>`).join('')}
        </select>
        <label class="hhx-inline"><span>From</span><input type="date" value="${esc(t.from)}" data-hhx-input="tr-from"></label>
        <label class="hhx-inline"><span>To</span><input type="date" value="${esc(t.to)}" data-hhx-input="tr-to"></label>
        <div class="hhx-chips" role="group" aria-label="Quick range">
          ${[['7', '7d'], ['30', '30d'], ['90', '90d'], ['all', 'All']].map(([v, l]) => `<button type="button" class="hhx-chip" data-hhx="tr-range" data-range="${v}">${l}</button>`).join('')}
        </div>
        <input type="search" class="hhx-grow" placeholder="Search client or note…" value="${esc(t.q)}" data-hhx-input="tr-q" aria-label="Search entries">
        <div class="hhx-seg" role="radiogroup" aria-label="View">
          <button type="button" role="radio" data-hhx="tr-view" data-view="table" aria-checked="${t.view === 'table'}">Table</button>
          <button type="button" role="radio" data-hhx="tr-view" data-view="chart" aria-checked="${t.view === 'chart'}">Chart</button>
        </div>
        <button type="button" class="hhx-btn hhx-btn--ghost" data-hhx="tr-export">${icon('download')}CSV</button>
      </div>
      <div id="hhx-tr-results"></div>`;
    renderTrackerResults();
  }
  function filteredRows() {
    const t = S.tr;
    const from = t.from ? parseDate(t.from) : null;
    const to = t.to ? parseDate(t.to) : null;
    const q = t.q.toLowerCase();
    return trackerRows().filter((r) => {
      if (t.client !== 'all' && r.key !== t.client) return false;
      if (t.who !== 'all' && r.by !== t.who) return false;
      if (from && (!r.d || r.d < from)) return false;
      if (to && (!r.d || r.d > to)) return false;
      if (q && !`${r.name} ${r.note}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }
  function renderTrackerResults() {
    const host = document.getElementById('hhx-tr-results');
    if (!host) return;
    const rows = filteredRows();
    const t = S.tr;
    const dir = t.dir === 'asc' ? 1 : -1;
    const cmp = {
      date: (a, b) => rowTime(a) - rowTime(b),
      client: (a, b) => a.name.localeCompare(b.name) || rowTime(a) - rowTime(b),
      weight: (a, b) => a.kg - b.kg,
      change: (a, b) => (a.change ?? -Infinity) - (b.change ?? -Infinity),
      waist: (a, b) => (a.waist ?? -Infinity) - (b.waist ?? -Infinity),
      by: (a, b) => a.by.localeCompare(b.by),
    }[t.sort] || ((a, b) => rowTime(a) - rowTime(b));
    rows.sort((a, b) => dir * cmp(a, b));
    const clientsIn = new Set(rows.map((r) => r.key)).size;
    const avg = rows.length ? rows.reduce((s, r) => s + r.kg, 0) / rows.length : null;
    const meta = `<p class="hhx-result-meta">${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} · ${clientsIn} client${clientsIn === 1 ? '' : 's'}${avg ? ` · average ${fmtW(avg)}` : ''}</p>`;
    if (!rows.length) { host.innerHTML = meta + '<p class="hhx-empty">No check-ins match these filters.</p>'; return; }
    if (t.view === 'chart') { host.innerHTML = meta + '<div id="hhx-tr-chart"></div>'; renderTrackerChart(rows); return; }
    const th = (key, label, num) => {
      const active = t.sort === key;
      return `<th scope="col" aria-sort="${active ? (t.dir === 'asc' ? 'ascending' : 'descending') : 'none'}" class="${num ? 'is-num' : ''}">
        <button type="button" data-hhx="tr-sort" data-sort="${key}">${label}<span aria-hidden="true">${active ? (t.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span></button></th>`;
    };
    host.innerHTML = meta + `<div class="hhx-table-wrap"><table class="hhx-table">
      <thead><tr>${th('date', 'Date')}${th('client', 'Client')}${th('weight', 'Weight', true)}${th('change', 'Change', true)}${th('waist', 'Waist', true)}${th('by', 'Entered by')}<th scope="col">Note</th><th scope="col"><span class="hhx-sr">Actions</span></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r.date)}</td>
        <td><strong>${esc(r.name)}</strong></td>
        <td class="is-num">${fmtW(r.kg)}</td>
        <td class="is-num ${r.change < 0 ? 'is-down' : r.change > 0 ? 'is-up' : ''}">${r.change == null ? '<span class="hhx-muted">start</span>' : fmtDelta(r.change)}</td>
        <td class="is-num">${r.waist == null ? '—' : r.waist + ' cm'}</td>
        <td><span class="hhx-pill hhx-pill--${r.by === 'Client' ? 'client' : 'coach'}">${esc(r.by === 'Admin' ? 'Coach' : r.by)}</span></td>
        <td class="hhx-note-cell">${esc(r.note)}</td>
        <td class="hhx-row-actions">
          <button type="button" class="hhx-btn hhx-btn--ghost hhx-btn--xs" data-hhx="tr-edit" data-key="${esc(r.key)}" data-idx="${r.idx}">Edit</button>
          <button type="button" class="hhx-btn hhx-btn--danger hhx-btn--xs" data-hhx="tr-delete" data-key="${esc(r.key)}" data-idx="${r.idx}">Delete</button>
        </td></tr>`).join('')}</tbody></table></div>`;
  }
  function exportTracker() {
    const rows = filteredRows().sort((a, b) => a.name.localeCompare(b.name) || rowTime(a) - rowTime(b));
    if (!rows.length) { toast('Nothing to export.', 'warn'); return; }
    const head = ['Client', 'Access code', 'Date', 'Weight (kg)', 'Weight (lbs)', 'Change (kg)', 'Waist (cm)', 'Entered by', 'Note', 'Entered at'];
    downloadFile(`heaven-hell-progress-${toISODate(new Date())}.csv`, toCSV([head, ...rows.map((r) => [
      r.name, r.key, r.date, r.kg.toFixed(1), (r.kg / KG_PER_LB).toFixed(1), r.change == null ? '' : r.change.toFixed(1), r.waist ?? '', r.by, r.note, r.enteredAt])]), 'text/csv');
  }

  function renderTrackerChart(rows) {
    const host = document.getElementById('hhx-tr-chart');
    if (!host) return;
    const dated = rows.filter((r) => r.d);
    if (S.tr.client !== 'all') {
      // Single client: reuse the portal's own weight/waist graph.
      const rec = readDb()[S.tr.client] || {};
      const logs = dated.slice().sort((a, b) => rowTime(a) - rowTime(b)).map((r) => ({ date: toDMY(r.d), weight: r.kg, waist: r.waist ?? '' }));
      renderProgressGraph(logs, 'hhx-tr-chart', rec.targetWeight || null);
      return;
    }
    // All clients: one line per client, indexed to each client's first entry so different body weights share one axis.
    const all = clientList();
    const byClient = new Map();
    dated.forEach((r) => { if (!byClient.has(r.key)) byClient.set(r.key, []); byClient.get(r.key).push(r); });
    let series = [...byClient.entries()].map(([key, list]) => {
      list.sort((a, b) => rowTime(a) - rowTime(b));
      const base = list[0].kg;
      return { key, name: list[0].name, order: all.findIndex((c) => c.key === key), last: rowTime(list[list.length - 1]), pts: list.map((r) => ({ t: rowTime(r), v: conv(r.kg - base), r })) };
    });
    const hidden = Math.max(0, series.length - SERIES.length);
    series = series.sort((a, b) => b.last - a.last).slice(0, SERIES.length).sort((a, b) => a.order - b.order);
    series.forEach((s, i) => { s.color = SERIES[all.length <= SERIES.length ? s.order : i]; });

    const W = 760, H = 320, L = 56, R = series.length <= 4 ? 128 : 24, T = 18, B = 38;
    const ts = series.flatMap((s) => s.pts.map((p) => p.t));
    const vs = series.flatMap((s) => s.pts.map((p) => p.v)).concat(0);
    let t0 = Math.min(...ts), t1 = Math.max(...ts);
    if (t1 - t0 < 4 * DAY) { const mid = (t0 + t1) / 2; t0 = mid - 2 * DAY; t1 = mid + 2 * DAY; }
    let v0 = Math.min(...vs), v1 = Math.max(...vs);
    const span = (v1 - v0) || 2;
    v0 -= span * 0.12; v1 += span * 0.12;
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - (v - v0) / (v1 - v0)) * (H - T - B);
    const step = niceStep((v1 - v0) / 5);
    const yTicks = [];
    for (let v = Math.ceil(v0 / step) * step; v <= v1; v += step) yTicks.push(Math.round(v * 100) / 100);
    // Whole-day ticks so labels never repeat or skip a date.
    const dayStep = Math.max(1, Math.ceil((t1 - t0) / DAY / 6));
    const xTicks = [];
    for (let t = new Date(t0).setHours(0, 0, 0, 0) + DAY; t <= t1; t += dayStep * DAY) xTicks.push(t);
    const unit = S.unit;
    const grid = yTicks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'hhx-zero' : 'hhx-grid'}"/>
      <text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="hhx-axis">${v > 0 ? '+' : ''}${v}</text>`).join('');
    const xAxis = xTicks.map((t) => `<text x="${x(t)}" y="${H - 12}" text-anchor="middle" class="hhx-axis">${shortDate(new Date(t))}</text>`).join('');
    const lines = series.map((s, si) => `
      <polyline points="${s.pts.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${s.pts.map((p, pi) => `<circle cx="${x(p.t)}" cy="${y(p.v)}" r="4" fill="${s.color}" stroke="#0d1320" stroke-width="2"/>
        <circle cx="${x(p.t)}" cy="${y(p.v)}" r="11" fill="transparent" class="hhx-hit" data-s="${si}" data-p="${pi}"/>`).join('')}`).join('');
    let labels = '';
    if (series.length <= 4) {
      const placed = series.map((s) => ({ s, y: y(s.pts[s.pts.length - 1].v) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < placed.length; i++) if (placed[i].y - placed[i - 1].y < 15) placed[i].y = placed[i - 1].y + 15;
      labels = placed.map(({ s, y: ly }) => `<circle cx="${W - R + 12}" cy="${ly}" r="4" fill="${s.color}"/>
        <text x="${W - R + 20}" y="${ly + 4}" class="hhx-dlabel">${esc(s.name.length > 13 ? s.name.slice(0, 12) + '…' : s.name)}</text>`).join('');
    }
    host.innerHTML = `
      <div class="hhx-chart">
        <div class="hhx-chart-head">
          <div><strong>Weight change since first entry (${unit})</strong><small>Each line starts at 0 on that client's first check-in in this range. Pick one client to see their actual weight.</small></div>
          ${series.length > 1 ? `<ul class="hhx-legend">${series.map((s) => `<li><i style="background:${s.color}"></i>${esc(s.name)}</li>`).join('')}</ul>` : ''}
        </div>
        <div class="hhx-chart-plot">
          <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight change since first entry for ${series.length} clients">${grid}${xAxis}${lines}${labels}</svg>
          <div class="hhx-tip" hidden></div>
        </div>
        ${hidden ? `<p class="hhx-muted hhx-chart-note">Showing the ${SERIES.length} most recently active clients. ${hidden} more are in the table; filter by client to see them.</p>` : ''}
      </div>`;
    const plot = host.querySelector('.hhx-chart-plot');
    const tip = host.querySelector('.hhx-tip');
    plot.addEventListener('mouseover', (e) => {
      const hit = e.target.closest('.hhx-hit');
      if (!hit) return;
      const s = series[+hit.dataset.s];
      const p = s.pts[+hit.dataset.p];
      tip.innerHTML = `<span><i style="background:${s.color}"></i><strong>${esc(s.name)}</strong></span><span>${esc(p.r.date)} · ${fmtW(p.r.kg)}</span><span class="hhx-muted">${fmtDelta(p.r.kg - s.pts[0].r.kg)} since first entry</span>`;
      tip.hidden = false;
      const box = plot.getBoundingClientRect();
      const hb = hit.getBoundingClientRect();
      const left = Math.min(box.width - tip.offsetWidth - 4, Math.max(4, hb.left - box.left + hb.width / 2 - tip.offsetWidth / 2));
      tip.style.left = left + 'px';
      tip.style.top = Math.max(4, hb.top - box.top - tip.offsetHeight - 6) + 'px';
    });
    plot.addEventListener('mouseleave', () => { tip.hidden = true; });
  }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  /* ---------- Diet publisher ---------- */
  async function loadTemplates() {
    try {
      const snap = await hhFirestore.collection('portalData').doc('dietTemplates').get();
      if (snap.exists && Array.isArray(snap.data().items)) {
        S.templates = snap.data().items;
        store.set('hhxTemplates', S.templates);
        if (S.tab === 'publisher') refreshAdminPanel();
      }
    } catch (e) { console.warn('Shared diet templates unavailable; using this device\'s list.', e); }
  }
  async function saveTemplates() {
    store.set('hhxTemplates', S.templates);
    try {
      await hhFirestore.collection('portalData').doc('dietTemplates').set({ items: S.templates, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    } catch (e) {
      console.warn('Template saved on this device only:', e);
      toast('Template saved on this device only.', 'warn');
    }
  }
  const allTemplates = () => [...S.templates.map((t) => ({ ...t, custom: true })), ...BUILTIN_TEMPLATES];

  function renderPublisher(panel) {
    const clients = clientList();
    const d = readDb();
    if (!S.pub.key || !d[S.pub.key]) {
      S.pub.key = clients[0] ? clients[0].key : '';
      S.pub.text = S.pub.key ? d[S.pub.key].diet || '' : '';
      S.pub.loaded = S.pub.text;
    }
    const rec = d[S.pub.key];
    if (!rec) { panel.innerHTML = '<p class="hhx-empty">Add a client profile first, then write their plan here.</p>'; return; }
    const history = rec.dietHistory || [];
    const others = clients.filter((c) => c.key !== S.pub.key);
    const wa = phoneDigits(rec.phone);
    const loginMsg = `Hi ${rec.name}! Your Heaven & Hell client portal is ready.\n\nOpen: ${location.origin}\nTap "Client login"\nClient ID: ${S.pub.key}\n\nYour diet plan is there, and you can log your weight check-ins too.`;
    panel.innerHTML = `
      <div class="hhx-pub">
        <div class="hhx-pub-main">
          <div class="hhx-form-grid">
            <div class="hhx-field">
              <label class="hhx-label" for="hhx-pub-client">Assign to</label>
              <select id="hhx-pub-client" data-hhx-input="pub-client">${clients.map((c) => `<option value="${esc(c.key)}" ${c.key === S.pub.key ? 'selected' : ''}>${esc(c.name)} · ${esc(c.key)}</option>`).join('')}</select>
              <small class="hhx-muted">${rec.dietUpdatedAt ? `Current plan published ${ago(rec.dietUpdatedAt)}` : 'No published plan yet'}</small>
            </div>
            <div class="hhx-field">
              <label class="hhx-label" for="hhx-pub-template">Start from a template</label>
              <div class="hhx-inline-row">
                <select id="hhx-pub-template"><option value="">Choose…</option>${allTemplates().map((t) => `<option value="${esc(t.id)}">${t.custom ? 'Saved · ' : ''}${esc(t.name)}</option>`).join('')}</select>
                <button type="button" class="hhx-btn hhx-btn--ghost" data-hhx="pub-apply-template">Use</button>
              </div>
            </div>
          </div>
          <div class="hhx-chips hhx-meal-chips" role="group" aria-label="Insert meal line">
            ${MEALS.map((m) => `<button type="button" class="hhx-chip" data-hhx="pub-insert" data-meal="${esc(m)}">+ ${esc(m)}</button>`).join('')}
          </div>
          <textarea id="hhx-pub-text" rows="14" data-hhx-input="pub-text" aria-label="Diet plan" placeholder="• Breakfast: …">${esc(S.pub.text)}</textarea>
          <div class="hhx-pub-foot"><small class="hhx-muted" id="hhx-pub-count"></small><small id="hhx-pub-dirty" class="hhx-dirty"></small></div>
          ${others.length ? `<details class="hhx-also"><summary>Also assign this plan to… <span id="hhx-also-count"></span></summary>
            <div class="hhx-also-list">${others.map((c) => `<label class="hhx-check"><input type="checkbox" data-hhx-input="pub-also" value="${esc(c.key)}" ${S.pub.also.includes(c.key) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div></details>` : ''}
          <div class="hhx-actions">
            <button type="button" class="hhx-btn hhx-btn--primary" data-hhx="pub-publish">Publish to client</button>
            <button type="button" class="hhx-btn hhx-btn--ghost" data-hhx="pub-save-template">Save as template</button>
            <button type="button" class="hhx-btn hhx-btn--ghost" data-hhx="pub-revert">Revert to published</button>
            ${S.templates.length ? '<button type="button" class="hhx-btn hhx-btn--ghost" data-hhx="pub-manage-templates">Delete a template</button>' : ''}
          </div>
        </div>
        <aside class="hhx-pub-side">
          <section class="hhx-card">
            <div class="hhx-card-head"><h4>Client preview</h4><span class="hhx-muted">What ${esc(rec.name)} sees</span></div>
            <div id="hhx-pub-preview" class="hhx-preview"></div>
          </section>
          <section class="hhx-card">
            <div class="hhx-card-head"><h4>Version history</h4></div>
            ${history.length ? `<ul class="hhx-list hhx-history">${history.map((h, i) => `<li>
              <span class="hhx-list-main"><strong>${h.at ? toDMY(new Date(h.at)) : 'Earlier version'}</strong><small>${esc(String(h.diet).split('\n')[0].slice(0, 60))}</small></span>
              <button type="button" class="hhx-btn hhx-btn--ghost hhx-btn--xs" data-hhx="pub-restore" data-i="${i}">Load</button></li>`).join('')}</ul>`
              : '<p class="hhx-empty">Earlier versions appear here after you publish changes.</p>'}
          </section>
          <section class="hhx-card">
            <div class="hhx-card-head"><h4>Client login</h4></div>
            <p class="hhx-code">Access code <code>${esc(S.pub.key)}</code></p>
            <div class="hhx-field hhx-email-field">
              <label class="hhx-label" for="hhx-pub-email">Client email</label>
              <div class="hhx-inline-row"><input id="hhx-pub-email" type="email" value="${esc(rec.email || '')}" placeholder="client@example.com" maxlength="254">
                <button type="button" class="hhx-btn hhx-btn--ghost hhx-btn--sm" data-hhx="pub-email-save">Save</button></div>
              <small class="hhx-muted">${rec.accessEmailSentAt ? `Access code emailed ${ago(rec.accessEmailSentAt)} to ${esc(rec.accessEmailTo || rec.email || '')}` : 'Access code not emailed yet'}</small>
            </div>
            <div class="hhx-actions">
              <button type="button" class="hhx-btn hhx-btn--primary hhx-btn--sm" data-hhx="pub-email-send">${icon('mail')}${rec.accessEmailSentAt ? 'Resend access code' : 'Email access code'}</button>
              <button type="button" class="hhx-btn hhx-btn--ghost hhx-btn--sm" data-hhx="pub-copy-login" data-msg="${esc(loginMsg)}">${icon('copy')}Copy login message</button>
              ${wa ? `<a class="hhx-btn hhx-btn--ghost hhx-btn--sm" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(loginMsg)}">Send on WhatsApp</a>` : ''}
            </div>
          </section>
        </aside>
      </div>`;
    updatePublisherLive();
  }
  function updatePublisherLive() {
    const preview = document.getElementById('hhx-pub-preview');
    if (preview) preview.innerHTML = formatDietHTML(S.pub.text);
    const count = document.getElementById('hhx-pub-count');
    if (count) count.textContent = `${S.pub.text.split('\n').filter((l) => l.trim()).length} lines · ${S.pub.text.length} characters`;
    const dirty = document.getElementById('hhx-pub-dirty');
    if (dirty) dirty.textContent = S.pub.text !== S.pub.loaded ? '● Unpublished changes' : '';
    const also = document.getElementById('hhx-also-count');
    if (also) also.textContent = S.pub.also.length ? `(${S.pub.also.length} selected)` : '';
  }
  function insertMeal(meal) {
    const ta = document.getElementById('hhx-pub-text');
    if (!ta) return;
    const line = `• ${meal}: `;
    const pos = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, pos);
    const after = ta.value.slice(pos);
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    ta.value = before + prefix + line + (after && !after.startsWith('\n') ? '\n' : '') + after;
    const caret = (before + prefix + line).length;
    ta.focus();
    ta.setSelectionRange(caret, caret);
    S.pub.text = ta.value;
    updatePublisherLive();
  }
  async function publishDiet(btn) {
    const text = S.pub.text.replace(/\s+$/, '');
    if (!text.trim()) { toast('Write the plan before publishing.', 'error'); return; }
    const d = readDb();
    const keys = [S.pub.key, ...S.pub.also].filter((k, i, a) => d[k] && a.indexOf(k) === i);
    if (keys.length > 1 && !confirm(`Publish this plan to ${keys.length} clients? It replaces each client's current plan (earlier versions stay in their history).`)) return;
    keys.forEach((k) => { d[k].diet = text; });
    if (btn) { btn.disabled = true; btn.textContent = 'Publishing…'; }
    try {
      await window.hhQueueDatabaseSync(d);
      // Keep the legacy card editors in sync so "Save All Dynamic Changes" cannot revert this publish.
      keys.forEach((k) => { const ta = document.getElementById('edit-diet-' + slotOf(k, d[k])); if (ta) ta.value = text; });
      S.pub.text = text;
      S.pub.loaded = text;
      S.pub.also = [];
      toast(`Published to ${keys.map((k) => d[k].name).join(', ')}. Clients see it live.`);
    } catch (e) {
      console.error('Diet publish failed:', e);
      toast('Publish failed. Check your admin login and Firestore rules.', 'error');
    } finally {
      refreshAdminPanel();
    }
  }

  /* =====================================================================
   * APP SHELL — header, welcome hero, login, onboarding wizard
   * ===================================================================== */
  const html = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstElementChild; };
  const brandMarkup = (tag, attrs) => `<${tag} class="hh-brand" ${attrs}><span class="hh-brand-mark">H&amp;H</span><span class="hh-brand-text"><strong>HEAVEN &amp; HELL</strong><small>Fitness coaching</small></span></${tag}>`;
  function goHome() {
    $('#main-app')?.classList.add('hidden');
    const welcome = $('#welcome-page');
    if (welcome) welcome.style.display = '';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    window.scrollTo({ top: 0 });
  }

  function initShell() {
    const welcome = $('#welcome-page');
    const main = $('#main-app');
    if (!welcome || !main || main.querySelector('.hh-topbar')) return;
    const waLink = welcome.querySelector('a[href^="https://wa.me"]');
    const waHref = waLink ? waLink.getAttribute('href') : 'https://wa.me/';

    // Welcome hero
    welcome.prepend(html(`<nav class="hh-hero-nav">${brandMarkup('div', '')}<div class="hh-hero-nav-actions">
      <button type="button" class="hh-nav-link" data-hh="go-coach">${icon('shield')}Coach login</button>
      <button type="button" class="hh-btn--ghost" data-hh="go-client">${icon('lock')}Client login</button></div></nav>`));
    const tagline = welcome.querySelector(':scope > p');
    if (tagline && tagline.textContent === tagline.textContent.toUpperCase()) tagline.textContent = tagline.textContent.toLowerCase().replace(/(^|\.\s+)([a-z])/g, (m, p1, c) => p1 + c.toUpperCase());
    welcome.querySelector('h1')?.before(html('<span class="hh-hero-eyebrow"><i></i>Personal coaching with Coach Kavi</span>'));
    const join = welcome.querySelector('.neon-cta-btn');
    if (join) {
      const actions = html('<div class="hh-hero-actions"></div>');
      join.before(actions);
      actions.append(join);
      join.innerHTML = `Join now ${icon('right')}`;
      join.removeAttribute('onclick');
      join.dataset.hh = 'go-join';
      actions.append(html(`<button type="button" class="hh-btn--ghost" data-hh="go-client">I'm already a client</button>`));
      actions.after(html(`<div class="hh-hero-points"><span>${icon('check')}Personalised diet plans</span><span>${icon('check')}Weekly progress check-ins</span><span>${icon('check')}Direct coach support</span></div>`));
    }
    if (waLink) waLink.innerHTML = `${icon('chat')}Chat with coach`;

    // App header: brand, section switcher, coach chat
    const topbar = html(`<header class="hh-topbar">${brandMarkup('button', 'type="button" data-hh="go-home" aria-label="Back to home"')}
      <div class="hh-topbar-actions"><button type="button" class="hh-nav-link hh-hide-sm" data-hh="go-coach" id="hh-topbar-coach">${icon('shield')}Coach login</button>
      <button type="button" class="hh-btn--ghost" data-hh="go-client" id="hh-topbar-client">${icon('lock')}Client login</button>
      <a class="hh-btn--ghost hh-hide-sm" href="${esc(waHref)}" target="_blank" rel="noopener">${icon('chat')}Chat with coach</a></div></header>`);
    // The questionnaire is reached only through "Join now", so the old section tabs stay hidden (kept for the legacy page switcher).
    main.querySelector('.nav-tabs')?.setAttribute('hidden', '');
    main.prepend(topbar);

    // Page headings
    const formTitle = $('#form-page > h2');
    if (formTitle) {
      formTitle.textContent = 'Client intake questionnaire';
      formTitle.before(html('<span class="hh-eyebrow">Join Heaven &amp; Hell</span>'));
      formTitle.after(html('<div class="hh-page-sub">Takes about 5 minutes. Your answers are private and only shared with your coach.</div>'));
    }
    const portalTitle = $('#portal-page > h2');
    if (portalTitle) {
      portalTitle.textContent = 'Welcome back';
      portalTitle.after(html('<div class="hh-page-sub">Sign in to see your diet plan and progress.</div>'));
    }

    // Opening the app lands on the onboarding form instead of an empty screen.
    const legacyStart = window.startOnboarding;
    window.startOnboarding = function () {
      legacyStart.apply(this, arguments);
      if (!$('#btn-form')?.classList.contains('active') && !$('#btn-portal')?.classList.contains('active')) window.switchPage('form');
      window.scrollTo({ top: 0 });
    };
    const legacySwitch = window.switchPage;
    window.switchPage = function () { legacySwitch.apply(this, arguments); window.scrollTo({ top: 0 }); };

    initLogin();
    initWizard();
    initApplicationDone();
    window.addEventListener('hashchange', applyRoute);
    applyRoute();
    initTestMode();
  }

  function initTestMode() {
    const T = window.hhTestMode;
    if (!T || !T.active || document.getElementById('hh-test-banner')) return;
    const c = T.credentials;
    const banner = html(`<div id="hh-test-banner" role="note"><span class="hh-test-pill">Test mode</span>
      <span class="hh-test-text">Sample data, stored only in this browser. Client <code>${esc(c.clientCode)}</code> · Coach <code>${esc(c.coachLogin)}</code> / <code>${esc(c.coachPassword)}</code></span>
      <button type="button" data-hh="test-exit">Exit test mode</button></div>`);
    ($('#welcome-page') || document.body.firstElementChild).before(banner);
    const pending = T.takePending();
    if (!pending) return;
    goLogin(pending.mode);
    if (pending.mode === 'coach') { $('#admin-email').value = c.coachLogin; $('#client-pwd').value = c.coachPassword; }
    else $('#client-pwd').value = pending.code || c.clientCode;
    setTimeout(() => $('#login-section > button')?.click(), 50);
  }

  // Two dedicated sign-in pages share the legacy login form: #client-login and #coach-login.
  const LOGIN_COPY = {
    client: {
      badge: 'Client portal', title: 'Client login', sub: 'Sign in with the client ID you received after applying.',
      button: 'Open my portal', pwdLabel: 'Client ID', pwdPlaceholder: 'e.g. HH-4K7P2Q',
      hint: "Use the client ID you got after applying. Can't find it? Message your coach.",
      switchText: `Are you the coach? <button type="button" class="hh-link-btn" data-hh="go-coach">Coach login ${icon('right')}</button>`,
    },
    coach: {
      badge: 'Coach area', title: 'Coach login', sub: 'Manage clients, leads, check-ins and diet plans.',
      button: 'Sign in to dashboard', pwdLabel: 'Password', pwdPlaceholder: 'Your password',
      hint: 'Restricted to the coach account.',
      switchText: `<button type="button" class="hh-link-btn" data-hh="go-client">${icon('left')} Back to client login</button>`,
    },
  };
  let setLoginMode = () => {};
  function initLogin() {
    const section = $('#login-section');
    const email = $('#admin-email');
    const pwd = $('#client-pwd');
    if (!section || !email || !pwd || section.querySelector('.hh-login-head')) return;
    const emailGroup = email.closest('.form-group');
    const emailLabel = emailGroup && emailGroup.querySelector('label');
    const pwdGroup = pwd.closest('.form-group');
    const pwdLabel = pwdGroup && pwdGroup.querySelector('label');
    const btn = section.querySelector(':scope > button');
    if (emailLabel) { emailLabel.setAttribute('for', 'admin-email'); emailLabel.textContent = 'Email'; }
    if (pwdLabel) pwdLabel.setAttribute('for', 'client-pwd');
    email.placeholder = 'coach@example.com';
    const intro = section.querySelector(':scope > p');
    if (intro && !intro.id) intro.hidden = true;
    // Page heading lives inside the card so each login reads as its own screen.
    $('#portal-page > h2')?.classList.add('hidden');
    $('#portal-page > .hh-page-sub')?.classList.add('hidden');
    const head = html(`<div class="hh-login-head"><span class="hh-login-badge"></span><h2 class="hh-login-title"></h2><p class="hh-login-sub"></p></div>`);
    section.prepend(head);

    const wrap = html('<div class="hh-pw-wrap"></div>');
    pwd.before(wrap);
    wrap.append(pwd);
    const reveal = html('<button type="button" class="hh-pw-toggle" aria-label="Show">Show</button>');
    wrap.append(reveal);
    reveal.addEventListener('click', () => {
      const show = pwd.type === 'password';
      pwd.type = show ? 'text' : 'password';
      reveal.textContent = show ? 'Hide' : 'Show';
      reveal.setAttribute('aria-label', show ? 'Hide' : 'Show');
    });
    // Client: remember the access code on this device. Coach: password reset.
    const extras = html(`<div class="hh-login-extras">
      <label class="hh-check-inline" data-for="client"><input type="checkbox" id="hh-remember"> Remember me on this device</label>
      <button type="button" class="hh-link-btn" data-for="coach" data-hh="coach-reset">Forgot password?</button></div>`);
    pwdGroup.after(extras);
    const note = html('<p class="hh-login-note" role="status" hidden></p>');
    btn.after(note);
    const hint = html('<p class="hh-login-hint"></p>');
    const switcher = html('<div class="hh-login-switch"></div>');
    section.append(hint, switcher);

    setLoginMode = (mode) => {
      const coach = mode === 'coach';
      const copy = LOGIN_COPY[coach ? 'coach' : 'client'];
      section.dataset.mode = coach ? 'coach' : 'client';
      head.querySelector('.hh-login-badge').innerHTML = `${icon(coach ? 'shield' : 'user')}${copy.badge}`;
      head.querySelector('.hh-login-title').textContent = copy.title;
      head.querySelector('.hh-login-sub').textContent = copy.sub;
      if (emailGroup) emailGroup.classList.toggle('hidden', !coach);
      if (pwdLabel) pwdLabel.textContent = copy.pwdLabel;
      pwd.placeholder = copy.pwdPlaceholder;
      pwd.autocomplete = coach ? 'current-password' : 'off';
      pwd.type = 'password';
      reveal.textContent = 'Show';
      extras.querySelectorAll('[data-for]').forEach((n) => { n.hidden = n.dataset.for !== section.dataset.mode; });
      if (coach) {
        if (!email.value) email.value = store.get('hhCoachEmail', '');
        pwd.value = '';
      } else {
        email.value = '';
        const saved = store.get('hhClientCode', '');
        pwd.value = saved || '';
        $('#hh-remember').checked = !!saved;
      }
      btn.textContent = copy.button;
      btn.dataset.label = copy.button;
      hint.textContent = copy.hint;
      switcher.innerHTML = copy.switchText;
      note.hidden = true;
      const err = $('#login-error');
      if (err) err.style.display = 'none';
      store.set('hhLoginMode', section.dataset.mode);
    };
    [email, pwd].forEach((input) => input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); btn.click(); }
    }));
    setLoginMode(store.get('hhLoginMode', 'client'));
  }
  function showLoginNote(text, kind) {
    const note = $('.hh-login-note');
    if (!note) return;
    note.textContent = text;
    note.dataset.kind = kind;
    note.hidden = false;
  }
  async function coachPasswordReset() {
    const email = ($('#admin-email')?.value || '').trim();
    if (!email.includes('@')) { showLoginNote('Enter your coach email above, then choose "Forgot password?" again.', 'error'); $('#admin-email')?.focus(); return; }
    try {
      await hhAuth.sendPasswordResetEmail(email);
      showLoginNote(`If ${email} is the coach account, a reset link is on its way. Check your inbox.`, 'ok');
    } catch (e) {
      console.error('Password reset failed:', e);
      showLoginNote(e && e.code === 'auth/network-request-failed' ? 'Network issue. Check your connection and try again.' : 'Could not send the reset email. Check the address and try again.', 'error');
    }
  }
  function goLogin(mode) {
    window.startOnboarding();
    window.switchPage('portal');
    if (!$('#login-section')?.classList.contains('hidden')) {
      setLoginMode(mode);
      setTimeout(() => (mode === 'coach' && !$('#admin-email').value ? $('#admin-email') : $('#client-pwd'))?.focus(), 50);
    }
    const hash = mode === 'coach' ? '#coach-login' : '#client-login';
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }
  function applyRoute() {
    if (location.hash === '#coach-login') goLogin('coach');
    else if (location.hash === '#client-login') goLogin('client');
    else if (location.hash === '#join' || location.hash === '#onboarding') goJoin();
  }

  /* ---------- applications: one unique client ID per submission ---------- */
  const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
  function newApplicantId() {
    const bytes = new Uint8Array(6);
    window.crypto.getRandomValues(bytes);
    return 'HH-' + [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
  }
  const APPLICANT_ID = /^hh-?[a-z0-9]{6}$/i;
  const formatApplicantId = (v) => { const c = String(v).replace(/[^a-z0-9]/gi, '').toUpperCase(); return 'HH-' + c.slice(2); };

  // Intake submissions are stored under their client ID. Firestore rules only allow creating
  // a new document, so an (extremely unlikely) ID collision is rejected and a new ID is drawn.
  const legacyRequest = window.hhFirebaseRequest;
  window.hhFirebaseRequest = async function (path, options = {}) {
    if (path !== 'clientIntakes' || String(options.method || 'GET').toUpperCase() !== 'POST') return legacyRequest.apply(this, arguments);
    const payload = JSON.parse(options.body || '{}');
    for (let attempt = 0; ; attempt++) {
      const id = newApplicantId();
      try {
        await hhFirestore.collection('clientIntakes').doc(id).set({ ...payload, applicantId: id });
        S.lastApplicantId = id;
        return { name: id };
      } catch (e) {
        if (e && e.code === 'permission-denied' && attempt < 3) continue;
        throw e;
      }
    }
  };

  const legacyCapture = window.captureIntakeData;
  window.captureIntakeData = async function (event) {
    if (event) event.preventDefault();
    const form = $('#onboarding-form');
    const name = (form?.querySelector('[name="1_Full_Name"]')?.value || '').trim();
    const errorBox = $('#hh-submit-error');
    if (errorBox) errorBox.hidden = true;
    S.lastApplicantId = null;
    let submitted = false;
    const nativeAlert = window.alert;
    // The legacy handler reports through alert(); show its messages on the page instead.
    window.alert = (message) => {
      const text = String(message);
      if (/submitted successfully/i.test(text)) { submitted = true; return; }
      if (errorBox) { errorBox.textContent = text.replace(/^[^\w]+/u, ''); errorBox.hidden = false; } else nativeAlert.call(window, text);
    };
    try { await legacyCapture.apply(this, arguments); } finally { window.alert = nativeAlert; }
    if (submitted && S.lastApplicantId) {
      const record = { id: S.lastApplicantId, name, at: new Date().toISOString() };
      store.set('hhApplication', record);
      showApplication(record, true);
    }
  };

  function initApplicationDone() {
    const page = $('#form-page');
    const row = $('#onboarding-form .form-action-row');
    if (!page || $('#hh-application-done')) return;
    if (row) row.before(html('<div class="hh-step-error" id="hh-submit-error" role="alert" hidden></div>'));
    page.append(html('<section id="hh-application-done" hidden></section>'));
  }
  // Shows either the questionnaire or the "application received" screen for this device.
  function showApplication(record, justSubmitted = false) {
    const page = $('#form-page');
    const done = $('#hh-application-done');
    if (!page || !done) return;
    page.classList.toggle('is-done', !!record);
    done.hidden = !record;
    if (!record) { done.innerHTML = ''; window.scrollTo({ top: 0 }); return; }
    const first = esc((record.name || '').split(/\s+/)[0] || 'there');
    done.innerHTML = `
      <div class="hh-done-card">
        <span class="hh-done-icon">${icon('check')}</span>
        <h2>${justSubmitted ? 'Application received' : "You've already applied"}</h2>
        <p class="hh-done-lead">${justSubmitted ? `Thanks, ${first}. Coach Kavi will review your answers and contact you shortly.` : `Hi ${first}, your application was sent ${ago(record.at)}. There's no need to fill in the form again.`}</p>
        <div class="hh-id-box">
          <span class="hh-id-label">Your client ID</span>
          <strong class="hh-id-value" id="hh-applicant-id">${esc(record.id)}</strong>
          <button type="button" class="hh-btn--ghost" data-hh="copy-applicant-id" data-id="${esc(record.id)}">${icon('copy')}Copy ID</button>
        </div>
        <ol class="hh-done-steps">
          <li><i>1</i><span>Save this ID. It's unique to you.</span></li>
          <li><i>2</i><span>Your coach reviews your answers and activates your plan.</span></li>
          <li><i>3</i><span>Log in to the client portal with this ID to see your diet plan and track your progress.</span></li>
        </ol>
        <div class="hh-done-actions">
          <button type="button" class="hh-btn" data-hh="go-client">Go to client login ${icon('right')}</button>
          <button type="button" class="hh-btn--ghost" data-hh="go-home">Back to home</button>
        </div>
        <p class="hh-done-foot">Not ${first}? <button type="button" class="hh-link-btn" data-hh="new-application">Start a new application</button></p>
      </div>`;
    window.scrollTo({ top: 0 });
  }
  function goJoin() {
    window.startOnboarding();
    window.switchPage('form');
    showApplication(store.get('hhApplication', null));
    if (location.hash !== '#join') history.replaceState(null, '', '#join');
  }

  const STEP_SUBTITLES = [
    'The basics, so your coach can reach you.',
    'Measurements and anything that affects how you can train safely.',
    'What you eat today, food preferences and gut health.',
    'Your daily routine, sleep and habits.',
    'Your training background.',
    'What you want to achieve, and by when.',
    'How, where and how often you can train.',
    'A few last details before your first session.',
  ];
  function initWizard() {
    const form = $('#onboarding-form');
    if (!form || form.querySelector('.hh-step')) return;
    const actionRow = form.querySelector('.form-action-row');
    const submit = form.querySelector('button[type="submit"]');
    const legacyBack = actionRow && actionRow.querySelector('.back-btn');
    const steps = [];
    let current = null;
    [...form.children].forEach((node) => {
      if (node === actionRow) return;
      if (node.classList.contains('section-title')) {
        current = document.createElement('section');
        current.className = 'hh-step';
        form.insertBefore(current, actionRow);
        steps.push(current);
      }
      if (current) current.append(node);
    });
    if (!steps.length || !actionRow || !submit) return;
    const titles = steps.map((step, i) => {
      const title = step.querySelector('.section-title');
      const name = title.textContent.replace(/^\s*\d+\.\s*/, '').trim();
      title.textContent = name;
      title.setAttribute('role', 'heading');
      title.setAttribute('aria-level', '3');
      title.after(html(`<div class="hh-step-sub">${esc(STEP_SUBTITLES[i] || '')}</div>`));
      return name;
    });
    const error = html('<div class="hh-step-error" role="alert" hidden></div>');
    steps[0].querySelector('.hh-step-sub').after(error);

    const progress = html(`<div class="hh-wizard-progress">
      <div class="hh-wizard-meta"><span id="hh-wizard-label"></span><span id="hh-wizard-pct"></span></div>
      <div class="hh-wizard-bar"><i></i></div>
      <div class="hh-wizard-steps" role="list">${titles.map((t, i) => `<button type="button" role="listitem" data-step="${i}"><i>${i + 1}</i>${esc(t)}</button>`).join('')}</div></div>`);
    form.before(progress);

    if (legacyBack) legacyBack.hidden = true;
    const prev = html(`<button type="button" class="hh-btn--ghost">${icon('left')}<span>Back</span></button>`);
    const next = html(`<button type="button" class="hh-btn">Continue ${icon('right')}</button>`);
    actionRow.prepend(prev);
    submit.before(html('<span class="hh-spacer"></span>'), next);
    submit.textContent = 'Submit questionnaire';
    actionRow.after(html('<div class="hh-form-note">Your progress is kept on this page until you submit.</div>'));

    let at = 0;
    let furthest = 0;
    const validateFirst = () => {
      const name = form.querySelector('[name="1_Full_Name"]');
      const phone = form.querySelector('[name="4_Phone_Number"]');
      const problems = [];
      [name, phone].forEach((f) => f && f.classList.remove('hh-field-invalid'));
      if (name && !name.value.trim()) { problems.push('your full name'); name.classList.add('hh-field-invalid'); }
      if (phone && phone.value.replace(/\D/g, '').length < 7) { problems.push('a valid phone number'); phone.classList.add('hh-field-invalid'); }
      error.hidden = !problems.length;
      error.textContent = problems.length ? `Please enter ${problems.join(' and ')} to continue.` : '';
      if (problems.length) (name && !name.value.trim() ? name : phone).focus();
      return !problems.length;
    };
    const go = (i, scroll = true) => {
      if (i > 0 && at === 0 && !validateFirst()) return;
      at = Math.max(0, Math.min(steps.length - 1, i));
      furthest = Math.max(furthest, at);
      steps.forEach((s, k) => { s.hidden = k !== at; });
      const last = at === steps.length - 1;
      next.hidden = last;
      submit.hidden = !last;
      prev.querySelector('span').textContent = at === 0 ? 'Home' : 'Back';
      $('#hh-wizard-label').innerHTML = `<strong>Step ${at + 1} of ${steps.length}</strong> · ${esc(titles[at])}`;
      const pct = Math.round(((at + 1) / steps.length) * 100);
      $('#hh-wizard-pct').textContent = `${pct}%`;
      progress.querySelector('.hh-wizard-bar > i').style.width = pct + '%';
      progress.querySelectorAll('[data-step]').forEach((b, k) => {
        b.classList.toggle('is-current', k === at);
        b.classList.toggle('is-done', k < at || (k <= furthest && k !== at));
        if (k === at) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      });
      if (scroll) $('#form-page')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    prev.addEventListener('click', () => (at === 0 ? (legacyBack ? legacyBack.click() : goHome()) : go(at - 1)));
    next.addEventListener('click', () => go(at + 1));
    progress.addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (b) go(Number(b.dataset.step)); });
    form.addEventListener('input', (e) => { if (e.target.classList.contains('hh-field-invalid')) { e.target.classList.remove('hh-field-invalid'); } });
    // The legacy submit handler resets the form after a successful submission.
    form.addEventListener('reset', () => { furthest = 0; setTimeout(() => { at = 0; go(0); }, 0); });
    go(0, false);
  }

  // Keep the legacy form-history list free of emoji after its periodic refresh.
  const legacyRefreshHistory = window.hhRefreshIntakeHistory;
  if (legacyRefreshHistory) window.hhRefreshIntakeHistory = async function () { await legacyRefreshHistory.apply(this, arguments); polishText($('#hh-intake-history')); };
  const legacyToggleDetails = window.toggleClientDetails;
  if (legacyToggleDetails) window.toggleClientDetails = function () { legacyToggleDetails.apply(this, arguments); polishText($('#hh-intake-history')); };

  /* =====================================================================
   * EVENTS (delegated)
   * ===================================================================== */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-hh]');
    if (!el) return;
    const action = el.dataset.hh;
    if (action === 'go-home') goHome();
    else if (action === 'go-portal' || action === 'go-client') goLogin('client');
    else if (action === 'go-coach') goLogin('coach');
    else if (action === 'coach-reset') coachPasswordReset();
    else if (action === 'go-join') goJoin();
    else if (action === 'copy-applicant-id') copyText(el.dataset.id).then(() => toast('Client ID copied.')).catch(() => alert(el.dataset.id));
    else if (action === 'new-application') { if (confirm('Start a new application for someone else on this device?')) { store.set('hhApplication', null); showApplication(null); } }
    else if (action === 'test-exit') window.hhTestMode?.exit();
  });
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-hhx]');
    if (!el) return;
    const action = el.dataset.hhx;
    const d = readDb();
    switch (action) {
      case 'tab':
        S.tab = el.dataset.tab; store.set('hhxTab', S.tab); renderPanel();
        document.getElementById('hhx-admin')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      case 'unit':
        S.unit = el.dataset.unit; store.set('hhxUnit', S.unit);
        if (S.clientCode) { const rec = d[S.clientCode]; if (rec) renderClientStats(rec); } else renderPanel();
        document.querySelectorAll('[data-hhx="unit"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unit === S.unit)));
        break;
      case 'ci-unit': {
        const input = document.getElementById('hhx-ci-weight');
        const prev = el.parentElement.querySelector('[aria-checked="true"]')?.dataset.unit;
        const next = el.dataset.unit;
        if (input && input.value && prev && prev !== next) {
          const v = Number(input.value);
          if (Number.isFinite(v)) input.value = (next === 'lbs' ? v / KG_PER_LB : v * KG_PER_LB).toFixed(1);
        }
        el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === el)));
        if (input) input.placeholder = next === 'lbs' ? 'e.g. 165.0' : 'e.g. 75.0';
        break;
      }
      case 'client-copy': window.copyDietPlan(); break;
      case 'client-download': { const rec = d[S.clientCode]; if (rec) downloadFile(`diet-plan-${(rec.name || 'client').replace(/\s+/g, '-').toLowerCase()}.txt`, dietPlainText(rec)); break; }
      case 'client-share': {
        const rec = d[S.clientCode];
        if (!rec) break;
        const text = dietPlainText(rec);
        if (navigator.share) { try { await navigator.share({ title: 'My diet plan', text }); } catch { /* share cancelled */ } }
        else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
        break;
      }
      case 'client-print': { const rec = d[S.clientCode]; if (rec) printDiet(rec); break; }
      case 'client-signout': clientSignOut(); break;
      case 'open-publisher':
        S.tab = 'publisher'; store.set('hhxTab', S.tab);
        S.pub = { key: el.dataset.key, text: (d[el.dataset.key] || {}).diet || '', loaded: (d[el.dataset.key] || {}).diet || '', also: [] };
        renderPanel();
        break;
      case 'lead-toggle': {
        const det = el.closest('.hhx-lead').querySelector('.hhx-lead-details');
        det.hidden = !det.hidden;
        el.setAttribute('aria-expanded', String(!det.hidden));
        el.textContent = det.hidden ? 'Details' : 'Hide';
        break;
      }
      case 'lead-convert': convertLead(el.dataset.id); break;
      case 'lead-export': exportLeads(); break;
      case 'tr-sort': {
        const k = el.dataset.sort;
        if (S.tr.sort === k) S.tr.dir = S.tr.dir === 'asc' ? 'desc' : 'asc';
        else { S.tr.sort = k; S.tr.dir = k === 'client' || k === 'by' ? 'asc' : 'desc'; }
        renderTrackerResults();
        break;
      }
      case 'tr-view':
        S.tr.view = el.dataset.view;
        el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === el)));
        renderTrackerResults();
        break;
      case 'tr-range': {
        const r = el.dataset.range;
        S.tr.from = r === 'all' ? '' : toISODate(new Date(Date.now() - Number(r) * DAY));
        S.tr.to = '';
        renderPanel();
        break;
      }
      case 'tr-export': exportTracker(); break;
      case 'tr-edit': window.editLog(el.dataset.key, Number(el.dataset.idx)); break;
      case 'tr-delete': window.deleteLog(el.dataset.key, Number(el.dataset.idx)); break;
      case 'pub-insert': insertMeal(el.dataset.meal); break;
      case 'pub-apply-template': {
        const id = document.getElementById('hhx-pub-template')?.value;
        const tpl = allTemplates().find((t) => t.id === id);
        if (!tpl) { toast('Choose a template first.', 'warn'); break; }
        if (S.pub.text.trim() && S.pub.text !== tpl.text && !confirm('Replace the text in the editor with this template?')) break;
        S.pub.text = tpl.text;
        const ta = document.getElementById('hhx-pub-text');
        if (ta) ta.value = tpl.text;
        updatePublisherLive();
        break;
      }
      case 'pub-save-template': {
        if (!S.pub.text.trim()) { toast('Write something first.', 'warn'); break; }
        const name = (prompt('Template name:', '') || '').trim();
        if (!name) break;
        S.templates = [{ id: 'custom-' + Date.now().toString(36), name, text: S.pub.text }, ...S.templates].slice(0, 50);
        await saveTemplates();
        toast(`Template “${name}” saved.`);
        renderPanel();
        break;
      }
      case 'pub-manage-templates': {
        const list = S.templates.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
        const n = Number(prompt(`Delete which saved template? Enter its number:\n\n${list}`, ''));
        if (!n || !S.templates[n - 1]) break;
        if (!confirm(`Delete template “${S.templates[n - 1].name}”?`)) break;
        S.templates.splice(n - 1, 1);
        await saveTemplates();
        renderPanel();
        break;
      }
      case 'pub-revert':
        S.pub.text = S.pub.loaded = (d[S.pub.key] || {}).diet || '';
        renderPanel();
        break;
      case 'pub-restore': {
        const h = ((d[S.pub.key] || {}).dietHistory || [])[Number(el.dataset.i)];
        if (!h) break;
        S.pub.text = h.diet;
        const ta = document.getElementById('hhx-pub-text');
        if (ta) ta.value = h.diet;
        updatePublisherLive();
        toast('Earlier version loaded into the editor. Publish to make it live.');
        break;
      }
      case 'pub-publish': publishDiet(el); break;
      case 'pub-email-save': {
        const input = document.getElementById('hhx-pub-email');
        const value = (input ? input.value : '').trim();
        if (value && !EMAIL_RE.test(value)) { toast('That email address doesn\'t look right.', 'error'); break; }
        const rec = d[S.pub.key];
        if (!rec) break;
        rec.email = value;
        try { await window.hhQueueDatabaseSync(d); toast(value ? 'Email saved.' : 'Email removed.'); } catch { toast('Could not save the email.', 'error'); }
        break;
      }
      case 'pub-email-send': {
        const rec = d[S.pub.key];
        if (!rec) break;
        const input = document.getElementById('hhx-pub-email');
        const typed = (input ? input.value : '').trim();
        if (typed !== (rec.email || '')) {
          if (typed && !EMAIL_RE.test(typed)) { toast('That email address doesn\'t look right.', 'error'); break; }
          rec.email = typed;
          await window.hhQueueDatabaseSync(d);
        }
        if (rec.accessEmailSentAt && !confirm(`Send the access code to ${typed || rec.email} again?`)) break;
        el.disabled = true;
        el.textContent = 'Sending…';
        await deliverAccessCode(S.pub.key);
        refreshAdminPanel();
        break;
      }
      case 'pub-copy-login':
        try { await copyText(el.dataset.msg); toast('Login message copied.'); } catch { alert(el.dataset.msg); }
        break;
      default: break;
    }
  });

  let searchTimer = null;
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-hhx-input]');
    if (!el) return;
    const k = el.dataset.hhxInput;
    if (k === 'lead-q') { S.lead.q = el.value; clearTimeout(searchTimer); searchTimer = setTimeout(renderLeadResults, 150); }
    else if (k === 'tr-q') { S.tr.q = el.value; clearTimeout(searchTimer); searchTimer = setTimeout(renderTrackerResults, 150); }
    else if (k === 'pub-text') { S.pub.text = el.value; updatePublisherLive(); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-hhx-input]');
    if (!el) return;
    switch (el.dataset.hhxInput) {
      case 'lead-status': S.lead.status = el.value; renderLeadResults(); break;
      case 'lead-goal': S.lead.goal = el.value; renderLeadResults(); break;
      case 'lead-sort': S.lead.sort = el.value; renderLeadResults(); break;
      case 'lead-set-status': setLeadStatus(el.dataset.id, el.value).then(renderLeadResults); break;
      case 'tr-client': S.tr.client = el.value; renderTrackerResults(); break;
      case 'tr-who': S.tr.who = el.value; renderTrackerResults(); break;
      case 'tr-from': S.tr.from = el.value; renderTrackerResults(); break;
      case 'tr-to': S.tr.to = el.value; renderTrackerResults(); break;
      case 'pub-client': {
        if (S.pub.text !== S.pub.loaded && !confirm('Discard the unpublished changes in the editor?')) { el.value = S.pub.key; break; }
        const rec = readDb()[el.value] || {};
        S.pub = { key: el.value, text: rec.diet || '', loaded: rec.diet || '', also: [] };
        renderPanel();
        break;
      }
      case 'pub-also':
        S.pub.also = el.checked ? [...S.pub.also, el.value] : S.pub.also.filter((k) => k !== el.value);
        updatePublisherLive();
        break;
      default: break;
    }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'hhx-checkin-form') return;
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const unit = f.querySelector('[data-hhx="ci-unit"][aria-checked="true"]')?.dataset.unit || 'kg';
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    submitCheckin({ date: parseDate(f.date.value), weight: f.weight.value, unit, waist: f.waist.value.trim(), note: f.note.value.trim() })
      .then((ok) => { if (ok) { f.weight.value = ''; f.waist.value = ''; f.note.value = ''; } })
      .finally(() => { if (btn) { btn.disabled = false; btn.textContent = 'Submit check-in'; } });
  });
  window.addEventListener('beforeunload', (e) => {
    if (document.getElementById('hhx-admin') && S.tab === 'publisher' && S.pub.text !== S.pub.loaded) { e.preventDefault(); e.returnValue = ''; }
  });

  initShell();

  hhAuth.onAuthStateChanged((user) => {
    if (!user || (user.email || '').toLowerCase() !== HH_ADMIN_EMAIL.toLowerCase()) stopAdmin();
  });

  // Styles live in a sibling file so the legacy page stays readable.
  if (!document.getElementById('hhx-styles')) {
    const link = document.createElement('link');
    link.id = 'hhx-styles';
    link.rel = 'stylesheet';
    link.href = '/hh-enhancements.css'; // fallback when the page head does not link it
    document.head.appendChild(link);
  }
})();
