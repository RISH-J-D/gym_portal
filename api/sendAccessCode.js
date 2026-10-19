// Vercel Serverless Function – emails a client their portal access code.
//
// Only the signed-in coach can call it: the request must carry the coach's Supabase access
// token, which Supabase Auth confirms. The message is a fixed template, so the endpoint
// cannot be used to send arbitrary email.
//
// Environment (Vercel dashboard): SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
// (Mailjet: host in-v3.mailjet.com, user = API key, pass = secret key, from = a validated sender)
// Optional: PORTAL_URL (public site address), COACH_EMAIL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
import nodemailer from 'nodemailer';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hubwfjfrhccwfdprxyho.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_tj5iI9DPPT7OSkzr1PDddQ_F4P5AaxH';
const COACH_EMAIL = (process.env.COACH_EMAIL || 'kaviraja391@gmail.com').toLowerCase();

// Returns the signed-in user's email, or null when the token is missing, expired or invalid.
async function verifiedEmail(token) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  if (!resp.ok) return null;
  const user = await resp.json().catch(() => null);
  return user && user.email ? String(user.email).toLowerCase() : null;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function validateRequest(body) {
  const { to, name, code } = body || {};
  if (typeof to !== 'string' || to.length > 254 || !EMAIL_RE.test(to.trim())) return 'A valid client email address is required.';
  if (typeof name !== 'string' || !name.trim() || name.length > 80) return 'Client name is required (max 80 characters).';
  // Reject control characters (header injection) and "/" (not allowed in document IDs).
  // oxlint-disable-next-line no-control-regex
  if (typeof code !== 'string' || !code.trim() || code.length > 64 || /[\u0000-\u001f/]/.test(code)) return 'A valid access code is required.';
  return null;
}

export function buildAccessEmail({ name, code, portalUrl }) {
  const first = name.trim().split(/\s+/)[0];
  const loginUrl = `${portalUrl.replace(/\/+$/, '')}/#client-login`;
  const subject = 'Your Heaven & Hell client portal access';
  const text = [
    `Hi ${first},`,
    '',
    'Your coach has set up your Heaven & Hell client portal. Your diet plan is ready, and you can log your weight check-ins there.',
    '',
    `Your access code: ${code}`,
    '',
    `Log in: ${loginUrl}`,
    '1. Open the link above (or the site, then "Client login").',
    '2. Enter your access code.',
    '',
    'Keep this code private — it is your login.',
    '',
    '— Coach Kavi, Heaven & Hell Fitness',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;">
        <tr><td style="background:#0d0f14;padding:22px 28px;color:#ffffff;font-size:15px;font-weight:bold;letter-spacing:2px;">HEAVEN <span style="color:#e11d48;">&amp;</span> HELL</td></tr>
        <tr><td style="padding:28px;color:#18181b;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 14px;font-size:20px;font-weight:bold;">Hi ${escapeHtml(first)}, your portal is ready</p>
          <p style="margin:0 0 22px;color:#3f3f46;">Your coach has set up your client portal. Your diet plan is there, and you can log your weight check-ins.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
            <tr><td align="center" style="border:1px dashed #e11d48;border-radius:10px;padding:18px;">
              <div style="font-size:11px;letter-spacing:2px;color:#71717a;text-transform:uppercase;margin-bottom:6px;">Your access code</div>
              <div style="font-family:'Courier New',monospace;font-size:28px;font-weight:bold;letter-spacing:3px;color:#18181b;">${escapeHtml(code)}</div>
            </td></tr>
          </table>
          <p style="margin:0 0 22px;text-align:center;">
            <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#e11d48;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:9px;">Open client login</a>
          </p>
          <p style="margin:0 0 6px;color:#3f3f46;">Open the link, choose <strong>Client login</strong> and enter your code.</p>
          <p style="margin:0;color:#71717a;font-size:13px;">Keep this code private — it is your login.</p>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px;">Coach Kavi · Heaven &amp; Hell Fitness</td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
  return { subject, text, html };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Coach sign-in required.' });
  let email;
  try {
    email = await verifiedEmail(token);
  } catch {
    return res.status(503).json({ error: 'Could not check your coach session. Try again.' });
  }
  if (!email) return res.status(401).json({ error: 'Your coach session has expired. Sign in again.' });
  if (email !== COACH_EMAIL) return res.status(403).json({ error: 'Only the coach account can send access codes.' });

  const problem = validateRequest(req.body);
  if (problem) return res.status(400).json({ error: problem });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !EMAIL_RE.test(from || '')) return res.status(503).json({ error: 'Email is not configured on the server (SMTP settings missing).' });

  const { to, name, code } = req.body;
  const portalUrl = process.env.PORTAL_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const { subject, text, html } = buildAccessEmail({ name, code, portalUrl });

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  try {
    await transporter.sendMail({
      from: `"Heaven & Hell Fitness" <${from}>`,
      replyTo: COACH_EMAIL,
      to: to.trim(),
      subject,
      text,
      html,
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Access code email failed:', error);
    return res.status(502).json({ error: 'The email could not be sent. Check the SMTP settings and try again.' });
  }
}
