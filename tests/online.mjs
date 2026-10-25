// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests the online (artifact) build in a browser with a stand-in for Claude's page runtime:
// an in-memory shared store, a fake viewer identity and a save prompt that always accepts.
// Usage: node scripts/build-online.mjs && node tests/online.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'tests/screens-online');
mkdirSync(shots, { recursive: true });
const page_html = readFileSync(join(root, 'dist-online/muster.html'), 'utf8');

const mock = `<script>
(() => {
  const store = new Map(); const subs = new Set(); const saved = [];
  const copy = v => JSON.parse(JSON.stringify(v));
  const depth = p => p.split('/').length;
  const snap = (path, v) => ({ id: path.split('/').pop(), exists: v !== undefined, data: () => v === undefined ? undefined : copy(v), metadata: { fromCache: false, hasPendingWrites: false } });
  const inColl = (c, k) => k.startsWith(c + '/') && depth(k) === depth(c) + 1;
  function notify() { for (const s of subs) s(); }
  function docRef(path) {
    if (depth(path) % 2) throw new TypeError('document paths need an even number of segments: ' + path);
    return {
      id: path.split('/').pop(), path,
      async get() { return snap(path, store.get(path)); },
      async set(d) { store.set(path, copy(d)); notify(); },
      async update(d) { if (!store.has(path)) throw { code: 'invalid_argument', message: 'missing' }; store.set(path, { ...store.get(path), ...copy(d) }); notify(); },
      async delete() { store.delete(path); notify(); },
      async acquire() { return { acquired: true }; },
      collection(sub) { return coll(path + '/' + sub); },
      onSnapshot(cb) { const f = () => cb(snap(path, store.get(path))); subs.add(f); setTimeout(f); return () => subs.delete(f); }
    };
  }
  function coll(path) {
    if (depth(path) % 2 === 0) throw new TypeError('collection paths need an odd number of segments: ' + path);
    const q = () => { const docs = [...store.entries()].filter(([k]) => inColl(path, k)).map(([k, v]) => snap(k, v)); return docs; };
    return {
      path, doc(id) { return docRef(path + '/' + (id || Math.random().toString(36).slice(2))); },
      async add(d) { const r = this.doc(); await r.set(d); return r; },
      async get() { const docs = q(); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }; },
      where() { return this; }, orderBy() { return this; }, limit() { return this; },
      onSnapshot(cb) {
        let prev = new Map();
        const f = () => {
          const docs = q(); const now = new Map(docs.map(d => [d.id, JSON.stringify(d.data())]));
          const changes = [];
          for (const d of docs) { if (!prev.has(d.id)) changes.push({ type: 'added', doc: d }); else if (prev.get(d.id) !== now.get(d.id)) changes.push({ type: 'modified', doc: d }); }
          for (const id of prev.keys()) if (!now.has(id)) changes.push({ type: 'removed', doc: snap(path + '/' + id, {}) });
          prev = now;
          if (changes.length || !f.done) { f.done = true; cb({ docs, size: docs.length, empty: !docs.length, docChanges: () => changes, metadata: {} }); }
        };
        subs.add(f); setTimeout(f); return () => subs.delete(f);
      }
    };
  }
  const db = { doc: docRef, collection: coll };
  const user = {
    me: async () => ({ id: 'u_owner', name: 'Test Owner', email: null, avatarUrl: '', color: '#333', isOwner: true, canEdit: true }),
    id: async () => 'u_owner', canEdit: async () => true, isOwner: async () => true, can: async () => true,
    profiles: async ids => Object.fromEntries([].concat(ids).map(id => [id, { id, name: id === 'u_owner' ? 'Test Owner' : '', isMe: id === 'u_owner' }]))
  };
  const downloads = { save: async ({ filename, data }) => { const b = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new TextEncoder().encode(data); saved.push({ filename, head: String.fromCharCode(...b.slice(0, 5)), size: b.length }); return { status: 'saved' }; } };
  window.__saved = saved; window.__store = store;
  window.claude = { use: async name => ({ db, user, downloads })[name] || null };
})();
</script>`;

const errors = [];
const ok = m => console.log('  ✓ ' + m);
let n = 0;
const shot = async (p, name) => { await p.waitForTimeout(250); await p.screenshot({ path: join(shots, `${String(++n).padStart(2, '0')}-${name}.png`) }); };
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_TUNNEL|ERR_NAME/.test(m.text() + (m.location()?.url || ''))) errors.push(m.text()); });
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${mock}</head><body>${page_html}</body></html>`;
  writeFileSync(join(shots, 'harness.html'), doc);
  await page.goto('file://' + join(shots, 'harness.html'));

  await page.getByRole('heading', { name: 'No playbooks yet' }).waitFor(); ok('empty store shows the empty state');
  await page.getByRole('button', { name: 'Load the default playbooks' }).click();
  await page.locator('.pbcard').nth(9).waitFor(); ok('default playbooks loaded');
  if (await page.getByText('Sign in', { exact: true }).count()) throw new Error('sign-in should not appear online');
  await shot(page, 'library');

  await page.locator('.pbcard', { hasText: 'Ransomware' }).click();
  await page.locator('svg.ed .node').first().waitFor();
  await page.locator('svg.ed .node', { hasText: 'Isolate affected hosts' }).click();
  await page.keyboard.press('d');
  await page.locator('#f-title').fill('Domain controller hit?');
  await page.getByText('All changes saved').waitFor({ timeout: 5000 }); ok('draft autosaved to the shared store');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  await page.waitForTimeout(1200);
  await page.locator('.subbar').getByRole('button', { name: /^Publish v/ }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Online check');
  await page.getByRole('dialog').getByRole('button', { name: /^Publish v/ }).click();
  await page.getByText(/Version \d+ is live/).waitFor(); ok('published');
  await shot(page, 'editor');
  await page.locator('.subtabs').getByRole('link', { name: 'History' }).click();
  await page.locator('.changes h3').waitFor();
  await page.getByText('Muster library').first().waitFor(); ok('history shows version authors');
  await shot(page, 'history');

  await page.locator('.nav').getByRole('link', { name: /Incidents/ }).click();
  await page.getByRole('button', { name: 'Declare an incident' }).click();
  await page.getByText('Exercise', { exact: true }).click();
  await page.getByRole('dialog').getByLabel('Incident name').fill('Online tabletop');
  await page.getByRole('dialog').locator('select').first().selectOption({ label: 'PB-008 · Lost or stolen device' });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Start exercise' }).click();
  await page.getByRole('heading', { name: 'Online tabletop' }).waitFor(); ok('exercise declared');
  for (let i = 0; i < 20; i++) {
    if (await page.locator('.step .tag', { hasText: 'Incident closed' }).count()) break;
    const n2 = await page.locator('.tasks input:not(:checked)').count();
    for (let j = 0; j < n2; j++) { await page.locator('.tasks label', { has: page.locator('input:not(:checked)') }).first().click(); await page.waitForTimeout(120); }
    const choice = page.locator('.choice').first();
    if (await choice.count()) await choice.click(); else await page.locator('.nexts .btn').first().click();
    await page.waitForTimeout(300);
  }
  await page.locator('.step .tag', { hasText: 'Incident closed' }).waitFor(); ok('ran to the end');
  await shot(page, 'run-closed');
  const by = await page.locator('.rlog .by').first().textContent();
  if (!/Test Owner/.test(by || '')) throw new Error('timeline should show the resolved name, got ' + by);
  ok('names resolved from ids');
  await page.getByRole('button', { name: 'Create incident report' }).click();
  await page.locator('.sheet').waitFor(); ok('report created');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  await page.waitForFunction(() => window.__saved.length > 0, null, { timeout: 15000 });
  const saved = await page.evaluate(() => window.__saved[0]);
  if (saved.head !== '%PDF-') throw new Error('not a PDF: ' + JSON.stringify(saved));
  ok(`PDF handed to the save prompt (${saved.filename}, ${(saved.size / 1024).toFixed(0)} KB)`);
  await shot(page, 'report');
  await page.locator('.rlist button', { hasText: 'Regulator brief' }).click();
  await page.getByText('Report template').waitFor();
  await page.getByRole('button', { name: /^Accent colour:/ }).click();
  await page.getByRole('dialog', { name: 'Accent colour' }).waitFor();
  await page.getByRole('button', { name: 'Use #FFD400' }).count();
  await page.locator('.cp-hex, .cp-fields input').first().fill('#F2C230');
  await page.getByText('Too light for text on white').waitFor();
  await page.getByRole('button', { name: 'Darken to 4.5:1' }).click();
  await page.getByText('Readable as small text').waitFor();
  await shot(page, 'colour-picker');
  await page.getByRole('button', { name: 'Use #127548' }).click();
  await page.keyboard.press('Escape');
  ok('colour picker: hex entry, contrast check, darken, presets');
  await page.waitForTimeout(900);
  await shot(page, 'template'); ok('template edited');
  if (await page.locator('.nav').getByRole('link', { name: /Admin/ }).count()) throw new Error('Admin should be hidden online');
  ok('admin pages hidden online');
  if (errors.length) throw new Error('Browser errors:\n' + errors.join('\n'));
  console.log('\nOnline build checks passed.');
} catch (e) {
  console.error('\n✗ ' + (e?.message || e)); process.exitCode = 1;
} finally { await browser.close(); }
