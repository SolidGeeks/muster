// API tests. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(join(tmpdir(), 'muster-api-'));
const port = 8700 + Math.floor(Math.random() * 500);
const base = `http://localhost:${port}`;
let server;

before(async () => {
  server = spawn(process.execPath, ['--no-warnings', join(root, 'dist/server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DEMO_MODE: 'true' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => { server.stdout.on('data', d => { if (String(d).includes('listening')) res(); }); server.on('exit', c => rej(new Error('exit ' + c))); });
});
after(() => { server?.kill(); rmSync(dataDir, { recursive: true, force: true }); });

class Client {
  cookie = '';
  async req(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-Muster': '1' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : ct.includes('pdf') ? new Uint8Array(await res.arrayBuffer()) : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, b = {}) { return this.req('POST', p, b); }
  put(p, b) { return this.req('PUT', p, b); }
  patch(p, b) { return this.req('PATCH', p, b); }
  del(p) { return this.req('DELETE', p, {}); }
  async login(u) { const r = await this.post('/api/auth/login', { username: u, password: 'muster-' + u }); assert.equal(r.status, 200, JSON.stringify(r.data)); return this; }
}
const as = u => new Client().login(u);

test('security headers and health', async () => {
  const r = await new Client().get('/api/health');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('auth: wrong password, session cookie, sign out', async () => {
  const c = new Client();
  assert.equal((await c.post('/api/auth/login', { username: 'admin', password: 'nope' })).status, 401);
  assert.equal((await c.get('/api/auth/me')).data.user, null);
  await c.login('admin');
  assert.equal((await c.get('/api/auth/me')).data.user.role, 'admin');
  assert.match(c.cookie, /^muster_session=/);
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/playbooks')).status, 401);
});

test('auth: mutating requests need the X-Muster header', async () => {
  const c = await as('admin');
  const r = await c.req('POST', '/api/playbooks', { name: 'x' }, { 'X-Muster': '' });
  assert.equal(r.status, 403);
});

test('auth: repeated failures are rate limited', async () => {
  const c = new Client();
  let last;
  for (let i = 0; i < 9; i++) last = await c.post('/api/auth/login', { username: 'nobody', password: 'bad' + i });
  assert.equal(last.status, 429);
});

test('roles: viewer reads but cannot edit, run or administer', async () => {
  const v = await as('viewer');
  const list = await v.get('/api/playbooks');
  assert.equal(list.data.length, 10);
  const pb = list.data[0];
  assert.equal((await v.put(`/api/playbooks/${pb.id}/draft`, { graph: { nodes: [], edges: [] } })).status, 403);
  assert.equal((await v.post('/api/incidents', { playbookId: pb.id, name: 'x' })).status, 403);
  assert.equal((await v.get('/api/users')).status, 403);
});

test('playbooks: draft save, conflict detection, publish rules, history', async () => {
  const e = await as('editor');
  const created = (await e.post('/api/playbooks', { name: 'Cloud key exposed', category: 'Cloud', severity: 'High' })).data;
  assert.match(created.code, /^PB-\d{3}$/);
  assert.equal(created.versions.length, 0);
  // Invalid graph is refused
  assert.equal((await e.put(`/api/playbooks/${created.id}/draft`, { graph: { nodes: [{ id: 'a' }], edges: [] }, rev: created.rev })).status, 400);
  // A dead end blocks publishing
  const g = structuredClone(created.draft);
  g.nodes.push({ id: 'x', type: 'action', title: 'Rotate the key', phase: 'Containment', role: 'Sysadmin', sla: 15, desc: '', checklist: ['Revoke the key'], x: 0, y: 100 });
  const s1 = await e.put(`/api/playbooks/${created.id}/draft`, { graph: g, rev: created.rev });
  assert.equal(s1.status, 200);
  assert.equal((await e.post(`/api/playbooks/${created.id}/publish`, { msg: 'first' })).status, 422);
  // A stale revision is refused with the current version attached
  const stale = await e.put(`/api/playbooks/${created.id}/draft`, { graph: g, rev: created.rev });
  assert.equal(stale.status, 409);
  assert.ok(stale.data.current);
  // Fix and publish
  g.edges = [{ id: 'e1', from: 'start', to: 'x', label: '' }, { id: 'e2', from: 'x', to: 'end', label: '' }];
  assert.equal((await e.put(`/api/playbooks/${created.id}/draft`, { graph: g, rev: s1.data.rev })).status, 200);
  const pub = await e.post(`/api/playbooks/${created.id}/publish`, { msg: 'first' });
  assert.equal(pub.status, 200);
  assert.equal(pub.data.versions.length, 1);
  const y = await e.get(`/api/playbooks/${created.id}/yaml`);
  assert.match(y.data, /Rotate the key/);
});

test('incidents: declare, conflicting moves, tasks, SLA, close, report, PDF', async () => {
  const a = await as('analyst');
  const pbs = (await a.get('/api/playbooks')).data;
  const malware = pbs.find(p => p.code === 'PB-006');
  const inc = (await a.post('/api/incidents', { playbookId: malware.id, name: 'Test malware', mode: 'exercise', speed: 600, severity: 'Medium' })).data;
  assert.match(inc.ref, /^INC-\d{4}-\d{4}$/);
  assert.equal(inc.status, 'active');
  const cur = () => inc.steps[inc.steps.length - 1].id;
  assert.equal(cur(), 'triage');
  // Ticking a task on a step that isn't current fails
  assert.equal((await a.post(`/api/incidents/${inc.id}/tasks`, { nodeId: 'isolate', index: 0, done: true })).status, 422);
  let r = await a.post(`/api/incidents/${inc.id}/tasks`, { nodeId: 'triage', index: 0, done: true });
  assert.equal(r.status, 200);
  // Stale revision is refused
  assert.equal((await a.post(`/api/incidents/${inc.id}/advance`, { edgeId: 'e_triage_ran', rev: inc.rev })).status, 409);
  // Wait so the triage step (15 min SLA at x600 = 1.5 s) breaches
  await new Promise(res => setTimeout(res, 1700));
  r = await a.post(`/api/incidents/${inc.id}/advance`, { edgeId: 'e_triage_ran', rev: r.data.rev });
  assert.equal(r.status, 200);
  assert.ok(r.data.log.some(l => l.kind === 'crit' && /SLA breached/.test(l.msg)), 'SLA breach logged');
  // A route that doesn't leave the current step is refused
  assert.equal((await a.post(`/api/incidents/${inc.id}/advance`, { edgeId: 'e_triage_ran', rev: r.data.rev })).status, 422);
  r = await a.post(`/api/incidents/${inc.id}/advance`, { edgeId: 'e_ran_clean', rev: r.data.rev });
  r = await a.post(`/api/incidents/${inc.id}/notes`, { notes: 'False alarm after review.' });
  r = await a.post(`/api/incidents/${inc.id}/advance`, { edgeId: 'e_clean_end', rev: r.data.rev });
  assert.equal(r.data.status, 'closed');
  const rep = (await a.post(`/api/incidents/${inc.id}/report`)).data;
  assert.match(rep.num, /^IR-\d{4}-\d{3}$/);
  assert.equal(rep.notes, 'False alarm after review.');
  assert.equal((await a.post(`/api/incidents/${inc.id}/report`)).data.id, rep.id, 'creating twice returns the same report');
  const pdf = await a.get(`/api/reports/${rep.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(new TextDecoder().decode(pdf.data.slice(0, 5)), '%PDF-');
  const md = await a.get(`/api/reports/${rep.id}/markdown`);
  assert.match(md.data, /SLA performance/);
  assert.equal((await a.patch(`/api/reports/${rep.id}`, { severity: 'Extreme' })).status, 400);
  assert.equal((await a.patch(`/api/reports/${rep.id}`, { severity: 'Low', summary: 'Edited' })).data.summary, 'Edited');
});

test('templates: validation, default, sequence', async () => {
  const e = await as('editor');
  const [std] = (await e.get('/api/templates')).data;
  assert.equal((await e.put(`/api/templates/${std.id}`, { accent: 'orange' })).status, 400);
  assert.equal((await e.put(`/api/templates/${std.id}`, { logo: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400);
  const copy = (await e.post('/api/templates', { fromId: std.id })).data;
  assert.equal(copy.isDefault, false);
  assert.equal((await e.del(`/api/templates/${std.id}`)).status, 422, 'default template cannot be deleted');
  const after = (await e.post(`/api/templates/${copy.id}/default`)).data;
  assert.equal(after[0].id, copy.id);
  assert.equal((await e.del(`/api/templates/${std.id}`)).status, 200);
});

test('users: create, disable, keep one admin, audit', async () => {
  const ad = await as('admin');
  assert.equal((await ad.post('/api/users', { username: 'new.user', name: 'New User', role: 'analyst', password: 'short' })).status, 400);
  const u = (await ad.post('/api/users', { username: 'new.user', name: 'New User', role: 'analyst', password: 'long-enough-pw' })).data;
  const c = new Client();
  assert.equal((await c.post('/api/auth/login', { username: 'new.user', password: 'long-enough-pw' })).status, 200);
  await ad.patch(`/api/users/${u.id}`, { disabled: true });
  assert.equal((await c.get('/api/playbooks')).status, 401, 'disabled user is signed out');
  const me = (await ad.get('/api/auth/me')).data.user;
  assert.equal((await ad.patch(`/api/users/${me.id}`, { role: 'viewer' })).status, 422);
  const audit = (await ad.get('/api/audit')).data;
  assert.ok(audit.some(x => x.action === 'user.create'));
});
