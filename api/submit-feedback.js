// POST /api/submit-feedback  { name, email, message }
// Proxies to Apps Script's submitFeedback(name, email, message).
// (Self-contained — no imports from other files.)

const EXEC_URL = process.env.APPS_SCRIPT_EXEC_URL || '';

async function callAppsScript(fn, args) {
  if (!EXEC_URL) {
    throw new Error('APPS_SCRIPT_EXEC_URL env var is not set — see DEPLOYMENT_INSTRUCTIONS_VERCEL.md.');
  }
  const res = await fetch(EXEC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn: fn, args: args || [] }),
    redirect: 'follow',
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Unexpected (non-JSON) response from Apps Script: ' + text.slice(0, 300));
  }
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { name, email, message } = req.body || {};
    const data = await callAppsScript('submitFeedback', [name, email, message]);
    res.status(200).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: String((e && e.message) || e) });
  }
};
