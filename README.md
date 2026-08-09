# Raffles Singapore Health Clinic — Insurance Eligibility Desk

A front-desk tool: staff enter a patient's Singapore NRIC/FIN and pick an
insurance provider, and get back sum insured, balance, co-payment terms and
exclusions in one consistent layout — no matter which insurer's portal the
data came from.

## What's here

```
index.html              the staff-facing web page (open directly, or serve as a static file)
server/index.js         Express API: POST /api/eligibility -> normalized result
server/adapters/aia.js  Playwright adapter that actually drives the AIA demo
                         portal (test-ins-app.lovable.app) and scrapes the result
```

`index.html` on its own runs fully in the browser with a mock AIA adapter
(seeded with a real scan of the demo portal for NRIC `S1234567D`), so you can
open it right away and see the intended UI. Browsers can't reach across
origins to scrape a third-party site directly — that's what `server/` is for.
Point the form's fetch call at `/api/eligibility` once the server is running
and it'll do a live scan instead of using the mock.

## The standard schema

Every adapter — present or future — must resolve to this shape:

```jsonc
{
  "status": "success",            // or "not_found" | "error"
  "patient": { "nricMasked": "S****567D", "name": "Tan Wei Ming" },
  "insurer": { "code": "aia", "name": "AIA", "portalUrl": "https://..." },
  "policy": {
    "number": "AIA-P-889201",
    "planName": "AIA HealthShield Gold Max A",
    "statusLabel": "Active",
    "effectiveDate": "01 Feb 2024",
    "renewalDate": "31 Jan 2027"
  },
  "coverage": {
    "currency": "SGD",
    "sumInsured": 60000,
    "utilisedAmount": 4250,
    "remainingBalance": 55750,
    "utilisationPct": 7
  },
  "coPayment": [
    { "label": "Panel clinic co-payment", "value": "SGD 20 per visit" }
  ],
  "exclusions": ["Cosmetic and aesthetic procedures", "..."],
  "scannedAt": "2026-08-09T09:00:00.000Z"
}
```

Keeping every adapter's output in this shape is what makes "later integrate
other URLs to scan" cheap: the front-end, the API route, and the results
card never change — you only ever add a new file under `server/adapters/`.

## Adding another insurer's portal

1. Look at the target portal: does it need login, or just a lookup form
   like AIA's demo? Adjust the Playwright steps in a new adapter file
   accordingly (`server/adapters/greateastern.js`, etc.).
2. Export `{ code, name, lookup(nric) }` where `lookup` returns the schema
   above.
3. Register it in `server/index.js`'s `adapters` map.
4. Add an `<option value="...">` to the insurer `<select>` in `index.html`.

## Running the live scan locally

```bash
npm init -y
npm i express playwright
npx playwright install chromium
node server/index.js
```

Then serve `index.html` (e.g. `npx serve .`) and update its `fetch` call to
hit `http://localhost:8787/api/eligibility`.

## Notes on patient data

- NRIC/FIN is sensitive personal data under Singapore's PDPA. The current
  build doesn't persist it anywhere — the form holds it only in memory for
  the duration of the lookup.
- Before wiring this to a real insurer's production portal (rather than a
  demo/sandbox), confirm you're permitted to automate that portal under its
  terms of use, and that any patient data in transit and at rest meets your
  clinic's data-protection obligations.
