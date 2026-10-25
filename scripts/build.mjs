// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the API (one Node file) and the web app (static files) into dist/.
// Usage: node scripts/build.mjs [--watch]
import { build, context } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const webOut = join(dist, 'web');
const watch = process.argv.includes('--watch');
// Extra module folders (used when packages live outside node_modules, e.g. offline machines).
const nodePaths = (process.env.MUSTER_NODE_PATH || '').split(':').filter(Boolean);
const alias = {
  '@muster/core': join(root, 'packages/core/src/index.ts'),
  '@muster/pdf': join(root, 'packages/pdf/src/index.ts'),
  '@muster/backend': join(root, 'apps/web/src/backend/http.ts')
};

const apiOptions = {
  entryPoints: [join(root, 'apps/api/src/server.ts')],
  outfile: join(dist, 'server.js'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: true,
  alias, nodePaths, logLevel: 'warning', legalComments: 'none'
};

const webOptions = {
  entryPoints: { app: join(root, 'apps/web/src/main.tsx') },
  outdir: webOut, entryNames: '[name]-[hash]',
  bundle: true, platform: 'browser', format: 'esm', target: ['chrome115', 'firefox115', 'safari16'],
  jsx: 'automatic', minify: !watch, sourcemap: true, alias, nodePaths, metafile: true, logLevel: 'warning',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' }, legalComments: 'none'
};

function writeIndex(meta) {
  const outputs = Object.keys(meta.outputs).map(p => p.split('/').pop());
  const js = outputs.find(f => /^app-.*\.js$/.test(f));
  const css = outputs.find(f => /^app-.*\.css$/.test(f));
  const html = readFileSync(join(root, 'apps/web/index.html'), 'utf8')
    .replace('<!--CSS-->', css ? `<link rel="stylesheet" href="/${css}">` : '')
    .replace('<!--JS-->', `<script type="module" src="/${js}"></script>`);
  writeFileSync(join(webOut, 'index.html'), html);
  const pub = join(root, 'apps/web/public');
  if (existsSync(pub)) for (const f of readdirSync(pub)) copyFileSync(join(pub, f), join(webOut, f));
}

if (!watch) rmSync(dist, { recursive: true, force: true });
mkdirSync(webOut, { recursive: true });

if (watch) {
  const api = await context(apiOptions);
  const web = await context({ ...webOptions, plugins: [{ name: 'index', setup(b) { b.onEnd(r => { if (r.metafile) writeIndex(r.metafile); }); } }] });
  await Promise.all([api.watch(), web.watch()]);
  console.log('Watching for changes. Run `node dist/server.js` in another terminal.');
} else {
  await build(apiOptions);
  const res = await build(webOptions);
  writeIndex(res.metafile);
  const size = Object.entries(res.metafile.outputs).filter(([p]) => !p.endsWith('.map')).map(([p, o]) => `${p.split('/').pop()} ${(o.bytes / 1024).toFixed(0)} KB`);
  console.log('Built dist/server.js and dist/web:', size.join(', '));
}
