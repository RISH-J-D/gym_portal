import React, { useState, useEffect } from 'react';
import { emailDietPlan } from '../utils/mail';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

export default function ClientDashboard() {
  const [clientId, setClientId] = useState('');
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchClient = async (id) => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await getDoc(doc(db, 'clients', id));
      if (!snapshot.exists()) {
        setError('Client not found');
        setClient(null);
      } else {
        setClient({ id, ...snapshot.data() });
      }
    } catch (e) {
      console.error(e);
      setError('Failed to load client');
    }
    setLoading(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (clientId) fetchClient(clientId);
  };

  return (
    <section style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Client Dashboard</h2>
      <form onSubmit={handleSubmit} style={{ marginBottom: '1rem' }}>
        <label>Enter your client ID (password): </label>
        <input
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          required
          style={{ marginLeft: '0.5rem' }}
        />
        <button type="submit" disabled={loading} style={{ marginLeft: '0.5rem' }}>
          {loading ? 'Loading…' : 'View'}
        </button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {client && (
                <div style={{ border: '1px solid #444', padding: '1rem', borderRadius: '12px', backdropFilter: 'blur(12px)', background: 'rgba(255,255,255,0.05)' }}>
          <h3>{client.name}</h3>
          <h4>Diet Plan</h4>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{client.diet}</pre>
          <button onClick={() => {
            navigator.clipboard.writeText(client.diet).then(()=>alert('Diet copied!')).catch(()=>alert('Copy failed'));
          }} style={{ marginTop: '0.5rem' }}>Copy Diet Plan</button>
          <button onClick={() => emailDietPlan(client)} style={{ marginTop: '0.5rem', marginLeft: '0.5rem' }}>Email Diet Plan</button>
          <h4 style={{ marginTop: '1rem' }}>Progress</h4>
          <h3>{client.name}</h3>
          <h4>Diet Plan</h4>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{client.diet}</pre>
          <h4>Progress</h4>
          {client.progress && client.progress.length > 0 ? (
            <ul>
              {client.progress.map((log, idx) => (
                <li key={idx}>
                  {log.date} – {log.weight}kg{log.waist ? ` / ${log.waist}cm` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p>No progress logged yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
