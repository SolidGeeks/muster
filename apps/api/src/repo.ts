// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Store } from './db';
import {
  type Playbook, type PlaybookSummary, type Graph, type Incident, type Report, type Template, type User, type Version,
  diff, EMPTY_GRAPH, stepCodes, currentStep, incidentTime, withAllSections
} from '@muster/core';

/* ---------- Playbooks ---------- */

interface PbRow { id: string; code: string; name: string; category: string; severity: string; description: string; draft: string; rev: number; archived: number; updated_at: string; updated_by: string }

export function versionsOf(s: Store, id: string): Version[] {
  return s.all<any>('SELECT v, date, author, msg, graph FROM versions WHERE playbook_id = ? ORDER BY v', id)
    .map(r => ({ v: r.v, date: r.date, author: r.author, msg: r.msg, graph: JSON.parse(r.graph) }));
}

export function liveVersion(s: Store, id: string): Version | undefined {
  const r = s.get<any>('SELECT v, date, author, msg, graph FROM versions WHERE playbook_id = ? ORDER BY v DESC LIMIT 1', id);
  return r ? { v: r.v, date: r.date, author: r.author, msg: r.msg, graph: JSON.parse(r.graph) } : undefined;
}

function pbRow(s: Store, id: string): PbRow | undefined {
  return s.get<PbRow>('SELECT * FROM playbooks WHERE id = ? AND archived = 0', id);
}

export function getPlaybook(s: Store, id: string): (Playbook & { rev: number }) | undefined {
  const r = pbRow(s, id);
  if (!r) return undefined;
  return {
    id: r.id, code: r.code, name: r.name, category: r.category, severity: r.severity as Playbook['severity'], description: r.description,
    draft: JSON.parse(r.draft), versions: versionsOf(s, r.id), updatedAt: r.updated_at, updatedBy: r.updated_by, rev: r.rev
  };
}

export function listPlaybooks(s: Store): PlaybookSummary[] {
  const rows = s.all<PbRow>('SELECT * FROM playbooks WHERE archived = 0 ORDER BY code');
  return rows.map(r => {
    const draft: Graph = JSON.parse(r.draft);
    const live = liveVersion(s, r.id);
    return {
      id: r.id, code: r.code, name: r.name, category: r.category, severity: r.severity as PlaybookSummary['severity'], description: r.description,
      liveVersion: live ? live.v : null, pendingChanges: diff(live ? live.graph : EMPTY_GRAPH, draft).count,
      steps: draft.nodes.filter(n => n.type !== 'start' && n.type !== 'end').length, updatedAt: r.updated_at, updatedBy: r.updated_by
    };
  });
}

export function nextPlaybookCode(s: Store): string {
  const rows = s.all<{ code: string }>('SELECT code FROM playbooks');
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.code.replace(/\D/g, ''), 10) || 0), 0);
  return 'PB-' + String(max + 1).padStart(3, '0');
}

/* ---------- Incidents ---------- */

export function getIncident(s: Store, id: string): (Incident & { rev: number }) | undefined {
  const r = s.get<any>('SELECT data, rev FROM incidents WHERE id = ?', id);
  return r ? { ...JSON.parse(r.data), rev: r.rev } : undefined;
}

export function saveIncident(s: Store, inc: Incident, isNew = false) {
  const { rev: _r, ...data } = inc as Incident & { rev?: number };
  const now = new Date().toISOString();
  if (isNew) s.run('INSERT INTO incidents(id, ref, status, data, rev, started_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', inc.id, inc.ref, inc.status, JSON.stringify(data), inc.startedAt, now);
  else s.run('UPDATE incidents SET status = ?, data = ?, rev = rev + 1, updated_at = ? WHERE id = ?', inc.status, JSON.stringify(data), now, inc.id);
}

export function listIncidents(s: Store) {
  const now = Date.now();
  return s.all<any>('SELECT data, rev FROM incidents ORDER BY started_at DESC LIMIT 500').map(r => {
    const inc: Incident = JSON.parse(r.data);
    const cur = currentStep(inc);
    const node = inc.graph.nodes.find(n => n.id === cur.id);
    const codes = stepCodes(inc.graph);
    const elapsed = incidentTime(inc, now);
    const stepElapsed = inc.status === 'active' ? elapsed - cur.start : 0;
    return {
      id: inc.id, ref: inc.ref, name: inc.name, pbCode: inc.pbCode, pbName: inc.pbName, v: inc.v, mode: inc.mode, severity: inc.severity,
      status: inc.status, startedAt: inc.startedAt, elapsed, createdBy: inc.createdBy, reportId: inc.reportId || null,
      current: node && inc.status === 'active' ? { code: codes[node.id], title: node.title, role: node.role, overdue: !!(node.sla && stepElapsed > node.sla * 60000) } : null,
      speed: inc.clock.speed, rev: r.rev,
      strata: inc.strata ? { site: inc.strata.site, assets: inc.strata.assets, params: inc.strata.params } : null
    };
  });
}

/* ---------- Reports ---------- */

export function getReport(s: Store, id: string): Report | undefined {
  const r = s.get<any>('SELECT data FROM reports WHERE id = ?', id);
  return r ? JSON.parse(r.data) : undefined;
}

export function saveReport(s: Store, rep: Report, isNew = false) {
  const now = new Date().toISOString();
  if (isNew) s.run('INSERT INTO reports(id, num, incident_id, data, created, updated_at) VALUES (?, ?, ?, ?, ?, ?)', rep.id, rep.num, rep.incidentId, JSON.stringify(rep), rep.created, now);
  else s.run('UPDATE reports SET num = ?, data = ?, updated_at = ? WHERE id = ?', rep.num, JSON.stringify(rep), now, rep.id);
}

export function listReports(s: Store) {
  return s.all<any>('SELECT data FROM reports ORDER BY created DESC LIMIT 500').map(r => {
    const rep: Report = JSON.parse(r.data);
    return { id: rep.id, num: rep.num, name: rep.data.name, ref: rep.data.ref, created: rep.created, severity: rep.severity, author: rep.author, templateId: rep.templateId, incidentId: rep.incidentId, mode: rep.data.mode };
  });
}

/* ---------- Templates ---------- */

export function listTemplates(s: Store): Template[] {
  return s.all<any>('SELECT data, is_default FROM templates ORDER BY is_default DESC, position, id').map(r => withAllSections({ ...JSON.parse(r.data), isDefault: !!r.is_default }));
}

export function getTemplate(s: Store, id: string): Template | undefined {
  const r = s.get<any>('SELECT data, is_default FROM templates WHERE id = ?', id);
  return r ? withAllSections({ ...JSON.parse(r.data), isDefault: !!r.is_default }) : undefined;
}

export function defaultTemplate(s: Store): Template {
  return listTemplates(s)[0];
}

export function saveTemplate(s: Store, t: Template, isNew = false) {
  const { isDefault, ...data } = t;
  if (isNew) {
    const pos = (s.get<{ m: number }>('SELECT COALESCE(MAX(position), 0) AS m FROM templates')?.m || 0) + 1;
    s.run('INSERT INTO templates(id, data, is_default, position) VALUES (?, ?, ?, ?)', t.id, JSON.stringify(data), isDefault ? 1 : 0, pos);
  } else s.run('UPDATE templates SET data = ? WHERE id = ?', JSON.stringify(data), t.id);
}

/* ---------- Users ---------- */

export function listUsers(s: Store): User[] {
  return s.all<any>('SELECT id, username, name, role, disabled, created_at FROM users ORDER BY username')
    .map(r => ({ id: r.id, username: r.username, name: r.name, role: r.role, disabled: !!r.disabled, createdAt: r.created_at }));
}
