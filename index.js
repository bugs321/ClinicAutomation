/**
 * Eligibility scan API + static file server.
 *
 * POST /api/eligibility  { nric, policyNumber, tpa, patientName? }
 * -> returns the standard schema (see ../README.md) regardless of which
 *    TPA portal it came from. The TPA's portal URL is looked up from
 *    Credconfig.xml (see credentials.js) by the "tpa" code — it's never
 *    sent by the client.
 *
 * To add a new TPA's portal later:
 *   1. Add its <tpa code="..."> entry (name, loginId, password, url) to
 *      Credconfig.xml.
 *   2. Create server/adapters/<code>.js exporting { code, name, lookup(nric,
 *      policyNumber, patientName) } that resolves to the standard schema,
 *      using getTpaCredential('<code>') to read its URL/login from
 *      Credconfig.xml.
 *   3. Add it to the `adapters` map below.
 *   4. Add an <option> for it in index.html's TPA <select>, and remove it
 *      from the client-side "not connected" placeholder list there.
 * The UI and this route never change — every adapter speaks the same
 * schema.
 *
 * Requires: npm i express playwright   (then: npx playwright install chromium)
 */

const path = require('path');
const express = require('express');
const mhc = require('./adapters/mhc');
const alliance = require('./adapters/alliance');

const adapters = {
  mhc,
  alliance,
  // ihp:       require('./adapters/ihp'),
  // fullerton: require('./adapters/fullerton'),
  // ixchange:  require('./adapters/ixchange'),
  // raffles:   require('./adapters/raffles'),
  // adept:     require('./adapters/adept'),
};

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

const NRIC_RE = /^[STFG]\d{7}[A-Z]$/i;

app.post('/api/eligibility', async (req, res) => {
  const { nric, policyNumber, tpa, patientName } = req.body || {};

  if (!nric || !NRIC_RE.test(nric)) {
    return res.status(400).json({ status: 'error', message: 'Invalid NRIC/FIN format.' });
  }
  if (!policyNumber) {
    return res.status(400).json({ status: 'error', message: 'Policy number is required.' });
  }
  const adapter = adapters[tpa];
  if (!adapter) {
    return res.status(400).json({ status: 'error', message: `No live adapter configured for TPA "${tpa}".` });
  }

  try {
    const result = await adapter.lookup(nric.toUpperCase(), policyNumber, patientName);
    res.json(result);
  } catch (err) {
    res.status(502).json({ status: 'error', message: 'Portal scan failed.', detail: err.message });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`Eligibility API + site listening on http://localhost:${PORT}`));
