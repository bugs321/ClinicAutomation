/**
 * Eligibility scan API.
 *
 * POST /api/eligibility  { nric: "S1234567D", insurer: "aia" }
 * -> returns the standard schema (see schema.md) regardless of which
 *    insurer portal it came from.
 *
 * To add a new insurer's portal later:
 *   1. Create server/adapters/<code>.js exporting { code, name, lookup(nric) }
 *      that resolves to the standard schema.
 *   2. Add it to the `adapters` map below.
 *   3. Add an <option> for it in the front-end's insurer <select>.
 * Nothing else changes — the UI and this route are provider-agnostic.
 *
 * Requires: npm i express playwright   (then: npx playwright install chromium)
 */

const express = require('express');
const aia = require('./adapters/aia');

const adapters = {
  aia,
  // greateastern: require('./adapters/greateastern'),
  // prudential:  require('./adapters/prudential'),
  // ntuc:        require('./adapters/ntuc'),
};

const app = express();
app.use(express.json());

const NRIC_RE = /^[STFG]\d{7}[A-Z]$/i;

app.post('/api/eligibility', async (req, res) => {
  const { nric, insurer } = req.body || {};

  if (!nric || !NRIC_RE.test(nric)) {
    return res.status(400).json({ status: 'error', message: 'Invalid NRIC/FIN format.' });
  }
  const adapter = adapters[insurer];
  if (!adapter) {
    return res.status(400).json({ status: 'error', message: `No adapter configured for insurer "${insurer}".` });
  }

  try {
    const result = await adapter.lookup(nric.toUpperCase());
    res.json(result);
  } catch (err) {
    res.status(502).json({ status: 'error', message: 'Portal scan failed.', detail: err.message });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`Eligibility API listening on :${PORT}`));
