// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Playbook, PlaybookSummary, Incident, Report, Template, User, Graph, Severity, Role } from '@muster/core';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: any = {}) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-Muster': '1' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const msg = typeof data === 'object' && data && 'error' in data ? String((data as any).error) : `Request failed (${res.status})`;
    if (res.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/me') window.dispatchEvent(new CustomEvent('muster:signed-out'));
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export interface Me { id: string; username: string; name: string; role: Role }
export type IncidentFull = Incident & { rev: number; serverNow: number };
export type PlaybookFull = Playbook & { rev: number };
export interface IncidentRow {
  id: string; ref: string; name: string; pbCode: string; pbName: string; v: number; mode: 'live' | 'exercise'; severity: Severity;
  status: Incident['status']; startedAt: number; elapsed: number; createdBy: string; reportId: string | null; speed: number;
  current: { code: string; title: string; role: string; overdue: boolean } | null; rev: number;
}
export interface ReportRow { id: string; num: string; name: string; ref: string; created: string; severity: Severity; author: string; templateId: string; incidentId: string; mode: 'live' | 'exercise' }
export interface AuditRow { id: number; at: string; user: string; action: string; target: string; detail: string }

export const api = {
  config: () => call<{ demo: boolean; demoAccounts: { username: string; password: string; role: Role }[] }>('GET', '/api/config'),
  me: () => call<{ user: Me | null }>('GET', '/api/auth/me'),
  login: (username: string, password: string) => call<{ user: Me }>('POST', '/api/auth/login', { username, password }),
  logout: () => call('POST', '/api/auth/logout', {}),
  changePassword: (current: string, next: string) => call('POST', '/api/auth/password', { current, next }),

  playbooks: () => call<PlaybookSummary[]>('GET', '/api/playbooks'),
  playbook: (id: string) => call<PlaybookFull>('GET', `/api/playbooks/${id}`),
  createPlaybook: (b: { name: string; category: string; severity: Severity; description: string; duplicateOf?: string }) => call<PlaybookFull>('POST', '/api/playbooks', b),
  updatePlaybook: (id: string, b: Partial<Pick<Playbook, 'name' | 'category' | 'severity' | 'description'>>) => call<PlaybookFull>('PATCH', `/api/playbooks/${id}`, b),
  saveDraft: (id: string, graph: Graph, rev: number) => call<{ rev: number; updatedAt: string; updatedBy: string }>('PUT', `/api/playbooks/${id}/draft`, { graph, rev }),
  publish: (id: string, msg: string) => call<PlaybookFull>('POST', `/api/playbooks/${id}/publish`, { msg }),
  restore: (id: string, v: number) => call<PlaybookFull>('POST', `/api/playbooks/${id}/restore`, { v }),
  archivePlaybook: (id: string) => call('DELETE', `/api/playbooks/${id}`),
  yaml: (id: string) => call<string>('GET', `/api/playbooks/${id}/yaml`),

  incidents: () => call<IncidentRow[]>('GET', '/api/incidents'),
  incident: (id: string) => call<IncidentFull>('GET', `/api/incidents/${id}`),
  declare: (b: { playbookId: string; v: number; name: string; mode: 'live' | 'exercise'; speed: number; severity: Severity }) => call<IncidentFull>('POST', '/api/incidents', b),
  advance: (id: string, edgeId: string, rev: number) => call<IncidentFull>('POST', `/api/incidents/${id}/advance`, { edgeId, rev }),
  task: (id: string, nodeId: string, index: number, done: boolean) => call<IncidentFull>('POST', `/api/incidents/${id}/tasks`, { nodeId, index, done }),
  notes: (id: string, notes: string) => call<IncidentFull>('POST', `/api/incidents/${id}/notes`, { notes }),
  incidentMeta: (id: string, b: { name?: string; severity?: Severity }) => call<IncidentFull>('POST', `/api/incidents/${id}/meta`, b),
  speed: (id: string, speed: number) => call<IncidentFull>('POST', `/api/incidents/${id}/speed`, { speed }),
  stop: (id: string) => call<IncidentFull>('POST', `/api/incidents/${id}/stop`, {}),
  createReport: (id: string) => call<Report>('POST', `/api/incidents/${id}/report`, {}),

  reports: () => call<ReportRow[]>('GET', '/api/reports'),
  report: (id: string) => call<Report>('GET', `/api/reports/${id}`),
  updateReport: (id: string, b: Partial<Pick<Report, 'num' | 'severity' | 'summary' | 'notes' | 'templateId'>> & { refresh?: boolean; regenerateSummary?: boolean }) => call<Report>('PATCH', `/api/reports/${id}`, b),
  deleteReport: (id: string) => call('DELETE', `/api/reports/${id}`),
  markdown: (id: string) => call<string>('GET', `/api/reports/${id}/markdown`),

  templates: () => call<Template[]>('GET', '/api/templates'),
  createTemplate: (fromId?: string) => call<Template>('POST', '/api/templates', { fromId }),
  saveTemplate: (t: Template) => call<Template>('PUT', `/api/templates/${t.id}`, t),
  setDefaultTemplate: (id: string) => call<Template[]>('POST', `/api/templates/${id}/default`, {}),
  deleteTemplate: (id: string) => call('DELETE', `/api/templates/${id}`),

  users: () => call<User[]>('GET', '/api/users'),
  createUser: (b: { username: string; name: string; role: Role; password: string }) => call<User>('POST', '/api/users', b),
  updateUser: (id: string, b: { name?: string; role?: Role; disabled?: boolean; password?: string }) => call<User>('PATCH', `/api/users/${id}`, b),
  audit: () => call<AuditRow[]>('GET', '/api/audit')
};

/* ---------- backend-specific behaviour ---------- */

/** What this backend supports. The online (artifact) build swaps this file for backend/artifact.ts. */
export const features = {
  kind: 'server' as 'server' | 'artifact',
  /** Username/password sign-in, password changes, sign-out. */
  localAuth: true,
  /** User management and audit log pages. */
  admin: true
};

/** Live change feed. Returns a function that stops it. */
export function connectEvents(emit: (c: { type: string; id: string; by?: string }) => void): () => void {
  const es = new EventSource('/api/events');
  es.addEventListener('change', e => { try { emit(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ } });
  return () => es.close();
}

/** People are stored by display name on the server, so names resolve to themselves. */
export async function resolveNames(refs: string[]): Promise<Record<string, string>> {
  return Object.fromEntries(refs.map(r => [r, r]));
}

/** Files the browser can download directly. */
export function fileLinks(kind: 'report' | 'playbook', id: string): { pdf?: string; md?: string; yaml?: string } {
  return kind === 'report' ? { pdf: `/api/reports/${id}/pdf`, md: `/api/reports/${id}/markdown` } : { yaml: `/api/playbooks/${id}/yaml` };
}

/** Only used by the artifact backend, where files go through the viewer's save prompt. */
export async function saveFile(_kind: 'pdf' | 'md', _reportId: string): Promise<void> {
  throw new ApiError(400, 'Use the download link');
}

/** The server seeds its own data, so there is nothing to install from the browser. */
export const installDefaults: null | (() => Promise<void>) = null;
