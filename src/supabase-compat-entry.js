import { createClient } from '@supabase/supabase-js';

/* Supabase backend for the portal page.
 *
 * The portal scripts were written against Firebase's document API (collection/doc,
 * get/set/update/delete, onSnapshot, batch, FieldValue). This module offers the same calls
 * on top of Supabase: documents live in public.hh_documents and every read or write goes
 * through the hh_* SQL functions in supabase/schema.sql, which enforce who may do what.
 * Error codes are translated to the Firebase-style codes the portal already handles.
 */

const POLL_DOC_MS = 5000;
const POLL_COLLECTION_MS = 8000;

function storeError(error) {
  const sqlCode = error && error.code;
  const message = (error && error.message) || 'Database request failed';
  let code = 'unknown';
  if (sqlCode === '42501') code = 'permission-denied';
  else if (sqlCode === 'P0002') code = 'not-found';
  else if (sqlCode === '23505') code = 'already-exists';
  else if (sqlCode === '22023') code = 'invalid-argument';
  else if (!sqlCode && /fetch|network|load failed/i.test(message)) code = 'unavailable';
  return Object.assign(new Error(message), { code, sqlCode });
}

function authError(error) {
  const message = (error && error.message) || 'Sign-in failed';
  let code = 'auth/unknown';
  if (error && (error.code === 'invalid_credentials' || /invalid login credentials/i.test(message))) code = 'auth/invalid-credential';
  else if (error && error.code === 'email_not_confirmed') code = 'auth/email-not-confirmed';
  else if (error && (error.status === 0 || /fetch|network/i.test(message))) code = 'auth/network-request-failed';
  else if (error && error.status === 429) code = 'auth/too-many-requests';
  return Object.assign(new Error(message), { code });
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const snapDoc = (id, data) => ({ id, exists: data != null, data: () => (data == null ? undefined : clone(data)) });
const querySnap = (rows) => {
  const docs = rows.map((r) => snapDoc(r.id, r.data));
  return { docs, size: docs.length, empty: !docs.length, forEach: (fn) => docs.forEach(fn) };
};

// Live listeners poll a small fingerprint (hh_stamp) and download the data only when it
// changed; they report only when the data actually changed. Without hh_stamp in the
// database (schema.sql not re-run yet) every tick downloads the data, as before.
function poll(stamp, load, intervalMs, onNext, onError) {
  let last = null;
  let lastStamp = null;
  let stopped = false;
  let failedOnce = false;
  const tick = async () => {
    if (stopped || (typeof document !== 'undefined' && document.hidden && last !== null)) return;
    try {
      let current = null;
      try { current = await stamp(); } catch (e) { if (e.sqlCode !== 'PGRST202') throw e; }
      if (current !== null && current === lastStamp && last !== null) return;
      const { sig, value } = await load();
      lastStamp = current;
      if (!stopped && sig !== last) { last = sig; onNext(value); }
    } catch (e) {
      // The first failure goes to the caller (it may fall back); later ones are retried quietly.
      if (!failedOnce && onError) { failedOnce = true; stopped = true; clearInterval(timer); onError(e); }
      else console.warn('Live update failed; retrying.', e);
    }
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  const onVisible = () => { if (!document.hidden) tick(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
}

function init({ url, anonKey, adminEmail }) {
  const client = createClient(url, anonKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  async function rpc(name, args) {
    let result;
    try { result = await client.rpc(name, args); } catch (e) { throw storeError(e); }
    if (result.error) throw storeError(result.error);
    return result.data;
  }

  /* ---------- documents ---------- */
  function docRef(collection, id) {
    const get = async () => snapDoc(id, await rpc('hh_get', { p_collection: collection, p_id: id }));
    return {
      id,
      get,
      set: (data, options) => rpc('hh_write', { p_collection: collection, p_id: id, p_data: clone(data), p_mode: options && options.merge ? 'merge' : 'set' }),
      update: (data) => rpc('hh_write', { p_collection: collection, p_id: id, p_data: clone(data), p_mode: 'update' }),
      delete: () => rpc('hh_delete', { p_collection: collection, p_id: id }),
      onSnapshot: (onNext, onError) => poll(() => rpc('hh_stamp', { p_collection: collection, p_id: id }), async () => {
        const snap = await get();
        return { sig: JSON.stringify(snap.exists ? snap.data() : null), value: snap };
      }, POLL_DOC_MS, onNext, onError),
    };
  }
  function collectionRef(collection, order) {
    const list = async () => {
      const rows = (await rpc('hh_list', { p_collection: collection })) || [];
      if (order) {
        const dir = order.dir === 'desc' ? -1 : 1;
        rows.sort((a, b) => dir * String((a.data || {})[order.field] ?? '').localeCompare(String((b.data || {})[order.field] ?? '')));
      }
      return rows;
    };
    return {
      get: async () => querySnap(await list()),
      orderBy: (field, dir = 'asc') => collectionRef(collection, { field, dir }),
      doc: (id) => docRef(collection, id),
      async add(data) {
        const id = crypto.randomUUID();
        await docRef(collection, id).set(data);
        return { id };
      },
      onSnapshot: (onNext, onError) => poll(() => rpc('hh_stamp', { p_collection: collection }), async () => {
        const rows = await list();
        return { sig: JSON.stringify(rows), value: querySnap(rows) };
      }, POLL_COLLECTION_MS, onNext, onError),
    };
  }
  const store = {
    collection: (name) => collectionRef(name),
    batch() {
      const ops = [];
      return {
        set: (ref, data, options) => { ops.push(() => ref.set(data, options)); },
        update: (ref, data) => { ops.push(() => ref.update(data)); },
        delete: (ref) => { ops.push(() => ref.delete()); },
        async commit() { for (const op of ops) await op(); },
      };
    },
  };

  const FieldValue = {
    serverTimestamp: () => ({ __hh: 'ts' }),
    arrayUnion: (...items) => ({ __hh: 'union', items }),
    arrayRemove: (...items) => ({ __hh: 'remove', items }),
  };

  /* ---------- coach sign-in ---------- */
  const listeners = [];
  const toUser = (session) => (session && session.user ? {
    uid: session.user.id,
    email: session.user.email || '',
    getIdToken: async () => {
      const { data } = await client.auth.getSession();
      if (!data.session) throw Object.assign(new Error('Signed out'), { code: 'auth/user-token-expired' });
      return data.session.access_token;
    },
  } : null);
  const auth = {
    currentUser: null,
    async signInWithEmailAndPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw authError(error);
      auth.currentUser = toUser(data.session);
      return { user: auth.currentUser };
    },
    async signOut() {
      await client.auth.signOut();
      auth.currentUser = null;
    },
    async sendPasswordResetEmail(email) {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
      if (error) throw authError(error);
    },
    onAuthStateChanged(cb) {
      listeners.push(cb);
      setTimeout(() => cb(auth.currentUser), 0);
      return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
    },
  };

  client.auth.onAuthStateChange((event, session) => {
    const user = toUser(session);
    const changed = (auth.currentUser && auth.currentUser.email) !== (user && user.email);
    auth.currentUser = user;
    if (changed) listeners.forEach((cb) => setTimeout(() => cb(user), 0));
    if (event === 'PASSWORD_RECOVERY') setTimeout(() => choosePassword(session), 300);
  });

  // The coach followed a password reset link: ask for the new password right away.
  async function choosePassword(session) {
    if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + '#coach-login');
    for (;;) {
      const first = window.prompt(`Choose a new password for ${(session && session.user && session.user.email) || adminEmail} (at least 8 characters):`);
      if (first == null) return;
      if (first.length < 8) { window.alert('The password must be at least 8 characters.'); continue; }
      if (window.prompt('Type the new password again:') !== first) { window.alert("The passwords didn't match. Try again."); continue; }
      const { error } = await client.auth.updateUser({ password: first });
      if (error) { window.alert('The password could not be changed: ' + error.message); return; }
      await client.auth.signOut();
      window.alert('Password changed. Sign in with your new password.');
      return;
    }
  }

  return { auth, store, FieldValue, client };
}

window.hhBackend = { init };
