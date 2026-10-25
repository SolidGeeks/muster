// SPDX-License-Identifier: AGPL-3.0-or-later
// Site check: serves site/, loads both pages at desktop and phone widths, checks links, anchors,
// images, video and console errors, and writes screenshots to out/site/.
// Usage (project root): node scripts/check-site.mjs
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '../site');
const out = join(root, '../out/site'); mkdirSync(out, { recursive: true });
const fonts = join(root, '../hero-film/assets/fonts');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(root, p);
  if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  const buf = readFileSync(f);
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const a = +range[1], b = range[2] ? +range[2] : buf.length - 1;
    res.writeHead(206, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 });
    return res.end(buf.subarray(a, b + 1));
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' });
  res.end(buf);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const FONT_CSS = `
@font-face{font-family:"Instrument Sans";font-weight:100 549;src:url(/__fonts/InstrumentSans-Regular.ttf)}
@font-face{font-family:"Instrument Sans";font-weight:550 900;src:url(/__fonts/InstrumentSans-Bold.ttf)}
@font-face{font-family:"Geist Mono";font-weight:100 549;src:url(/__fonts/GeistMono-Regular.ttf)}
@font-face{font-family:"Geist Mono";font-weight:550 900;src:url(/__fonts/GeistMono-Bold.ttf)}`;

const problems = [];
const browser = await chromium.launch();
try {
  for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 375, height: 812 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: name === 'phone' ? 2 : 1 });
    await ctx.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: FONT_CSS }));
    await ctx.route(/\/__fonts\//, (r) => r.fulfill({ status: 200, contentType: 'font/ttf', body: readFileSync(join(fonts, r.request().url().split('/').pop())) }));
    for (const pg of ['index.html', 'docs.html']) {
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name} ${pg} console: ${m.text()}`); });
      page.on('pageerror', (e) => problems.push(`${name} ${pg} error: ${e.message}`));
      page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(base)) problems.push(`${name} ${pg} ${r.status()} ${r.url()}`); });
      await page.goto(base + pg, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      // horizontal overflow
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (over > 0) problems.push(`${name} ${pg} horizontal overflow ${over}px`);
      // in-page anchors resolve
      const missing = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')).filter((h) => h.length > 1 && !document.getElementById(h.slice(1))));
      if (missing.length) problems.push(`${name} ${pg} missing anchors: ${missing.join(', ')}`);
      // images decode
      const broken = await page.evaluate(async () => {
        const imgs = [...document.images];
        for (const i of imgs) { i.loading = 'eager'; }
        await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
        return imgs.filter((i) => !i.naturalWidth).map((i) => i.src);
      });
      if (broken.length) problems.push(`${name} ${pg} broken images: ${broken.join(', ')}`);
      // tap targets
      const small = await page.evaluate(() => [...document.querySelectorAll('button, .btn')].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 38)).map((b) => b.textContent.trim() || b.getAttribute('aria-label')));
      if (small.length) problems.push(`${name} ${pg} small targets: ${small.join(' | ')}`);
      if (pg === 'index.html') {
        const v = await page.evaluate(async () => { const v = document.querySelector('video'); await new Promise((r) => setTimeout(r, 1200)); return { paused: v.paused, t: v.currentTime, w: v.videoWidth }; });
        if (!v.w) problems.push(`${name} video did not load`);
        await page.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 10.9; });
        await page.waitForTimeout(600);
        await page.locator('.rise').evaluateAll((els) => els.forEach((e) => e.classList.add('in')));
      } else {
        await page.locator('.rise').evaluateAll((els) => els.forEach((e) => e.classList.add('in')));
      }
      await page.screenshot({ path: join(out, `${pg.replace('.html', '')}-${name}-top.png`) });
      await page.screenshot({ path: join(out, `${pg.replace('.html', '')}-${name}-full.png`), fullPage: true });
      await page.close();
    }
    await ctx.close();
  }
  // internal links between pages
  for (const pg of ['index.html', 'docs.html']) {
    const html = readFileSync(join(root, pg), 'utf8');
    for (const [, attr, href] of html.matchAll(/(href|src|srcset)="([^"#][^"]*)"/g)) {
      for (const h of (attr === 'srcset' ? href.split(',').map((s) => s.trim().split(' ')[0]) : [href])) {
        if (/^(https?:|mailto:)/.test(h) || !h) continue;
        const [file, hash] = h.split('#');
        const f = join(root, file === './' ? 'index.html' : file);
        if (!existsSync(f)) problems.push(`${pg} links to missing ${h}`);
        else if (hash) { const t = readFileSync(f, 'utf8'); if (!t.includes(`id="${hash}"`)) problems.push(`${pg} links to missing anchor ${h}`); }
      }
    }
  }
} finally {
  await browser.close(); server.close();
}
console.log(problems.length ? 'PROBLEMS\n' + problems.join('\n') : 'site check: no problems');
process.exit(problems.length ? 1 : 0);
