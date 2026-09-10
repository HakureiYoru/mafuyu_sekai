import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile(new URL('../docs/baseline/assets.sha256.json', import.meta.url), 'utf8'));
for (const [path, expected] of Object.entries(manifest)) {
  const actual = createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex');
  if (actual !== expected) throw new Error(`Original texture changed: ${path}`);
}
console.log('All 5 original PNG textures match the v2 SHA-256 baseline.');
const support = JSON.parse(await readFile(new URL('../public/assets/support/manifest.json', import.meta.url), 'utf8'));
for (const asset of support.assets) {
  const actual = createHash('sha256').update(await readFile(new URL(`../public/assets/support/${asset.file}`, import.meta.url))).digest('hex');
  if (actual !== asset.sha256) throw new Error(`Support asset differs from its provenance record: ${asset.file}`);
  await readFile(new URL(`../public/assets/support/${asset.licenseFile}`, import.meta.url));
}
console.log(`All ${support.assets.length} support assets match their provenance records and include licenses.`);
