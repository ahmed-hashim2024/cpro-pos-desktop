// Fails if a T('…') string in src has no English or French translation.
// Run: node scripts/check-i18n.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.jsx?$/.test(f)) files.push(p);
  }
})(root);

const keys = new Set();
for (const f of files) {
  for (const m of readFileSync(f, 'utf8').matchAll(/\bT\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
}
let missing = 0;
for (const lang of ['en', 'fr']) {
  const cat = JSON.parse(readFileSync(join(root, 'lib/locales', `${lang}.json`), 'utf8'));
  for (const k of keys) if (!(k in cat)) { console.log(`${lang}: missing ${JSON.stringify(k)}`); missing++; }
}
console.log(`${keys.size} strings, ${missing} missing`);
process.exit(missing ? 1 : 0);
