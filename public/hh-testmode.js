/* HEAVEN & HELL — test mode (sandbox).
 *
 * Signing in with the test credentials (client "test1", coach "test2" / "1234") switches the
 * page into a sandbox: Firebase is replaced by an in-browser store seeded with sample data and
 * every localStorage key is namespaced, so test data never touches the real Firestore project
 * or the real portal data cached in this browser.
 *
 * Load order: after /firebase-compat.js and before the portal's inline script.
 */
(function () {
  'use strict';
  const FLAG = 'hhTestMode';
  const PREFIX = 'hhTest:';
  const proto = Storage.prototype;
  const raw = { get: proto.getItem, set: proto.setItem, remove: proto.removeItem };
  let active = false;
  try { active = raw.get.call(localStorage, FLAG) === '1'; } catch { /* storage unavailable */ }

  window.hhTestMode = {
    active,
    credentials: { clientCode: 'test1', coachLogin: 'test2', coachPassword: '1234' },
    enter(pending) {
      try { raw.set.call(localStorage, FLAG, '1'); sessionStorage.setItem('hhTestPending', JSON.stringify(pending || null)); } catch { /* ignore */ }
      location.reload();
    },
    exit() {
      try {
        raw.remove.call(localStorage, FLAG);
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith(PREFIX)) raw.remove.call(localStorage, k);
        }
      } catch { /* ignore */ }
      location.href = location.pathname;
    },
    takePending() {
      try { const p = JSON.parse(sessionStorage.getItem('hhTestPending') || 'null'); sessionStorage.removeItem('hhTestPending'); return p; } catch { return null; }
    },
  };
  if (!active) return;

  // Namespace every localStorage key so sandbox data stays separate from real portal data.
  const key = (k) => (k === FLAG ? k : PREFIX + k);
  proto.getItem = function (k) { return this === localStorage ? raw.get.call(this, key(k)) : raw.get.call(this, k); };
  proto.setItem = function (k, v) { return this === localStorage ? raw.set.call(this, key(k), v) : raw.set.call(this, k, v); };
  proto.removeItem = function (k) { return this === localStorage ? raw.remove.call(this, key(k)) : raw.remove.call(this, k); };

  /* ---------- in-browser Firestore ---------- */
  const DB_KEY = 'firestore';
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const read = () => { try { return JSON.parse(localStorage.getItem(DB_KEY) || '{}'); } catch { return {}; } };
  const write = (db) => localStorage.setItem(DB_KEY, JSON.stringify(db));
  const resolve = (oldVal, v) => {
    if (v && v.__fv === 'ts') return new Date().toISOString();
    if (v && v.__fv === 'union') {
      const arr = Array.isArray(oldVal) ? oldVal.slice() : [];
      v.items.forEach((i) => { if (!arr.some((a) => JSON.stringify(a) === JSON.stringify(i))) arr.push(i); });
      return arr;
    }
    if (v && v.__fv === 'remove') return (Array.isArray(oldVal) ? oldVal : []).filter((a) => !v.items.some((i) => JSON.stringify(a) === JSON.stringify(i)));
    return v;
  };
  const apply = (oldDoc, data, merge) => {
    const out = merge ? { ...(oldDoc || {}) } : {};
    for (const k in data) out[k] = resolve((oldDoc || {})[k], data[k]);
    return clone(out);
  };
  const snapDoc = (id, data) => ({ id, exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)) });
  const querySnap = (col) => { const docs = Object.entries(read()[col] || {}).map(([id, d]) => snapDoc(id, d)); return { docs, size: docs.length, forEach: (f) => docs.forEach(f) }; };
  const pause = () => new Promise((r) => setTimeout(r, 60)); // feels like a network round trip
  // Live listeners poll the store, so changes made in another tab show up too.
  function watch(compute, cb) {
    let last = null;
    const tick = () => { const s = compute(); if (s.sig !== last) { last = s.sig; cb(s.value); } };
    setTimeout(tick, 0);
    const timer = setInterval(tick, 400);
    return () => clearInterval(timer);
  }
  function docRef(col, id) {
    return {
      id,
      async get() { await pause(); return snapDoc(id, (read()[col] || {})[id]); },
      async set(data, opts) { await pause(); const db = read(); db[col] = db[col] || {}; db[col][id] = apply(db[col][id], data, opts && opts.merge); write(db); },
      async update(data) {
        await pause();
        const db = read();
        if (!db[col] || !db[col][id]) throw Object.assign(new Error('No document to update'), { code: 'not-found' });
        db[col][id] = apply(db[col][id], data, true); write(db);
      },
      async delete() { await pause(); const db = read(); if (db[col]) delete db[col][id]; write(db); },
      onSnapshot(cb) {
        return watch(() => { const v = (read()[col] || {})[id]; return { sig: JSON.stringify(v ?? null), value: snapDoc(id, v) }; }, cb);
      },
    };
  }
  function colRef(col) {
    const query = {
      async get() { await pause(); return querySnap(col); },
      onSnapshot(cb) { return watch(() => ({ sig: JSON.stringify(read()[col] || {}), value: querySnap(col) }), cb); },
    };
    return {
      ...query,
      orderBy: () => query,
      doc: (id) => docRef(col, id),
      async add(data) { const id = 'test' + Math.random().toString(36).slice(2, 12); await docRef(col, id).set(data); return { id }; },
    };
  }
  const firestore = {
    collection: colRef,
    batch() {
      const ops = [];
      return {
        set: (ref, d, o) => ops.push(() => ref.set(d, o)),
        update: (ref, d) => ops.push(() => ref.update(d)),
        delete: (ref) => ops.push(() => ref.delete()),
        async commit() { for (const op of ops) await op(); },
      };
    },
  };

  /* ---------- sandbox auth: only the test coach exists ---------- */
  const COACH_EMAIL = 'kaviraja391@gmail.com'; // the portal's admin check expects this address
  const listeners = [];
  const auth = {
    currentUser: null,
    async signInWithEmailAndPassword(email, password) {
      await pause();
      if (String(email).toLowerCase() !== COACH_EMAIL || password !== window.hhTestMode.credentials.coachPassword) {
        throw Object.assign(new Error('Invalid test credentials'), { code: 'auth/invalid-credential' });
      }
      auth.currentUser = { email: COACH_EMAIL, displayName: 'Test coach', getIdToken: async () => 'test-mode-token' };
      listeners.forEach((l) => l(auth.currentUser));
      return { user: auth.currentUser };
    },
    async signOut() { auth.currentUser = null; listeners.forEach((l) => l(null)); },
    async sendPasswordResetEmail() { await pause(); },
    onAuthStateChanged(cb) { listeners.push(cb); setTimeout(() => cb(auth.currentUser)); return () => {}; },
  };
  const firestoreFn = () => firestore;
  firestoreFn.FieldValue = {
    serverTimestamp: () => ({ __fv: 'ts' }),
    arrayUnion: (...items) => ({ __fv: 'union', items }),
    arrayRemove: (...items) => ({ __fv: 'remove', items }),
  };
  window.firebase = { apps: [], initializeApp() { this.apps.push({}); return {}; }, auth: () => auth, firestore: firestoreFn };

  /* ---------- sample data (first entry into test mode) ---------- */
  if (!localStorage.getItem(DB_KEY)) {
    const pad = (n) => String(n).padStart(2, '0');
    const daysAgo = (n) => new Date(Date.now() - n * 864e5);
    const dmy = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    const series = (start, step, weeks, by) => Array.from({ length: weeks }, (_, i) => {
      const d = daysAgo((weeks - 1 - i) * 7 + 1);
      return { date: dmy(d), weight: Math.round((start + step * i + (i % 2 ? 0.2 : -0.1)) * 10) / 10, waist: '', enteredBy: i === 0 ? 'Intake form' : by, enteredAt: d.toISOString(), id: `seed-${start}-${i}` };
    });
    const now = new Date().toISOString();
    const clients = {
      test1: {
        name: 'Test Client', originalSlot: 'fitclient1', phone: '9876543210', email: 'test.client@example.com', goal: 'Fat loss',
        diet: 'Daily targets: ~1600 kcal · 120 g protein · 3 L water\n• Waking Up: Warm water with lemon + 5 soaked almonds\n• Breakfast: 1 whole egg + 3 egg whites omelette, 1 multigrain toast\n• Mid-morning: 1 fruit (apple / guava / orange)\n• Lunch: 150 g grilled chicken + 100 g cooked rice + salad + curd\n• Evening: Green tea + 30 g roasted chana\n• Dinner: 150 g fish or chicken + sautéed vegetables\n• Before Bed: 150 ml warm low-fat turmeric milk\n• Notes: 8–10k steps daily. No sugary drinks or fried snacks.',
        progress: series(82, -0.7, 6, 'Client'), targetWeight: 75, targetSetAt: daysAgo(40).toISOString(),
        dietUpdatedAt: daysAgo(3).toISOString(), createdAt: daysAgo(40).toISOString(),
        dietHistory: [{ diet: '• Waking Up: Warm water\n• Breakfast: Poha (1 plate)\n• Lunch: Dal, rice, salad\n• Dinner: Roti + sabzi', at: daysAgo(40).toISOString() }],
      },
      arjun2468: {
        name: 'Arjun Mehta', originalSlot: 'fitclient2', phone: '9123456780', email: 'arjun@example.com', goal: 'Muscle gain',
        diet: 'Daily targets: ~2600 kcal · 160 g protein · 4 L water\n• Breakfast: 4 egg omelette + 2 toast + 1 glass milk\n• Lunch: 200 g chicken + 150 g rice + dal + salad\n• Post-workout: 1 scoop whey + banana\n• Dinner: 200 g paneer + 2 roti + vegetables',
        progress: series(68, 0.5, 5, 'Admin').map((p, i) => (i % 2 ? { ...p, enteredBy: 'Client' } : p)), targetWeight: 72, targetSetAt: daysAgo(30).toISOString(),
        dietUpdatedAt: daysAgo(12).toISOString(), createdAt: daysAgo(30).toISOString(),
      },
    };
    const portal = (k, r) => ({ name: r.name, diet: r.diet, slot: r.originalSlot, dietUpdatedAt: r.dietUpdatedAt, targetWeight: r.targetWeight, targetSetAt: r.targetSetAt, progress: r.progress, updatedAt: now });
    const lead = (id, name, phone, email, goal, specific, notes, days, status) => ({
      '1_Full_Name': name, '2_Age': '29', '3_Gender': 'Female', '4_Phone_Number': phone, '5_Gmail_ID': email, '7_Current_Location': 'Chennai',
      '9_Weight': '74', '44_Primary_Goal': goal, '45_Specific_Goal': specific, '46_Goal_Timeline': '3–6 months', '53_Additional_Info': notes,
      applicantId: id, submittedAt: daysAgo(days).toISOString(), ...(status ? { leadStatus: status, leadStatusAt: daysAgo(days - 1).toISOString() } : {}),
    });
    write({
      portalData: { main: { database: clients, updatedAt: now, updatedBy: COACH_EMAIL } },
      clientPortals: { test1: portal('test1', clients.test1), arjun2468: portal('arjun2468', clients.arjun2468) },
      clientIntakes: {
        'HH-N3HA42': lead('HH-N3HA42', 'Neha Kapoor', '9988776655', 'neha@example.com', 'Fat loss', 'Lose 8 kg and feel fitter', 'Works night shifts, prefers home workouts', 2, null),
        'HH-R4HUL7': lead('HH-R4HUL7', 'Rahul Verma', '9090909090', 'rahul@example.com', 'Strength building', 'Deadlift 120 kg', 'Old shoulder injury (left)', 5, 'Contacted'),
      },
    });
  }
})();
