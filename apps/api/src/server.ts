import { createServer, type Server } from 'node:http';
import { resolve, join } from 'node:path';
import { Store } from './db';
import { Router, HttpError, readJson, send, securityHeaders, serveStatic, parseCookies, type Ctx } from './http';
import { sessionUser, SESSION_COOKIE } from './auth';
import { buildRouter, KEEP_OPEN, type Config } from './routes';
import { seedIfEmpty } from './seed';

export interface ServerOptions {
  port: number;
  host: string;
  dbFile: string;
  webDir: string;
  demo: boolean;
  secureCookies: boolean;
  trustProxy: boolean;
  adminPassword?: string;
  quiet?: boolean;
}

export function createApp(opts: ServerOptions): { server: Server; store: Store } {
  const log = (m: string) => { if (!opts.quiet) console.log(`[muster] ${m}`); };
  const store = new Store(opts.dbFile);
  seedIfEmpty(store, { demo: opts.demo, adminPassword: opts.adminPassword, log });
  const cfg: Config = { demo: opts.demo, secureCookies: opts.secureCookies };
  const router: Router = buildRouter(store, cfg);

  const server = createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) {
        const method = req.method || 'GET';
        if (method !== 'GET' && method !== 'HEAD' && req.headers['x-muster'] !== '1') throw new HttpError(403, 'Missing X-Muster header');
        const m = router.match(method, path);
        if (!m) throw new HttpError(404, 'Not found');
        if (m === 'method') throw new HttpError(405, 'Method not allowed');
        const ip = (opts.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
        const ctx: Ctx = {
          req, res, params: m.params, query: url.searchParams, ip,
          body: method === 'GET' || method === 'HEAD' ? {} : await readJson(req),
          user: sessionUser(store, parseCookies(req.headers.cookie)[SESSION_COOKIE])
        };
        const out = await m.handler(ctx);
        if (out === KEEP_OPEN || res.headersSent) return;
        send(res, 200, out === undefined ? { ok: true } : out);
        return;
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(opts.webDir, path, res)) return;
      send(res, 404, 'Not found');
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, { error: e.message, ...(e.extra || {}) });
      else { console.error('[muster] error', e); send(res, 500, { error: 'Something went wrong on the server. Check the server logs.' }); }
    }
  });
  server.on('close', () => { try { store.db.close(); } catch { /* already closed */ } });
  return { server, store };
}

const isMain = typeof process !== 'undefined' && process.argv[1] && /server\.(m?js|ts)$/.test(process.argv[1]) && !process.env.MUSTER_NO_AUTOSTART;
if (isMain) {
  const env = process.env;
  const dataDir = resolve(env.DATA_DIR || './data');
  const opts: ServerOptions = {
    port: Number(env.PORT || 8080),
    host: env.HOST || '0.0.0.0',
    dbFile: join(dataDir, 'muster.db'),
    webDir: resolve(env.WEB_DIR || join(__dirname, 'web')),
    demo: (env.DEMO_MODE || 'false').toLowerCase() === 'true',
    secureCookies: (env.COOKIE_SECURE || 'false').toLowerCase() === 'true',
    trustProxy: (env.TRUST_PROXY || 'false').toLowerCase() === 'true',
    adminPassword: env.ADMIN_PASSWORD || undefined
  };
  const { server } = createApp(opts);
  server.listen(opts.port, opts.host, () => {
    console.log(`[muster] listening on http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.port}${opts.demo ? '  (demo mode)' : ''}`);
    console.log(`[muster] data: ${opts.dbFile}`);
  });
  const stop = () => { server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
