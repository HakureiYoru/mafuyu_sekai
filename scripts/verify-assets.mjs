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
const comms = JSON.parse(await readFile(new URL('../public/assets/comms/manifest.json', import.meta.url), 'utf8'));
let commsBytes = 0;
if (comms.assets.length !== 8) throw new Error('Expected eight full-body communication poses.');
for (const asset of comms.assets) {
  const data = await readFile(new URL(`../public/assets/comms/${asset.file}`, import.meta.url));
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== asset.sha256 || data.length !== asset.bytes) throw new Error(`Communication asset changed: ${asset.file}`);
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`Invalid WebP: ${asset.file}`);
  if (!asset.prompt || !asset.sourceSha256 || !asset.references?.length) throw new Error(`Missing generation record: ${asset.file}`);
  commsBytes += data.length;
}
if (commsBytes !== comms.totalBytes || commsBytes > 2_000_000) throw new Error('Communication asset download budget exceeded.');
console.log(`All 8 communication sprites match their generation records (${commsBytes} bytes, below 2 MB).`);
