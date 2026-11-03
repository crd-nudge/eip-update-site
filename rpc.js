// POST /api/rpc  { fn, token, args }
// Forwards to the Apps Script web app (server-to-server) and returns its JSON.
// The Apps Script backend does all authentication and permission checks;
// this file only relays and adds basic hygiene (method/size/shape checks).

const EXEC_URL = process.env.APPS_SCRIPT_EXEC_URL || '';
const MAX_BODY = 20000; // bytes; the largest legitimate request is a comment

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!EXEC_URL) return res.status(500).json({ success: false, error: 'APPS_SCRIPT_EXEC_URL is not set in Vercel.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body.fn !== 'string' || !/^[A-Za-z]{2,40}$/.test(body.fn)) {
    return res.status(400).json({ success: false, error: 'Bad request.' });
  }
  const payload = { fn: body.fn, token: typeof body.token === 'string' ? body.token.slice(0, 200) : null, args: Array.isArray(body.args) ? body.args : [] };
  const text = JSON.stringify(payload);
  if (text.length > MAX_BODY) return res.status(413).json({ success: false, error: 'Request too large.' });

  try {
    const upstream = await fetch(EXEC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: text,
      redirect: 'follow',
    });
    const out = await upstream.text();
    let json;
    try { json = JSON.parse(out); } catch (e) {
      return res.status(502).json({ success: false, error: 'The data service sent an unexpected reply. Please try again.' });
    }
    return res.status(200).json(json);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ success: false, error: 'Could not reach the data service.' });
  }
};
