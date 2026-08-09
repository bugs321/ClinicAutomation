/**
 * MHC eligibility-portal adapter.
 *
 * Target: the URL configured for "mhc" in Credconfig.xml
 * (demo: https://test-mhc-demo.lovable.app/eligibility — "MediPanel Asia
 * Clinic Portal"). This portal's form asks for three fields: Policy
 * number, Singapore NRIC/FIN, and Patient full name — all three must be
 * filled or its own client-side validation blocks submission.
 *
 * The clinic intake form collects NRIC/FIN and policy number as required
 * fields; patient name is collected as an optional third field specifically
 * because this portal needs it (see index.html). If no name is supplied,
 * this adapter returns a clear "name required" error rather than a
 * confusing silent failure.
 *
 * Requires: npm i playwright   (then: npx playwright install chromium)
 */

const { chromium } = require('playwright');
const { getTpaCredential } = require('../credentials');

async function lookup(nric, policyNumber, patientName) {
  const cred = getTpaCredential('mhc');
  if (!cred) {
    return { status: 'error', insurer: { code: 'mhc', name: 'MHC', portalUrl: null }, message: 'No URL configured for MHC in Credconfig.xml.' };
  }
  if (!patientName) {
    return {
      status: 'error',
      insurer: { code: 'mhc', name: 'MHC', portalUrl: cred.url },
      message: "MHC's portal also requires the patient's full name (exactly as on the member card). Enter it in the optional Patient name field and try again.",
    };
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(cred.url, { waitUntil: 'networkidle' });

    await page.getByLabel(/policy number/i).fill(policyNumber);
    await page.getByLabel(/nric.*fin/i).fill(nric);
    await page.getByLabel(/patient full name/i).fill(patientName);
    await page.getByRole('button', { name: /check eligibility/i }).click();

    const found = await page
      .getByText('SUM INSURED')
      .waitFor({ timeout: 6000 })
      .then(() => true)
      .catch(() => false);

    if (!found) {
      await browser.close();
      return { status: 'not_found', insurer: { code: 'mhc', name: 'MHC', portalUrl: cred.url } };
    }

    const text = await page.locator('main').innerText();
    const result = parseResultText(text, nric, cred.url);
    await browser.close();
    return result;

  } catch (err) {
    await browser.close();
    return { status: 'error', insurer: { code: 'mhc', name: 'MHC', portalUrl: cred.url }, message: err.message };
  }
}

function parseResultText(text, nric, portalUrl) {
  const money = (label) => {
    const m = text.match(new RegExp(label + '\\s*\\$([\\d,.]+)', 'i'));
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  const line = (label) => {
    const m = text.match(new RegExp(label + '\\s*\\n?\\s*([^\\n]+)', 'i'));
    return m ? m[1].trim() : null;
  };
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const name = lines.find(l => l && !l.includes('NRIC') && !l.includes('Patient eligibility'));

  const utilPctMatch = text.match(/([\d.]+)%\s+of the annual limit/i);
  const coPayLine = line('CO-PAYMENT');
  const appliesTo = line('Applies to:');
  const coPaySummary = [coPayLine, appliesTo ? `Applies to: ${appliesTo}` : null].filter(Boolean).join(' — ');

  const exclusions = (text.split('EXCLUSIONS')[1] || '')
    .split(/SPECIAL REMARKS|$/)[0]
    .split('\n').map(l => l.trim()).filter(Boolean);

  const remarks = (text.split('SPECIAL REMARKS')[1] || '')
    .split('\n\n')[0]
    .split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('Eligibility last updated'));

  const specialNotes = [
    ...exclusions.map(e => `Exclusion: ${e}`),
    ...remarks,
  ];

  return {
    status: 'success',
    patient: { nricMasked: nric.replace(/^(.)\d{4}(\d{3}.)$/, '$1****$2'), name: name || null },
    insurer: { code: 'mhc', name: 'MHC', portalUrl },
    policy: {
      number: line('Policy'),
      planName: line('NRIC/FIN.*Policy [^\\n]*\\n?')?.split('·')[0]?.trim() || null,
      statusLabel: text.includes('ACTIVE') ? 'Active' : 'Unknown',
      effectiveDate: line('Cover period')?.split('–')[0]?.trim() || null,
      renewalDate: line('Cover period')?.split('–')[1]?.trim() || null,
    },
    coverage: {
      currency: 'SGD',
      sumInsured: money('SUM INSURED'),
      utilisedAmount: money('UTILISED AMOUNT'),
      remainingBalance: money('REMAINING BALANCE'),
      utilisationPct: utilPctMatch ? Number(utilPctMatch[1]) : null,
    },
    coPaySummary: coPaySummary || null,
    specialNotes,
    scannedAt: new Date().toISOString(),
  };
}

module.exports = { code: 'mhc', name: 'MHC', lookup };
