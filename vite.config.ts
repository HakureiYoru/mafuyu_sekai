import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { arcadeApi } from './server/dev-api.ts';

const changelogPath = fileURLToPath(new URL('./public/data/changelog.json', import.meta.url));
const changelogId = '\0virtual:changelog';

export default defineConfig({
  base: './',
  plugins: [react(), arcadeApi(), {
    name: 'single-source-changelog',
    resolveId(id) { if (id === 'virtual:changelog') return changelogId; },
    load(id) { if (id === changelogId) { this.addWatchFile(changelogPath); return `export default ${readFileSync(changelogPath, 'utf8')}`; } },
    handleHotUpdate({ file, server }) {
      if (file === changelogPath) {
        const module = server.moduleGraph.getModuleById(changelogId);
        if (module) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  }],
  server: { host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
