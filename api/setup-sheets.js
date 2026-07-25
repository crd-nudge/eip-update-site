// GET /api/setup-sheets?secret=...
// Visit this once after deploying to create the Comments/Whitelist/
// AccessRequests tabs in your Sheet (safe to run more than once).
// Proxies to Apps Script's setupSheets(). (Self-contained — no imports
// from other files.)

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
  const requiredSecret = process.env.SETUP_SECRET;
  if (requiredSecret) {
    const provided = (req.query && req.query.secret) || '';
    if (provided !== requiredSecret) {
      res.status(403).json({ error: 'Missing or incorrect ?secret=' });
      return;
    }
  }
  try {
    const data = await callAppsScript('setupSheets', []);
    res.status(200).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: String((e && e.message) || e) });
  }
};
