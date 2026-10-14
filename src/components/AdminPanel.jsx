import React, { useState, useEffect } from 'react';
import { db, auth, ADMIN_EMAIL } from '../firebase';
import { collection, addDoc, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

// Helper to fetch all client profiles (shared DB)
const fetchClients = async () => {
  const snapshot = await getDocs(collection(db, 'clients'));
  const data = {};
  snapshot.forEach(docSnap => {
    data[docSnap.id] = docSnap.data();
  });
  return data;
};

// Helper to save entire clients object back to Firestore (batch replace)
const saveClients = async (clients) => {
  const batch = [];
  for (const [id, obj] of Object.entries(clients)) {
    batch.push(setDoc(doc(db, 'clients', id), obj));
  }
  await Promise.all(batch);
};

export default function AdminPanel() {
  const [adminPass, setAdminPass] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [error, setError] = useState('');
  const [clients, setClients] = useState({});
  const [loading, setLoading] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const cred = await signInWithEmailAndPassword(auth, adminEmail, adminPass);
      if (cred.user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
        await signOut(auth);
        throw new Error('Not authorized admin account');
      }
      const data = await fetchClients();
      setClients(data);
      setSignedIn(true);
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };

  const handleAddClient = async () => {
    const nextId = `fitclient${Object.keys(clients).length + 1}`;
    const newClient = {
      name: 'New Client Profile Name',
      diet: '• Waking Up:\n• Breakfast:\n• Lunch:\n• Evening:\n• Dinner:',
      originalSlot: nextId,
      progress: [],
    };
    const updated = { ...clients, [nextId]: newClient };
    setLoading(true);
    try {
      await saveClients(updated);
      setClients(updated);
    } catch (e) {
      console.error(e);
      alert('Failed to add client');
    }
    setLoading(false);
  };

  const handleSaveEdits = async () => {
    setLoading(true);
    try {
      await saveClients(clients);
      alert('💾 Changes saved');
    } catch (e) {
      console.error(e);
      alert('Save failed');
    }
    setLoading(false);
  };

  const handleLogAdd = async (clientKey, date, weight, waist) => {
    if (!date || !weight) {
      alert('Date & weight required');
      return;
    }
    const updated = { ...clients };
    if (!updated[clientKey].progress) updated[clientKey].progress = [];
    updated[clientKey].progress.push({
      date,
      weight: Number(weight),
      waist: waist ? Number(waist) : '',
      enteredBy: 'Admin',
      enteredAt: new Date().toISOString(),
    });
    setClients(updated);
    await saveClients(updated);
    alert('Log saved');
  };

  const handleLogDelete = async (clientKey, index) => {
    if (!window.confirm('Delete this log?')) return;
    const updated = { ...clients };
    updated[clientKey].progress.splice(index, 1);
    setClients(updated);
    await saveClients(updated);
    alert('Deleted');
  };

  const handleTargetSave = async (clientKey, target) => {
    if (!target || isNaN(target) || Number(target) <= 0) {
      alert('Enter valid target');
      return;
    }
    const updated = { ...clients };
    updated[clientKey].targetWeight = Number(target);
    setClients(updated);
    await saveClients(updated);
    alert('Target saved');
  };

  if (!signedIn) {
    return (
      <section style={{ padding: '2rem' }}>
        <h2>Admin Sign‑in</h2>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', maxWidth: '300px' }}>
          <label>Email</label>
          <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} required />
          <label>Password</label>
          <input type="password" value={adminPass} onChange={e => setAdminPass(e.target.value)} required />
          <button type="submit" disabled={loading} style={{ marginTop: '1rem' }}>Sign in</button>
        </form>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </section>
    );
  }

  return (
    <section style={{ padding: '2rem' }}>
      <h2>⚡ ADMIN DASHBOARD</h2>
      <button onClick={handleAddClient} disabled={loading}>➕ Add New Client</button>
      <button onClick={handleSaveEdits} disabled={loading} style={{ marginLeft: '1rem' }}>💾 Save All Edits</button>
      <div style={{ marginTop: '2rem' }}>
        {Object.entries(clients).map(([key, client]) => (
          <div key={key} style={{ border: '1px solid #444', padding: '1rem', marginBottom: '1rem', borderRadius: '8px' }}>
            <h3>{client.name}</h3>
            <textarea
              value={client.diet}
              onChange={e => setClients({ ...clients, [key]: { ...client, diet: e.target.value } })}
              rows={6}
              style={{ width: '100%' }}
            />
            <div style={{ marginTop: '0.5rem' }}>
              <label>Target weight (kg)</label>
              <input
                type="number"
                defaultValue={client.targetWeight || ''}
                onBlur={e => handleTargetSave(key, e.target.value)}
                style={{ width: '80px', marginLeft: '0.5rem' }}
              />
            </div>
            <h4>Progress logs</h4>
            {client.progress && client.progress.length > 0 ? (
              client.progress.map((log, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', background: '#222', padding: '0.5rem', marginBottom: '0.3rem' }}>
                  <span>{log.date} – {log.weight}kg{log.waist ? ` / ${log.waist}cm` : ''}</span>
                  <button onClick={() => handleLogDelete(key, idx)} style={{ color: 'red' }}>Delete</button>
                </div>
              ))
            ) : (
              <p>No logs yet.</p>
            )}
            <div style={{ marginTop: '0.5rem' }}>
              <h5>Add Log</h5>
              <input type="date" id={`date-${key}`} />
              <input type="number" placeholder="Weight" id={`weight-${key}`} style={{ width: '80px', marginLeft: '0.5rem' }} />
              <input type="number" placeholder="Waist" id={`waist-${key}`} style={{ width: '80px', marginLeft: '0.5rem' }} />
              <button onClick={() => {
                const d = document.getElementById(`date-${key}`).value;
                const w = document.getElementById(`weight-${key}`).value;
                const wa = document.getElementById(`waist-${key}`).value;
                handleLogAdd(key, d, w, wa);
              }} style={{ marginLeft: '0.5rem' }}>Add</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
