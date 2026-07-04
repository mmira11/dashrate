const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('manifest.json is valid JSON with the required PWA fields', () => {
  const raw = fs.readFileSync(path.join(__dirname, '../public/manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.name, 'DashRate');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
});
