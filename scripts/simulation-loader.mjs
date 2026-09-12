import { readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import ts from 'typescript';

/** Read-only transpilation for headless experiments; production methods are unchanged. */
export function simulationLoader(root) {
  const cache = new Map(), hashes = {};
  async function url(file) {
    file = resolve(root, file);
    if (cache.has(file)) return cache.get(file);
    let source = await readFile(file, 'utf8');
    hashes[relative(root, file).replaceAll('\\', '/')] = createHash('sha256').update(source).digest('hex');
    if (file.endsWith('fairness.test.ts')) {
      source = source.replace("import { describe, expect, it } from 'vitest';", '');
      const marker = source.indexOf("describe('complete committed spellcard routes");
      if (marker < 0) throw new Error('Fairness helper extraction marker changed');
      source = source.slice(0, marker) + '\nexport { steering, projectileForecast, minimumDistance, crossesBeam };';
    }
    let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    js = js.replaceAll('import.meta.env.BASE_URL', '"/"');
    for (const match of [...js.matchAll(/from\s+(['"])(\.[^'"]+)\1/g)]) {
      const target = resolve(dirname(file), match[2].endsWith('.ts') ? match[2] : `${match[2]}.ts`);
      js = js.replace(match[0], `from ${JSON.stringify(await url(target))}`);
    }
    const result = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
    cache.set(file, result); return result;
  }
  return { url, hashes };
}
