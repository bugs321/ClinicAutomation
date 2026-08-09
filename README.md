# Raffles Singapore Health Clinic — Insurance Eligibility Desk

A front-desk tool: staff enter a patient's Singapore NRIC/FIN, policy
number, and pick a TPA, and get back sum insured, co-pay, and special
notes in one consistent layout — no matter which TPA's portal the data
came from.

## What's here

```
index.html                  the staff-facing web page
Credconfig.xml              TPA name / login / URL per TPA (see security note below)
server/index.js             Express API + static file server: POST /api/eligibility
server/credentials.js       reads Credconfig.xml into { code: {name, loginId, password, url} }
server/adapters/mhc.js      Playwright adapter — MHC's demo portal (policy + NRIC + patient name)
server/adapters/alliance.js Playwright adapter — Alliance's demo portal (NRIC only)
server/adapters/aia.js      earlier reference adapter, kept for the "Demo / Sandbox" option
```

`mhc` and `alliance` are **live**: submitting the form calls `/api/eligibility`,
which looks up that TPA's URL from `Credconfig.xml` and runs a real
Playwright scan of its portal, filling in the NRIC/FIN and policy number
you entered. This only works when the site is served by `node server/index.js`
— opening `index.html` directly as a file has no backend to call.
The other five TPA options (IHP, Fullerton, iXchange, Raffles, Adept) show
an "Under construction" state until they're wired up the same way. The
"Demo / Sandbox" option stays a client-side mock so the UI can be
previewed with no server running at all.

## The standard schema

Every adapter — present or future — must resolve to this shape:

```jsonc
{
  "status": "success",            // or "not_found" | "error" | "under_construction"
  "patient": { "nricMasked": "S****567D", "name": "Tan Wei Ming" },
  "insurer": { "code": "mhc", "name": "MHC", "portalUrl": "https://..." },
  "policy": {
    "number": "MHC-2024-00123",
    "planName": "Corporate Care Plus (GP + Specialist)",
    "statusLabel": "Active",
    "effectiveDate": "01 Jan 2026",
    "renewalDate": "31 Dec 2026"
  },
  "coverage": {
    "currency": "SGD",
    "sumInsured": 3000,
    "utilisedAmount": 420.50,
    "remainingBalance": 2579.50,
    "utilisationPct": 14
  },
  "coPaySummary": "10% per visit — Applies to: Specialist consultations and diagnostic imaging",
  "specialNotes": [
    "Exclusion: Cosmetic and aesthetic procedures",
    "GP visits capped at 15 per policy year."
  ],
  "scannedAt": "2026-08-09T09:00:00.000Z"
}
```

`coPaySummary` and `specialNotes` are the two fields every adapter has to
normalize into, however differently the source portal presents them —
that's what makes sum insured / co-pay / special notes render identically
in the UI regardless of which TPA was selected.

Keeping every adapter's output in this shape is what makes "later
integrate other TPAs" cheap: the front-end, the API route, and the
results card never change — you only ever add a new file under
`server/adapters/`.

## Adding another TPA's portal

1. Add its `<tpa code="...">` entry (name, loginId, password, url) to
   `Credconfig.xml`.
2. Look at the target portal: what fields does its lookup form need
   (some, like MHC's, require the patient's name in addition to NRIC/FIN
   and policy number; others, like Alliance's, only need NRIC/FIN)?
   Write a new `server/adapters/<code>.js` — `getTpaCredential('<code>')`
   from `credentials.js` gives you the URL, and `lookup(nric, policyNumber,
   patientName)` should drive the portal with Playwright and return the
   standard schema above.
3. Register it in `server/index.js`'s `adapters` map.
4. In `index.html`, move that TPA's `<option>` out of the "not connected"
   `ADAPTERS` placeholders and point it at `callBackend('<code>', ...)`
   like `mhc` and `alliance` do.

## Running the live scan locally

```bash
npm init -y
npm i express playwright
npx playwright install chromium
node server/index.js
```

Then open `http://localhost:8787` (the server serves `index.html` itself,
so `fetch('/api/eligibility')` reaches it on the same origin).

## Notes on patient data

- NRIC/FIN is sensitive personal data under Singapore's PDPA. The current
  build doesn't persist it anywhere — the form holds it only in memory for
  the duration of the lookup.
- Before wiring this to a real TPA's production portal (rather than a
  demo/sandbox), confirm you're permitted to automate that portal under its
  terms of use, and that any patient data in transit and at rest meets your
  clinic's data-protection obligations.

## Security note on Credconfig.xml

This file holds **plaintext TPA portal credentials**. Keep it out of
version control — add `Credconfig.xml` to `.gitignore` rather than
committing it, even to a private repository. For production, move these
values into environment variables or a secrets manager instead of a
checked-in file.
