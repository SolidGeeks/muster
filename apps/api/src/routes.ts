// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ServerResponse } from 'node:http';
import { Router, HttpError, send, parseCookies, type Ctx } from './http';
import type { Store } from './db';
import {
  ROLE_RANK, SESSION_COOKIE, createSession, destroySession, destroyUserSessions, hashPassword, verifyPassword, burnTime,
  sessionCookie, Limiter, checkPasswordStrength
} from './auth';
import {
  getPlaybook, listPlaybooks, liveVersion, nextPlaybookCode, getIncident, saveIncident, listIncidents, getReport, saveReport,
  listReports, listTemplates, getTemplate, defaultTemplate, saveTemplate, listUsers
} from './repo';
import { incidentRef, DEMO_USERS } from './seed';
import { renderReportPdf } from '@muster/pdf';
import {
  type Role, type Graph, type Template, type Report, type Incident, type Severity, type SectionKey,
  uid, clone, validate, checkGraphShape, makeNode, makeEdge, layout, startIncident, advance, toggleTask, stopIncident, setSpeed,
  reportData, autoSummary, formatId, toMarkdown, toYaml, SEVERITIES, SECTION_LABEL
} from '@muster/core';

export interface Config { demo: boolean; secureCookies: boolean }

/* ---------- live updates (server-sent events) ---------- */
const clients = new Set<ServerResponse>();
export function broadcast(type: string, id: string, extra: Record<string, unknown> = {}) {
  const msg = `event: change\ndata: ${JSON.stringify({ type, id, ...extra })}\n\n`;
  for (const c of clients) { try { c.write(msg); } catch { clients.delete(c); } }
}
setInterval(() => { for (const c of clients) { try { c.write(': ping\n\n'); } catch { clients.delete(c); } } }, 25000).unref();

/* ---------- small validators ---------- */
function str(v: unknown, field: string, max: number, opts: { min?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null) { if (opts.optional) return ''; throw new HttpError(400, `${field} is required`); }
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`);
  const s = v.trim();
  if (s.length < (opts.min ?? 0)) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return s;
}
function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (!allowed.includes(v as T)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return v as T;
}
function int(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}`);
  return n;
}
const ROLES: Role[] = ['viewer', 'analyst', 'editor', 'admin'];
const SECTION_KEYS = Object.keys(SECTION_LABEL) as SectionKey[];

function need(ctx: Ctx, role: Role) {
  if (!ctx.user) throw new HttpError(401, 'Sign in to continue');
  if (ROLE_RANK[ctx.user.role as Role] < ROLE_RANK[role]) throw new HttpError(403, `This needs the ${role} role or higher`);
  return ctx.user;
}
const who = (ctx: Ctx) => ctx.user!.name;

export function buildRouter(store: Store, cfg: Config): Router {
  const r = new Router();
  const loginLimiter = new Limiter(8, 15 * 60 * 1000);

  /* ---------- system ---------- */
  r.get('/api/health', () => ({ ok: true }));
  r.get('/api/config', () => ({
    demo: cfg.demo,
    demoAccounts: cfg.demo ? DEMO_USERS.map(u => ({ username: u.username, password: u.password, role: u.role })) : []
  }));

  /* ---------- auth ---------- */
  r.post('/api/auth/login', ctx => {
    const username = str(ctx.body.username, 'Username', 100, { min: 1 });
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const key = `${ctx.ip}|${username.toLowerCase()}`;
    if (!loginLimiter.check(key)) throw new HttpError(429, 'Too many failed attempts. Wait 15 minutes and try again.');
    const row = store.get<any>('SELECT * FROM users WHERE username = ?', username);
    if (!row) burnTime(password);
    if (!row || !verifyPassword(password, row.pw_hash) || row.disabled) {
      loginLimiter.fail(key);
      store.audit(username, 'login.failed', 'session', ctx.ip);
      throw new HttpError(401, row?.disabled && verifyPassword(password, row.pw_hash) ? 'This account is disabled. Ask an administrator.' : 'Wrong username or password');
    }
    loginLimiter.reset(key);
    const token = createSession(store, row.id);
    store.audit(row.name, 'login', 'session', ctx.ip);
    ctx.res.setHeader('Set-Cookie', sessionCookie(token, cfg.secureCookies));
    return { user: { id: row.id, username: row.username, name: row.name, role: row.role } };
  });
  r.post('/api/auth/logout', ctx => {
    destroySession(store, parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE]);
    ctx.res.setHeader('Set-Cookie', sessionCookie('', cfg.secureCookies, 0));
    return { ok: true };
  });
  r.get('/api/auth/me', ctx => ({ user: ctx.user || null }));
  r.post('/api/auth/password', ctx => {
    const u = need(ctx, 'viewer');
    const row = store.get<any>('SELECT pw_hash FROM users WHERE id = ?', u.id);
    if (!verifyPassword(String(ctx.body.current || ''), row.pw_hash)) throw new HttpError(400, 'Your current password is wrong');
    const err = checkPasswordStrength(ctx.body.next);
    if (err) throw new HttpError(400, err);
    store.run('UPDATE users SET pw_hash = ? WHERE id = ?', hashPassword(ctx.body.next), u.id);
    destroyUserSessions(store, u.id);
    const token = createSession(store, u.id);
    ctx.res.setHeader('Set-Cookie', sessionCookie(token, cfg.secureCookies));
    store.audit(u.name, 'password.change', 'user:' + u.username);
    return { ok: true };
  });
  r.get('/api/events', ctx => {
    need(ctx, 'viewer');
    ctx.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    ctx.res.write('retry: 3000\n\n');
    clients.add(ctx.res);
    ctx.req.on('close', () => clients.delete(ctx.res));
    return KEEP_OPEN;
  });

  /* ---------- playbooks ---------- */
  r.get('/api/playbooks', ctx => { need(ctx, 'viewer'); return listPlaybooks(store); });
  r.post('/api/playbooks', ctx => {
    const u = need(ctx, 'editor');
    const name = str(ctx.body.name, 'Name', 120, { min: 1 });
    const category = str(ctx.body.category, 'Category', 60, { optional: true }) || 'General';
    const severity = ctx.body.severity ? oneOf(ctx.body.severity, 'Severity', SEVERITIES) : 'Medium';
    const description = str(ctx.body.description, 'Description', 1000, { optional: true });
    const id = uid('pb_');
    const fromId = ctx.body.duplicateOf ? String(ctx.body.duplicateOf) : null;
    let graph: Graph;
    if (fromId) {
      const src = getPlaybook(store, fromId);
      if (!src) throw new HttpError(404, 'The playbook to duplicate no longer exists');
      graph = clone(src.draft);
    } else {
      graph = layout({ nodes: [makeNode('start', 'start', 'Alert received', 'Detection'), makeNode('end', 'end', 'Incident closed', 'Lessons learned')], edges: [makeEdge('start', 'end')] });
    }
    const code = store.tx(() => {
      const c = nextPlaybookCode(store);
      store.run('INSERT INTO playbooks(id, code, name, category, severity, description, draft, rev, archived, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)',
        id, c, name, category, severity, description, JSON.stringify(graph), new Date().toISOString(), u.name);
      return c;
    });
    store.audit(u.name, fromId ? 'playbook.duplicate' : 'playbook.create', `${code} ${name}`);
    broadcast('playbooks', id);
    return getPlaybook(store, id);
  });
  r.get('/api/playbooks/:id', ctx => {
    need(ctx, 'viewer');
    const p = getPlaybook(store, ctx.params.id);
    if (!p) throw new HttpError(404, 'Playbook not found');
    return p;
  });
  r.patch('/api/playbooks/:id', ctx => {
    const u = need(ctx, 'editor');
    const p = getPlaybook(store, ctx.params.id);
    if (!p) throw new HttpError(404, 'Playbook not found');
    const name = ctx.body.name !== undefined ? str(ctx.body.name, 'Name', 120, { min: 1 }) : p.name;
    const category = ctx.body.category !== undefined ? str(ctx.body.category, 'Category', 60, { min: 1 }) : p.category;
    const severity = ctx.body.severity !== undefined ? oneOf(ctx.body.severity, 'Severity', SEVERITIES) : p.severity;
    const description = ctx.body.description !== undefined ? str(ctx.body.description, 'Description', 1000, { optional: true }) : p.description;
    store.run('UPDATE playbooks SET name = ?, category = ?, severity = ?, description = ?, updated_at = ?, updated_by = ? WHERE id = ?', name, category, severity, description, new Date().toISOString(), u.name, p.id);
    broadcast('playbooks', p.id);
    return getPlaybook(store, p.id);
  });
  r.put('/api/playbooks/:id/draft', ctx => {
    const u = need(ctx, 'editor');
    const p = getPlaybook(store, ctx.params.id);
    if (!p) throw new HttpError(404, 'Playbook not found');
    const shapeErr = checkGraphShape(ctx.body.graph);
    if (shapeErr) throw new HttpError(400, shapeErr);
    const baseRev = Number(ctx.body.rev);
    if (Number.isFinite(baseRev) && baseRev !== p.rev) throw new HttpError(409, `${p.updatedBy} saved a newer draft. Reload to see their changes.`, { current: p });
    const graph: Graph = ctx.body.graph;
    store.run('UPDATE playbooks SET draft = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE id = ?', JSON.stringify(graph), new Date().toISOString(), u.name, p.id);
    broadcast('playbook', p.id, { by: u.id });
    const after = getPlaybook(store, p.id)!;
    return { rev: after.rev, updatedAt: after.updatedAt, updatedBy: after.updatedBy };
  });
  r.post('/api/playbooks/:id/publish', ctx => {
    const u = need(ctx, 'editor');
    const p = getPlaybook(store, ctx.params.id);
    if (!p) throw new HttpError(404, 'Playbook not found');
    const v = validate(p.draft);
    if (v.errors) throw new HttpError(422, `Fix ${v.errors} error${v.errors > 1 ? 's' : ''} before publishing`, { checks: v.list.filter(c => c.lvl === 'err') });
    const msg = str(ctx.body.msg, 'Release note', 300, { optional: true }) || 'Update';
    const next = store.tx(() => {
      const n = (p.versions.at(-1)?.v || 0) + 1;
      store.run('INSERT INTO versions(playbook_id, v, date, author, msg, graph) VALUES (?, ?, ?, ?, ?, ?)', p.id, n, new Date().toISOString(), u.name, msg, JSON.stringify(p.draft));
      return n;
    });
    store.audit(u.name, 'playbook.publish', `${p.code} v${next}`, msg);
    broadcast('playbook', p.id);
    return getPlaybook(store, p.id);
  });
  r.post('/api/playbooks/:id/restore', ctx => {
    const u = need(ctx, 'editor');
    const p = getPlaybook(store, ctx.params.id);
    if (!p) throw new HttpError(404, 'Playbook not found');
    const v = p.versions.find(x => x.v === Number(ctx.body.v));
    if (!v) throw new HttpError(404, 'That version does not exist');
    store.run('UPDATE playbooks SET draft = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE id = ?', JSON.stringify(v.graph), new Date().toISOString(), u.name, p.id);
    store.audit(u.name, 'playbook.restore', `${p.code} v${v.v}`);
    broadcast('playbook', p.id);
    return getPlaybook(store, p.id);
  });
  r.delete('/api/playbooks/:id', ctx => {
    const u = need(ctx, 'admin');
    const p = getPlaybook(store, ctx.params.id);
    if (!p) throw new HttpError(404, 'Playbook not found');
    store.run('UPDATE playbooks SET archived = 1, updated_at = ?, updated_by = ? WHERE id = ?', new Date().toISOString(), u.name, p.id);
    store.audit(u.name, 'playbook.archive', `${p.code} ${p.name}`);
    broadcast('playbooks', p.id);
    return { ok: true };
  });
  r.get('/api/playbooks/:id/yaml', ctx => {
    need(ctx, 'viewer');
    const p = getPlaybook(store, ctx.params.id);
    if (!p) throw new HttpError(404, 'Playbook not found');
    return send(ctx.res, 200, toYaml(p, p.draft, p.versions.at(-1)?.v ?? null), { 'Content-Type': 'text/yaml; charset=utf-8', 'Content-Disposition': `attachment; filename="${p.code}.yaml"` });
  });

  /* ---------- incidents ---------- */
  r.get('/api/incidents', ctx => { need(ctx, 'viewer'); return listIncidents(store); });
  r.post('/api/incidents', ctx => {
    const u = need(ctx, 'analyst');
    const p = getPlaybook(store, String(ctx.body.playbookId || ''));
    if (!p) throw new HttpError(404, 'Playbook not found');
    const ver = ctx.body.v ? p.versions.find(x => x.v === Number(ctx.body.v)) : liveVersion(store, p.id);
    if (!ver) throw new HttpError(422, 'Publish this playbook before running it');
    const name = str(ctx.body.name, 'Incident name', 160, { min: 1 });
    const mode = ctx.body.mode === 'exercise' ? 'exercise' : 'live';
    const speed = mode === 'exercise' ? int(ctx.body.speed ?? 60, 'Speed', 1, 600) : 1;
    const severity = ctx.body.severity ? oneOf(ctx.body.severity, 'Severity', SEVERITIES) : p.severity;
    const inc = store.tx(() => {
      const i = startIncident({ id: uid('inc_'), ref: incidentRef(store), name, playbookId: p.id, pbCode: p.code, pbName: p.name, v: ver.v, graph: ver.graph, mode, speed, severity, by: u.name });
      saveIncident(store, i, true);
      return i;
    });
    store.audit(u.name, mode === 'exercise' ? 'exercise.start' : 'incident.declare', `${inc.ref} ${name}`, `${p.code} v${ver.v}`);
    broadcast('incident', inc.id);
    return { ...getIncident(store, inc.id), serverNow: Date.now() };
  });
  r.get('/api/incidents/:id', ctx => {
    need(ctx, 'viewer');
    const inc = getIncident(store, ctx.params.id);
    if (!inc) throw new HttpError(404, 'Incident not found');
    return { ...inc, serverNow: Date.now() };
  });
  const mutate = (ctx: Ctx, fn: (inc: Incident, by: string) => void, action?: string) => {
    const u = need(ctx, 'analyst');
    const result = store.tx(() => {
      const inc = getIncident(store, ctx.params.id);
      if (!inc) throw new HttpError(404, 'Incident not found');
      if (ctx.body.rev !== undefined && Number(ctx.body.rev) !== inc.rev) throw new HttpError(409, 'Someone else just updated this incident. The page has been refreshed.');
      try { fn(inc, u.name); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(422, (e as Error).message); }
      saveIncident(store, inc);
      return inc;
    });
    if (action) store.audit(u.name, action, result.ref);
    broadcast('incident', result.id);
    return { ...getIncident(store, result.id), serverNow: Date.now() };
  };
  r.post('/api/incidents/:id/advance', ctx => mutate(ctx, (inc, by) => advance(inc, String(ctx.body.edgeId || ''), by)));
  r.post('/api/incidents/:id/tasks', ctx => mutate(ctx, (inc, by) => toggleTask(inc, String(ctx.body.nodeId || ''), int(ctx.body.index, 'Task', 0, 500), !!ctx.body.done, by)));
  r.post('/api/incidents/:id/notes', ctx => mutate(ctx, inc => { inc.notes = str(ctx.body.notes, 'Notes', 20000, { optional: true }); }));
  r.post('/api/incidents/:id/meta', ctx => mutate(ctx, inc => {
    if (ctx.body.name !== undefined) inc.name = str(ctx.body.name, 'Incident name', 160, { min: 1 });
    if (ctx.body.severity !== undefined) inc.severity = oneOf(ctx.body.severity, 'Severity', SEVERITIES);
  }));
  r.post('/api/incidents/:id/speed', ctx => mutate(ctx, inc => {
    if (inc.mode !== 'exercise') throw new HttpError(422, 'Only exercises can change speed');
    if (inc.status !== 'active') throw new HttpError(422, 'This exercise is over');
    setSpeed(inc, int(ctx.body.speed, 'Speed', 1, 600));
  }));
  r.post('/api/incidents/:id/stop', ctx => mutate(ctx, (inc, by) => stopIncident(inc, by), 'incident.stop'));
  r.post('/api/incidents/:id/report', ctx => {
    const u = need(ctx, 'analyst');
    const out = store.tx(() => {
      const inc = getIncident(store, ctx.params.id);
      if (!inc) throw new HttpError(404, 'Incident not found');
      if (inc.reportId && getReport(store, inc.reportId)) return getReport(store, inc.reportId)!;
      const tpl = ctx.body.templateId ? getTemplate(store, String(ctx.body.templateId)) : defaultTemplate(store);
      if (!tpl) throw new HttpError(404, 'Template not found');
      const data = reportData(inc);
      const rep: Report = {
        id: uid('rep_'), num: formatId(tpl, Date.now(), inc.pbCode, tpl.seq), incidentId: inc.id, templateId: tpl.id, created: new Date().toISOString(),
        author: u.name, severity: inc.severity, summary: autoSummary(data), notes: inc.notes || '', data
      };
      tpl.seq += 1;
      saveTemplate(store, tpl);
      saveReport(store, rep, true);
      inc.reportId = rep.id;
      saveIncident(store, inc);
      store.audit(u.name, 'report.create', rep.num, inc.ref);
      return rep;
    });
    broadcast('report', out.id); broadcast('incident', ctx.params.id);
    return out;
  });

  /* ---------- reports ---------- */
  r.get('/api/reports', ctx => { need(ctx, 'viewer'); return listReports(store); });
  r.get('/api/reports/:id', ctx => {
    need(ctx, 'viewer');
    const rep = getReport(store, ctx.params.id);
    if (!rep) throw new HttpError(404, 'Report not found');
    return rep;
  });
  r.patch('/api/reports/:id', ctx => {
    const u = need(ctx, 'analyst');
    const rep = getReport(store, ctx.params.id);
    if (!rep) throw new HttpError(404, 'Report not found');
    if (ctx.body.num !== undefined) rep.num = str(ctx.body.num, 'Report ID', 80, { min: 1 });
    if (ctx.body.severity !== undefined) rep.severity = oneOf(ctx.body.severity, 'Severity', SEVERITIES) as Severity;
    if (ctx.body.summary !== undefined) rep.summary = str(ctx.body.summary, 'Executive summary', 20000, { optional: true });
    if (ctx.body.notes !== undefined) rep.notes = str(ctx.body.notes, 'Analyst notes', 40000, { optional: true });
    if (ctx.body.templateId !== undefined) { if (!getTemplate(store, String(ctx.body.templateId))) throw new HttpError(404, 'Template not found'); rep.templateId = String(ctx.body.templateId); }
    if (ctx.body.refresh) {
      const inc = getIncident(store, rep.incidentId);
      if (!inc) throw new HttpError(404, 'The incident behind this report no longer exists');
      rep.data = reportData(inc);
    }
    if (ctx.body.regenerateSummary) rep.summary = autoSummary(rep.data);
    saveReport(store, rep);
    broadcast('report', rep.id, { by: u.id });
    return rep;
  });
  r.delete('/api/reports/:id', ctx => {
    const u = need(ctx, 'admin');
    const rep = getReport(store, ctx.params.id);
    if (!rep) throw new HttpError(404, 'Report not found');
    store.run('DELETE FROM reports WHERE id = ?', rep.id);
    const inc = getIncident(store, rep.incidentId);
    if (inc && inc.reportId === rep.id) { inc.reportId = null; saveIncident(store, inc); }
    store.audit(u.name, 'report.delete', rep.num);
    broadcast('report', rep.id);
    return { ok: true };
  });
  const reportWithTemplate = (id: string) => {
    const rep = getReport(store, id);
    if (!rep) throw new HttpError(404, 'Report not found');
    const tpl = getTemplate(store, rep.templateId) || defaultTemplate(store);
    return { rep, tpl };
  };
  const fileName = (num: string, ext: string) => `${num.replace(/[^A-Za-z0-9._-]+/g, '-')}.${ext}`;
  r.get('/api/reports/:id/pdf', async ctx => {
    const u = need(ctx, 'viewer');
    const { rep, tpl } = reportWithTemplate(ctx.params.id);
    const bytes = await renderReportPdf(tpl, rep);
    store.audit(u.name, 'report.export.pdf', rep.num);
    const disp = ctx.query.get('inline') ? 'inline' : 'attachment';
    return send(ctx.res, 200, bytes, { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disp}; filename="${fileName(rep.num, 'pdf')}"`, 'Cache-Control': 'no-store' });
  });
  r.get('/api/reports/:id/markdown', ctx => {
    need(ctx, 'viewer');
    const { rep, tpl } = reportWithTemplate(ctx.params.id);
    return send(ctx.res, 200, toMarkdown(tpl, rep), { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName(rep.num, 'md')}"` });
  });

  /* ---------- templates ---------- */
  r.get('/api/templates', ctx => { need(ctx, 'viewer'); return listTemplates(store); });
  r.post('/api/templates', ctx => {
    const u = need(ctx, 'editor');
    const src = ctx.body.fromId ? getTemplate(store, String(ctx.body.fromId)) : defaultTemplate(store);
    if (!src) throw new HttpError(404, 'Template not found');
    const t: Template = { ...clone(src), id: uid('tpl_'), name: 'Copy of ' + src.name, seq: 1, isDefault: false };
    saveTemplate(store, t, true);
    store.audit(u.name, 'template.create', t.name);
    broadcast('templates', t.id);
    return t;
  });
  r.put('/api/templates/:id', ctx => {
    const u = need(ctx, 'editor');
    const cur = getTemplate(store, ctx.params.id);
    if (!cur) throw new HttpError(404, 'Template not found');
    const b = ctx.body;
    const logo = b.logo === null || b.logo === '' ? null : b.logo !== undefined ? String(b.logo) : cur.logo;
    if (logo && !/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new HttpError(400, 'The logo must be a PNG or JPG image');
    if (logo && logo.length > 700000) throw new HttpError(413, 'The logo is too large. Keep it under 500 KB.');
    let sections = cur.sections;
    if (b.sections !== undefined) {
      if (!Array.isArray(b.sections) || b.sections.length !== SECTION_KEYS.length) throw new HttpError(400, 'Sections are incomplete');
      const seen = new Set<string>();
      sections = b.sections.map((s: any) => {
        const key = oneOf(s?.key, 'Section', SECTION_KEYS);
        if (seen.has(key)) throw new HttpError(400, 'Each section can appear once');
        seen.add(key);
        return { key, title: str(s.title, 'Section title', 80, { optional: true }) || SECTION_LABEL[key], on: !!s.on };
      });
    }
    const accent = b.accent !== undefined ? String(b.accent) : cur.accent;
    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new HttpError(400, 'Accent colour must look like #FF5A1F');
    const t: Template = {
      ...cur,
      name: b.name !== undefined ? str(b.name, 'Template name', 80, { min: 1 }) : cur.name,
      org: b.org !== undefined ? str(b.org, 'Organisation', 120, { optional: true }) : cur.org,
      pattern: b.pattern !== undefined ? str(b.pattern, 'ID pattern', 80, { min: 1 }) : cur.pattern,
      seq: b.seq !== undefined ? int(b.seq, 'Next number', 1, 99999999) : cur.seq,
      pad: b.pad !== undefined ? int(b.pad, 'Digits', 1, 8) : cur.pad,
      classification: b.classification !== undefined ? str(b.classification, 'Classification', 60, { optional: true }) : cur.classification,
      footer: b.footer !== undefined ? str(b.footer, 'Footer', 600, { optional: true }) : cur.footer,
      accent, logo, sections
    };
    saveTemplate(store, t);
    store.audit(u.name, 'template.update', t.name);
    broadcast('templates', t.id, { by: u.id });
    return t;
  });
  r.post('/api/templates/:id/default', ctx => {
    const u = need(ctx, 'editor');
    const t = getTemplate(store, ctx.params.id);
    if (!t) throw new HttpError(404, 'Template not found');
    store.tx(() => { store.run('UPDATE templates SET is_default = 0'); store.run('UPDATE templates SET is_default = 1 WHERE id = ?', t.id); });
    store.audit(u.name, 'template.default', t.name);
    broadcast('templates', t.id);
    return listTemplates(store);
  });
  r.delete('/api/templates/:id', ctx => {
    const u = need(ctx, 'editor');
    const t = getTemplate(store, ctx.params.id);
    if (!t) throw new HttpError(404, 'Template not found');
    if (t.isDefault) throw new HttpError(422, 'Choose another default template before deleting this one');
    store.run('DELETE FROM templates WHERE id = ?', t.id);
    store.audit(u.name, 'template.delete', t.name);
    broadcast('templates', t.id);
    return { ok: true };
  });

  /* ---------- users & audit ---------- */
  r.get('/api/users', ctx => { need(ctx, 'admin'); return listUsers(store); });
  r.post('/api/users', ctx => {
    const u = need(ctx, 'admin');
    const username = str(ctx.body.username, 'Username', 40, { min: 2 }).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(username)) throw new HttpError(400, 'Usernames use lowercase letters, digits, dots, dashes and underscores');
    if (store.get('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'That username is taken');
    const name = str(ctx.body.name, 'Full name', 80, { min: 1 });
    const role = oneOf(ctx.body.role, 'Role', ROLES);
    const pwErr = checkPasswordStrength(ctx.body.password);
    if (pwErr) throw new HttpError(400, pwErr);
    const id = uid('u_');
    store.run('INSERT INTO users(id, username, name, role, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, username, name, role, hashPassword(ctx.body.password), new Date().toISOString());
    store.audit(u.name, 'user.create', username, role);
    return listUsers(store).find(x => x.id === id);
  });
  r.patch('/api/users/:id', ctx => {
    const u = need(ctx, 'admin');
    const row = store.get<any>('SELECT * FROM users WHERE id = ?', ctx.params.id);
    if (!row) throw new HttpError(404, 'User not found');
    const role = ctx.body.role !== undefined ? oneOf(ctx.body.role, 'Role', ROLES) : row.role;
    const disabled = ctx.body.disabled !== undefined ? !!ctx.body.disabled : !!row.disabled;
    const name = ctx.body.name !== undefined ? str(ctx.body.name, 'Full name', 80, { min: 1 }) : row.name;
    const losesAdmin = row.role === 'admin' && (role !== 'admin' || disabled);
    if (losesAdmin) {
      const admins = store.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0")!.n;
      if (admins <= 1) throw new HttpError(422, 'Keep at least one active administrator');
    }
    store.run('UPDATE users SET role = ?, disabled = ?, name = ? WHERE id = ?', role, disabled ? 1 : 0, name, row.id);
    if (ctx.body.password !== undefined) {
      const pwErr = checkPasswordStrength(ctx.body.password);
      if (pwErr) throw new HttpError(400, pwErr);
      store.run('UPDATE users SET pw_hash = ? WHERE id = ?', hashPassword(ctx.body.password), row.id);
      destroyUserSessions(store, row.id);
      store.audit(u.name, 'user.password.reset', row.username);
    }
    if (disabled || role !== row.role) destroyUserSessions(store, row.id);
    store.audit(u.name, 'user.update', row.username, `${role}${disabled ? ', disabled' : ''}`);
    return listUsers(store).find(x => x.id === row.id);
  });
  r.get('/api/audit', ctx => {
    need(ctx, 'admin');
    return store.all('SELECT id, at, user, action, target, detail FROM audit ORDER BY id DESC LIMIT 300');
  });

  return r;
}

export const KEEP_OPEN = Symbol('keep-open');
