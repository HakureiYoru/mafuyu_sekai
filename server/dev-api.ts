import type { Plugin } from 'vite';
import { handler } from './leaderboard.ts';
/** Same server implementation as Vercel; never included in browser bundles. */
export function arcadeApi(): Plugin {
  return { name: 'arcade-local-api', configureServer(server) {
    try { process.loadEnvFile('.env.local'); } catch { /* Offline dev is supported. */ }
    server.middlewares.use((req, res, next) => {
      const route = req.url?.split('?')[0];
      const action = route === '/api/run' ? 'run' : route === '/api/submit' ? 'submit' : route === '/api/leaderboard' ? 'board' : null;
      if (!action) { next(); return; }
      let raw = '';
      req.on('data', chunk => { raw += String(chunk); if (raw.length > 8192) req.destroy(); });
      req.on('end', () => {
        try { Object.assign(req, { body: raw ? JSON.parse(raw) as unknown : undefined }); }
        catch { res.statusCode = 400; res.end('{"error":"无效请求"}'); return; }
        void handler(action)(req, res);
      });
    });
  } };
}
