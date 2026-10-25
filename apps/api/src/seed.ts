// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import type { Store } from './db';
import { hashPassword } from './auth';
import { saveIncident, saveReport, saveTemplate } from './repo';
import {
  defaultPlaybooks, defaultTemplates, uid, startIncident, simulateIncident, reportData, autoSummary, formatId, advance, toggleTask,
  type Incident, type Report
} from '@muster/core';

export const DEMO_USERS = [
  { username: 'admin', name: 'Noah Laurent', role: 'admin', password: 'muster-admin' },
  { username: 'editor', name: 'Camille Roux', role: 'editor', password: 'muster-editor' },
  { username: 'analyst', name: 'Inès Benali', role: 'analyst', password: 'muster-analyst' },
  { username: 'viewer', name: 'Hugo Martin', role: 'viewer', password: 'muster-viewer' }
] as const;

export function incidentRef(s: Store, at = Date.now()): string {
  const y = new Date(at).getUTCFullYear();
  return `INC-${y}-${String(s.nextCounter('incident-' + y)).padStart(4, '0')}`;
}

// Bump when the demo data changes: a demo-mode server whose database holds older demo data
// replaces it on start (demo data is disposable; real installs, DEMO_MODE=false, are never touched).
export const DEMO_DATA_VERSION = '2';
const ALL_TABLES = ['sessions', 'versions', 'reports', 'incidents', 'playbooks', 'templates', 'counters', 'audit', 'users', 'meta'];

// A database seeded in demo mode. Older ones carry no 'mode' marker: recognise them by the four
// demo accounts, which a real install (one admin) never has.
function isDemoDatabase(s: Store): boolean {
  const mode = s.getMeta('mode');
  if (mode) return mode === 'demo';
  const n = s.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE username IN (${DEMO_USERS.map(() => '?').join(',')})`, ...DEMO_USERS.map(u => u.username))!.n;
  return n === DEMO_USERS.length;
}

export function seedIfEmpty(s: Store, opts: { demo: boolean; adminPassword?: string; log: (m: string) => void }) {
  if (opts.demo && s.getMeta('seeded') && s.getMeta('demo-data') !== DEMO_DATA_VERSION && isDemoDatabase(s)) {
    s.tx(() => { for (const t of ALL_TABLES) s.run(`DELETE FROM ${t}`); });
    opts.log('Outdated demo data found: replaced with the current demo data.');
  }
  if (s.getMeta('seeded')) return;
  s.tx(() => {
    const now = new Date().toISOString();
    if (opts.demo) {
      for (const u of DEMO_USERS) s.run('INSERT INTO users(id, username, name, role, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)', uid('u_'), u.username, u.name, u.role, hashPassword(u.password), now);
      opts.log('Demo accounts created: admin / editor / analyst / viewer (passwords muster-<role>).');
    } else {
      const pw = opts.adminPassword || randomBytes(12).toString('base64url');
      s.run('INSERT INTO users(id, username, name, role, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)', uid('u_'), 'admin', 'Administrator', 'admin', hashPassword(pw), now);
      opts.log(opts.adminPassword ? 'Admin account created with ADMIN_PASSWORD.' : `Admin account created. Username: admin  Password: ${pw}  (change it after signing in)`);
    }

    const ids: Record<string, string> = {};
    for (const p of defaultPlaybooks()) {
      const id = uid('pb_');
      ids[p.code] = id;
      const last = p.versions[p.versions.length - 1];
      s.run('INSERT INTO playbooks(id, code, name, category, severity, description, draft, rev, archived, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)',
        id, p.code, p.name, p.category, p.severity, p.description, JSON.stringify(p.draft), last.date, last.author);
      p.versions.forEach((v, i) => s.run('INSERT INTO versions(playbook_id, v, date, author, msg, graph) VALUES (?, ?, ?, ?, ?, ?)', id, i + 1, v.date, v.author, v.msg, JSON.stringify(v.graph)));
    }

    const templates = defaultTemplates();
    templates.forEach(t => saveTemplate(s, t, true));

    if (opts.demo) {
      const pbs = defaultPlaybooks();
      const phishing = pbs.find(p => p.code === 'PB-002')!;
      // A closed incident with its report, so Reports is not empty.
      const at = Date.UTC(2026, 9, 19, 7, 42);
      const inc: Incident = startIncident({
        id: uid('inc_'), ref: incidentRef(s, at), name: 'Mailbox compromise, accounting', playbookId: ids['PB-002'], pbCode: phishing.code, pbName: phishing.name,
        v: 1, graph: phishing.versions[0].graph, mode: 'live', speed: 1, severity: 'Medium', by: 'Inès Benali', now: at
      });
      simulateIncident(inc, { malicious: 'Yes', clicked: 'Yes' }, { analyse: 14, malicious: 6, purge: 25, clicked: 8, reset: 22, endpoint: 75 }, 'Inès Benali');
      inc.notes = 'Credentials were captured through a fake Microsoft 365 sign-in page hosted on a compromised WordPress site.\n\nNo MFA bypass was observed. The forwarding rule created at 07:18 UTC was removed during containment. Recommend number matching on MFA prompts for the finance team.';
      const tpl = templates[0];
      const data = reportData(inc);
      const rep: Report = {
        id: uid('rep_'), num: formatId(tpl, Date.UTC(2026, 9, 19, 11, 30), inc.pbCode, 41), incidentId: inc.id, templateId: tpl.id,
        created: '2026-10-19T11:30:00Z', author: 'Inès Benali', severity: 'Medium', summary: autoSummary(data), notes: inc.notes, data
      };
      inc.reportId = rep.id;
      saveIncident(s, inc, true);
      saveReport(s, rep, true);

      // An exercise in progress, so Incidents shows a live run.
      const rw = pbs.find(p => p.code === 'PB-001')!;
      const live = rw.versions[rw.versions.length - 1];
      const start = Date.now() - 6 * 60 * 1000;
      const ex = startIncident({
        id: uid('inc_'), ref: incidentRef(s), name: 'Tabletop: encrypted finance workstation', playbookId: ids['PB-001'], pbCode: rw.code, pbName: rw.name,
        v: rw.versions.length, graph: live.graph, mode: 'exercise', speed: 10, severity: 'High', by: 'Noah Laurent', now: start
      });
      ex.checks['triage'] = [true, true, true];
      advance(ex, 'e_triage_encrypt', 'Inès Benali', start + 90 * 1000);
      advance(ex, 'e_encrypt_isolate', 'Inès Benali', start + 2.5 * 60 * 1000);
      toggleTask(ex, 'isolate', 0, true, 'Inès Benali', start + 4 * 60 * 1000);
      ex.notes = 'Exercise scenario: finance workstation FIN-WS-042 shows .lockbit extensions. Participants: SOC, IT, CISO.';
      saveIncident(s, ex, true);
    }
    s.audit('system', 'seed', 'database', opts.demo ? 'demo data' : 'production defaults');
    s.setMeta('seeded', now);
    s.setMeta('mode', opts.demo ? 'demo' : 'real');
    if (opts.demo) s.setMeta('demo-data', DEMO_DATA_VERSION);
  });
}
