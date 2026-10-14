// Vercel Serverless Function – SMTP email sender
// Install nodemailer in the project: npm i nodemailer
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { to, subject, html } = req.body || {};
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required fields (to, subject, html)' });
  }

  // Create transporter using environment variables (set in Vercel dashboard)
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from: `"Heaven & Hell Fitness" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('SMTP send error:', error);
    return res.status(500).json({ error: 'Failed to send email' });
  }
}
