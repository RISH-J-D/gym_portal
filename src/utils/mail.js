// src/utils/mail.js
/**
 * Simple wrapper that posts to the Vercel SMTP endpoint.
 * Expects an object with `to`, `subject`, and `html` fields.
 */
export const sendMail = async ({ to, subject, html }) => {
  const resp = await fetch('/api/sendMail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, html }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error || 'Mail send failed');
  }
  return resp.json();
};

/**
 * Convenience for sending the client’s diet plan via e‑mail.
 */
export const emailDietPlan = async (client) => {
  if (!client?.email) throw new Error('Client email not available');
  const html = `
    <h2>Hello ${client.name},</h2>
    <p>Here is your personalized diet plan from Heaven & Hell Fitness:</p>
    <pre style="background:#f1f5f9;padding:1rem;border-radius:6px;">${client.diet}</pre>
    <p>Stay healthy! 🚀</p>
    <p>— Heaven & Hell Team</p>
  `;
  await sendMail({ to: client.email, subject: 'Your Diet Plan', html });
};
