/**
 * Alliance eligibility-portal adapter.
 *
 * Target: the URL configured for "alliance" in Credconfig.xml (demo:
 * https://test-ins-app.lovable.app/ — "AIA Clinic Eligibility Portal").
 * No login. The portal requires BOTH NRIC/FIN and policy number to be
 * filled — submitting with either blank is blocked by its own client-side
 * validation, so both fields get filled here before clicking submit.
 * As a second safety net, the policy number the portal returns is also
 * cross-checked against what was entered — if they don't match, that's
 * surfaced as "not_found" rather than silently showing someone else's
 * policy.
 *
 * Requires: npm i playwright   (then: npx playwright install chromium)
 */

const { chromium } = require('playwright');
const { getTpaCredential } = require('../credentials');

async function lookup(nric, policyNumber) {
  const cred = getTpaCredential('alliance');
  if (!cred) {
    return { status: 'error', insurer: { code: 'alliance', name: 'Alliance', portalUrl: null }, message: 'No URL configured for Alliance in Credconfig.xml.' };
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(cred.url, { waitUntil: 'networkidle' });

    const nricField = page.getByPlaceholder(/S1234567D/i);
    const policyField = page.getByPlaceholder(/AIA-P-889201/i);

    // This app briefly resets its form fields while it finishes hydrating
    // right after load — a fill() that lands during that window gets
    // silently wiped. Confirm each field actually holds what we typed
    // before submitting, retrying once after a short wait if not.
    await fillAndVerify(nricField, nric);
    await fillAndVerify(policyField, policyNumber);

    await page.getByRole('button', { name: /check eligibility/i }).click();

    const found = await page
      .getByText('SUM INSURED')
      .waitFor({ timeout: 6000 })
      .then(() => true)
      .catch(() => false);

    if (!found) {
      await browser.close();
      return { status: 'not_found', insurer: { code: 'alliance', name: 'Alliance', portalUrl: cred.url } };
    }

    const text = await page.locator('main').innerText();
    const result = parseResultText(text, nric, cred.url);
    await browser.close();

    if (policyNumber && result.policy.number && result.policy.number.toUpperCase() !== policyNumber.toUpperCase()) {
      return { status: 'not_found', insurer: { code: 'alliance', name: 'Alliance', portalUrl: cred.url } };
    }
    return result;

  } catch (err) {
    await browser.close();
    return { status: 'error', insurer: { code: 'alliance', name: 'Alliance', portalUrl: cred.url }, message: err.message };
  }
}

/** Fills a field, then confirms it stuck; retries once after a beat if the app's own hydration wiped it. */
async function fillAndVerify(locator, value) {
  await locator.fill(value);
  if ((await locator.inputValue()) === value) return;

  await locator.page().waitForTimeout(700);
  await locator.fill(value);
  if ((await locator.inputValue()) !== value) {
    throw new Error('Could not get the portal form to hold the entered value — it kept resetting the field.');
  }
}

function parseResultText(text, nric, portalUrl) {
  const money = (label) => {
    const m = text.match(new RegExp(label + '\\s*\\$([\\d,]+)', 'i'));
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  const line = (label) => {
    const m = text.match(new RegExp(label + '\\s*\\n?\\s*([^\\n]+)', 'i'));
    return m ? m[1].trim() : null;
  };
  const name = text.split('\n').find(l => l && !l.includes('NRIC') && !l.includes('Check patient'))?.trim();
  const planNameMatch = text.match(/NRIC\s*\/\s*FIN[^\n]*·\s*([^\n]+)/i);

  const exclusions = text
    .split('EXCLUSIONS')[1]
    ?.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('For demonstration')) || [];

  const panelCoPay = line('Panel clinic co-payment');
  const nonPanel = line('Non-panel co-insurance');
  const coPaySummary = [panelCoPay, nonPanel ? `${nonPanel} (non-panel)` : null].filter(Boolean).join(' — ');

  return {
    status: 'success',
    patient: { nricMasked: nric.replace(/^(.)\d{4}(\d{3}.)$/, '$1****$2'), name: name || null },
    insurer: { code: 'alliance', name: 'Alliance', portalUrl },
    policy: {
      number: line('Policy number'),
      planName: planNameMatch ? planNameMatch[1].trim() : null,
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
    coPaySummary: coPaySummary || null,
    specialNotes: [
      ...exclusions.map(e => `Exclusion: ${e}`),
      line('Annual deductible') ? `Annual deductible: ${line('Annual deductible')}` : null,
    ].filter(Boolean),
    scannedAt: new Date().toISOString(),
  };
}

module.exports = { code: 'alliance', name: 'Alliance', lookup };
