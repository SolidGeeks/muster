// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Backend for the online version published as a Claude artifact.
 * Same surface as backend/http.ts, but data lives in the artifact's shared store (`db` capability),
 * identity and roles come from the viewer's sharing level (`user` capability), and files go through
 * the viewer's save prompt (`downloads` capability).
 *
 * Store layout:
 *   playbooks/{id}                    playbook with its draft and a copy of the live version
 *   playbooks/{id}/versions/v{n}      published versions (immutable)
 *   incidents/{id}, reports/{id}, templates/{id}
 *   meta/counters                     incident and playbook numbering
 *   meta/seq                          next report number per template
 * People are stored as opaque ids and resolved to names for each viewer.
 */
import {
  type Playbook, type PlaybookSummary, type Incident, type Report, type Template, type Graph, type Severity, type Role, type Version,
  diff, validate, checkGraphShape, makeNode, makeEdge, layout, uid, clone, startIncident, advance as advanceInc, toggleTask, stopIncident,
  setSpeed, reportData, autoSummary, formatId, toMarkdown, toYaml, defaultPlaybooks, defaultTemplates, currentStep, stepCodes, incidentTime, EMPTY_GRAPH,
  cleanStrata, type StrataLink
} from '@muster/core';
import { renderReportPdf } from '@muster/pdf';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: any = {}) { super(message); }
}

export interface Me { id: string; username: string; name: string; role: Role }
export type IncidentFull = Incident & { rev: number; serverNow: number };
export type PlaybookFull = Playbook & { rev: number };
export interface IncidentRow {
  id: string; ref: string; name: string; pbCode: string; pbName: string; v: number; mode: 'live' | 'exercise'; severity: Severity;
  status: Incident['status']; startedAt: number; elapsed: number; createdBy: string; reportId: string | null; speed: number;
  current: { code: string; title: string; role: string; overdue: boolean } | null; rev: number;
  strata: Pick<StrataLink, 'site' | 'assets' | 'params'> | null;
}
export type StrataInput = { site?: string; assets?: string[]; params?: Record<string, string> } | null;
export interface ReportRow { id: string; num: string; name: string; ref: string; created: string; severity: Severity; author: string; templateId: string; incidentId: string; mode: 'live' | 'exercise' }
export interface AuditRow { id: number; at: string; user: string; action: string; target: string; detail: string }

export const features = { kind: 'artifact' as 'server' | 'artifact', localAuth: false, admin: false };

/* ---------- platform access ---------- */
type Claude = { use(name: string): Promise<any> };
const claude = (): Claude | undefined => (window as unknown as { claude?: Claude }).claude;
const cache: Record<string, Promise<any>> = {};
const use = (name: string): Promise<any> => cache[name] ||= (claude()?.use ? claude()!.use(name).catch(() => null) : Promise.resolve(null));

async function store(): Promise<any> {
  const d = await use('db');
  if (!d) throw new ApiError(503, 'Shared storage is not available in this view. Open the page in Claude while signed in.');
  return d;
}

function fail(e: any): never {
  if (e instanceof ApiError) throw e;
  const code = e?.code;
  if (code === 'invalid_argument') throw new ApiError(403, "Your access to this page doesn't allow this change. Ask the owner for edit access.");
  if (code === 'quota_exceeded') throw new ApiError(507, 'The shared storage for this page is full. Delete old incidents or reports, then try again.');
  if (code === 'resource_exhausted') throw new ApiError(429, 'Too many changes at once. Wait a moment and try again.');
  if (code === 'revoked' || code === 'not_granted') throw new ApiError(403, 'Access to this page changed. Reload it.');
  throw new ApiError(503, e?.message || 'The shared storage did not answer. Try again.');
}
async function w<T>(p: Promise<T>): Promise<T> { try { return await p; } catch (e) { fail(e); } }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let meCache: Me | null = null;
async function meId(): Promise<string> { return (meCache?.id) || 'system:Guest'; }

/** Cooperative lock so two people don't overwrite each other's change on the same document. */
async function withLease<T>(ref: any, fn: () => Promise<T>): Promise<T> {
  const holder = (await meId()) + ':' + uid();
  for (let i = 0; i < 25; i++) {
    let r: any;
    try { r = await ref.acquire({ holder, ttlMs: 8000 }); } catch (e) { fail(e); }
    if (r.acquired) return fn();
    await sleep(120 + Math.random() * 280);
  }
  throw new ApiError(409, 'Someone else is updating this right now. Try again in a moment.');
}

async function getDoc(path: string): Promise<any | null> {
  const s = await w((await store()).doc(path).get()) as any;
  return s.exists ? clone(s.data()) : null;
}
async function getAll(path: string): Promise<any[]> {
  const s = await w((await store()).collection(path).get()) as any;
  return s.docs.map((d: any) => clone(d.data()));
}
async function setDoc(path: string, data: Record<string, unknown>) { await w((await store()).doc(path).set(data)); }

/* ---------- identity ---------- */
async function me(): Promise<{ user: Me | null }> {
  const [d, user] = await Promise.all([use('db'), use('user')]);
  if (!d) return { user: null };
  const v = user ? await user.me() : null;
  const canEdit = user ? await user.canEdit() : false;
  const write = user ? await user.can('data.write') : null;
  const role: Role = canEdit ? 'admin' : write === false ? 'viewer' : 'analyst';
  meCache = { id: v?.id || 'system:Guest', username: '', name: v?.name || 'You', role };
  return { user: meCache };
}

/* ---------- counters ---------- */
async function bump(path: string, key: string, start: number): Promise<number> {
  const d = await store();
  const ref = d.doc(path);
  return withLease(ref, async () => {
    const cur = (await getDoc(path)) || {};
    const next = (typeof cur[key] === 'number' ? cur[key] : start - 1) + 1;
    await w(ref.set({ ...cur, [key]: next }));
    return next;
  });
}

/* ---------- playbooks ---------- */
type PbDoc = Omit<Playbook, 'versions'> & { rev: number; live: Version | null; archived?: boolean };

async function pbDoc(id: string): Promise<PbDoc> {
  const p = await getDoc(`playbooks/${id}`);
  if (!p || p.archived) throw new ApiError(404, 'Playbook not found');
  return p;
}
async function playbook(id: string): Promise<PlaybookFull> {
  const p = await pbDoc(id);
  const versions: Version[] = (await getAll(`playbooks/${id}/versions`)).sort((a, b) => a.v - b.v);
  const { live: _live, archived: _a, ...rest } = p;
  return { ...rest, versions };
}
async function playbooks(): Promise<PlaybookSummary[]> {
  const all: PbDoc[] = await getAll('playbooks');
  return all.filter(p => !p.archived).map(p => ({
    id: p.id, code: p.code, name: p.name, category: p.category, severity: p.severity, description: p.description,
    liveVersion: p.live ? p.live.v : null, pendingChanges: diff(p.live ? p.live.graph : EMPTY_GRAPH, p.draft).count,
    steps: p.draft.nodes.filter(n => n.type !== 'start' && n.type !== 'end').length, updatedAt: p.updatedAt, updatedBy: p.updatedBy
  })).sort((a, b) => a.code.localeCompare(b.code));
}
async function nextPlaybookCode(): Promise<string> {
  const all: PbDoc[] = await getAll('playbooks');
  const max = all.reduce((m, p) => Math.max(m, parseInt(p.code.replace(/\D/g, ''), 10) || 0), 0);
  const n = await bump('meta/counters', 'playbook', max + 1);
  return 'PB-' + String(Math.max(n, max + 1)).padStart(3, '0');
}
async function createPlaybook(b: { name: string; category: string; severity: Severity; description: string; duplicateOf?: string }): Promise<PlaybookFull> {
  if (!b.name?.trim()) throw new ApiError(400, 'Name is required');
  const graph = b.duplicateOf ? clone((await pbDoc(b.duplicateOf)).draft)
    : layout({ nodes: [makeNode('start', 'start', 'Alert received', 'Detection'), makeNode('end', 'end', 'Incident closed', 'Lessons learned')], edges: [makeEdge('start', 'end')] });
  const id = uid('pb_');
  const doc: PbDoc = { id, code: await nextPlaybookCode(), name: b.name.trim(), category: b.category?.trim() || 'General', severity: b.severity || 'Medium', description: b.description?.trim() || '', draft: graph, rev: 1, live: null, updatedAt: new Date().toISOString(), updatedBy: await meId() };
  await setDoc(`playbooks/${id}`, doc as any);
  return playbook(id);
}
async function updatePlaybook(id: string, patch: Partial<Pick<Playbook, 'name' | 'category' | 'severity' | 'description'>>): Promise<PlaybookFull> {
  const ref = (await store()).doc(`playbooks/${id}`);
  await w(ref.update({ ...patch, updatedAt: new Date().toISOString(), updatedBy: await meId() }));
  return playbook(id);
}
async function saveDraft(id: string, graph: Graph, rev: number) {
  const err = checkGraphShape(graph);
  if (err) throw new ApiError(400, err);
  const ref = (await store()).doc(`playbooks/${id}`);
  return withLease(ref, async () => {
    const cur = await pbDoc(id);
    if (cur.rev !== rev) throw new ApiError(409, 'A newer draft exists', { current: await playbook(id) });
    const next = { rev: cur.rev + 1, updatedAt: new Date().toISOString(), updatedBy: await meId() };
    await w(ref.update({ draft: graph, ...next }));
    return next;
  });
}
async function publish(id: string, msg: string): Promise<PlaybookFull> {
  const ref = (await store()).doc(`playbooks/${id}`);
  await withLease(ref, async () => {
    const p = await pbDoc(id);
    const v = validate(p.draft);
    if (v.errors) throw new ApiError(422, `Fix ${v.errors} error${v.errors > 1 ? 's' : ''} before publishing`);
    const n = (p.live?.v || 0) + 1;
    const ver: Version = { v: n, date: new Date().toISOString(), author: await meId(), msg: (msg || '').trim().slice(0, 300) || 'Update', graph: p.draft };
    await setDoc(`playbooks/${id}/versions/v${n}`, ver as any);
    await w(ref.update({ live: ver, updatedAt: ver.date }));
  });
  return playbook(id);
}
async function restore(id: string, v: number): Promise<PlaybookFull> {
  const ver = await getDoc(`playbooks/${id}/versions/v${v}`);
  if (!ver) throw new ApiError(404, 'That version does not exist');
  const ref = (await store()).doc(`playbooks/${id}`);
  await withLease(ref, async () => {
    const p = await pbDoc(id);
    await w(ref.update({ draft: ver.graph, rev: p.rev + 1, updatedAt: new Date().toISOString(), updatedBy: await meId() }));
  });
  return playbook(id);
}

/* ---------- incidents ---------- */
type IncDoc = Incident & { rev: number };
async function incDoc(id: string): Promise<IncDoc> {
  const i = await getDoc(`incidents/${id}`);
  if (!i) throw new ApiError(404, 'Incident not found');
  return i;
}
async function incidents(): Promise<IncidentRow[]> {
  const now = Date.now();
  const all: IncDoc[] = await getAll('incidents');
  return all.sort((a, b) => b.startedAt - a.startedAt).map(inc => {
    const cur = currentStep(inc), node = inc.graph.nodes.find(n => n.id === cur.id), codes = stepCodes(inc.graph);
    const elapsed = incidentTime(inc, now), stepElapsed = inc.status === 'active' ? elapsed - cur.start : 0;
    return {
      id: inc.id, ref: inc.ref, name: inc.name, pbCode: inc.pbCode, pbName: inc.pbName, v: inc.v, mode: inc.mode, severity: inc.severity, status: inc.status,
      startedAt: inc.startedAt, elapsed, createdBy: inc.createdBy, reportId: inc.reportId || null, speed: inc.clock.speed, rev: inc.rev,
      current: node && inc.status === 'active' ? { code: codes[node.id], title: node.title, role: node.role, overdue: !!(node.sla && stepElapsed > node.sla * 60000) } : null,
      strata: inc.strata ? { site: inc.strata.site, assets: inc.strata.assets, params: inc.strata.params } : null
    };
  });
}
async function incident(id: string): Promise<IncidentFull> { return { ...(await incDoc(id)), serverNow: Date.now() }; }
async function declare(b: { playbookId: string; v: number; name: string; mode: 'live' | 'exercise'; speed: number; severity: Severity; strata?: StrataInput }): Promise<IncidentFull> {
  if (!b.name?.trim()) throw new ApiError(400, 'Incident name is required');
  let strata;
  try { strata = cleanStrata(b.strata); } catch (e) { throw new ApiError(400, (e as Error).message); }
  const ver = await getDoc(`playbooks/${b.playbookId}/versions/v${b.v}`);
  const p = await pbDoc(b.playbookId);
  if (!ver) throw new ApiError(422, 'Publish this playbook before running it');
  const y = new Date().getUTCFullYear();
  const n = await bump('meta/counters', 'incident-' + y, 1);
  const inc = startIncident({
    id: uid('inc_'), ref: `INC-${y}-${String(n).padStart(4, '0')}`, name: b.name.trim().slice(0, 160), playbookId: p.id, pbCode: p.code, pbName: p.name,
    v: ver.v, graph: ver.graph, mode: b.mode, speed: b.mode === 'exercise' ? Math.min(600, Math.max(1, b.speed || 60)) : 1, severity: b.severity, by: await meId(), strata
  });
  await setDoc(`incidents/${inc.id}`, { ...inc, rev: 1 } as any);
  return incident(inc.id);
}
async function mutate(id: string, fn: (inc: Incident, by: string) => void, rev?: number): Promise<IncidentFull> {
  const ref = (await store()).doc(`incidents/${id}`);
  return withLease(ref, async () => {
    const inc = await incDoc(id);
    if (rev !== undefined && rev !== inc.rev) throw new ApiError(409, 'Someone else just updated this incident. The page has been refreshed.');
    try { fn(inc, await meId()); } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(422, (e as Error).message); }
    inc.rev += 1;
    await w(ref.set(inc as any));
    return { ...inc, serverNow: Date.now() };
  });
}

/* ---------- templates ---------- */
async function templates(): Promise<Template[]> {
  const [all, seq] = await Promise.all([getAll('templates'), getDoc('meta/seq')]);
  return (all as (Template & { position?: number })[])
    .map(t => ({ ...t, seq: typeof seq?.[t.id] === 'number' ? seq[t.id] : t.seq }))
    .sort((a, b) => (Number(b.isDefault) - Number(a.isDefault)) || ((a.position || 0) - (b.position || 0)));
}
async function setSeq(id: string, value: number) {
  const ref = (await store()).doc('meta/seq');
  await withLease(ref, async () => { const cur = (await getDoc('meta/seq')) || {}; await w(ref.set({ ...cur, [id]: value })); });
}
async function saveTemplate(t: Template): Promise<Template> {
  if (!/^#[0-9a-fA-F]{6}$/.test(t.accent)) throw new ApiError(400, 'Accent colour must look like #FF5A1F');
  if (t.logo && !/^data:image\/(png|jpe?g);base64,/.test(t.logo)) throw new ApiError(400, 'The logo must be a PNG or JPG image');
  if (t.logo && t.logo.length > 190000) throw new ApiError(413, 'The logo is too large for the online version. Use a smaller or simpler image.');
  const cur = (await getDoc(`templates/${t.id}`)) || {};
  const { seq, ...rest } = t;
  await setDoc(`templates/${t.id}`, { ...rest, position: cur.position ?? Date.now(), updatedBy: await meId() } as any);
  const s = await getDoc('meta/seq');
  if (s?.[t.id] !== seq) await setSeq(t.id, Math.max(1, Math.floor(seq) || 1));
  return t;
}

/* ---------- reports ---------- */
async function report(id: string): Promise<Report> {
  const r = await getDoc(`reports/${id}`);
  if (!r) throw new ApiError(404, 'Report not found');
  return r;
}
async function createReport(incidentId: string): Promise<Report> {
  const inc = await incDoc(incidentId);
  if (inc.reportId) { const ex = await getDoc(`reports/${inc.reportId}`); if (ex) return ex; }
  const tpl = (await templates())[0];
  if (!tpl) throw new ApiError(422, 'Create a report template first');
  const seq = await (async () => {
    const ref = (await store()).doc('meta/seq');
    return withLease(ref, async () => {
      const cur = (await getDoc('meta/seq')) || {};
      const n = typeof cur[tpl.id] === 'number' ? cur[tpl.id] : tpl.seq;
      await w(ref.set({ ...cur, [tpl.id]: n + 1 }));
      return n;
    });
  })();
  const data = reportData(inc);
  const rep: Report = { id: uid('rep_'), num: formatId(tpl, Date.now(), inc.pbCode, seq), incidentId: inc.id, templateId: tpl.id, created: new Date().toISOString(), author: await meId(), severity: inc.severity, summary: autoSummary(data), notes: inc.notes || '', data };
  await setDoc(`reports/${rep.id}`, { ...rep, updatedBy: await meId() } as any);
  await mutate(inc.id, i => { i.reportId = rep.id; });
  return rep;
}

/* ---------- names & files ---------- */
export async function resolveNames(refs: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const ids = refs.filter(r => !r.startsWith('system:'));
  // Data loaded before the product was renamed still says "Vigie library".
  for (const r of refs) if (r.startsWith('system:')) out[r] = r.slice(7).replace(/^Vigie\b/, 'Muster');
  if (ids.length) {
    const user = await use('user');
    const ps = user ? await user.profiles(ids) : {};
    for (const id of ids) out[id] = ps?.[id]?.name || 'Someone';
  }
  return out;
}

async function withNames(r: Report): Promise<Report> {
  const refs = [r.author, ...r.data.timeline.map(l => l.by).filter(Boolean) as string[]];
  const n = await resolveNames([...new Set(refs)]);
  return { ...r, author: n[r.author] || r.author, data: { ...r.data, timeline: r.data.timeline.map(l => ({ ...l, by: l.by ? n[l.by] || l.by : l.by })) } };
}

export function fileLinks(_kind: 'report' | 'playbook', _id: string): { pdf?: string; md?: string; yaml?: string } { return {}; }

export async function saveFile(kind: 'pdf' | 'md', reportId: string): Promise<void> {
  const dl = await use('downloads');
  if (!dl) throw new ApiError(503, 'Saving files is not available in this view. Use Copy formatted instead.');
  const raw = await report(reportId);
  const tpl = (await templates()).find(t => t.id === raw.templateId) || (await templates())[0];
  const r = await withNames(raw);
  const base = r.num.replace(/[^A-Za-z0-9._-]+/g, '-');
  const data = kind === 'pdf' ? new Blob([(await renderReportPdf(tpl, r)) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }) : toMarkdown(tpl, r);
  try { await dl.save({ filename: `${base}.${kind}`, data }); }
  catch (e: any) {
    if (e?.code === 'declined') throw new ApiError(0, '');
    if (e?.code === 'rate_limited') throw new ApiError(429, 'A save prompt is already open.');
    throw new ApiError(503, "The file couldn't be saved here. Use Copy formatted instead.");
  }
}

/* ---------- live updates ---------- */
export function connectEvents(emit: (c: { type: string; id: string; by?: string }) => void): () => void {
  let stops: (() => void)[] = [];
  let stopped = false;
  store().then(d => {
    if (stopped) return;
    const watch = (path: string, types: string[]) => {
      let first = true;
      stops.push(d.collection(path).onSnapshot((snap: any) => {
        if (first) { first = false; return; }
        for (const ch of snap.docChanges()) {
          const body = ch.doc.data() || {};
          for (const t of types) emit({ type: t, id: ch.doc.id, by: body.updatedBy });
        }
      }, () => { /* the page keeps working; it just stops live-refreshing */ }));
    };
    watch('playbooks', ['playbooks', 'playbook']);
    watch('incidents', ['incident']);
    watch('reports', ['report']);
    watch('templates', ['templates']);
  }).catch(() => {});
  return () => { stopped = true; stops.forEach(s => s()); stops = []; };
}

/** Writes the ten default playbooks and the two report templates. Used when the store is empty. */
export async function installDefaults(): Promise<void> {
  const by = 'system:Muster library';
  const existing = new Set((await getAll('playbooks')).map((p: any) => p.code));
  for (const p of defaultPlaybooks()) {
    if (existing.has(p.code)) continue;
    const id = uid('pb_');
    const versions = p.versions.map((v, i) => ({ v: i + 1, date: v.date, author: by, msg: v.msg, graph: v.graph }));
    for (const v of versions) await setDoc(`playbooks/${id}/versions/v${v.v}`, v as any);
    const last = versions[versions.length - 1];
    await setDoc(`playbooks/${id}`, { id, code: p.code, name: p.name, category: p.category, severity: p.severity, description: p.description, draft: p.draft, rev: 1, live: last, updatedAt: last.date, updatedBy: by } as any);
  }
  if (!(await getAll('templates')).length) {
    let pos = 1;
    for (const t of defaultTemplates()) { const { seq, ...rest } = t; await setDoc(`templates/${t.id}`, { ...rest, position: pos++, updatedBy: by } as any); await setSeq(t.id, seq); }
  }
}

/* ---------- the API surface used by the views ---------- */
const unsupported = async (): Promise<never> => { throw new ApiError(400, 'Accounts are managed in Claude for the online version'); };

export const api = {
  config: async () => ({ demo: false, demoAccounts: [] as { username: string; password: string; role: Role }[] }),
  me,
  login: unsupported as (u: string, p: string) => Promise<{ user: Me }>,
  logout: async () => ({}),
  changePassword: unsupported as (c: string, n: string) => Promise<unknown>,

  playbooks,
  playbook,
  createPlaybook,
  updatePlaybook,
  saveDraft,
  publish,
  restore,
  archivePlaybook: async (id: string) => { await w((await store()).doc(`playbooks/${id}`).update({ archived: true, updatedBy: await meId(), updatedAt: new Date().toISOString() })); },
  yaml: async (id: string) => { const p = await playbook(id); return toYaml(p, p.draft, p.versions.at(-1)?.v ?? null); },

  incidents,
  incident,
  declare,
  advance: (id: string, edgeId: string, rev: number) => mutate(id, (inc, by) => advanceInc(inc, edgeId, by), rev),
  task: (id: string, nodeId: string, index: number, done: boolean) => mutate(id, (inc, by) => toggleTask(inc, nodeId, index, done, by)),
  notes: (id: string, notes: string) => mutate(id, inc => { inc.notes = String(notes || '').slice(0, 20000); }),
  incidentMeta: (id: string, b: { name?: string; severity?: Severity }) => mutate(id, inc => { if (b.name) inc.name = b.name.slice(0, 160); if (b.severity) inc.severity = b.severity; }),
  speed: (id: string, speed: number) => mutate(id, inc => { if (inc.mode !== 'exercise') throw new ApiError(422, 'Only exercises can change speed'); setSpeed(inc, Math.min(600, Math.max(1, speed))); }),
  stop: (id: string) => mutate(id, (inc, by) => stopIncident(inc, by)),
  createReport,

  reports: async (): Promise<ReportRow[]> => (await getAll('reports') as Report[]).sort((a, b) => b.created.localeCompare(a.created)).map(r => ({
    id: r.id, num: r.num, name: r.data.name, ref: r.data.ref, created: r.created, severity: r.severity, author: r.author, templateId: r.templateId, incidentId: r.incidentId, mode: r.data.mode
  })),
  report,
  updateReport: async (id: string, b: Partial<Pick<Report, 'num' | 'severity' | 'summary' | 'notes' | 'templateId'>> & { refresh?: boolean; regenerateSummary?: boolean }): Promise<Report> => {
    const r = await report(id);
    const { refresh, regenerateSummary, ...patch } = b;
    Object.assign(r, patch);
    if (refresh) r.data = reportData(await incDoc(r.incidentId));
    if (regenerateSummary) r.summary = autoSummary(r.data);
    await setDoc(`reports/${id}`, { ...r, updatedBy: await meId() } as any);
    return r;
  },
  deleteReport: async (id: string) => {
    const r = await report(id);
    await w((await store()).doc(`reports/${id}`).delete());
    try { await mutate(r.incidentId, i => { if (i.reportId === id) i.reportId = null; }); } catch { /* incident gone */ }
  },
  markdown: async (id: string) => { const r = await withNames(await report(id)); const t = (await templates()).find(x => x.id === r.templateId) || (await templates())[0]; return toMarkdown(t, r); },

  templates,
  createTemplate: async (fromId?: string): Promise<Template> => {
    const all = await templates();
    const src = all.find(t => t.id === fromId) || all[0];
    if (!src) throw new ApiError(404, 'Template not found');
    const t: Template = { ...clone(src), id: uid('tpl_'), name: 'Copy of ' + src.name, seq: 1, isDefault: false };
    await saveTemplate(t);
    return t;
  },
  saveTemplate,
  setDefaultTemplate: async (id: string): Promise<Template[]> => {
    const all = await templates();
    for (const t of all) if (t.isDefault !== (t.id === id)) await w((await store()).doc(`templates/${t.id}`).update({ isDefault: t.id === id, updatedBy: await meId() }));
    return templates();
  },
  deleteTemplate: async (id: string) => {
    const t = (await templates()).find(x => x.id === id);
    if (t?.isDefault) throw new ApiError(422, 'Choose another default template before deleting this one');
    await w((await store()).doc(`templates/${id}`).delete());
  },

  users: unsupported as () => Promise<any[]>,
  createUser: unsupported as (b: any) => Promise<any>,
  updateUser: unsupported as (id: string, b: any) => Promise<any>,
  audit: unsupported as () => Promise<AuditRow[]>
};
