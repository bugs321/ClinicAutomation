/**
 * AIA eligibility-portal adapter.
 *
 * Every adapter's job is the same: take an NRIC/FIN, drive that insurer's
 * portal, and return data in the STANDARD SCHEMA (see ../schema.md) so the
 * clinic front-end never has to know which insurer it's talking to.
 *
 * This one targets the demo portal at https://test-ins-app.lovable.app/,
 * which is a single-page lookup (no login step) — enter NRIC, click
 * "Check eligibility", read the result panel.
 *
 * Requires: npm i playwright   (then: npx playwright install chromium)
 */

const { chromium } = require('playwright');

const PORTAL_URL = 'https://test-ins-app.lovable.app/';

async function lookup(nric) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle' });

    await page.getByPlaceholder('S1234567D').fill(nric);
    await page.getByRole('button', { name: /check eligibility/i }).click();

    // The result panel only renders once a matching record is found.
    const found = await page
      .getByText('SUM INSURED')
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (!found) {
      await browser.close();
      return { status: 'not_found', insurer: { code: 'aia', name: 'AIA', portalUrl: PORTAL_URL } };
    }

    const text = await page.locator('main').innerText();
    const result = parseResultText(text, nric);
    await browser.close();
    return result;

  } catch (err) {
    await browser.close();
    return { status: 'error', insurer: { code: 'aia', name: 'AIA', portalUrl: PORTAL_URL }, message: err.message };
  }
}

/** Turns the portal's plain-text result panel into the standard schema. */
function parseResultText(text, nric) {
  const money = (label) => {
    const m = text.match(new RegExp(label + '\\s*\\$([\\d,]+)', 'i'));
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  const line = (label) => {
    const m = text.match(new RegExp(label + '\\s*\\n?\\s*([^\\n]+)', 'i'));
    return m ? m[1].trim() : null;
  };
  const name = text.split('\n').find(l => l && !l.includes('NRIC') && !l.includes('Check patient'))?.trim();

  const exclusions = text
    .split('EXCLUSIONS')[1]
    ?.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('For demonstration')) || [];

  return {
    status: 'success',
    patient: { nricMasked: nric.replace(/^(.)(\d{2})\d{3}(.*)$/, '$1**$2$3'), name: name || null },
    insurer: { code: 'aia', name: 'AIA', portalUrl: PORTAL_URL },
    policy: {
      number: line('Policy number'),
      planName: line('AIA HealthShield.*'),
      statusLabel: text.includes('Active') ? 'Active' : 'Unknown',
      effectiveDate: line('Effective date'),
      renewalDate: line('Renewal date'),
    },
    coverage: {
      currency: 'SGD',
      sumInsured: money('SUM INSURED'),
      utilisedAmount: money('UTILISED AMOUNT'),
      remainingBalance: money('REMAINING BALANCE'),
      utilisationPct: Number(line('Annual limit utilisation')?.replace('%', '')) || null,
    },
    coPayment: [
      { label: 'Panel clinic co-payment', value: line('Panel clinic co-payment') },
      { label: 'Non-panel co-insurance', value: line('Non-panel co-insurance') },
      { label: 'Annual deductible', value: line('Annual deductible') },
    ].filter(x => x.value),
    exclusions,
    scannedAt: new Date().toISOString(),
  };
}

module.exports = { code: 'aia', name: 'AIA', portalUrl: PORTAL_URL, lookup };
