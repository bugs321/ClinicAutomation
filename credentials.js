/**
 * Loads TPA portal credentials from Credconfig.xml (kept at the repo root,
 * next to index.html — see README's security note: keep this file out of
 * version control).
 *
 * Returns a map keyed by TPA code:
 *   { mhc: { name, loginId, password, url }, alliance: { ... }, ... }
 *
 * Deliberately dependency-free: Credconfig.xml has a fixed, simple shape
 * (one flat <tpa code="..."> per TPA, four text children), so a small
 * regex-based reader is more than the file needs — no xml2js/fast-xml
 * required for this to stay dependable and easy to read.
 */

const fs = require('fs');
const path = require('path');

function loadCredentials(xmlPath = path.join(__dirname, '..', 'Credconfig.xml')) {
  const xml = fs.readFileSync(xmlPath, 'utf8');

  const creds = {};
  const tpaBlockRe = /<tpa\s+code="([^"]+)"\s*>([\s\S]*?)<\/tpa>/g;
  const fieldRe = (tag) => new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);

  let match;
  while ((match = tpaBlockRe.exec(xml)) !== null) {
    const [, code, block] = match;
    const get = (tag) => {
      const m = block.match(fieldRe(tag));
      return m ? m[1].trim() : '';
    };
    creds[code] = {
      name: get('name'),
      loginId: get('loginId'),
      password: get('password'),
      url: get('url'),
    };
  }
  return creds;
}

/** Returns the credential entry for one TPA code, or null if missing/incomplete. */
function getTpaCredential(code, xmlPath) {
  const all = loadCredentials(xmlPath);
  const entry = all[code];
  if (!entry || !entry.url) return null;
  return entry;
}

module.exports = { loadCredentials, getTpaCredential };
