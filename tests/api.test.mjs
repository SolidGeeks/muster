// SPDX-License-Identifier: AGPL-3.0-or-later
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
after(async () => {
  if (server && server.exitCode === null) await new Promise(res => { server.once('exit', res); server.kill(); });
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

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

test('playbooks: restore a version into the draft, roles, missing version', async () => {
  const e = await as('editor');
  const ransomware = (await e.get('/api/playbooks')).data.find(p => p.code === 'PB-001');
  const before = (await e.get(`/api/playbooks/${ransomware.id}`)).data;
  const v1 = before.versions.find(x => x.v === 1);
  assert.notDeepEqual(before.draft, v1.graph, 'the draft must differ from v1, or the restore proves nothing');
  // Viewers and analysts cannot restore
  assert.equal((await (await as('viewer')).post(`/api/playbooks/${ransomware.id}/restore`, { v: 1 })).status, 403);
  assert.equal((await (await as('analyst')).post(`/api/playbooks/${ransomware.id}/restore`, { v: 1 })).status, 403);
  // An unknown version is refused (editor, so the role check passes first)
  assert.equal((await e.post(`/api/playbooks/${ransomware.id}/restore`, { v: 999 })).status, 404);
  // Restore v1: the draft becomes v1, rev moves on, published versions are untouched
  assert.equal((await e.post(`/api/playbooks/${ransomware.id}/restore`, { v: 1 })).status, 200);
  const restored = (await e.get(`/api/playbooks/${ransomware.id}`)).data;
  assert.deepEqual(restored.draft, v1.graph);
  assert.equal(restored.rev, before.rev + 1);
  assert.deepEqual(restored.versions, before.versions);
  // Put the original draft back for later tests
  assert.equal((await e.put(`/api/playbooks/${ransomware.id}/draft`, { graph: before.draft, rev: restored.rev })).status, 200);
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
  assert.doesNotMatch(md.data, /Assets hit/, 'an incident not linked to Strata has no Strata section');
  assert.equal((await a.patch(`/api/reports/${rep.id}`, { severity: 'Extreme' })).status, 400);
  assert.equal((await a.patch(`/api/reports/${rep.id}`, { severity: 'Low', summary: 'Edited' })).data.summary, 'Edited');
});

test('incidents: stop a response early, roles, unknown incident, report status', async () => {
  const a = await as('analyst');
  const malware = (await a.get('/api/playbooks')).data.find(p => p.code === 'PB-006');
  const inc = (await a.post('/api/incidents', { playbookId: malware.id, name: 'Stopped early', mode: 'exercise', speed: 60, severity: 'High' })).data;
  assert.equal(inc.status, 'active');
  // Viewers cannot stop, an unknown incident is 404, a stale revision is 409
  assert.equal((await (await as('viewer')).post(`/api/incidents/${inc.id}/stop`)).status, 403);
  assert.equal((await a.post('/api/incidents/inc_missing/stop')).status, 404);
  assert.equal((await a.post(`/api/incidents/${inc.id}/stop`, { rev: inc.rev - 1 })).status, 409);
  // The analyst stops it: status, end time and the last log line
  const r = await a.post(`/api/incidents/${inc.id}/stop`, { rev: inc.rev });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'stopped');
  assert.equal(typeof r.data.endedAt, 'number');
  assert.equal(r.data.log.at(-1).msg, 'Response stopped manually');
  assert.equal((await a.get(`/api/incidents/${inc.id}`)).data.status, 'stopped');
  // Stopping again is refused
  assert.equal((await a.post(`/api/incidents/${inc.id}/stop`)).status, 422);
  // A report made after the stop says so
  const rep = (await a.post(`/api/incidents/${inc.id}/report`)).data;
  const md = (await a.get(`/api/reports/${rep.id}/markdown`)).data;
  assert.match(md, /\| Status \| Response stopped \|/);
});

test('reports: Markdown export keeps user text inside its table cell', async () => {
  // Cells of a Markdown table are split on unescaped pipes; a backslash escapes the next character
  const cells = row => { let n = 0; for (let i = 0; i < row.length; i++) { if (row[i] === '\\') i++; else if (row[i] === '|') n++; } return n; };
  const e = await as('editor');
  const pb = (await e.post('/api/playbooks', { name: 'Table | injection', category: 'Test', severity: 'Low' })).data;
  const g = structuredClone(pb.draft);
  // A title ending in a backslash, a backslash before a pipe, and fake columns in the role
  g.nodes.push({ id: 'x', type: 'action', title: 'Contain a\\|b \\', phase: 'Containment', role: 'SOC | Met | fake', sla: 15, desc: '', checklist: ['Do it'], x: 0, y: 100 });
  g.edges = [{ id: 'e1', from: 'start', to: 'x', label: '' }, { id: 'e2', from: 'x', to: 'end', label: '' }];
  assert.equal((await e.put(`/api/playbooks/${pb.id}/draft`, { graph: g, rev: pb.rev })).status, 200);
  assert.equal((await e.post(`/api/playbooks/${pb.id}/publish`, { msg: 'v1' })).status, 200);

  const a = await as('analyst');
  const inc = (await a.post('/api/incidents', { playbookId: pb.id, name: 'Name | injected', mode: 'exercise', speed: 600, severity: 'Low' })).data;
  let r = await a.post(`/api/incidents/${inc.id}/tasks`, { nodeId: 'x', index: 0, done: true });
  r = await a.post(`/api/incidents/${inc.id}/advance`, { edgeId: 'e2', rev: r.data.rev });
  assert.equal(r.data.status, 'closed', JSON.stringify(r.data));
  const rep = (await a.post(`/api/incidents/${inc.id}/report`)).data;
  const md = (await a.get(`/api/reports/${rep.id}/markdown`)).data;

  // Every row of every table has as many cells as its header
  const tables = md.split('\n\n').map(b => b.split('\n').filter(l => l.startsWith('|'))).filter(t => t.length > 2);
  assert.ok(tables.length >= 2, 'the export has tables');
  for (const t of tables) for (const row of t) assert.equal(cells(row), cells(t[0]), `row breaks its table:\n${row}`);
  assert.match(md, /SOC \\\| Met \\\| fake/, 'pipes in user text are shown, escaped');
});

test('incidents: exercise speed and incident details, roles', async () => {
  const a = await as('analyst');
  const v = await as('viewer');
  const malware = (await a.get('/api/playbooks')).data.find(p => p.code === 'PB-006');
  const ex = (await a.post('/api/incidents', { playbookId: malware.id, name: 'Speed drill', mode: 'exercise', speed: 60, severity: 'Medium' })).data;
  const live = (await a.post('/api/incidents', { playbookId: malware.id, name: 'Real one', mode: 'live', severity: 'High' })).data;
  assert.equal(ex.mode, 'exercise');
  assert.equal(live.mode, 'live');
  // Speed: 1..600 on an active exercise, and the clock follows
  for (const speed of [1, 600, 120]) {
    const r = await a.post(`/api/incidents/${ex.id}/speed`, { speed });
    assert.equal(r.status, 200);
    assert.equal(r.data.clock.speed, speed);
  }
  assert.equal((await a.post(`/api/incidents/${ex.id}/speed`, { speed: 0 })).status, 400);
  assert.equal((await a.post(`/api/incidents/${ex.id}/speed`, { speed: 601 })).status, 400);
  assert.equal((await a.get(`/api/incidents/${ex.id}`)).data.clock.speed, 120, 'refused speeds leave the clock alone');
  assert.equal((await v.post(`/api/incidents/${ex.id}/speed`, { speed: 10 })).status, 403);
  // A live incident has no speed to change
  assert.equal((await a.post(`/api/incidents/${live.id}/speed`, { speed: 10 })).status, 422);
  // Details: name and severity can be changed
  let r = await a.post(`/api/incidents/${live.id}/meta`, { name: 'Renamed', severity: 'Critical' });
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'Renamed');
  assert.equal(r.data.severity, 'Critical');
  assert.equal((await a.post(`/api/incidents/${live.id}/meta`, { name: '' })).status, 400);
  assert.equal((await a.post(`/api/incidents/${live.id}/meta`, { severity: 'Extreme' })).status, 400);
  assert.equal((await v.post(`/api/incidents/${live.id}/meta`, { name: 'Viewer was here' })).status, 403);
  r = (await a.get(`/api/incidents/${live.id}`)).data;
  assert.equal(r.name, 'Renamed');
  assert.equal(r.severity, 'Critical');
  // Once an exercise is stopped its speed is fixed
  assert.equal((await a.post(`/api/incidents/${ex.id}/stop`)).status, 200);
  assert.equal((await a.post(`/api/incidents/${ex.id}/speed`, { speed: 10 })).status, 422);
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

test('password change: current password, strength, other sessions signed out', async () => {
  const ad = await as('admin');
  assert.equal((await ad.post('/api/users', { username: 'pw.user', name: 'Password User', role: 'viewer', password: 'first-password' })).status, 200);
  const login = async (pw, c = new Client()) => ({ c, status: (await c.post('/api/auth/login', { username: 'pw.user', password: pw })).status });
  const { c } = await login('first-password');
  const { c: other } = await login('first-password');
  assert.equal((await c.post('/api/auth/password', { current: 'not-my-password', next: 'second-password' })).status, 400);
  assert.equal((await c.post('/api/auth/password', { current: 'first-password', next: 'short' })).status, 400);
  assert.equal((await other.get('/api/playbooks')).status, 200);
  assert.equal((await c.post('/api/auth/password', { current: 'first-password', next: 'second-password' })).status, 200);
  assert.equal((await c.get('/api/playbooks')).status, 200, 'the session that changed the password stays signed in');
  assert.equal((await other.get('/api/playbooks')).status, 401, 'the other session is signed out');
  assert.equal((await login('first-password')).status, 401);
  assert.equal((await login('second-password')).status, 200);
});

test('Strata: an incident linked to the map, steps that point at it, and what Strata reports back', async () => {
  const a = await as('analyst'), v = await as('viewer'), ed = await as('editor');
  const pbs = (await a.get('/api/playbooks')).data;
  const vuln = (await a.get(`/api/playbooks/${pbs.find(p => p.code === 'PB-010').id}`)).data;
  // the shipped playbook points at the map
  const found = vuln.versions.at(-1).graph.nodes.find(n => n.id === 'found');
  assert.deepEqual(found.targets, ['vuln:{cve}']);
  assert.deepEqual(found.effects, { Yes: ['suspected', 'vuln:{cve}'] });
  // a declared incident keeps its link; a bad IS id is refused
  assert.equal((await a.post('/api/incidents', { playbookId: vuln.id, name: 'x', strata: { site: 'bad id!' } })).status, 400);
  const inc = (await a.post('/api/incidents', { playbookId: vuln.id, name: 'Ivanti', mode: 'exercise', speed: 60, strata: { site: 'lyon', assets: 'vpn-gw, , vpn-gw', params: { cve: 'CVE-2024-21887', 'bad key': 'x' } } })).data;
  assert.deepEqual(inc.strata, { site: 'lyon', assets: ['vpn-gw'], params: { cve: 'CVE-2024-21887' }, marks: {}, names: {} });
  const row = (await a.get('/api/incidents')).data.find(i => i.id === inc.id);
  assert.deepEqual(row.strata, { site: 'lyon', assets: ['vpn-gw'], params: { cve: 'CVE-2024-21887' } });
  // Strata reports the marks and what it did; unknown states are dropped; viewers cannot
  assert.equal((await v.post(`/api/incidents/${inc.id}/strata`, { marks: {} })).status, 403);
  const r = await a.post(`/api/incidents/${inc.id}/strata`, { marks: { 'lyo-vpn-gw': 'suspected', 'lyo-x': 'pwned' }, names: { 'lyo-vpn-gw': 'vpn-gw' }, log: [{ msg: 'vpn-gw marked suspected', kind: 'warn', by: 'alice' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.strata.marks, { 'lyo-vpn-gw': 'suspected' });
  assert.equal(r.data.strata.site, 'lyon', 'the rest of the link stays');
  const last = r.data.log.at(-1);
  assert.equal(last.msg, 'Strata: vpn-gw marked suspected');
  assert.match(last.by, / \(alice\)$/, 'the Strata user is named after the account Strata signs in with');
  // the report lists the assets as Strata reported them, in Markdown and in the PDF
  await a.post(`/api/incidents/${inc.id}/stop`);
  const rep = (await a.post(`/api/incidents/${inc.id}/report`)).data;
  assert.deepEqual(rep.data.strata, { site: 'lyon', assets: [{ id: 'lyo-vpn-gw', name: 'vpn-gw', state: 'suspected' }] });
  const md = (await a.get(`/api/reports/${rep.id}/markdown`)).data;
  assert.match(md, /## \d\d Assets hit \(Strata\)/);
  assert.match(md, /\| vpn-gw \| suspected \|/);
  assert.equal((await a.get(`/api/reports/${rep.id}/pdf`)).status, 200);
  // a draft with an unknown target is refused, a known one is kept
  const p = (await ed.get(`/api/playbooks/${vuln.id}`)).data;
  p.draft.nodes.find(n => n.id === 'exposure').targets = ['everything'];
  assert.equal((await ed.put(`/api/playbooks/${vuln.id}/draft`, { graph: p.draft, rev: p.rev })).status, 400);
  p.draft.nodes.find(n => n.id === 'exposure').targets = ['vuln:{cve}', 'flows:reach:id:vpn-gw', 'role:Admin bastion'];
  assert.equal((await ed.put(`/api/playbooks/${vuln.id}/draft`, { graph: p.draft, rev: p.rev })).status, 200);
  const yaml = (await ed.get(`/api/playbooks/${vuln.id}/yaml`)).data;
  assert.match(yaml, /targets: \["vuln:\{cve\}", "flows:reach:id:vpn-gw", "role:Admin bastion"\]/);
});
