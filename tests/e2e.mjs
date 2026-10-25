// SPDX-License-Identifier: AGPL-3.0-or-later
// End-to-end walk through every screen with a real browser.
// Usage: npm run test:e2e   (needs `npx playwright install chromium` once)
// Screenshots land in tests/screens/.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'tests/screens');
mkdirSync(shots, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'muster-e2e-'));
const port = 8200 + Math.floor(Math.random() * 500);
const base = `http://localhost:${port}`;

const server = spawn(process.execPath, ['--no-warnings', join(root, 'dist/server.js')], {
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DEMO_MODE: 'true' }, stdio: ['ignore', 'pipe', 'inherit']
});
await new Promise((res, rej) => { server.stdout.on('data', d => { if (String(d).includes('listening')) res(); }); server.on('exit', c => rej(new Error('server exited ' + c))); });

const browser = await chromium.launch();
const errors = [];
let step = 0;
const ok = m => console.log(`  ✓ ${m}`);
async function shot(page, name) { await page.waitForTimeout(250); await page.screenshot({ path: join(shots, `${String(++step).padStart(2, '0')}-${name}.png`) }); }

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|api\/auth\/login/.test(m.text() + (m.location()?.url || ''))) errors.push(m.text() + ' ' + (m.location()?.url || '')); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(base);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await shot(page, 'login');
  await page.fill('#login-user', 'admin'); await page.fill('#login-pass', 'wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText('Wrong username or password').waitFor(); ok('wrong password is refused');
  await page.getByRole('button', { name: /^admin/ }).click();
  await page.getByRole('heading', { name: 'Playbooks' }).waitFor();
  const cards = await page.locator('.pbcard').count();
  if (cards !== 10) throw new Error(`expected 10 playbooks, got ${cards}`);
  ok('signed in, 10 playbooks listed'); await shot(page, 'library');

  await page.getByRole('button', { name: 'Fraud' }).click();
  if (await page.locator('.pbcard').count() !== 1) throw new Error('category filter failed');
  await page.getByRole('button', { name: 'All', exact: true }).click(); ok('category filter');

  // Editor
  await page.locator('.pbcard', { hasText: 'Ransomware' }).click();
  await page.locator('svg.ed .node').first().waitFor();
  await shot(page, 'editor');
  await page.locator('svg.ed .node', { hasText: 'Isolate affected hosts' }).click();
  await page.getByText('Ownership').waitFor();
  await page.keyboard.press('a');
  await page.locator('#f-title').fill('Snapshot the hypervisor');
  await page.waitForTimeout(1200);
  await page.getByText('All changes saved').waitFor({ timeout: 5000 }); ok('added a step, autosaved');
  await shot(page, 'editor-new-step');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  await page.waitForTimeout(1200);
  ok('undo');
  // Publish
  await page.locator('.subbar').getByRole('button', { name: /^Publish v/ }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('E2E check');
  await page.getByRole('dialog').getByRole('button', { name: /^Publish v/ }).click();
  await page.getByText(/Version \d+ is live/).waitFor(); ok('published a new version');

  // History
  await page.locator('.subtabs').getByRole('link', { name: 'History' }).click();
  await page.getByRole('heading', { name: 'Versions' }).waitFor();
  await page.locator('.vrow', { hasText: 'v2' }).click();
  await page.locator('.changes h3').waitFor();
  await shot(page, 'history'); ok('history diff');

  // Declare an exercise
  await page.locator('.nav').getByRole('link', { name: /Incidents/ }).click();
  await page.getByRole('heading', { name: 'Incidents' }).waitFor();
  await shot(page, 'incidents');
  await page.getByRole('button', { name: 'Declare an incident' }).click();
  await page.getByText('Exercise', { exact: true }).click();
  await page.getByRole('dialog').getByLabel('Incident name').fill('E2E tabletop');
  await page.getByRole('dialog').locator('select').first().selectOption({ label: 'PB-003 · Compromised account' });
  await page.waitForTimeout(400);
  await shot(page, 'declare');
  await page.getByRole('button', { name: 'Start exercise' }).click();
  await page.getByRole('heading', { name: 'E2E tabletop' }).waitFor(); ok('exercise declared');
  await shot(page, 'run');
  // Work through the run: tick tasks, answer decisions
  for (let i = 0; i < 20; i++) {
    if (await page.locator('.step .tag', { hasText: 'Incident closed' }).count()) break;
    const boxes = page.locator('.tasks input[type=checkbox]:not(:checked)');
    const n = await boxes.count();
    for (let j = 0; j < n; j++) { await page.locator('.tasks label', { has: page.locator('input:not(:checked)') }).first().click(); await page.waitForTimeout(150); }
    const choice = page.locator('.choice').first();
    if (await choice.count()) { await choice.click(); } else { await page.locator('.nexts .btn').first().click(); }
    await page.waitForTimeout(350);
  }
  await page.locator('.step .tag', { hasText: 'Incident closed' }).waitFor(); ok('ran the playbook to the end');
  await shot(page, 'run-closed');
  await page.getByRole('button', { name: 'Create incident report' }).click();
  await page.locator('.sheet').waitFor(); ok('report created');
  await page.locator('textarea[aria-label="Analyst notes"]').fill('Written by the end-to-end test.');
  await page.waitForTimeout(1200);
  await shot(page, 'report');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download PDF' }).click()]);
  const pdfPath = join(shots, 'report.pdf');
  await download.saveAs(pdfPath); ok(`PDF downloaded (${download.suggestedFilename()})`);

  // Template editor
  await page.locator('.rlist button', { hasText: 'Standard incident report' }).click();
  await page.getByText('Report template').waitFor();
  await page.getByRole('button', { name: /^Accent colour:/ }).click();
  await page.getByRole('dialog', { name: 'Accent colour' }).waitFor();
  await page.getByRole('button', { name: 'Use #FFD400' }).count();
  await page.locator('.cp-hex, .cp-fields input').first().fill('#F2C230');
  await page.getByText('Too light for text on white').waitFor();
  await page.getByRole('button', { name: 'Darken to 4.5:1' }).click();
  await page.getByText('Readable as small text').waitFor();
  await shot(page, 'colour-picker');
  await page.getByRole('button', { name: 'Use #3A4FD1' }).click();
  await page.keyboard.press('Escape');
  ok('colour picker: hex entry, contrast check, darken, presets');
  await page.locator('.secs input[type=checkbox]').nth(1).uncheck();
  await page.waitForTimeout(900);
  await shot(page, 'template'); ok('template edited');

  // Dark mode
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-muster-theme'));
  if (theme !== 'dark') throw new Error('dark mode not applied');
  const sheetBg = await page.locator('.sheet').evaluate(el => getComputedStyle(el).backgroundColor);
  if (sheetBg !== 'rgb(255, 255, 255)') throw new Error('report paper should stay white in dark mode, got ' + sheetBg);
  await shot(page, 'template-dark');
  await page.locator('.nav').getByRole('link', { name: /Playbooks/ }).click();
  await page.locator('.pbcard', { hasText: 'Ransomware' }).click();
  await page.locator('svg.ed .node').first().waitFor();
  await shot(page, 'editor-dark');
  await page.reload();
  await page.locator('svg.ed .node').first().waitFor();
  if (await page.evaluate(() => document.documentElement.getAttribute('data-muster-theme')) !== 'dark') throw new Error('theme not remembered');
  await page.keyboard.press('Shift+D');
  if (await page.evaluate(() => document.documentElement.getAttribute('data-muster-theme')) !== 'light') throw new Error('Shift+D should switch back');
  ok('dark mode toggle, remembered, report paper stays white, Shift+D');

  // Admin
  await page.locator('.nav').getByRole('link', { name: /Admin/ }).click();
  await page.getByRole('heading', { name: 'Users and audit' }).waitFor();
  await shot(page, 'admin'); ok('admin page');

  // Viewer permissions
  const v = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const vp = await v.newPage();
  vp.on('pageerror', e => errors.push(String(e)));
  await vp.goto(base);
  await vp.getByRole('button', { name: /^viewer/ }).click();
  await vp.getByRole('heading', { name: 'Playbooks' }).waitFor();
  if (await vp.getByRole('button', { name: 'New playbook' }).count()) throw new Error('viewer can see New playbook');
  await vp.locator('.pbcard').first().click();
  await vp.getByText('View only. Editors can change this playbook.').waitFor(); ok('viewer is read-only');
  await v.close();

  // Mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mp = await m.newPage();
  mp.on('pageerror', e => errors.push(String(e)));
  await mp.goto(base);
  await mp.getByRole('button', { name: /^analyst/ }).click();
  await mp.getByRole('heading', { name: 'Playbooks' }).waitFor();
  await mp.screenshot({ path: join(shots, `${String(++step).padStart(2, '0')}-mobile-library.png`), fullPage: false });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error(`mobile page scrolls sideways by ${overflow}px`);
  ok('mobile layout without sideways scroll');
  await m.close();

  if (errors.length) throw new Error('Browser errors:\n' + errors.join('\n'));
  console.log(`\nAll end-to-end checks passed. Screenshots in ${shots}`);
} catch (e) {
  console.error('\n✗ ' + (e && e.message || e));
  process.exitCode = 1;
} finally {
  await browser.close();
  // Wait for the server to exit before removing its data folder: on Windows the database file is locked until then
  if (server.exitCode === null) await new Promise(res => { server.once('exit', res); server.kill(); });
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}
