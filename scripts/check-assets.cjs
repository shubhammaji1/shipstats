const assert = require('node:assert/strict');
const { statSync, readFileSync } = require('node:fs');
const path = require('node:path');
const manifest = require('../package.json');

const icon = path.resolve(__dirname, '..', manifest.icon);
const bytes = statSync(icon).size;
// Keep a generous margin below the Marketplace upload limit.
const budget = 100 * 1024;
assert.ok(bytes > 0 && bytes <= budget,
  `Extension icon must be between 1 byte and 100 KB; got ${bytes} bytes: ${manifest.icon}`);
console.log(`Extension icon: ${bytes} bytes (within the 100 KB project budget).`);

const readme = readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
for (const match of readme.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
  assert.ok(match[1].startsWith('https://'),
    `README image must use an absolute HTTPS URL for registry pages: ${match[1]}`);
}
console.log('README HTML image URLs use HTTPS.');
