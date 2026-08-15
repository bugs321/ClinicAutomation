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
  const log = (...args) => console.log('[alliance]', ...args);

  try {
    log('navigating to', cred.url);
    await page.goto(cred.url, { waitUntil: 'networkidle' });

    const nricField = page.getByPlaceholder(/S1234567D/i);
    const policyField = page.getByPlaceholder(/AIA-P-889201/i);

    // This app briefly resets its form fields while it finishes hydrating
    // right after load — a fill() that lands during that window gets
    // silently wiped. Confirm each field actually holds what we typed
    // before submitting, retrying with backoff if not.
    await fillAndVerify(nricField, nric, log, 'nric');
    await fillAndVerify(policyField, policyNumber, log, 'policy');

    log('clicking Check eligibility');
    await page.getByRole('button', { name: /check eligibility/i }).click();

    const sumInsuredLocator = page.getByText('SUM INSURED').first();
    let waitError = null;
    const found = await sumInsuredLocator
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch((err) => { waitError = err; return false; });

    if (!found) {
      // Capture what the page actually shows so this is diagnosable
      // without needing separate access to Render's log viewer.
      const [nricVal, policyVal] = await Promise.all([
        nricField.inputValue().catch(() => '(unreadable)'),
        policyField.inputValue().catch(() => '(unreadable)'),
      ]);
      const pageSnapshot = await page.locator('main').innerText().catch(() => '(could not read page)');
      log('SUM INSURED never appeared. Field values at timeout:', { nricVal, policyVal });
      log('waitFor error (if any):', waitError ? waitError.message : '(no error — genuinely timed out after 15s)');
      log('Page snapshot at timeout:\n', pageSnapshot);
      await browser.close();
      return {
        status: 'not_found',
        insurer: { code: 'alliance', name: 'Alliance', portalUrl: cred.url },
        debug: {
          fieldsAtTimeout: { nric: nricVal, policyNumber: policyVal },
          waitError: waitError ? waitError.message : null,
          pageTextAtTimeout: pageSnapshot.slice(0, 600),
        },
      };
    }

    // Read the full page text. Don't try to scope this to a "results
    // card" via DOM ancestry — this portal's layout is shallow enough
    // that walking up from any result field's node still pulls in the
    // intro paragraph and the lookup form above it, because there's no
    // wrapping element that contains the results and nothing else.
    // Instead, parseResultText() below always takes the LAST match of
    // each label in the page, since the real results always render
    // after the intro text and the form, in that fixed order.
    const text = await page.locator('main').innerText();
    const result = parseResultText(text, nric, cred.url);
    await browser.close();

    if (policyNumber && result.policy.number && result.policy.number.toUpperCase() !== policyNumber.toUpperCase()) {
      log('scanned policy number', result.policy.number, 'does not match entered', policyNumber);
      return {
        status: 'not_found',
        insurer: { code: 'alliance', name: 'Alliance', portalUrl: cred.url },
        debug: { scannedPolicyNumber: result.policy.number, enteredPolicyNumber: policyNumber },
      };
    }
    return result;

  } catch (err) {
    await browser.close();
    return { status: 'error', insurer: { code: 'alliance', name: 'Alliance', portalUrl: cred.url }, message: err.message };
  }
}

/** Fills a field, confirming it stuck; retries with backoff since this app's
 * own hydration can wipe a fill() that lands too early. Logs each attempt
 * so the Render log viewer shows exactly what happened. */
async function fillAndVerify(locator, value, log, label) {
  const delays = [0, 500, 1000, 2000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await locator.page().waitForTimeout(delays[i]);
    await locator.fill(value);
    const actual = await locator.inputValue();
    log(`fill "${label}" attempt ${i + 1}: wrote "${value}", field now reads "${actual}"`);
    if (actual === value) return;
  }
  throw new Error(`Could not get the "${label}" field to hold "${value}" after ${delays.length} attempts — the portal kept resetting it.`);
}

function parseResultText(text, nric, portalUrl) {
  // Every lookup below takes the LAST match in the page text, not the
  // first. The intro paragraph and the lookup form both render before
  // the results and can incidentally contain a label's wording (e.g. the
  // intro's plain-English sentence "...and policy number to view the sum
  // insured..." literally contains the substring "policy number"; the
  // form has its own bare "Policy number" label with no value after it).
  // The real results always render last on the page, so the last match
  // of any label is the reliable one regardless of what precedes it.
  const lastMatch = (regex) => {
    let m;
    let last = null;
    while ((m = regex.exec(text)) !== null) {
      last = m;
      if (m.index === regex.lastIndex) regex.lastIndex++; // avoid infinite loop on zero-width match
    }
    return last;
  };
  const money = (label) => {
    const m = lastMatch(new RegExp(label + '\\s*\\$([\\d,]+)', 'gi'));
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  const knownLabels = [
    'Policy number', 'Effective date', 'Renewal date', 'Panel clinic co-payment',
    'Non-panel co-insurance', 'Annual deductible', 'Annual limit utilisation',
    'SUM INSURED', 'UTILISED AMOUNT', 'REMAINING BALANCE', 'COVERAGE', 'CO-PAYMENT', 'EXCLUSIONS',
  ];
  const line = (label) => {
    const m = lastMatch(new RegExp(label + '\\s*\\n?\\s*([^\\n]+)', 'gi'));
    if (!m) return null;
    const value = m[1].trim();
    // Guard: if the "value" we captured is actually another field's label
    // (bare label with no value on the next line, so the regex fell
    // through to whatever heading came after it), treat it as not found
    // rather than returning a wrong value.
    if (knownLabels.some(l => value.toLowerCase() === l.toLowerCase())) return null;
    return value;
  };
  // Policy number gets one more guard on top of lastMatch/knownLabels:
  // reject anything that isn't shaped like a policy number, so a stray
  // sentence fragment (e.g. from the intro paragraph) can never pass
  // through even if it happens to survive the checks above.
  const policyNumberLine = () => {
    const value = line('Policy number');
    return value && /^[A-Z0-9][A-Z0-9\-\/]{3,}$/i.test(value) ? value : null;
  };
  // Patient name: find the line right before the "NRIC / FIN <masked> ·
  // <plan>" results header, rather than "first line that isn't NRIC-ish"
  // — that first-match approach picked up the lookup form's own card
  // heading ("Policy lookup") on records where the intro paragraph also
  // happens to avoid the word "NRIC".
  const lines = text.split('\n').map(l => l.trim());
  const nricFinIdx = lines.findIndex(l => /^NRIC\s*\/\s*FIN\s/i.test(l));
  let name = null;
  if (nricFinIdx > 0) {
    for (let i = nricFinIdx - 1; i >= 0; i--) {
      if (lines[i]) { name = lines[i]; break; }
    }
  }
  const planNameMatch = text.match(/NRIC\s*\/\s*FIN[^\n]*·\s*([^\n]+)/i);

  // Exclusions run from "EXCLUSIONS" up to whichever comes first: a
  // "SPECIAL REMARKS" section (some policies have one, some don't) or the
  // demo disclaimer footer. Without that stop condition, a record with
  // special remarks had them folded into the exclusions list and
  // mislabelled as "Exclusion: ...".
  const afterExclusions = text.split('EXCLUSIONS')[1] || '';
  const exclusions = afterExclusions
    .split(/SPECIAL REMARKS|For demonstration/i)[0]
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const afterRemarks = text.split('SPECIAL REMARKS')[1];
  const specialRemarks = afterRemarks
    ? afterRemarks.split(/For demonstration/i)[0].split('\n').map(l => l.trim()).filter(Boolean)
    : [];

  const panelCoPay = line('Panel clinic co-payment');
  const nonPanel = line('Non-panel co-insurance');
  const coPaySummary = [panelCoPay, nonPanel ? `${nonPanel} (non-panel)` : null].filter(Boolean).join(' — ');

  return {
    status: 'success',
    patient: { nricMasked: nric.replace(/^(.)\d{4}(\d{3}.)$/, '$1****$2'), name: name || null },
    insurer: { code: 'alliance', name: 'Alliance', portalUrl },
    policy: {
      number: policyNumberLine(),
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
      ...specialRemarks.map(r => `Remark: ${r}`),
      line('Annual deductible') ? `Annual deductible: ${line('Annual deductible')}` : null,
    ].filter(Boolean),
    scannedAt: new Date().toISOString(),
  };
}

module.exports = { code: 'alliance', name: 'Alliance', lookup };