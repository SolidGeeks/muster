// Captures the real Muster screens used by the film, with the brand's own fonts.
// Runs the app in demo mode, drives it with Playwright, and writes assets/shots/*.png at 2x.
// Usage (from the project root): node hero-film/capture.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'assets/shots');
const fonts = join(here, 'assets/fonts');
const dataDir = mkdtempSync(join(tmpdir(), 'muster-capture-'));
const port = 8800 + Math.floor(Math.random() * 300);
const base = `http://localhost:${port}`;

const server = spawn(process.execPath, ['--no-warnings', join(root, 'dist/server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DEMO_MODE: 'true' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { server.stdout.on('data', d => { if (String(d).includes('listening')) res(); }); server.on('exit', c => rej(new Error('exit ' + c))); });

// Serve the brand fonts locally in place of Google Fonts (the sandbox has no internet).
const FONT_CSS = `
@font-face{font-family:"Instrument Sans";font-weight:100 549;src:url(/__fonts/InstrumentSans-Regular.ttf)}
@font-face{font-family:"Instrument Sans";font-weight:550 900;src:url(/__fonts/InstrumentSans-Bold.ttf)}
@font-face{font-family:"Geist Mono";font-weight:100 549;src:url(/__fonts/GeistMono-Regular.ttf)}
@font-face{font-family:"Geist Mono";font-weight:550 900;src:url(/__fonts/GeistMono-Bold.ttf)}`;
async function withFonts(ctx) {
  await ctx.route(/fonts\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: FONT_CSS }));
  await ctx.route(/\/__fonts\//, r => r.fulfill({ status: 200, contentType: 'font/ttf', body: readFileSync(join(fonts, r.request().url().split('/').pop())) }));
}

const browser = await chromium.launch();
const shots = [];
async function snap(page, name, opts = {}) {
  await page.waitForTimeout(opts.wait ?? 350);
  const path = join(out, name + '.png');
  if (opts.el) await page.locator(opts.el).first().screenshot({ path });
  else await page.screenshot({ path, clip: opts.clip });
  shots.push(name);
}
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await withFonts(ctx);
  const page = await ctx.newPage();
  await page.goto(base);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await snap(page, 'login');
  await page.getByRole('button', { name: /^admin/ }).click();
  await page.getByRole('heading', { name: 'Playbooks' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await snap(page, 'library');
  await snap(page, 'library-cards', { el: '.lib' });

  // Editor: whole view, the canvas alone, and a close crop of the diagram
  await page.locator('.pbcard', { hasText: 'Ransomware' }).click();
  await page.locator('svg.ed .node').first().waitFor();
  await snap(page, 'editor');
  await page.locator('svg.ed .node', { hasText: 'Isolate affected hosts' }).click();
  await snap(page, 'editor-selected');
  await snap(page, 'inspector', { el: '.inspector' });
  await page.keyboard.press('Escape');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForTimeout(300);
  await snap(page, 'canvas-zoom', { el: '.canvas' });

  // History diff v1 -> v2
  await page.locator('.subtabs').getByRole('link', { name: 'History' }).click();
  await page.locator('.vrow', { hasText: 'v2' }).click();
  await page.locator('.changes h3').waitFor();
  await snap(page, 'history');
  await snap(page, 'diff-graph', { el: '.diffwrap' });

  // A live exercise: ticked tasks, SLA bar running, timeline
  await page.locator('.nav').getByRole('link', { name: /Incidents/ }).click();
  await page.getByRole('heading', { name: 'Incidents' }).waitFor();
  await snap(page, 'incidents');
  await page.getByRole('button', { name: 'Declare an incident' }).click();
  await page.getByText('Exercise', { exact: true }).click();
  await page.getByRole('dialog').getByLabel('Incident name').fill('Encrypted file server, Lyon office');
  await page.getByRole('dialog').locator('select').first().selectOption({ label: 'PB-001 · Ransomware' });
  await page.waitForTimeout(500);
  await snap(page, 'declare');
  await page.getByRole('button', { name: 'Start exercise' }).click();
  await page.getByRole('heading', { name: 'Encrypted file server, Lyon office' }).waitFor();
  await page.locator('.tasks label').nth(0).click(); await page.waitForTimeout(250);
  await page.locator('.tasks label').nth(1).click(); await page.waitForTimeout(250);
  await page.locator('textarea[aria-label="Analyst notes"]').fill('Ransom note found on FS-LYON-02. Shares mapped by 14 workstations.');
  await page.waitForTimeout(1500);
  await snap(page, 'run-step');
  await snap(page, 'step-card', { el: '.step' });
  await page.locator('.tasks label').nth(2).click(); await page.waitForTimeout(300);
  await page.locator('.nexts .btn').first().click();
  await page.locator('.choice').first().waitFor();
  await page.waitForTimeout(900);
  await snap(page, 'run-decision');
  await snap(page, 'decision-card', { el: '.step' });
  await snap(page, 'timeline', { el: '.rside' });
  // finish the run
  for (let i = 0; i < 20; i++) {
    if (await page.locator('.step .tag', { hasText: 'Incident closed' }).count()) break;
    const n = await page.locator('.tasks input:not(:checked)').count();
    for (let j = 0; j < n; j++) { await page.locator('.tasks label', { has: page.locator('input:not(:checked)') }).first().click(); await page.waitForTimeout(120); }
    const choice = page.locator('.choice').first();
    if (await choice.count()) await choice.click(); else await page.locator('.nexts .btn').first().click();
    await page.waitForTimeout(300);
  }
  await snap(page, 'run-closed');
  await page.getByRole('button', { name: 'Create incident report' }).click();
  await page.locator('.sheet').waitFor();
  await page.waitForTimeout(800);
  await snap(page, 'report');
  await snap(page, 'sheet', { el: '.sheet' });
  const pdf = await page.request.get(base + await page.getByRole('link', { name: 'Download PDF' }).getAttribute('href'));
  writeFileSync(join(out, 'report.pdf'), await pdf.body());

  // Template editor with the colour picker open
  await page.locator('.rlist button', { hasText: 'Standard incident report' }).click();
  await page.getByText('Report template').waitFor();
  await page.getByRole('button', { name: /^Accent colour:/ }).click();
  await page.waitForTimeout(400);
  await snap(page, 'template-picker');
  await snap(page, 'picker', { el: '.cp-pop' });
  await page.keyboard.press('Escape');

  // Dark mode editor
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.locator('.nav').getByRole('link', { name: /Playbooks/ }).click();
  await page.locator('.pbcard', { hasText: 'Ransomware' }).click();
  await page.locator('svg.ed .node').first().waitFor();
  await snap(page, 'editor-dark');
  await page.locator('.nav').getByRole('link', { name: /Playbooks/ }).click();
  await page.getByRole('heading', { name: 'Playbooks' }).waitFor();
  await snap(page, 'library-dark');
} finally {
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
execFileSync('pdftoppm', ['-r', '200', '-png', join(out, 'report.pdf'), join(out, 'pdf')]);
console.log('captured:', shots.join(', '), '+ pdf pages');
