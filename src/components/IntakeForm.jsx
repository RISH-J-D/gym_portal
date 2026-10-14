import React, { useState } from 'react';
import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

export default function IntakeForm() {
  const [formData, setFormData] = useState({
    '1_Full_Name': '',
    '4_Phone_Number': '',
    email: '',
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData['1_Full_Name'] || !formData['4_Phone_Number']) {
      alert('Full name and phone are required');
      return;
    }
    setSubmitting(true);
    try {
      const data = {
        ...formData,
        submittedAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'clientIntakes'), data);
      alert('✅ Form submitted successfully!');
      setFormData({
        '1_Full_Name': '',
        '4_Phone_Number': '',
        email: '',
        notes: ''
      });
    } catch (err) {
      console.error(err);
      alert('❌ Submission failed: ' + (err.message || err));
    }
    setSubmitting(false);
  };

  return (
    <section style={{ padding: '2rem', maxWidth: '500px', margin: '0 auto' }}>
      <h2>Client Intake Form</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '0.5rem' }}>
          <label>Full Name</label>
          <input
            type="text"
            name="1_Full_Name"
            value={formData['1_Full_Name']}
            onChange={handleChange}
            required
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: '0.5rem' }}>
          <label>Phone Number</label>
          <input
            type="tel"
            name="4_Phone_Number"
            value={formData['4_Phone_Number']}
            onChange={handleChange}
            required
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: '0.5rem' }}>
          <label>Email (optional)</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: '0.5rem' }}>
          <label>Notes / Goals</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            rows={3}
            style={{ width: '100%' }}
          />
        </div>
        <button type="submit" disabled={submitting} style={{ padding: '0.5rem 1rem' }}>
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </form>
    </section>
  );
}
