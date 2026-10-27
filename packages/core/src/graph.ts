// SPDX-License-Identifier: AGPL-3.0-or-later
import { checkTargets } from './strata';
import type { Graph, PNode, PEdge, NodeType } from './types';

export const NODE_W = 220;
export const NODE_H = 76;
export const GAP_X = 48;
export const GAP_Y = 72;

export const PHASES = ['Detection', 'Containment', 'Eradication', 'Recovery', 'Lessons learned'] as const;
export const ROLES = [
  'L1 Analyst', 'L2 Analyst', 'IR Lead', 'CISO', 'Sysadmin', 'Network engineer', 'IT support',
  'Legal', 'DPO', 'HR', 'Finance', 'Communications'
] as const;
export const TYPE_LABEL: Record<NodeType, string> = {
  start: 'Start', action: 'Action', decision: 'Decision', escalation: 'Escalation', end: 'End'
};
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export const EMPTY_GRAPH: Graph = { nodes: [], edges: [] };

export function uid(prefix = ''): string {
  const rnd = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
    ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    : Math.random().toString(36).slice(2, 12);
  return prefix + rnd;
}

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export function makeNode(id: string, type: NodeType, title: string, phase = '', role = '', sla = 0, desc = '', checklist: string[] = []): PNode {
  return { id, type, title, phase, role, sla, desc, checklist, x: 0, y: 0 };
}

export function makeEdge(from: string, to: string, label = ''): PEdge {
  return { id: `e_${from}_${to}`, from, to, label };
}

/** Layered top-down layout from Start. Unreachable steps go in a column on the right. */
export function layout(g: Graph): Graph {
  const lvl: Record<string, number> = {};
  const n = g.nodes.length;
  const st = g.nodes.find(x => x.type === 'start');
  if (st) lvl[st.id] = 0;
  for (let i = 0; i < n; i++) {
    let changed = false;
    for (const e of g.edges) {
      if (lvl[e.from] != null) {
        const v = lvl[e.from] + 1;
        if (v < n && (lvl[e.to] == null || lvl[e.to] < v)) { lvl[e.to] = v; changed = true; }
      }
    }
    if (!changed) break;
  }
  const rows: Record<number, PNode[]> = {};
  const orphans: PNode[] = [];
  const xpos: Record<string, number> = {};
  for (const x of g.nodes) {
    if (lvl[x.id] == null) orphans.push(x);
    else (rows[lvl[x.id]] ||= []).push(x);
  }
  const edgeIdx = (node: PNode) => g.edges.findIndex(e => e.to === node.id);
  let maxX = 0;
  for (const l of Object.keys(rows).map(Number).sort((a, b) => a - b)) {
    const r = rows[l];
    const bary = new Map<string, number>();
    for (const x of r) {
      const ps = g.edges.filter(e => e.to === x.id && xpos[e.from] != null).map(e => xpos[e.from]);
      bary.set(x.id, ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0);
    }
    r.sort((a, b) => (bary.get(a.id)! - bary.get(b.id)!) || edgeIdx(a) - edgeIdx(b));
    const off = r.reduce((a, x) => a + bary.get(x.id)!, 0) / r.length;
    r.forEach((x, i) => {
      x.x = Math.round(off + (i - (r.length - 1) / 2) * (NODE_W + GAP_X));
      x.y = l * (NODE_H + GAP_Y);
      xpos[x.id] = x.x;
      maxX = Math.max(maxX, x.x);
    });
  }
  orphans.forEach((x, i) => { x.x = maxX + NODE_W + GAP_X * 2; x.y = (i + 1) * (NODE_H + GAP_Y); });
  return g;
}

/** Step codes follow reading order (breadth-first from Start). */
export function stepCodes(g: Graph): Record<string, string> {
  const codes: Record<string, string> = {};
  const st = g.nodes.find(n => n.type === 'start');
  const seen = new Set<string>();
  const order: string[] = [];
  if (st) {
    const q = [st.id];
    while (q.length) {
      const id = q.shift()!;
      if (seen.has(id)) continue;
      seen.add(id); order.push(id);
      for (const e of g.edges) if (e.from === id) q.push(e.to);
    }
  }
  for (const n of g.nodes) if (!seen.has(n.id)) order.push(n.id);
  let i = 0;
  for (const id of order) {
    const n = g.nodes.find(x => x.id === id);
    if (!n) continue;
    codes[id] = n.type === 'start' ? 'START' : n.type === 'end' ? 'END' : 'S' + String(++i).padStart(2, '0');
  }
  return codes;
}

export interface Check { id: string | null; lvl: 'err' | 'warn'; msg: string }
export interface Validation { list: Check[]; issues: Record<string, 'err' | 'warn'>; errors: number; warns: number }

export function validate(g: Graph): Validation {
  const list: Check[] = [];
  const issues: Record<string, 'err' | 'warn'> = {};
  const add = (id: string | null, lvl: 'err' | 'warn', msg: string) => {
    list.push({ id, lvl, msg });
    if (id) issues[id] = (issues[id] === 'err' || lvl === 'err') ? 'err' : 'warn';
  };
  const outs = (id: string) => g.edges.filter(e => e.from === id);
  const starts = g.nodes.filter(n => n.type === 'start');
  if (!starts.length) add(null, 'err', 'No start step');
  if (starts.length > 1) add(starts[1].id, 'err', 'More than one start step');
  if (!g.nodes.some(n => n.type === 'end')) add(null, 'err', 'No end step');
  const reach = new Set<string>();
  if (starts[0]) {
    const q = [starts[0].id];
    while (q.length) { const id = q.shift()!; if (reach.has(id)) continue; reach.add(id); outs(id).forEach(e => q.push(e.to)); }
  }
  for (const n of g.nodes) {
    const t = `“${n.title || 'Untitled'}”`;
    if (n.type !== 'start' && !reach.has(n.id)) add(n.id, 'err', `${t} cannot be reached from Start`);
    if (n.type !== 'end' && !outs(n.id).length) add(n.id, 'err', `${t} is a dead end`);
    if (n.type === 'decision') {
      const o = outs(n.id);
      if (o.length === 1) add(n.id, 'err', `${t} has only one answer`);
      else if (o.some(e => !e.label)) add(n.id, 'warn', `An answer of ${t} has no label`);
    }
    if ((n.type === 'action' || n.type === 'escalation') && !n.role) add(n.id, 'warn', `${t} has no owner`);
    if ((n.type === 'action' || n.type === 'escalation') && !n.sla) add(n.id, 'warn', `${t} has no SLA`);
  }
  return { list, issues, errors: list.filter(i => i.lvl === 'err').length, warns: list.filter(i => i.lvl === 'warn').length };
}

export const DIFF_FIELDS = { title: 'Title', type: 'Type', phase: 'Phase', role: 'Owner', sla: 'SLA', desc: 'Instructions', checklist: 'Checklist' } as const;
export type DiffField = keyof typeof DIFF_FIELDS;

export interface Diff {
  added: string[];
  removed: string[];
  modified: { id: string; f: { k: DiffField; from: unknown; to: unknown }[] }[];
  eAdded: string[];
  eRemoved: string[];
  eModified: string[];
  count: number;
}

export const edgeKey = (e: PEdge) => `${e.from}>${e.to}`;

export function diff(a: Graph, b: Graph): Diff {
  const am = new Map(a.nodes.map(n => [n.id, n]));
  const r: Diff = { added: [], removed: [], modified: [], eAdded: [], eRemoved: [], eModified: [], count: 0 };
  for (const n of b.nodes) {
    const o = am.get(n.id);
    if (!o) { r.added.push(n.id); continue; }
    const f: Diff['modified'][number]['f'] = [];
    for (const k of Object.keys(DIFF_FIELDS) as DiffField[]) {
      if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) f.push({ k, from: o[k], to: n[k] });
    }
    if (f.length) r.modified.push({ id: n.id, f });
  }
  const bIds = new Set(b.nodes.map(n => n.id));
  for (const n of a.nodes) if (!bIds.has(n.id)) r.removed.push(n.id);
  const ae = new Map(a.edges.map(e => [edgeKey(e), e]));
  const be = new Map(b.edges.map(e => [edgeKey(e), e]));
  for (const [k, e] of be) {
    const o = ae.get(k);
    if (!o) r.eAdded.push(k);
    else if ((o.label || '') !== (e.label || '')) r.eModified.push(k);
  }
  for (const k of ae.keys()) if (!be.has(k)) r.eRemoved.push(k);
  r.count = r.added.length + r.removed.length + r.modified.length + r.eAdded.length + r.eRemoved.length + r.eModified.length;
  return r;
}

/** Light structural check for graphs coming from clients. Returns an error message or null. */
export function checkGraphShape(g: unknown): string | null {
  if (!g || typeof g !== 'object') return 'Graph is missing';
  const gr = g as Graph;
  if (!Array.isArray(gr.nodes) || !Array.isArray(gr.edges)) return 'Graph needs nodes and edges';
  if (gr.nodes.length > 400 || gr.edges.length > 800) return 'Graph is too large';
  const ids = new Set<string>();
  for (const n of gr.nodes) {
    if (!n || typeof n.id !== 'string' || !n.id || n.id.length > 64) return 'Every step needs an id';
    if (ids.has(n.id)) return `Duplicate step id ${n.id}`;
    ids.add(n.id);
    if (!['start', 'action', 'decision', 'escalation', 'end'].includes(n.type)) return `Unknown step type on ${n.id}`;
    if (typeof n.title !== 'string' || n.title.length > 200) return `Invalid title on ${n.id}`;
    if (typeof n.x !== 'number' || typeof n.y !== 'number' || !isFinite(n.x) || !isFinite(n.y)) return `Invalid position on ${n.id}`;
    if (!Array.isArray(n.checklist) || n.checklist.some(c => typeof c !== 'string' || c.length > 500)) return `Invalid checklist on ${n.id}`;
    if (typeof n.sla !== 'number' || n.sla < 0 || n.sla > 525600) return `Invalid SLA on ${n.id}`;
    for (const k of ['phase', 'role', 'desc'] as const) if (typeof n[k] !== 'string' || n[k].length > 4000) return `Invalid ${k} on ${n.id}`;
    const t = checkTargets(n);
    if (t) return t;
  }
  const eids = new Set<string>();
  for (const e of gr.edges) {
    if (!e || typeof e.id !== 'string' || !e.id) return 'Every connection needs an id';
    if (eids.has(e.id)) return `Duplicate connection id ${e.id}`;
    eids.add(e.id);
    if (!ids.has(e.from) || !ids.has(e.to)) return `Connection ${e.id} points to a missing step`;
    if (typeof e.label !== 'string' || e.label.length > 60) return `Invalid label on ${e.id}`;
  }
  return null;
}
