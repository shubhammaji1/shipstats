const assert = require('node:assert/strict');
const { statSync } = require('node:fs');
const path = require('node:path');
const manifest = require('../package.json');

const icon = path.resolve(__dirname, '..', manifest.icon);
const bytes = statSync(icon).size;
// Keep a generous margin below the Marketplace upload limit.
const budget = 100 * 1024;
assert.ok(bytes > 0 && bytes <= budget,
  `Extension icon must be between 1 byte and 100 KB; got ${bytes} bytes: ${manifest.icon}`);
console.log(`Extension icon: ${bytes} bytes (within the 100 KB project budget).`);
