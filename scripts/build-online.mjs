// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the online version: one self-contained HTML page for publishing as a Claude artifact.
// Data lives in the artifact's shared store; see apps/web/src/backend/artifact.ts.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-online');
const nodePaths = (process.env.MUSTER_NODE_PATH || '').split(':').filter(Boolean);
mkdirSync(out, { recursive: true });

const res = await build({
  entryPoints: [join(root, 'apps/web/src/main.tsx')],
  bundle: true, write: false, outdir: out, platform: 'browser', format: 'esm', target: ['chrome115', 'firefox115', 'safari16'],
  jsx: 'automatic', minify: true, legalComments: 'none', nodePaths, logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    '@muster/core': join(root, 'packages/core/src/index.ts'),
    '@muster/pdf': join(root, 'packages/pdf/src/index.ts'),
    '@muster/backend': join(root, 'apps/web/src/backend/artifact.ts')
  }
});
const js = res.outputFiles.find(f => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = res.outputFiles.find(f => f.path.endsWith('.css')).text;
const markers = readFileSync(join(root, 'apps/web/index.html'), 'utf8').match(/<svg width="0"[\s\S]*?<\/svg>/)[0];
const html = `<title>Muster Playbooks</title>
<meta name="description" content="Incident response playbooks: editor, guided runs, version history and reports.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Instrument+Sans:wdth,wght@75..100,400..700&display=swap" rel="stylesheet">
<style>${css}</style>
<div id="root"></div>
${markers}
<script type="module">${js}</script>
`;
writeFileSync(join(out, 'muster.html'), html);
console.log(`Built dist-online/muster.html (${(html.length / 1024).toFixed(0)} KB)`);
